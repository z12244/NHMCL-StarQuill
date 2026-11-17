const test=require('node:test'),assert=require('node:assert/strict');
const {createAssistant}=require('../ai-assistant.cjs');
test('saved DeepSeek dashboard URL and ds alias recover without losing the bound credential',async()=>{
 let config={base:'https://platform.deepseek.com/api_keys/chat/completions',model:'ds',secret:'fixture'};
 const db={read:()=>config,transaction:fn=>fn(),put:(_,v)=>{config=v;}};
 const ai=createAssistant({shared:()=>db,online:()=>true,context:async()=>({}),fetcher:async(url,o)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(o.headers.Authorization,'Bearer fixture');
  assert.equal(JSON.parse(o.body).model,'deepseek-flash');return Response.json({choices:[{message:{content:'收到'}}]});}});
 assert.equal((await ai.config()).model,'deepseek-flash');assert.equal((await ai.ask({prompt:'测试'})).text,'收到');
 await ai.save({base:'https://api.deepseek.com',model:'ds'});assert.equal(config.secret,'fixture');
 await assert.rejects(ai.save({base:'https://third.example',model:'ds'}),/重新填写/);
 await ai.save({base:'https://third.example',model:'ds',key:'another'});assert.equal(config.model,'ds');
});
