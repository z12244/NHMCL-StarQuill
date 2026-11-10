/* Approved reference homepage. Existing controls are moved, never duplicated. */
(() => {
  const home = document.getElementById('page-home');
  if (!home) return;
  const $ = id => document.getElementById(id), launcher = window.starquill;
  const legacy = document.createElement('div');
  legacy.className = 'ref-home-legacy';
  while (home.firstChild) legacy.append(home.firstChild);
  home.append(legacy);
  const scene = document.createElement('div');
  scene.className = 'ref-home-background';scene.setAttribute('aria-hidden','true');
  const copy = document.createElement('div');copy.className='ref-home-copy';
  copy.innerHTML='<h1>以星为笔，<br>启程方块世界</h1><p class="ref-home-kicker">MINECRAFT / EXPLORE · BUILD · AUTOMATE</p><hr><p class="ref-home-story">从第一座小屋，到跨越维度的工程。<br>在无限的方块世界中，探索、建造、<br>创造属于你的故事。</p>';
  const route=document.createElement('div');route.className='ref-home-route';route.setAttribute('aria-hidden','true');
  route.innerHTML='<svg viewBox="0 0 1000 600" preserveAspectRatio="none"><polyline points="140,280 255,238 350,197 452,185 552,138 625,115 735,112"/><polyline points="350,197 400,312 503,357 594,410 710,415"/><circle cx="140" cy="280" r="6"/><circle cx="350" cy="197" r="6"/><circle cx="625" cy="115" r="6"/><circle cx="735" cy="112" r="6"/><circle cx="503" cy="357" r="6"/><circle cx="710" cy="415" r="6"/></svg><span class="ref-home-marker ref-marker-a">⌖ X 1280　Z −3520</span><span class="ref-home-marker ref-marker-b">⌖ X −640　Z 896</span><span class="ref-home-marker ref-marker-c">⌖ X 3424　Z 256</span><span class="ref-home-compass">N<br>▲</span>';
  const news=document.createElement('div');news.className='ref-home-news';news.setAttribute('aria-label','Minecraft 版本资讯');
  const featured=document.createElement('button');featured.type='button';featured.className='ref-home-news-featured';
  const newsList=document.createElement('div');newsList.className='ref-home-news-list';
  news.append(featured,newsList);
  const terminal=document.createElement('div');terminal.className='ref-home-terminal';terminal.setAttribute('aria-hidden','true');terminal.innerHTML='<b>ME 终端</b><small>Applied Energistics 2</small>';
  const bottom=document.createElement('div');bottom.className='ref-home-bottom';
  const versionGroup=document.createElement('div');versionGroup.className='ref-home-version';
  const versionLabel=document.createElement('label');versionLabel.htmlFor='version';versionLabel.textContent='当前版本';versionLabel.className='ref-home-current-label';
  const versionIcon=document.createElement('img');versionIcon.className='ref-home-version-icon';versionIcon.src='assets/icon.png';versionIcon.alt='';
  const versionCopy=document.createElement('div');versionCopy.className='ref-home-version-copy';
  const versionMeta=document.createElement('small');versionMeta.id='ref-home-version-meta';versionMeta.textContent='尚未安装游戏';
  versionCopy.append($('version'),versionMeta);
  versionGroup.append(versionLabel,versionIcon,versionCopy,$('refresh'));
  const emptyVersionButton=document.createElement('button');emptyVersionButton.type='button';emptyVersionButton.className='ref-home-empty-version';emptyVersionButton.textContent='无可使用版本';emptyVersionButton.setAttribute('aria-label','无可使用版本，前往资源工坊安装版本');emptyVersionButton.hidden=true;versionGroup.append(emptyVersionButton);
  const javaButton=$('runtime-settings');javaButton.className='ref-home-shortcut ref-home-java';javaButton.innerHTML='<span class="ref-home-shortcut-symbol" aria-hidden="true">♨</span><span><b>Java</b><small id="ref-home-java-value">自动匹配</small></span><span class="ref-home-chevron" aria-hidden="true">⌄</span>';
  const memoryButton=$('memory-settings');memoryButton.className='ref-home-shortcut ref-home-memory';memoryButton.innerHTML='<span class="ref-home-shortcut-symbol" aria-hidden="true">▥</span><span><b>内存分配</b><small id="ref-home-memory-value">读取中…</small></span><span class="ref-home-chevron" aria-hidden="true">⌄</span>';
  const actions=document.createElement('div');actions.className='ref-home-launch-actions';
  const launch=$('launch'),launchText=$('launch-text');
  const play=document.createElement('span');play.className='ref-home-play';play.setAttribute('aria-hidden','true');play.textContent='▶';
  launch.replaceChildren(launchText,play);actions.append(launch,$('stop'));
  const labelLaunch=()=>{launch.classList.toggle('ref-home-long-label',launchText.textContent.length>4);launch.title=launchText.textContent;launch.setAttribute('aria-label',launchText.textContent);};
  new MutationObserver(labelLaunch).observe(launchText,{childList:true,subtree:true,characterData:true});labelLaunch();
  bottom.append(versionGroup,javaButton,memoryButton,actions);
  const task=document.createElement('div');task.className='ref-home-task';task.append($('state-dot'),$('state-text'),$('progress'));bottom.append(task);
  home.append(scene,copy,route,news,terminal,bottom);
  const hasUsableVersions=()=>typeof installed!=='undefined'?installed.some(v=>v.ready):[...$('version').options].some(option=>option.value);
  function openEmptyInstall(event){
    if(hasUsableVersions()||$('launch').disabled||event.target.closest('#stop'))return;
    event.preventDefault();event.stopImmediatePropagation();showInstall();
  }
  versionGroup.addEventListener('click',openEmptyInstall,true);
  actions.addEventListener('click',openEmptyInstall,true);
  let versionTicket=0,versionKey='',lastInfo=null,scheduled=false;
  const fmtJava=value=>{const match=String(value||'').match(/(?:jdk|jre|java)[-_ ]?(\d+)/i);return match?'Java '+match[1]:'手动指定 Java';};
  const setText=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
  function showSummary(info) {
    const id=$('version').value,item=typeof installed==='undefined'?null:installed.find(v=>v.id===id);
    const target=info?.target,effective=info?.effective;
    const name=item?.displayName||item?.id||'';
    const empty=!hasUsableVersions();
    versionGroup.classList.toggle('is-empty',empty);actions.classList.toggle('is-empty',empty);
    $('version').hidden=empty;$('refresh').hidden=empty;versionMeta.hidden=empty;
    emptyVersionButton.hidden=!empty;emptyVersionButton.disabled=$('version').disabled;
    $('version').setAttribute('aria-label',empty?'无可使用版本':'当前已安装版本');$('version').title=name||'无可使用版本';
    const loaderName={forge:'Forge',neoforge:'NeoForge',fabric:'Fabric',cleanroom:'Cleanroom'}[target?.loader]||target?.loader;
    const versionText=id?(target?.game||id)+(loaderName?' · '+loaderName+(target?.loaderVersion?' '+target.loaderVersion:''):' · 原版'):'';
    setText(versionMeta,versionText);versionMeta.title=versionText;
    const memory=effective?.memory||Number($('memory').value)||4;
    setText($('ref-home-memory-value'),memory+' GB ('+(memory*1024)+' MB)');
    const mode=effective?.javaMode||$('java-mode').value,auto=mode!=='manual';
    const manual=effective?.java||$('java').value;
    const javaItem=typeof javaItems==='undefined'?null:javaItems.find(j=>j.path===manual);
    const game=target?.game||id,match=/^(\d+)\.(\d+)(?:\.(\d+))?/.exec(game||'');
    const inferredJava=match?(Number(match[1])>=26?25:Number(match[1])===1&&Number(match[2])>=21?21:Number(match[1])===1&&(Number(match[2])>20||Number(match[2])===20&&Number(match[3]||0)>=5)?21:Number(match[2])>=18?17:Number(match[2])===17?16:8):null;
    const javaMajor=Number.isInteger(info?.requiredJava)?info.requiredJava:inferredJava;
    const flexible=info?.javaRequirement&&info.javaRequirement.min!==info.javaRequirement.max;
    const javaText=mode==='major'?'自动 · Java '+(effective?.javaMajor||Number($('java-major').value)||21):mode==='folder'?'版本目录 Java':auto?(flexible?'自动匹配 Java':javaMajor?'自动 · Java '+javaMajor:'自动匹配 Java'):(javaItem?'Java '+javaItem.major+' ('+(javaItem.bits||64)+'位)':fmtJava(manual));
    setText($('ref-home-java-value'),javaText);
    javaButton.title=auto?(info?.requiredJavaDescription?'自动匹配兼容的 Java '+info.requiredJavaDescription:'自动按游戏版本选择合适的 Java'):manual;
  }
  async function refreshSummary(force=false) {
    const id=$('version').value||'';
    if (!force&&id===versionKey&&lastInfo) {showSummary(lastInfo);return;}
    const ticket=++versionTicket;
    versionKey=id;lastInfo=null;showSummary(null);
    if(!id){versionIcon.src='assets/icon.png';return;}
    try {
      const info=await launcher.instanceInfo(id);
      if(ticket!==versionTicket)return;
      lastInfo=info;showSummary(info);
    }catch{/* Invalid/incomplete local versions retain the normal list/error handling. */}
    try {
      const source=launcher.instanceIcon?await launcher.instanceIcon(id):null;
      if(ticket===versionTicket)versionIcon.src=source||'assets/icon.png';
    }catch{if(ticket===versionTicket)versionIcon.src='assets/icon.png';}
  }
  versionIcon.addEventListener('error',()=>{if(!versionIcon.src.endsWith('/assets/icon.png'))versionIcon.src='assets/icon.png';});
  function schedule(force=false){if(force)lastInfo=null;if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;refreshSummary(force);});}
  $('version').addEventListener('change',()=>schedule(true));
  new MutationObserver(()=>schedule()).observe($('version'),{childList:true,attributes:true,attributeFilter:['disabled']});
  for(const id of ['runtime-label','memory-label'])new MutationObserver(()=>schedule(true)).observe($(id),{childList:true,subtree:true,characterData:true});
  launcher.onInstances(()=>schedule(true));launcher.onMarket(()=>schedule(true));launcher.onJava(()=>schedule(true));
  const fallback=[{id:'1.21.1'},{id:'1.16.5'},{id:'1.12.2'},{id:'1.7.10'}];
  function showInstall(version) {
    page('market');window.marketUI?.installTab();
    // Change only through existing installed catalog selectors; no network request here.
    const groups=window.versionGroups?.groupVersions(typeof remote==='undefined'?[]:remote,[],false)||[];
    const group=groups.find(g=>g.versions.some(v=>v.id===version));
    if(group&&$('loader-family')){$('loader-family').value=group.id;$('loader-family').dispatchEvent(new Event('change',{bubbles:true}));}
    if([...$('loader-game').options].some(o=>o.value===version)){$('loader-game').value=version;$('loader-game').dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function renderNews(data) {
    const releases=data&&!data.cached?data.versions?.filter(v=>v.type==='release').slice(0,4):null;
    const rows=releases?.length===4?releases:fallback,online=rows===releases;
    const main=rows[0];featured.replaceChildren();
    const tag=document.createElement('span');tag.textContent=online?'版本更新':'离线推荐';
    const name=document.createElement('b');name.textContent='Minecraft '+main.id;
    const desc=document.createElement('small');desc.textContent=online?'查看最新正式版本　→':'探索熟悉的方块世界　→';
    featured.append(tag,name,desc);featured.onclick=()=>showInstall(main.id);featured.setAttribute('aria-label','查看 Minecraft '+main.id);
    newsList.replaceChildren();
    for(const row of rows.slice(1)) {
      const b=document.createElement('button');b.type='button';b.className='ref-home-news-item';
      const title=document.createElement('b');title.textContent=row.id+(online?' 发布':'');
      const date=document.createElement('small');
      date.textContent=online&&row.releaseTime?row.releaseTime.slice(0,10):'经典正式版';
      b.append(title,date);b.onclick=()=>showInstall(row.id);b.setAttribute('aria-label','查看 Minecraft '+row.id);newsList.append(b);
    }
    news.dataset.source=online?'online':'offline';
  }
  renderNews(window.referenceCatalog);launcher.onVersions(renderNews);
  window.referenceHome={refresh:()=>schedule(true),renderNews};
  Promise.resolve(window.starquillReady).then(()=>schedule(true));
})();
