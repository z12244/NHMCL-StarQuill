const {test}=require('node:test'),assert=require('node:assert/strict');
const {DeviceLogin}=require('../src/device-login.cjs');
const device={user_code:'CODE1234',device_code:'PRIVATE_DEVICE',verification_uri:'https://www.microsoft.com/link',expiresAt:900000};
test('click presentation copies user code then opens the validated default browser URL',async()=>{
  const calls=[],d=new DeviceLogin({clipboard:{writeText:text=>calls.push(['copy',text])},openExternal:async url=>calls.push(['open',url]),now:()=>0});
  const result=await d.start(device);assert.deepEqual(calls,[['copy','CODE1234'],['open','https://www.microsoft.com/link']]);assert.equal(result.copied,true);assert.equal(result.browserOpened,true);assert.ok(!JSON.stringify(result).includes('PRIVATE_DEVICE'));
  d.copy();await d.open();assert.equal(calls.length,4);d.clear();assert.throws(()=>d.copy(),/已结束/);assert.throws(()=>d.open(),/已结束/);
});
test('browser and clipboard failures preserve a usable code for manual login',async()=>{
  const d=new DeviceLogin({clipboard:{writeText:()=>{throw Error('unavailable');}},openExternal:async()=>{throw Error('no browser');},now:()=>0});
  const result=await d.start(device);assert.equal(result.userCode,'CODE1234');assert.equal(result.copied,false);assert.equal(result.browserOpened,false);
});
test('expired codes and arbitrary external URLs cannot be copied or opened',async()=>{
  let now=0,opened=0;const d=new DeviceLogin({clipboard:{writeText:()=>{}},openExternal:async()=>opened++,now:()=>now});
  for(const url of ['http://www.microsoft.com/link','https://www.microsoft.com.evil.test/','https://user@www.microsoft.com/link','file:///C:/test.exe'])await assert.rejects(d.start({...device,verification_uri:url}));
  assert.equal(opened,0);await d.start(device);now=device.expiresAt;assert.throws(()=>d.copy(),/过期/);assert.throws(()=>d.open(),/过期/);
});
