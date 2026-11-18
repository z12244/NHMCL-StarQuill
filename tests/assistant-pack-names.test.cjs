const test=require('node:test'),assert=require('node:assert/strict');
const {prepareInstall,matchResource}=require('../src/assistant-install.cjs');
for(const [name,id] of [['贪婪2整合包','484'],['香草纪元','1095']]){
  test(name+' finds its catalog page without installing an unrelated pack',async()=>{
    const result=await prepareInstall({kind:'modpack',value:name},{search:async()=>({items:[{kind:'modpack',source:'curseforge',title:'GreedyCraft',slug:'greedycraft'}]})});
    assert.equal(result.url,'https://www.mcmod.cn/modpack/'+id+'.html');
  });
}
test('Chinese short title resolves the full platform title',()=>{
  const p={source:'modrinth',kind:'modpack',title:'VanillaEra: FaresChron',slug:'vefc'};
  assert.equal(matchResource({kind:'modpack',value:'香草纪元整合包'},[p]),p);
});
test('Chinese instructions retain the user’s indexed name rather than a model translation',()=>{
  const {requestName}=require('../src/assistant-install.cjs');
  for(const [request,kind,expected] of [['麻烦帮我装个旅行地图模组','mod','旅行地图'],['请下载一下《格雷科技新视野》整合包','modpack','格雷科技新视野']])
    assert.equal(requestName(request,{kind,value:'inaccurate translation'}),expected);
});
test('generic fuzzy searches lead to a choice, not installation',async()=>{
  const r=await prepareInstall({kind:'modpack',value:'科技探索随便看看'},{search:async()=>({items:[]})});
  assert.equal(r.type,'search-choice');assert.equal(r.kind,'modpack');
});
