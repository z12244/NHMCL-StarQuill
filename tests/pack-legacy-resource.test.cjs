const {test}=require('node:test'),assert=require('node:assert/strict');
const {Resources,compatibleCF,compatibleMR}=require('../resources.cjs');
test('locked pack files accept legacy missing loader tags but reject explicit conflicts and wrong game versions',async()=>{
 const target={game:'1.7.10',loader:'forge',pinned:true};
 assert.equal(compatibleCF({gameVersions:['1.7.10']},'mod',target),true);
 assert.equal(compatibleCF({gameVersions:['1.7.10','Fabric']},'mod',target),false);
 assert.equal(compatibleCF({gameVersions:['1.12.2']},'mod',target),false);
 assert.equal(compatibleCF({gameVersions:['1.7.10']},'mod',{...target,pinned:false}),false);
 const r=new Resources();let file={id:2,modId:1,isAvailable:true,fileName:'legacy.jar',fileLength:1,downloadUrl:'https://cdn.example.com/legacy.jar',hashes:[{algo:1,value:'a'.repeat(40)}],gameVersions:['1.7.10']};
 r.cf=async()=>file;const project={id:'1',source:'curseforge',kind:'mod'};
 assert.equal((await r.file(project,'2',target)).original,'legacy.jar');
 file={...file,isAvailable:false};await assert.rejects(r.file(project,'2',target),/不可用/);
 file={...file,isAvailable:true,modId:3};await assert.rejects(r.file(project,'2',target),/兼容/);
});
test('Cleanroom targets discover Forge ecosystem resources without accepting Fabric files',async()=>{
 const target={game:'1.12.2',loader:'cleanroom'};
 assert.equal(compatibleCF({gameVersions:['1.12.2','Forge']},'mod',target),true);
 assert.equal(compatibleCF({gameVersions:['1.12.2','Fabric']},'mod',target),false);
 assert.equal(compatibleMR({game_versions:['1.12.2'],loaders:['forge']},'mod',target),true);
 assert.equal(compatibleMR({game_versions:['1.12.2'],loaders:['fabric']},'mod',target),false);
 const r=new Resources();let route;r.mr=async value=>{route=value;return {hits:[],total_hits:0};};
 await r.search({source:'modrinth',kind:'mod',game:'1.12.2',loader:'cleanroom'});
 assert.ok(new URL('https://example.com'+route).searchParams.get('facets').includes('categories:forge'));
 r.cf=async value=>{route=value;return [];};await r.search({source:'curseforge',kind:'mod',game:'1.12.2',loader:'cleanroom'});assert.match(route,/modLoaderType=1/);
});
