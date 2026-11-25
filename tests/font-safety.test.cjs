const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Game,fontSafetyApplies}=require('../src/shared/game.cjs');
const {layout,writeJSON}=require('../src/shared/storage.cjs');

test('version gate covers 1.20.5+ and excludes 1.20.4 and older',()=>{
  for(const id of ['1.20.5','1.20.6','1.21','1.21.1','1.21.10','24w03a','24w14a','26.1','26.3','26.4-snapshot-10'])assert.equal(fontSafetyApplies(id),true,id);
  for(const id of ['1.20.4','1.20.1','1.19.4','1.12.2','23w51a','1.7.10',''])assert.equal(fontSafetyApplies(id),false,id);
});

test('Windows launches get the font agent only when enabled, affected and not already modded',{skip:process.platform!=='win32'},async t=>{
  async function instance(version,{mods=false}={}){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-font-safety-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const p=layout(root,version);
    await writeJSON(p.json,{id:version,mainClass:'Main',arguments:{game:[],jvm:[]}});
    await fs.writeFile(p.jar,'jar');
    if(mods){await fs.mkdir(path.join(p.game,'mods'),{recursive:true});await fs.writeFile(path.join(p.game,'mods','m2sfix-mod-1.0.0.jar'),'jar');}
    return {root,version};
  }
  const toolsDir=path.join('C:','StarQuill','tools');
  const enabled=await instance('1.21.1');
  const args=(await new Game({root:enabled.root,version:enabled.version,name:'Player',memory:1,fontSafety:true,toolsDir}).prepare()).args;
  assert.ok(args.some(a=>a.startsWith('-javaagent:')&&a.includes('m2sfix-agent-1.0.0.jar')),'agent injected');

  const disabled=await instance('1.21.1');
  const off=(await new Game({root:disabled.root,version:disabled.version,name:'Player',memory:1,fontSafety:false,toolsDir}).prepare()).args;
  assert.ok(!off.some(a=>a.includes('m2sfix-agent')),'opt-out respected');

  const old=await instance('1.20.4');
  const legacy=(await new Game({root:old.root,version:old.version,name:'Player',memory:1,fontSafety:true,toolsDir}).prepare()).args;
  assert.ok(!legacy.some(a=>a.includes('m2sfix-agent')),'1.20.4 is not affected');

  const modded=await instance('1.21.1',{mods:true});
  const viaMod=(await new Game({root:modded.root,version:modded.version,name:'Player',memory:1,fontSafety:true,toolsDir}).prepare()).args;
  assert.ok(!viaMod.some(a=>a.includes('m2sfix-agent')),'mod version already present');
});
