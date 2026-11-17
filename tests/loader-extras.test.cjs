const {test}=require('node:test');
const assert=require('node:assert/strict');
const {optifineRows,cleanroomRows,checkCombination}=require('../loader-extras.cjs');
test('Cleanroom offers a hash-pinned release on catalog failure only for 1.12.2',async()=>{
  const lookup=require('../loader-extras.cjs').listCleanroom;
  const failure=async()=>new Response(null,{status:403});
  assert.deepEqual(await lookup(failure,'1.21.1'),[]);
  const [row]=await lookup(failure,'1.12.2');
  assert.equal(row.bundledEntry,true);assert.equal(row.stable,false);assert.match(row.hashes.sha256,/^[0-9a-f]{64}$/);
  await assert.rejects(lookup(failure,'1.12.2',AbortSignal.abort()));
});

test('OptiFine versions are scoped to Minecraft and retain release status and Forge compatibility',()=>{
  const names=['OptiFine_1.21.1_HD_U_J1.jar','preview_OptiFine_1.21.1_HD_U_J1_pre15.jar','OptiFine_1.21.10_HD_U_J6.jar'];
  const html='<table>'+names.map((name,i)=>'<tr class="downloadLine"><td class="colMirror"><a href="adloadx?f='+name+'">Mirror</a></td><td class="colForge">Forge '+(i?'N/A':'52.0.16')+'</td></tr>').join('')+'</table>';
  const rows=optifineRows(html,'1.21.1');
  assert.deepEqual(rows.map(r=>[r.version,r.stable]),[['HD_U_J1',true],['HD_U_J1_pre15',false]]);
  assert.doesNotThrow(()=>checkCombination({game:'1.21.1',loader:'forge'},rows[0]));
  assert.doesNotThrow(()=>checkCombination({game:'1.21.1'},rows[1]));
  assert.throws(()=>checkCombination({game:'1.21.1',loader:'forge'},rows[1]),/组合/);
  for(const loader of ['fabric','neoforge','cleanroom'])assert.throws(()=>checkCombination({game:'1.21.1',loader},rows[0]),/组合/);
  assert.throws(()=>checkCombination({game:'1.21'},rows[0]),/不匹配/);
});
test('Cleanroom catalog uses official client archives for 1.12.2 and preserves alpha labels',()=>{
  const tag='0.7.14-alpha',name='cleanroom-'+tag+'.zip';
  const asset={name,browser_download_url:'https://github.com/CleanroomMC/Cleanroom/releases/download/'+tag+'/'+name,size:123,digest:'sha256:'+'a'.repeat(64)};
  const release={tag_name:tag,prerelease:false,assets:[asset]};
  const rows=cleanroomRows([release,{...release,draft:true},{...release,assets:[{...asset,name:'server.zip'}]}]);
  assert.equal(rows.length,1);assert.equal(rows[0].game,'1.12.2');assert.equal(rows[0].stable,false);assert.equal(rows[0].hashes.sha256,'a'.repeat(64));
});
