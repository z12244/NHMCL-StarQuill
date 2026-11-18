const {test}=require('node:test'),assert=require('node:assert/strict');
const {failure}=require('../src/auth-errors.cjs');
const {MicrosoftAuth,PROJECT_CLIENT_ID}=require('../src/accounts.cjs');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
function chain(last){return async(url,options)=>{
  if(url.includes('user.auth.xboxlive.com'))return json({Token:'PRIVATE_XBL',DisplayClaims:{xui:[{uhs:'HASH'}]}});
  if(url.includes('xsts.auth.xboxlive.com'))return json({Token:'PRIVATE_XSTS',DisplayClaims:{xui:[{uhs:'HASH'}]}});
  if(url.endsWith('/login_with_xbox')){assert.equal(JSON.parse(options.body).identityToken,'XBL3.0 x=HASH;PRIVATE_XSTS');return last();}
  throw Error('Must not request ownership or profile after failed Minecraft token exchange');
};}
test('invalid app registration is distinguished from an unexplained 403 and never claims missing ownership',async()=>{
  const auth=new MicrosoftAuth({fetcher:chain(()=>json({error:'ForbiddenOperationException',errorMessage:'Invalid app registration'},403))});
  await assert.rejects(auth.exchange({access_token:'PRIVATE_MSA'},PROJECT_CLIENT_ID),e=>{assert.equal(e.details.code,'APP_NOT_APPROVED');assert.equal(e.details.stage,'minecraft');assert.equal(e.details.action,'review');assert.match(e.message,/Invalid app registration/);assert.ok(!e.message.includes('没有可用的'));return true;});
  const unknown=new MicrosoftAuth({fetcher:chain(()=>json({error:'FORBIDDEN'},403))});
  await assert.rejects(unknown.exchange({access_token:'PRIVATE_MSA'},PROJECT_CLIENT_ID),e=>{assert.equal(e.details.code,'FORBIDDEN');assert.equal(e.details.action,'retry');assert.match(e.message,/不能断定/);return true;});
});
test('HTML gateway refusals retain HTTP status without being mislabeled as a connection error',async()=>{
  const auth=new MicrosoftAuth({fetcher:chain(()=>new Response('<html>PRIVATE_PROXY_PAGE</html>',{status:403}))});
  await assert.rejects(auth.exchange({access_token:'PRIVATE_MSA'},PROJECT_CLIENT_ID),e=>{assert.equal(e.details.status,403);assert.equal(e.details.code,'NON_JSON_FORBIDDEN');assert.ok(!e.message.includes('PRIVATE'));return true;});
});
test('diagnostics contain no raw server body, token, email or hostile text; correlation IDs must be UUIDs',()=>{
  const e=failure('minecraft',{status:403,data:{errorMessage:'Invalid app registration',access_token:'PRIVATE',message:'private@example.test',requestId:'abc<script>'}},'fallback');
  assert.equal(e.details.requestId,undefined);assert.ok(!JSON.stringify(e.details).includes('PRIVATE'));assert.ok(!e.message.includes('private@example'));
  const id='12345678-1234-1234-1234-123456789abc';assert.equal(failure('minecraft',{status:403,data:{requestId:id}}).details.requestId,id);
});
test('rate limits, outages and malformed successful responses have explicit classifications',async()=>{
  for(const [status,code] of [[429,'RATE_LIMITED'],[503,'SERVICE_UNAVAILABLE'],[401,'UNAUTHORIZED']])assert.equal(failure('minecraft',{status}).details.code,code);
  const auth=new MicrosoftAuth({fetcher:async()=>new Response('bad',{status:200})});
  await assert.rejects(auth.begin(PROJECT_CLIENT_ID),e=>e.details.code==='INVALID_RESPONSE');
});
test('mismatching Xbox user hashes stop before Minecraft exchange',async()=>{
  const auth=new MicrosoftAuth({fetcher:async url=>url.includes('user.auth.')?json({Token:'X',DisplayClaims:{xui:[{uhs:'one'}]}}):json({Token:'S',DisplayClaims:{xui:[{uhs:'two'}]}})});
  await assert.rejects(auth.exchange({access_token:'MSA'},PROJECT_CLIENT_ID),/身份不一致/);
});
