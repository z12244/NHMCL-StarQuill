const test=require('node:test'),assert=require('node:assert/strict');
const {installerSha1}=require('../loaders.cjs');
const url='https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.266/neoforge-21.1.266-installer.jar';
const hash='0123456789abcdef0123456789abcdef01234567';
test('missing Maven sidecar uses the checksum on the exact mirror artifact before following its redirect',async()=>{
 const calls=[];const fetcher=async(target,opts)=>{calls.push({target,opts});return target.endsWith('.sha1')?new Response(null,{status:404}):new Response(null,{status:302,headers:{'x-bmclapi-hash':hash,location:'https://cdn.example.org/file'}});};
 assert.equal(await installerSha1(url,null,'auto',fetcher),hash);assert.equal(calls.length,2);assert.equal(calls[0].target,calls[1].target+'.sha1');assert.equal(new URL(calls[1].target).origin,'https://bmclapi2.bangbang93.com');assert.equal(calls[1].opts.method,'HEAD');assert.equal(calls[1].opts.redirect,'manual');
});
test('rejects a truncated SHA-256, weak headers and error-page headers; honors official source and cancellation',async()=>{
 for(const [status,digest] of [[302,'a'.repeat(32)],[403,hash]])await assert.rejects(installerSha1(url,'','auto',async(target)=>target.endsWith('.sha1')?new Response('f'.repeat(64)):new Response(null,{status,headers:{'x-bmclapi-hash':digest}})),/校验值/);
 assert.equal(await installerSha1(url,'','official',async target=>{assert.equal(target,url+'.sha1');return new Response(hash+'  installer.jar');}),hash);
 await assert.rejects(installerSha1(url,hash,'auto',()=>assert.fail(),AbortSignal.abort()),{name:'AbortError'});
});
