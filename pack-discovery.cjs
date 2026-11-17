const {matchProjects}=require('./addon-index.cjs');
const {UA,transientNetworkError}=require('./content-utils.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const client=n=>typeof n==='string'&&/\.(zip|mrpack)$/i.test(n)&&!/[\\/]|server|服务端|patch|补丁|source.?code/i.test(n);
async function discover(command,fetcher,signal){
 const matches=matchProjects(command.value,'modpack').filter(m=>m.score===100);
 const e=matches.length===1?matches[0].entry:null,name=e?.name||command.value;
 const warnings=[], exact=new Set([command.value,e?.name,e?.english].filter(Boolean).map(norm));
 const web='https://www.bing.com/search?q='+encodeURIComponent(name+' Minecraft 整合包 下载');
 async function read(url,json=false){
   for(let attempt=0;attempt<2;attempt++){
     const timeout=AbortSignal.timeout(json?12000:8000);
     try{
       signal?.throwIfAborted();
       const r=await fetcher(url,{headers:{'User-Agent':UA},credentials:'omit',signal:signal?AbortSignal.any([signal,timeout]):timeout});
       if(!r.ok){await r.body?.cancel?.().catch(()=>{});throw Error('HTTP '+r.status);}
       const parts=[];let size=0;
       for await(const chunk of r.body){size+=chunk.length;if(size>5*1024*1024)throw Error('发布资料过大');parts.push(Buffer.from(chunk));}
       const t=Buffer.concat(parts).toString();return json?JSON.parse(t):t;
     }catch(error){
       signal?.throwIfAborted();
       if(!json||attempt>0||(!timeout.aborted&&!transientNetworkError(error)))break;
       await delay(350,undefined,{signal});
     }
   }
   warnings.push(new URL(url).hostname);return null;
 }
 const [wiki,rss,bbs]=await Promise.all([e?read(e.url):'',read(web+'&format=rss'),read('https://api.bbsmc.net/v2/search?limit=20&facets='+encodeURIComponent('[["project_type:modpack"]]')+'&query='+encodeURIComponent(command.value),true)]);
 const linked=[...String(wiki||'').matchAll(/href="(?:https?:)?\/\/link\.mcmod\.cn\/target\/([\w+/=%-]+)"/gi)].map(m=>{try{return Buffer.from(decodeURIComponent(m[1]),'base64').toString()}catch{return ''}});
 const repos=[...new Set(linked.map(x=>/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)(?:\/|$)/i.exec(x)?.[1]).filter(Boolean))];
 const bb=x=>/^https:\/\/bbsmc\.net\/modpack\/([\w-]+)(?:[/?#]|$)/i.exec(x)?.[1];
 const trusted=new Set(linked.map(bb).filter(Boolean)), ids=new Set(trusted);
 for(const h of bbs?.hits||[])if(h.project_type==='modpack'&&[h.title,h.slug].some(n=>exact.has(norm(n))))ids.add(h.slug);
 for(const m of String(rss||'').matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/gi)){const id=bb(m[1]);if(id)ids.add(id);}
 let page=e?.url||web;
 const mr=x=>/^https:\/\/modrinth\.com\/modpack\/([\w-]+)(?:[/?#]|$)/i.exec(x)?.[1];
 const mrTrusted=new Set(linked.map(mr).filter(Boolean)),mrIds=new Set(mrTrusted);
 for(const m of String(rss||'').matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/gi)){const id=mr(m[1]);if(id)mrIds.add(id);}
 for(const id of [...mrIds].slice(0,3)){
   const project=await read('https://api.modrinth.com/v2/project/'+id,true);
   if(project?.project_type!=='modpack'||(!mrTrusted.has(id)&&![project.title,project.slug].some(n=>exact.has(norm(n)))))continue;
   const vs=await read('https://api.modrinth.com/v2/project/'+id+'/version',true);
   const v=Array.isArray(vs)&&vs.find(v=>(command.version?[v.id,v.name,v.version_number].includes(command.version):v.version_type==='release')&&(!command.game||v.game_versions?.includes(command.game))&&(!command.loader||v.loaders?.includes(command.loader)));
   if(!v)continue;
   page='https://modrinth.com/modpack/'+id+'/version/'+encodeURIComponent(v.id);
   const files=v.files.filter(f=>client(f.filename)&&/^https:\/\/cdn\.modrinth\.com\//.test(f.url)&&/^[a-f0-9]{128}$/i.test(f.hashes?.sha512));
   const f=files.length===1?files[0]:files.find(f=>f.primary);
   if(f)return {name,page,file:{url:f.url,original:f.filename,size:f.size,hashes:f.hashes}};
 }
 for(const repo of repos.slice(0,2)){
   const api='https://api.github.com/repos/'+repo+'/releases';
   let rel;
   if(!command.version){
     const latest=await read(api+'/latest',true);
     if(latest?.tag_name&&!latest.draft&&!latest.prerelease)rel=latest;
   }
   if(!rel){
     const releases=await read(api+'?per_page=30',true);
     rel=Array.isArray(releases)&&releases.find(r=>!r.draft&&(!command.version?!r.prerelease:[r.name,r.tag_name,String(r.tag_name).replace(/^v/,'')].includes(command.version)));
   }
   if(!rel)continue;page='https://github.com/'+repo+'/releases';
   const assets=(rel.assets||[]).filter(a=>client(a.name)&&/^sha256:[a-f0-9]{64}$/i.test(a.digest)&&a.browser_download_url?.startsWith('https://github.com/'+repo+'/releases/download/'));
   if(assets.length===1){const a=assets[0];return {name,page,file:{original:a.name,url:a.browser_download_url,size:a.size,hashes:{sha256:a.digest.slice(7)}}};}
 }
 for(const id of [...ids].slice(0,4)){
   if(!/^[\w-]+$/.test(id))continue;
   if(!trusted.has(id)){const p=await read('https://api.bbsmc.net/v2/project/'+id,true);if(p?.project_type!=='modpack'||![p.title,p.slug].some(n=>exact.has(norm(n))))continue;}
   const versions=await read('https://api.bbsmc.net/v2/project/'+id+'/version',true);
   const v=Array.isArray(versions)&&versions.find(v=>(command.version?[v.id,v.version_number,v.name].includes(command.version):v.version_type==='release')&&(!command.game||v.game_versions?.includes(command.game))&&(!command.loader||v.loaders?.includes(command.loader)));
   if(!v)continue;page='https://bbsmc.net/modpack/'+id+'/version/'+encodeURIComponent(v.version_number);
   const files=(v.files||[]).filter(f=>client(f.filename)&&/^https:\/\/cdn\.bbsmc\.net\//.test(f.url)&&(/^[a-f0-9]{128}$/i.test(f.hashes?.sha512)||/^[a-f0-9]{40}$/i.test(f.hashes?.sha1)));
   const chosen=files.length===1?files[0]:files.find(f=>f.primary);
   if(chosen)return {name,page,file:{original:chosen.filename,url:chosen.url,size:chosen.size,hashes:chosen.hashes}};
 }
 return {name,page,warnings:[...new Set(warnings)].map(h=>h+' 暂不可用')};
}
module.exports={discover};
