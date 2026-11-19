// A launcher may outlive the terminal/test runner that created its stdio pipes.
// Electron writes warnings (including safeStorage notices) through these streams.
// Ignore only broken/closed output pipes, never unrelated application exceptions.
const installed=Symbol.for('starquill.stdio.guard');
const closedPipe=error=>error?.code==='EPIPE'||error?.code==='ERR_STREAM_DESTROYED';
function guard(stream){
  if(!stream||stream[installed])return;
  stream[installed]=true;
  stream.on('error',error=>{if(!closedPipe(error))throw error;});
  const write=stream.write;
  stream.write=function(...args){
    try{return write.apply(this,args);}catch(error){
      if(!closedPipe(error))throw error;
      const callback=typeof args.at(-1)==='function'?args.at(-1):null;
      if(callback)queueMicrotask(()=>callback(error));
      return false;
    }
  };
}
function install(){guard(process.stdout);guard(process.stderr);}
module.exports={install,guard,closedPipe};
