const test=require('node:test'),assert=require('node:assert/strict'),{discover}=require('../src/shared/pack-discovery.cjs');
const feed='<rss><item><link>https://modrinth.com/modpack/example</link></item></rss>';
function mock(title){return async url=>new Response(url.includes('bing.com')?feed:url.includes('bbsmc')?'{"hits":[]}':url.endsWith('/version')?JSON.stringify([{id:'v1',version_type:'release',files:[{filename:'Pack.mrpack',url:'https://cdn.modrinth.com/a',hashes:{sha512:'1'.repeat(128)}}]}]):JSON.stringify({project_type:'modpack',title,slug:'example'}));}
test('web discovery can resolve a previously unindexed Chinese title through a web result and release API',async()=>{const r=await discover({value:'未编目的测试包'},mock('未编目的测试包'));assert.equal(r.file.original,'Pack.mrpack')});
test('unrelated web search result cannot trigger an install',async()=>{const r=await discover({value:'未编目的测试包'},mock('另一个包'));assert.ok(!r.file)});
test('cancelled search propagates cancellation',async()=>{const s=AbortSignal.abort();await assert.rejects(discover({value:'abc'},()=>Promise.reject(Error()),s))});
test('a temporary author API outage recovers the single latest GitHub release and preserves explicitly pinned versions',async()=>{
 const repo='https://github.com/TestStudio/Example',link=Buffer.from(repo).toString('base64');
 const release=version=>({tag_name:'v'+version,draft:false,prerelease:false,assets:[{name:'Client.zip',size:42,
   digest:'sha256:'+'1'.repeat(64),browser_download_url:repo+'/releases/download/v'+version+'/Client.zip'}]});
 let latest=0,list=0;
 const read=async(url,init)=>{
   if(url.includes('mcmod.cn/'))return new Response('<a href="https://link.mcmod.cn/target/'+link+'">project</a>');
   if(url.endsWith('/releases/latest')){
     latest++;assert.match(init.headers['User-Agent'],/NHMCL/);
     if(latest===1)throw Error('net::ERR_CONNECTION_RESET');
     return Response.json(release('2'));
   }
   if(url.includes('releases?per_page=')){list++;return Response.json([release('2'),release('1')]);}
   return url.includes('bbsmc')?Response.json({hits:[]}):new Response('<rss/>');
 };
 assert.match((await discover({value:'贪婪2'},read)).file.url,/download\/v2\//);
 assert.equal(latest,2);assert.equal(list,0);
 assert.match((await discover({value:'贪婪2',version:'1'},read)).file.url,/download\/v1\//);
 assert.equal(latest,2);assert.equal(list,1);
});
