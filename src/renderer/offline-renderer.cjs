(()=>{const $=id=>document.getElementById(id),api=window.starquill;let ticket=null,working=false,locked=false;
 function lock(){$('offline-open').disabled=working||locked;$('offline-confirm').disabled=working||locked||!ticket;$('offline-import-name').disabled=working||locked;$('offline-dismiss').disabled=working||locked;}
 async function run(fn){working=true;lock();try{await fn();}catch(e){toast(e.message);log(e.message);$('offline-import-info').textContent=e.message;}finally{working=false;lock();}}
 $('offline-open').onclick=()=>run(async()=>{const p=await api.offlineInspect();if(!p)return;ticket=p.token;$('offline-import-name').value=p.name;$('offline-import-info').textContent=`Minecraft ${p.game} · Java ${p.java} · ${p.files} 个文件 · 解压后约 ${(p.bytes/1024**3).toFixed(2)} GB`;$('offline-import-panel').classList.remove('hidden');});
 $('offline-confirm').onclick=()=>run(async()=>{if(!ticket)return;const id=await api.offlineImport({token:ticket,name:$('offline-import-name').value.trim()});ticket=null;$('offline-import-panel').classList.add('hidden');settings.selected=id;options(id);toast('版本包导入完成，可使用离线账号启动：'+id);});
 $('offline-dismiss').onclick=()=>{ticket=null;$('offline-import-panel').classList.add('hidden');lock();};$('offline-cancel').onclick=()=>api.stop();
 window.offlineUI={setState:(value,s)=>{locked=value;const importing=working&&['preparing','downloading'].includes(s.phase);$('offline-task').classList.toggle('hidden',!importing);$('offline-task-text').textContent=s.text||'';lock();}};
})();
