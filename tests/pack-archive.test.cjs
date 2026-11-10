const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const yazl=require('yazl');
const {listArchive,readArchiveFiles,extractArchiveFiles,crc32}=require('../pack-archive.cjs');
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'starquill-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function archive(file,items){const zip=new yazl.ZipFile();for(const [name,body,options] of items)zip.addBuffer(Buffer.from(body),name,options);zip.end();await new Promise((resolve,reject)=>{const output=require('node:fs').createWriteStream(file);output.on('error',reject);output.on('finish',resolve);zip.outputStream.on('error',reject);zip.outputStream.pipe(output);});}
function renameEntries(buffer,from,to){assert.equal(Buffer.byteLength(from),Buffer.byteLength(to));let at=0,count=0;while((at=buffer.indexOf(Buffer.from(from),at))>=0){Buffer.from(to).copy(buffer,at);at+=Buffer.byteLength(to);count++;}assert.ok(count>=2);return buffer;}
test('lists large unselected entries while reading bounded metadata and streaming selected files',async t=>{
 const root=await temp(t),file=path.join(root,'pack.zip'),manifest=JSON.stringify({name:'整合包'}),jar=Buffer.alloc(9*1024*1024,91);
 await archive(file,[['mmc-pack.json',manifest],['.minecraft/mods/example.jar',jar],['.minecraft/config/demo.cfg','value=true']]);
 const entries=await listArchive(file);assert.equal(entries.length,3);assert.equal(entries[1].size,jar.length);assert.equal(entries[0].crc32,crc32(Buffer.from(manifest)));
 const read=await readArchiveFiles(file,['mmc-pack.json','missing.json']);assert.equal(read.size,1);assert.equal(read.get('mmc-pack.json').toString(),manifest);
 await assert.rejects(readArchiveFiles(file,['.minecraft/mods/example.jar']),/清单过大/);
 const progress=[],dest=path.join(root,'instance'),result=await extractArchiveFiles(file,[{entry:'.minecraft/mods/example.jar',path:'mods/example.jar'},{entry:'.minecraft/config/demo.cfg',path:'config/demo.cfg'}],dest,{onProgress:p=>progress.push(p)});
 assert.deepEqual(await fs.readFile(path.join(dest,'mods/example.jar')),jar);assert.equal(await fs.readFile(path.join(dest,'config/demo.cfg'),'utf8'),'value=true');
 assert.equal(result.files,2);assert.equal(result.bytes,jar.length+10);assert.equal(progress.at(-1).filesDone,2);assert.equal(progress.at(-1).bytesDone,result.bytes);
 await assert.rejects(extractArchiveFiles(file,[{entry:'mmc-pack.json',path:'config/demo.cfg'}],dest),e=>e.code==='EEXIST');assert.equal(await fs.readFile(path.join(dest,'config/demo.cfg'),'utf8'),'value=true');
 await extractArchiveFiles(file,[{entry:'mmc-pack.json',path:'config/demo.cfg'}],dest,{overwrite:true});assert.equal(await fs.readFile(path.join(dest,'config/demo.cfg'),'utf8'),manifest);
});
test('rejects archive traversal, backslashes, reserved names, symlinks and duplicate case-insensitive files',async t=>{
 const root=await temp(t),base=path.join(root,'base.zip');await archive(base,[['abc/x.txt','one']]);const bytes=await fs.readFile(base);
 for(const [name,replacement] of [['traversal','../xx.txt'],['absolute','/abcx.txt'],['drive','C:/xx.txt'],['backslash','abc\\x.txt'],['reserved','CON/x.txt'],['ads','abc/x:txt']]){
  const file=path.join(root,name+'.zip'),original='abc/x.txt';
  await fs.writeFile(file,renameEntries(Buffer.from(bytes),original,replacement));await assert.rejects(listArchive(file),/invalid|路径|资源|relative|absolute|无效/i);
 }
 const duplicate=path.join(root,'duplicate.zip');await archive(duplicate,[['mods/a.jar','one'],['mods/A.jar','two']]);await assert.rejects(listArchive(duplicate),/重复/);
 const symlink=path.join(root,'symlink.zip');await archive(symlink,[['link.txt','target',{mode:0o120777}]]);await assert.rejects(listArchive(symlink),/链接|特殊/);
 const collision=path.join(root,'collision.zip');await archive(collision,[['path','one'],['path/file.txt','two']]);await assert.rejects(listArchive(collision),/冲突/);
});
test('CRC corruption is rejected in metadata reads and extraction before publication',async t=>{
 const root=await temp(t),file=path.join(root,'bad.zip');await archive(file,[['manifest.json','hello',{compress:false}]]);const data=await fs.readFile(file),at=data.indexOf(Buffer.from('hello'));assert.ok(at>=0);data[at]=120;await fs.writeFile(file,data);
 await assert.rejects(readArchiveFiles(file,['manifest.json']),/CRC32/);
 const target=path.join(root,'target');await assert.rejects(extractArchiveFiles(file,[{entry:'manifest.json',path:'manifest.json'}],target),/CRC32/);assert.deepEqual(await fs.readdir(target),[]);
});
test('size/count/read limits and missing selections fail without extracting unrelated files',async t=>{
 const root=await temp(t),file=path.join(root,'pack.zip');await archive(file,[['a.txt','a'.repeat(100)],['b.txt','b'.repeat(100)]]);
 await assert.rejects(listArchive(file,{maxFiles:1}),/数量/);await assert.rejects(listArchive(file,{maxTotal:150}),/解压大小/);await assert.rejects(listArchive(file,{maxFile:50}),/单个文件/);
 await assert.rejects(readArchiveFiles(file,['a.txt','b.txt'],{maxTotalRead:150}),/清单过大/);
 const target=path.join(root,'target');await assert.rejects(extractArchiveFiles(file,[{entry:'missing.txt',path:'missing.txt'}],target),/缺少/);assert.deepEqual(await fs.readdir(target),[]);
 await assert.rejects(extractArchiveFiles(file,[{entry:'a.txt',path:'../outside.txt'}],target),/路径|资源/);
});
test('cancellation stops streaming and removes only partial temporary files',async t=>{
 const root=await temp(t),file=path.join(root,'pack.zip');await archive(file,[['large.bin',Buffer.alloc(8*1024*1024,12),{compress:false}]]);const target=path.join(root,'target'),controller=new AbortController();
 await assert.rejects(extractArchiveFiles(file,[{entry:'large.bin',path:'large.bin'}],target,{signal:controller.signal,onProgress:()=>controller.abort()}),/取消|abort/i);
 assert.deepEqual(await fs.readdir(target),[]);
 await assert.rejects(listArchive(file,{signal:controller.signal}),/取消|abort/i);
});

test('cancelling a tiny compressed entry settles without waiting for yauzl legacy close',{timeout:5000},async t=>{
 const root=await temp(t),file=path.join(root,'small.zip');await archive(file,[['a.txt','tiny compressed entry'],['b.txt','another entry']]);
 const target=path.join(root,'target'),controller=new AbortController();
 await assert.rejects(extractArchiveFiles(file,[{entry:'a.txt',path:'a.txt'},{entry:'b.txt',path:'b.txt'}],target,{signal:controller.signal,onProgress:()=>controller.abort()}),/取消|abort/i);
 assert.deepEqual(await fs.readdir(target),[]);
});
