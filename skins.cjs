const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const AGENT_SHA256='9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const cacheFile=(root,h)=>{if(!/^[a-f0-9]{64}$/.test(h||''))throw Error('皮肤缓存编号无效');return path.join(root,'.starquill','skins',h+'.png');};
function textureURL(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.hostname!=='textures.minecraft.net'||u.username||u.password||u.port||!/^\/texture\/[a-f0-9]{32,64}$/i.test(u.pathname)||u.search||u.hash)throw Error('皮肤地址不是官方 Minecraft 纹理地址');u.protocol='https:';return u.href;}
function validatePNG(b){if(b.length<33||b.length>2*1024*1024||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b.toString('ascii',12,16)!=='IHDR'||b.readUInt32BE(16)!==64||![32,64].includes(b.readUInt32BE(20)))throw Error('皮肤须为官方 64×64 或 64×32 PNG 图片');return b;}
async function fetchLimited(fetcher,url,max=2*1024*1024){const r=await fetcher(url,{signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error('读取正版皮肤失败（HTTP '+r.status+'），请确认玩家名和网络。');const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>max)throw Error('皮肤响应过大');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
async function lookupSkin(root,name,fetcher=fetch){
  if(typeof name!=='string'||!/^[A-Za-z0-9_]{3,16}$/.test(name))throw Error('请输入正确的正版玩家名');
  const profile=JSON.parse((await fetchLimited(fetcher,'https://api.mojang.com/users/profiles/minecraft/'+encodeURIComponent(name),65536)).toString());
  if(!/^[0-9a-f]{32}$/i.test(profile.id||''))throw Error('未找到此正版玩家');
  const session=JSON.parse((await fetchLimited(fetcher,'https://sessionserver.mojang.com/session/minecraft/profile/'+profile.id+'?unsigned=false',131072)).toString());
  const property=session.properties?.find(p=>p.name==='textures');if(!property)throw Error('此正版玩家没有可读取的皮肤');
  const data=JSON.parse(Buffer.from(property.value,'base64').toString()),skin=data.textures?.SKIN;if(!skin?.url)throw Error('此正版玩家未设置皮肤');
  const png=validatePNG(await fetchLimited(fetcher,textureURL(skin.url))),digest=hash(png),file=cacheFile(root,digest);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,png);
  return {hash:digest,sourceName:profile.name,sourceUUID:profile.id,model:skin.metadata?.model==='slim'?'slim':'default'};
}
async function readSkin(root,skin){const b=validatePNG(await fs.readFile(cacheFile(root,skin.hash)));if(hash(b)!==skin.hash)throw Error('皮肤缓存校验失败，请重新获取皮肤');return b;}
async function previewSkin(root,skin){try{return 'data:image/png;base64,'+(await readSkin(root,skin)).toString('base64');}catch{return null;}}
async function startSkinServer(root,account,agentFile,onLog=()=>{}){
  if(account.type!=='offline'||!account.skin)throw Error('本地皮肤仅适用于离线账号');
  const png=await readSkin(root,account.skin);if(hash(await fs.readFile(agentFile))!==AGENT_SHA256)throw Error('皮肤组件校验失败，请重新解压启动器');
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const secret=crypto.randomBytes(24).toString('hex');let base,profile,host,metadata;
  const server=http.createServer(async(req,res)=>{try{
    if(req.headers.host!==host){res.writeHead(403);res.end();return;}
    const u=new URL(req.url,'http://'+host);if(!u.pathname.startsWith('/'+secret+'/')){res.writeHead(404);res.end();return;}
    const route=u.pathname.slice(secret.length+2);const json=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
    if(req.method==='GET'&&route===''){json(200,metadata);return;}
    if(req.method==='GET'&&route==='textures/'+account.skin.hash){res.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length});res.end(png);onLog('已向游戏提供缓存皮肤');return;}
    if(req.method==='GET'&&route==='sessionserver/session/minecraft/profile/'+account.uuid){json(200,profile);return;}
    if(req.method==='GET'&&['api/users/profiles/minecraft/'+account.name,'minecraftservices/minecraft/profile/lookup/name/'+account.name].some(p=>route.toLowerCase()===p.toLowerCase())){json(200,{id:account.uuid,name:account.name});return;}
    if(req.method==='POST'&&['api/profiles/minecraft','minecraftservices/minecraft/profile/lookup/bulk/byname'].includes(route)){let body='';for await(const part of req){body+=part;if(body.length>4096){json(413,{});return;}}let names;try{names=JSON.parse(body);}catch{json(400,{});return;}json(200,Array.isArray(names)&&names.some(n=>typeof n==='string'&&n.toLowerCase()===account.name.toLowerCase())?[{id:account.uuid,name:account.name}]:[]);return;}
    if(route==='sessionserver/session/minecraft/hasJoined'){res.writeHead(204);res.end();return;}
    // Appearance only: never issue credentials or authenticate a server join.
    json(403,{error:'ForbiddenOperationException',errorMessage:'Offline skin service does not authenticate accounts.'});
  }catch{if(!res.headersSent)res.writeHead(400);res.end();}});
  server.requestTimeout=5000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});host='127.0.0.1:'+server.address().port;base='http://'+host+'/'+secret+'/';
  metadata={meta:{serverName:'NHMCL-StarQuill Local Skin',implementationName:'StarQuill',implementationVersion:'0.4.0','feature.non_email_login':true},skinDomains:['127.0.0.1'],signaturePublickey:publicKey.export({type:'spki',format:'pem'})};
  const value=Buffer.from(JSON.stringify({timestamp:Date.now(),profileId:account.uuid,profileName:account.name,textures:{SKIN:{url:base+'textures/'+account.skin.hash,...(account.skin.model==='slim'?{metadata:{model:'slim'}}:{})}}})).toString('base64');
  profile={id:account.uuid,name:account.name,properties:[{name:'textures',value,signature:crypto.sign('RSA-SHA1',Buffer.from(value),privateKey).toString('base64')}]};
  return {base,metadata,profile,jvmArgs:['-javaagent:'+agentFile+'='+base,'-Dauthlibinjector.yggdrasil.prefetched='+Buffer.from(JSON.stringify(metadata)).toString('base64'),'-Dauthlibinjector.profileKey=disabled'],close:()=>{server.closeAllConnections();server.close();}};
}
module.exports={lookupSkin,previewSkin,readSkin,startSkinServer,textureURL,validatePNG,cacheFile,AGENT_SHA256};
