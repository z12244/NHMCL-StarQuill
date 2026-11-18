const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const {detectIsolation,inferredMode} = require('../src/isolation-detection.cjs');
const {instanceOptions} = require('../src/instance-config.cjs');
const {targetInfo} = require('../src/loaders.cjs');
const {layout,writeJSON} = require('../src/storage.cjs');

async function fixture(t,ids){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nhmcl-layout-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const id of ids)await writeJSON(layout(root,id).json,{id,mainClass:'Main'});
  return root;
}
async function put(file,content){
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,content);
}
test('mixed import chooses the same directories for launching and installing across restart',async t=>{
  const root=await fixture(t,['root-profile','modded','unused']);
  await put(path.join(root,'saves','world','level.dat'),'world');
  await put(path.join(root,'versions','modded','mods','existing.jar'),'mod');
  await fs.mkdir(path.join(root,'versions','unused','mods'));
  const report=await detectIsolation(root);
  assert.deepEqual(report.counts,{isolated:1,shared:2,unknown:0});
  const settings=JSON.parse(JSON.stringify({isolate:true,importedIsolation:report}));
  for(const [id,mode] of [['root-profile',false],['modded',true],['unused',false]]){
    assert.equal((await instanceOptions(root,id,settings)).isolate,mode);
    assert.equal((await targetInfo(root,id,settings)).folder,layout(root,id,mode).game);
    await assert.rejects(fs.access(path.join(layout(root,id).version,'.starquill-settings.json')));
  }
  assert.equal(inferredMode(report,path.dirname(root),'root-profile'),undefined);
  await writeJSON(path.join(layout(root,'modded').version,'.starquill-settings.json'),{isolate:'shared'});
  assert.equal((await targetInfo(root,'modded',settings)).folder,root);
  assert.equal((await instanceOptions(root,'modded',settings,{starQuill:{isolate:true}})).isolate,true);
});
test('PCL old and current settings, HMCL legacy and current settings override directory remnants',async t=>{
  const root=await fixture(t,['p','old','h','modern','inherited','conflict','custom']);
  const file=(id,p)=>path.join(layout(root,id).version,p);
  await put(file('p','options.txt'),'');
  await put(file('p','PCL/Setup.ini'),'VersionArgumentIndieV2:False\r\nVersionArgumentIndie:1');
  await put(file('old','PCL/Setup.ini'),Buffer.from('\uFEFFVersionArgumentIndie:1','utf16le'));
  await writeJSON(file('h','hmclversion.cfg'),{usesGlobal:false,gameDirType:0});
  await writeJSON(file('modern','.hmcl/config/instance-game-settings.json'),{overrideProperties:['runningDirectory'],runningDirectory:''});
  await writeJSON(file('modern','hmclversion.cfg'),{gameDirType:0});
  await writeJSON(file('inherited','hmclversion.cfg'),{usesGlobal:true,gameDirType:0});
  await put(file('conflict','PCL/Setup.ini'),'VersionArgumentIndieV2=True');
  await writeJSON(file('conflict','hmclversion.cfg'),{gameDirType:0});
  await writeJSON(file('custom','hmclversion.cfg'),{gameDirType:2,gameDir:path.join(root,'elsewhere')});
  const result=await detectIsolation(root);
  assert.deepEqual({...result.versions},{p:'shared',old:'isolated',h:'shared',modern:'isolated'});
  assert.equal(result.counts.unknown,3);
});
test('unplayed versions remain undecided, launcher metadata alone is insufficient',async t=>{
  const root=await fixture(t,['new','__proto__','official']);
  await fs.mkdir(path.join(root,'assets'));
  await fs.mkdir(path.join(root,'mods'));
  await fs.mkdir(path.join(layout(root,'new').version,'natives'));
  await writeJSON(path.join(root,'launcher_profiles.json'),{profiles:{abc:{lastVersionId:'official'}}});
  await put(path.join(layout(root,'__proto__').version,'options.txt'),'');
  const report=await detectIsolation(root);
  assert.equal(report.counts.unknown,1);
  assert.equal(inferredMode(report,root,'__proto__'),'isolated');
  assert.equal(inferredMode(report,root,'official'),'shared');
  for(const isolate of [true,false])assert.equal((await instanceOptions(root,'new',{isolate,importedIsolation:report})).isolate,isolate);
});
