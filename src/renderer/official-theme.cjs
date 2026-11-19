(()=>{
  const key='starquill-official-theme';
  const modes=['light','dark','system'];
  let mode='light';
  try { const value=localStorage.getItem(key); if(modes.includes(value)) mode=value; } catch {}
  const system=matchMedia('(prefers-color-scheme: dark)');
  function apply(){document.documentElement.dataset.theme=mode==='system'?(system.matches?'dark':'light'):mode;}
  apply();
  system.addEventListener('change',apply);
  window.officialTheme={current:()=>mode,select(value){
    mode=modes.includes(value)?value:'light';apply();
    try{localStorage.setItem(key,mode);}catch{}
  }};
})();
