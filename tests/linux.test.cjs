const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {libraryFiles} = require('../game.cjs');
const {layout,writeJSON} = require('../storage.cjs');
const {InstanceManager} = require('../instance-manager.cjs');
const {scanJava} = require('../java.cjs');

test('Linux chooses its native classifier and excludes Windows-only libraries',()=>{
  const paths = layout(os.tmpdir(),'test');
  const linux = {url:'https://example.org/test-linux.jar'};
  const meta = {libraries:[
    {name:'example:native:1', natives:{windows:'windows',linux:'linux-${arch}'},
     downloads:{classifiers:{windows:{url:'https://example.org/test.dll'},'linux-64':linux}}},
    {name:'example:winonly:1', rules:[{action:'allow',os:{name:'windows'}}]}
  ]};
  const result=libraryFiles(meta,paths,{os:'linux'});
  assert.deepEqual(result.files.map(file=>file.url),[linux.url]);
  assert.equal(result.natives.length,1);
  assert.deepEqual(result.classes,[]);
});

test('a differently cased Linux instance can depend on its sibling',{skip:process.platform!=='linux'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nhmcl-case-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeJSON(layout(root,'Pack').json,{id:'Pack'});
  await writeJSON(layout(root,'pack').json,{id:'pack',inheritsFrom:'Pack'});
  const manager=new InstanceManager(root,{});
  await assert.rejects(manager.deleteTarget('Pack'),/仍依赖/);
  assert.equal(await manager.deleteTarget('pack'),layout(root,'pack').version);
});

test('Linux discovers a Java binary exposed through a PATH symlink',{skip:process.platform!=='linux'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nhmcl-java-link-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.symlink('/usr/bin/java',path.join(dir,'java'));
  const items=await scanJava({roots:[dir]});
  assert.equal(items.length,1);
  assert.equal(items[0].path,await fs.realpath('/usr/bin/java'));
});
