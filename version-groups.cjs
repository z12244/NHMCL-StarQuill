(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.versionGroups=factory();})(typeof window==='object'?window:globalThis,function(){
  function family(version){const id=version.id;const year=/^(\d{2})\.\d+(?:\.\d+)*(?:-(?:snapshot|pre|rc)-?\d+)?$/i.exec(id);if(year&&Number(year[1])>=26)return String(2000+Number(year[1]));const match=/^(\d+\.\d+)(?:\.\d+)?(?:-(?:pre|rc)\d+| (?:Pre-Release|Release Candidate) \d+)?$/i.exec(id);if(match)return match[1];if(version.local)return 'custom';if(version.type==='snapshot')return 'snapshots';return 'historical';}
  function groupVersions(remote,installed,showExtra=false,selected){
    const map=new Map(remote.map(v=>[v.id,{...v,local:false}]));for(const v of installed.filter(v=>v.ready))map.set(v.id,{...map.get(v.id),...v,type:map.get(v.id)?.type||v.type||'custom',local:true});
    const groups=new Map();for(const v of map.values()){if(!v.local&&!showExtra&&v.type!=='release'&&v.id!==selected)continue;const key=family(v);if(!groups.has(key))groups.set(key,{id:key,label:key==='custom'?'本地自定义版本':key==='snapshots'?'开发快照':key==='historical'?'远古版本':key+' 系列',versions:[]});groups.get(key).versions.push(v);}
    const rank=id=>id==='custom'?3:id==='snapshots'?2:id==='historical'?1:4;
    return [...groups.values()].sort((a,b)=>rank(b.id)-rank(a.id)||b.id.localeCompare(a.id,undefined,{numeric:true})).map(g=>({...g,versions:g.versions.sort((a,b)=>Number(b.local)-Number(a.local)||(g.id==='snapshots'||g.id==='historical'?String(b.releaseTime||'').localeCompare(String(a.releaseTime||'')):Number(b.type==='release')-Number(a.type==='release'))||b.id.localeCompare(a.id,undefined,{numeric:true}))}));
  }
  return {family,groupVersions};
});
