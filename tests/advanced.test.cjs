const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {effective, portableOverrides, splitArguments, collectorArgs, mergeGameArgs} = require('../advanced.cjs');
const {Downloads} = require('../downloads.cjs');
const {ContentInstaller} = require('../content-install.cjs');
const {sealProjectKey, openProjectKey} = require('../project-credential.cjs');
const {downloadSources} = require('../curseforge-access.cjs');
const {Resources} = require('../resources.cjs');
const {InstanceManager} = require('../instance-manager.cjs');
const {instanceOptions} = require('../instance-config.cjs');

async function tree(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'starquill-advanced-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  return root;
}
test('each advanced option inherits independently, including deliberate blank or false', async t => {
  const root=await tree(t), id='1.21.1', dir=path.join(root,'versions',id);
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,id+'.json'),JSON.stringify({id,mainClass:'Main',libraries:[]}));
  const global={advanced:{jvmArgs:'-Dprobe=global', preLaunch:'echo global', blockModUpdates:true},memory:2};
  const manager=new InstanceManager(root,global);
  const config={displayName:'',java:'',javaMode:'inherit',isolate:'inherit',memory:null};
  assert.equal((await manager.info(id)).effective.advanced.blockModUpdates,true);
  await manager.save(id,{...config,advanced:{preLaunch:'',blockModUpdates:false}});
  assert.equal((await instanceOptions(root,id,global)).advanced.jvmArgs,'-Dprobe=global');
  assert.equal((await instanceOptions(root,id,global)).advanced.preLaunch,'');
  assert.equal((await instanceOptions(root,id,global)).advanced.blockModUpdates,false);
  const stored=JSON.parse(await fs.readFile(path.join(dir,'.starquill-settings.json')));
  assert.deepEqual(stored.advanced,{blockModUpdates:false});
  await manager.save(id,{...config,advanced:{}});
  global.advanced.preLaunch='echo changed';
  assert.equal((await manager.info(id)).effective.advanced.preLaunch,'echo changed');
  assert.deepEqual(portableOverrides({preLaunch:'never execute an imported command',jvmArgs:'-javaagent:x',gc:'serial'}),{gc:'serial'});
});
test('combines quoted paths, JVM collectors and game options according to argument position', () => {
  assert.deepEqual(splitArguments('-Dpath="D:\\测试 路径\\mods" --name "my world" ""'),['-Dpath=D:\\测试 路径\\mods','--name','my world','']);
  assert.throws(()=>effective({gameArgs:'"open'}),/引号/);
  assert.deepEqual(collectorArgs('g1',21,['-XX:+UseParallelGC']),[]);
  assert.throws(()=>collectorArgs('zgc',8,[]),/Java 15/);
  assert.deepEqual(mergeGameArgs(['--width','640','--tweakClass','base'],['--width','1280','--tweakClass','new']),
    ['--tweakClass','base','--width','1280','--tweakClass','new']);
});
test('skipping existing game checks never trusts a bad new download', async t => {
  const root=await tree(t), file=path.join(root,'client.jar');
  const valid=Buffer.from('verified'), sha1=crypto.createHash('sha1').update(valid).digest('hex');
  let calls=0;
  const d=new Downloads({root,mode:'official',sourceResolver:u=>[u],fetcher:async()=>{calls++;return new Response('bad');}});
  await d.init();await fs.writeFile(file,'local patch');d.trustExisting=true;
  const item={file,url:'https://example.org/client.jar',size:valid.length,sha1};
  await d.ensure(item);assert.equal(calls,0);
  await fs.unlink(file);await assert.rejects(d.ensure(item),/长度|校验/);
  assert.ok(calls>0);await assert.rejects(fs.stat(file),{code:'ENOENT'});
});
test('the update lock blocks a managed mod replacement before any download',async t=>{
  const root=await tree(t), folder=path.join(root,'versions','sample');
  await fs.mkdir(path.join(folder,'mods'),{recursive:true});
  await fs.writeFile(path.join(folder,'mods','sample.jar'),'local');
  await fs.writeFile(path.join(folder,'.starquill-content.json'),JSON.stringify({files:[{source:'curseforge',projectId:'1',versionId:'7',path:'mods/sample.jar'}]}));
  const installer=new ContentInstaller({root,fetcher:()=>assert.fail('Unexpected network access')});
  await assert.rejects(installer.install({target:{folder,blockModUpdates:true},files:[{project:{id:'1',source:'curseforge',kind:'mod',title:'demo'},versionId:'8'}]}),/禁止更新/);
  assert.equal(await fs.readFile(path.join(folder,'mods/sample.jar'),'utf8'),'local');
});
test('the project credential works on a fresh installation and stays out of mirror requests', async()=>{
  const key='private-fixture-credential';
  const {envelope,wrappingKey}=sealProjectKey(key);
  assert.ok(!Buffer.from(envelope,'base64').includes(Buffer.from(key)));
  assert.equal(openProjectKey(envelope,wrappingKey),key);
  const seen=[];
  const res=new Resources({key:openProjectKey(envelope,wrappingKey),fetcher:async(url,opt)=>{
    const origin=new URL(url).origin;seen.push(origin);
    if(origin==='https://api.curseforge.com'){assert.equal(opt.headers['x-api-key'],key);return new Response(null,{status:503});}
    assert.equal(opt.headers['x-api-key'],undefined);return Response.json({data:{id:432}});
  }});
  assert.equal((await res.cf('/games/432')).id,432);
  assert.deepEqual(seen,['https://api.curseforge.com','https://mod.mcimirror.top']);
  const edge='https://edge.forgecdn.net/files/123/456/a.jar';
  assert.equal(downloadSources(edge,false)[0],'https://mod.mcimirror.top/files/123/456/a.jar');
  assert.deepEqual(downloadSources(edge+'?signed=val',false),[edge+'?signed=val']);
});
