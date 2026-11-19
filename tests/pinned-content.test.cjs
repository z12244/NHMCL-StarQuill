const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Zip=require('adm-zip');
const {Modpacks}=require('../src/shared/modpacks.cjs'),{cacheFile}=require('../src/shared/content-install.cjs');
const data=Buffer.from('the exact pinned bytes'),id='82',fileId='715',project={source:'curseforge',id,title:'Example',kind:'mod'};
async function make(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sq-pinned-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const instance=path.join(root,'versions','Old'),dir=path.join(instance,'mods');await fs.mkdir(dir,{recursive:true});
 const row={source:'curseforge',projectId:id,versionId:fileId,original:'example.jar',path:'mods/旧名字 - example.jar',size:data.length,hashes:{sha1:crypto.createHash('sha1').update(data).digest('hex')}};
 const record=()=>fs.writeFile(path.join(instance,'.starquill-content.json'),JSON.stringify({schema:1,files:[row]}));
 const local=path.join(instance,row.path);await fs.writeFile(local,data);await record();
 const archive=path.join(root,'pack.zip'),z=new Zip();z.addFile('manifest.json',Buffer.from(JSON.stringify({name:'Pack',manifestType:'minecraftModpack',manifestVersion:1,minecraft:{version:'1.7.10',modLoaders:[{id:'forge-10.13.4.1614'}]},files:[{projectID:Number(id),fileID:Number(fileId),required:true}],overrides:'overrides'})));z.writeZip(archive);
 const resources={project:async()=>project,file:async()=>{throw Error('HTTP 404');}};
 const plan=()=>new Modpacks({installer:{root},resources}).plan(archive,'New');
 return {root,resources,row,record,local,plan};
}
test('missing pinned metadata: exact previously installed bytes can be reused even with a localized filename',async t=>{
 const f=await make(t),item=(await f.plan()).files[0];assert.equal(item.cached,true);assert.equal(item.url,null);assert.equal(item.versionId,fileId);assert.equal(item.path,'mods/example.jar');
 assert.deepEqual(await fs.readFile(cacheFile(f.root,item)),data);
 await fs.unlink(f.local);f.resources.project=async()=>{throw Error('HTTP 403');};assert.equal((await f.plan()).files[0].project.id,id);
});
test('missing pinned metadata: same-size corrupt bytes are not accepted; failure identifies both IDs',async t=>{
 const f=await make(t);await fs.writeFile(f.local,Buffer.alloc(data.length));await assert.rejects(f.plan(),/Example（项目 82，文件 715）.*HTTP 404.*完整客户端包/);
});
test('a different revision or an unsafe receipt cannot satisfy a pin',async t=>{
 const f=await make(t);f.row.versionId='716';await f.record();await assert.rejects(f.plan(),/没有找到可校验/);
 f.row.versionId=fileId;f.row.path='../outside.jar';await f.record();await assert.rejects(f.plan(),/没有找到可校验/);
});
test('provider compatibility rejection and cancelled requests never use local receipts',async t=>{
 const f=await make(t);f.resources.file=async()=>{throw Error('所选文件与游戏版本不兼容');};await assert.rejects(f.plan(),/不兼容/);
 f.resources.file=async()=>{throw new DOMException('cancelled','AbortError');};await assert.rejects(f.plan(),{name:'AbortError'});
});
