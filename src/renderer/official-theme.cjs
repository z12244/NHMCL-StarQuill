(()=>{
  const key='starquill-official-theme';
  const modes=['light','dark','system'];
  let mode='light';
  try { const value=localStorage.getItem(key); if(modes.includes(value)) mode=value; } catch {}
  const system=matchMedia('(prefers-color-scheme: dark)');
  function apply(){document.documentElement.dataset.theme=mode==='system'?(system.matches?'dark':'light'):mode;}
  apply();
  system.addEventListener('change',apply);
  const cssKey='starquill-custom-css';
  let customName='',customSheet;
  function setCss(name,css,persist=true){
    const sheet=new CSSStyleSheet();
    if(name)sheet.replaceSync(css);
    if(persist){if(name)localStorage.setItem(cssKey,JSON.stringify({name,css}));else localStorage.removeItem(cssKey);}
    const sheets=document.adoptedStyleSheets.filter(item=>item!==customSheet);
    document.adoptedStyleSheets=name?[...sheets,sheet]:sheets;
    customName=name;customSheet=sheet;
  }
  try{const saved=JSON.parse(localStorage.getItem(cssKey));if(saved?.name&&typeof saved.css==='string')setCss(saved.name,saved.css,false);}catch{}
  window.officialTheme={cssName:()=>customName,setCss,current:()=>mode,select(value){
    mode=modes.includes(value)?value:'light';apply();
    try{localStorage.setItem(key,mode);}catch{}
  }};
})();
