const fs = require('node:fs/promises');
const {createReadStream, createWriteStream} = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {once} = require('node:events');

const MIRROR = 'https://bmclapi2.bangbang93.com';
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
function mirrorURL(url) {
  const u = new URL(url);
  if (['piston-meta.mojang.com','launchermeta.mojang.com','piston-data.mojang.com','launcher.mojang.com'].includes(u.hostname)) return MIRROR + u.pathname + u.search;
  if (u.hostname === 'resources.download.minecraft.net') return MIRROR + '/assets' + u.pathname;
  if (u.hostname === 'libraries.minecraft.net') return MIRROR + '/maven' + u.pathname;
  if (u.hostname === 'meta.fabricmc.net') return MIRROR + '/fabric-meta' + u.pathname;
  if (u.hostname === 'maven.fabricmc.net') return MIRROR + '/maven' + u.pathname;
  if (['maven.minecraftforge.net','files.minecraftforge.net','maven.neoforged.net'].includes(u.hostname)) return MIRROR + '/maven' + u.pathname.replace(/^\/maven\//,'/').replace(/^\/releases\//,'/');
  return url;
}
function sources(url, mode='auto') {
  const mirror = mirrorURL(url);
  return [...new Set(mode === 'official' ? [url] : [mirror,url])];
}
async function hashFile(file, algorithm='sha1') {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function pool(items, limit, action) {
  let next = 0, failure;
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, async()=>{
    while (!failure && next < items.length) {const index=next++;try {await action(items[index],index);} catch(e) {failure ||= e;}}
  }));
  if (failure) throw failure;
}
class Downloads {
  constructor({root,mode='auto',concurrency=16,signal,onProgress=()=>{},onLog=()=>{},fetcher=fetch,sourceResolver=sources,timeout=20000}={}) {
    Object.assign(this,{root,mode,concurrency,signal,onProgress,onLog,fetcher,sourceResolver,timeout});
    this.cache={};this.stats={reused:0,downloaded:0,bytes:0,total:0,done:0};this.started=Date.now();this.last=0;this.mirrorFailures=0;this.mirrorBlockedUntil=0;
  }
  async init() {this.cacheFile=path.join(this.root,'.starquill','verified-files.json');try{this.cache=JSON.parse(await fs.readFile(this.cacheFile,'utf8'));}catch{}return this;}
  async flush() {if(!this.cacheFile)return;await fs.mkdir(path.dirname(this.cacheFile),{recursive:true});const temp=this.cacheFile+'.tmp';await fs.writeFile(temp,JSON.stringify(this.cache));await fs.rename(temp,this.cacheFile);}
  checkAbort(){if(this.signal?.aborted)throw Error('已取消下载');}
  progress(force=false) {const now=Date.now();if(force||now-this.last>200){this.last=now;this.onProgress({...this.stats,speed:this.stats.bytes/Math.max(1,(now-this.started)/1000)});}}
  async valid(item) {
    try {const stat=await fs.stat(item.file);if(!stat.isFile()||!stat.size&&item.size!==0)return false;if(item.size!=null&&stat.size!==item.size)return false;
      const hash=expectedHash(item);if(!hash)return true;
      const key=path.relative(this.root,item.file),cached=this.cache[key];
      if((cached?.hash===hash.value&&cached.algorithm===hash.algorithm||hash.algorithm==='sha1'&&cached?.sha1===hash.value)&&cached.size===stat.size&&cached.mtime===stat.mtimeMs)return true;
      if(await hashFile(item.file,hash.algorithm)!==hash.value)return false;
      this.cache[key]={hash:hash.value,algorithm:hash.algorithm,size:stat.size,mtime:stat.mtimeMs};return true;
    } catch{return false;}
  }
  async json(url,sha1) {
    let last;
    for(const source of this.sourceResolver(url,this.mode)) {
      this.checkAbort();const timeout=AbortSignal.timeout(this.timeout);
      try {const r=await this.fetcher(source,{signal:this.signal?AbortSignal.any([this.signal,timeout]):timeout});if(!r.ok)throw Error('HTTP '+r.status);
        const body=Buffer.from(await r.arrayBuffer());if(sha1&&crypto.createHash('sha1').update(body).digest('hex')!==sha1)throw Error('JSON 校验失败');return JSON.parse(body.toString('utf8'));
      } catch(e){last=e;this.checkAbort();this.onLog('下载源暂不可用，尝试下一来源：'+new URL(source).hostname);}
    }
    throw Error('无法获取版本信息：'+last?.message);
  }
  async ensure(item) {
    this.checkAbort();if(await this.valid(item)){this.stats.reused++;return;}
    if(!item.url)throw Error('缺少本地文件，且版本配置没有下载地址：'+path.relative(this.root,item.file));
    await fs.mkdir(path.dirname(item.file),{recursive:true});
    let last;
    for(const url of [...new Set((item.urls||[item.url]).flatMap(u=>this.sourceResolver(u,this.mode)))]) for(let attempt=0;attempt<2;attempt++){
      const isMirror=url.startsWith(MIRROR+'/');if(this.mode==='auto'&&isMirror&&Date.now()<this.mirrorBlockedUntil)break;
      this.checkAbort();try {await this.transfer(item,url);this.stats.downloaded++;return;}catch(e){last=e;this.checkAbort();this.onLog('重试 '+path.basename(item.file)+' · '+new URL(url).hostname+' · '+(e.cause?.message||e.message));
        if(isMirror&&!/HTTP (400|403|404|410)/.test(e.message)&&++this.mirrorFailures>=2){this.mirrorBlockedUntil=Date.now()+60000;if(this.mode==='auto')this.onLog('镜像节点连接不稳定，后续下载暂时使用官方源');}
        if(/HTTP (400|403|404|410)/.test(e.message)||(this.mode==='auto'&&isMirror))break;}
    }
    throw Error('下载失败：'+path.basename(item.file)+'（'+last?.message+'）');
  }
  async transfer(item,url) {
    const part=item.file+'.starquill.part',info=part+'.json';let offset=0;
    const hash=expectedHash(item),identity=JSON.stringify({url:item.url,sha1:item.sha1,hashes:item.hashes,size:item.size});
    try {if(await fs.readFile(info,'utf8')===identity)offset=(await fs.stat(part)).size;}catch{}
    if(item.size&&offset>=item.size){if(offset===item.size&&hash&&await hashFile(part,hash.algorithm)===hash.value){await fs.rename(part,item.file);await fs.rm(info,{force:true});await this.valid(item);return;}offset=0;}
    await fs.writeFile(info,identity);
    const controller=new AbortController();let timer;
    const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(Error('下载连接超时')),this.timeout);};touch();
    const signal=this.signal?AbortSignal.any([this.signal,controller.signal]):controller.signal;
    let stream;
    try {
      const r=await this.fetcher(url,{signal,headers:offset?{Range:`bytes=${offset}-`,'Accept-Encoding':'identity'}:{'Accept-Encoding':'identity'}});
      if(!r.ok)throw Error('HTTP '+r.status);
      if(offset&&r.status===206){const m=/^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(r.headers.get('content-range')||'');if(!m||Number(m[1])!==offset)throw Error('断点响应范围无效');}
      else if(r.status===200)offset=0;else if(r.status===206)throw Error('意外的分段响应');
      stream=createWriteStream(part,{flags:offset?'a':'w'});let streamError;
      stream.on('error',e=>{streamError=e;controller.abort(e);});
      for await(const chunk of r.body){this.checkAbort();touch();if(streamError)throw streamError;if(!stream.write(chunk))await once(stream,'drain');this.stats.bytes+=chunk.length;this.progress();}
      stream.end();await once(stream,'finish');stream=null;
      const stat=await fs.stat(part);
      if(item.size!=null&&stat.size!==item.size)throw Error('文件长度不完整');
      if(hash&&await hashFile(part,hash.algorithm)!==hash.value){await fs.rm(part,{force:true});throw Error(hash.algorithm.toUpperCase().replace(/^SHA/,'SHA-')+' 校验失败');}
      if(!stat.size&&item.size!==0)throw Error('空文件');
      await fs.rename(part,item.file);await fs.rm(info,{force:true});await this.valid(item);
    }finally{clearTimeout(timer);if(stream){stream.destroy();await once(stream,'close').catch(()=>{});}}
  }
  async all(items) {
    const unique=[...new Map(items.map(i=>[path.resolve(i.file),i])).values()];this.stats.total+=unique.length;
    await pool(unique,this.concurrency,async item=>{await this.ensure(item);this.stats.done++;this.progress();});this.progress(true);await this.flush();
  }
}
function expectedHash(item){for(const algorithm of ['sha512','sha256','sha1','md5']){const value=item.hashes?.[algorithm]||(algorithm==='sha1'?item.sha1:undefined);if(value){if(!new RegExp('^[a-f0-9]{'+({sha512:128,sha256:64,sha1:40,md5:32}[algorithm])+'}$','i').test(value))throw Error('文件校验值无效');return {algorithm,value:value.toLowerCase()};}}return null;}
module.exports={Downloads,MANIFEST,MIRROR,mirrorURL,sources,hashFile,pool,expectedHash};
