const fs=require('node:fs/promises'),path=require('node:path');
const {layout}=require('./storage.cjs');
const {noLinks}=require('./content-utils.cjs');
const {iconURL}=require('./resource-icons.cjs');
const LIMIT=2*1024*1024;
function imageMime(bytes){
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);return width&&height&&width<=4096&&height<=4096?'image/png':null;}
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
}
async function smallJSON(root,file){try{await noLinks(root,file);const stat=await fs.stat(file);if(!stat.isFile()||stat.size>128*1024)return null;return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
async function readInstanceIcon(root,id,loadRemote=async()=>null){
  const folder=layout(root,id).version;
  await noLinks(root,folder);
  const config=await smallJSON(root,path.join(folder,'.starquill-settings.json'));
  const pack=await smallJSON(root,path.join(folder,'starquill-pack.json'));
  const hmcl=await smallJSON(root,path.join(folder,'hmclversion.cfg'));
  const candidates=[config?.iconFile,pack?.iconFile,hmcl?.iconFile,hmcl?.icon,'.starquill-icon.png','icon.png','instance.png','PCL/Logo.png','PCL/logo.png'];
  const checked=new Set();
  for(const value of candidates){
    if(typeof value!=='string'||value.length>1024||!/^.*\.(png|jpe?g|webp)$/i.test(value)||/^[a-z]+:\/\//i.test(value))continue;
    const file=path.resolve(folder,value),relative=path.relative(folder,file);
    if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative)||checked.has(file))continue;
    checked.add(file);
    try{await noLinks(root,file);const stat=await fs.stat(file);if(!stat.isFile()||stat.size<12||stat.size>LIMIT)continue;const bytes=await fs.readFile(file),mime=imageMime(bytes);if(mime)return 'data:'+mime+';base64,'+bytes.toString('base64');}catch{}
  }
  const url=iconURL(pack?.icon||pack?.iconUrl);
  if(url)try{const value=await loadRemote(url);if(typeof value==='string'&&/^data:image\/(png|jpeg|webp);base64,/i.test(value)){const bytes=Buffer.from(value.slice(value.indexOf(',')+1),'base64');if(bytes.length<=LIMIT&&imageMime(bytes)){const cache=path.join(folder,'.starquill-icon.png');try{await noLinks(root,cache);await fs.writeFile(cache,bytes,{flag:'wx'});}catch{}}}return value;}catch{}
  return null;
}
module.exports={readInstanceIcon,imageMime};
