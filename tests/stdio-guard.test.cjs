const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {guard}=require('../src/stdio-guard.cjs');
test('closed output pipes do not crash on synchronous writes or emitted errors',async()=>{
  const stream=new EventEmitter();stream.write=()=>{throw Object.assign(Error('broken pipe'),{code:'EPIPE'});};
  guard(stream);guard(stream);assert.equal(stream.listenerCount('error'),1);
  assert.equal(stream.write('warning'),false);
  const callbackError=await new Promise(resolve=>stream.write('warning',resolve));assert.equal(callbackError.code,'EPIPE');
  assert.doesNotThrow(()=>stream.emit('error',Object.assign(Error('pipe'),{code:'EPIPE'})));
  assert.doesNotThrow(()=>stream.emit('error',Object.assign(Error('closed'),{code:'ERR_STREAM_DESTROYED'})));
});
test('normal writes and unrelated failures retain their original behavior',()=>{
  const stream=new EventEmitter();let written='';stream.write=s=>{written+=s;return true;};guard(stream);assert.equal(stream.write('hello'),true);assert.equal(written,'hello');
  const error=Object.assign(Error('disk full'),{code:'ENOSPC'});assert.throws(()=>stream.emit('error',error),e=>e===error);
  const other=new EventEmitter();other.write=()=>{throw error;};guard(other);assert.throws(()=>other.write('x'),e=>e===error);
});
