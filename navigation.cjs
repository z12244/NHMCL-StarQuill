/* Local launcher navigation: never navigate the file:// document or edit text. */
(() => {
  const content=document.querySelector('main .content'),originalPage=page;
  let stack=[],applying=false,last=null,lastInput=0;
  const selected=(selector,key)=>document.querySelector(selector)?.dataset[key]||'';
  function snapshot(){
    const name=document.querySelector('.page.active')?.id.replace(/^page-/,'')||'home';
    const route={page:name,scroll:content.scrollTop};
    if(name==='market')route.tab=selected('[data-market-tab].selected','marketTab');
    if(name==='settings')route.tab=selected('[data-ref-settings][aria-selected="true"]','refSettings');
    if(name==='accounts'){route.tab=selected('[data-ref-account-tab].selected','refAccountTab');const panel=document.querySelector('.appearance-panel');route.preview=!!panel&&!panel.classList.contains('hidden');if(route.preview)route.previewId=panel.dataset.accountId||accountData.active;}
    if(name==='instances')route.version=selected('.library-row.selected','libraryVersion');
    if(name==='instance'){route.tab=selected('[data-instance-tab].selected','instanceTab');route.id=document.getElementById('instance-subtitle').textContent.split(' · Minecraft ')[0];}
    return route;
  }
  const identity=route=>JSON.stringify({...route,scroll:0});
  function record(){if(applying)return;const route=snapshot();if(last&&identity(last)!==identity(route)){stack.push(last);if(stack.length>80)stack.shift();}last=route;}
  // Page + tab changes performed by one click are one navigation entry.
  page=function(name,openMarket=true){record();const result=originalPage(name,openMarket);queueMicrotask(record);return result;};
  new MutationObserver(record).observe(document.querySelector('main'),{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-selected']});
  content.addEventListener('scroll',()=>{if(!applying&&last)last.scroll=content.scrollTop;},{passive:true});
  const clickData=(attribute,value)=>{const element=[...document.querySelectorAll('['+attribute+']')].find(e=>e.getAttribute(attribute)===value);element?.click();};
  async function restore(route){
    applying=true;
    try{
      if(route.page==='instance'&&route.id&&document.getElementById('instance-subtitle').textContent.split(' · Minecraft ')[0]!==route.id)await window.instanceUI.open(route.id);
      else originalPage(route.page,false);
      if(route.page==='market')clickData('data-market-tab',route.tab);
      if(route.page==='settings'&&route.tab)window.referenceUI.settingsTab(route.tab);
      if(route.page==='accounts'){
        if(route.tab)window.referenceUI.accountTab(route.tab);
        if(!route.preview&&!document.querySelector('.appearance-panel').classList.contains('hidden'))document.getElementById('appearance-close').click();
        if(route.preview){const account=accountData.accounts.find(a=>a.id===(route.previewId||accountData.active));if(account)await window.appearanceUI.show(account,{automatic:true});}
      }
      if(route.page==='instance')clickData('data-instance-tab',route.tab);
      if(route.page==='instances'){
        if(!route.version)window.libraryUI.clearSelection();
        else{const row=[...document.querySelectorAll('.library-row')].find(e=>e.dataset.libraryVersion===route.version);row?.querySelector('.library-name').click();}
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      content.scrollTop=route.scroll||0;last=snapshot();
    }finally{applying=false;}
  }
  async function back(){
    if(applying)return false;
    record();let previous=stack.pop();
    if(!previous){const current=snapshot();if(current.page==='home')return false;previous={page:current.page==='instance'?'instances':'home',scroll:0};}
    await restore(previous);return true;
  }
  function editable(target){return target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');}
  function requestBack(){const time=Date.now();if(time-lastInput<120)return;lastInput=time;back().catch(error=>toast('无法返回上一页：'+error.message));}
  document.addEventListener('keydown',event=>{
    const isBack=event.key==='Backspace'||event.key==='BrowserBack'||(event.altKey&&event.key==='ArrowLeft'&&!event.ctrlKey&&!event.metaKey);
    if(!isBack||(event.key==='Backspace'&&editable(event.target))||document.querySelector('dialog[open]'))return;
    event.preventDefault();if(!event.repeat)requestBack();
  },true);
  document.addEventListener('mouseup',event=>{if(event.button!==3)return;event.preventDefault();if(!document.querySelector('dialog[open]'))requestBack();},true);
  document.addEventListener('auxclick',event=>{if(event.button===3)event.preventDefault();},true);
  window.starquill.onNavigateBack?.(()=>{if(!document.querySelector('dialog[open]'))requestBack();});
  last=snapshot();window.navigationUI={back,snapshot,depth:()=>stack.length};
})();
