const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const Zip=require('adm-zip');
const {memorySnapshot,trimScript}=require('../memory.cjs');
const {redact}=require('../core.cjs');
const {logBuffer,analyzeCrash,crashBaseline,freshFatalFiles,unexpectedExit,exportCrash,latestCrash}=require('../crash-reports.cjs');

test('memory snapshot reads live values and clamps available bytes',()=>{
  const system={totalmem:()=>16*1024**3,freemem:()=>3*1024**3};
  assert.equal(memorySnapshot(system).available,3*1024**3);
  system.freemem=()=>2*1024**3;assert.equal(memorySnapshot(system).used,14*1024**3);
  system.freemem=()=>20*1024**3;assert.equal(memorySnapshot(system).available,16*1024**3);
});
test('removed memory optimization never spawns scripts',async()=>{assert.equal((await require('../memory.cjs').optimizeMemory([])).supported,false);});
test('manual, successful and unexpected exits are distinguished',()=>{
  assert.equal(unexpectedExit(0,null,false),false);
  assert.equal(unexpectedExit(1,null,true,1),false);
  assert.equal(unexpectedExit(null,'SIGTERM',false),true);
  assert.equal(unexpectedExit(0,null,false,1),true);
  assert.equal(unexpectedExit(-1,null,false),true);
  assert.equal(unexpectedExit(0,null,false,0,'spawn failed'),true);
});
test('analysis differentiates Java heap and native memory exhaustion',()=>{
  assert.equal(analyzeCrash('java.lang.OutOfMemoryError: Java heap space',1)[0].id,'heap');
  assert.equal(analyzeCrash('There is insufficient memory for the Java Runtime Environment to continue.',1)[0].id,'native-memory');
});
test('analysis recognizes compatibility, duplicate mods, mixins and graphics',()=>{
  for(const [text,id] of [['UnsupportedClassVersionError','java'],['Missing mandatory dependencies: fabric-api','dependency'],['DuplicateModsFoundException','duplicate'],['MixinApplyError: example.mixin.json','mixin'],['GLFW error 65542','graphics'],['No space left on device','disk'],['EXCEPTION_ACCESS_VIOLATION','native']])assert.ok(analyzeCrash(text,1).some(f=>f.id===id),id);
  assert.equal(analyzeCrash('unexplained exit',-1073741819)[0].id,'unknown');
});
test('redaction covers quoted passwords, legacy sessions and Xbox authentication',()=>{
  const secret=['A_TOKEN','B_TOKEN','two words secret','OLD_SECRET','XBOX_SECRET'];
  const text='--accessToken="A_TOKEN" {"refresh_token":"B_TOKEN","password":"two words secret"} token:OLD_SECRET:0123456789abcdef0123456789abcdef XBL3.0 x=abc;XBOX_SECRET';
  for(const s of secret)assert.ok(!redact(text).includes(s));
  assert.deepEqual(JSON.parse(redact('{"password":"two words secret","accessToken":"A_TOKEN"}')),{password:'[redacted]',accessToken:'[redacted]'});
});
test('session logs retain a bounded tail',()=>{
  const logs=logBuffer(16);logs.append('abcdefghijklmnop');logs.append('last');assert.equal(logs.text(),'last');
  logs.append('01234567890123456789');assert.equal(Buffer.byteLength(logs.text()),16);
});
test('decode split Windows Java bytes and UTF-8 mod output; recognize missing entry point',async()=>{
  const {Readable}=require('node:stream'),{once}=require('node:events');
  const {pipeJavaLog}=require('../java-output.cjs');
  const stream=Readable.from([Buffer.from([0xb4]),Buffer.from([0xed,0xce,0xf3,10]),Buffer.from('模组✓\n'),Buffer.from('last')]);
  let text='';
  pipeJavaLog(stream,'GBK',line=>{text+=line;});
  await once(stream,'end');
  assert.equal(text,'错误\n模组✓\nlast');
  for(const message of ['错误: 找不到或无法加载主类 example.Main','Error: Could not find or load main class example.Main']){
    assert.ok(analyzeCrash(message,1).some(f=>f.id==='main-class'&&f.evidence.includes('example.Main')));
  }
});
test('crash ZIP exports fresh logs, sanitizes secrets and restores last report',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-basic-crash-'));
  const gameDir=path.join(root,'versions','测试 1.21.1');
  await fs.mkdir(path.join(gameDir,'logs'),{recursive:true});await fs.mkdir(path.join(gameDir,'crash-reports'));
  const old=path.join(gameDir,'crash-reports','crash-old-client.txt');await fs.writeFile(old,'old error');
  const context={root,gameDir,version:'测试 1.21.1',java:'Java 21',memory:4,startedAt:Date.now(),baseline:await crashBaseline(root,gameDir),logs:logBuffer()};
  assert.equal((await freshFatalFiles(context)).length,0);
  await fs.writeFile(path.join(gameDir,'logs','latest.log'),'OutOfMemoryError: Java heap space\naccessToken=TOKEN_SECRET password="PASSWORD WITH SPACES" custom=CURRENT_SECRET');
  await fs.writeFile(path.join(gameDir,'logs','debug.log'),'old debug');await fs.utimes(path.join(gameDir,'logs','debug.log'),new Date(0),new Date(0));
  await fs.writeFile(path.join(gameDir,'crash-reports','crash-new-client.txt'),'OutOfMemoryError: Java heap space\n');
  await fs.writeFile(path.join(gameDir,'hs_err_pid123.log'),'EXCEPTION_ACCESS_VIOLATION\n');
  await fs.writeFile(path.join(gameDir,'accounts.json'),'PRIVATE ACCOUNT');
  context.logs.append('--accessToken TOKEN_SECRET\nGame terminated\n');
  const fatal=await freshFatalFiles(context);assert.equal(fatal.length,2);
  const report=await exportCrash(context,{code:1,fatal},text=>text.replaceAll('CURRENT_SECRET','[redacted]'));
  const zip=new Zip(report.file),names=zip.getEntries().map(e=>e.entryName);
  assert.ok(names.includes('分析报告.txt'));assert.ok(names.includes('launcher.log'));assert.ok(names.includes('logs/latest.log'));
  assert.ok(!names.some(n=>/accounts|crash-old|debug/.test(n)));
  for(const e of zip.getEntries())for(const secret of ['TOKEN_SECRET','PASSWORD WITH SPACES','CURRENT_SECRET','PRIVATE ACCOUNT'])assert.ok(!e.getData().toString().includes(secret),secret);
  assert.ok(report.findings.some(f=>f.id==='heap'));assert.equal((await latestCrash(root)).file,report.file);
  const second=await exportCrash(context,{code:1,fatal});assert.notEqual(second.file,report.file);await fs.access(report.file);
  await fs.writeFile(path.join(root,'.starquill','crash-reports','latest.json'),JSON.stringify({id:'../../outside',findings:[]}));assert.equal(await latestCrash(root),null);
});
test('large crash file keeps fatal header and large game log keeps tail',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-basic-limits-')),gameDir=root;
  await fs.mkdir(path.join(root,'logs'));const startedAt=Date.now();
  await fs.writeFile(path.join(root,'logs','latest.log'),'old prefix\n'+'x'.repeat(17*1024**2)+'\nlast event');
  const native=path.join(root,'hs_err_pid42.log');await fs.writeFile(native,'EXCEPTION_ACCESS_VIOLATION\n'+'x'.repeat(17*1024**2)+'\nEND_NATIVE');
  const context={root,gameDir,version:'Basic',java:'Java 21',memory:4,startedAt,baseline:new Map(),logs:logBuffer()};
  const report=await exportCrash(context,{code:1,fatal:await freshFatalFiles(context)}),zip=new Zip(report.file);
  assert.ok(report.findings.some(f=>f.id==='native'));
  assert.ok(zip.readAsText('logs/latest.log').endsWith('last event'));assert.ok(!zip.readAsText('logs/latest.log').includes('old prefix'));
  const nativeText=zip.readAsText('crash-reports/hs_err_pid42.log');assert.ok(nativeText.startsWith('EXCEPTION_ACCESS_VIOLATION'));assert.ok(nativeText.endsWith('END_NATIVE'));assert.ok(Buffer.byteLength(nativeText)<16*1024**2+256);
});
