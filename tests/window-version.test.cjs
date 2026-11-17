const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Game}=require('../game.cjs');
const {layout,writeJSON}=require('../storage.cjs');
const {windowSettings,gameWindow,syncGameDisplay}=require('../window-settings.cjs');
const {InstanceManager}=require('../instance-manager.cjs');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-window-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}
test('window preferences reach the game arguments for both legacy and modern profiles',async t=>{
  const root=await fixture(t), p=layout(root,'window-test');
  assert.deepEqual(gameWindow(),{width:834,height:514,fullscreen:false});
  assert.deepEqual(gameWindow({}, {width:900,height:540}),{width:900,height:540,fullscreen:false});
  assert.throws(()=>windowSettings({launcherWidth:0}));
  for(const legacy of [true,false]){
    const args=['--width','700','--height','500'];
    const metadata=legacy?{minecraftArguments:args.join(' ')}:{arguments:{game:args}};
    await writeJSON(p.json,{id:'window-test',mainClass:'test.Main',...metadata});
    await fs.writeFile(p.jar,'fixture');
    for(const fullscreen of [true,false]){
      const g=new Game({version:'window-test',root,name:'Test',memory:2,windows:{followLauncher:false,gameWidth:1280,gameHeight:720,fullscreen}});
      const result=await g.prepare();
      assert.deepEqual(result.args.slice(result.args.indexOf('test.Main')+1), ['--width','1280','--height','720',...(fullscreen?['--fullscreen']:[])]);
    }
  }
});
test('saved Minecraft fullscreen and dimension overrides cannot override launcher preferences',async t=>{
  const root=await fixture(t), file=path.join(root,'options.txt');
  await fs.writeFile(file,'fullscreen:true\r\noverrideWidth:2000\r\noverrideHeight:800\r\nmusic:0.5\r\n');
  await syncGameDisplay(root,{fullscreen:false});
  assert.equal(await fs.readFile(file,'utf8'),'fullscreen:false\r\noverrideWidth:0\r\noverrideHeight:0\r\nmusic:0.5\r\n');
});
test('deletion targets one version directory and rejects parents, shared jars and traversal',async t=>{
  const root=await fixture(t), manager=new InstanceManager(root,{});
  const base=layout(root,'base'),child=layout(root,'pack');
  await writeJSON(base.json,{id:'base'});
  for(const key of ['inheritsFrom','jar']){
    await writeJSON(child.json,{[key]:'BASE'});
    await assert.rejects(manager.deleteTarget('base'),/pack.*依赖/);
    assert.equal(await manager.deleteTarget('pack'),child.version);
  }
  await assert.rejects(manager.deleteTarget('..'),/名称无效/);
  await assert.rejects(manager.deleteTarget('absent'),{code:'ENOENT'});
});
