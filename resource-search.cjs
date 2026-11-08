const {pool}=require('./downloads.cjs');
// Semantic aliases expand a user's intent; they never identify an installable file.
const TOPICS=[
  {words:['小地图','地图','导航','坐标','路标','minimap','journeymap','xaero'],terms:['minimap','map','waypoint'],label:'地图 / 小地图 / 导航'},
  {words:['物品管理器','物品查询','合成表','合成查询','配方','jei','rei','emi'],terms:['recipe','JEI','EMI'],label:'物品查询 / 合成配方'},
  {words:['性能','优化','帧率','流畅','fps','钠','sodium'],terms:['optimization','sodium','performance'],label:'性能 / 帧率优化'},
  {words:['背包','旅行背包','储物','收纳','backpack'],terms:['backpack','storage'],label:'背包 / 储物'},
  {words:['机械动力','工业','科技','自动化','create','tech'],terms:['create','technology','automation'],label:'机械 / 科技 / 自动化'},
  {words:['生物群系','地形','世界生成','群系','biome'],terms:['biomes','worldgen','terrain'],label:'群系 / 地形生成'},
  {words:['光影','着色器','shader'],terms:['shader','iris','oculus'],label:'光影 / 着色器'},
  {words:['建筑','装饰','家具','furniture'],terms:['furniture','decoration','building'],label:'建筑 / 家具 / 装饰'},
  {words:['传送','传送石','传送点','waystone'],terms:['waystones','teleport'],label:'传送 / 传送点'},
  {words:['墓碑','坟墓','死亡','grave'],terms:['grave','death'],label:'墓碑 / 死亡物品'},
  {words:['血量显示','信息显示','玉','jade','waila'],terms:['jade','waila','HUD'],label:'信息显示 / HUD'},
  {words:['汉化','中文','翻译','本地化'],terms:['Chinese','translation','localization'],label:'中文 / 汉化'}
];
const normalized=s=>String(s||'').toLowerCase().replace(/[\s_’'\-:()[\]]/g,'');
function expandQuery(query){
  query=String(query||'').trim();if(query.length>160)throw Error('搜索词最多 160 字');
  const n=normalized(query),topic=query&&TOPICS.find(t=>t.words.some(w=>n.includes(normalized(w))));
  const terms=[query,...topic?.terms||[]].filter((v,i,a)=>a.indexOf(v)===i);
  return {query,terms:terms.length?terms:[''],label:topic?.label||query};
}
class ResourceSearch{
  constructor(resources,names){this.resources=resources;this.names=names;this.cache=new Map();}
  async search(input,signal){
    const {kind='mod',game='',loader=''}=input;if(!['mod','modpack','resourcepack','shader'].includes(kind)||!['','forge','neoforge','fabric'].includes(loader))throw Error('搜索条件无效');
    const expanded=expandQuery(input.query),offset=Math.max(0,Math.floor(Number(input.offset)||0)),key=JSON.stringify([expanded.query,kind,game,loader]);
    let entry=this.cache.get(key);if(!entry||Date.now()-entry.time>5*60*1000){entry={time:Date.now(),pages:new Map(),items:[],seen:new Set(),more:true,warnings:[]};this.cache.set(key,entry);while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);}
    // A bounded page of each query/source, cached and merged, avoids constant polling.
    const page=entry.pages.size;if(entry.items.length<offset+20&&entry.more){
      const timeout=signal?AbortSignal.any([signal,AbortSignal.timeout(14000)]):AbortSignal.timeout(14000);
      const sources=['modrinth','curseforge'],jobs=[],found=[],warnings=[];let more=false,success=0;
      for(const source of sources)for(const query of expanded.terms)jobs.push({source,query});
      await pool(jobs,4,async j=>{try{const r=await this.resources.search({...input,...j,offset:page*20},timeout);success++;more ||= r.hasMore;r.items.forEach((p,i)=>found.push({...p,_score:rank(p,expanded,j.query,i),alternatives:[]}));}catch(e){if(signal?.aborted)throw e;warnings.push((j.source==='modrinth'?'Modrinth':'CurseForge')+' 暂未返回完整结果');}});
      if(/[\u3400-\u9fff]/.test(expanded.query)&&kind==='mod'){
        try{const rows=await this.names.search(expanded.query,page+1,timeout);success++;more ||= rows.length>=20;
          await pool(rows.slice(0,8),3,async item=>{try{const wiki=await this.names.page(item.id,timeout),candidates=[];
            for(const site of wiki.sites){try{let id=site.id;if(site.slug){const r=await this.resources.search({source:site.source,kind,query:site.slug},timeout);id=r.items.find(p=>p.slug===site.slug)?.id;if(!id)continue;}const project=await this.resources.project(site.source,id,timeout);if(project.kind!==kind)continue;const versions=await this.resources.versions(project,{game,loader},timeout);if(versions.length)candidates.push(project);}catch{}}
            if(candidates.length){const p=candidates.find(p=>p.source==='modrinth')||candidates[0];found.push({...p,chineseName:wiki.name,wiki:wiki.url,_score:150,alternatives:candidates.filter(c=>c!==p)});}
          }catch{}});
        }catch{warnings.push('MC百科中文匹配暂不可用，已使用关键词扩展搜索');}
      }
      if(!success)throw Error('资源平台暂时无法连接，请稍后重试');
      found.sort((a,b)=>b._score-a._score);
      // Only verified encyclopedia links merge identities across platforms.
      const pageItems=[];for(const p of found){const ids=[p,...p.alternatives].map(p=>p.source+':'+p.id);if(ids.some(id=>entry.seen.has(id)))continue;ids.forEach(id=>entry.seen.add(id));delete p._score;pageItems.push(p);}
      entry.items.push(...pageItems);entry.more=more;entry.warnings=[...new Set(warnings)];entry.pages.set(page,true);
    }
    return {items:entry.items.slice(offset,offset+20),hasMore:entry.items.length>offset+20||entry.more,expanded:expanded.label,terms:expanded.terms,warnings:entry.warnings};
  }
  async details(input,target,signal){
    const candidates=[input,...(Array.isArray(input.alternatives)?input.alternatives.slice(0,3):[])],choices=[];let lastError;
    const name=input.chineseName&&input.wiki?{name:input.chineseName,url:input.wiki}:await this.names.lookup(input,signal);
    // Verify cross-platform identity through the encyclopedia, never title alone.
    if(name&&candidates.length===1){try{const id=/^https:\/\/www\.mcmod\.cn\/class\/(\d+)\.html$/.exec(name.url)?.[1];if(id){const wiki=await this.names.page(id,signal);for(const site of wiki.sites){let projectId=site.id;if(site.slug){const r=await this.resources.search({source:site.source,kind:input.kind,query:site.slug},signal);projectId=r.items.find(p=>p.slug===site.slug)?.id;}if(projectId&&!candidates.some(c=>c.source===site.source&&(c.id===projectId||c.slug===projectId)))candidates.push({...site,id:projectId});}}}catch{}}
    for(const c of candidates){try{const project=await this.resources.project(c.source,c.id,signal),t=project.kind==='modpack'?{}:target;
      const versions=await this.resources.versions(project,t,signal);let direct=false;
      if(versions.length){const f=await this.resources.file(project,versions[0].id,t,signal);direct=!!f.url;}
      choices.push({project,versions,target:t,direct});
    }catch(e){lastError=e;}}
    if(!choices.length)throw lastError||Error('未找到可用下载来源');
    choices.sort((a,b)=>Number(!!b.versions.length)-Number(!!a.versions.length)||Number(b.direct)-Number(a.direct)||Number(b.project.source==='modrinth')-Number(a.project.source==='modrinth'));
    const best=choices[0];best.name=name||await this.names.lookup(best.project,signal);
    best.selection=best.versions.length?(best.direct?'已自动选择兼容且可直接下载的来源':'已选择兼容来源；部分文件需按作者要求手动下载'):'当前筛选条件下没有兼容文件';
    return best;
  }
}
function rank(p,e,term,index) {
  const title=normalized(p.title),query=normalized(e.query);
  // Projects often label the same project "(NeoForge)" or "(Forge/Fabric)".
  const base=normalized(p.title.replace(/\s*\((?:(?:neoforge|forge|fabric|quilt)[\s,/&+|-]*)+\)\s*$/i,''));
  const exact=query&&(query===title||query===base);
  return (exact?100:query&&title.includes(query)?65:0)+(term===e.query?15:0)+(p.source==='modrinth'?2:0)+(20-index)/20;
}
module.exports={ResourceSearch,expandQuery};
