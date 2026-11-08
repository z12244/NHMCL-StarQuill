const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Zip=require('adm-zip');
const {Downloads,expectedHash,hashFile}=require('./downloads.cjs');const {under,writeJSON,readJSON}=require('./storage.cjs');const {relativeFile,filename,exists,noLinks,httpsURL}=require('./content-utils.cjs');
const folders={mod:'mods',resourcepack:'resourcepacks',shader:'shaderpacks'};
function cacheFile(root,f){const h=expectedHash(f);if(!h)throw Error('资源缺少校验值，无法安全安装：'+f.original);return path.join(root,'.starquill','downloads',h.algorithm+'-'+h.value+path.extname(f.original).toLowerCase());}
const {readModMetadata}=require('./mod-metadata.cjs');
function modIds(file){return readModMetadata(file).ids;}
class ContentInstaller{
 constructor({root,fetcher=fetch,onLog=()=>{},onStatus=()=>{},concurrency=8,getCurseForgeKey=()=>''}){Object.assign(this,{root,fetcher,onLog,onStatus,concurrency,getCurseForgeKey});}
 downloader(signal){
   return new Downloads({root:this.root,fetcher:this.fetcher,mode:'official',signal,concurrency:this.concurrency,onLog:this.onLog,
     sourceResolver:url=>require('./curseforge-access.cjs').downloadSources(url,!!this.getCurseForgeKey()),
     headerResolver:url=>{
       if(new URL(url).origin!=='https://edge.forgecdn.net')return {};
       const key=this.getCurseForgeKey();
       return key?{'x-api-key':key}:{};
     },
     onProgress:p=>this.onStatus(`资源文件 ${p.done}/${p.total} · ${(p.bytes/1024**2).toFixed(1)} MB`,p.total?p.done/p.total*100:0)
   });
 }
 async cached(file,signal){const download=await this.downloader(signal).init(),dest=cacheFile(this.root,file);if(!file.url&&!await download.valid({...file,file:dest}))throw Error('作者未开放自动下载，请从项目页面下载并导入：'+file.project?.title);await download.all([{...file,file:dest}]);return dest;}
 async importManual(file,local){const expected=expectedHash(file);if(!expected||await hashFile(local,expected.algorithm)!==expected.value)throw Error('所选文件与清单校验值不一致，请下载指定版本');if(file.size&&(await fs.stat(local)).size!==file.size)throw Error('文件长度与清单不一致');const dest=cacheFile(this.root,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(local,dest);return true;}
 async install(plan,signal){const target=plan.target.folder;await noLinks(this.root,target);const registryFile=path.join(target,'.starquill-content.json');let registry;try{registry=await readJSON(registryFile);}catch(e){if(e.code!=='ENOENT')throw Error('本地资源记录损坏，请检查 .starquill-content.json');registry={files:[]};}const records=registry.files||[];
 if(plan.target.blockModUpdates){
   for(const f of plan.files){
     if(f.project.kind!=='mod')continue;
     const previous=records.find(r=>r.source===f.project.source&&r.projectId===f.project.id&&existsRecord(target,r));
     if(previous&&String(previous.versionId)!==String(f.versionId))throw Error('此版本已禁止更新模组：'+f.project.title+'。可在版本高级设置中更改。');
   }
 }
 for(const f of plan.files)if(records.some(r=>r.source===f.project.source&&r.projectId===f.project.id&&(r.disabled||r.path.toLowerCase().endsWith('.disabled'))&&existsRecord(target,r)))throw Error('该资源当前已禁用，请先在版本设置中启用或移除，再更新：'+f.project.title);
 for(const conflict of plan.conflicts||[])if(records.some(r=>r.source===conflict.source&&(r.projectId===conflict.projectId||r.versionId===conflict.versionId)&&existsRecord(target,r)))throw Error('已安装模组与本次下载互斥：'+conflict.title+'；请先移除冲突模组');
 const download=await this.downloader(signal).init(),items=plan.files.map(f=>({...f,file:cacheFile(this.root,f)}));for(const f of items)if(!f.url&&!await download.valid(f))throw Error('请先手动下载并导入：'+f.project.title);await download.all(items);
 const work=path.join(this.root,'.starquill','content-backups',crypto.randomUUID());await fs.mkdir(work,{recursive:true});const changes=[],next=records.slice(),pending=[];
 const parsedIds=new Map(),declaredBy=new Map();
 const idsFor=file=>{
   if(!parsedIds.has(file))parsedIds.set(file,modIds(file));
   return parsedIds.get(file);
 };
 for(const f of items){if(signal?.aborted)throw Error('已取消安装');const folder=folders[f.project.kind];if(!folder)throw Error('资源类型不能直接安装');const old=records.find(r=>r.source===f.project.source&&r.projectId===f.project.id),name=filename(f.original,f.chineseName),relative=relativeFile(folder+'/'+name),dest=under(target,relative);await noLinks(this.root,dest);let reuse;
 let locals=[];try{locals=await fs.readdir(path.join(target,folder));}catch(e){if(e.code!=='ENOENT')throw e;}const newIds=f.project.kind==='mod'?idsFor(f.file):[];
 for(const id of newIds){
   const owner=declaredBy.get(id);
   if(owner&&owner!==f.file)throw Error('安装清单中的多个文件声明同一模组 ID：'+id);
   declaredBy.set(id,f.file);
 }
 for(const n of locals){const candidate=under(target,relativeFile(folder+'/'+n));if(!(await fs.lstat(candidate)).isFile())continue;if(n.toLowerCase().endsWith('.disabled')){if(f.project.kind==='mod'&&newIds.some(id=>idsFor(candidate).includes(id)))throw Error('相同模组已禁用，请先在版本设置中处理：'+n);continue;}if(await download.valid({...f,file:candidate})){reuse=folder+'/'+n;break;}if(f.project.kind==='mod'&&n.endsWith('.jar')&&candidate!==under(target,old?.path||relative)&&newIds.some(id=>idsFor(candidate).includes(id)))throw Error('存在另一版本的同一模组：'+n+'。请先在版本文件夹中移走它，避免重复加载。');}
 if(old&&old.path!==reuse){const oldPath=under(target,relativeFile(old.path));await noLinks(this.root,oldPath);if(await exists(oldPath)){if(!await download.valid({file:oldPath,hashes:old.hashes,size:old.size}))throw Error('已安装文件已被修改，未自动覆盖：'+old.path);pending.push({remove:oldPath});}}
 if(!reuse&&await exists(dest)&&(!old||under(target,old.path)!==dest))throw Error('存在同名文件，未覆盖：'+name);if(!reuse)pending.push({source:f.file,dest});const record={source:f.project.source,projectId:f.project.id,versionId:f.versionId,original:f.original,chineseName:f.chineseName,wiki:f.wiki,path:reuse||relative,hashes:f.hashes,size:f.size};const index=next.findIndex(r=>r.source===record.source&&r.projectId===record.projectId);if(index<0)next.push(record);else next[index]=record;
 }
 // All downloads and conflict checks finish before changing the instance.
 try{for(const p of pending){if(signal?.aborted)throw Error('已取消安装');if(p.remove){const backup=path.join(work,String(changes.length));await fs.rename(p.remove,backup);changes.push({original:p.remove,backup});}else{await fs.mkdir(path.dirname(p.dest),{recursive:true});await fs.copyFile(p.source,p.dest,require('node:fs').constants.COPYFILE_EXCL);changes.push({added:p.dest});}}await writeJSON(registryFile,{schema:1,files:next});}catch(e){for(const c of changes.reverse()){if(c.added)await fs.rm(c.added,{force:true});else await fs.rename(c.backup,c.original);}throw e;}
 this.onLog('资源安装完成：'+plan.files.map(f=>f.chineseName||f.project.title).join('、'));return {count:plan.files.length,folder:target};
 }
}
function existsRecord(target,record){try{return require('node:fs').existsSync(under(target,relativeFile(record.path)));}catch{return false;}}
function inspectPack(file){const zip=new Zip(file),entries=zip.getEntries();if(entries.length>20000)throw Error('整合包文件数量超过限制');let expanded=0;for(const e of entries){const n=e.entryName.replace(/\/$/,'');if(!n)continue;relativeFile(n);if((e.attr>>>16&0xf000)===0xa000)throw Error('整合包不能包含符号链接');expanded+=e.header.size;if(e.header.size>512*1024**2||expanded>4*1024**3)throw Error('整合包解压大小超过限制');}
 const mr=zip.getEntry('modrinth.index.json'),cf=zip.getEntry('manifest.json');if(mr){if(mr.header.size>8*1024**2)throw Error('整合包清单过大');const m=JSON.parse(mr.getData());if(m.formatVersion!==1||m.game!=='minecraft'||!Array.isArray(m.files)||!m.dependencies?.minecraft)throw Error('Modrinth 整合包清单无效');const loaders=Object.entries(m.dependencies).filter(([k])=>k!=='minecraft');if(loaders.length>1)throw Error('整合包包含多个加载器，暂不支持');const [key,version]=loaders[0]||[];const loader=({'fabric-loader':'fabric',forge:'forge',neoforge:'neoforge'})[key];if(key&&!loader)throw Error('暂不支持整合包加载器 '+key);const files=m.files.filter(f=>f.env?.client!=='unsupported'&&f.env?.client!=='optional').map(f=>{relativeFile(f.path);protectOverride(f.path);if(!f.downloads?.length)throw Error('整合包文件缺少下载地址');const urls=f.downloads.map(httpsURL);const item={path:f.path,original:path.posix.basename(f.path),urls,url:urls[0],hashes:f.hashes,size:f.fileSize};if(!expectedHash(item))throw Error('整合包文件缺少校验值');return item;});checkUnique(files.map(f=>f.path));return {format:'modrinth',name:m.name||'Modrinth 整合包',game:m.dependencies.minecraft,loader,version,files,overrides:['overrides/','client-overrides/'],optional:m.files.filter(f=>f.env?.client==='optional').length};}
 if(cf){if(cf.header.size>8*1024**2)throw Error('整合包清单过大');const m=JSON.parse(cf.getData());if(m.manifestType!=='minecraftModpack'||m.manifestVersion!==1||!Array.isArray(m.files)||!m.minecraft?.version)throw Error('CurseForge 整合包清单无效');const loaders=m.minecraft.modLoaders||[];if(loaders.length>1)throw Error('整合包包含多个加载器，暂不支持');const selected=loaders[0]?.id;const match=selected&&/^(forge|neoforge|fabric)-(.+)$/.exec(selected);if(selected&&!match)throw Error('暂不支持整合包加载器 '+selected);const overrides=(m.overrides||'overrides').replace(/\/$/,'');relativeFile(overrides);return {format:'curseforge',name:m.name||'CurseForge 整合包',game:m.minecraft.version,loader:match?.[1],version:match?.[2],files:m.files.filter(f=>f.required!==false).map(f=>({projectId:String(f.projectID),versionId:String(f.fileID)})),overrides:[overrides+'/'],optional:m.files.filter(f=>f.required===false).length};}throw Error('未找到 modrinth.index.json 或 CurseForge manifest.json，请导入 .mrpack 或客户端整合包 ZIP');}
function checkUnique(paths){const seen=new Set();for(const p of paths){const key=p.toLowerCase();if(seen.has(key))throw Error('整合包包含重复文件路径：'+p);seen.add(key);}}
function protectOverride(p){relativeFile(p);if(/^(?:versions|libraries|assets|natives|\.starquill)(?:\/|$)/i.test(p)||/\.(exe|dll|bat|cmd|ps1|vbs|lnk|url)$/i.test(p)||/^\.?starquill-.*\.json$/i.test(p))throw Error('整合包含有受保护路径：'+p);}
async function extractOverrides(file,pack,target){const zip=new Zip(file);for(const prefix of pack.overrides){const entries=zip.getEntries().filter(e=>!e.isDirectory&&e.entryName.startsWith(prefix));checkUnique(entries.map(e=>e.entryName));for(const e of entries){const relative=e.entryName.slice(prefix.length);protectOverride(relative);if(relative.toLowerCase()===(path.basename(target)+'.json').toLowerCase())throw Error('整合包试图覆盖版本配置');const dest=under(target,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,e.getData());}}}
module.exports={ContentInstaller,cacheFile,modIds,inspectPack,extractOverrides,protectOverride};
