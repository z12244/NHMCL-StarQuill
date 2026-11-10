const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {javaRequirement,requiredJava,javaCompatible,describeJava,chooseJava}=require('../java.cjs');
const {Game,libraryFiles}=require('../game.cjs'),{Loaders,targetInfo,loaderInfo,forgeArtifactVersion}=require('../loaders.cjs'),{layout,writeJSON}=require('../storage.cjs'),{InstanceManager}=require('../instance-manager.cjs');
const modern={min:17,max:26,preferred:21,majors:[17,21,25,26]};
const runtime=(major,bundled=false)=>({major,bundled,version:major+'.0.1',bits:64,arch:'amd64',path:'unused'});
async function tree(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-gtnh-engine-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function profile(root,id,extra={}){await writeJSON(layout(root,id).json,{id,mainClass:'example.Main',libraries:[],...extra});await fs.writeFile(layout(root,id).jar,'fixture-client');}
test('pack Java declarations allow supported modern runtimes while vanilla requirements remain exact',()=>{
  const meta={id:'GTNH',javaVersion:{majorVersion:17},starQuill:{java:modern}};
  assert.deepEqual(javaRequirement(meta),modern);assert.equal(requiredJava(meta),21);
  for(const major of [17,21,25,26])assert.equal(javaCompatible(major,javaRequirement(meta)),true);
  for(const major of [8,18,24,27])assert.equal(javaCompatible(major,javaRequirement(meta)),false);
  assert.equal(javaCompatible(18,{min:17,max:26,preferred:21}),true);
  assert.equal(chooseJava([runtime(25),runtime(21)],modern).major,21);
  assert.equal(chooseJava([runtime(17),runtime(21,true)],modern).major,21);
  assert.equal(chooseJava([runtime(8),runtime(25)],modern).major,25);
  assert.throws(()=>chooseJava([runtime(8),{...runtime(21),arch:'aarch64'}],modern),/17 \/ 21 \/ 25 \/ 26/);
  assert.equal(describeJava({min:17,max:26,preferred:21}),'17–26');
  assert.deepEqual(javaRequirement({id:'1.7.10'}),{min:8,max:8,preferred:8});
  assert.equal(javaCompatible(21,javaRequirement({id:'1.20.1'})),false);
  assert.throws(()=>javaRequirement({starQuill:{java:{min:17,max:26,preferred:8}}}),/兼容范围/);
});
test('legacy native Maven descriptors resolve Windows classifiers without polluting the classpath',()=>{
  const root=path.join(os.tmpdir(),'starquill-native-fixture'),p=layout(root,'test');
  const result=libraryFiles({libraries:[
    {name:'net.java.jinput:jinput-platform:2.0.5',url:'http://libraries.minecraft.net/',natives:{windows:'natives-windows'},extract:{exclude:['META-INF/']}},
    {name:'example:native:1:other@zip',url:'https://cdn.example.com/maven',natives:{windows:'natives-windows-${arch}'}},
    {name:'example:linux:1',natives:{windows:'natives-windows'},downloads:{classifiers:{'natives-linux':{url:'https://example.com/linux.jar'}}}}
  ]},p);
  assert.equal(result.classes.length,0);assert.equal(result.natives.length,2);
  assert.equal(result.files[0].url,'https://libraries.minecraft.net/net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-windows.jar');
  assert.equal(result.files[1].url,'https://cdn.example.com/maven/example/native/1/native-1-natives-windows-64.zip');
});
test('Forge artifact identifiers accept both official and mirror legacy version forms without duplicating the branch',()=>{
 for(const version of ['10.13.4.1614','10.13.4.1614-1.7.10','1.7.10-10.13.4.1614-1.7.10'])assert.equal(forgeArtifactVersion('1.7.10',version,'1.7.10'),'1.7.10-10.13.4.1614-1.7.10');
 assert.equal(forgeArtifactVersion('1.20.1','47.3.0'),'1.20.1-47.3.0');
});
test('RFB system class loader launches directly and runtime-dependent arguments use the selected Java',async t=>{
  const root=await tree(t);await profile(root,'Modern GTNH',{starQuill:{java:modern},arguments:{jvm:['-Djava.system.class.loader=example.RfbLoader','--enable-native-access','ALL-UNNAMED']}});
  const prepared=await new Game({root,version:'Modern GTNH',name:'Tester',memory:1,javaMajor:17}).prepare();
  assert.equal(prepared.javaVersion,17);assert.ok(prepared.args.includes('-Djava.system.class.loader=example.RfbLoader'));assert.ok(!prepared.args.includes('-jar'));
  // Generational ZGC exists in Java 21; old inferred Java 8 must not reject it.
  await profile(root,'Runtime dependent',{starQuill:{java:{min:8,max:26,preferred:8}}});
  const current=await new Game({root,version:'Runtime dependent',name:'Tester',memory:1,javaMajor:25,advanced:{gc:'zgc'}}).prepare();
  assert.ok(current.args.includes('-XX:+UseZGC'));assert.equal(current.javaVersion,25);
  if(process.platform==='win32'){
    await profile(root,'Ordinary Java17',{javaVersion:{majorVersion:17}});
    const ordinary=await new Game({root,version:'Ordinary Java17',name:'Tester',memory:1}).prepare();assert.ok(ordinary.args.includes('-jar'));
  }
});
test('custom pack loader metadata is usable for resource compatibility and staging accepts pack Java requirements',async t=>{
  const root=await tree(t);await profile(root,'Patched',{starQuill:{game:'1.7.10',loader:'forge',loaderVersion:'10.13.4.1614',java:modern}});
  const info=await targetInfo(root,'Patched');assert.equal(info.loader,'forge');assert.equal(info.loaderVersion,'10.13.4.1614');assert.equal(info.game,'1.7.10');
  await profile(root,'1.7.10');let selected;
  const loaders=new Loaders({root,chooseJava:async requirement=>{selected=requirement;return runtime(21);}});
  const stage=await loaders.createStage('1.7.10','Imported',undefined,modern);
  try{assert.deepEqual(selected,modern);assert.equal(stage.java.major,21);assert.equal(await fs.readFile(layout(stage.root,'1.7.10').jar,'utf8'),'fixture-client');}finally{await loaders.cleanStage(stage.root);}
});
test('Cleanroom uses author-declared Java compatibility rather than the inherited Minecraft 1.12.2 Java 8',()=>{
 const current={id:'1.12.2-Cleanroom',javaVersion:{majorVersion:8},compatibleJavaMajors:[25]};
 assert.equal(requiredJava(current),25);assert.equal(javaCompatible(21,javaRequirement(current)),false);
 assert.equal(chooseJava([runtime(21,true),runtime(25)],javaRequirement(current)).major,25);
 assert.equal(requiredJava({...current,compatibleJavaMajors:[17,21]}),21);
 assert.equal(requiredJava({id:'Old Cleanroom',javaVersion:{majorVersion:17}}),17);
 assert.equal(javaCompatible(26,javaRequirement(current)),false);
 assert.throws(()=>javaRequirement({...current,compatibleJavaMajors:[]}),/兼容版本列表/);
});
test('Cleanroom universal artifacts take precedence over inherited Forge metadata and resource manager reports the actual loader',async t=>{
 const root=await tree(t);await profile(root,'1.12.2',{javaVersion:{majorVersion:8}});
 await writeJSON(layout(root,'Cleanroom').json,{id:'Cleanroom',inheritsFrom:'1.12.2',mainClass:'top.outlands.foundation.boot.Foundation',compatibleJavaMajors:[25],starQuill:{loader:'forge'},libraries:[{name:'net.minecraftforge:forge:1.12.2-14.23.5.2860'},{name:'com.cleanroommc:cleanroom:0.7.14-alpha:universal'}]});
 const target=await targetInfo(root,'Cleanroom');assert.equal(target.loader,'cleanroom');assert.equal(target.loaderVersion,'0.7.14-alpha');assert.equal(target.game,'1.12.2');
 const info=await new InstanceManager(root,{memory:2,javaMode:'auto',isolate:true}).info('Cleanroom');assert.equal(info.target.loader,'cleanroom');assert.equal(info.requiredJava,25);assert.equal(info.requiredJavaDescription,'25');assert.deepEqual(info.javaRequirement.majors,[25]);
 assert.equal(loaderInfo({libraries:[{name:'com.cleanroommc:cleanroom-relauncher:1.0.0'}]}).loader,null);
 assert.equal(loaderInfo({starQuill:{loader:'cleanroom',loaderVersion:'0.1.0'},libraries:[]}).loaderVersion,'0.1.0');
});
