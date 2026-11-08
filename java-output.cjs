const {isUtf8} = require('node:buffer');

function pipeJavaLog(stream, encoding, emit) {
  let decoder;
  try { decoder=new TextDecoder((encoding||'UTF-8').replace(/^Cp(125\d)$/i,'windows-$1')); }
  catch { decoder=new TextDecoder(); }
  if(decoder.encoding==='utf-8') {
    stream.setEncoding('utf8');
    stream.on('data',emit);
    return;
  }
  // Mods can emit UTF-8 while the native Java launcher writes GBK.
  // Wait for a complete line so multibyte characters may cross pipe chunks.
  const decode=bytes=>isUtf8(bytes)?bytes.toString('utf8'):decoder.decode(bytes);
  let tail=Buffer.alloc(0);
  stream.on('data',chunk=>{
    const bytes=tail.length?Buffer.concat([tail,chunk]):chunk;
    let start=0;
    const lines=[];
    for(let end=bytes.indexOf(10);end!==-1;end=bytes.indexOf(10,start)) {
      lines.push(decode(bytes.subarray(start,end+1)));
      start=end+1;
    }
    tail=bytes.subarray(start);
    if(tail.length>1024*1024){lines.push(decode(tail));tail=Buffer.alloc(0);}
    if(lines.length)emit(lines.join(''));
  });
  stream.once('end',()=>{if(tail.length)emit(decode(tail));});
}
module.exports={pipeJavaLog};
