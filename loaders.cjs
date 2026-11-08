const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {MinecraftFolder}=require('@xmcl/core');const xmcl=require('@xmcl/installer');
const {pipeJavaLog}=require('./java-output.cjs');
const {Downloads,sources,hashFile,pool}=require('./downloads.cjs');const {layout,writeJSON,readJSON,resolveVersion,versionName,under}=require('./storage.cjs');
const {Game}=require('./game.cjs');const {requiredJava}=require('./java.cjs');const {json,response,exists,httpsURL,noLinks}=require('./content-utils.cjs');
function neoGame(v){const p=v.replace(/-.*$/,'').split('.');if(Number(p[0])>=26)return p.slice(0,3).join('.').replace(/\.0$/,'');return '1.'+p[0]+(p[1]==='0'?'':'.'+p[1]);}
async function targetInfo(root,id,isolate=true,advanced){const r=await resolveVersion(root,id);const effective=await require('./instance-config.cjs').instanceOptions(root,id,{isolate,advanced},r.raw);const libs=r.meta.libraries||[],names=libs.map(l=>l.name);let loader=names.some(n=>n.startsWith('net.neoforged:'))?'neoforge':names.some(n=>n.startsWith('net.minecraftforge:forge:'))?'forge':names.some(n=>n.startsWith('net.fabricmc:fabric-loader:'))?'fabric':null;return {id,game:r.raw.starQuill?.game||r.chain[0].id,loader,blockModUpdates:effective.advanced.blockModUpdates,folder:layout(root,id,effective.isolate).game};}
// XMCL writes the unpublished version in staging and resolves Maven artifacts in the real cache.
class InstallFolder extends MinecraftFolder {
 constructor(stageRoot, sharedRoot) {
   super(stageRoot);
   this.sharedRoot = sharedRoot;
 }
 get libraries() { return path.join(this.sharedRoot, 'libraries'); }
 get assets() { return path.join(this.sharedRoot, 'assets'); }
 getPath(first, ...rest) {
   if (first === 'libraries' || first === 'assets') return path.join(this.sharedRoot, first, ...rest);
   return first === undefined ? this.root : super.getPath(first, ...rest);
 }
}
class Loaders{
 constructor(options){Object.assign(this,options);this.fetcher||=fetch;this.mode||='auto';this.onLog||=()=>{};this.onStatus||=()=>{};}
 async list(game,loader,signal){versionName(game);if(!['forge','neoforge','fabric'].includes(loader))throw Error('加载器类型无效');if(loader==='fabric'){const d=new Downloads({root:this.root,mode:this.mode,fetcher:this.fetcher,signal});const rows=await d.json('https://meta.fabricmc.net/v2/versions/loader/'+encodeURIComponent(game));return rows.map(r=>({game,loader,version:r.loader.version,stable:r.loader.stable}));}
 const mirror=`https://bmclapi2.bangbang93.com/${loader}/`+(loader==='forge'?'minecraft/':'list/')+encodeURIComponent(game);
 if(this.mode!=='official')try{const rows=await json(this.fetcher,mirror,signal);return rows.filter(r=>r.mcversion===game&&(loader!=='forge'||r.files?.some(f=>f.category==='installer'&&f.format==='jar'))).map(r=>({game,loader,version:r.version,branch:r.branch,sha1:r.files?.find(f=>f.category==='installer'&&f.format==='jar')?.hash,stable:!/(beta|alpha)/i.test(r.version)})).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));}catch(e){if(signal?.aborted)throw e;this.onLog('加载器镜像列表暂不可用，尝试官方');}
 const url=loader==='forge'?'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml':'https://maven.neoforged.net/releases/net/neoforged/'+(game==='1.20.1'?'forge':'neoforge')+'/maven-metadata.xml';const xml=await(await response(this.fetcher,url,signal)).text();const versions=[...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m=>m[1]);return versions.filter(v=>loader==='forge'||game==='1.20.1'?v.startsWith(game+'-'):neoGame(v)===game).map(v=>({game,loader,version:loader==='forge'||game==='1.20.1'?v.slice(game.length+1):v,stable:!/(beta|alpha)/i.test(v)})).reverse();
 }
 gameEngine(root,version,signal){return new Game({root,sharedRoot:this.root,version,name:'Player',memory:2,isolate:true,source:this.mode,concurrency:this.concurrency||12,fetcher:this.fetcher,getManifest:this.getManifest,signal,onLog:this.onLog,onProgress:p=>this.onStatus(`准备文件 ${p.done}/${p.total} · 复用 ${p.reused}`,p.total?p.done/p.total*100:0)});}
 async createStage(game,id,signal) {
   versionName(id);
   signal?.throwIfAborted();
   const target=layout(this.root,id).version;
   await noLinks(this.root,target);
   if(await exists(target)) throw Error('版本名称已存在，请使用新的名称');
   const base=this.gameEngine(this.root,game,signal);
   this.onStatus('准备原版 '+game);
   const resolved=await base.resolve();
   const java=await this.chooseJava(requiredJava(resolved.meta));
   await base.prepare();
   const stage=path.resolve(this.root,'.starquill','install',crypto.randomUUID());
   await noLinks(this.root,stage);
   await fs.mkdir(stage,{recursive:true});
   try {
     for(const entry of resolved.chain) {
       const src=layout(this.root,entry.id),dest=layout(stage,entry.id);
       await writeJSON(dest.json,entry.raw);
       if(await exists(src.jar)) {
         try { await fs.link(src.jar,dest.jar); } catch { await fs.copyFile(src.jar,dest.jar); }
       }
     }
     return {root:stage,game,id,java};
   } catch(error) { await this.cleanStage(stage); throw error; }
 }
 async cleanStage(stage) {
   const base=path.resolve(this.root,'.starquill','install');
   if(path.dirname(path.resolve(stage))!==base) throw Error('临时安装目录无效');
   await noLinks(this.root,stage);
   await fs.rm(stage,{recursive:true,force:true});
 }
 async installInStage(stage,spec,signal){const {root,id,game,java}=stage;const download=await new Downloads({root:this.root,mode:this.mode,fetcher:this.fetcher,signal,concurrency:this.concurrency||12,onLog:this.onLog,onProgress:p=>this.onStatus(`加载器文件 ${p.done}/${p.total}`,p.total?p.done/p.total*100:0)}).init();if(!spec.loader){await writeJSON(layout(root,id).json,{id,inheritsFrom:game,starQuill:{game,isolate:true}});return;}
 versionName(spec.version);if(spec.loader==='fabric'){this.onStatus('安装 Fabric '+spec.version);const profile=await download.json(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(game)}/${encodeURIComponent(spec.version)}/profile/json`);if(profile.inheritsFrom!==game||!profile.mainClass)throw Error('Fabric 返回了不匹配的游戏版本');profile.id=id;profile.starQuill={game,loader:'fabric',loaderVersion:spec.version,isolate:true};await writeJSON(layout(root,id).json,profile);return;}
 if(!['forge','neoforge'].includes(spec.loader))throw Error('整合包使用了暂不支持的加载器：'+spec.loader);
 const neo=spec.loader==='neoforge',project=neo&&game!=='1.20.1'?'neoforge':'forge',artifactVersion=neo&&project==='neoforge'?spec.version:xmcl.resolveForgeArtifactVersion(game,spec.version)+(spec.branch?'-'+spec.branch:'');const relative=`net/${neo?'neoforged':'minecraftforge'}/${project}/${artifactVersion}/${project}-${artifactVersion}-installer.jar`,url=(neo?'https://maven.neoforged.net/releases/':'https://maven.minecraftforge.net/')+relative;
 let sha1=spec.sha1;if(!sha1)for(const candidate of sources(url+'.sha1',this.mode)){try{const text=await(await response(this.fetcher,candidate,signal)).text();sha1=/^[a-f0-9]{40}/i.exec(text.trim())?.[0];if(sha1)break;}catch(e){if(signal?.aborted)throw e;}}
 if(!sha1)throw Error('无法获取加载器安装包校验值，请稍后重试或切换下载源');
 const minecraft=new InstallFolder(root,this.root);
 const installer={path:under(minecraft.libraries,relative),urls:[url],checksum:{algorithm:'sha1',value:sha1},validator:'zip'};
 const workflow=xmcl.createModernForgeInstallWorkflow({id:'starquill-loader',minecraft,minecraftVersion:game,installer,artifactVersion,java:java.path,side:'client',installOptions:{versionId:id,inheritsFrom:game,java:java.path,signal}});
 const guard=file=>{
   for(const directory of [root,minecraft.libraries]) {
     const rel=path.relative(directory,path.resolve(file));
     if(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel))return;
   }
   throw Error('加载器安装路径越出版本或共享依赖目录');
 };
 const runtime=xmcl.createNodeInstallRuntime({signal,checksum:hashFile,download:async files=>{await pool(files,this.concurrency||12,async f=>{guard(f.path);const urls=f.urls.map(u=>httpsURL(u.replace(/^http:/,'https:')));await download.ensure({file:f.path,url:urls[0],urls,hashes:f.checksum?{[f.checksum.algorithm]:f.checksum.value}:undefined,size:f.size>=0?f.size:undefined});download.stats.done++;download.stats.total=files.length;download.progress();});},runJava:command=>new Promise((resolve,reject)=>{this.onStatus('执行 '+spec.loader+' 安装处理器');guard(command.cwd||root);const p=spawn(java.path,command.args,{cwd:command.cwd||root,windowsHide:true,signal});let error='';pipeJavaLog(p.stdout,java.stdoutEncoding,this.onLog);pipeJavaLog(p.stderr,java.stderrEncoding,text=>{error=(error+text).slice(-4000);this.onLog(text);});p.once('error',reject);p.once('close',code=>code===0?resolve():reject(Error('加载器处理器失败，退出码 '+code+'\n'+error)));})});
 const materialize=runtime.materialize;runtime.materialize=async operations=>{for(const op of operations){guard(op.path);if(op.source)guard(op.source);if(op.archive)guard(op.archive);}return materialize(operations);};const remove=runtime.remove;runtime.remove=paths=>{paths.forEach(guard);return remove(paths);};
 await xmcl.executeInstallWorkflow(workflow,runtime,{signal,attempts:1,onEvent:e=>{if(e.type==='task-start')this.onStatus('安装 '+spec.loader+' · '+e.task.id.split(':').at(-1));}});await download.flush();const file=layout(root,id).json,meta=await readJSON(file);meta.starQuill={game,loader:spec.loader,loaderVersion:spec.version,isolate:true};await writeJSON(file,meta);
 }
 async finish(stage,signal){await this.gameEngine(stage.root,stage.id,signal).prepare();if(signal?.aborted)throw Error('已取消安装');const dest=layout(this.root,stage.id).version;if(await exists(dest))throw Error('目标版本已存在，未覆盖');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(layout(stage.root,stage.id).version,dest);this.onLog('安装完成：'+stage.id);return stage.id;}
 async install(spec,id,signal){const stage=await this.createStage(spec.game,id,signal);try{await this.installInStage(stage,spec,signal);return await this.finish(stage,signal);}finally{await this.cleanStage(stage.root);}}
}
module.exports={Loaders,targetInfo,neoGame};
