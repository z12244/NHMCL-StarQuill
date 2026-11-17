const path=require('node:path');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {endpoint,profile,YggdrasilAuth}=require('./yggdrasil.cjs');
const {endpoint:modelEndpoint}=require('./ai-assistant.cjs');

async function namedJSON(folder,name){
  try {
    const file=path.join(folder,name);
    if((await fs.stat(file)).size>16*1024*1024)throw Error();
    return JSON.parse(await fs.readFile(file,'utf8'));
  } catch(e){if(e.code==='ENOENT')return null;throw Error('无法读取旧版 '+name);}
}
async function importConnections(folder,db,storage,helper){
  const [config,accounts]=await Promise.all([namedJSON(folder,'ai-provider.json'),namedJSON(folder,'accounts.json')]);
  if(!config&&!accounts)throw Error('请选择含 ai-provider.json 或 accounts.json 的旧版 .starquill-profile 文件夹');
  let key;
  async function decrypt(value){
    const data=Buffer.from(value,'base64');
    try{return storage.decryptString(data);}catch{}
    if(process.platform!=='win32')throw Error('当前桌面密钥环无法解密旧连接，请重新登录或填写连接密钥。');
    try{
      if(!key){
        const state=await namedJSON(folder,'Local State');
        const wrapped=Buffer.from(state.os_crypt.encrypted_key,'base64');
        if(wrapped.subarray(0,5).toString()!=='DPAPI')throw Error();
        key=execFileSync(helper,['--legacy'],{input:wrapped.subarray(5),windowsHide:true,stdio:['pipe','pipe','ignore'],timeout:8000});
      }
      if(!['v10','v11'].includes(data.subarray(0,3).toString()))throw Error();
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(3,15));
      decipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([decipher.update(data.subarray(15,-16)),decipher.final()]).toString('utf8');
    }catch{throw Error('此 Windows 用户无法解密旧版连接。请在原启动器目录运行新版后导入，或重新设置连接。');}
  }
  const skins=[],auth=new YggdrasilAuth({});
  let ai;
  try{
    if(config?.model&&!db.read('ai')){
      if(typeof config.model!=='string'||config.model.length>180)throw Error('旧版模型名称无效');
      ai={base:modelEndpoint(config.base),model:config.model,autoAnalyze:config.autoAnalyze!==false,secret:config.secret?await decrypt(config.secret):''};
    }
    for(const a of accounts?.accounts||[]){
      if(a.type!=='authlib'||db.read(a.id))continue;
      const p=profile({id:a.uuid,name:a.name});
      const server={url:endpoint(a.server.url),name:String(a.server.name||new URL(a.server.url).hostname).slice(0,256)};
      const {accessToken,clientToken}=JSON.parse(await decrypt(a.encryptedTokens));
      if(![accessToken,clientToken].every(v=>typeof v==='string'&&v.length>0&&v.length<=32768))throw Error('旧版皮肤站会话无效');
      const account=auth.account({server,tokens:{accessToken,clientToken}},p);
      if(account.id!==a.id)throw Error('旧版账号与皮肤站地址不匹配');
      skins.push(account);
    }
    return db.transaction(()=>{
      const result={ai:0,skins:0};
      if(ai&&!db.read('ai')){db.put('ai',ai);result.ai++;}
      for(const a of skins)if(!db.read(a.id)){db.put(a.id,a);result.skins++;}
      if(!db.read('selected-skin')&&skins.some(a=>a.id===accounts?.active))db.put('selected-skin',accounts.active);
      return result;
    });
  }finally{key?.fill(0);}
}
module.exports={importConnections};
