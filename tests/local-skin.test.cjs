const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {importSkin,readSkin,startSkinServer}=require('../skins.cjs');
const {offlineUUID}=require('../game.cjs');
async function temp(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-local-skin-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return folder;}
test('local PNG is copied into portable cache, retains selected model and survives removal of original',async t=>{
 const root=await temp(t),file=path.join(root,'自定义皮肤.png'),png=await fs.readFile(path.join(__dirname,'../assets/alex.png'));
 await fs.writeFile(file,png);const skin=await importSkin(root,file,'slim');
 assert.equal(skin.source,'local');assert.equal(skin.model,'slim');assert.equal(skin.sourceName,'自定义皮肤');assert.equal(skin.sourceUUID,undefined);
 await fs.unlink(file);assert.deepEqual(await readSkin(root,skin),png);
});
test('bad size, invalid PNG, unsupported model and decode failures do not create accepted skin records',async t=>{
 const root=await temp(t),file=path.join(root,'bad.png');await fs.writeFile(file,'not a PNG');
 await assert.rejects(importSkin(root,file),/PNG/);await assert.rejects(importSkin(root,file,'other'),/手臂/);
 await fs.writeFile(file,Buffer.alloc(2*1024*1024+1));await assert.rejects(importSkin(root,file),/2 MB/);
 await fs.copyFile(path.join(__dirname,'../assets/steve.png'),file);
 await assert.rejects(importSkin(root,file,'default',()=>{throw Error('decode failed');}),/decode failed/);
 const source=await fs.readFile(file),legacy=Buffer.from(source);legacy.writeUInt32BE(32,20);await fs.writeFile(file,legacy);
 await assert.rejects(importSkin(root,file,'slim'),/64×64/);
});
test('imported skin is served to game with unchanged offline identity',async t=>{
 const root=await temp(t),file=path.join(root,'Steve.png');await fs.copyFile(path.join(__dirname,'../assets/steve.png'),file);
 const skin=await importSkin(root,file),uuid=offlineUUID('LocalSkinQA');
 const server=await startSkinServer(root,{name:'LocalSkinQA',type:'offline',uuid,skin},path.join(__dirname,'../tools/authlib-injector-1.2.8.jar'));
 t.after(()=>server.close());const profile=await (await fetch(server.base+'sessionserver/session/minecraft/profile/'+uuid)).json();
 assert.equal(profile.id,uuid);assert.equal(profile.name,'LocalSkinQA');
 const texture=JSON.parse(Buffer.from(profile.properties[0].value,'base64')).textures.SKIN;
 assert.deepEqual(Buffer.from(await (await fetch(texture.url)).arrayBuffer()),await fs.readFile(file));
});
