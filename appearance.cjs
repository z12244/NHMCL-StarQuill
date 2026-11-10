const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {readSkin,textureURL}=require('./skins.cjs');
const {noLinks}=require('./content-utils.cjs');
const {writeJSON}=require('./storage.cjs');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const CACHE_TTL=300000,MAX_TEXTURE=2*1024*1024,MAX_CACHE=6*1024*1024;
const jobs=new Map();

function allowedTexture(value,domains){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!Array.isArray(domains)||!domains.some(d=>typeof d==='string'&&(d.startsWith('.')?u.hostname.endsWith(d)&&u.hostname!==d.slice(1):u.hostname===d)))throw Error('皮肤站返回了未声明的纹理地址');
  return u.href;
}
async function bytes(fetcher,url,max,signal){
  signal?.throwIfAborted();
  const timeout=AbortSignal.timeout(12000);
  // Appearance requests never carry the account's access token or password.
  const r=await fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});
  if(!r.ok)throw Error('纹理服务暂不可用');
  let size=0;const parts=[];
  for await(const c of r.body||[]){signal?.throwIfAborted();size+=c.length;if(size>max)throw Error('纹理响应过大');parts.push(Buffer.from(c));}
  signal?.throwIfAborted();return Buffer.concat(parts);
}
function png(b,cape=false){
  if(!Buffer.isBuffer(b)||b.length<33||b.length>MAX_TEXTURE||!b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||b.toString('ascii',12,16)!=='IHDR')throw Error('无效 PNG');
  const w=b.readUInt32BE(16),h=b.readUInt32BE(20);
  if(cape?!(w>=64&&w<=1024&&h===w/2):!(w===64&&(h===64||h===32)))throw Error('不支持的纹理尺寸');
  return 'data:image/png;base64,'+b.toString('base64');
}
const cachePath=(root,a)=>path.join(path.resolve(root),'.starquill','appearance',digest(a.id+JSON.stringify(a.skin||null))+'.json');
function checkedValue(value){
  if(!value||typeof value.skin!=='string'||!value.skin.startsWith('data:image/png;base64,'))throw Error('外观缓存无效');
  const result={skin:png(Buffer.from(value.skin.slice(22),'base64')),cape:null,model:value.model==='slim'?'slim':'default',default:value.default===true,name:typeof value.name==='string'?value.name.slice(0,180):''};
  if(value.cape){if(typeof value.cape!=='string'||!value.cape.startsWith('data:image/png;base64,'))throw Error('披风缓存无效');result.cape=png(Buffer.from(value.cape.slice(22),'base64'),true);}
  if(typeof value.warning==='string')result.warning=value.warning.slice(0,300);
  return result;
}
async function readCached(root,a){
  try{
    const file=cachePath(root,a);await noLinks(path.resolve(root),file);
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>MAX_CACHE)return null;
    const saved=JSON.parse(await fs.readFile(file,'utf8'));if(!Number.isFinite(saved.time))return null;
    return {time:saved.time,value:checkedValue(saved.value)};
  }catch{return null;}
}
async function localAppearance(root,a){
  if(a.type!=='offline'||!a.skin)return null;
  const skin=png(await readSkin(root,a.skin));
  return {skin,cape:null,model:a.skin.model==='slim'?'slim':'default',default:false,name:a.skin.sourceName||a.name||'本地皮肤'};
}
async function cachedAppearance(root,a){
  // A manually imported skin is authoritative; an older rendered cache can
  // never replace it, and this path never contacts an external skin service.
  if(a.type==='offline'){
    if(!a.skin)return null;
    try{return await localAppearance(root,a);}catch{return null;}
  }
  return (await readCached(root,a))?.value||null;
}
async function defaultAppearance(a){
  const model=a.skin?.model==='slim'?'slim':'default',name=model==='slim'?'Alex':'Steve';
  return {skin:png(await fs.readFile(path.join(__dirname,'assets',name.toLowerCase()+'.png'))),cape:null,model,default:true,name};
}
const warn=(result,text)=>({...result,warning:result.warning?result.warning+'；'+text:text});
async function appearance(root,a,fetcher=fetch,options={}){
  const fallback=await defaultAppearance(a);
  if(a.type==='offline'){
    if(!a.skin)return fallback;
    try{return await localAppearance(root,a);}catch{return warn(fallback,'本地皮肤暂不可用，请重新添加皮肤');}
  }
  const file=cachePath(root,a),saved=await readCached(root,a),age=saved?Date.now()-saved.time:Infinity;
  if(!options.force&&age>=0&&age<CACHE_TTL)return saved.value;
  if(jobs.has(file))return jobs.get(file);
  const job=(async()=>{
    try{
      options.signal?.throwIfAborted();
      let profile,domains=['textures.minecraft.net'];
      if(a.type==='authlib'){
        const base=require('./yggdrasil.cjs').endpoint(a.server.url);
        const meta=JSON.parse((await bytes(fetcher,base,1048576,options.signal)).toString());
        domains=Array.isArray(meta.skinDomains)?meta.skinDomains:[];
        profile=JSON.parse((await bytes(fetcher,base+'sessionserver/session/minecraft/profile/'+a.uuid,1048576,options.signal)).toString());
      }else if(a.type==='microsoft'){
        profile=JSON.parse((await bytes(fetcher,'https://sessionserver.mojang.com/session/minecraft/profile/'+a.uuid,1048576,options.signal)).toString());
      }else return fallback;
      const prop=profile.properties?.find(p=>p.name==='textures');
      const textures=prop?JSON.parse(Buffer.from(prop.value,'base64').toString()).textures:{};
      let result={...fallback};
      if(textures?.SKIN){
        try{
          const u=a.type==='authlib'?allowedTexture(textures.SKIN.url,domains):textureURL(textures.SKIN.url);
          result.skin=png(await bytes(fetcher,u,MAX_TEXTURE,options.signal));
          result.model=textures.SKIN.metadata?.model==='slim'?'slim':'default';result.default=false;result.name=a.name;
        }catch{
          if(saved?.value)result={...saved.value,cape:null};
          result=warn(result,saved?.value?'皮肤未能更新，显示缓存皮肤':'未获取到皮肤，显示默认角色');
        }
      }
      if(textures?.CAPE){
        try{
          const u=a.type==='authlib'?allowedTexture(textures.CAPE.url,domains):textureURL(textures.CAPE.url);
          result.cape=png(await bytes(fetcher,u,MAX_TEXTURE,options.signal),true);
        }catch{if(saved?.value.cape)result.cape=saved.value.cape;result=warn(result,'披风暂时无法读取'+(result.cape?'，显示缓存披风':''));}
      }
      options.signal?.throwIfAborted();
      // A successful profile without CAPE/SKIN clears the former appearance.
      // Save failures do not discard an appearance that was already fetched.
      try{await noLinks(path.resolve(root),file);await writeJSON(file,{time:Date.now(),value:result});}catch{result=warn(result,'外观已读取，但未能保存本地缓存');}
      return result;
    }catch{
      if(saved?.value)return warn(saved.value,'未能更新外观，显示缓存外观');
      return warn(fallback,'未获取到皮肤，显示默认角色');
    }
  })();
  jobs.set(file,job);try{return await job;}finally{if(jobs.get(file)===job)jobs.delete(file);}
}
module.exports={appearance,cachedAppearance,allowedTexture,png,bytes};
