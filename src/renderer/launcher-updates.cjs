(()=>{
  const get=id=>document.getElementById(id);
  const toggle=get('auto-update-check'),notice=get('update-notice'),dialog=get('release-dialog');
  const key='starquill-auto-update-check';
  let generation=0,release=null;
  try{toggle.checked=localStorage.getItem(key)!=='off';}catch{}
  function clear(){
    generation++;release=null;notice.hidden=true;
    if(dialog.open)dialog.close();
  }
  async function check(){
    clear();const request=generation;
    if(!toggle.checked||!navigator.onLine)return;
    const result=await window.starquill.checkRelease().catch(()=>null);
    if(request!==generation||!result||!navigator.onLine)return;
    release=result;get('update-caption').textContent='发现新版本 '+result.tag;
    notice.hidden=false;
  }
  toggle.onchange=()=>{try{localStorage.setItem(key,toggle.checked?'on':'off');}catch{}check();};
  window.addEventListener('offline',clear);
  get('update-dismiss').onclick=clear;
  get('update-view').onclick=()=>{
    if(!release)return;
    get('release-title').textContent=release.tag+' 更新说明';
    get('release-notes').textContent=release.notes||'此版本未提供更新说明。';
    notice.hidden=true;dialog.showModal();
  };
  get('release-close').onclick=()=>dialog.close();
  get('release-download').onclick=()=>window.starquill.openRelease(release.tag).catch(error=>toast(error.message));
  check();
})();
