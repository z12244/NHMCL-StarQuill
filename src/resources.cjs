const {json,httpsURL,filename,transientNetworkError}=require('./content-utils.cjs');
const {pool}=require('./downloads.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const {official:CF,mirror}=require('./curseforge-access.cjs');
const MR='https://api.modrinth.com/v2';
const resourceLoader=value=>value==='cleanroom'?'forge':value;
const CLASS={mod:6,modpack:4471,resourcepack:12,shader:6552},LOADERS={forge:1,fabric:4,neoforge:6};
async function metadata(fetcher,url,signal,headers,body){
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();
  try{return await json(fetcher,url,signal,headers,body);}
  catch(error){
   signal?.throwIfAborted();
   if(!transientNetworkError(error)||attempt>=2)throw error;
   await delay(300*(attempt+1),undefined,{signal});
  }
 }
}
function ident(id){if(typeof id!=='string'&&typeof id!=='number'||!/^[-a-zA-Z0-9_+.]+$/.test(String(id)))throw Error('资源编号无效');return encodeURIComponent(id);}
function mrProject(p){return {source:'modrinth',id:p.id||p.project_id,slug:p.slug,title:p.title,kind:p.project_type,downloads:p.downloads||0,updated:p.date_modified||p.updated||'',icon:require('./resource-icons.cjs').iconURL(p.icon_url),description:p.description||'',url:`https://modrinth.com/${p.project_type}/${p.slug||p.id}`};}
function cfProject(p){const kind=Object.keys(CLASS).find(k=>CLASS[k]===p.classId);if(!kind||p.gameId!==432)throw Error('仅支持 Minecraft Java 资源');return {source:'curseforge',id:String(p.id),slug:p.slug,title:p.name,kind,downloads:p.downloadCount||0,updated:p.dateModified||'',icon:require('./resource-icons.cjs').iconURL(p.logo?.thumbnailUrl||p.logo?.url),description:p.summary||'',url:p.links?.websiteUrl||`https://www.curseforge.com/minecraft/mc-mods/${p.slug}`,distribution:p.allowModDistribution};}
class Resources{
 constructor({fetcher=fetch,key='',names,onStatus=()=>{}}={}){Object.assign(this,{fetcher,key,names,onStatus});}
 async mr(route,signal){return metadata(this.fetcher,MR+route,signal);}
 async cf(route,signal,body){
   if(this.key){
     try{return (await metadata(this.fetcher,CF+route,signal,{'x-api-key':this.key},body)).data;}
     catch(e){
       if(signal?.aborted || /HTTP (400|404|410)\b/.test(e.message) || (route.endsWith('/download-url') && /HTTP 403\b/.test(e.message)))throw e;
       try{return (await metadata(this.fetcher,mirror+'/curseforge/v1'+route,signal,undefined,body)).data;}catch(other){signal?.throwIfAborted();const status=other.message.match(/HTTP (\d{3})/);throw Error(e.message+'；镜像'+(status?'返回 HTTP '+status[1]:'请求失败：'+other.message),{cause:other});}
     }
   }
   return (await metadata(this.fetcher,mirror+'/curseforge/v1'+route,signal,undefined,body)).data;
 }
 async pinMetadata(pins,signal){
   async function collect(client,route,field,ids){
     const found=new Map(),unique=[...new Set(ids)];
     for(let start=0;start<unique.length;start+=40){
       signal?.throwIfAborted();
       const wanted=new Set(unique.slice(start,start+40));
       try{
         const rows=await client.cf(route,signal,{[field]:Array.from(wanted,Number)});
         if(!Array.isArray(rows))break;
         for(const row of rows){
           const id=String(row?.id);
           if(wanted.has(id))found.set(id,row);
         }
       }catch(error){
         signal?.throwIfAborted();
         if(error.name==='AbortError')throw error;
         // Older proxies may only serve single-item routes. Missing entries
         // are resolved through the normal project and file requests below.
         if(/HTTP (?:400|404|405|501)\b/.test(error.message))break;
       }
     }
     return found;
   }
   const [projects,files]=await Promise.all([
     collect(this,'/mods','modIds',pins.map(p=>String(p.projectId))),
     collect(this,'/mods/files','fileIds',pins.map(p=>String(p.versionId)))
   ]);
   return {projects,files};
 }
 async search({source='modrinth',kind='mod',query='',game='',loader='',offset=0,sort='relevance'},signal){
   const fields={relevance:['relevance','2'],downloads:['downloads','6'],updated:['updated','3']};
   if(!Object.hasOwn(fields,sort)||!Object.hasOwn(CLASS,kind)||query.length>160)throw Error('搜索条件无效');
   loader=resourceLoader(loader);
   const filterLoader=loader&&['mod','modpack'].includes(kind);
   if(source==='modrinth'){
     const facets=[['project_type:'+kind]];
     if(game)facets.push(['versions:'+game]);
     if(filterLoader)facets.push(['categories:'+loader]);
     const params=new URLSearchParams({query,facets:JSON.stringify(facets),index:fields[sort][0],limit:'20',offset:String(offset)});
     const data=await this.mr('/search?'+params,signal);
     return {items:data.hits.map(mrProject),hasMore:data.hits.length>0&&offset+data.hits.length<data.total_hits};
   }
   if(source==='curseforge'){
     // The Core API limits index + pageSize to 10,000.
     if(offset>=10000)return {items:[],hasMore:false};
     const params=new URLSearchParams({gameId:'432',classId:String(CLASS[kind]),searchFilter:query,pageSize:'20',index:String(offset),sortField:fields[sort][1],sortOrder:'desc'});
     if(game)params.set('gameVersion',game);
     if(filterLoader)params.set('modLoaderType',String(LOADERS[loader]));
     const items=await this.cf('/mods/search?'+params,signal);
     return {items:items.map(cfProject),hasMore:items.length===20&&offset+20<10000};
   }
   if(source==='mcmod')return {items:await this.names.search(query,Math.floor(offset/20)+1,signal),hasMore:true};
   throw Error('资源平台无效');
 }
 async bySlug(source,kind,slug,filter={},signal){
   let project;
   if(source==='modrinth'){
     try{project=await this.project(source,slug,signal);}
     catch(error){if(/HTTP 404\b/.test(error.message))return null;throw error;}
   }else{
     const q=new URLSearchParams({gameId:'432',classId:String(CLASS[kind]),slug});
     const rows=await this.cf('/mods/search?'+q,signal);
     const item=rows.find(p=>p.slug===slug);
     if(item)project=cfProject(item);
   }
   if(!project||project.kind!==kind)return null;
   if((filter.game||filter.loader)&&!(await this.versions(project,filter,signal)).length)return null;
   return project;
 }
 async project(source,id,signal,record){
   if(source==='modrinth')return mrProject(await this.mr('/project/'+ident(id),signal));
   if(source!=='curseforge')throw Error('资源平台无效');
   const project=cfProject(record??await this.cf('/mods/'+ident(id),signal));
   if(project.id!==String(id))throw Error('资源项目编号不匹配');
   return project;
 }
 async versions(project,target={},signal){target={...target,loader:resourceLoader(target.loader)};let rows;if(project.source==='modrinth'){const q=new URLSearchParams();if(target.game)q.set('game_versions',JSON.stringify([target.game]));if(target.loader&&['mod','modpack'].includes(project.kind))q.set('loaders',JSON.stringify([target.loader]));rows=await this.mr('/project/'+ident(project.id)+'/version?'+q,signal);return rows.filter(v=>compatibleMR(v,project.kind,target)).map(v=>({id:v.id,name:v.name,number:v.version_number,gameVersions:v.game_versions,loaders:v.loaders,channel:v.version_type,date:v.date_published}));}const q=new URLSearchParams({pageSize:'50'});if(target.game)q.set('gameVersion',target.game);if(target.loader&&['mod','modpack'].includes(project.kind))q.set('modLoaderType',String(LOADERS[target.loader]));rows=await this.cf('/mods/'+ident(project.id)+'/files?'+q,signal);return rows.filter(v=>v.isAvailable!==false&&compatibleCF(v,project.kind,target)).map(v=>({id:String(v.id),name:v.displayName,number:v.fileName,gameVersions:v.gameVersions,channel:({1:'release',2:'beta',3:'alpha'})[v.releaseType],date:v.fileDate}));}
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
 async file(project,versionId,target={},signal,record){
   if(project.source==='modrinth'){
     const v=await this.mr('/version/'+ident(versionId),signal);
     if(v.project_id!==project.id||!compatibleMR(v,project.kind,target))throw Error('所选文件与游戏版本 / 加载器不兼容');
     const file=v.files.find(f=>f.primary)||v.files[0];
     if(!file)throw Error('该版本没有可下载文件');
     return {project,versionId:v.id,version:v.version_number,original:file.filename,url:httpsURL(file.url),
       hashes:file.hashes,size:file.size,dependencies:(v.dependencies||[]).map(d=>({projectId:d.project_id,versionId:d.version_id,kind:d.dependency_type}))};
   }
   const v=record??await this.cf('/mods/'+ident(project.id)+'/files/'+ident(versionId),signal);
   if(String(v.id)!==String(versionId)||String(v.modId)!==project.id||!compatibleCF(v,project.kind,target)||
      (v.isAvailable===false&&!(target.pinned&&target.allowManualPin)))throw Error('所选文件与游戏版本 / 加载器不兼容或暂不可用');
   const url=v.isAvailable===false?null:await this.downloadUrl(project,v,signal);
   return {project,versionId:String(v.id),version:v.displayName,original:v.fileName,url,
     manualUrl:project.url+'/files/'+v.id,size:v.fileLength,
     hashes:Object.fromEntries((v.hashes||[]).filter(h=>[1,2].includes(h.algo)).map(h=>[h.algo===1?'sha1':'md5',h.value])),
     dependencies:(v.dependencies||[]).filter(d=>[2,3,5].includes(d.relationType)).map(d=>({projectId:String(d.modId),kind:({2:'optional',3:'required',5:'incompatible'})[d.relationType]}))};
 }
 async plan(project,versionId,target,signal){if(project.kind==='mod'&&!target.loader)throw Error('此版本尚未安装模组加载器，请先安装 Forge、NeoForge 或 Fabric');const chosen=new Map(),visiting=new Set(),warnings=[],conflicts=[];
 const visit=async(p,id,reason)=>{if(chosen.size>=160)throw Error('前置依赖超过 160 项，请使用整合包安装');const old=chosen.get(p.id);if(old){if(id&&old.versionId!==String(id))throw Error('前置依赖版本冲突：'+p.title);return;}if(visiting.has(p.id))return;visiting.add(p.id);if(!id){const versions=await this.versions(p,target,signal);if(!versions.length)throw Error('没有兼容的必需前置：'+p.title);id=versions[0].id;}const file=await this.file(p,id,target,signal);file.reason=reason;chosen.set(p.id,file);for(const d of file.dependencies){if(d.kind==='required'){let dep;if(d.projectId)dep=await this.project(p.source,d.projectId,signal);else if(d.versionId&&p.source==='modrinth'){const v=await this.mr('/version/'+ident(d.versionId),signal);dep=await this.project(p.source,v.project_id,signal);}else throw Error('前置缺少可解析的项目编号：'+p.title);if(dep.kind!=='mod')throw Error('暂不能自动安装此类型前置：'+dep.title);await visit(dep,d.versionId,'必需前置 · '+p.title);}else if(d.kind==='optional')warnings.push('可选前置：'+(d.projectId||d.versionId||'未命名')+'（来源 '+p.title+'，未自动安装）');else if(d.kind==='incompatible')conflicts.push({source:p.source,projectId:d.projectId,versionId:d.versionId,title:p.title});}visiting.delete(p.id);};
 await visit(project,versionId,'主动选择');for(const c of conflicts){if(c.projectId&&chosen.has(c.projectId)||c.versionId&&[...chosen.values()].some(f=>f.versionId===c.versionId))throw Error('依赖清单包含互斥模组：'+c.title);}const files=[...chosen.values()];this.onStatus('已解析 '+files.length+' 个资源，正在核对中文名');await pool(files,3,async f=>{const n=await this.names?.lookup(f.project,signal);f.chineseName=n?.name||'';f.wiki=n?.url;f.filename=filename(f.original,f.chineseName);});return {files,warnings,conflicts,target,project};}
}
function compatibleMR(v,kind,t){return (!t.game||v.game_versions?.includes(t.game))&&(!['mod','modpack'].includes(kind)||!t.loader||v.loaders?.includes(resourceLoader(t.loader)));}
function compatibleCF(v,kind,t){
 const tags=v.gameVersions||[],loaders=tags.map(x=>x.toLowerCase()).filter(x=>['forge','neoforge','fabric','quilt','liteloader','rift'].includes(x));
 // A pack's pinned file IDs predate CurseForge's loader tags in many legacy
 // releases. Missing tags are not a mismatch; explicit conflicting tags are.
 return (!t.game||tags.includes(t.game))&&(!['mod','modpack'].includes(kind)||!t.loader||loaders.includes(resourceLoader(t.loader))||(t.pinned===true&&!loaders.length));
}
module.exports={Resources,compatibleMR,compatibleCF,mrProject,cfProject,ident,resourceLoader};
