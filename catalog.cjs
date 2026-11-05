const fs=require('node:fs/promises'),path=require('node:path');
const {MANIFEST,mirrorURL}=require('./downloads.cjs');const {writeJSON}=require('./storage.cjs');
function validateManifest(data){if(!Array.isArray(data?.versions)||!data.versions.length||data.versions.length>20000)throw Error('版本列表格式无效');const ids=new Set();for(const v of data.versions){if(typeof v.id!=='string'||!v.id||ids.has(v.id)||!['release','snapshot','old_alpha','old_beta'].includes(v.type)||typeof v.url!=='string'||!v.url.startsWith('https://'))throw Error('版本条目格式无效');ids.add(v.id);}return data;}
class ManifestCatalog{
  constructor({root,fetcher=fetch,mode='auto',now=Date.now,onUpdate=()=>{}}){Object.assign(this,{root,fetcher,mode,now,onUpdate});this.file=path.join(root,'.starquill','catalog-cache.json');this.data=null;this.etag='';this.source='';this.lastAttempt=0;this.checkedAt=0;this.updatedAt=0;this.inflight=null;}
  async load(){if(this.loaded)return;this.loaded=true;try{const d=JSON.parse(await fs.readFile(this.file,'utf8'));this.data=validateManifest(d.data);this.etag=d.etag||'';this.source=d.source||'';this.updatedAt=d.updatedAt||0;this.checkedAt=d.checkedAt||0;}catch{try{this.data=validateManifest(JSON.parse(await fs.readFile(path.join(this.root,'.starquill','version_manifest_v2.json'),'utf8')));}catch{}}}
  view(cached=false){return {versions:this.data.versions,latest:this.data.latest,source:this.source,checkedAt:this.checkedAt,updatedAt:this.updatedAt,cached};}
  refresh(force=false){if(this.inflight)return this.inflight;this.inflight=this.update(force).finally(()=>{this.inflight=null;});return this.inflight;}
  async update(force){await this.load();if(!force&&this.attempted){if(this.data)return this.view(this.cached);throw Error('暂时没有可用的在线版本列表，请检查网络后重新打开启动器');}this.attempted=true;this.lastAttempt=this.now();
    // Always check Mojang first, independently of the game's artifact download mirror.
    const urls=this.mode==='official'?[MANIFEST]:[MANIFEST,mirrorURL(MANIFEST)];
    for(const url of urls){try{const r=await this.fetcher(url,{headers:{'Cache-Control':'no-cache',...(this.source===url&&this.etag?{'If-None-Match':this.etag}:{})},cache:'no-cache',signal:AbortSignal.timeout(12000),redirect:'error'});let data=this.data,etag=this.etag;
      if(r.status===304){if(!data||this.source!==url)throw Error('无对应缓存');}else{if(!r.ok)throw Error('HTTP '+r.status);data=validateManifest(await r.json());etag=r.headers.get('etag')||'';}
      const checkedAt=this.now(),changed=JSON.stringify(data.versions)!==JSON.stringify(this.data?.versions);this.data=data;this.etag=etag;this.source=url;this.checkedAt=checkedAt;if(changed||!this.updatedAt)this.updatedAt=checkedAt;this.cached=false;
      // Cache failure must not hide a fresh official manifest.
      try{await writeJSON(this.file,{data,etag,source:url,checkedAt,updatedAt:this.updatedAt});}catch{}
      const result=this.view(false);this.onUpdate(result);return result;
    }catch{}}
    this.cached=true;if(!this.data)throw Error('暂时无法连接版本列表；本地版本仍可使用');const result=this.view(true);this.onUpdate(result);return result;
  }
}
module.exports={ManifestCatalog,validateManifest};
