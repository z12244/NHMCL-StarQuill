const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {versionRequest,ensureInstance}=require('../src/shared/assistant-instance.cjs');
const {createAssistant}=require('../src/shared/ai-assistant.cjs');
test('Chinese install commands work independently of model wording',async()=>{
 const ai=createAssistant({online:()=>true,fetcher:()=>{throw Error('unexpected network')}});
 for(const [prompt,game,loader,mod] of [['帮我安装1.21.1版本','1.21.1','',''],['帮我下载1.12.2forge','1.12.2','forge',''],['下载一个1.21.1带有forge的机械动力模组','1.21.1','forge','机械动力']]){
 const r=await ai.ask({mode:'chat',prompt});assert.deepEqual([r.action.game,r.action.loader,r.action.mod],[game,loader,mod]);}
 for(const prompt of ['不要安装1.12.2forge','如何安装1.21.1','安装1.21.1可以吗','下载一个1.21.1整合包'])assert.equal(versionRequest(prompt),null);
});
test('install targets the selected root and leaves occupied names alone',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'instance-intent-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'versions','1.12.2-forge'),{recursive:true});
 const called=[];const spec={game:'1.12.2',loader:'forge',version:'14',stable:true};
 const id=await ensureInstance(versionRequest('下载1.12.2forge'),{root,loaders:{list:async()=>[spec],install:async(s,n)=>called.push([s,n])},changed:async n=>called.push(n)});
 assert.equal(id,'1.12.2-forge (2)');assert.deepEqual(called,[[spec,id],id]);
});
