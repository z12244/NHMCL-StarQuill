const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {readInstanceIcon}=require('../instance-icons.cjs');
async function temporary(t){const base=path.resolve(__dirname,'tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'instance-icons-'));t.after(async()=>{assert.equal(path.dirname(root),base);assert.match(path.basename(root),/^instance-icons-/);await fs.rm(root,{recursive:true,force:true});});return root;}
test('version icons follow each instance and changes on disk',async t=>{
 const root=await temporary(t),a=path.join(root,'versions','A'),b=path.join(root,'versions','B');await fs.mkdir(a,{recursive:true});await fs.mkdir(b,{recursive:true});
 const grass=await fs.readFile(path.resolve(__dirname,'../assets/icon.png')),skin=await fs.readFile(path.resolve(__dirname,'../assets/alex.png'));
 await fs.writeFile(path.join(a,'icon.png'),grass);await fs.writeFile(path.join(b,'icon.png'),skin);
 assert.equal(await readInstanceIcon(root,'A'),'data:image/png;base64,'+grass.toString('base64'));
 assert.equal(await readInstanceIcon(root,'B'),'data:image/png;base64,'+skin.toString('base64'));
 await fs.writeFile(path.join(a,'icon.png'),skin);assert.equal(await readInstanceIcon(root,'A'),await readInstanceIcon(root,'B'));
});
test('missing, invalid and escaping local icons fall back without reading unrelated files',async t=>{
 const root=await temporary(t),folder=path.join(root,'versions','A');await fs.mkdir(folder,{recursive:true});
 assert.equal(await readInstanceIcon(root,'A'),null);await fs.copyFile(path.resolve(__dirname,'../assets/icon.png'),path.join(root,'private.png'));
 await fs.writeFile(path.join(folder,'.starquill-settings.json'),JSON.stringify({iconFile:'../../private.png'}));assert.equal(await readInstanceIcon(root,'A'),null);
 await fs.writeFile(path.join(folder,'icon.png'),'<svg><script>invalid</script></svg>');assert.equal(await readInstanceIcon(root,'A'),null);
 await assert.rejects(readInstanceIcon(root,'../A'),/名称无效/);
});
test('installed pack metadata uses only the existing allowed resource image hosts',async t=>{
 const root=await temporary(t),folder=path.join(root,'versions','Pack');await fs.mkdir(folder,{recursive:true});let calls=0;
 const image=await fs.readFile(path.resolve(__dirname,'../assets/icon.png')),expected='data:image/png;base64,'+image.toString('base64');
 const remote=async url=>{calls++;assert.equal(url,'https://cdn.modrinth.com/icon.png');return expected;};
 await fs.writeFile(path.join(folder,'starquill-pack.json'),JSON.stringify({icon:'http://127.0.0.1/private.png'}));assert.equal(await readInstanceIcon(root,'Pack',remote),null);assert.equal(calls,0);
 await fs.writeFile(path.join(folder,'starquill-pack.json'),JSON.stringify({icon:'https://cdn.modrinth.com/icon.png'}));assert.equal(await readInstanceIcon(root,'Pack',remote),expected);assert.equal(calls,1);
 assert.deepEqual(await fs.readFile(path.join(folder,'.starquill-icon.png')),image);
 assert.equal(await readInstanceIcon(root,'Pack',()=>{throw Error('offline');}),expected);assert.equal(calls,1);
});
