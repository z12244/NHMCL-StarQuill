(()=>{
  const api=window.starquill,$=id=>document.getElementById(id),host=$('instances-list'),section=$('page-instances');
  if(!host||!section)return;
  let items=[],preview='',details=null,serial=0,locked=false,iconEpoch=0;
  const icons=new Map(),pendingIcons=new Map();
  const node=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
  const loaderName=value=>({forge:'Forge',neoforge:'NeoForge',fabric:'Fabric',cleanroom:'Cleanroom'})[value]||'原版';
  const displayName=item=>item.displayName||item.id;
  const heading=section.querySelector('.page-heading');
  heading?.querySelector('p')?.remove();
  heading?.querySelector('.eyebrow')?.remove();
  heading?.classList.add('library-heading');
  const headingCaption=node('div','library-heading-caption','管理你的 Minecraft 安装实例');
  headingCaption.append(node('small','','VERSION LIBRARY'));
  heading?.querySelector('h1')?.after(headingCaption);
  const columns=node('div','library-workspace'),list=node('div','library-list'),listTitle=node('h2','library-list-title','版本列表'),rows=node('div','library-rows'),count=node('p','library-count'),detail=node('aside','library-detail');
  detail.setAttribute('aria-label','选中版本的详细信息');detail.setAttribute('aria-live','polite');
  list.append(listTitle,rows,count);columns.append(list,detail);host.replaceChildren(columns);
  function fitNames(){for(const label of rows.querySelectorAll('.library-name b')){label.style.removeProperty('font-size');const base=parseFloat(getComputedStyle(label).fontSize);if(label.scrollWidth>label.clientWidth)label.style.fontSize=Math.max(11,Math.floor(base*label.clientWidth/label.scrollWidth*10)/10)+'px';}}
  new ResizeObserver(()=>requestAnimationFrame(fitNames)).observe(columns);
  function avatar(id,title){const wrap=node('span','library-avatar');wrap.setAttribute('aria-hidden','true');const image=node('img');image.alt='';image.src=icons.get(id)||'assets/icon.png';image.dataset.versionIcon=id;image.onerror=()=>{if(image.getAttribute('src')!=='assets/icon.png')image.src='assets/icon.png';};wrap.append(image);loadIcon(id);return wrap;}
  async function loadIcon(id){
    if(icons.has(id)||pendingIcons.has(id)||typeof api.instanceIcon!=='function')return;
    const root=settings.root,epoch=iconEpoch,promise=api.instanceIcon(id).then(src=>{if(settings.root!==root||epoch!==iconEpoch)return;if(typeof src==='string'&&/^data:image\/(png|jpeg|webp);base64,/i.test(src))icons.set(id,src);else icons.set(id,'assets/icon.png');for(const image of host.querySelectorAll('img[data-version-icon]'))if(image.dataset.versionIcon===id)image.src=icons.get(id);}).catch(()=>{}).finally(()=>{if(pendingIcons.get(id)===promise)pendingIcons.delete(id);});
    pendingIcons.set(id,promise);
  }
  async function act(fn){try{await fn();}catch(error){toast(error.message);log(error.message);}}
  function button(text,fn){const b=node('button','secondary library-action',text);b.type='button';b.onclick=e=>{e.stopPropagation();if(!b.disabled)act(fn);};return b;}
  async function choose(item){if(!item?.ready)return;settings.selected=item.id;options(item.id);updateSummary();page('home');}
  function operations(item){const actions=node('div','library-actions');const configure=button('版本设置',()=>window.instanceUI.open(item.id));configure.dataset.libraryAction='settings';configure.disabled=locked||!item.ready;
    const folder=button('打开目录',()=>api.folder(item.id));folder.dataset.libraryAction='folder';folder.disabled=locked;
    const exportPack=button('导出版本包',async()=>{exportPack.disabled=true;exportPack.textContent='正在导出…';try{const result=await api.offlineExport(item.id);if(result)toast('离线版本包已导出，不含 saves 存档：'+result.file);}finally{exportPack.textContent='导出版本包';exportPack.disabled=locked||!item.ready;}});exportPack.dataset.libraryAction='export';exportPack.disabled=locked||!item.ready;
    actions.append(configure,folder,exportPack);return actions;
  }
  function meta(label,value,edit){const line=node('div','library-meta-row'),key=node('span','',label),text=node('b','',value);line.append(key,text);if(edit){const change=button('›',edit);change.classList.add('library-edit');change.setAttribute('aria-label','修改'+label);change.disabled=locked;line.append(change);}return line;}
  function renderDetail(){
    const item=items.find(v=>v.id===preview&&v.ready);detail.replaceChildren();detail.hidden=!item;columns.classList.toggle('has-selection',!!item);if(!item)return;
    const top=node('div','library-detail-top'),eyebrow=node('span','library-detail-eyebrow','INSTANCE DETAILS'),use=button('选择版本',()=>choose(item));use.disabled=locked;use.dataset.libraryChoose=item.id;top.append(eyebrow,use);
    const identity=node('div','library-detail-identity'),names=node('div','library-detail-names'),name=node('h2','',displayName(item));name.title=displayName(item);names.append(name);identity.append(avatar(item.id,displayName(item)),names);detail.append(top,identity);
    if(!details||details.id!==item.id){detail.append(node('p','library-detail-loading','正在读取版本信息…'));return;}
    const pills=node('div','library-detail-pills');pills.append(node('span','',loaderName(details.target.loader)),node('span','',details.target.game));names.append(pills);
    const metadata=node('div','library-meta'),java=details.effective.javaMode==='major'?'自动选择 · Java '+details.effective.javaMajor:details.effective.javaMode==='folder'?'版本文件夹中的 Java':details.effective.javaMode==='auto'?(details.javaRequirement&&details.javaRequirement.min!==details.javaRequirement.max?'自动匹配 · 多版本兼容':'自动匹配 · Java '+details.requiredJava):(javaItems.find(j=>j.path===details.effective.java)?'Java '+javaItems.find(j=>j.path===details.effective.java).version+'（手动）':'手动指定 Java');
    metadata.append(meta('游戏版本',details.target.game),meta('模组加载器',loaderName(details.target.loader)+(details.target.loaderVersion?' '+details.target.loaderVersion:'')),meta('内存分配',details.effective.memory+' GB（'+(details.effective.memory*1024)+' MB）',()=>window.instanceUI.open(item.id)),meta('Java 版本',java,()=>window.instanceUI.open(item.id)));detail.append(metadata);
  }
  async function previewVersion(item){if(!item.ready||locked)return;preview=item.id;details=null;const ticket=++serial;renderRows();renderDetail();requestAnimationFrame(fitNames);try{const value=await api.instanceInfo(item.id);if(ticket!==serial||preview!==item.id)return;details=value;renderDetail();}catch(error){if(ticket!==serial)return;detail.append(node('p','library-detail-error','无法读取：'+error.message));}}
  function download(){page('market');window.marketUI?.installTab();}
  function renderRows(){rows.replaceChildren();const ready=items.filter(v=>v.ready);if(!ready.length){const empty=node('div','library-empty');empty.append(node('h3','','暂无已安装的版本'),button('下载版本',download));empty.querySelector('button').classList.add('primary-library');rows.append(empty);}
    for(const item of items){const row=node('article','library-row'+(preview===item.id?' selected':'')+(!item.ready?' unavailable':''));row.dataset.libraryVersion=item.id;const name=node('button','library-name');name.type='button';name.setAttribute('aria-pressed',String(preview===item.id));name.setAttribute('aria-label','查看 '+displayName(item)+' 的版本详情');name.title=item.ready?displayName(item):displayName(item)+'：'+item.error;name.disabled=locked||!item.ready;name.append(avatar(item.id,displayName(item)),node('b','',displayName(item)));name.onclick=e=>{e.stopPropagation();previewVersion(item);};row.onclick=()=>previewVersion(item);row.append(name,operations(item));rows.append(row);}count.textContent=ready.length+' 个已安装版本';requestAnimationFrame(fitNames);
  }
  let rootKey='';
  function render(next){iconEpoch++;icons.clear();pendingIcons.clear();if(rootKey!==settings.root){rootKey=settings.root;preview='';details=null;serial++;}items=Array.isArray(next)?next:[];if(!items.some(item=>item.id===preview&&item.ready)){preview='';details=null;serial++;}renderRows();renderDetail();if(preview){const current=items.find(v=>v.id===preview);if(current)previewVersion(current);}}
  window.libraryUI={render,setLocked(value){locked=value;renderRows();renderDetail();},clearSelection(){preview='';details=null;serial++;renderRows();renderDetail();}};
  render(installed);
})();
