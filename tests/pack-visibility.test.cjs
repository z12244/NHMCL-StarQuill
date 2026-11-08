const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const {layout, scan, writeJSON, markStandalone} = require('../storage.cjs');
const {Loaders} = require('../loaders.cjs');
const {Modpacks} = require('../modpacks.cjs');
const {ContentInstaller} = require('../content-install.cjs');

for (const existing of [true, false]) {
  test(existing ? 'a modpack keeps an existing standalone game visible' :
    'a modpack folds its new base until the user explicitly installs the vanilla game', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starquill-pack-list-'));
    t.after(() => fs.rm(root, {recursive:true,force:true}));
    const version='1.21.1', packName='Visible pack', jar=Buffer.from('game');
    const meta={id:version,type:'release',mainClass:'example.Main',javaVersion:{majorVersion:21},
      downloads:{client:{url:'https://example.test/client.jar',size:jar.length,sha1:crypto.createHash('sha1').update(jar).digest('hex')}}};
    if(existing){
      const base=layout(root,version);
      await writeJSON(base.json,meta);
      await fs.writeFile(base.jar,jar);
    }
    const fetcher=async url=>url.endsWith('/metadata.json') ? Response.json(meta) : new Response(jar);
    const loaders=new Loaders({root,mode:'official',fetcher,chooseJava:async()=>({major:21}),
      getManifest:async()=>({versions:[{id:version,url:'https://example.test/metadata.json'}]})});
    const service=new Modpacks({installer:new ContentInstaller({root,fetcher}),loaders});
    const file=path.join(root,'pack.mrpack'), archive=new Zip();
    archive.addFile('modrinth.index.json',Buffer.from(JSON.stringify({game:'minecraft',formatVersion:1,
      name:packName,dependencies:{minecraft:version},files:[]})));
    archive.writeZip(file);
    await service.install(await service.plan(file,''));
    const ids=async()=>(await scan(root)).map(v=>v.id).sort();
    assert.deepEqual(await ids(),existing?[version,packName]:[packName]);
    assert.deepEqual(JSON.parse(await fs.readFile(layout(root,version).json)),meta);
    await markStandalone(root,version);
    assert.deepEqual(await ids(),[version,packName]);
  });
}
