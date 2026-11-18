const {matchProjects,projectInfo}=require('./addon-index.cjs');
const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function requestName(request,command){
  if(typeof request!=='string')return command.value;
  const quoted=request.match(/[《「“]([^》」”]{1,120})[》」”]/u)?.[1];
  const plain=request.normalize('NFKC').trim().replace(/^(?:(?:请|麻烦|帮我|给我|替我|能帮我)\s*)*(?:下载并安装|下载安装|下载|安装|装)(?:一下|一个|个|上)?\s*/u,'')
    .replace(/[。！!？?]+$/u,'').replace(/(?:这个|这款)?(?:整合包|模组包|模组|MOD)\s*$/iu,'').trim();
  for(const n of [quoted,plain])if(n && matchProjects(n,command.kind).some(x=>x.score===100))return n;
  return command.value;
}
function installTarget(command,targets,active) {
  if(command.kind==='modpack')return null;
  const candidates=targets.filter(t=>t.loader&&(!command.target||t.id===command.target)&&(!command.game||t.game===command.game)&&(!command.loader||t.loader===command.loader));
  const selected=candidates.find(t=>t.id===active);
  if(selected)return selected;
  if(candidates.length===1)return candidates[0];
  if(!candidates.length)throw Error('没有符合要求的本地模组版本，请先安装匹配的加载器，或指定已有实例名称');
  throw Error('多个实例均符合要求，请在指令中指定安装到哪个版本：'+candidates.slice(0,5).map(t=>t.id).join('、'));
}
function matchResource(command,items) {
  const wanted=key(command.value);
  const indexed=matchProjects(command.value,command.kind).filter(m=>m.score===100);
  const candidates=items.filter(p=>p.kind===command.kind&&['modrinth','curseforge'].includes(p.source));
  const direct=candidates.filter(p=>[p.slug,p.title,p.chineseName].some(v=>key(v)===wanted));
  const hits=direct.length?direct:candidates.filter(p=>indexed.some(({entry:e})=>projectInfo(p)?.id===e.id || (!e.cf&&!e.mr&&[e.english,e.name].some(n=>n && key(n)===key(p.title))))||
    ((p.title||'').match(/\(([A-Z][A-Z0-9]{1,7})\)/)?.[1]||'').toLowerCase()===wanted);
  if(!hits.length)throw Error('没有找到名称明确匹配的资源，请提供项目全名或平台上的项目简称');
  const identity=p=>projectInfo(p)?.id||key(p.slug||p.title);
  if(new Set(hits.map(identity)).size>1)throw Error('搜索到同名项目，请使用更具体的项目名称');
  return hits[0];
}
async function prepareInstall(command,{targets,selected,search,details,plan},signal) {
  const target=installTarget(command,targets,selected);
  const filter={kind:command.kind,game:target?.game||command.game||'',loader:target?.loader||command.loader||''};
  const result=await search({...filter,query:command.value,sort:'relevance'},signal);
  let match;
  try{match=matchResource(command,result.items);}catch(error){
    const exact=command.kind==='modpack'?matchProjects(command.value,command.kind).filter(m=>m.score===100):[];
    if(exact.length===1 && error.message.startsWith('没有找到名称明确')){
      const e=exact[0].entry;return {type:'catalog-guide',name:e.name,url:e.url,warnings:result.warnings||[]};
    }
    if(error.message.startsWith('没有找到名称明确')||error.message.startsWith('搜索到同名项目'))
      return {type:'search-choice',query:command.value,kind:command.kind,message:error.message.startsWith('搜索到同名')?'找到多个同名项目，请选择要安装的资源。':'未找到唯一匹配，可在资源工坊查看结果或调整关键词。'};
    throw error;
  }
  const found=await details(match,filter,signal);
  const version=command.version?found.versions.find(v=>[v.id,v.name,v.number].some(x=>String(x||'').toLowerCase()===command.version.toLowerCase())):
    found.versions.find(v=>v.channel==='release')||found.versions[0];
  if(!version)throw Error('未找到指定条件下的兼容文件');
  return plan({source:found.project.source,id:found.project.id,versionId:version.id,target:target?.id,chineseName:found.name?.name||match.chineseName||'',name:''},signal);
}
module.exports={requestName,prepareInstall,installTarget,matchResource};
