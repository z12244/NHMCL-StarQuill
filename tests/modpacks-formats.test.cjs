const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),native=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const yazl=require('yazl');
const {Modpacks}=require('../modpacks.cjs');
const {layout,scan,writeJSON,readJSON,resolveVersion}=require('../storage.cjs');
const {hashFile}=require('../downloads.cjs');
const {memoryLimit}=require('../java.cjs');

const game='1.7.10',forge='10.13.4.1614';
const client=Buffer.from('synthetic Minecraft client'),library=Buffer.from('synthetic bundled bootstrap');
const digest=(data,algorithm='sha1')=>crypto.createHash(algorithm).update(data).digest('hex');
const libraryPath='example/bootstrap/1.0/bootstrap-1.0.jar';
const clientDownload={url:'https://example.test/client.jar',sha1:digest(client),size:client.length};
const baseMeta={id:game,type:'release',mainClass:'net.minecraft.client.main.Main',downloads:{client:clientDownload},libraries:[],minecraftArguments:'--username ${auth_player_name}'};

async function fixture(t,items){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-modpack-integration-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'input.zip'),archive=new yazl.ZipFile();
 for(const [name,body]of Object.entries(items))archive.addBuffer(Buffer.from(typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body),name);
 archive.end();
 await new Promise((resolve,reject)=>{const out=native.createWriteStream(file);out.on('finish',resolve);out.on('error',reject);archive.outputStream.on('error',reject);archive.outputStream.pipe(out);});
 return {root:root,minecraft:path.join(root,'.minecraft'),file};
}

function mmcItems({name='Fixture Modern Pack',hashes={},extraFiles={}}={}){
 const root='Nested/Modern Pack/';
 return {
  [root+'mmc-pack.json']:{formatVersion:1,components:[{uid:'net.minecraft',version:game},{uid:'net.minecraftforge',version:forge},{uid:'example.bootstrap',version:'1'}]},
  [root+'instance.cfg']:'name='+name+'\nOverrideMemory=true\nMaxMemAlloc=4096\niconKey=pack-icon\n',
  [root+'patches/net.minecraft.json']:{uid:'net.minecraft',order:-2,version:game,mainClass:'net.minecraft.client.main.Main',mainJar:{name:'com.mojang:minecraft:1.7.10:client',downloads:{artifact:clientDownload}},minecraftArguments:'--username ${auth_player_name}',compatibleJavaMajors:[17,21,25,26]},
  [root+'patches/example.bootstrap.json']:{uid:'example.bootstrap',order:3,mainClass:'example.CustomMain','+jvmArgs':['-Djava.system.class.loader=example.CustomLoader'],'+libraries':[{name:'example:bootstrap:1.0','MMC-hint':'local',downloads:{artifact:{path:libraryPath,size:library.length,...hashes}}}]},
  [root+'libraries/bootstrap-1.0.jar']:library,
  [root+'pack-icon.png']:Buffer.from('synthetic icon bytes'),
  [root+'.minecraft/mods/bundled.jar']:'synthetic mod',
  [root+'.minecraft/config/pack.cfg']:'custom=true',
  ...Object.fromEntries(Object.entries(extraFiles).map(([name,body])=>[root+'.minecraft/'+name,body]))
 };
}

// Keep networking and Java execution out of these integration tests. Parsing,
// archive validation, resource copying, metadata composition and publication
// still use the real Modpacks implementation and on-disk directory layout.
function service(root,{onStatus,finishFailure}={}){
 const calls={create:[],install:[],finish:0,clean:[],downloads:[]};
 const resources={project:async()=>{throw Error('unexpected project request');},file:async()=>{throw Error('unexpected resource request');}};
 const downloader={init:async()=>downloader,valid:async()=>false,all:async files=>{calls.downloads.push(...files);assert.deepEqual(files,[],'self-contained archive must not request remote resources');}};
 const installer={root,downloader:()=>downloader};
 const loaders={onStatus,
  async createStage(version,id,signal,java){
   signal?.throwIfAborted();calls.create.push({version,id,java});
   const base=layout(root,version);
   try{await fs.access(base.json);}catch{await writeJSON(base.json,baseMeta);await fs.writeFile(base.jar,client);}
   const stageRoot=path.join(root,'.starquill','install',crypto.randomUUID()),stageBase=layout(stageRoot,version);
   await fs.mkdir(stageBase.version,{recursive:true});await fs.copyFile(base.json,stageBase.json);await fs.copyFile(base.jar,stageBase.jar);
   return {root:stageRoot,game:version,id,java};
  },
  async installInStage(stage,details,signal){
   signal?.throwIfAborted();calls.install.push(details);
   await writeJSON(layout(stage.root,stage.id).json,{id:stage.id,inheritsFrom:stage.game,mainClass:'net.minecraft.launchwrapper.Launch',libraries:[],arguments:{game:['--tweakClass','cpw.mods.fml.common.launcher.FMLTweaker'],jvm:[]},starQuill:{game:stage.game,loader:details.loader,loaderVersion:details.version}});
  },
  async finish(stage,signal){
   calls.finish++;signal?.throwIfAborted();if(finishFailure)throw Error(finishFailure);
   const current=layout(stage.root,stage.id);await readJSON(current.json);
   const dest=layout(root,stage.id).version;await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(current.version,dest);return stage.id;
  },
  async cleanStage(stageRoot){
   assert.equal(path.dirname(stageRoot),path.join(root,'.starquill','install'));
   calls.clean.push(stageRoot);await fs.rm(stageRoot,{recursive:true,force:true});
  }
 };
 return {modpacks:new Modpacks({resources,installer,loaders}),calls};
}

async function assertStageClean(root,calls){
 assert.equal(calls.clean.length,calls.create.length);
 const staged=await fs.readdir(path.join(root,'.starquill','install'));assert.deepEqual(staged,[]);
}

test('self-contained MultiMC import publishes one independent version with its own profile and bundled content',async t=>{
 const f=await fixture(t,mmcItems()),{modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');
 assert.equal(plan.id,'Fixture Modern Pack');assert.equal(plan.pack.format,'multimc');assert.equal(plan.files.length,0);assert.equal(plan.bundledFiles,4);
 assert.deepEqual(plan.pack.java,{min:17,max:26,preferred:21,majors:[17,21,25,26]});
 assert.equal(await modpacks.install(plan),plan.id);assert.equal(calls.install.length,0,'a complete component profile must bypass the generic Forge installer');
 const own=layout(f.minecraft,plan.id),profile=await readJSON(own.json);
 assert.equal(profile.id,plan.id);assert.equal(profile.mainClass,'example.CustomMain');assert.equal(profile.inheritsFrom,undefined);assert.equal(profile.jar,undefined);
 assert.deepEqual(profile.arguments.jvm,['-Djava.system.class.loader=example.CustomLoader']);assert.ok(profile.arguments.game.includes('${auth_player_name}'));
 assert.deepEqual(profile.starQuill.java,plan.pack.java);assert.deepEqual(calls.create[0].java,plan.pack.java);
 assert.deepEqual(await fs.readFile(own.jar),client);assert.equal(await fs.readFile(path.join(own.game,'config','pack.cfg'),'utf8'),'custom=true');
 assert.equal(await fs.readFile(path.join(own.game,'mods','bundled.jar'),'utf8'),'synthetic mod');assert.equal(await fs.readFile(path.join(own.game,'.starquill-icon.png'),'utf8'),'synthetic icon bytes');
 const artifact=profile.libraries[0].downloads.artifact;assert.equal(artifact.path,libraryPath);assert.equal(artifact.sha1,digest(library));assert.equal(artifact.size,library.length);
 assert.deepEqual(await fs.readFile(path.join(f.minecraft,'libraries',artifact.path)),library);
 const settings=await readJSON(path.join(own.game,'.starquill-settings.json'));assert.equal(settings.memory,Math.min(4,memoryLimit()));assert.equal(settings.javaMode,'auto');
 assert.equal((await readJSON(path.join(own.game,'starquill-pack.json'))).format,'multimc');
 assert.deepEqual((await scan(f.minecraft)).map(v=>v.id),[plan.id],'newly downloaded helper vanilla is folded into the imported version');
 await assertStageClean(f.minecraft,calls);
});

test('a pre-existing vanilla version remains visible and byte-for-byte unchanged after import',async t=>{
 const f=await fixture(t,mmcItems()),base=layout(f.minecraft,game),original={...baseMeta,customField:'belongs to another launcher'};
 await writeJSON(base.json,original);await fs.writeFile(base.jar,client);const before=await fs.readFile(base.json);
 const {modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');await modpacks.install(plan);
 assert.deepEqual(await fs.readFile(base.json),before);assert.deepEqual(await fs.readFile(base.jar),client);
 assert.deepEqual((await scan(f.minecraft)).map(v=>v.id).sort(),[game,plan.id].sort());await fs.access(path.join(base.version,'.starquill-standalone'));
 await assertStageClean(f.minecraft,calls);
});

test('bundled library conflicts use a private alias and preserve another launcher shared cache',async t=>{
 const f=await fixture(t,mmcItems()),shared=path.join(f.minecraft,'libraries',libraryPath),foreign=Buffer.from('another launcher library');
 await fs.mkdir(path.dirname(shared),{recursive:true});await fs.writeFile(shared,foreign);
 const {modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');await modpacks.install(plan);
 const profile=await readJSON(layout(f.minecraft,plan.id).json),artifact=profile.libraries[0].downloads.artifact;
 assert.equal(artifact.path,`starquill-bundled/${plan.archiveHash.slice(0,16)}/0-bootstrap-1.0.jar`);
 assert.deepEqual(await fs.readFile(shared),foreign);assert.deepEqual(await fs.readFile(path.join(f.minecraft,'libraries',artifact.path)),library);
 assert.equal(artifact.sha1,await hashFile(path.join(f.minecraft,'libraries',artifact.path),'sha1'));await assertStageClean(f.minecraft,calls);
});

test('incorrect bundled SHA-1 rejects installation before publishing a version',async t=>{
 const f=await fixture(t,mmcItems({hashes:{sha1:'0'.repeat(40)}})),{modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');
 await assert.rejects(modpacks.install(plan),/本地依赖校验失败/);assert.equal(calls.finish,0);
 await assert.rejects(fs.access(layout(f.minecraft,plan.id).version),{code:'ENOENT'});assert.equal((await scan(f.minecraft)).some(v=>v.id===plan.id),false);
 await assertStageClean(f.minecraft,calls);
});

test('incorrect bundled SHA-256-only metadata rejects installation before publishing',async t=>{
 const f=await fixture(t,mmcItems({hashes:{sha256:'0'.repeat(64)}})),{modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');
 await assert.rejects(modpacks.install(plan),/本地依赖校验失败/);assert.equal(calls.finish,0);
 await assert.rejects(fs.access(layout(f.minecraft,plan.id).version),{code:'ENOENT'});await assertStageClean(f.minecraft,calls);
});

test('a stale private library alias is repaired or bypassed without replacing the foreign shared library',async t=>{
 const f=await fixture(t,mmcItems()),shared=path.join(f.minecraft,'libraries',libraryPath),foreign=Buffer.from('unrelated shared library'),{modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');
 const stale=path.join(f.minecraft,'libraries',`starquill-bundled/${plan.archiveHash.slice(0,16)}/0-bootstrap-1.0.jar`);
 await fs.mkdir(path.dirname(shared),{recursive:true});await fs.writeFile(shared,foreign);await fs.mkdir(path.dirname(stale),{recursive:true});await fs.writeFile(stale,'interrupted earlier write');
 await modpacks.install(plan);const profile=await readJSON(layout(f.minecraft,plan.id).json),artifact=profile.libraries[0].downloads.artifact;
 assert.deepEqual(await fs.readFile(path.join(f.minecraft,'libraries',artifact.path)),library);assert.deepEqual(await fs.readFile(shared),foreign);
 await assertStageClean(f.minecraft,calls);
});

test('cancellation during bundled content extraction cleans the stage and does not publish a partial version',{timeout:5000},async t=>{
 const f=await fixture(t,mmcItems({extraFiles:{'config/second.cfg':'two','config/third.cfg':'three'}})),controller=new AbortController();
 const {modpacks,calls}=service(f.minecraft,{onStatus(){controller.abort(new Error('fixture canceled'));}}),plan=await modpacks.plan(f.file,'');
 await assert.rejects(modpacks.install(plan,controller.signal),error=>error.name==='AbortError'&&error.cause?.message==='fixture canceled');assert.equal(calls.finish,0);
 await assert.rejects(fs.access(layout(f.minecraft,plan.id).version),{code:'ENOENT'});assert.deepEqual((await scan(f.minecraft)).map(v=>v.id),[game]);
 await assertStageClean(f.minecraft,calls);
});

test('a final preparation failure never publishes the imported version and cleans staged content',async t=>{
 const f=await fixture(t,mmcItems()),{modpacks,calls}=service(f.minecraft,{finishFailure:'fixture prepare failed'}),plan=await modpacks.plan(f.file,'');
 await assert.rejects(modpacks.install(plan),/fixture prepare failed/);assert.equal(calls.finish,1);
 await assert.rejects(fs.access(layout(f.minecraft,plan.id).version),{code:'ENOENT'});await assertStageClean(f.minecraft,calls);
});

test('archive changes after preview are rejected before any installation stage is created',async t=>{
 const f=await fixture(t,mmcItems()),{modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');
 await fs.appendFile(f.file,'changed after preview');await assert.rejects(modpacks.install(plan),/发生变化/);assert.equal(calls.create.length,0);assert.equal(calls.finish,0);
 await assert.rejects(fs.access(layout(f.minecraft,plan.id).version),{code:'ENOENT'});
});

test('CurseForge delta patches compose on the resolved Forge base and their local libraries remain available',async t=>{
 const f=await fixture(t,{'manifest.json':{manifestType:'minecraftModpack',manifestVersion:1,name:'Delta Pack',minecraft:{version:game,modLoaders:[{id:'forge-'+forge}],javaVersion:21,patches:['patches/bootstrap.json']},files:[],overrides:'overrides'},
  'overrides/patches/bootstrap.json':{mainClass:'example.DeltaMain','+jvmArgs':['-Ddelta=true'],'+libraries':[{name:'example:bootstrap:1.0','MMC-hint':'local'}],compatibleJavaMajors:[17,21,25,26]},
  'overrides/libraries/bootstrap-1.0.jar':library,'overrides/config/delta.cfg':'delta=true'}),{modpacks,calls}=service(f.minecraft),plan=await modpacks.plan(f.file,'');
 assert.equal(plan.pack.profile,undefined);assert.equal(plan.pack.profilePatches.length,1);await modpacks.install(plan);
 assert.equal(calls.install.length,1);assert.equal(calls.install[0].loader,'forge');assert.equal(calls.install[0].version,forge);
 const profile=(await resolveVersion(f.minecraft,plan.id)).meta;assert.equal(profile.mainClass,'example.DeltaMain');assert.equal(profile.inheritsFrom,undefined);
 assert.ok(profile.arguments.game.includes('cpw.mods.fml.common.launcher.FMLTweaker'));assert.deepEqual(profile.arguments.jvm,['-Ddelta=true']);
 assert.deepEqual(await fs.readFile(path.join(f.minecraft,'libraries',profile.libraries[0].downloads.artifact.path)),library);
 assert.equal(await fs.readFile(path.join(layout(f.minecraft,plan.id).game,'config','delta.cfg'),'utf8'),'delta=true');await assertStageClean(f.minecraft,calls);
});
