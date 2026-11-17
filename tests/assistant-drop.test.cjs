const test=require('node:test'),assert=require('node:assert/strict');
const {skinCardAddress}=require('../launcher-drops.cjs');
const {endpoint,actionFrom,scrub}=require('../ai-assistant.cjs');
const {installTarget,matchResource}=require('../assistant-install.cjs');
test('JEI exact project wins over the encyclopedia alias of JEI++',()=>{
  const cmd={kind:'mod',value:'JEI'};
  const candidates=['jei-plus-plus','jei'].map(slug=>({slug,kind:'mod',source:'modrinth'}));
  assert.equal(matchResource(cmd,candidates).slug,'jei');
  assert.throws(()=>matchResource({kind:'mod',value:'no-such-project'},candidates));
});
test('installation respects explicit target, loader, game and ambiguity',()=>{
  const targets=['One','Two'].map(id=>({id,game:'1.20.1',loader:'forge'}));
  assert.equal(installTarget({kind:'mod',loader:'forge'},targets,'Two').id,'Two');
  assert.throws(()=>installTarget({kind:'mod'},targets,'none'));
  assert.throws(()=>installTarget({kind:'mod',target:'One',loader:'fabric'},targets,'One'));
  assert.equal(installTarget({kind:'modpack'},[],'none'),null);
});
test('browser URI list / raw and encoded Yggdrasil drag payloads',()=>{
  const site='https://littleskin.cn/api/yggdrasil/';
  for(const link of [site,'authlib-injector:yggdrasil-server:'+site,'authlib-injector:yggdrasil-server:'+encodeURIComponent(site)])
    assert.equal(skinCardAddress({getData:m=>m==='text/uri-list'?'# drag\r\n'+link:''}),site);
  for(const bad of ['file:///C:/foo','https://u:p@some.site/yggdrasil','https://some.site/article','authlib-injector:yggdrasil-server:%xx','https://some.site/yggdrasil?key=private'])
    assert.equal(skinCardAddress({getData:()=>bad}),'');
});
test('LittleSkin dashboard card resolves its guide and prioritizes explicit drag data across formats',()=>{
  const guide='https://manual.littlesk.in/yggdrasil/',api='https://littleskin.cn/api/yggdrasil/';
  const other='https://skin.example.test/custom/',prefix='authlib-injector:yggdrasil-server:';
  const drop=parts=>skinCardAddress({getData:type=>parts[type]||''});
  for(const mime of ['text/uri-list','text/plain','text/x-moz-url']){
    assert.equal(drop({[mime]:guide}),api);
    assert.equal(drop({[mime]:guide.slice(0,-1)+'#yggdrasil-api-地址'}),api);
  }
  assert.equal(drop({'text/uri-list':guide,'text/plain':prefix+encodeURIComponent(other)}),other);
  assert.equal(drop({'text/plain':guide,'text/uri-list':'# links\r\n'+guide+'\r\n'+prefix+encodeURIComponent(other)}),other);
  assert.equal(drop({'text/uri-list':'https://skin.example/yggdrasil','text/plain':api}),api);
  assert.equal(drop({'text/plain':prefix+'https://skin.example.test/a%2Fb'}),'https://skin.example.test/a%2Fb');
  assert.equal(drop({'text/uri-list':'https://manual.littlesk.in.example/yggdrasil/'}),'https://manual.littlesk.in.example/yggdrasil/');
  assert.equal(drop({'text/uri-list':'https://manual.littlesk.in/yggdrasil/?key=private'}),'');
  assert.equal(drop({'text/x-moz-url':'https://example.test/help\n'+api}),'');
});
test('model endpoint normalizes compat paths and rejects remote plain HTTP and credentials',()=>{
  assert.equal(endpoint('https://example.org/v1/'),'https://example.org/v1/chat/completions');
  assert.equal(endpoint('http://127.0.0.1:9000/chat/completions'),'http://127.0.0.1:9000/chat/completions');
  for(const u of ['http://example.org','https://a:b@example.org','https://example.org?key=secret','file:///C:/'])assert.throws(()=>endpoint(u));
});
test('AI actions are limited to valid launcher operations',()=>{
  assert.equal(actionFrom({type:'shell',value:'foo'}),null);
  assert.equal(actionFrom({type:'page',value:'https://invalid.test'}),null);
  assert.deepEqual(actionFrom({type:'settings',value:'java',extra:'never used'}),{type:'settings',value:'java'});
  assert.doesNotMatch(scrub('api_key=secret x-api-key:secret C:\\Users\\Example\\data user@example.org'),/secret|Example|user@example/);
});
