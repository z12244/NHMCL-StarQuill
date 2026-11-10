const path=require('node:path');
const {listArchive,readArchiveFiles}=require('./pack-archive.cjs');
const {relativeFile,httpsURL}=require('./content-utils.cjs');
const {versionName}=require('./storage.cjs');
const {expectedHash}=require('./downloads.cjs');
const {splitArguments}=require('./advanced.cjs');
const MAX_METADATA=8*1024**2;

function gamePath(value){relativeFile(value);if(/^(?:versions|libraries|assets|natives|\.starquill)(?:\/|$)/i.test(value)||/\.(exe|dll|bat|cmd|ps1|vbs|lnk|url)$/i.test(value)||/^\.?starquill-.*\.json$/i.test(value))throw Error('整合包含有受保护路径：'+value);return value;}
function requiredJSON(buffer,label){try{const value=JSON.parse(buffer?.toString('utf8').replace(/^\uFEFF/,''));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Error('整合包清单无效：'+label);}}
function cfg(buffer){const result={};for(const line of buffer?.toString('utf8').split(/\r?\n/)||[]){const m=/^([^#;=\s][^=]*)=(.*)$/.exec(line);if(m)result[m[1].trim()]=m[2].trim();}return result;}
function uniqueFiles(files){const seen=new Set();for(const file of files){const name=file.toLowerCase();if(seen.has(name))throw Error('整合包包含重复文件路径：'+file);seen.add(name);}}
function prefixOf(name){return name.slice(0,name.lastIndexOf('/')+1);}
function mavenPath(name,classifier){if(typeof name!=='string'||name.length>500)throw Error('整合包依赖坐标无效');const [coordinate,extension='jar']=name.split('@'),parts=coordinate.split(':');if(parts.length<3||parts.length>4||!parts.every(x=>/^[A-Za-z0-9_.+~-]+$/.test(x))||!/^\w+$/.test(extension))throw Error('整合包依赖坐标无效：'+name);const [group,artifact,version,ownClassifier]=parts,c=classifier||ownClassifier;return relativeFile(group.replaceAll('.','/')+'/'+artifact+'/'+version+'/'+artifact+'-'+version+(c?'-'+c:'')+'.'+extension);}
function libraryKey(name){const [coordinate,extension='jar']=name.split('@'),[group,artifact,,classifier='']=coordinate.split(':');return [group,artifact,classifier,extension].join(':');}
function cleanroomLibrary(lib,version){if(typeof lib?.name!=='string')return false;const [group,artifact,actual]=lib.name.split('@')[0].split(':');return group==='com.cleanroommc'&&artifact==='cleanroom'&&actual===version;}
function addLibrary(libraries,lib){
 const rules=JSON.stringify(lib.rules||[]),key=lib.name+'|'+rules;
 // Components often split an artifact and its native classifiers into two
 // records with the same coordinate. Preserve both halves and OS rules.
 const old=libraries.get(key);if(old?.name===lib.name){const merged={...old,...lib};if(old.downloads||lib.downloads){merged.downloads={...old.downloads,...lib.downloads};if(old.downloads?.classifiers||lib.downloads?.classifiers)merged.downloads.classifiers={...old.downloads?.classifiers,...lib.downloads?.classifiers};}libraries.set(key,merged);}else libraries.set(key,lib);
}
function applyLibraryPatch(libraries,patch){
 const additions=[];for(const field of ['libraries','+libraries'])if(patch[field]){if(!Array.isArray(patch[field]))throw Error('整合包依赖列表无效');patch[field]=patch[field].map(normalizeLibrary);additions.push(...patch[field]);}
 // A later component replaces an older component's dependency group. Within
 // one component, keep split native records and platform-specific versions.
 const groups=new Set(additions.map(l=>libraryKey(l.name)));for(const [key,lib]of libraries)if(groups.has(libraryKey(lib.name)))libraries.delete(key);
 for(const lib of additions)addLibrary(libraries,lib);
}
function descriptor(input,name,classifier){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('整合包依赖描述无效');const out={...input,path:input.path?relativeFile(input.path):mavenPath(name,classifier)};if(out.url)out.url=httpsURL(String(out.url).replace(/^http:/,'https:'));for(const field of ['sha1','sha256'])if(out[field]&&!new RegExp('^[a-f0-9]{'+(field==='sha1'?40:64)+'}$','i').test(out[field]))throw Error('整合包依赖校验值无效');if(out.size!==undefined&&(!Number.isSafeInteger(out.size)||out.size<0))throw Error('整合包依赖大小无效');return out;}
function normalizeLibrary(input){if(!input||typeof input!=='object'||typeof input.name!=='string')throw Error('整合包依赖坐标无效');mavenPath(input.name);const lib={...input};if(lib.url)lib.url=httpsURL(String(lib.url).replace(/^http:/,'https:'));if(lib.downloads){lib.downloads={...lib.downloads};if(lib.downloads.artifact)lib.downloads.artifact=descriptor(lib.downloads.artifact,lib.name);if(lib.downloads.classifiers){lib.downloads.classifiers={};for(const [key,value]of Object.entries(input.downloads.classifiers)){if(!/^[A-Za-z0-9_.-]+$/.test(key))throw Error('本地依赖分类无效');lib.downloads.classifiers[key]=descriptor(value,lib.name,key);}}}else if(lib['MMC-hint']==='local'){lib.downloads={artifact:{path:mavenPath(lib.name)}};}return lib;}
function javaRequirement(majors,preferred){const allowed=Array.isArray(majors)?[...new Set(majors.map(Number).filter(v=>Number.isInteger(v)&&v>=8&&v<=99))].sort((a,b)=>a-b):[];if(!allowed.length&&Number.isInteger(preferred))allowed.push(preferred);if(!allowed.length)return undefined;const chosen=allowed.includes(preferred)?preferred:allowed.includes(21)?21:allowed[0];return {min:allowed[0],max:allowed.at(-1),preferred:chosen,majors:allowed};}
function argumentList(value,label){if(!Array.isArray(value)||value.some(item=>typeof item!=='string'&&(!item||typeof item!=='object'||!Array.isArray(item.rules)||(typeof item.value!=='string'&&!Array.isArray(item.value)))))throw Error('整合包'+label+'参数无效');return structuredClone(value);}
function libraryMatches(name,removal){const lhs=name.split('@')[0].split(':'),rhs=removal.split('@')[0].split(':');if(rhs.length<2||rhs.length>4)throw Error('整合包移除依赖无效');return lhs[0]===rhs[0]&&lhs[1]===rhs[1]&&(rhs.length<4||lhs[3]===rhs[3]);}
// MultiMC supplies complete component patches; CurseForge supplies ordered deltas
// that are applied only after resolving the installed Minecraft/Forge profile.
function composePatches(baseProfile,patches,preferredJava){
 if(!Array.isArray(patches))throw Error('整合包启动补丁列表无效');
 const sorted=patches.map((p,i)=>({...p,_index:i})).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||a._index-b._index);
 if(baseProfile)sorted.unshift(structuredClone(baseProfile));
 if(!sorted.some(p=>p.mainJar?.downloads?.artifact||p.downloads?.client))throw Error('自定义整合包缺少完整 Minecraft 启动配置');
 const profile={libraries:[],arguments:{jvm:[],game:[]}},libraries=new Map();let tweaks=[],majors;
 for(const patch of sorted){
  if(patch.mainClass){if(typeof patch.mainClass!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(patch.mainClass))throw Error('整合包主类无效');profile.mainClass=patch.mainClass;}
  for(const field of ['assetIndex','assets','type','releaseTime','time','logging'])if(patch[field]!==undefined)profile[field]=structuredClone(patch[field]);
  if(patch.downloads?.client){const client=patch.downloads.client;if(!client.url)throw Error('Minecraft 主文件缺少下载地址');profile.downloads={client:descriptor(client,'com.mojang:minecraft:client')};delete profile.downloads.client.path;}
  if(patch.mainJar?.downloads?.artifact){const client=patch.mainJar.downloads.artifact;if(!client.url)throw Error('Minecraft 主文件缺少下载地址');profile.downloads={client:descriptor(client,patch.mainJar.name||'com.mojang:minecraft:'+patch.version+':client')};delete profile.downloads.client.path;}
  if(patch.minecraftArguments!==undefined){if(typeof patch.minecraftArguments!=='string')throw Error('整合包游戏参数无效');profile.arguments.game=splitArguments(patch.minecraftArguments);}
  if(patch.arguments?.game)profile.arguments.game=argumentList(patch.arguments.game,'游戏');
  if(patch.arguments?.jvm)profile.arguments.jvm.push(...argumentList(patch.arguments.jvm,'Java'));
  if(patch.jvmArgs)profile.arguments.jvm=argumentList(patch.jvmArgs,'Java');
  if(patch['+jvmArgs'])profile.arguments.jvm.push(...argumentList(patch['+jvmArgs'],'Java'));
  if(patch['-jvmArgs']){if(!Array.isArray(patch['-jvmArgs'])||patch['-jvmArgs'].some(x=>typeof x!=='string'))throw Error('整合包移除 Java 参数无效');profile.arguments.jvm=profile.arguments.jvm.filter(x=>typeof x!=='string'||!patch['-jvmArgs'].includes(x));}
  if(patch['-mainClass']!==undefined){if(patch['-mainClass']===true||patch['-mainClass']===profile.mainClass)delete profile.mainClass;}
  if(patch['-libraries']){if(!Array.isArray(patch['-libraries']))throw Error('整合包移除依赖列表无效');for(const item of patch['-libraries']){const name=typeof item==='string'?item:item?.name;if(typeof name!=='string')throw Error('整合包移除依赖无效');for(const [key,lib]of libraries)if(libraryMatches(lib.name,name))libraries.delete(key);}}
  applyLibraryPatch(libraries,patch);
  if(patch.tweakers){if(!Array.isArray(patch.tweakers))throw Error('整合包启动器参数无效');tweaks=[...patch.tweakers];}
  if(patch['+tweakers']){if(!Array.isArray(patch['+tweakers']))throw Error('整合包启动器参数无效');tweaks.push(...patch['+tweakers']);}
  if(patch['-tweakers']){if(!Array.isArray(patch['-tweakers']))throw Error('整合包移除启动器参数无效');tweaks=tweaks.filter(x=>!patch['-tweakers'].includes(x));for(let i=profile.arguments.game.length-2;i>=0;i--)if(profile.arguments.game[i]==='--tweakClass'&&patch['-tweakers'].includes(profile.arguments.game[i+1]))profile.arguments.game.splice(i,2);}
  if(patch.compatibleJavaMajors)majors=patch.compatibleJavaMajors;
 }
 for(const tweak of [...new Set(tweaks)]){if(typeof tweak!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(tweak))throw Error('整合包启动器参数无效');profile.arguments.game.push('--tweakClass',tweak);}
 if(!profile.mainClass||!profile.downloads?.client)throw Error('整合包启动配置不完整');
 profile.libraries=[...libraries.values()];const java=javaRequirement(majors,preferredJava);
 if(java){profile.javaVersion={component:'java-runtime-custom',majorVersion:java.preferred};profile.compatibleJavaMajors=java.majors;}
 return {profile,java};
}
function mapGameFiles(entries,prefixes,excluded=new Set()){
 const map=new Map();for(const prefix of prefixes)for(const entry of entries){if(entry.directory||!entry.name.startsWith(prefix)||excluded.has(entry.name))continue;const relative=entry.name.slice(prefix.length);if(!relative)continue;gamePath(relative);map.set(relative.toLowerCase(),{entry:entry.name,path:relative});}return [...map.values()];
}
function mapLocalLibraries(entries,profile,prefixes){
 if(!profile)return [];
 const mappings=[],used=new Set(),targets=new Set();
 for(const lib of profile.libraries){let a=lib.downloads?.artifact;const basenames=new Set([path.posix.basename(a?.path||mavenPath(lib.name))]);if(a?.url)basenames.add(path.posix.basename(new URL(a.url).pathname));const candidates=entries.filter(e=>!e.directory&&prefixes.some(prefix=>e.name.startsWith(prefix))&&basenames.has(path.posix.basename(e.name)));
  if(candidates.length>1)throw Error('整合包包含有歧义的本地依赖：'+lib.name);
  if(!candidates.length){if(lib['MMC-hint']==='local')throw Error('整合包缺少本地依赖：'+lib.name);continue;}
  if(!a){lib.downloads||={};a=lib.downloads.artifact={path:mavenPath(lib.name)};}
  const entry=candidates[0],dest=a.path||mavenPath(lib.name);if(used.has(entry.name)||targets.has(dest.toLowerCase()))throw Error('本地依赖映射冲突：'+lib.name);
  if(a.size!==undefined&&a.size!==entry.size)throw Error('整合包本地依赖大小与启动配置不符：'+lib.name);
  used.add(entry.name);targets.add(dest.toLowerCase());a.size=entry.size;
  const hashes={...(a.sha1?{sha1:a.sha1}:{}),...(a.sha256?{sha256:a.sha256}:{})};mappings.push({entry:entry.name,path:dest,size:entry.size,...(Object.keys(hashes).length?{hashes}:{})});
 }
 return mappings;
}
function addIcon(gameFiles,entries,name){if(typeof name!=='string'||!name||!/[.]png$/i.test(name))return;const entry=entries.find(e=>!e.directory&&e.name===name&&e.size<=2*1024**2);if(entry){const previous=gameFiles.findIndex(f=>f.path.toLowerCase()==='.starquill-icon.png');if(previous>=0)gameFiles.splice(previous,1);gameFiles.push({entry:name,path:'.starquill-icon.png'});}}
function deltaLibraries(patches){const libraries=new Map();for(const patch of patches){if(patch['-libraries'])for(const removal of patch['-libraries'])for(const [key,lib]of libraries)if(libraryMatches(lib.name,typeof removal==='string'?removal:removal.name))libraries.delete(key);applyLibraryPatch(libraries,patch);}return {libraries:[...libraries.values()]};}

async function inspectPackArchive(file,{signal}={}){
 const entries=await listArchive(file,{signal}),files=entries.filter(e=>!e.directory),byName=new Map(files.map(e=>[e.name,e]));
 const candidates=files.filter(e=>/(?:^|\/)(?:modrinth\.index|manifest|mmc-pack)\.json$/.test(e.name)&&e.name.split('/').length<=4);
 const initial=await readArchiveFiles(file,candidates.map(e=>e.name),{signal,maxFile:MAX_METADATA});
 const recognized=[];for(const entry of candidates){let value;try{value=requiredJSON(initial.get(entry.name),entry.name);}catch{continue;}if(entry.name.endsWith('modrinth.index.json')&&value.formatVersion===1&&value.game==='minecraft')recognized.push({kind:'modrinth',entry,value});if(entry.name.endsWith('manifest.json')&&value.manifestType==='minecraftModpack'&&value.manifestVersion===1)recognized.push({kind:'curseforge',entry,value});if(entry.name.endsWith('mmc-pack.json')&&value.formatVersion===1&&Array.isArray(value.components))recognized.push({kind:'multimc',entry,value});}
 if(recognized.length>1)throw Error('压缩包中包含多个整合包清单，请分别导入');
 if(!recognized.length)return inspectGTNHClient(file,entries,byName,signal);
 const {kind,entry,value:m}=recognized[0],root=prefixOf(entry.name);
 if(kind==='modrinth'){
  if(!Array.isArray(m.files)||typeof m.dependencies?.minecraft!=='string')throw Error('Modrinth 整合包清单无效');versionName(m.dependencies.minecraft);
  const loaders=Object.entries(m.dependencies).filter(([key])=>key!=='minecraft');if(loaders.length>1)throw Error('整合包包含多个加载器，暂不支持');const [key,version]=loaders[0]||[],loader=({'fabric-loader':'fabric',forge:'forge',neoforge:'neoforge'})[key];if(key==='cleanroom')throw Error('Cleanroom 整合包缺少完整启动补丁，请导入完整 MultiMC/Prism 包');if(key&&!loader)throw Error('暂不支持整合包加载器 '+key);if(version)versionName(version);
  const selected=m.files.filter(f=>f.env?.client!=='unsupported'&&f.env?.client!=='optional').map(f=>{gamePath(f.path);if(!Array.isArray(f.downloads)||!f.downloads.length)throw Error('整合包文件缺少下载地址');const urls=f.downloads.map(httpsURL),item={path:f.path,original:path.posix.basename(f.path),urls,url:urls[0],hashes:f.hashes,size:f.fileSize};if(!expectedHash(item))throw Error('整合包文件缺少校验值');return item;});uniqueFiles(selected.map(f=>f.path));const overrides=[root+'overrides/',root+'client-overrides/'];
  return {format:kind,name:m.name||'Modrinth 整合包',game:m.dependencies.minecraft,loader,version,files:selected,overrides,optional:m.files.filter(f=>f.env?.client==='optional').length,gameFiles:mapGameFiles(entries,overrides),localLibraries:[]};
 }
 if(kind==='curseforge'){
  if(!Array.isArray(m.files)||typeof m.minecraft?.version!=='string')throw Error('CurseForge 整合包清单无效');versionName(m.minecraft.version);const loaders=m.minecraft.modLoaders||[];if(!Array.isArray(loaders)||loaders.length>1)throw Error('整合包包含多个加载器，暂不支持');const selected=loaders[0]?.id,match=selected&&/^(forge|neoforge|fabric|cleanroom)-(.+)$/.exec(selected);if(selected&&!match)throw Error('暂不支持整合包加载器 '+selected);if(match)versionName(match[2]);
  const override=String(m.overrides||'overrides').replace(/\/$/,'');relativeFile(override);const overridePrefix=root+override+'/',patchNames=m.minecraft.patches||[];if(!Array.isArray(patchNames)||patchNames.some(p=>typeof p!=='string'))throw Error('整合包补丁列表无效');
  const patchEntries=patchNames.map(p=>{relativeFile(p);const name=overridePrefix+p;if(!byName.has(name)||!/^patches\/[^/]+\.json$/.test(p))throw Error('整合包缺少或含无效启动补丁：'+p);return name;});const patchBuffers=await readArchiveFiles(file,patchEntries,{signal,maxFile:MAX_METADATA});const patches=patchEntries.map(name=>requiredJSON(patchBuffers.get(name),name));
  if(match?.[1]==='cleanroom'&&(m.minecraft.version!=='1.12.2'||!patches.some(p=>p.mainClass==='top.outlands.foundation.boot.Foundation'&&[...(p.libraries||[]),...(p['+libraries']||[])].some(l=>cleanroomLibrary(l,match[2])))))throw Error('Cleanroom 整合包缺少完整启动补丁，请导入完整 MultiMC/Prism 包');
  const localLibraries=mapLocalLibraries(entries,deltaLibraries(patches),[overridePrefix+'libraries/']);const used=new Set([...patchEntries,...localLibraries.map(l=>l.entry)]);
  // Only launcher-declared JAR dependencies may cross into the shared library cache.
  for(const item of files)if(item.name.startsWith(overridePrefix+'libraries/')&&!used.has(item.name))throw Error('整合包包含未在启动配置中声明的依赖：'+item.name);
  const gameFiles=mapGameFiles(entries,[overridePrefix],used);addIcon(gameFiles,entries,typeof m.image==='string'?root+m.image:'');
  let declaredMajors=patches.findLast(p=>Array.isArray(p.compatibleJavaMajors))?.compatibleJavaMajors;
  // GTNH's CurseForge delta format records its recommended JVM only. Its
  // matching 2.9.0 MultiMC components explicitly support these four JVMs.
  if(!declaredMajors&&m.version==='2.9.0'&&/^GT\s*New\s*Horizons$/i.test(m.name||'')&&m.minecraft.version==='1.7.10'&&match?.[2]==='10.13.4.1614'&&patches.some(p=>p.mainClass==='com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread')&&patches.some(p=>p['+libraries']?.some(l=>l.name==='com.github.GTNewHorizons:lwjgl3ify:3.0.42:forgePatches')))declaredMajors=[17,21,25,26];
  const java=javaRequirement(declaredMajors,Number(m.minecraft.javaVersion));
  if(match?.[1]==='cleanroom'&&!java)throw Error('Cleanroom 启动补丁缺少 Java 兼容范围');
  return {format:kind,name:m.name||'CurseForge 整合包',game:m.minecraft.version,loader:match?.[1],version:match?.[2],files:m.files.filter(f=>f.required!==false).map(f=>{if(!/^\d+$/.test(String(f.projectID))||!/^\d+$/.test(String(f.fileID)))throw Error('整合包项目或文件编号无效');return {projectId:String(f.projectID),versionId:String(f.fileID)};}),overrides:[overridePrefix],optional:m.files.filter(f=>f.required===false).length,...(patches.length?{profilePatches:patches}:{}),...(match?.[1]==='cleanroom'?{patchBase:'vanilla'}:{}),java,memory:Number.isFinite(m.minecraft.recommendedRam)?Math.ceil(m.minecraft.recommendedRam/1024):undefined,localLibraries,gameFiles};
 }
 const components=m.components;if(components.length>64)throw Error('MultiMC 组件数量超过限制');const minecraft=components.find(c=>c.uid==='net.minecraft');if(!minecraft||typeof minecraft.version!=='string')throw Error('MultiMC 整合包缺少 Minecraft 版本');versionName(minecraft.version);
 const loaderComponents=components.filter(c=>['net.minecraftforge','net.neoforged','net.fabricmc.fabric-loader'].includes(c.uid));if(loaderComponents.length>1)throw Error('整合包包含多个加载器，暂不支持');const component=loaderComponents[0];let loader=({'net.minecraftforge':'forge','net.neoforged':'neoforge','net.fabricmc.fabric-loader':'fabric'})[component?.uid];if(component?.version)versionName(component.version);
 const patchesInArchive=files.filter(e=>e.name.startsWith(root+'patches/')&&/^patches\/[^/]+\.json$/.test(e.name.slice(root.length))).map(e=>e.name),instance=root+'instance.cfg';const data=await readArchiveFiles(file,[...patchesInArchive,...(byName.has(instance)?[instance]:[])],{signal,maxFile:MAX_METADATA});const patches=patchesInArchive.map(name=>requiredJSON(data.get(name),name));
 for(const custom of components.filter(c=>!['net.minecraft','net.minecraftforge','net.neoforged','net.fabricmc.fabric-loader','org.lwjgl','org.lwjgl3'].includes(c.uid)))if(!patches.some(p=>p.uid===custom.uid))throw Error('整合包缺少自定义组件补丁：'+custom.uid);
 const cleanroomPatch=minecraft.version==='1.12.2'&&component?.uid==='net.minecraftforge'&&patches.find(p=>p.uid==='net.minecraftforge'&&p.name==='Cleanroom'&&p.version===component.version&&p.mainClass==='top.outlands.foundation.boot.Foundation'&&p.libraries?.some(l=>cleanroomLibrary(l,component.version)));
 if(cleanroomPatch)loader='cleanroom';
 let composed={};
 if(patches.length){
  if(patches.some(p=>p.mainJar?.downloads?.artifact||p.downloads?.client))composed=composePatches(null,patches);
  else if(cleanroomPatch){const majors=patches.findLast(p=>Array.isArray(p.compatibleJavaMajors))?.compatibleJavaMajors,explicit=Number(cleanroomPatch.javaVersion?.majorVersion||cleanroomPatch.javaVersion),java=javaRequirement(majors,explicit);if(!java)throw Error('Cleanroom 启动补丁缺少 Java 兼容范围');composed={profilePatches:patches,patchBase:'vanilla',java};}
  else throw Error('自定义整合包缺少完整 Minecraft 启动配置');
 }
 const settings=cfg(data.get(instance)),possible=[root+'.minecraft/',root+'minecraft/'].filter(prefix=>files.some(e=>e.name.startsWith(prefix)));if(possible.length>1||!possible.length&&!cleanroomPatch)throw Error('MultiMC 整合包游戏目录不明确');const localLibraries=mapLocalLibraries(entries,composed.profile||deltaLibraries(composed.profilePatches||[]),[root+'libraries/']);const gameFiles=mapGameFiles(entries,possible);
 if(settings.iconKey&&/^[A-Za-z0-9_. -]{1,100}$/.test(settings.iconKey))addIcon(gameFiles,entries,root+settings.iconKey+'.png');
 return {format:kind,name:settings.name||root.replace(/\/$/,'').split('/').at(-1)||'MultiMC 整合包',game:minecraft.version,loader,version:component?.version,files:[],overrides:possible,optional:0,...composed,localLibraries,gameFiles,memory:settings.OverrideMemory==='true'&&Number(settings.MaxMemAlloc)>0?Math.ceil(Number(settings.MaxMemAlloc)/1024):undefined};
}
async function inspectGTNHClient(file,entries,byName,signal){
 const banners=entries.filter(e=>!e.directory&&e.name.endsWith('config/txloader/load/mainmenu/version.txt'));
 for(const banner of banners){const prefix=banner.name.slice(0,-'config/txloader/load/mainmenu/version.txt'.length),mods=entries.filter(e=>!e.directory&&e.name.startsWith(prefix+'mods/')&&/^mods\/[^/]+\.jar$/i.test(e.name.slice(prefix.length)));
  if(!mods.some(e=>/^gtnhlib-[^/]+\.jar$/i.test(path.posix.basename(e.name)))||!mods.some(e=>/^gregtech-[^/]+\.jar$/i.test(path.posix.basename(e.name)))||!mods.some(e=>/^gtnhcredits-[^/]+\.jar$/i.test(path.posix.basename(e.name)))||!byName.has(prefix+'config/gtnh-credits/gtnh-credits.cfg'))continue;
  const data=await readArchiveFiles(file,[banner.name],{signal,maxFile:65536}),match=/^GTNH\s+([0-9][A-Za-z0-9._+-]*)\s*(?:\([^\r\n]*\))?\s*$/.exec(data.get(banner.name).toString('utf8').trim());if(!match)continue;
  if(mods.some(e=>/^lwjgl3ify-[^/]+\.jar$/i.test(path.posix.basename(e.name))))throw Error('此 GTNH 现代 Java 客户端缺少启动补丁，请导入完整 MultiMC/Prism 或 CurseForge 包');
  return {format:'gtnh-client',name:'GT New Horizons '+match[1]+' (Java 8)',packVersion:match[1],game:'1.7.10',loader:'forge',version:'10.13.4.1614',java:{min:8,max:8,preferred:8,majors:[8]},files:[],overrides:[prefix],optional:0,localLibraries:[],gameFiles:mapGameFiles(entries,[prefix])};
 }
 throw Error('未识别此整合包：支持 Modrinth、CurseForge、MultiMC/Prism 及带版本信息的 GTNH 客户端 ZIP');
}
module.exports={inspectPackArchive,composePatches,mavenPath,gamePath};
