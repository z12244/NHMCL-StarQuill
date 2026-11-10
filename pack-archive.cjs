const native=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {Transform,Writable,PassThrough}=require('node:stream'),{pipeline}=require('node:stream/promises'),yauzl=require('yauzl');
const {relativeFile,noLinks}=require('./content-utils.cjs');
const DEFAULTS={maxFiles:100000,maxTotal:16*1024**3,maxFile:512*1024**2};
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes,previous=0){if(typeof zlib.crc32==='function')return zlib.crc32(bytes,previous)>>>0;let c=(previous^0xffffffff)>>>0;for(const byte of bytes)c=CRC_TABLE[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function canceled(signal){const error=new Error('已取消整合包操作',{cause:signal?.reason});error.name='AbortError';return error;}
function abort(signal){if(signal?.aborted)throw canceled(signal);}
function positive(value,defaultValue,name){value??=defaultValue;if(!Number.isSafeInteger(value)||value<1)throw Error('整合包限制无效：'+name);return value;}
function limits(options){return Object.fromEntries(Object.entries(DEFAULTS).map(([name,value])=>[name,positive(options[name],value,name)]));}
function archiveName(value,directory=false){
  if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/')||value.includes('\0'))throw Error('整合包包含无效文件路径');
  const name=directory?value.replace(/\/$/,''):value;relativeFile(name);return directory?name+'/':name;
}
function validator(options){const cap=limits(options),seen=new Map();let count=0,total=0;
  return entry=>{
    if(++count>cap.maxFiles)throw Error('整合包文件数量超过限制');
    const type=(entry.externalFileAttributes>>>16)&0xf000;
    if(type&&type!==0x8000&&type!==0x4000)throw Error('整合包不能包含符号链接或特殊文件');
    const directory=entry.fileName.endsWith('/')||type===0x4000,name=archiveName(entry.fileName,directory),plain=directory?name.slice(0,-1):name;
    for(const n of [entry.uncompressedSize,entry.compressedSize])if(!Number.isSafeInteger(n)||n<0)throw Error('整合包文件长度无效');
    if(entry.uncompressedSize>cap.maxFile)throw Error('整合包单个文件超过限制：'+name);
    if(directory&&entry.uncompressedSize)throw Error('整合包目录含有无效数据：'+name);
    if(!directory){total+=entry.uncompressedSize;if(!Number.isSafeInteger(total)||total>cap.maxTotal)throw Error('整合包解压大小超过限制');}
    const parts=plain.toLowerCase().split('/');
    for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(seen.get(parent)==='file')throw Error('整合包文件与目录路径冲突：'+name);seen.set(parent,'directory');}
    const key=parts.join('/'),old=seen.get(key);
    if(!directory&&old||directory&&old==='file')throw Error('整合包包含重复文件或路径冲突：'+name);
    seen.set(key,directory?'directory':'file');
    return {name,directory,size:entry.uncompressedSize,compressedSize:entry.compressedSize,crc32:entry.crc32>>>0};
  };
}
async function visitArchive(file,options,visitor){
  abort(options.signal);const validate=validator(options);
  const zip=await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:true,decodeStrings:true,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value)));
  let active=null,currentStream=null,stopped=false,ended=false;
  return new Promise((resolve,reject)=>{
    const cleanup=()=>options.signal?.removeEventListener('abort',onAbort);
    const fail=error=>{if(stopped)return;stopped=true;cleanup();currentStream?.destroy(error);zip.close();Promise.resolve(active).catch(()=>{}).then(()=>reject(error));};
    const onAbort=()=>fail(canceled(options.signal));
    const stream=entry=>new Promise((resolveStream,rejectStream)=>{
      if(stopped){rejectStream(canceled(options.signal));return;}
      zip.openReadStream(entry,(error,value)=>{
        if(error){rejectStream(error);return;}
        if(stopped){value.destroy();rejectStream(canceled(options.signal));return;}
        // yauzl 2.x replaces destroy() with a legacy implementation which does
        // not emit close. A standard stream boundary lets pipeline settle on
        // cancellation even when the entire compressed file arrived at once.
        const input=new PassThrough({destroy(error,callback){value.unpipe(this);value.destroy();callback(error);}});
        value.once('error',error=>input.destroy(error));value.pipe(input);
        currentStream=input;input.once('close',()=>{if(currentStream===input)currentStream=null;});resolveStream(input);
      });
    });
    zip.on('error',fail);
    zip.on('close',()=>{if(!ended&&!stopped)fail(Error('整合包读取意外结束'));});
    zip.on('entry',entry=>{
      active=(async()=>{abort(options.signal);const info=validate(entry);await visitor(info,()=>stream(entry));abort(options.signal);})();
      active.then(()=>{if(!stopped)zip.readEntry();},fail);
    });
    zip.once('end',()=>{ended=true;if(stopped)return;stopped=true;cleanup();resolve();});
    options.signal?.addEventListener('abort',onAbort,{once:true});
    if(options.signal?.aborted)onAbort();else zip.readEntry();
  });
}
function checkStream(info,onChunk){let count=0,crc=0;return new Transform({transform(chunk,encoding,callback){try{count+=chunk.length;if(count>info.size)throw Error('整合包文件长度校验失败：'+info.name);crc=crc32(chunk,crc);onChunk?.(chunk);callback(null,chunk);}catch(error){callback(error);}},flush(callback){if(count!==info.size)callback(Error('整合包文件长度校验失败：'+info.name));else if(crc!==info.crc32)callback(Error('整合包文件 CRC32 校验失败：'+info.name));else callback();}});}
async function listArchive(file,options={}){const entries=[];await visitArchive(file,options,info=>entries.push(info));return entries;}
async function readArchiveFiles(file,names,options={}){
  const requested=new Set();for(const name of names){requested.add(archiveName(name));if(requested.size>1000)throw Error('读取的整合包清单数量超过限制');}
  const max=positive(options.maxFile,8*1024**2,'maxFile'),maxTotal=positive(options.maxTotalRead,32*1024**2,'maxTotalRead'),result=new Map();let total=0;
  // The small-file limit applies to selected metadata, not unselected mod JARs.
  await visitArchive(file,{...options,maxFile:DEFAULTS.maxFile},async(info,openStream)=>{
    if(info.directory||!requested.has(info.name))return;
    if(info.size>max||total+info.size>maxTotal)throw Error('整合包清单过大：'+info.name);
    const chunks=[],input=await openStream(),check=checkStream(info,chunk=>chunks.push(chunk));
    const sink=new Writable({write(chunk,encoding,callback){callback();}});
    await pipeline(input,check,sink,{signal:options.signal});total+=info.size;result.set(info.name,Buffer.concat(chunks,info.size));
  });return result;
}
async function extractArchiveFiles(file,selections,target,options={}){
  const root=path.resolve(target),selected=new Map(),destinations=new Set();
  for(const selection of selections){
    const entry=archiveName(selection?.entry),relative=archiveName(selection?.path),key=relative.toLowerCase();
    if(selected.has(entry))throw Error('重复的整合包提取条目：'+entry);
    if(!options.overwrite&&destinations.has(key))throw Error('重复的整合包目标路径：'+relative);
    destinations.add(key);selected.set(entry,relative);
  }
  await noLinks(root,root);await fs.mkdir(root,{recursive:true});
  let filesDone=0,bytesDone=0,totalBytes=0,lastProgress=0;
  // Validate every entry before creating files. This also supplies progress totals.
  const entries=await listArchive(file,options),found=new Set();
  for(const info of entries)if(selected.has(info.name)){if(info.directory)throw Error('不能将目录作为整合包文件提取');found.add(info.name);totalBytes+=info.size;}
  for(const name of selected.keys())if(!found.has(name))throw Error('整合包缺少文件：'+name);
  const progress=(relative,force=false)=>{const now=Date.now();if(force||now-lastProgress>=100){lastProgress=now;options.onProgress?.({path:relative,filesDone,totalFiles:selected.size,bytesDone,totalBytes});}};
  await visitArchive(file,options,async(info,openStream)=>{
    const relative=selected.get(info.name);if(!relative)return;
    const dest=path.resolve(root,...relative.split('/')),rel=path.relative(root,dest);
    if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('整合包目标越出版本目录');
    await noLinks(root,dest);await fs.mkdir(path.dirname(dest),{recursive:true});
    const temp=dest+'.starquill-'+crypto.randomBytes(10).toString('hex')+'.part';let handle;
    try{
      abort(options.signal);await noLinks(root,temp);handle=await fs.open(temp,'wx');
      const input=await openStream(),output=handle.createWriteStream({autoClose:true});
      await pipeline(input,checkStream(info,chunk=>{bytesDone+=chunk.length;progress(relative);}),output,{signal:options.signal});
      await handle.close();handle=null;abort(options.signal);await noLinks(root,dest);
      if(options.overwrite)await fs.rename(temp,dest);
      else{try{await fs.link(temp,dest);}catch(error){if(!['EPERM','ENOSYS','EOPNOTSUPP','EXDEV'].includes(error.code))throw error;await fs.copyFile(temp,dest,native.constants.COPYFILE_EXCL);}await fs.unlink(temp);}
      filesDone++;progress(relative,true);
    }finally{if(handle)await handle.close().catch(()=>{});await fs.rm(temp,{force:true});}
  });return {files:filesDone,bytes:bytesDone};
}
module.exports={listArchive,readArchiveFiles,extractArchiveFiles,crc32};
