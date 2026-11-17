const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {expectedHash,hashFile}=require('./downloads.cjs');
const {cacheFile}=require('./content-install.cjs');
const {under,versionName}=require('./storage.cjs');
const {relativeFile,noLinks,httpsURL}=require('./content-utils.cjs');
const kinds=new Map([['mods','mod'],['resourcepacks','resourcepack'],['shaderpacks','shader']]);

// GTNH's DreamAssemblerXXL gtnh-assets.json records this CurseForge file ID.
// Both official 2.9.0 client archives contain these exact FairPlay bytes.
const publishedPins = new Map([
  ['32274:8879298', {
    title: 'JourneyMap', game: '1.7.10', loader: 'forge', project: 'lfHFW1mp',
    filename: 'journeymap-1.7.10-5.2.23-fairplay.jar',
    sha512: 'cd153033fe29cbab83bb945734ac993a926c58c8a0bf95ed62b823e7bea6863f70b4b4ab9bc7da9344874e8f925397dfd540a46a168edc2a4be64d7b8260d084'
  }]
]);

async function publishedPinnedFile(resources, pin, pack, project, signal) {
  const entry = publishedPins.get(pin.projectId + ':' + pin.versionId);
  if (!entry || entry.game !== pack.game || entry.loader !== pack.loader || (project && project.kind !== 'mod')) return null;
  const version = await resources.mr('/version_file/' + entry.sha512 + '?algorithm=sha512', signal);
  if (version?.project_id !== entry.project || !version.game_versions?.includes(entry.game) || !version.loaders?.includes(entry.loader)) return null;
  const file = version.files?.find(f => f.filename === entry.filename && f.hashes?.sha512 === entry.sha512);
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1) return null;
  return {
    project: project || {id: String(pin.projectId), source: 'curseforge', title: entry.title, kind: 'mod'},
    versionId: String(pin.versionId), version: version.version_number, original: entry.filename,
    filename: entry.filename, path: 'mods/' + entry.filename, url: httpsURL(file.url),
    size: file.size, hashes: {sha512: entry.sha512}, reason: '作者在 Modrinth 发布的同一文件'
  };
}

// A missing provider record is not permission to install a different revision.
// Index only local install receipts; an entry is usable only after verifying its bytes.
async function receipts(root,signal){
 const result=new Map(),dirs=[root],versions=under(root,'versions');
 await noLinks(root,versions);
 for(const e of await fs.readdir(versions,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
   if(e.isDirectory()&&!e.isSymbolicLink())dirs.push(path.join(versions,e.name));
 }
 for(const dir of dirs){
   signal?.throwIfAborted();
   const receipt=path.join(dir,'.starquill-content.json');
   try{
     await noLinks(root,receipt);const stat=await fs.lstat(receipt);
     if(!stat.isFile()||stat.size>8*1024*1024)continue;
     const doc=JSON.parse(await fs.readFile(receipt,'utf8'));
     if(!Array.isArray(doc.files))continue;
     for(const row of doc.files){
       if(!row||row.source!=='curseforge'||!/^\d+$/.test(row.projectId)||!/^\d+$/.test(row.versionId))continue;
       const key=row.projectId+':'+row.versionId;
       if(!result.has(key))result.set(key,[]);
       result.get(key).push({dir,row});
     }
   }catch{/* Missing, unreadable or obsolete receipts are not authoritative. */}
 }
 return result;
}
async function verified(root,file,h,size){
 await noLinks(root,file);
 try{const stat=await fs.lstat(file);return stat.isFile()&&stat.size===size&&await hashFile(file,h.algorithm)===h.value;}
 catch(e){if(e.code==='ENOENT')return false;throw e;}
}
function localPinnedResolver(root){
 let index;
 return async function find(pin,project,signal){
   signal?.throwIfAborted();index??=receipts(root,signal);
   for(const {dir,row} of (await index).get(pin.projectId+':'+pin.versionId)||[]){
     signal?.throwIfAborted();
     let h,local,folder,kind;
     try{
       versionName(row.original);
       const parts=relativeFile(row.path).split('/');folder=parts[0];kind=kinds.get(folder);
       if(parts.length!==2||!kind||project&&project.kind!==kind||!Number.isSafeInteger(row.size)||row.size<=0)continue;
       if(!(kind==='mod'?/\.jar$/i:/\.zip$/i).test(row.original))continue;
       h=expectedHash(row);if(!h||h.algorithm==='md5')continue;local=under(dir,row.path);
     }catch{continue;}
     const item={project:project||{id:String(pin.projectId),source:'curseforge',title:row.original,kind},versionId:String(pin.versionId),
       original:row.original,filename:row.original,path:folder+'/'+row.original,hashes:{[h.algorithm]:h.value},size:row.size,
       url:null,cached:true,reason:'复用已校验的本地锁定版本'};
     const dest=cacheFile(root,item);
     if(await verified(root,dest,h,row.size))return item;
     let fileOK;try{fileOK=await verified(root,local,h,row.size);}catch{continue;}if(!fileOK)continue;
     await fs.mkdir(path.dirname(dest),{recursive:true});const pending=dest+'.'+crypto.randomUUID()+'.tmp';
     try{await fs.copyFile(local,pending);if(!await verified(root,pending,h,row.size))continue;signal?.throwIfAborted();await fs.rename(pending,dest);return item;}
     finally{await fs.rm(pending,{force:true});}
   }
   return null;
 };
}
module.exports={localPinnedResolver,publishedPinnedFile};
