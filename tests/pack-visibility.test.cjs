const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const {layout, scan, writeJSON,resolveVersion,readJSON} = require('../storage.cjs');
const {Loaders} = require('../loaders.cjs');
const {Modpacks} = require('../modpacks.cjs');
const {ContentInstaller} = require('../content-install.cjs');
const {upgrade}=require('../scripts/embed-installed-pack.cjs');

for (const existing of [true, false]) {
  test(existing ? 'a modpack keeps an existing standalone game visible' :
    'a fresh modpack publishes only its own client and can reuse it offline for a second pack', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starquill-pack-list-'));
    t.after(() => fs.rm(root, {recursive:true,force:true}));
    const version='1.21.1', packName='Visible pack', jar=Buffer.from('game');
    const meta={id:version,type:'release',mainClass:'example.Main',javaVersion:{majorVersion:21},
      downloads:{client:{url:'https://example.test/client.jar',size:jar.length,sha1:crypto.createHash('sha1').update(jar).digest('hex')}}};
    if(existing){
      const base=layout(root,version);
      await writeJSON(base.json,meta);
      await fs.writeFile(base.jar,jar);
    }
    const fetcher=async url=>url.endsWith('/metadata.json') ? Response.json(meta) : new Response(jar);
    const loaders=new Loaders({root,mode:'official',fetcher,chooseJava:async()=>({major:21}),
      getManifest:async()=>({versions:[{id:version,url:'https://example.test/metadata.json'}]})});
    const service=new Modpacks({installer:new ContentInstaller({root,fetcher}),loaders});
    const file=path.join(root,'pack.mrpack'), archive=new Zip();
    archive.addFile('modrinth.index.json',Buffer.from(JSON.stringify({game:'minecraft',formatVersion:1,
      name:packName,dependencies:{minecraft:version},files:[]})));
    archive.writeZip(file);
    await service.install(await service.plan(file,''));
    const ids=async()=>(await scan(root)).map(v=>v.id).sort();
    assert.deepEqual(await ids(),existing?[version,packName]:[packName]);
    assert.deepEqual((await fs.readdir(path.join(root,'versions'))).sort(),await ids());
    const own=layout(root,packName),{raw,chain}=await resolveVersion(root,packName);
    assert.equal(raw.id,packName);assert.equal(raw.inheritsFrom,undefined);assert.equal(raw.jar,undefined);assert.equal(chain.length,1);
    assert.deepEqual(raw.downloads.client,meta.downloads.client);assert.deepEqual(await fs.readFile(own.jar),jar);
    assert.deepEqual(await readJSON(path.join(own.version,'hmclversion.cfg')),{usesGlobal:false,gameDirType:1});
    if(existing){assert.deepEqual(await readJSON(layout(root,version).json),meta);assert.deepEqual(await fs.readFile(layout(root,version).jar),jar);}
    else{
      loaders.fetcher=async()=>assert.fail('unexpected network request');loaders.getManifest=async()=>assert.fail('unexpected catalog lookup');
      await service.install(await service.plan(file,version));
      assert.deepEqual(await ids(),[version,packName]);assert.deepEqual(await fs.readFile(layout(root,version).jar),jar);
      assert.equal((await resolveVersion(root,version)).chain.length,1);
    }
  });
}

test('upgrading an existing Forge pack embeds the validated client, keeps loader arguments and preserves user files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-embed-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const game='1.20.1',id='Forge 示例 (2)',p=layout(root,id),base=layout(root,game),bytes=Buffer.from('official client');
 const descriptor={size:bytes.length,sha1:crypto.createHash('sha1').update(bytes).digest('hex')};
 await writeJSON(base.json,{id:game,mainClass:'game.Main',downloads:{client:descriptor},libraries:[{name:'base:lib:1'}],arguments:{game:['--username','${auth_player_name}'],jvm:['-cp','${classpath}']}});
 await fs.writeFile(base.jar,'invalid');
 const natives={windows:'win',linux:'linux','linux-arm64':'arm-linux','osx-arm64':'arm-osx'};
 const original={id,inheritsFrom:game,mainClass:'forge.Bootstrap',libraries:[{name:'net.minecraftforge:forge:1.20.1-47.4.16'},{name:'example:native:2',natives}],arguments:{game:['--launchTarget','forgeclient'],jvm:['-DignoreList=fmlcore']},starQuill:{game,loader:'forge'}};
 await writeJSON(p.json,original);await writeJSON(path.join(p.version,'starquill-pack.json'),{game,name:id});await fs.mkdir(path.join(p.version,'saves'));await fs.writeFile(path.join(p.version,'saves','keep'),'world');
 await assert.rejects(upgrade(root,id),/客户端/);assert.deepEqual(await readJSON(p.json),original);
 await fs.writeFile(base.jar,bytes);const hmcl={usesGlobal:false,gameDirType:1,maxMemory:6144};await writeJSON(path.join(p.version,'hmclversion.cfg'),hmcl);
 await upgrade(root,id);await upgrade(root,id);const {raw,chain}=await resolveVersion(root,id);
 assert.equal(chain.length,1);assert.equal(raw.id,id);assert.equal(raw.mainClass,'forge.Bootstrap');assert.equal(raw.jar,undefined);
 assert.deepEqual(raw.arguments.game,['--username','${auth_player_name}','--launchTarget','forgeclient']);
 assert.deepEqual(raw.libraries.map(l=>l.name),['base:lib:1','net.minecraftforge:forge:1.20.1-47.4.16','example:native:2']);
 assert.deepEqual(raw.libraries[2].natives,{windows:'win',linux:'linux'});assert.deepEqual(raw.libraries[2].starQuillNativeAliases,{'linux-arm64':'arm-linux','osx-arm64':'arm-osx'});
 assert.deepEqual(await fs.readFile(p.jar),bytes);assert.match(raw.arguments.jvm.at(-1),/version_name/);
 assert.deepEqual(await readJSON(path.join(p.version,'hmclversion.cfg')),hmcl);assert.equal(await fs.readFile(path.join(p.version,'saves','keep'),'utf8'),'world');
 assert.deepEqual(await fs.readdir(base.version),[game+'.jar',game+'.json']);
});
