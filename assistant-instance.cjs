const {layout,scan}=require('./storage.cjs');
const {exists}=require('./content-utils.cjs');
const {targetInfo}=require('./loaders.cjs');
const path=require('node:path');
function versionRequest(input){
 if(typeof input!=='string'||input.length>240)return null;
 const s=input.normalize('NFKC').trim().replace(/[。!]+$/,'').replace(/(?:在|到)当前(?:游戏)?目录(?:里|中|下)?/g,'').replace(/\s+/g,' ').trim();
 if(/不要|不必|不用|不想|如果|如何|怎么|能否|是否|可以吗|[?？]|整合包|下载地址|教程|推荐|能不能|别装|而不是/.test(s))return null;
 const m=/^(?:(?:请|麻烦|帮我|给我|替我)\s*)*(?:下载并安装|下载安装|下载|安装|装)(?:一下|一个|个)?\s*(?:Minecraft\s*)?(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)(?![.\d])\s*(?:游戏版本|版本|版)?\s*([\s\S]*)$/i.exec(s);
 if(!m)return null;
 const rest=m[2].replace(/^(?:带有|带|使用|搭配|的)\s*/,'').trim();
 const l=/^(neoforge|forge|fabric)(?![a-z])/i.exec(rest);
 let tail=(l?rest.slice(l[0].length):rest).trim().replace(/^(?:加载器|版本|版)/,'').trim().replace(/^(?:并(?:安装|装上)|的|带有)\s*/,'').trim();
 if(!l&&tail==='原版')tail='';
 let mod='';
 if(tail){const n=/^[《「“]?([^<>|:;，。？！、]{1,100}?)[》」”]?\s*(?:模组|mod)$/i.exec(tail);if(!l||!n||/并|以及|然后|不要|别|不装/.test(n[1]))return null;mod=n[1].trim();}
 const game=m[1],loader=l?.[1].toLowerCase()||'';
 return {type:'instance',game,loader,mod,value:game+(loader?' '+loader:' 原版')+(mod?' + '+mod:'')};
}
async function ensureInstance(c,{root,loaders,signal,changed,settings=true}){
 const base=c.game+'-'+c.loader, available=await scan(root);
 for(let i=1;i<=100;i++){
   const id=i===1?base:base+' ('+i+')',folder=layout(root,id).version;
   if(await exists(folder)){
     if(available.some(v=>v.ready&&v.id===id)){
       const t=await targetInfo(root,id,settings).catch(()=>null);
       if(t?.game===c.game&&t.loader===c.loader&&path.resolve(t.folder)===path.resolve(folder)&&!await exists(path.join(folder,'starquill-pack.json'))){await changed(id);return id;}
     }
     continue;
   }
   const rows=await loaders.list(c.game,c.loader,signal),spec=rows.find(r=>r.stable)||rows[0];
   if(!spec)throw Error('未找到 Minecraft '+c.game+' 可用的 '+c.loader+' 加载器');
   await loaders.install(spec,id,signal);await changed(id);return id;
 }
 throw Error('同名实例过多，请先整理版本列表');
}
module.exports={versionRequest,ensureInstance};
