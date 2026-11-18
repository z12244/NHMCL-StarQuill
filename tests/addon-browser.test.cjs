const test=require('node:test');
const assert=require('node:assert/strict');
const {Resources}=require('../src/resources.cjs');
const {ResourceSearch}=require('../src/resource-search.cjs');
const {matchProjects}=require('../src/addon-index.cjs');

test('modpack aliases, Chinese names and mod acronyms resolve within their own registry',()=>{
  for(const query of ['GTNH','格雷科技新视野','GT: New Horizons'])assert.equal(matchProjects(query,'modpack')[0].entry.cf,'gt-new-horizons');
  assert.equal(matchProjects('格雷科技新视野野','modpack')[0].entry.cf,'gt-new-horizons');
  assert.equal(matchProjects('JEI','mod')[0].entry.cf,'jei');
  assert.equal(matchProjects('旅行地图','mod')[0].entry.mr,'journeymap');
  assert.ok(!matchProjects('GTNH','mod').some(m=>m.entry.cf==='gt-new-horizons'));
});
test('translated query returns actual platform projects, catches dead source and deduplicates pages',async()=>{
  const calls=[];
  const search=new ResourceSearch({async bySlug(source,kind,slug,filter){
    assert.equal(slug,'gt-new-horizons');assert.equal(filter.game,'1.7.10');
    return {kind,source,id:'123',slug,title:'GT New Horizons'};
  },async search(input){
    calls.push(input);
    if(input.source==='modrinth')throw Error('offline');
    return {items:[],hasMore:false};
  }},{});
  const result=await search.search({kind:'modpack',query:'格雷科技新视野',game:'1.7.10'});
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].chineseName,'格雷科技：新视野');
  assert.ok(result.warnings.length);
  assert.ok(calls.every(r=>r.kind==='modpack'&&r.game==='1.7.10'));
  assert.equal(result.hasMore,false);
});
test('merge consumes distinct sorted projects and supports going back without refetch',async()=>{
  let calls=0;
  const service=new ResourceSearch({async search({source,offset}){
    calls++;
    const rows=Array.from({length:25},(_,i)=>({source,kind:'mod',id:String(i),title:source+i,downloads:1000-2*i-(source==='curseforge'?1:0)}));
    return {items:rows.slice(offset,offset+20),hasMore:offset+20<rows.length};
  }},{});
  const input={kind:'mod',query:'',sort:'downloads'};
  const pages=[];
  for(const offset of [0,20,40])pages.push(await service.search({...input,offset}));
  assert.deepEqual(pages.map(p=>p.items.length),[20,20,10]);
  assert.deepEqual(pages.map(p=>p.hasMore),[true,true,false]);
  const entries=pages.flatMap(p=>p.items);
  assert.equal(new Set(entries.map(p=>p.source+p.id)).size,50);
  assert.deepEqual(entries.map(p=>p.downloads),Array.from({length:50},(_,i)=>1000-i));
  const saved=calls;
  assert.deepEqual(await service.search(input),pages[0]);assert.equal(calls,saved);
});
test('provider filters and sort reach both real adapter routes for modpacks',async()=>{
  const calls=[];
  const api=new Resources({fetcher:async url=>{calls.push(new URL(url));return Response.json(url.includes('modrinth')?{hits:[],total_hits:0}:{data:[]});}});
  for(const source of ['modrinth','curseforge'])await api.search({kind:'modpack',query:'pack',loader:'cleanroom',game:'1.12.2',sort:'updated',source});
  assert.deepEqual(JSON.parse(calls[0].searchParams.get('facets')),[['project_type:modpack'],['versions:1.12.2'],['categories:forge']]);
  assert.equal(calls[0].searchParams.get('index'),'updated');
  assert.equal(calls[1].searchParams.get('modLoaderType'),'1');
  assert.equal(calls[1].searchParams.get('classId'),'4471');
  assert.equal(calls[1].searchParams.get('sortField'),'3');
});
