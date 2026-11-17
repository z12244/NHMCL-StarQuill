const fs=require('node:fs/promises'), path=require('node:path'), {randomUUID}=require('node:crypto');
const {layout,resolveVersion,readJSON,writeJSON}=require('./storage.cjs');
const {hashFile,expectedHash}=require('./downloads.cjs');
const {exists,noLinks}=require('./content-utils.cjs');

async function matches(file,descriptor={}) {
 let stat;try{stat=await fs.stat(file);}catch(e){if(e.code==='ENOENT')return false;throw e;}
 if(!stat.isFile()||!stat.size||(descriptor.size!=null&&stat.size!==descriptor.size))return false;
 const hash=expectedHash(descriptor);
 return !hash||await hashFile(file,hash.algorithm)===hash.value;
}

// Keep the installer's working vanilla profile private. Reuse an existing vanilla
// install read-only, or a previously embedded client with the official digest.
async function preparePackBase(loaders,stage,game,signal,javaOverride) {
 const root=loaders.root,installed=layout(root,game),base=layout(stage,game);
 const cache=path.join(root,'.starquill','vanilla-metadata',game+'.json');
 await noLinks(root,installed.json);await noLinks(root,cache);
 let raw;
 for(const file of [installed.json,cache]){
  try{const r=await readJSON(file);if(r.id===game&&!r.inheritsFrom&&!r.jar&&!r.starQuill&&!require('./loaders.cjs').loaderInfo(r).loader){raw=r;break;}}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 }
 if(raw)await writeJSON(base.json,raw);
 const engine=loaders.gameEngine(stage,game,signal),{meta}=await engine.resolve();
 const java=await loaders.chooseJava(javaOverride??require('./java.cjs').javaRequirement(meta));
 const client=meta.downloads?.client||{};
 if(!raw&&meta.id===game)await writeJSON(cache,meta);
 // Do not hard-link the final instance to an existing installation: another
 // launcher's repair operation must not be able to alter both clients in place.
 async function copyMatch(source){await noLinks(root,source);if(!await matches(source,client))return false;await fs.copyFile(source,base.jar);return true;}
 await fs.mkdir(base.version,{recursive:true});
 if(!await copyMatch(installed.jar)&&expectedHash(client)){
  const versions=path.join(root,'versions');
  for(const dir of await fs.readdir(versions,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
   signal?.throwIfAborted();if(!dir.isDirectory()||dir.name===game)continue;
   const p=layout(root,dir.name);if(!await exists(path.join(p.version,'starquill-pack.json')))continue;
   if(await copyMatch(p.jar))break;
  }
 }
 await engine.downloads.init();await engine.downloads.ensure({...client,file:base.jar});
 return java;
}

async function embedPack(root,id,game,{sourceId=id,allowDownload=false}={}) {
 const dest=layout(root,id);await noLinks(root,dest.json);await noLinks(root,dest.jar);
 const {meta,chain,raw}=await resolveVersion(root,sourceId),own=layout(root,sourceId).jar;
 const profile={...meta,id,starQuill:{...meta.starQuill,game,isolate:true}};
 delete profile.inheritsFrom;delete profile.jar;delete profile.starQuill.base;
 // MultiMC puts architecture-qualified aliases in an OS map. Older HMCL
 // parses its keys as an enum: two unrecognised keys invalidate the entire
 // version. Keep the extension data and all download descriptors, but only
 // publish Mojang's OS keys in natives (our supported client is Windows x64).
 for(const lib of profile.libraries||[])if(lib.natives){
  const aliases=Object.entries(lib.natives).filter(([os])=>!['windows','linux','osx'].includes(os));
  if(aliases.length){lib.starQuillNativeAliases={...lib.starQuillNativeAliases,...Object.fromEntries(aliases)};
   lib.natives=Object.fromEntries(Object.entries(lib.natives).filter(([os])=>!Object.hasOwn(lib.starQuillNativeAliases,os)));}
 }
 const client=profile.downloads?.client||{};
 const owner=meta.jar||chain.filter(v=>v.raw.downloads?.client).at(-1)?.id||chain[0].id;
 // A loader can supply its own patched jar without a downloads.client entry.
 // Never replace those bytes with the parent's vanilla client during repair.
 await noLinks(root,own);
 if(!raw.downloads?.client&&await exists(own)&&!await matches(own,client)){
  profile.downloads={...profile.downloads};delete profile.downloads.client;
 }
 const expected=profile.downloads?.client||{};
 const explicitOwn=!raw.downloads?.client&&await exists(own);
 let ready=(!explicitOwn||own===dest.jar)&&await matches(dest.jar,expected);
 for(const candidate of [...new Set([own,layout(root,owner).jar,layout(root,game).jar])]){
  if(ready)break;if(candidate===dest.jar)continue;
  await noLinks(root,candidate);if(!await matches(candidate,expected))continue;
  const tmp=dest.jar+'.'+randomUUID()+'.tmp';
  try{await fs.copyFile(candidate,tmp);if(!allowDownload&&await exists(dest.jar))throw Error('现有客户端与版本校验不符，已保留原文件');
   await fs.rename(tmp,dest.jar);ready=true;
  }finally{await fs.rm(tmp,{force:true});}
 }
 if(!ready&&(!allowDownload||!expected.url))throw Error('缺少与整合包匹配的 Minecraft 客户端：'+id);
 if(profile.arguments?.jvm)profile.arguments.jvm=profile.arguments.jvm.map(a=>
  typeof a==='string'&&a.startsWith('-DignoreList=')&&!a.slice(13).split(',').includes('${version_name}.jar')?a+',${version_name}.jar':a);
 await writeJSON(dest.json,profile);
}

async function hmclIsolation(root,id){
 const file=path.join(layout(root,id).version,'hmclversion.cfg');await noLinks(root,file);
 // Keep settings supplied by the pack author or previously edited by the player.
 try{await fs.writeFile(file,JSON.stringify({usesGlobal:false,gameDirType:1}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
}
module.exports={preparePackBase,embedPack,hmclIsolation};
