const fs=require('node:fs/promises'),path=require('node:path');
const {constants}=require('node:fs');
function versionName(id){if(typeof id!=='string'||!id.trim()||id.length>180||/[<>:"/\\|?*\x00-\x1f]/.test(id)||/[. ]$/.test(id)||['.','..'].includes(id)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id))throw Error('版本文件夹名称无效');return id;}
function under(root,relative){if(typeof relative!=='string'||!relative||/^[a-z]:/i.test(relative)||relative.includes('\\')||relative.startsWith('/'))throw Error('文件路径无效');const target=path.resolve(root,relative);const rel=path.relative(path.resolve(root),target);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('文件路径越出游戏目录');return target;}
function layout(root,id,isolate=true,sharedRoot=root){
  versionName(id);
  root=path.resolve(root);
  const version=path.join(root,'versions',id);
  return {root,version,json:path.join(version,id+'.json'),jar:path.join(version,id+'.jar'),game:isolate?version:root,
    libraries:path.resolve(sharedRoot,'libraries'),assets:path.resolve(sharedRoot,'assets'),natives:path.join(version,'natives')};
}
async function readJSON(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function writeJSON(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.starquill.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}
async function markStandalone(root,id) {
  const marker=path.join(layout(root,id).version,'.starquill-standalone');
  try { await fs.writeFile(marker,'',{flag:'wx'}); }
  catch(error) { if(error.code!=='EEXIST') throw error; }
}
async function scan(root) {
  let dirs;
  try { dirs=await fs.readdir(path.join(root,'versions'),{withFileTypes:true}); } catch { return []; }
  const versions=[], packs=[],packParents=new Map();
  for(const dir of dirs) {
    if(!dir.isDirectory())continue;
    try {
      const p=layout(root,dir.name), json=await readJSON(p.json);
      if(json.starQuill?.privateDependency)continue;
      let displayName, configuredIsolation;
      try { const config=await readJSON(path.join(p.version,'.starquill-settings.json'));displayName=config.displayName;configuredIsolation=config.isolate; } catch {}
      versions.push({id:dir.name,displayName,...(json.starQuill?.isolate===true?{forcedIsolation:true}:{}),...(configuredIsolation?{configuredIsolation}:{}),type:json.type||'custom',inheritsFrom:json.inheritsFrom||null,ready:true,mainClass:json.mainClass||null});
      if(json.inheritsFrom||json.starQuill?.base)try { await fs.access(path.join(p.version,'starquill-pack.json')); packs.push(dir.name);packParents.set(dir.name,json.inheritsFrom||json.starQuill.base); } catch {}
    }catch(error){versions.push({id:dir.name,ready:false,error:error.message});}
  }
  const byId=new Map(versions.map(v=>[v.id,v])),hidden=new Set();
  for(const id of packs) {
    let parent=packParents.get(id);
    while(byId.has(parent)&&!hidden.has(parent)) {
      hidden.add(parent);
      parent=byId.get(parent).inheritsFrom;
    }
  }
  for(const id of hidden) {
    try { await fs.access(path.join(layout(root,id).version,'.starquill-standalone')); hidden.delete(id); } catch {}
  }
  return versions.filter(v=>!hidden.has(v.id)).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
}
function libraryKey(lib){const [coords,ext='jar']=lib.name.split('@');const [group,artifact,,classifier='']=coords.split(':');return `${group}:${artifact}:${classifier}@${ext}`;}
function libraryGroups(list=[]) {
  const groups=new Map();
  for(const library of list) {
    const key=libraryKey(library);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(library);
  }
  return groups;
}
function merge(parent,child){
  const libraries=libraryGroups(parent.libraries);
  for(const [key,variants] of libraryGroups(child.libraries))libraries.set(key,variants);
  return {...parent,...child,downloads:{...parent.downloads,...child.downloads},libraries:[...libraries.values()].flat(),arguments:{game:[...(parent.arguments?.game||[]),...(child.arguments?.game||[])],jvm:[...(parent.arguments?.jvm||[]),...(child.arguments?.jvm||[])]}};}

function repairEmbeddedProfile(raw) {
  if(!raw.starQuill?.isolate || raw.inheritsFrom || !Array.isArray(raw.libraries))return raw;
  // Older StarQuill exports collapsed Mojang's platform-specific variants to the last (macOS) entry.
  if(raw.starQuill.game==='1.12.2' && raw.libraries.some(l=>l.name==='org.lwjgl.lwjgl:lwjgl:2.9.2-nightly-20140822')) {
    const groups=libraryGroups(raw.libraries);
    const missing=require('../assets/lwjgl-1.12.2.json').filter(l=>{
      const existing=groups.get(libraryKey(l));
      return existing?.length===1 && existing[0].name.endsWith(':2.9.2-nightly-20140822') &&
        existing[0].rules?.length===1 && existing[0].rules[0].action==='allow' && existing[0].rules[0].os?.name==='osx';
    });
    if(missing.length)return {...raw,libraries:[...raw.libraries,...structuredClone(missing)]};
  }
  // Recover previously imported GTNH CurseForge deltas whose empty modern argument array hid the Forge arguments.
  if(raw.starQuill.game==='1.7.10' && raw.starQuill.loader==='forge' &&
     raw.mainClass==='com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread' &&
     !raw.minecraftArguments && raw.arguments?.game?.length===0 &&
     raw.libraries.some(l=>l.name.startsWith('com.github.GTNewHorizons:lwjgl3ify:'))) {
    const game='--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userProperties ${user_properties} --userType ${user_type} --tweakClass cpw.mods.fml.common.launcher.FMLTweaker'.split(' ');
    return {...raw,arguments:{...raw.arguments,game}};
  }
  return raw;
}
async function resolveVersion(root,id,obtain,seen=[]){versionName(id);if(seen.includes(id)||seen.length>16)throw Error('版本继承存在循环或层级过深');const p=layout(root,id);let raw;
  try{raw=await readJSON(p.json);}catch(e){if(e.code!=='ENOENT')throw Error('版本 JSON 损坏：'+p.json);if(!obtain)throw Error('缺少父版本：'+id);raw=await obtain(id);await writeJSON(p.json,raw);}
  if(raw.inheritsFrom){const parent=await resolveVersion(root,raw.inheritsFrom,obtain,[...seen,id]);return {meta:merge(parent.meta,raw),chain:[...parent.chain,{id,raw}],raw};}
  raw=repairEmbeddedProfile(raw);return {meta:raw,chain:[{id,raw}],raw};
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
module.exports={versionName,under,layout,readJSON,writeJSON,scan,markStandalone,merge,libraryKey,resolveVersion,migrateLegacy};
