const fs=require('node:fs/promises'),path=require('node:path');
const {under,versionName}=require('./storage.cjs');
const UA='NHMCL-StarQuill/beta-0.8.6 (StarQuill_z12244; Minecraft launcher)';
function httpsURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!u.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)||u.hostname.includes(':')||/^[\d.]+$/.test(u.hostname))throw Error('下载地址必须是公开 HTTPS 地址');return u.href;}
async function response(fetcher,url,signal,headers={}){httpsURL(url);const r=await fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),headers:{'User-Agent':UA,...headers},redirect:'error'});if(!r.ok)throw Error('资源服务请求失败（HTTP '+r.status+'）');return r;}
async function json(fetcher,url,signal,headers){const r=await response(fetcher,url,signal,headers);const body=await r.text();if(body.length>20*1024*1024)throw Error('资源列表过大');return JSON.parse(body);}
function relativeFile(value){if(typeof value!=='string'||value.length>220||value.split('/').some(s=>{try{versionName(s);return false;}catch{return true;}}))throw Error('资源包含无效文件路径');under('.',value);return value;}
function filename(original,cn=''){versionName(original);if(original.length>170)throw Error('文件名称过长');const clean=String(cn).replace(/[<>:"/\\|?*\x00-\x1f]/g,'').replace(/[. ]+$/,'').slice(0,44);return clean&&/[\u3400-\u9fff]/.test(clean)?clean+' - '+original:original;}
async function exists(p){try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function noLinks(root,file){const rel=path.relative(root,file);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('目标越出游戏目录');let p=root;for(const part of [''].concat(rel.split(path.sep))){if(part)p=path.join(p,part);try{if((await fs.lstat(p)).isSymbolicLink())throw Error('安装目标包含链接，请选择普通版本目录');}catch(e){if(e.code!=='ENOENT')throw e;}}}
module.exports={UA,httpsURL,response,json,relativeFile,filename,exists,noLinks};
