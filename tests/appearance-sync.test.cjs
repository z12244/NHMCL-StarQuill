const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {appearance,cachedAppearance,png}=require('../appearance.cjs');
const {cacheFile}=require('../skins.cjs');
const role={id:'authlib:site:role',name:'SkinRole',type:'authlib',uuid:'a'.repeat(32),server:{url:'https://skin.example/api/yggdrasil/',name:'Test Skin Site'},tokens:{accessToken:'private-access-token',clientToken:'private-client-token'}};
const uri=bytes=>'data:image/png;base64,'+bytes.toString('base64');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-skin-sync-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,steve:await fs.readFile(path.join(__dirname,'../assets/steve.png')),alex:await fs.readFile(path.join(__dirname,'../assets/alex.png'))};}
function server(skin,{model='default',cape=null,seen=[],gate}={}){
  return async(url,options)=>{
    seen.push({url,options});
    assert.equal(options.redirect,'error');
    assert.ok(!options.headers&&!options.body,'No login credentials may accompany appearance requests');
    if(gate&&url===role.server.url)await gate;
    if(url===role.server.url)return new Response(JSON.stringify({skinDomains:['textures.skin.example']}));
    if(url===role.server.url+'sessionserver/session/minecraft/profile/'+role.uuid){
      const textures={SKIN:{url:'https://textures.skin.example/current-skin.png',metadata:{model}}};
      if(cape)textures.CAPE={url:'https://textures.skin.example/current-cape.png'};
      return new Response(JSON.stringify({properties:[{name:'textures',value:Buffer.from(JSON.stringify({textures})).toString('base64')}]}));
    }
    if(url==='https://textures.skin.example/current-skin.png')return new Response(skin);
    if(url==='https://textures.skin.example/current-cape.png'&&cape)return new Response(cape);
    throw Error('Unexpected appearance URL '+url);
  };
}
test('skin-site sync reads role skin/cape, force refreshes fresh cache and removes a cleared cape',async t=>{
  const {root,steve,alex}=await fixture(t),cape=Buffer.from(steve);cape.writeUInt32BE(32,20);
  assert.equal(await cachedAppearance(root,role),null);
  const firstCalls=[];
  const first=await appearance(root,role,server(steve,{cape,seen:firstCalls}),{force:true});
  assert.equal(firstCalls.length,4);assert.equal(first.skin,uri(steve));assert.equal(first.cape,uri(cape));assert.equal(first.default,false);
  assert.deepEqual(await cachedAppearance(root,role),first);
  assert.deepEqual(await appearance(root,role,()=>{throw Error('Cache hit must not fetch');}),first);
  const refreshedCalls=[];
  const updated=await appearance(root,role,server(alex,{model:'slim',seen:refreshedCalls}),{force:true});
  assert.equal(refreshedCalls.length,3);assert.equal(updated.skin,uri(alex));assert.equal(updated.model,'slim');assert.equal(updated.cape,null);
  assert.deepEqual(await cachedAppearance(root,role),updated);
});
test('simultaneous skin-site prefetch and preview share requests; an aborted refresh keeps cached skin/cape',async t=>{
  const {root,steve}=await fixture(t),cape=Buffer.from(steve);cape.writeUInt32BE(32,20);
  let release;const gate=new Promise(resolve=>{release=resolve;}),seen=[];
  const fetcher=server(steve,{cape,gate,seen});
  const one=appearance(root,role,fetcher,{force:true}),two=appearance(root,role,fetcher,{force:true});
  await new Promise(resolve=>setTimeout(resolve,20));release();
  const [a,b]=await Promise.all([one,two]);assert.deepEqual(a,b);assert.equal(seen.length,4);
  const controller=new AbortController();controller.abort();
  const result=await appearance(root,role,()=>{throw Error('Aborted request must not run');},{force:true,signal:controller.signal});
  assert.equal(result.skin,a.skin);assert.equal(result.cape,a.cape);assert.ok(result.warning);
  assert.deepEqual(await cachedAppearance(root,role),a,'Cancellation cannot replace persisted appearance');
});
test('local imported skin overrides all remote metadata and switches without stale cache',async t=>{
  const {root,steve,alex}=await fixture(t),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  const local={id:'offline:local',name:'OfflineRole',uuid:'b'.repeat(32),type:'offline',skin:{source:'local',hash:sha(alex),sourceName:'chosen-skin.png',sourceUUID:'c'.repeat(32),model:'slim'}};
  await fs.mkdir(path.dirname(cacheFile(root,local.skin.hash)),{recursive:true});await fs.writeFile(cacheFile(root,local.skin.hash),alex);
  const original=JSON.stringify(local);
  const result=await appearance(root,local,()=>{throw Error('Local skin cannot contact a skin station or Mojang');},{force:true});
  assert.equal(result.skin,uri(alex));assert.equal(result.model,'slim');assert.equal(result.default,false);assert.equal(result.cape,null);assert.equal(JSON.stringify(local),original);
  assert.deepEqual(await cachedAppearance(root,local),result);
  local.skin={...local.skin,hash:sha(steve),model:'default',sourceName:'replacement.png'};await fs.writeFile(cacheFile(root,local.skin.hash),steve);
  const replacement=await appearance(root,local,()=>{throw Error('No network');});assert.equal(replacement.skin,uri(steve));assert.equal(replacement.model,'default');
  await fs.unlink(cacheFile(root,local.skin.hash));assert.equal(await cachedAppearance(root,local),null);
  const fallback=await appearance(root,local,()=>{throw Error('No network even for missing imports');});assert.equal(fallback.default,true);assert.ok(fallback.warning);
});
test('failed skin-site refresh preserves cached textures while a successful empty profile resets them',async t=>{
  const {root,steve}=await fixture(t),cape=Buffer.from(steve);cape.writeUInt32BE(32,20);
  const first=await appearance(root,role,server(steve,{cape}),{force:true});
  const disconnected=await appearance(root,role,()=>{throw Error('offline');},{force:true});
  assert.equal(disconnected.skin,first.skin);assert.equal(disconnected.cape,first.cape);
  const empty=await appearance(root,role,async url=>new Response(JSON.stringify(url===role.server.url?{skinDomains:['textures.skin.example']}:{properties:[]})),{force:true});
  assert.equal(empty.default,true);assert.equal(empty.cape,null);assert.equal(empty.name,'Steve');assert.equal(empty.skin,png(steve));
});
