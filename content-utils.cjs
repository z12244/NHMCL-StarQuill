const fs=require('node:fs/promises'),path=require('node:path');
const {under,versionName}=require('./storage.cjs');
const UA='NHMCL-StarQuill/'+require('./package.json').displayVersion+' (StarQuill_z12244; Minecraft launcher)';
function transientNetworkError(error){
 const message=[error?.message,error?.cause?.code,error?.cause?.message].join(' ');
 return error?.name==='TimeoutError'||/fetch failed|failed to fetch|下载连接超时|网络连接已中断|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|net::ERR_(?:CONNECTION_(?:RESET|CLOSED|TIMED_OUT)|TIMED_OUT|NETWORK_CHANGED|HTTP2_PROTOCOL_ERROR)|HTTP (?:408|502|503|504)\b/i.test(message);
}
function httpsURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!u.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)||u.hostname.includes(':')||/^[\d.]+$/.test(u.hostname))throw Error('下载地址必须是公开 HTTPS 地址');return u.href;}
async function response(fetcher,url,signal,headers={},jsonBody){
 httpsURL(url);
 const timeout=AbortSignal.timeout(20000);
 const options={signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{'User-Agent':UA,...headers},redirect:'error'};
 if(jsonBody!==undefined){
   options.method='POST';
   options.headers['Content-Type']='application/json';
   options.body=JSON.stringify(jsonBody);
 }
 const r=await fetcher(url,options);
 if(!r.ok){await r.body?.cancel?.().catch(()=>{});throw Error('资源服务请求失败（HTTP '+r.status+'）');}
 return r;
}
async function json(fetcher,url,signal,headers,jsonBody){const r=await response(fetcher,url,signal,headers,jsonBody);const body=await r.text();if(body.length>20*1024*1024)throw Error('资源列表过大');return JSON.parse(body);}
function relativeFile(value){if(typeof value!=='string'||value.length>220||value.split('/').some(s=>{try{versionName(s);return false;}catch{return true;}}))throw Error('资源包含无效文件路径');under('.',value);return value;}
function filename(original,cn=''){versionName(original);if(original.length>170)throw Error('文件名称过长');const clean=String(cn).replace(/[<>:"/\\|?*\x00-\x1f]/g,'').replace(/[. ]+$/,'').slice(0,44);return clean&&/[\u3400-\u9fff]/.test(clean)?clean+' - '+original:original;}
async function exists(p){try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function noLinks(root,file){const rel=path.relative(root,file);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('目标越出游戏目录');let p=root;for(const part of [''].concat(rel.split(path.sep))){if(part)p=path.join(p,part);try{if((await fs.lstat(p)).isSymbolicLink())throw Error('安装目标包含链接，请选择普通版本目录');}catch(e){if(e.code!=='ENOENT')throw e;}}}
module.exports={UA,httpsURL,response,json,relativeFile,filename,exists,noLinks,transientNetworkError};
