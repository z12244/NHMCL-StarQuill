const fs=require('node:fs/promises'),path=require('node:path');
const {writeJSON}=require('./storage.cjs');
const {offlineUUID}=require('./game.cjs');
const OAUTH='https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const SCOPE='XboxLive.signin offline_access';
const validClient=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const abort=signal=>{if(signal?.aborted)throw Error('登录已取消');};
function delay(ms,signal){return new Promise((resolve,reject)=>{abort(signal);const cancel=()=>{clearTimeout(timer);reject(Error('登录已取消'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);signal?.addEventListener('abort',cancel,{once:true});});}
class MicrosoftAuth{
  constructor({fetcher=fetch,sleep=delay,now=Date.now}={}){this.fetch=fetcher;this.sleep=sleep;this.now=now;}
  async request(url,body,signal,form=false,token){abort(signal);let response,data;
    try{response=await this.fetch(url,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:form?new URLSearchParams(body).toString():JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000),redirect:'error'});data=await response.json();}catch{abort(signal);throw Error('认证服务器连接失败，请检查网络后重试。');}
    return {ok:response.ok,status:response.status,data};
  }
  async begin(clientId,signal){if(!validClient(clientId))throw Error('请先在账号页配置本项目的 Microsoft Client ID；目前尚未配置。');
    const r=await this.request(OAUTH+'devicecode',{client_id:clientId,scope:SCOPE},signal,true);
    if(!r.ok)throw Error('无法获取微软登录码，请检查应用注册中的个人账号支持和公共客户端设置。');
    const d=r.data;let uri;try{uri=new URL(d.verification_uri);}catch{}
    if(!d.device_code||!d.user_code||!uri||uri.protocol!=='https:'||!['microsoft.com','www.microsoft.com','login.microsoftonline.com'].includes(uri.hostname)||!Number.isFinite(d.expires_in))throw Error('微软返回的登录码格式无效');
    return {...d,clientId,expiresAt:this.now()+d.expires_in*1000,interval:Math.max(5,Number(d.interval)||5)};
  }
  async poll(device,signal){let interval=device.interval*1000;
    while(this.now()<device.expiresAt){await this.sleep(interval,signal);abort(signal);if(this.now()>=device.expiresAt)break;
      const r=await this.request(OAUTH+'token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',client_id:device.clientId,device_code:device.device_code},signal,true);
      if(r.ok)return this.exchange(r.data,device.clientId,signal);
      if(r.data.error==='authorization_pending')continue;if(r.data.error==='slow_down'){interval+=5000;continue;}
      if(r.data.error==='authorization_declined'||r.data.error==='access_denied')throw Error('微软登录已被拒绝或取消');
      if(r.data.error==='expired_token')break;throw Error('微软登录失败，请重新获取登录码并确认应用设置。');
    }throw Error('登录码已过期，请重新登录');
  }
  async exchange(msa,clientId,signal){
    if(!msa.access_token)throw Error('微软未返回有效令牌');
    const xbl=await this.request('https://user.auth.xboxlive.com/user/authenticate',{Properties:{AuthMethod:'RPS',SiteName:'user.auth.xboxlive.com',RpsTicket:'d='+msa.access_token},RelyingParty:'http://auth.xboxlive.com',TokenType:'JWT'},signal);
    if(!xbl.ok||!xbl.data.Token)throw Error('Xbox Live 登录失败，请先在 Xbox 网站建立个人档案。');
    const xsts=await this.request('https://xsts.auth.xboxlive.com/xsts/authorize',{Properties:{SandboxId:'RETAIL',UserTokens:[xbl.data.Token]},RelyingParty:'rp://api.minecraftservices.com/',TokenType:'JWT'},signal);
    if(!xsts.ok){const reasons={2148916233:'此账号尚未建立 Xbox 档案。',2148916235:'此地区无法使用 Xbox Live。',2148916236:'此账号需要完成 Xbox 年龄验证。',2148916237:'此账号需要完成 Xbox 年龄验证。',2148916238:'此账号需要在 Microsoft 家庭中取得家长许可。'};throw Error(reasons[xsts.data.XErr]||'Xbox 授权失败，请检查账号或家庭设置。');}
    const claim=xsts.data.DisplayClaims?.xui?.[0];if(!xsts.data.Token||!claim?.uhs)throw Error('Xbox 授权响应无效');
    const mc=await this.request('https://api.minecraftservices.com/authentication/login_with_xbox',{identityToken:`XBL3.0 x=${claim.uhs};${xsts.data.Token}`},signal);
    if(!mc.ok||!mc.data.access_token)throw Error(mc.status===403?'Minecraft 服务拒绝访问（403）。请核对本项目 API 访问许可及账号状态；仅凭 403 不能确认具体原因。':'Minecraft 令牌获取失败');
    const ent=await this.request('https://api.minecraftservices.com/entitlements/mcstore',null,signal,false,mc.data.access_token);
    if(!ent.ok)throw Error('无法验证 Minecraft Java 版游戏权益，请稍后重试。');
    if(!ent.data.items?.some(i=>['game_minecraft','product_minecraft'].includes(i.name)))throw Error('此账号没有可用的 Minecraft Java 版游戏权益。');
    const profile=await this.request('https://api.minecraftservices.com/minecraft/profile',null,signal,false,mc.data.access_token);
    if(!profile.ok||!/^[a-f0-9]{32}$/i.test(profile.data.id||''))throw Error('无法读取 Minecraft 档案；请先在官方网站设置 Java 版玩家名。');
    const p=profile.data;return {id:'msa:'+p.id,type:'microsoft',name:p.name,uuid:p.id,clientId,skinSource:p.name,
      tokens:{refreshToken:msa.refresh_token,accessToken:mc.data.access_token,expiresAt:this.now()+Math.max(0,Number(mc.data.expires_in)||0)*1000,xuid:claim.xid||'0'}};
  }
  async refresh(account,signal,onRotation=async()=>{}){
    if(account.tokens?.accessToken&&account.tokens.expiresAt>this.now()+120000)return account;
    if(!account.tokens?.refreshToken)throw Error('账号登录已失效，请重新登录微软账号。');
    const r=await this.request(OAUTH+'token',{client_id:account.clientId,grant_type:'refresh_token',refresh_token:account.tokens.refreshToken,scope:SCOPE},signal,true);
    if(!r.ok)throw Error('微软登录已过期或被撤销，请重新登录；不会自动切换为离线身份。');
    const token=r.data.refresh_token||account.tokens.refreshToken;
    // Persist a rotated refresh token even if a later Xbox/Minecraft request fails.
    await onRotation({...account,tokens:{...account.tokens,refreshToken:token}});
    return this.exchange({...r.data,refresh_token:token},account.clientId,signal);
  }
}
class AccountStore{
  constructor(file,safeStorage){this.file=file;this.safe=safeStorage;this.accounts=[];this.active='';this.queue=Promise.resolve();}
  async load(legacyName){
    let data;try{data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('账号文件无法读取，请保留原文件后检查权限或备份。');}
    if(data){this.active=data.active;this.accounts=data.accounts.map(a=>{if(a.type==='offline')return a;try{const tokens=JSON.parse(this.safe.decryptString(Buffer.from(a.encryptedTokens,'base64')));return {...a,tokens};}catch{return {...a,needsLogin:true};}});}
    if(!this.accounts.length&&legacyName){await this.addOffline(legacyName);}if(!data&&!this.accounts.length)await this.save();
    if(!this.accounts.some(a=>a.id===this.active))this.active=this.accounts[0]?.id||'';
  }
  public(){return {active:this.active,accounts:this.accounts.map(({id,type,name,uuid,skin,server,needsLogin})=>({id,type,name,uuid,skin,server,needsLogin:!!needsLogin}))};}
  current(){const a=this.accounts.find(a=>a.id===this.active);if(!a)throw Error('请先选择账号');return a;}
  async save(){const data={active:this.active,accounts:this.accounts.map(a=>{const {tokens,...publicData}=a;if(tokens){if(!this.safe.isEncryptionAvailable())throw Error('Windows 安全存储不可用，无法保存微软账号。');publicData.encryptedTokens=this.safe.encryptString(JSON.stringify(tokens)).toString('base64');}return publicData;})};
    const pending=this.queue.catch(()=>{}).then(()=>writeJSON(this.file,data));this.queue=pending;await pending;
  }
  async put(a,activate=false){if(a.tokens&&!this.safe.isEncryptionAvailable())throw Error('Windows 安全存储不可用，无法保存微软账号。');const old=this.accounts.find(x=>x.id===a.id);this.accounts=this.accounts.filter(x=>x.id!==a.id);this.accounts.push({...old,...a,needsLogin:false});if(activate)this.active=a.id;await this.save();return this.public();}
  async addOffline(name){if(typeof name!=='string'||!/^[A-Za-z0-9_]{3,16}$/.test(name))throw Error('离线玩家名须为 3–16 位英文字母、数字或下划线');const uuid=offlineUUID(name);return this.put({id:'offline:'+uuid,type:'offline',uuid,name},true);}
  async select(id){if(!this.accounts.some(a=>a.id===id))throw Error('账号不存在');this.active=id;await this.save();return this.public();}
  async remove(id){if(this.accounts.length<=1)throw Error('请至少保留一个账号');this.accounts=this.accounts.filter(a=>a.id!==id);if(this.active===id)this.active=this.accounts[0].id;await this.save();return this.public();}
}
module.exports={MicrosoftAuth,AccountStore,validClient,OAUTH};
