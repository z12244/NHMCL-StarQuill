const {json,httpsURL,filename}=require('./content-utils.cjs');
const {pool}=require('./downloads.cjs');
const {official:CF,mirror}=require('./curseforge-access.cjs');
const MR='https://api.modrinth.com/v2';
const CLASS={mod:6,modpack:4471,resourcepack:12,shader:6552},LOADERS={forge:1,fabric:4,neoforge:6};
function ident(id){if(typeof id!=='string'&&typeof id!=='number'||!/^[-a-zA-Z0-9_+.]+$/.test(String(id)))throw Error('资源编号无效');return encodeURIComponent(id);}
function mrProject(p){return {source:'modrinth',id:p.id||p.project_id,slug:p.slug,title:p.title,kind:p.project_type,icon:require('./resource-icons.cjs').iconURL(p.icon_url),description:p.description||'',url:`https://modrinth.com/${p.project_type}/${p.slug||p.id}`};}
function cfProject(p){const kind=Object.keys(CLASS).find(k=>CLASS[k]===p.classId);if(!kind||p.gameId!==432)throw Error('仅支持 Minecraft Java 资源');return {source:'curseforge',id:String(p.id),slug:p.slug,title:p.name,kind,icon:require('./resource-icons.cjs').iconURL(p.logo?.thumbnailUrl||p.logo?.url),description:p.summary||'',url:p.links?.websiteUrl||`https://www.curseforge.com/minecraft/mc-mods/${p.slug}`,distribution:p.allowModDistribution};}
class Resources{
 constructor({fetcher=fetch,key='',names,onStatus=()=>{}}={}){Object.assign(this,{fetcher,key,names,onStatus});}
 async mr(route,signal){return json(this.fetcher,MR+route,signal);}
 async cf(route,signal){
   if(this.key){
     try{return (await json(this.fetcher,CF+route,signal,{'x-api-key':this.key})).data;}
     catch(e){
       if(signal?.aborted || /HTTP (400|404|410)\b/.test(e.message) || (route.endsWith('/download-url') && /HTTP 403\b/.test(e.message)))throw e;
       try{return (await json(this.fetcher,mirror+'/curseforge/v1'+route,signal)).data;}catch{throw e;}
     }
   }
   return (await json(this.fetcher,mirror+'/curseforge/v1'+route,signal)).data;
 }
 async search({source='modrinth',kind='mod',query='',game='',loader='',offset=0},signal){if(!CLASS[kind]||query.length>160)throw Error('搜索条件无效');offset=Math.max(0,Math.min(10000,Math.floor(Number(offset)||0)));if(source==='modrinth'){const facets=[[`project_type:${kind}`]];if(game)facets.push([`versions:${game}`]);if(loader&&kind==='mod')facets.push([`categories:${loader}`]);const data=await this.mr('/search?'+new URLSearchParams({query,facets:JSON.stringify(facets),limit:'20',offset:String(offset)}),signal);return {items:data.hits.map(mrProject),hasMore:offset+20<data.total_hits};}if(source==='curseforge'){const q=new URLSearchParams({gameId:'432',classId:String(CLASS[kind]),searchFilter:query,pageSize:'20',index:String(offset),sortField:'2',sortOrder:'desc'});if(game)q.set('gameVersion',game);if(loader&&kind==='mod')q.set('modLoaderType',String(LOADERS[loader]));const items=await this.cf('/mods/search?'+q,signal);return {items:items.map(cfProject),hasMore:items.length===20};}if(source==='mcmod')return {items:await this.names.search(query,Math.floor(offset/20)+1,signal),hasMore:true};throw Error('资源平台无效');}
 async project(source,id,signal){return source==='modrinth'?mrProject(await this.mr('/project/'+ident(id),signal)):source==='curseforge'?cfProject(await this.cf('/mods/'+ident(id),signal)):(()=>{throw Error('资源平台无效');})();}
 async versions(project,target={},signal){let rows;if(project.source==='modrinth'){const q=new URLSearchParams();if(target.game)q.set('game_versions',JSON.stringify([target.game]));if(target.loader&&project.kind==='mod')q.set('loaders',JSON.stringify([target.loader]));rows=await this.mr('/project/'+ident(project.id)+'/version?'+q,signal);return rows.filter(v=>compatibleMR(v,project.kind,target)).map(v=>({id:v.id,name:v.name,number:v.version_number,gameVersions:v.game_versions,loaders:v.loaders,date:v.date_published}));}const q=new URLSearchParams({pageSize:'50'});if(target.game)q.set('gameVersion',target.game);if(target.loader&&project.kind==='mod')q.set('modLoaderType',String(LOADERS[target.loader]));rows=await this.cf('/mods/'+ident(project.id)+'/files?'+q,signal);return rows.filter(v=>v.isAvailable!==false&&compatibleCF(v,project.kind,target)).map(v=>({id:String(v.id),name:v.displayName,number:v.fileName,gameVersions:v.gameVersions,date:v.fileDate}));}
 async downloadUrl(project,file,signal) {
   if(project.distribution===false)return null;
   if(file.downloadUrl)return httpsURL(file.downloadUrl);
   let location;
   try {
     location=await this.cf('/mods/'+ident(project.id)+'/files/'+ident(file.id)+'/download-url',signal);
   } catch(error) {
     if(!signal?.aborted&&/HTTP (403|404|410)\b/.test(error.message))return null;
     throw error;
   }
   return location ? httpsURL(location) : null;
 }
 async file(project,versionId,target={},signal){let v,file,deps;if(project.source==='modrinth'){v=await this.mr('/version/'+ident(versionId),signal);if(v.project_id!==project.id||!compatibleMR(v,project.kind,target))throw Error('所选文件与游戏版本 / 加载器不兼容');file=v.files.find(f=>f.primary)||v.files[0];if(!file)throw Error('该版本没有可下载文件');deps=v.dependencies||[];return {project,versionId:v.id,version:v.version_number,original:file.filename,url:httpsURL(file.url),hashes:file.hashes,size:file.size,dependencies:deps.map(d=>({projectId:d.project_id,versionId:d.version_id,kind:d.dependency_type}))};}v=await this.cf('/mods/'+ident(project.id)+'/files/'+ident(versionId),signal);if(String(v.modId)!==project.id||!compatibleCF(v,project.kind,target)||v.isAvailable===false)throw Error('所选文件与游戏版本 / 加载器不兼容或暂不可用');const url=await this.downloadUrl(project,v,signal);return {project,versionId:String(v.id),version:v.displayName,original:v.fileName,url,manualUrl:`${project.url}/files/${v.id}`,hashes:Object.fromEntries((v.hashes||[]).filter(h=>[1,2].includes(h.algo)).map(h=>[h.algo===1?'sha1':'md5',h.value])),size:v.fileLength,dependencies:(v.dependencies||[]).filter(d=>[2,3,5].includes(d.relationType)).map(d=>({projectId:String(d.modId),kind:({2:'optional',3:'required',5:'incompatible'})[d.relationType]}))};}
 async plan(project,versionId,target,signal){if(project.kind==='mod'&&!target.loader)throw Error('此版本尚未安装模组加载器，请先安装 Forge、NeoForge 或 Fabric');const chosen=new Map(),visiting=new Set(),warnings=[],conflicts=[];
 const visit=async(p,id,reason)=>{if(chosen.size>=160)throw Error('前置依赖超过 160 项，请使用整合包安装');const old=chosen.get(p.id);if(old){if(id&&old.versionId!==String(id))throw Error('前置依赖版本冲突：'+p.title);return;}if(visiting.has(p.id))return;visiting.add(p.id);if(!id){const versions=await this.versions(p,target,signal);if(!versions.length)throw Error('没有兼容的必需前置：'+p.title);id=versions[0].id;}const file=await this.file(p,id,target,signal);file.reason=reason;chosen.set(p.id,file);for(const d of file.dependencies){if(d.kind==='required'){let dep;if(d.projectId)dep=await this.project(p.source,d.projectId,signal);else if(d.versionId&&p.source==='modrinth'){const v=await this.mr('/version/'+ident(d.versionId),signal);dep=await this.project(p.source,v.project_id,signal);}else throw Error('前置缺少可解析的项目编号：'+p.title);if(dep.kind!=='mod')throw Error('暂不能自动安装此类型前置：'+dep.title);await visit(dep,d.versionId,'必需前置 · '+p.title);}else if(d.kind==='optional')warnings.push('可选前置：'+(d.projectId||d.versionId||'未命名')+'（来源 '+p.title+'，未自动安装）');else if(d.kind==='incompatible')conflicts.push({source:p.source,projectId:d.projectId,versionId:d.versionId,title:p.title});}visiting.delete(p.id);};
 await visit(project,versionId,'主动选择');for(const c of conflicts){if(c.projectId&&chosen.has(c.projectId)||c.versionId&&[...chosen.values()].some(f=>f.versionId===c.versionId))throw Error('依赖清单包含互斥模组：'+c.title);}const files=[...chosen.values()];this.onStatus('已解析 '+files.length+' 个资源，正在核对中文名');await pool(files,3,async f=>{const n=await this.names?.lookup(f.project,signal);f.chineseName=n?.name||'';f.wiki=n?.url;f.filename=filename(f.original,f.chineseName);});return {files,warnings,conflicts,target,project};}
}
function compatibleMR(v,kind,t){return (!t.game||v.game_versions?.includes(t.game))&&(kind!=='mod'||!t.loader||v.loaders?.includes(t.loader));}
function compatibleCF(v,kind,t){return (!t.game||v.gameVersions?.includes(t.game))&&(kind!=='mod'||!t.loader||v.gameVersions?.some(x=>x.toLowerCase()===t.loader));}
module.exports={Resources,compatibleMR,compatibleCF,mrProject,cfProject,ident};
