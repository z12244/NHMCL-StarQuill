const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Downloads,MIRROR}=require('../src/downloads.cjs');
const origin='https://maven.neoforged.net/releases/net/neoforged/mergetool/2.0.0/mergetool-2.0.0-api.jar';
const digest=value=>crypto.createHash('sha1').update(value).digest('hex');
test('mirror cooldown keeps a reachable fallback when the preferred origin is down',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sq-fallback-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[],data='verified';const dl=new Downloads({root,mode:'auto',fetcher:async url=>{
    calls.push(url);return url.startsWith(MIRROR+'/')?new Response(data):new Response(null,{status:404});}});
  dl.mirrorBlockedUntil=Date.now()+60000;
  await dl.ensure({file:path.join(root,'test.jar'),url:origin,sha1:digest(data)});
  assert.equal(calls[0],origin);assert.equal(calls.length,2);
});
test('alternate NeoForge Maven uses verified content and respects official-only selection',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sq-neomaven-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[];let bytes='wrong';
  const dl=new Downloads({root,mode:'auto',fetcher:async url=>{
    calls.push(url);return new URL(url).hostname==='maven.creeperhost.net'?new Response(bytes):new Response(null,{status:404});}});
  const item={file:path.join(root,'jar'),url:'https://maven.neoforged.net/releases/cpw/mods/modlauncher/11.0.5/modlauncher-11.0.5.jar',sha1:digest('correct')};
  await assert.rejects(dl.ensure(item),/校验失败/);
  bytes='correct';await dl.ensure(item);assert.equal(await fs.readFile(item.file,'utf8'),bytes);
  for(const [mode,sha1] of [['official',item.sha1],['auto',undefined]]){
    calls.length=0;dl.mode=mode;await assert.rejects(dl.ensure({...item,file:path.join(root,mode),sha1}));
    assert.ok(calls.every(url=>!url.startsWith('https://maven.creeperhost.net/')));
  }
});
