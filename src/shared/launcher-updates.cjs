const repository='https://api.github.com/repos/z12244/NHMCL-StarQuill/releases';
function versionParts(tag){
  const match=/^(?:(alpha|beta|rc|stable)-?)?v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:[.-](\d+))?)?$/i.exec(tag);
  if(!match||match[1]&&match[5])return null;
  const stage=(match[1]||match[5]||'stable').toLowerCase();
  return [...match.slice(2,5).map(Number),['alpha','beta','rc','stable'].indexOf(stage),Number(match[6]||0)];
}
function newer(a,b){
  const index=a.findIndex((value,i)=>value!==b[i]);
  return index>=0&&a[index]>b[index];
}
async function checkRelease(fetcher,current){
  try{
    const reply=await fetcher(repository+'?per_page=100',{signal:AbortSignal.timeout(8000),cache:'no-store',credentials:'omit',headers:{Accept:'application/vnd.github+json'}});
    if(!reply.ok)return null;
    let best=versionParts(current),result=null;
    for(const release of await reply.json()){
      const parts=versionParts(release.tag_name);
      if(release.draft||!parts||!newer(parts,best))continue;
      best=parts;
      result={tag:release.tag_name,notes:typeof release.body==='string'?release.body.trim():''};
    }
    return result;
  }catch{return null;}
}
module.exports={checkRelease};
