const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {pool,hashFile,expectedHash}=require('./downloads.cjs');
const {layout,versionName,under,writeJSON,resolveVersion}=require('./storage.cjs');
const {embedPack,hmclIsolation}=require('./pack-layout.cjs');
const {cacheFile}=require('./content-install.cjs');
const {inspectPackArchive,composePatches}=require('./pack-formats.cjs');
const {extractArchiveFiles}=require('./pack-archive.cjs');
const {exists,relativeFile,noLinks}=require('./content-utils.cjs');
const {memoryLimit,describeJava}=require('./java.cjs');
class Modpacks{
 constructor({resources,installer,loaders}){Object.assign(this,{resources,installer,loaders});}
 async plan(file,id,signal){
  const pack=await inspectPackArchive(file,{signal});
  if(!id?.trim()){let base=String(pack.name||path.basename(file,path.extname(file))).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').trim().replace(/[. ]+$/,'').slice(0,100).replace(/[. ]+$/,'')||'整合包';try{versionName(base);}catch{base='整合包-'+base;}id=base;let n=2;while(await exists(layout(this.installer.root,id).version))id=base+' ('+(n++)+')';}
  versionName(id);if(await exists(layout(this.installer.root,id).version))throw Error('版本名称已存在，请更换名称');versionName(pack.game);
  let files=pack.files;
  if(pack.format==='curseforge'){
   const {localPinnedResolver,publishedPinnedFile}=require('./pinned-content.cjs');
   const local=localPinnedResolver(this.installer.root);
   const records=pack.files.length>1?await this.resources.pinMetadata?.(pack.files,signal):null;
   files=await poolMap(pack.files,6,async f=>{
    let project,item;
    try{
     project=await this.resources.project('curseforge',f.projectId,signal,records?.projects.get(f.projectId));
     item=await this.resources.file(project,f.versionId,{game:pack.game,loader:pack.loader,pinned:true,allowManualPin:true},signal,records?.files.get(f.versionId));
    }catch(e){
     signal?.throwIfAborted();
     if(!/HTTP (?:401|403|404|410|429|5\d\d)\b|fetch failed|net::ERR_|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(e.message)&&e.name!=='TimeoutError')throw e;
     const match=await local(f,project,signal);if(match)return match;
     try {
       const published=await publishedPinnedFile(this.resources,f,pack,project,signal);
       if(published)return published;
     } catch(other) {
       signal?.throwIfAborted();
       if(other.name==='AbortError')throw other;
     }
     throw Error('无法获取整合包指定文件：'+(project?.title||'CurseForge 资源')+'（项目 '+f.projectId+'，文件 '+f.versionId+'）。'+e.message+'。没有找到可校验的本地副本。可导入作者提供的完整客户端包，或待资源恢复后重试。',{cause:e});
    }
    const folder=({mod:'mods',resourcepack:'resourcepacks',shader:'shaderpacks'})[project.kind];
    if(!folder)throw Error('整合包内的资源类型无效');
    versionName(item.original);
    if(!item.url){
     const digest=expectedHash(item);
     if(!digest)throw Error('来源未提供指定文件的校验值：'+item.original);
     const file=cacheFile(this.installer.root,item);
     await noLinks(this.installer.root,file);
     if(await exists(file) && (item.size==null||(await fs.stat(file)).size===item.size) &&
       await hashFile(file,digest.algorithm)===digest.value)item.cached=true;
    }
    return {...item,path:relativeFile(folder+'/'+item.original),filename:item.original,reason:'整合包锁定版本'};
   });
  }
  if(pack.loader==='cleanroom'){
   const defaults=require('./cleanroom-mods.cjs').defaultFiles(pack);
   if(defaults.length){files=[...files,...defaults];pack.cleanroomDefaults=true;}
  }
  const bundledFiles=(pack.gameFiles?.length||0)+(pack.localLibraries?.length||0);
  return {type:'pack',archive:file,archiveHash:await hashFile(file,'sha256'),pack:{...pack,files:undefined},id,files,bundledFiles,target:{game:pack.game,loader:pack.loader},warnings:[...(pack.skippedAddonTools?['已跳过 addons 中的 '+pack.skippedAddonTools+' 个辅助脚本。']:[]),...(pack.optional?[`整合包包含 ${pack.optional} 个可选文件，默认不安装。`]:[]),...(pack.java?['游戏使用 Java '+describeJava(pack.java)+'；自动选择会使用本机兼容的 Java。']:[]),'保留整合包作者指定的文件名，避免破坏配置中的路径引用。']};
 }
 async install(plan,signal){
  if(await hashFile(plan.archive,'sha256')!==plan.archiveHash)throw Error('整合包在生成清单后发生变化，请重新导入');
  const {pack,id}=plan,root=this.installer.root,download=await this.installer.downloader(signal).init();
  for(const file of plan.files)if(!file.url&&!await download.valid({...file,file:cacheFile(root,file)}))throw Error('请先完成清单中的手动下载：'+file.original);
  await download.all(plan.files.map(file=>({...file,file:cacheFile(root,file)})));
  const protectedFiles=new Set([id+'.jar',id+'.json'].map(n=>n.toLowerCase()));
  for(const file of [...plan.files,...(pack.gameFiles||[])])if(protectedFiles.has(file.path.toLowerCase().split('/')[0]))throw Error('整合包试图覆盖版本配置或客户端');
  // Legacy Forge installs without Java processors. Installation may use a
  // modern JVM; a Java 8 game's published launch requirement remains exact 8.
  const installationJava=pack.format==='gtnh-client'?{min:8,max:26,preferred:21}:pack.java;
  const stage=await this.loaders.createStage(pack.game,id,signal,installationJava,{pack:true});
  try{
   // A pack may itself be named "1.20.1". Keep its loader profile separate from
   // the staging base until inheritance has been fully resolved.
   const build=id.toLowerCase()===pack.game.toLowerCase()?{...stage,id:'starquill-loader-'+crypto.randomUUID()}:stage;
   let profile;
   if(pack.profile)profile=structuredClone(pack.profile);
   else{
    const vanilla=pack.patchBase==='vanilla';
    if(!vanilla)await this.loaders.installInStage(build,{game:pack.game,loader:pack.loader,version:pack.version,branch:pack.branch},signal);
    if(pack.profilePatches?.length)profile=composePatches((await resolveVersion(stage.root,vanilla?pack.game:build.id)).meta,pack.profilePatches,pack.java?.preferred).profile;
    else if(vanilla)throw Error('整合包缺少启动补丁，请使用完整客户端实例包');
   }
   const target=layout(stage.root,id).game;await fs.mkdir(target,{recursive:true});
   if(profile){
    profile.id=build.id;delete profile.inheritsFrom;delete profile.jar;
    profile.starQuill={...profile.starQuill,game:pack.game,loader:pack.loader,loaderVersion:pack.version,isolate:true,...(pack.java?{java:pack.java}:{})};
    await this.materializeLibraries(plan,stage,profile,signal);await writeJSON(layout(stage.root,build.id).json,profile);
   }else if(pack.java){const file=layout(stage.root,build.id).json,meta=JSON.parse(await fs.readFile(file,'utf8'));meta.starQuill={...meta.starQuill,java:pack.java};await writeJSON(file,meta);}
   await embedPack(stage.root,id,pack.game,{sourceId:build.id,allowDownload:true});
   for(const file of plan.files){signal?.throwIfAborted();const dest=under(target,relativeFile(file.path));await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(cacheFile(root,file),dest);}
   const selections=pack.gameFiles||[];
   let lastProgress=0;
   await extractArchiveFiles(plan.archive,selections,target,{signal,overwrite:true,onProgress:p=>{const now=Date.now();if(now-lastProgress>120||p.filesDone===p.totalFiles){lastProgress=now;this.loaders.onStatus?.(`解压整合包 ${p.filesDone}/${p.totalFiles}`,p.totalBytes?p.bytesDone/p.totalBytes*100:0);}}});
   if(pack.memory)await writeJSON(path.join(target,'.starquill-settings.json'),{schema:1,memory:Math.min(memoryLimit(),Math.max(1,pack.memory)),javaMode:'auto'});
   const records=plan.files.filter(f=>f.project).map(f=>({source:f.project.source,projectId:f.project.id,versionId:f.versionId,original:f.original,path:f.path,hashes:f.hashes,size:f.size}));
   await writeJSON(path.join(target,'.starquill-content.json'),{schema:1,files:records});
   await writeJSON(path.join(target,'starquill-pack.json'),{name:pack.name,format:pack.format,game:pack.game,loader:pack.loader,loaderVersion:pack.version,java:pack.java,...(pack.cleanroomDefaults?{cleanroomDefaults:true}:{}),icon:require('./resource-icons.cjs').iconURL(pack.icon),installedAt:new Date().toISOString()});
   await hmclIsolation(stage.root,id);
   return await this.loaders.finish(stage,signal);
  }finally{await this.loaders.cleanStage(stage.root);}
 }
 async materializeLibraries(plan,stage,profile,signal){
  const local=plan.pack.localLibraries||[];if(!local.length)return;const temp=path.join(stage.root,'pack-libraries');
  await extractArchiveFiles(plan.archive,local.map((f,i)=>({entry:f.entry,path:i+'.jar'})),temp,{signal});
  for(const [index,item] of local.entries()){
   signal?.throwIfAborted();const source=path.join(temp,index+'.jar'),sha1=await hashFile(source,'sha1'),size=(await fs.stat(source)).size;
   for(const algorithm of ['sha1','sha256'])if(item.hashes?.[algorithm]&&item.hashes[algorithm].toLowerCase()!==(algorithm==='sha1'?sha1:await hashFile(source,algorithm)))throw Error('整合包本地依赖校验失败：'+item.entry);
   let relative=relativeFile(item.path),dest=under(path.join(this.installer.root,'libraries'),relative);await noLinks(this.installer.root,dest);
   if(await exists(dest)&&await hashFile(dest,'sha1')!==sha1){relative=`starquill-bundled/${plan.archiveHash.slice(0,16)}/${index}-${path.posix.basename(relative)}`;dest=under(path.join(this.installer.root,'libraries'),relative);await noLinks(this.installer.root,dest);}
   await fs.mkdir(path.dirname(dest),{recursive:true});if(!await exists(dest)||await hashFile(dest,'sha1')!==sha1){const pending=dest+'.'+crypto.randomUUID()+'.tmp';try{await fs.copyFile(source,pending);await fs.rename(pending,dest);}finally{await fs.rm(pending,{force:true});}}
   let matched=false;for(const lib of profile.libraries||[]){for(const artifact of [lib.downloads?.artifact,...Object.values(lib.downloads?.classifiers||{})])if(artifact?.path===item.path){Object.assign(artifact,{path:relative,sha1,size});matched=true;}}
   if(!matched)throw Error('启动配置没有引用包内依赖：'+item.entry);
  }
 }
}
async function poolMap(items,n,fn){const result=new Array(items.length);await pool(items.map((value,index)=>({value,index})),n,async({value,index})=>result[index]=await fn(value));return result;}
module.exports={Modpacks};
