(()=>{const $=id=>document.getElementById(id),api=window.starquill;let targets=[],details=null,currentPlan=null,offset=0,hasMore=false,querySerial=0,detailSerial=0,loaderTicket=null,locked=false,working=0,opened=false,searchPending=false,browsed=false;
 let listScroll=0,manualGame='',catalogDirty=false;
 const browse=$('market-browse');
 const selectedKind=()=>$('market-kind').value;
 const selectedTarget=()=>targets.find(t=>t.id===$('market-target').value);
 function filters(){
   const kind=selectedKind(),target=kind==='modpack'?null:selectedTarget();
   const loader=$('market-loader').value;
   return {kind,game:target?.game||manualGame,loader:['mod','modpack'].includes(kind)?(loader==='auto'?target?.loader||'':loader==='all'?'':loader):'',sort:$('market-sort').value};
 }
 function loadIcon(node,item){node.classList.add('resource-art');if(!item.icon)return;api.resourceIcon(item.icon).then(src=>{if(!src||!node.isConnected)return;const img=document.createElement('img');img.alt=item.title+' 图标';img.width=64;img.height=64;img.src=src;node.replaceChildren(img);}).catch(()=>{});}
 const message=t=>$('market-message').textContent=t;
 function button(text,fn,className='secondary'){const b=document.createElement('button');b.textContent=text;b.className=className;b.onclick=()=>run(fn);return b;}
 async function run(fn){working++;lock();try{return await fn();}catch(e){toast(e.message);log(e.message);message(e.message);}finally{working--;lock();}}
 function bind(id,fn){$(id).onclick=()=>run(fn);}
 function lock(){const disabled=locked||working>0;$('loader-name').readOnly=$('loader-type').value==='none'&&!$('install-optifine').checked;for(const b of document.querySelectorAll('#page-market button,#page-market select,#page-market input'))b.disabled=disabled;$('market-target').disabled=disabled||selectedKind()==='modpack';
 $('market-game').disabled=disabled||(selectedKind()!=='modpack'&&!!selectedTarget());
 $('market-loader').disabled=disabled||!['mod','modpack'].includes(selectedKind());
 $('market-cancel').disabled=false;$('market-prev').disabled=disabled||searchPending||offset===0;$('market-next').disabled=disabled||searchPending||!hasMore;$('loader-install').disabled=disabled||!$('loader-game').value||($('loader-type').value!=='none'&&(!loaderTicket||!$('loader-version').value));$('loader-version').disabled=disabled||!loaderTicket;
 const baseType=$('loader-type').value,allowOptifine=baseType==='none'||baseType==='forge';
 $('install-optifine').disabled=disabled||!allowOptifine||!$('loader-game').value;
 $('optifine-version').disabled=disabled||!optifineTicket;
 if($('install-optifine').checked && (!optifineTicket||!$('optifine-version').value))$('loader-install').disabled=true;
 $('market-plan').disabled=disabled||!details?.versions?.length||details.canInstall===false;$('market-install').disabled=disabled||!currentPlan;
 if(catalogDirty&&!disabled){catalogDirty=false;targetSummary();gameOptions();loaderReset();}
 }
 async function loadTargets(){const b=await api.marketBoot();targets=b.targets;const selected=$('market-target').options.length?$('market-target').value:settings.selected;$('market-target').replaceChildren(new Option('仅浏览 · 全部版本',''));for(const t of targets)$('market-target').add(new Option(t.id+' · '+(t.loader||'原版'),t.id));if(targets.some(t=>t.id===selected))$('market-target').value=selected;targetSummary();}
 function targetSummary(){
   const t=selectedTarget(),lockedToTarget=selectedKind()!=='modpack'&&!!t;
   const releases=remote.filter(v=>v.type==='release').map(v=>v.id);
   const games=new Set([...(releases.length?releases:['1.21.1','1.16.5','1.12.2','1.7.10']),...targets.map(t=>t.game)].filter(Boolean));
   const picker=$('market-game'),custom=$('market-custom-game');
   const typing=!lockedToTarget&&picker.value===':custom';
   if(manualGame&&!typing)games.add(manualGame);
   picker.replaceChildren(new Option('全部版本',''),...Array.from(games,id=>new Option(id,id)),new Option('手动输入版本…',':custom'));
   picker.value=lockedToTarget?t.game:typing?':custom':manualGame;
   custom.classList.toggle('hidden',picker.value!==':custom');
   custom.value=manualGame;
   $('market-target-info').textContent=$('market-kind').value==='modpack'?'整合包将使用作者指定的游戏与加载器，创建新版本。':t?`Minecraft ${t.game} · ${t.loader||'原版（安装模组前请先安装加载器）'} · ${t.folder}`:'可浏览全部资源。安装模组时请选择带加载器的本地版本。';}
 function gameOptions(){const choice=$('loader-game').value||'1.21.1',groupChoice=$('loader-family').value;let games=remote.filter(v=>$('install-snapshots').checked||v.type==='release');if(!games.length)games=[...new Set(['1.21.1',...targets.map(t=>t.game)])].map(id=>({id,type:'release'}));const groups=window.versionGroups.groupVersions(games,[],$('install-snapshots').checked);$('loader-family').replaceChildren();for(const g of groups)$('loader-family').add(new Option(g.label,g.id));$('loader-family').value=groups.some(g=>g.id===groupChoice)?groupChoice:(groups.find(g=>g.versions.some(v=>v.id===choice))||groups[0])?.id;const versions=groups.find(g=>g.id===$('loader-family').value)?.versions||[];$('loader-game').replaceChildren();for(const v of versions)$('loader-game').add(new Option(v.id,v.id));if(versions.some(v=>v.id===choice))$('loader-game').value=choice;}
 function clearDetail(){browse.classList.remove('detail-open');detailSerial++;details=null;$('market-detail').classList.add('hidden');$('market-detail-empty').classList.remove('hidden');}
 function invalidate(){clearDetail();currentPlan=null;$('market-plan-panel').classList.add('hidden');}
 function allowCopy(element,kind){element.classList.toggle('resource-copy',kind==='mod'||kind==='modpack');}
 function cardFor(item){
   const card=document.createElement('article');card.className='resource-card';
   const icon=document.createElement('span');icon.className='resource-symbol';
   icon.textContent=({mod:'◇',resourcepack:'▧',shader:'☼',modpack:'▣'})[item.kind];
   const title=document.createElement('h3');title.textContent=[...new Set([item.chineseName,item.title].filter(Boolean))].join(' · ');
   const desc=document.createElement('p');desc.textContent=item.description;
   const label=document.createElement('small');
   label.textContent=[item.source==='modrinth'?'Modrinth':'CurseForge',item.downloads?item.downloads.toLocaleString()+' 次下载':'',item.updated?.slice(0,10)].filter(Boolean).join(' · ');
   allowCopy(title,item.kind);allowCopy(desc,item.kind);
   loadIcon(icon,item);
   card.append(icon,label,title,desc,button(item.kind==='modpack'?'选择整合包版本':'查看兼容版本与前置',()=>select(item)));
   return card;
 }
 async function search(nextOffset=0,refresh=false){
   const serial=++querySerial;
   browsed=true;searchPending=true;invalidate();hasMore=false;
   $('market-results').replaceChildren();message('正在搜索资源…');lock();
   try{
     const result=await api.marketSearch({...filters(),query:$('market-query').value.trim(),offset:nextOffset,refresh});
     if(serial!==querySerial)return;
     offset=nextOffset;hasMore=result.hasMore;
     $('market-page').textContent=String(offset/20+1);
     $('market-results').replaceChildren(...result.items.map(cardFor));
     message([result.items.length?'本页 '+result.items.length+' 项':'没有匹配结果，可更换关键词或筛选条件。',...result.warnings||[]].join(' · '));
   }catch(error){
     if(serial===querySerial)message(error.message+'，可点击搜索重试。');
   }finally{
     if(serial===querySerial){searchPending=false;lock();}
   }
 }
 async function select(item){resetPlan();listScroll=document.querySelector('main .content').scrollTop;browse.classList.add('detail-open');$('market-back').disabled=false;const serial=++detailSerial;details=null;$('market-detail-empty').classList.add('hidden');$('market-detail').classList.remove('hidden');allowCopy($('market-detail-title'),item.kind);$('market-detail-title').textContent=item.title;$('market-detail-source').textContent=item.source.toUpperCase();$('market-detail-description').textContent='正在读取详情…';$('market-wiki-links').replaceChildren();$('market-version-fields').classList.add('hidden');$('market-project-web').onclick=()=>run(()=>api.marketOpen(item.url));if(item.source==='mcmod'){const wiki=await api.marketWiki(item.id);if(serial!==detailSerial)return;$('market-detail-title').textContent=wiki.name;const name=document.createElement('span');name.textContent=wiki.english;allowCopy(name,item.kind);$('market-detail-description').replaceChildren(name,' · 名称来源：MC百科。选择关联平台获取兼容文件。');for(const site of wiki.sites)$('market-wiki-links').append(button('在 '+(site.source==='modrinth'?'Modrinth':'CurseForge')+' 中安装',()=>readDetails({...site,title:wiki.english},wiki.name)));if(!wiki.sites.length)$('market-detail-description').append(' 此条目暂无可识别的关联下载平台。');return;}try{await readDetails(item);}catch(error){if(browse.classList.contains('detail-open'))$('market-detail-description').textContent='无法读取项目文件：'+error.message;throw error;}}
 async function readDetails(item,chineseName){const serial=++detailSerial;const d=await api.marketDetails({...item,...filters(),target:selectedKind()==='modpack'?'':$('market-target').value,loader:$('market-loader').value});if(serial!==detailSerial)return;details=d;const artwork=$('market-detail-art');artwork.replaceChildren();const art=document.createElement('span');art.textContent='▧';artwork.append(art);loadIcon(art,d.project);const target=targets.find(t=>t.id===$('market-target').value);d.canInstall=d.project.kind==='modpack'||!!target&&(d.project.kind!=='mod'||!!target.loader&&(!d.target.loader||(target.loader==='cleanroom'?'forge':target.loader)===(d.target.loader==='cleanroom'?'forge':d.target.loader)));$('market-version-fields').classList.remove('hidden');$('market-detail-title').textContent=d.name?.name||d.project.title;$('market-detail-source').textContent='自动选择 · '+d.project.source.toUpperCase();const summary=document.createElement('span');summary.textContent=d.project.description;allowCopy(summary,d.project.kind);allowCopy($('market-detail-title'),d.project.kind);$('market-detail-description').replaceChildren(summary,'\n\n'+d.selection+(d.canInstall?'':'\n请选择已安装匹配加载器的目标版本，再生成安装清单。'));$('market-project-web').onclick=()=>run(()=>api.marketOpen(d.project.url));$('market-wiki-links').replaceChildren();if(d.name?.url)$('market-wiki-links').append(button('MC百科资料 ↗',()=>api.marketOpen(d.name.url),'text-button'));$('market-file-version').replaceChildren();for(const [index,v] of d.versions.entries()){
    const channel=({release:'正式版',beta:'测试版',alpha:'预览版'})[v.channel];
    const recommended=index===0&&v.channel==='release'&&d.target.game?'推荐':'';
    $('market-file-version').add(new Option([recommended,v.name,channel,v.date?.slice(0,10)].filter(Boolean).join(' · '),v.id));
  }$('market-detail').scrollIntoView({behavior:'smooth',block:'nearest'});if(!d.versions.length)$('market-file-version').add(new Option('没有与目标匹配的文件',''));$('market-chinese').value=chineseName||d.name?.name||'';$('market-name-source').textContent=d.name?'中文名来源：MC百科；可按自己的习惯修改。':'未找到已核对的中文名，可自行填写；留空使用原文件名。';fileMetadata();const pack=d.project.kind==='modpack';$('market-chinese-field').classList.toggle('hidden',pack);$('market-pack-name-field').classList.toggle('hidden',!pack);$('market-pack-name').value=d.project.title.replace(/[<>:"/\\|?*]/g,'').slice(0,80);lock();}
 function showPlan(plan){currentPlan=plan;if(!plan)return;$('market-plan-panel').classList.remove('hidden');$('market-plan-title').textContent=plan.name+' · 安装清单';const total=plan.files.reduce((s,f)=>s+(f.size||0),0);$('market-plan-summary').textContent=`${plan.type==='pack'?`包内 ${plan.bundledFiles||0} 个文件 · 另需下载 ${plan.files.length} 项`:plan.files.length+' 个文件'} · 待下载约 ${(total/1024**2).toFixed(1)} MB · ${plan.type==='pack'?'新版本 '+plan.id:plan.target.id}`;$('market-plan-files').replaceChildren();for(const f of plan.files){const row=document.createElement('div');row.className='install-file';const info=document.createElement('div'),name=document.createElement('b'),desc=document.createElement('small');name.textContent=f.title;desc.textContent=f.reason+' · '+f.filename;info.append(name,desc);row.append(info);if(f.manual){const actions=document.createElement('div');actions.className='row-actions';if(f.manualUrl)actions.append(button('官方页面 ↗',()=>api.marketOpen(f.manualUrl),'text-button'));actions.append(button('导入已下载文件…',async()=>{if(await api.marketManual({token:plan.token,index:f.index})){name.textContent=f.title+' · 已校验';toast('文件校验通过，可继续安装');}}));row.append(actions);}$('market-plan-files').append(row);}$('market-plan-warnings').replaceChildren();for(const text of plan.warnings){const p=document.createElement('p');p.textContent=text;$('market-plan-warnings').append(p);}$('market-install').textContent=plan.type==='pack'?'确认安装整合包':'确认并安装 '+plan.files.length+' 个文件';$('market-plan-panel').scrollIntoView({behavior:'smooth',block:'start'});}
 function fileMetadata(){
   const version=details?.versions.find(v=>v.id===$('market-file-version').value);
   $('market-file-meta').textContent=version?[...(version.gameVersions||[]),...(version.loaders||[])].join(' · '):'';
 }
 function resetPlan(){currentPlan=null;$('market-plan-panel').classList.add('hidden');lock();}
 function backToResults(){
   if(!browse.classList.contains('detail-open'))return false;
   invalidate();lock();document.querySelector('main .content').scrollTop=listScroll;return true;
 }
 $('market-back').onclick=backToResults;
 $('market-file-version').onchange=()=>{fileMetadata();resetPlan();};
 for(const id of ['market-chinese','market-pack-name'])$(id).oninput=resetPlan;
 $('market-search').onclick=()=>search(0,true);
 $('market-query').onkeydown=e=>{if(e.key==='Enter'&&!$('market-search').disabled)$('market-search').click();};
 $('market-prev').onclick=()=>search(Math.max(0,offset-20));
 $('market-next').onclick=()=>search(offset+20);
 $('market-custom-game').onchange=()=>{manualGame=$('market-custom-game').value.trim();search();};
 for(const id of ['market-loader','market-kind','market-target','market-sort','market-game'])$(id).onchange=()=>{if(id==='market-game'&&$(id).value!==':custom')manualGame=$(id).value;targetSummary();search();};
 bind('market-plan',async()=>{if(!details||details.canInstall===false)return;const plan=await api.marketPlan({source:details.project.source,id:details.project.id,versionId:$('market-file-version').value,target:$('market-target').value,chineseName:$('market-chinese').value,name:$('market-pack-name').value.trim()});
 if(plan.type==='manual-pack'){
   $('market-detail-description').textContent='作者要求从项目页面下载此整合包。下载完成后，在「导入整合包」中选择该文件。';
   $('market-wiki-links').append(button('打开文件下载页 ↗',()=>api.marketOpen(plan.url)));
   return;
 }
 showPlan(plan);});bind('market-import',async()=>{const name=$('import-pack-name').value.trim();const plan=await api.marketImport('');if(plan){$('import-pack-name').value=plan.id;await installImported(plan);}});bind('market-plan-close',async()=>{currentPlan=null;$('market-plan-panel').classList.add('hidden');});
 bind('market-install',async()=>{if(!currentPlan)return;const result=await api.marketInstall(currentPlan.token);currentPlan=null;$('market-plan-panel').classList.add('hidden');toast(typeof result==='string'?'整合包已安装，可在首页启动：'+result:'资源安装完成，下次启动游戏时生效');await loadTargets();});bind('market-cancel',()=>api.stop());
 let loaderSerial=0,loaderKey='',loaderRequests=new Map();
 let optifineSerial=0,optifineKey='',optifineTicket=null,optifineRows=[];
 function optifineHint(text){
   const info=$('optifine-message');info.hidden=!text;info.textContent=text;
 }
 function showOptifineCompatibility(){
   const row=optifineRows.find(r=>r.version===$('optifine-version').value);
   if(row && $('loader-type').value==='forge')optifineHint('OptiFine 官方列出的 Forge 版本：'+row.forge+'。当前选择：'+($('loader-version').value||'尚未选择')+'。');
   else if($('install-optifine').checked && optifineTicket)optifineHint('');
 }
 async function optifineReset(){
   const game=$('loader-game').value,type=$('loader-type').value,toggle=$('install-optifine'),select=$('optifine-version');
   const allowed=type==='forge'||type==='none';
   if(!allowed)toggle.checked=false;
   $('optifine-fields').classList.toggle('hidden',!toggle.checked);
   if(!toggle.checked){
     ++optifineSerial;optifineKey='';optifineTicket=null;optifineRows=[];select.replaceChildren();
     optifineHint(allowed?'':'此加载器没有受支持的 OptiFine 组合。');
     return;
   }
   const key=game+'|'+type;if(key===optifineKey)return;
   const serial=++optifineSerial;optifineKey=key;optifineTicket=null;optifineRows=[];
   select.replaceChildren(new Option('正在读取…',''));optifineHint('');lock();
   try {
     const result=await api.loaderList({game,loader:'optifine'});
     if(serial!==optifineSerial)return;
     optifineRows=result.rows.filter(row=>type!=='forge'||/\d/.test(row.forge));
     select.replaceChildren();
     const stable=optifineRows.find(row=>row.stable);
     if(!stable)select.add(new Option(optifineRows.length?'请选择预览版':'暂无兼容版本',''));
     for(const row of optifineRows)select.add(new Option(row.version+(row.stable?' · 稳定版':' · 预览版'),row.version));
     if(stable)select.value=stable.version;
     optifineTicket=result.ticket;loaderName();showOptifineCompatibility();
   }catch(e){
     if(serial!==optifineSerial)return;
     optifineKey='';select.replaceChildren(new Option('读取失败',''));optifineHint('无法读取 OptiFine 版本，可取消勾选后重试。');
   }finally{if(serial===optifineSerial)lock();}
 }
 $('install-optifine').onchange=()=>{loaderReset();loaderName();lock();};
 $('optifine-version').onchange=()=>{loaderName();showOptifineCompatibility();lock();};
 async function loaderReset(){const game=$('loader-game').value;
 const select=$('loader-type'),cleanroom=select.querySelector('option[value="cleanroom"]');
 if(game==='1.12.2'&&!cleanroom)select.add(new Option('Cleanroom','cleanroom'));
 if(game!=='1.12.2'&&cleanroom){if(select.value==='cleanroom')select.value='none';cleanroom.remove();}
 optifineReset();const type=$('loader-type').value,key=game+'|'+type;if(key===loaderKey&&loaderTicket)return;loaderKey=key;const serial=++loaderSerial;loaderTicket=null;$('loader-version').replaceChildren(new Option(type==='none'?'无需加载器':'正在自动获取…',''));loaderName();$('loader-version').classList.toggle('hidden',type==='none');document.querySelector('label[for=loader-version]').classList.toggle('hidden',type==='none');$('loader-message').textContent=type==='none'?($('install-optifine').checked?'为 Minecraft 原版安装 OptiFine。':'直接安装 Minecraft 原版。'):'正在获取兼容的加载器版本…';lock();if(type==='none'||!game)return;
  try{let request=loaderRequests.get(key);if(!request){request=api.loaderList({game,loader:type});loaderRequests.set(key,request);request.finally(()=>{if(loaderRequests.get(key)===request)loaderRequests.delete(key);}).catch(()=>{});}const result=await request;if(serial!==loaderSerial)return;const rows=[...result.rows].sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));loaderTicket=result.ticket;$('loader-version').replaceChildren();const stable=rows.find(r=>r.stable);if(!stable)$('loader-version').add(new Option(rows.length?'没有稳定版，请手动选择测试版':'暂无兼容版本',''));for(const r of rows)$('loader-version').add(new Option(r.version+(r.stable?' · 稳定版':' · 测试版'),r.version));if(stable){$('loader-version').value=stable.version;loaderName();}$('loader-message').textContent=rows[0]?.bundledEntry?'暂时无法读取 GitHub 列表，可手动选择已验证的 Cleanroom 版本。':stable?'已自动选择最新稳定版 '+stable.version:rows.length?'暂无稳定版，可自行选择测试版。':'当前游戏版本暂无此加载器。';
  }catch(e){if(serial!==loaderSerial)return;$('loader-version').replaceChildren(new Option('获取失败',''));$('loader-message').textContent='无法读取加载器版本：'+String(e.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}finally{if(serial===loaderSerial){showOptifineCompatibility();lock();}}
 }
 $('loader-family').onchange=()=>{gameOptions();loaderReset();};$('loader-game').onchange=loaderReset;$('loader-type').onchange=loaderReset;function loaderName(){const game=$('loader-game').value,type=$('loader-type').value,version=$('loader-version').value;
 const parts=[game];if(type!=='none'&&version)parts.push(type,version);if($('install-optifine').checked&&$('optifine-version').value)parts.push('OptiFine',$('optifine-version').value);
 $('loader-name').value=type==='none'||version?parts.join('-'):'';}
 $('loader-version').onchange=()=>{loaderName();showOptifineCompatibility();lock();};
 bind('loader-install',async()=>{const game=$('loader-game').value,plain=$('loader-type').value==='none';const optifine=$('install-optifine').checked?{ticket:optifineTicket,version:$('optifine-version').value}:undefined;
 const id=plain&&!optifine?await api.installVanilla(game):await api.loaderInstall({game,ticket:plain?null:loaderTicket,version:$('loader-version').value,optifine,name:$('loader-name').value.trim()});toast('版本已安装：'+id);await loadTargets();});
 for(const b of document.querySelectorAll('[data-market-tab]'))b.onclick=()=>{document.querySelectorAll('[data-market-tab]').forEach(x=>x.classList.toggle('selected',x===b));document.querySelectorAll('.market-tab').forEach(x=>x.classList.toggle('hidden',x.id!=='market-'+b.dataset.marketTab));if(b.dataset.marketTab==='browse'&&!browsed)search();};
 api.onMarket(async data=>{if(data.selected){settings.selected=data.selected;options(data.selected);}if(opened)await loadTargets().catch(e=>log(e.message));});$('install-snapshots').onchange=()=>{gameOptions();loaderReset();};window.marketUI={backToResults,installTab:()=>{document.querySelectorAll('[data-market-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.marketTab==='loaders'));document.querySelectorAll('.market-tab').forEach(b=>b.classList.toggle('hidden',b.id!=='market-loaders'));},catalogChanged:()=>{catalogDirty=true;lock();},open:()=>run(async()=>{opened=true;await loadTargets();gameOptions();loaderReset();}),openFor:(id,kind='mod')=>run(async()=>{opened=true;await loadTargets();$('market-target').value=id;$('market-kind').value=kind;$('market-loader').value='auto';targetSummary();invalidate();gameOptions();browsed=true;document.querySelector('[data-market-tab="browse"]').click();search();}),setLocked:(value,s)=>{locked=value;$('market-task-text').textContent=s.text||'准备就绪';$('market-progress').value=s.percent||0;$('market-cancel').classList.toggle('hidden',!['preparing','downloading'].includes(s.phase));lock();}};
async function installImported(plan){showPlan(plan);if(plan.files.some(f=>f.manual)){toast('部分文件需要手动下载，请查看安装清单');return;}const id=await api.marketInstall(plan.token);currentPlan=null;$('market-plan-panel').classList.add('hidden');toast('整合包已安装：'+id);await loadTargets();}
 const drop=$('pack-drop');drop.onclick=()=>$('market-import').click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();drop.click();}};window.marketUI.showManualPlan=plan=>{
   page('market',false);document.querySelector('[data-market-tab="packs"]').click();
   if(plan.type==='manual-pack'){
     const msg='作者要求手动下载「'+plan.name+'」。下载后将压缩包拖入启动器。';
     toast(msg);$('market-plan-panel').classList.remove('hidden');$('market-plan-title').textContent=plan.name;
     $('market-plan-summary').textContent=msg;$('market-plan-files').replaceChildren(button('打开官方下载页 ↗',()=>api.marketOpen(plan.url)));
     $('market-plan-warnings').replaceChildren();currentPlan=null;lock();return;
   }
   showPlan(plan);lock();
 };
 window.marketUI.searchMods=async (query,kind="mod")=>{
   if(locked||working)throw Error('请等待当前任务完成');
   page('market',false);
   opened=true;await loadTargets();
   $('market-kind').value=kind;$('market-query').value=query;
   browsed=true;document.querySelector('[data-market-tab="browse"]').click();
   return search(0,true);
 };
 window.marketUI.droppedPack=file=>{
   if(locked||working){toast('请等待当前任务结束后再导入整合包');return;}
   page('market',false);
   document.querySelector('[data-market-tab="packs"]').click();
   return run(async()=>{const plan=await api.dropPack(file);$('import-pack-name').value=plan.id;await installImported(plan);});
 };
})();
