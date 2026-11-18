(() => {
  const $=id=>document.getElementById(id), api=window.starquill;
  const labels={home:'开始冒险',instances:'我的版本',market:'资源工坊',settings:'启动设置',accounts:'账号与皮肤',logs:'运行日志',
    general:'常规',java:'Java 与内存',advanced:'高级',about:'关于',ai:'AI 助手'};
  let busy=false, configured=false, dirty=false, proposal=null, message='', configMessage='';
  const dialog=$('ai-dialog'),orb=$('ai-orb');
  function openChat(){
    if(!dialog.open)dialog.showModal();
    orb.setAttribute('aria-expanded','true');
    (configured?$('ai-prompt'):$('ai-connect')).focus();
  }
  function openConnection(){
    if(dialog.open)dialog.close();
    page('settings');window.referenceUI.settingsTab('ai');$('ai-endpoint').focus();
  }
  orb.onclick=openChat;
  $('ai-close').onclick=()=>dialog.close();
  $('ai-connect').onclick=openConnection;
  dialog.addEventListener('close',()=>orb.setAttribute('aria-expanded','false'));
  $('ai-prompt').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing&&!$('ai-ask').disabled){
      event.preventDefault();ask('chat');
    }
  });
  function update() {
    $('ai-status').textContent=navigator.onLine ? message || (configured?'':'请先配置模型连接') : '当前无网络连接';
    $('ai-config-status').textContent=navigator.onLine?configMessage:'当前无网络连接';
    $('ai-connect').hidden=configured;
    for(const id of ['ai-save','ai-clear','ai-endpoint','ai-key','ai-model','ai-auto']) $(id).disabled=busy;
    for(const id of ['ai-ask','ai-analyze']) $(id).disabled=busy||!configured||!navigator.onLine;
  }
  for(const id of ['ai-endpoint','ai-model','ai-key','ai-auto'])$(id).addEventListener('input',()=>{dirty=true;});
  function display(config) {
    dirty=false;
    $('ai-endpoint').value=config.base||'';$('ai-model').value=config.model||'';$('ai-auto').checked=config.autoAnalyze!==false;
    $('ai-key').value='';$('ai-key').placeholder=config.hasKey?'已保存，留空可继续使用':'输入服务商提供的密钥';
    configured=!!(config.base&&config.model);
  }
  function clearProposal() { proposal=null;$('ai-apply').hidden=true; }
  async function run(fn,connection=false) {
    if(busy)return;
    busy=true;update();
    try {await fn();} catch(e){const problem=e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');if(connection)configMessage=problem;else message=problem;}
    finally {busy=false;update();}
  }
  async function ask(mode) {
    const instruction=mode==='analyze'?'':$('ai-prompt').value.trim();
    if(busy||!navigator.onLine){update();return;}
    clearProposal();$('ai-answer').textContent='';
    message=mode==='analyze'?'正在分析最近日志…':'正在等待模型回复…';update();
    await run(async()=>{
      const result=await api.askAI({mode,prompt:instruction});
      $('ai-answer').textContent=result.text;message='';
      if(result.action?.type==='instance'&&!result.action.loader){
        message='正在安装 Minecraft '+result.action.game+' 原版…';update();
        const id=await api.installVanilla(result.action.game);message='原版已就绪：'+id;toast(message);return;
      }
      if(result.action?.type==='install'||result.action?.type==='instance'){
        const command=result.action;
        // A request for advice or search should never write files.
        if((command.type!=='instance'&&!/(安装|下载|装(?:上|个|一下|一个|入|到)|install|download)/i.test(instruction)) ||
           /(?:不要|不用|别|不必|不想|如何|怎样|怎么|能否|是否|don't|how (?:can|to)|do not).{0,16}(?:安装|下载|装|install|download)/i.test(instruction)){
          message='如需直接安装，请输入「安装」及资源名称';return;
        }
        message='正在查找兼容文件并安装「'+command.value+'」…';$('ai-answer').textContent='';update();
        const installed=await api.aiInstallResource({...command,request:instruction});
        if(installed.instanceOnly){message='游戏版本已就绪：'+installed.target;toast(message);return;}
        if(installed.partial){message=installed.partial;return;}
        if(installed.choice){const c=installed.choice;message=c.message;proposal={type:'choose',value:c.query,kind:c.kind};$('ai-apply').textContent='查看搜索结果';$('ai-apply').hidden=false;return;}
        if(installed.guide){
          const g=installed.guide;
          message='已联网查找「'+g.name+'」，未取得可自动安装的兼容文件。'+(g.warnings.length?g.warnings.join('；')+'。':'')+'可在项目页查看作者发布渠道，下载后拖入启动器。';
          proposal={type:'guide',value:g.url};$('ai-apply').textContent='查看下载渠道';$('ai-apply').hidden=false;return;
        }
        if(installed.manual){if(dialog.open)dialog.close();window.marketUI.showManualPlan(installed.manual);message='需要补充作者指定的手动下载文件';}
        else{message=installed.kind==='modpack'?'整合包已安装：'+installed.target:'已将「'+installed.name+'」及所需依赖安装到 '+installed.target;toast(message);}
        $('ai-answer').textContent=message;return;
      }
      proposal=result.action;
      if(proposal) {
        const a=proposal;
        const label={launch:'启动当前游戏',scanJava:'扫描本地 Java',page:'打开「'+labels[a.value]+'」',settings:'打开「'+labels[a.value]+'」设置',search:'搜索模组「'+a.value+'」'};
        $('ai-apply').textContent=label[a.type];$('ai-apply').hidden=false;
      }
    });
  }
  $('ai-ask').onclick=()=>ask('chat');$('ai-analyze').onclick=()=>ask('analyze');
  $('ai-save').onclick=()=>run(async()=>{
    const config=await api.saveAI({base:$('ai-endpoint').value,model:$('ai-model').value,key:$('ai-key').value,autoAnalyze:$('ai-auto').checked});
    display(config);clearProposal();message='';configMessage='模型连接已保存';
  },true);
  $('ai-clear').onclick=()=>run(async()=>{await api.clearAI();display({});clearProposal();$('ai-answer').textContent='';message='';configMessage='模型连接已清除';},true);
  $('ai-apply').onclick=()=>run(async()=>{
    const a=proposal;clearProposal();if(!a)return;
    if(dialog.open)dialog.close();
    switch(a.type) {
      case 'choose': await window.marketUI.searchMods(a.value,a.kind);break;
      case 'guide': await api.marketOpen(a.value);break;
      case 'page': page(a.value);break;
      case 'settings': page('settings');window.referenceUI.settingsTab(a.value);break;
      case 'search': await window.marketUI.searchMods(a.value);break;
      case 'scanJava': page('settings');window.referenceUI.settingsTab('java');$('scan-java').click();break;
      case 'launch':
        if ($('launch').disabled)throw Error('当前游戏启动操作不可用');
        page('home');$('launch').click();break;
    }
  });
  const quick=document.createElement('button');
  quick.className='secondary';quick.textContent='AI 分析';quick.id='log-ai-analyze';
  const group=document.createElement('div');group.className='log-ai-actions';
  const exportButton=$('export');exportButton.before(group);group.append(quick,exportButton);
  quick.onclick=()=>{
    openChat();if(configured&&!busy)ask('analyze');
  };
  const analysis=document.createElement('details');
  analysis.id='auto-ai-diagnosis';analysis.hidden=true;
  const heading=document.createElement('summary'),output=document.createElement('div');
  output.id='log-ai-result';analysis.append(heading,output);
  const logWorkspace=document.querySelector('.ref-log-workspace');
  const aside=document.createElement('aside');aside.id='log-analysis-column';
  logWorkspace.append(aside);aside.append($('crash-card'),analysis);
  function renderDiagnosis(result){
    analysis.hidden=!result;
    if(!result)return;
    heading.textContent=(result.pending?'AI 正在分析':'AI 日志分析')+' · '+result.version;
    output.textContent=result.pending?'正在分析本次启动日志…':result.text;
    analysis.open=true;
  }
  let received=false;api.onAIDiagnosis(result=>{received=true;renderDiagnosis(result);});
  api.aiDiagnosis().then(result=>{if(!received)renderDiagnosis(result);}).catch(()=>{});
  window.addEventListener('online',update);window.addEventListener('offline',update);
  async function reloadConnection(){display(await api.aiConfig());configMessage='';message='';clearProposal();update();}
  api.onLoginCacheChange(()=>{if(!dirty&&!busy)run(reloadConnection,true);});
  window.aiUI={reloadConnection};
  run(reloadConnection,true);
})();
