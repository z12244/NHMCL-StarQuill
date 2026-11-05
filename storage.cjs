const fs=require('node:fs/promises'),path=require('node:path');
const {constants}=require('node:fs');
function versionName(id){if(typeof id!=='string'||!id.trim()||id.length>180||/[<>:"/\\|?*\x00-\x1f]/.test(id)||/[. ]$/.test(id)||['.','..'].includes(id)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id))throw Error('版本文件夹名称无效');return id;}
function under(root,relative){if(typeof relative!=='string'||!relative||/^[a-z]:/i.test(relative)||relative.includes('\\')||relative.startsWith('/'))throw Error('文件路径无效');const target=path.resolve(root,relative);const rel=path.relative(path.resolve(root),target);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('文件路径越出游戏目录');return target;}
function layout(root,id,isolate=true){versionName(id);root=path.resolve(root);const version=path.join(root,'versions',id);return {root,version,json:path.join(version,id+'.json'),jar:path.join(version,id+'.jar'),game:isolate?version:root,libraries:path.join(root,'libraries'),assets:path.join(root,'assets'),natives:path.join(version,'natives')};}
async function readJSON(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function writeJSON(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.starquill.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}
async function scan(root){let dirs;try{dirs=await fs.readdir(path.join(root,'versions'),{withFileTypes:true});}catch{return [];}
  const versions=[];for(const d of dirs){if(!d.isDirectory())continue;try{const p=layout(root,d.name);const json=await readJSON(p.json);if(json.starQuill?.privateDependency)continue;let displayName;try{displayName=(await readJSON(path.join(p.version,'.starquill-settings.json'))).displayName;}catch{}versions.push({id:d.name,displayName,type:json.type||'custom',inheritsFrom:json.inheritsFrom||null,ready:true,mainClass:json.mainClass||null});}catch(e){versions.push({id:d.name,ready:false,error:e.message});}}const byId=new Map(versions.map(v=>[v.id,v])),hidden=new Set();for(const v of versions){try{await fs.access(path.join(root,'versions',v.id,'starquill-pack.json'));let parent=v.inheritsFrom;const seen=new Set();while(parent&&!seen.has(parent)){seen.add(parent);hidden.add(parent);parent=byId.get(parent)?.inheritsFrom;}}catch{}}return versions.filter(v=>!hidden.has(v.id)).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));}
function libraryKey(lib){const [coords,ext='jar']=lib.name.split('@');const [group,artifact,,classifier='']=coords.split(':');return `${group}:${artifact}:${classifier}@${ext}`;}
function merge(parent,child){const libraries=new Map((parent.libraries||[]).map(l=>[libraryKey(l),l]));for(const lib of child.libraries||[])libraries.set(libraryKey(lib),lib);
  return {...parent,...child,downloads:{...parent.downloads,...child.downloads},libraries:[...libraries.values()],arguments:{game:[...(parent.arguments?.game||[]),...(child.arguments?.game||[])],jvm:[...(parent.arguments?.jvm||[]),...(child.arguments?.jvm||[])]}};}
async function resolveVersion(root,id,obtain,seen=[]){versionName(id);if(seen.includes(id)||seen.length>16)throw Error('版本继承存在循环或层级过深');const p=layout(root,id);let raw;
  try{raw=await readJSON(p.json);}catch(e){if(e.code!=='ENOENT')throw Error('版本 JSON 损坏：'+p.json);if(!obtain)throw Error('缺少父版本：'+id);raw=await obtain(id);await writeJSON(p.json,raw);}
  if(raw.inheritsFrom){const parent=await resolveVersion(root,raw.inheritsFrom,obtain,[...seen,id]);return {meta:merge(parent.meta,raw),chain:[...parent.chain,{id,raw}],raw};}
  return {meta:raw,chain:[{id,raw}],raw};
}
async function copyMissing(source,target,stats={copied:0,skipped:0},exclude=new Set()){
  await fs.mkdir(target,{recursive:true});for(const entry of await fs.readdir(source,{withFileTypes:true})){if(exclude.has(entry.name)||entry.isSymbolicLink())continue;const src=path.join(source,entry.name),dst=path.join(target,entry.name);if(entry.isDirectory()){await copyMissing(src,dst,stats);}else if(entry.isFile()){try{await fs.copyFile(src,dst,constants.COPYFILE_EXCL);stats.copied++;}catch(e){if(e.code!=='EEXIST')throw e;stats.skipped++;}}}return stats;
}
async function migrateLegacy(source,root,onProgress=()=>{}){
  source=path.resolve(source);root=path.resolve(root);if(source===root||root.startsWith(source+path.sep)||source.startsWith(root+path.sep))throw Error('迁移源和目标不能相同或互相包含');
  const dirs=await fs.readdir(source,{withFileTypes:true});const stats={copied:0,skipped:0,versions:0,conflicts:[]};
  for(const d of dirs.filter(x=>x.isDirectory())){let id;try{id=versionName(d.name);}catch{continue;}const old=path.join(source,id),oldJson=path.join(old,'versions',id,id+'.json'),dest=layout(root,id);let raw;try{raw=await readJSON(oldJson);}catch{continue;}
    try{const existing=await readJSON(dest.json);if(JSON.stringify(existing)!==JSON.stringify(raw)){stats.conflicts.push(id);continue;}}catch(e){if(e.code!=='ENOENT')throw e;}
    onProgress('迁移 '+id);await copyMissing(path.join(old,'versions'),path.join(root,'versions'),stats);
    for(const common of ['assets','libraries']){try{await copyMissing(path.join(old,common),path.join(root,common),stats);}catch(e){if(e.code!=='ENOENT')throw e;}}
    await copyMissing(old,dest.game,stats,new Set(['assets','libraries','versions','cache','natives']));stats.versions++;
  }return stats;
}
module.exports={versionName,under,layout,readJSON,writeJSON,scan,merge,libraryKey,resolveVersion,migrateLegacy};
