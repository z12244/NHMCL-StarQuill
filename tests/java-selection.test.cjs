const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {resolveJavaSelection,validateJavaSelection}=require('../java-selection.cjs');
const {instanceOptions}=require('../instance-config.cjs'),{InstanceManager}=require('../instance-manager.cjs'),{layout,writeJSON}=require('../storage.cjs');
const runtime=(major,name='',extra={})=>({major,version:String(major)+'.0.1',bits:64,arch:'amd64',path:path.resolve('Java',name||'jdk-'+major,'bin/java.exe'),...extra});
const settings={javaMode:'auto',java:'',javaMajor:21,memory:2},requirement={min:17,max:26,preferred:21,majors:[17,21,25,26]};
async function root(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-java-selection-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return folder;}

test('automatic strategy keeps matching the game requirement instead of forcing the remembered Java path',async()=>{
 const items=[runtime(8),runtime(17),runtime(21,'bundled',{bundled:true}),runtime(25)];
 assert.equal((await resolveJavaSelection({settings:{...settings,java:items[0].path},required:requirement,items})).major,21);
 assert.equal((await resolveJavaSelection({settings,required:17,items})).major,17);
});
test('major strategy selects that installed major and refuses to cross game compatibility constraints',async()=>{
 const items=[runtime(17),runtime(21,'bundled',{bundled:true}),runtime(25),runtime(25,'newer',{version:'25.0.2'})];
 const selected=await resolveJavaSelection({settings:{...settings,javaMode:'major',javaMajor:25},required:requirement,items});assert.equal(selected.version,'25.0.2');
 await assert.rejects(resolveJavaSelection({settings:{...settings,javaMode:'major',javaMajor:17},required:21,items}),/需要 Java 21.*指定自动选择 Java 17/);
 await assert.rejects(resolveJavaSelection({settings:{...settings,javaMode:'major',javaMajor:26},required:requirement,items}),/未找到.*Java 26/);
 assert.throws(()=>validateJavaSelection({...settings,javaMode:'major',javaMajor:0}),/主版本/);
});
test('manual strategy inspects the selected executable and still rejects incompatible or 32-bit Java',async()=>{
 const selected=runtime(25),manual={...settings,javaMode:'manual',java:selected.path};let inspected;
 assert.equal(await resolveJavaSelection({settings:manual,required:requirement,inspect:async file=>{inspected=file;return selected;}}),selected);assert.equal(inspected,selected.path);
 await assert.rejects(resolveJavaSelection({settings:manual,required:17,inspect:async()=>selected}),/需要 Java 17/);
 await assert.rejects(resolveJavaSelection({settings:manual,required:requirement,inspect:async()=>({...selected,bits:32})}),/64 位 Java/);
});
test('version-folder strategy scans only the target instance and never falls back to an external installed runtime',async t=>{
 const folder=await root(t),id='中文 整合包',inside=path.join(layout(folder,id).version,'runtime/jdk-25/bin/java.exe');let roots;
 const selected=await resolveJavaSelection({root:folder,id,settings:{...settings,javaMode:'folder'},required:requirement,items:[runtime(21)],scan:async options=>{roots=options.roots;return [runtime(21),runtime(25,'local',{path:inside})];}});
 assert.equal(selected.path,inside);assert.deepEqual(roots,[layout(folder,id).version]);
 await assert.rejects(resolveJavaSelection({root:folder,id,settings:{...settings,javaMode:'folder'},required:requirement,items:[runtime(21)],scan:async()=>[runtime(21)]}),/版本文件夹内未找到/);
 await assert.rejects(resolveJavaSelection({root:folder,settings:{...settings,javaMode:'folder'},required:requirement}),/先选择目标版本/);
});
test('instance Java strategy defaults to global inheritance and saves a compatible independent major preference',async t=>{
 const folder=await root(t),id='1.21.1',global={...settings,javaMode:'major',javaMajor:25,isolate:true};await writeJSON(layout(folder,id).json,{id,mainClass:'example.Main',starQuill:{java:requirement}});
 let options=await instanceOptions(folder,id,global);assert.equal(options.javaMode,'major');assert.equal(options.javaMajor,25);
 const manager=new InstanceManager(folder,global);const input={displayName:'Test',advanced:{},memory:null,javaMode:'major',javaMajor:17,java:'',isolate:'inherit'};
 const saved=await manager.save(id,input);assert.equal(saved.config.javaMajor,17);assert.equal(saved.effective.javaMode,'major');assert.equal(saved.effective.javaMajor,17);
 const inherited=await manager.save(id,{...input,javaMode:'inherit'});assert.equal(inherited.effective.javaMode,'major');assert.equal(inherited.effective.javaMajor,25);
 const legacy=await manager.save(id,{...input,javaMode:'auto',javaMajor:undefined});assert.equal(legacy.effective.javaMode,'auto');
 await assert.rejects(manager.save(id,{...input,javaMode:'major',javaMajor:7}),/主版本/);
});
test('offline imported Java remains selected in automatic mode while an explicit folder strategy takes precedence',async t=>{
 const folder=await root(t),id='Portable',portableJava='runtime/starquill-pack-123456789abc/bin/java.exe';
 await writeJSON(path.join(layout(folder,id).version,'.starquill-settings.json'),{javaMode:'auto',portableJava});
 const original=await instanceOptions(folder,id,settings);assert.equal(original.javaMode,'manual');assert.equal(original.java,path.join(folder,...portableJava.split('/')));
 await writeJSON(path.join(layout(folder,id).version,'.starquill-settings.json'),{javaMode:'folder',portableJava});const explicit=await instanceOptions(folder,id,settings);assert.equal(explicit.javaMode,'folder');
});
