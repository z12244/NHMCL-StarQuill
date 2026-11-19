const {matchProjects,projectInfo}=require('./addon-index.cjs');
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
    const {kind='mod',game='',loader='',sort='relevance'}=input;
    if(!['mod','modpack','resourcepack','shader'].includes(kind)||!['','forge','neoforge','fabric','cleanroom'].includes(loader)||!['relevance','downloads','updated'].includes(sort))throw Error('搜索条件无效');
    const expanded=expandQuery(input.query);
    const offset=Number(input.offset||0);
    if(!Number.isSafeInteger(offset)||offset<0||offset%20!==0)throw Error('页码无效');
    const key=JSON.stringify([expanded.query,kind,game,loader,sort]);
    let entry=this.cache.get(key);
    if(!entry||(!offset&&(input.refresh||Date.now()-entry.time>300000))){
      const matches=matchProjects(expanded.query,kind);
      const exact=matches.filter(m=>m.score===100);
      const directMatches=exact.length?exact:matches;
      const terms=new Set(exact.length?[expanded.query]:expanded.terms);
      for(const {entry} of directMatches){
        const term=entry.english||entry.cf||entry.mr;
        if(term)terms.add(term);
      }
      const scores=new Map(directMatches.map(({entry,score})=>[entry.id,score]));
      const streams=[];
      for(const source of ['modrinth','curseforge']){
        for(const {entry} of directMatches){
          const slug=source==='modrinth'?entry.mr:entry.cf;
          if(slug)streams.push({source,slug,offset:0,queue:[],done:false});
        }
        for(const query of terms)streams.push({source,query,offset:0,queue:[],done:false});
      }
      if(!matches.length&&kind==='mod'&&/[\u3400-\u9fff]/.test(expanded.query))streams.push({source:'mcmod',query:expanded.query,offset:0,queue:[],done:false});
      entry={time:Date.now(),scores,streams,items:[],seen:new Set(),warnings:new Set(),tail:Promise.resolve(),success:false};
      this.cache.set(key,entry);
      while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);
    }
    // Share a cursor per query. Concurrent requests must never consume the same upstream page twice.
    const task=entry.tail.then(async()=>{
      const compare=(a,b)=>{
        if(sort==='downloads')return (b.downloads||0)-(a.downloads||0);
        if(sort==='updated')return (Date.parse(b.updated)||0)-(Date.parse(a.updated)||0);
        return b._score-a._score;
      };
      while(entry.items.length<=offset+20){
        signal?.throwIfAborted();
        const empty=entry.streams.filter(stream=>!stream.done&&!stream.queue.length);
        await pool(empty,4,async stream=>{
          try{
            const timeout=AbortSignal.timeout(stream.source==='mcmod'?5500:10000);
            const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
            const filter={kind,game,loader,sort,query:stream.query,source:stream.source,offset:stream.offset};
            let result;
            if(stream.slug){
              const project=await this.resources.bySlug(stream.source,kind,stream.slug,filter,requestSignal);
              result={items:project?[project]:[],hasMore:false};
            }else if(stream.source==='mcmod'){
              result=await this.localized(filter,requestSignal);
            }else{
              result=await this.resources.search(filter,requestSignal);
            }
            const signature=result.items.map(p=>p.id).join('|');
            stream.done=!result.hasMore||!result.items.length||stream.signature===signature;
            stream.signature=signature;
            stream.offset+=20;
            stream.queue=result.items.map((p,i)=>{
              const info=projectInfo(p);
              const score=rank(p,expanded,stream.query,filter.offset+i)+(entry.scores.get(info?.id)||0)*2;
              return {...p,chineseName:p.chineseName||(/\p{Script=Han}/u.test(info?.name||'')?info.name:''),wiki:p.wiki||info?.url,
                _score:p.chineseName?150:score,alternatives:p.alternatives||[]};
            }).sort(compare);
            if(stream.source!=='mcmod'||stream.queue.length)entry.success=true;
          }catch(error){
            if(signal?.aborted)throw error;
            stream.done=true;
            entry.warnings.add(({modrinth:'Modrinth',curseforge:'CurseForge',mcmod:'MC百科'})[stream.source]+' 部分结果暂不可用');
          }
        });
        if(!entry.success)throw Error('资源平台暂时无法连接，请重新搜索');
        const available=entry.streams.filter(stream=>stream.queue.length);
        available.sort((a,b)=>compare(a.queue[0],b.queue[0]));
        if(!available.length)break;
        const {_score,...project}=available[0].queue.shift();
        const ids=[project,...project.alternatives].map(p=>p.source+':'+p.id);
        const local=projectInfo(project);
        if(local)ids.push('wiki:'+kind+':'+local.id);
        const duplicate=ids.some(id=>entry.seen.has(id));
        ids.forEach(id=>entry.seen.add(id));
        if(!duplicate)entry.items.push(project);
      }
      return {items:entry.items.slice(offset,offset+20),hasMore:entry.items.length>offset+20,expanded:expanded.label,warnings:[...entry.warnings]};
    });
    entry.tail=task.catch(()=>{if(this.cache.get(key)===entry)this.cache.delete(key);});
    return task;
  }
  async localized(filter,signal){
    const rows=await this.names.search(filter.query,1+filter.offset/20,signal);
    const items=[];
    await pool(rows,3,async row=>{
      if(signal.aborted)return;
      try{
        const wiki=await this.names.page(row.id,signal);
        const candidates=[];
        for(const site of wiki.sites.filter(site=>site.kind===filter.kind)){
          try{
            let id=site.id;
            if(site.slug){
              const result=await this.resources.search({...filter,source:site.source,query:site.slug,offset:0},signal);
              id=result.items.find(p=>p.slug===site.slug)?.id;
            }
            if(!id)continue;
            const project=await this.resources.project(site.source,id,signal);
            if(project.kind===filter.kind&&(!filter.game&&!filter.loader||(await this.resources.versions(project,filter,signal)).length))candidates.push(project);
          }catch{ /* One linked platform may be unavailable. */ }
        }
        if(candidates.length)items.push({...candidates[0],chineseName:wiki.name,wiki:wiki.url,alternatives:candidates.slice(1)});
      }catch{ /* Other encyclopedia entries may still resolve. */ }
    });
    if(!items.length)signal.throwIfAborted();
    return {items,hasMore:rows.length>=20};
  }
  async details(input,target,signal){
    const candidates=[input,...(Array.isArray(input.alternatives)?input.alternatives.slice(0,3):[])],choices=[];let lastError;
    const local=projectInfo(input);
    if(local){
      if(local.mr&&input.source!=='modrinth')candidates.push({source:'modrinth',id:local.mr});
      if(local.cf&&input.source!=='curseforge'){
        try{const project=await this.resources.bySlug('curseforge',input.kind,local.cf,{},signal);
          if(project)candidates.push(project);
        }catch{ /* Keep the original source available. */ }
      }
    }
    const name=local?{name:local.name,url:local.url}:input.chineseName&&input.wiki?{name:input.chineseName,url:input.wiki}:await this.names.lookup(input,signal);
    // Verify cross-platform identity through the encyclopedia, never title alone.
    if(!local&&name&&candidates.length===1){try{const id=/^https:\/\/www\.mcmod\.cn\/class\/(\d+)\.html$/.exec(name.url)?.[1];if(id){const wiki=await this.names.page(id,signal);for(const site of wiki.sites){let projectId=site.id;if(site.slug){const r=await this.resources.search({source:site.source,kind:input.kind,query:site.slug},signal);projectId=r.items.find(p=>p.slug===site.slug)?.id;}if(projectId&&!candidates.some(c=>c.source===site.source&&(c.id===projectId||c.slug===projectId)))candidates.push({...site,id:projectId});}}}catch{}}
    for(const c of candidates){try{const project=await this.resources.project(c.source,c.id,signal),t=target;
      if(project.kind!==input.kind)continue;
      const versions=await this.resources.versions(project,t,signal);
      versions.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
      const stable=versions.findIndex(v=>v.channel==='release');
      if(stable>0)versions.unshift(versions.splice(stable,1)[0]);
      let direct=false;
      if(versions.length){const f=await this.resources.file(project,versions[0].id,t,signal).catch(error=>{if(signal?.aborted)throw error;return null;});direct=!!f?.url;}
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
  return (exact?100:query&&title.includes(query)?65:0)+(term===e.query?15:0)+1/(1+index);
}
module.exports={ResourceSearch,expandQuery};
