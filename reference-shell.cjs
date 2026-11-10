(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const node = (tag,cls,text) => {const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const body=document.body;
  body.classList.add('reference-ui');
  const paths={play:'M7 4l14 8-14 8z',layers:'M3 8l9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5',cube:'M3 7l9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M9 3l1-2h4l1 2 2 1 3 0 2 4-2 2v3l2 2-2 4-3 0-2 1-1 2h-4l-1-2-2-1-3 0-2-4 2-2v-3L2 8l2-4 3 0z',logs:'M5 2h10l4 4v16H5z M14 2v5h5 M8 11h8 M8 15h8 M8 19h6'};
  const icon=(name)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  const title=node('div','ref-titlebar');title.innerHTML='<span class="ref-app-title">'+icon('cube')+'<span>Minecraft Java Launcher</span></span><div class="ref-window-controls"><button id="ref-window-minimize" aria-label="最小化">−</button><button id="ref-window-close" aria-label="关闭启动器">×</button></div>';
  body.prepend(title);
  for(const [id,action] of [['ref-window-minimize','minimize'],['ref-window-close','close']])$(id).onclick=()=>window.starquill.windowControl?.(action);
  const nav=document.querySelector('.sidebar nav');
  const accountsNav=nav.querySelector('[data-page="accounts"]');if(accountsNav)accountsNav.hidden=true;
  const navIcons={home:'play',instances:'layers',market:'cube',settings:'settings',logs:'logs'};
  for(const b of nav.querySelectorAll('[data-page]')){const s=b.querySelector('span');if(s&&navIcons[b.dataset.page])s.innerHTML=icon(navIcons[b.dataset.page]);}
  const profile=document.querySelector('header .profile');
  profile.setAttribute('role','button');profile.tabIndex=0;profile.setAttribute('aria-label','打开账号与皮肤');
  profile.onclick=()=>page('accounts');profile.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();profile.click();}};
  const header=document.querySelector('main > header');
  const strap=node('div','ref-header-strap','■ // MINECRAFT JAVA LAUNCHER');header.prepend(strap);
  const profileArrow=node('span','ref-profile-arrow','⌄');profile.append(profileArrow);
  document.querySelector('.sidebar .nav-label').hidden=true;
  const titleDescriptions={instances:['管理你的 Minecraft 安装实例','VERSION LIBRARY'],settings:['配置游戏的运行环境与参数','LAUNCH SETTINGS'],accounts:['管理账号身份与角色外观','ACCOUNT & APPEARANCE'],logs:['查看游戏输出与已有崩溃分析','RUNTIME OUTPUT'],instance:['调整此版本的启动方式与资源','INSTANCE SETTINGS']};
  for(const [id,[desc,en]] of Object.entries(titleDescriptions)){
    const heading=$('page-'+id)?.querySelector('.page-heading');if(!heading)continue;
    heading.querySelector('.eyebrow')?.remove();
    const p=heading.querySelector('p');if(p&&id!=='instance')p.textContent=desc;
    if(p){p.classList.add('ref-heading-caption');const subtitle=node('small','ref-heading-en',en);p.append(subtitle);}
  }
  document.querySelector('.account-badge')?.remove();
  setupSettings();setupAccounts();setupMarket();setupLogs();
  let currentPage='',queued=false;
  function text(id,value){const target=$(id);if(target&&target.textContent!==value)target.textContent=value;}
  function update(){queued=false;const active=document.querySelector('.content > .page.active');const id=active?.id.replace('page-','')||'home';
    if(currentPage!==id){currentPage=id;body.dataset.referencePage=id;document.querySelector('.content').scrollTop=0;}
    text('ref-system-memory',$('total-memory')?.textContent+' GB');text('ref-system-available',$('memory-available')?.textContent||'尚未读取');text('ref-system-java',$('runtime-label')?.textContent||'自动匹配 Java');
    text('ref-log-state',$('state-text')?.textContent||'准备就绪');text('ref-log-version',$('version')?.selectedOptions[0]?.textContent||'未选择版本');text('ref-log-java',$('runtime-label')?.textContent||'自动匹配');text('ref-log-memory',($('memory-label')?.textContent||'—')+' GB');
    const empty=$('ref-account-empty');if(empty)empty.hidden=!!$('account-list')?.childElementCount;
    let account;try{account=activeAccount();}catch{}
    const avatar=profile.querySelector('.avatar');const src=account?.preview||'assets/steve.png';
    if(avatar&&avatar.dataset.source!==src){avatar.dataset.source=src;avatar.replaceChildren();const image=node('img');image.src=src;image.alt='';image.className=account?.preview?'ref-bound-skin':'ref-default-skin';image.onerror=()=>{if(!image.src.endsWith('/assets/steve.png'))image.src='assets/steve.png';};avatar.append(image);}
  }
  const queue=()=>{if(!queued){queued=true;requestAnimationFrame(update);}};
  new MutationObserver(queue).observe(document.querySelector('main'),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
  $('version').addEventListener('change',queue);$('memory').addEventListener('input',queue);queue();
  function setupSettings(){
    const section=$('page-settings'),source=section.querySelector('.settings-card');if(!source)return;
    const children=[...source.children],runtime=children.findIndex(x=>x.tagName==='H3'&&x.textContent==='运行环境'),about=children.findIndex(x=>x.tagName==='H3'&&x.textContent==='关于星翎');
    const tabs=node('div','ref-settings-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','启动设置分类');
    const workspace=node('div','ref-settings-layout'),panels=node('div','ref-settings-panels'),summary=node('aside','ref-system-summary');
    const panelMap={};for(const [id,label] of [['general','常规目录'],['java','Java 与内存'],['download','下载'],['advanced','高级'],['about','关于']]){
      const button=node('button','ref-tab',label);button.type='button';button.setAttribute('role','tab');button.dataset.refSettings=id;button.id='ref-tab-'+id;button.setAttribute('aria-controls','ref-settings-'+id);tabs.append(button);
      const panel=node('section','ref-settings-panel');panel.id='ref-settings-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panelMap[id]=panel;panels.append(panel);
      button.onclick=()=>select(id);
    }
    const save=$('save');
    for(let i=0;i<children.length;i++){
      const e=children[i];if(e===save||e.tagName==='HR')continue;
      if(e.id==='global-advanced')panelMap.advanced.append(e);
      else if(i>=about)panelMap.about.append(e);
      else if(i>=runtime)panelMap.java.append(e);
      else panelMap.general.append(e);
    }
    const download=panelMap.general.querySelector('.download-settings');if(download){const help=download.nextElementSibling;panelMap.download.append(node('h3','','下载来源与并发'),download);if(help?.classList.contains('help'))panelMap.download.append(help);}
    const scanner=panelMap.advanced.querySelector('#advanced-scanner');if(scanner)panelMap.java.append(scanner);
    const advanced=panelMap.advanced.querySelector('#global-advanced');advanced.open=true;advanced.querySelector('summary').hidden=true;
    summary.innerHTML='<h3>系统信息</h3><dl><dt>系统内存</dt><dd id="ref-system-memory">— GB</dd><dt>当前可用内存</dt><dd id="ref-system-available">尚未读取</dd><dt>Java 选择</dt><dd id="ref-system-java">自动匹配 Java</dd></dl>';
    const footer=node('div','ref-settings-footer');footer.append(save);workspace.append(panels,summary);source.replaceWith(tabs,workspace,footer);
    function select(id){for(const [key,panel] of Object.entries(panelMap)){panel.hidden=key!==id;const b=tabs.querySelector('[data-ref-settings='+key+']');b.setAttribute('aria-selected',String(key===id));b.classList.toggle('selected',key===id);}document.querySelector('.content').scrollTop=0;}
    window.referenceUI={settingsTab:select};select('java');
    for(const id of ['runtime-settings','memory-settings']){const button=$(id),previous=button?.onclick;if(!button)continue;button.onclick=async e=>{if(previous)await previous(e);select('java');};}
  }
  function setupAccounts(){
    const layout=document.querySelector('.account-layout');if(!layout)return;
    const listPanel=$('account-list').closest('.account-panel'),offline=$('offline-name').closest('.account-panel'),skin=$('skin-canvas').closest('.account-panel'),server=$('skin-login-panel'),microsoft=$('auth-config-status').closest('.account-panel'),appearance=document.querySelector('.appearance-panel');
    const management=node('div','ref-account-management'),preview=node('aside','ref-account-preview'),tabs=node('div','ref-account-tabs');
    const empty=node('p','help','尚未创建账号。可添加离线账号或使用皮肤站登录。');empty.id='ref-account-empty';listPanel.append(empty);management.append(listPanel,tabs);
    const groups={accounts:skin,offline,server};
    for(const [id,label] of [['accounts','角色皮肤'],['offline','添加离线账号'],['server','皮肤站登录']]){const button=node('button','ref-tab',label);button.type='button';button.dataset.refAccountTab=id;tabs.append(button);button.onclick=()=>select(id);management.append(groups[id]);}
    management.append(microsoft);
    if(appearance)preview.append(appearance);
    const hint=node('div','ref-preview-hint');hint.innerHTML='<h3>角色外观</h3><p>皮肤站登录后自动读取角色外观。离线账号可导入皮肤，也可点击账号旁的“观看 3D 皮肤”。</p>';preview.append(hint);
    layout.replaceChildren(management,preview);
    function select(id){for(const [key,panel] of Object.entries(groups)){panel.hidden=key!==id;const button=tabs.querySelector('[data-ref-account-tab='+key+']');button.classList.toggle('selected',key===id);button.setAttribute('aria-pressed',String(key===id));}}
    select('accounts');
    // The existing first-run skin-site option still opens the real login form.
    const welcome=$('welcome-skin'),previous=welcome.onclick;if(welcome)welcome.onclick=async e=>{if(previous)await previous(e);select('server');};
    const focus=$('authlib-provider');focus.addEventListener('focus',()=>select('server'));
    window.referenceUI.accountTab=select;
  }
  function setupMarket(){
    const title=$('page-market').querySelector('.market-hero');title.querySelector('.eyebrow')?.remove();title.querySelector('.pixel-chest')?.remove();
    const workspace=document.querySelector('.market-workspace'),detail=document.querySelector('.resource-detail');if(workspace&&detail){workspace.before(detail);detail.classList.add('ref-market-feature');}
  }
  function setupLogs(){
    const section=$('page-logs'),summary=node('div','ref-log-summary');
    for(const [label,id] of [['运行状态','state'],['游戏版本','version'],['Java 选择','java'],['分配内存','memory']]){const item=node('div');item.append(node('span','',label));const value=node('b');value.id='ref-log-'+id;item.append(value);summary.append(item);}
    const workspace=node('div','ref-log-workspace');workspace.append($('log'),$('crash-card'));section.querySelector('.page-heading').after(summary,workspace);
  }
})();
