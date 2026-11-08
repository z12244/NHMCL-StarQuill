const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parse}=require('node-html-parser');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),doc=parse(html),ids=new Set(doc.querySelectorAll('[id]').map(n=>n.getAttribute('id')));
test('renderer element and script contracts resolve from index',()=>{assert.equal(ids.size,doc.querySelectorAll('[id]').length,'HTML IDs must be unique');for(const name of ['renderer.cjs','market-renderer.cjs','instance-renderer.cjs','offline-renderer.cjs','system-renderer.cjs']){const code=fs.readFileSync(path.join(root,name),'utf8');for(const match of code.matchAll(/(?:el|\$)\('([^']+)'\)/g))assert.ok(ids.has(match[1]),name+' references missing #'+match[1]);}for(const node of doc.querySelectorAll('script[src]'))assert.ok(fs.existsSync(path.join(root,node.getAttribute('src'))),'missing script '+node.getAttribute('src'));});
test('new appearance and resource icon IPC channels have preload and main handlers',()=>{const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8'),main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');for(const channel of ['account-appearance','account-appearance-export','resource-icon']){assert.match(preload,new RegExp("invoke\\('"+channel+"'"));assert.match(main,new RegExp("ipcMain\\.handle\\('"+channel+"'"));}});

test('workshop exposes search and installation without a personal CurseForge connection',async t=>{
  const tmp=await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(),'starquill-workshop-'));
  t.after(()=>fs.promises.rm(tmp,{recursive:true,force:true}));
  const handlers=new Map(),opened=[];
  require('../market-ipc.cjs').registerMarket({
    ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},
    settings:()=>({root:tmp}),shell:{openExternal:url=>opened.push(url)}
  });
  const browse=doc.querySelector('#market-browse');
  assert.ok(browse.querySelector('#market-search'));
  assert.equal(browse.querySelector('input[type=password]'),null);
  assert.doesNotMatch(browse.text,/个人密钥|API Key|CurseForge 开发者平台/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'preload.cjs'),'utf8'),/marketKey|market-key/);
  assert.equal(handlers.has('market-key'),false);
  assert.deepEqual(await handlers.get('market-boot')(),{targets:[]});
  assert.ok(handlers.has('market-search') && handlers.has('market-plan') && handlers.has('market-install'));
  const open=handlers.get('market-open');
  await assert.rejects(open(null,'https://console.curseforge.com/'));
  const project='https://www.curseforge.com/minecraft/mc-mods/jei';
  await open(null,project);assert.deepEqual(opened,[project]);
});
