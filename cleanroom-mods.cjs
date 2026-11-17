const fs=require('node:fs/promises'),path=require('node:path');
const {noLinks,exists}=require('./content-utils.cjs');
const {readModMetadata}=require('./mod-metadata.cjs');
const scalarUrl='https://edge.forgecdn.net/files/6842/491/Scalar%20Legacy-1.0.1.jar';
// The Cleanroom client installation guide requires Fugue and Scalar Legacy for its bare template.
const requirements=[
  {modId:'fugue',project:{source:'modrinth',id:'vylTACsh',kind:'mod',title:'Fugue'},versionId:'ijk8Zy92',
   original:'+Fugue-0.25.5.jar',size:313503,url:'https://cdn.modrinth.com/data/vylTACsh/versions/ijk8Zy92/%2BFugue-0.25.5.jar',
   hashes:{sha512:'5aa60964b586f4d0cedff6bb066c2c648bb93f05a578a448e3aed27171e6e5ee7b8089109ae3501856d202cfbdc4729e7b1cd895880b90c9733a1be32e54ac65'}},
  {modId:'scalar',project:{source:'curseforge',id:'1235372',kind:'mod',title:'Scalar Legacy'},versionId:'6842491',
   original:'Scalar Legacy-1.0.1.jar',size:25464431,url:scalarUrl,urls:require('./curseforge-access.cjs').downloadSources(scalarUrl,true),
   hashes:{sha512:'9561f0296d9e6e15034bbf5288085deed2e9e0df2f4272e1d51269e2a3c16320fdd41b307a4ab5bbb8bb03b9d9242d4c69a4795f4d2ac5d3ed85a9ac2bf132a7'}}
];
function isTemplate(pack) {
  return pack?.loader==='cleanroom' && pack.format==='multimc' && pack.game==='1.12.2' &&
    pack.name==='Cleanroom '+(pack.version||pack.loaderVersion) && pack.java?.min>=25;
}
function defaultFiles(pack) {
  if(!isTemplate(pack) || pack.gameFiles?.some(f=>/^mods\//i.test(f.path)))return [];
  return requirements.map(r=>({...r,filename:r.original,path:'mods/'+r.original,reason:'Cleanroom 客户端前置模组'}));
}
async function repairTemplate(root,folder,downloads) {
  const packFile=path.join(folder,'starquill-pack.json'),marker=path.join(folder,'.starquill-cleanroom-deps-v1');
  await noLinks(root,packFile);await noLinks(root,marker);
  if(await exists(marker)||!await exists(packFile))return;
  const pack=JSON.parse(await fs.readFile(packFile,'utf8'));
  if(!isTemplate(pack)||pack.cleanroomDefaults===true)return;
  const mods=path.join(folder,'mods');
  await noLinks(root,mods);await fs.mkdir(mods,{recursive:true});
  const known=new Set();
  for(const entry of await fs.readdir(mods,{withFileTypes:true})){
    if(!entry.isFile()||!(/\.jar(?:\.disabled)?$/i.test(entry.name)))continue;
    for(const id of readModMetadata(path.join(mods,entry.name)).ids)known.add(id);
  }
  for(const r of requirements){
    if(known.has(r.modId))continue;
    const file=path.join(mods,r.original);await noLinks(root,file);
    if(await exists(file) && !await downloads.valid({...r,file}))throw Error('已有文件与 Cleanroom 前置模组不符：'+r.original);
    await downloads.ensure({...r,file});
  }
  await fs.writeFile(marker,'1',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
}
module.exports={defaultFiles,repairTemplate};
