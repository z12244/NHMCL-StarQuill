const crypto=require('node:crypto'),fs=require('node:fs/promises');
const {AGENT_SHA256}=require('./skins.cjs');
const PRESETS=[{id:'littleskin',name:'LittleSkin',url:'https://littleskin.cn/api/yggdrasil/'},{id:'mua',name:'MUA 用户中心',url:'https://skin.mualliance.ltd/api/yggdrasil/'}];
function endpoint(value){if(typeof value!=='string'||value.length>2048)throw Error('皮肤站地址无效');let u;try{u=new URL(value.includes('://')?value:'https://'+value);}catch{throw Error('皮肤站地址无效');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('请使用不带账号、查询参数或片段的 HTTPS 皮肤站地址');u.pathname=u.pathname.replace(/\/+$/,'')+'/';return u.href;}
function profile(p){const id=String(p?.id||'').replaceAll('-','').toLowerCase();if(!/^[a-f0-9]{32}$/.test(id)||typeof p?.name!=='string'||!/^[\p{L}\p{N}_]{1,16}$/u.test(p.name))throw Error('皮肤站返回的角色信息无效');return {id,name:p.name};}
function metadata(d){if(!d||typeof d.meta?.serverName!=='string'||!Array.isArray(d.skinDomains)||typeof d.signaturePublickey!=='string')throw Error('该地址没有有效的 authlib-injector 配置');let key;try{key=crypto.createPublicKey(d.signaturePublickey);}catch{throw Error('皮肤站签名公钥无效');}if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048)throw Error('皮肤站签名公钥不受支持');return d;}
function credentials(d,expectedClient){if(typeof d.accessToken!=='string'||!d.accessToken||d.accessToken.length>32768||typeof d.clientToken!=='string'||d.clientToken!==expectedClient)throw Error('皮肤站返回的会话信息无效');return {accessToken:d.accessToken,clientToken:d.clientToken};}
class YggdrasilAuth{
  constructor({fetcher=fetch}={}){this.fetch=fetcher;}
  async request(url,body,signal){let r,data;try{r=await this.fetch(url,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(r.status!==204){const raw=await r.text();if(raw.length>1024*1024)throw Error('response too large');try{data=JSON.parse(raw);}catch{data={};}}else data={};
    }catch{if(signal?.aborted)throw Error('皮肤站登录已取消');throw Error('无法连接皮肤站，请检查网络、地址及 HTTPS 证书。');}if(signal?.aborted)throw Error('皮肤站登录已取消');return {ok:r.ok,status:r.status,data};}
  async discover(input,signal){endpoint(input);let url=new URL(input.includes('://')?input:'https://'+input).href;const visited=new Set();
    for(let i=0;i<5;i++){if(visited.has(url))throw Error('皮肤站地址跳转形成循环');visited.add(url);let r;try{r=await this.fetch(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch{throw Error(signal?.aborted?'皮肤站登录已取消':'无法识别皮肤站，请检查网络或填写完整 API 地址');}
      const redirected=r.status>=300&&r.status<400,location=redirected?r.headers.get('location'):r.headers.get('x-authlib-injector-api-location');if(location){const next=new URL(location,url).href;endpoint(next);if(redirected?next!==url:endpoint(next)!==endpoint(url)){await r.body?.cancel();url=next;continue;}}
      if(!r.ok)throw Error('皮肤站配置请求失败（HTTP '+r.status+'）');let data;try{const raw=await r.text();if(raw.length>1024*1024)throw Error();data=JSON.parse(raw);}catch{throw Error('请输入该站提供的 Yggdrasil API 地址，如 https://站点/api/yggdrasil');}
      if(signal?.aborted)throw Error('皮肤站登录已取消');return {url:endpoint(url),name:metadata(data).meta.serverName.slice(0,80),metadata:data};
    }throw Error('皮肤站地址跳转次数过多');
  }
  fail(r,action){if(r.status===429)throw Error('皮肤站请求过于频繁，请稍后重试');if(r.status===401||r.status===403)throw Error(action==='登录'?'皮肤站登录失败，请检查邮箱/角色名、密码及该站的二步验证或应用密码要求。':'皮肤站会话已失效，请重新登录。');throw Error('皮肤站'+action+'失败（HTTP '+r.status+'），请检查该站状态。');}
  async authenticate(server,username,password,signal){if(typeof username!=='string'||!username.trim()||username.length>320||typeof password!=='string'||!password||password.length>4096)throw Error('请填写皮肤站账号和密码');const clientToken=crypto.randomUUID();
    const r=await this.request(server.url+'authserver/authenticate',{agent:{name:'Minecraft',version:1},username:username.trim(),password,clientToken,requestUser:true},signal);if(!r.ok)this.fail(r,'登录');const tokens=credentials(r.data,clientToken);
    const selected=r.data.selectedProfile?profile(r.data.selectedProfile):null;if(!selected&&r.data.availableProfiles&&!Array.isArray(r.data.availableProfiles))throw Error('皮肤站角色列表格式无效');const profiles=selected?[selected]:(r.data.availableProfiles||[]).slice(0,512).map(profile);if(!profiles.length){await this.invalidate({server,tokens}).catch(()=>{});throw Error('此账号没有游戏角色，请先在皮肤站创建角色。');}
    return {server,tokens,profiles,selected};
  }
  account(session,p){return {id:'authlib:'+crypto.createHash('sha256').update(session.server.url).digest('hex').slice(0,24)+':'+p.id,type:'authlib',name:p.name,uuid:p.id,server:{url:session.server.url,name:session.server.name},tokens:session.tokens};}
  async bind(session,id,signal){const p=session.profiles.find(p=>p.id===id);if(!p)throw Error('请选择本次登录返回的角色');if(session.selected){if(session.selected.id!==id)throw Error('皮肤站已绑定其他角色，请重新登录');return this.account(session,p);}
    const r=await this.request(session.server.url+'authserver/refresh',{...session.tokens,selectedProfile:p,requestUser:true},signal);if(!r.ok)this.fail(r,'选择角色');const tokens=credentials(r.data,session.tokens.clientToken),selected=profile(r.data.selectedProfile);if(selected.id!==p.id)throw Error('皮肤站绑定的角色与选择不一致');return this.account({...session,tokens},selected);
  }
  async refresh(account,signal){if(!account.tokens?.accessToken||!account.tokens?.clientToken)throw Error('皮肤站账号需要重新登录');const url=endpoint(account.server.url);const valid=await this.request(url+'authserver/validate',account.tokens,signal);if(valid.status===204)return account;if(![401,403].includes(valid.status))this.fail(valid,'验证');
    const r=await this.request(url+'authserver/refresh',{...account.tokens,requestUser:true},signal);if(!r.ok)this.fail(r,'刷新');const tokens=credentials(r.data,account.tokens.clientToken),p=profile(r.data.selectedProfile);if(p.id!==account.uuid)throw Error('皮肤站刷新后角色身份发生变化，请重新登录');return {...account,name:p.name,tokens};
  }
  async invalidate(account,signal){if(account.tokens?.accessToken){const r=await this.request(endpoint(account.server.url)+'authserver/invalidate',account.tokens,signal);if(!r.ok)this.fail(r,'注销');}}
  async launchArgs(account,agentFile,signal){const server=await this.discover(account.server.url,signal);if(server.url!==endpoint(account.server.url))throw Error('皮肤站 API 地址已变更，请重新添加账号以确认新地址');return injectorArgs(server,agentFile);}
}
async function injectorArgs(server,file){if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==AGENT_SHA256)throw Error('外置登录组件校验失败，请重新解压启动器');metadata(server.metadata);return ['-javaagent:'+file+'='+endpoint(server.url),'-Dauthlibinjector.yggdrasil.prefetched='+Buffer.from(JSON.stringify(server.metadata)).toString('base64')];}
module.exports={YggdrasilAuth,PRESETS,endpoint,profile,metadata,injectorArgs};
