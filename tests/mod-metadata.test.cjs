const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto');
const Zip=require('adm-zip');
const {ContentInstaller}=require('../content-install.cjs');
const {readModMetadata}=require('../mod-metadata.cjs');

function jar(ownIds, dependency, legacyForge=false) {
  const z=new Zip();
  const mods=ownIds.map(id=>'[[mods]]\nmodId="'+id+'"\ndisplayName="'+id+'"\nversion="1.0"\n').join('\n');
  const deps=['minecraft','neoforge',dependency].map(id=>'[[dependencies.'+ownIds[0]+']]\nmodId="'+id+'"').join('\n');
  z.addFile(legacyForge?'META-INF/mods.toml':'META-INF/neoforge.mods.toml',Buffer.from(mods+deps));
  return z.toBuffer();
}
test('NeoForge and Forge dependencies coexist with their dependents; duplicate declared IDs still block',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-mod-ids-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const target={folder:path.join(root,'versions','test')};
  const bodies={jei:jar(['jei'],'mezz_config'),ftb:jar(['ftbultimine'],'ftblibrary'),lib:jar(['ftblibrary','helper'],'architectury',true),
    clash:jar(['helper'],'minecraft')};
  const resource=id=>({project:{id,source:'curseforge',kind:'mod',title:id},original:id+'.jar',versionId:'1',
    url:'https://example.test/'+id,hashes:{sha1:crypto.createHash('sha1').update(bodies[id]).digest('hex')},size:bodies[id].length});
  const service=new ContentInstaller({root,fetcher:async url=>new Response(bodies[new URL(url).pathname.slice(1)])});
  const install=ids=>service.install({target,files:ids.map(resource)});
  await install(['jei']);
  await install(['ftb','lib']);
  assert.deepEqual(readModMetadata(path.join(target.folder,'mods','lib.jar')).ids,['ftblibrary','helper']);
  await assert.rejects(install(['clash']),/同一模组/);
  await assert.rejects(fs.access(path.join(target.folder,'mods','clash.jar')));
});

test('two new files declaring the same mod ID are rejected before modifying the instance',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-mod-plan-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const target={folder:path.join(root,'versions','test')}, bodies={a:jar(['same'],'a_dep'),b:jar(['same'],'b_dep')};
  const files=Object.entries(bodies).map(([id,body])=>({project:{id,source:'test',kind:'mod',title:id},original:id+'.jar',versionId:'1',
    url:'https://example.test/'+id,hashes:{sha1:crypto.createHash('sha1').update(body).digest('hex')},size:body.length}));
  const service=new ContentInstaller({root,fetcher:async url=>new Response(bodies[new URL(url).pathname.slice(1)])});
  await assert.rejects(service.install({target,files}),/同一模组 ID/);
  await assert.rejects(fs.access(path.join(target.folder,'mods','a.jar')));
});
