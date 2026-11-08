const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {Readable,Writable} = require('node:stream');
const {electronFetch} = require('../electron-fetch.cjs');
const {ContentInstaller} = require('../content-install.cjs');

test('Electron redirect cancellation exposes the CDN location and only the first host receives the key', async () => {
  const calls=[];
  const net = {request(options) {
    const headers={};
    // Electron ends its Writable as soon as the request is handed to
    // Chromium. Network events arrive in a later turn, after Writable.close.
    const request=new Writable({autoDestroy:true,write(_chunk,_encoding,done){done();}});
    request.setHeader=(name,value)=>{headers[name]=value;};
    request.once('close',()=>setImmediate(()=>{
      calls.push({url:options.url,credentials:options.credentials,headers});
      if(calls.length===1){
        request.emit('redirect',302,'GET','https://files.example.net/a.jar',{});
        request.emit('error',new Error('Redirect was cancelled'));
      }else{
        const stream=Object.assign(Readable.from([Buffer.from('jar')]),{statusCode:206,headers:{'content-range':['bytes 0-2/10']}});
        request.emit('response',stream);
      }
    }));
    return request;
  }};
  const installer=new ContentInstaller({root:__dirname,getCurseForgeKey:()=> 'test-only',fetcher:(url,opts)=>electronFetch(net,url,opts)});
  const reply=await installer.downloader().fetchTransfer('https://edge.forgecdn.net/a.jar',undefined,{Range:'bytes=0-2'});
  assert.equal(reply.status,206);
  assert.equal(reply.headers.get('content-range'),'bytes 0-2/10');
  assert.equal(await reply.text(),'jar');
  assert.deepEqual(calls.map(c=>c.headers['x-api-key']),['test-only',undefined]);
  assert.deepEqual(calls.map(c=>c.headers.range),['bytes=0-2','bytes=0-2']);
  assert.ok(calls.every(c=>c.credentials==='omit'));
});

test('cancelling a pending Electron request aborts it and rejects promptly',async()=>{
  const controller=new AbortController(), request=new EventEmitter();
  let aborted=false;
  request.setHeader=()=>{};
  request.end=()=>{};
  request.abort=()=>{aborted=true;request.emit('close');};
  const pending=electronFetch({request:()=>request},'https://example.test/file',{redirect:'manual',signal:controller.signal});
  controller.abort(Error('cancelled'));
  await assert.rejects(pending,/cancelled/);
  assert.ok(aborted);
});
