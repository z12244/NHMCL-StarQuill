const test=require('node:test'),assert=require('node:assert/strict');
const {checkRelease}=require('../src/shared/launcher-updates.cjs');
const current='1.0.4-beta.0';
const check=rows=>checkRelease(async()=>Response.json(rows),current);
test('only newer published launcher releases are offered',async()=>{
  const existing=['old-versions','stable-1.0.3','beta-1.0.4'].map(tag_name=>({tag_name}));
  assert.equal(await check(existing),null);
  assert.equal((await check([{tag_name:'stable-1.0.4'}])).tag,'stable-1.0.4');
  assert.deepEqual(await check([...existing,{tag_name:'beta-1.0.10',body:' 更新内容 '},{tag_name:'stable-2.0.0',draft:true},{tag_name:'stable-1.0.5'}]),{tag:'beta-1.0.10',notes:'更新内容'});
});
test('offline, API errors and malformed responses stay silent',async()=>{
  for(const fetcher of [async()=>{throw Error('offline')},async()=>new Response('',{status:403}),async()=>new Response('invalid')]){
    assert.equal(await checkRelease(fetcher,current),null);
  }
});
