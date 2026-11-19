// Only restore a launcher hidden for this game. A JVM may exit before its
// first visible window, or while the launcher is still fading out.
function gameWindowVisibility(window, reducedMotion, helperPath) {
  const {spawn}=require('node:child_process');
  let timer, watcher, awaitingWindow=false, ownsVisibility=false;
  function stop() {
    clearTimeout(timer);
    timer = undefined;
  }
  function fade(to, done) {
    stop();
    if (window.isDestroyed()) return;
    const from = window.getOpacity(), start = Date.now();
    const duration = reducedMotion() ? 0 : 160;
    function frame() {
      if (window.isDestroyed()) return;
      const t = duration ? Math.min(1, (Date.now() - start) / duration) : 1;
      const eased = t * t * (3 - 2 * t);
      window.setOpacity(from + (to - from) * eased);
      if (t < 1) timer = setTimeout(frame, 16);
      else done();
    }
    frame();
  }
  function cancelWatcher() {
    awaitingWindow=false;
    if (watcher) { const p=watcher;watcher=undefined;p.kill(); }
  }
  function ready() {
    if (!awaitingWindow) return;
    cancelWatcher();
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) return;
    ownsVisibility=true;
    fade(0,()=>window.hide());
  }
  function started(enabled,pid) {
    stop();cancelWatcher();
    if (window.isDestroyed()) return;
    // A rapid relaunch may interrupt the previous reveal.
    window.setOpacity(1);
    ownsVisibility = false;
    if (!enabled || !window.isVisible() || window.isMinimized()) return;
    awaitingWindow=true;
    const p=spawn(helperPath,[String(pid),String(process.pid)],{windowsHide:true,stdio:'ignore'});
    watcher=p;
    p.once('error',()=>{if(watcher===p)watcher=undefined;});
    p.once('close',code=>{
      if(watcher!==p)return;
      watcher=undefined;
      if(code===0)ready();
    });
  }
  function ended() {
    stop();cancelWatcher();
    if (!ownsVisibility || window.isDestroyed()) return;
    ownsVisibility = false;
    if (!window.isVisible()) window.show();
    fade(1, () => {});
  }
  // Development builds may lack the helper. A renderer-stage game log
  // then provides positive startup evidence for standard Minecraft clients.
  function output(line) {
    if (awaitingWindow && (process.platform==='linux'||!watcher) && /Sound engine started|OpenAL initialized|Created: [^\n]+-atlas/i.test(line)) ready();
  }
  return { started, ended, output, stop:()=>{stop();cancelWatcher();} };
}
module.exports = { gameWindowVisibility };
