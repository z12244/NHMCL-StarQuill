const {test}=require('node:test'),assert=require('node:assert/strict');
const {gameWindowVisibility}=require('../src/shared/game-window-visibility.cjs');

function fakeWindow(){
  let hidden=false,opacity=1;
  return {
    isDestroyed:()=>false,
    isVisible:()=>!hidden,
    isMinimized:()=>false,
    getOpacity:()=>opacity,
    setOpacity:value=>{opacity=value;},
    hide:()=>{hidden=true;},
    show:()=>{hidden=false;},
    hidden:()=>hidden,
  };
}

test('without a platform helper the launcher still hides on game log evidence and restores afterwards',()=>{
  const win=fakeWindow();
  const visibility=gameWindowVisibility(win,()=>true,null);
  visibility.started(true,4242);
  assert.equal(win.hidden(),false,'nothing is hidden before the game window is ready');
  visibility.output('[Render thread/INFO]: Sound engine started');
  assert.equal(win.hidden(),true,'log evidence hides the launcher on platforms without a helper');
  visibility.ended();
  assert.equal(win.hidden(),false,'a normal exit restores the launcher');
  visibility.stop();
});

test('a disabled auto-hide never spawns, throws or hides anything',()=>{
  const win=fakeWindow();
  const visibility=gameWindowVisibility(win,()=>true,null);
  assert.doesNotThrow(()=>visibility.started(false,1));
  visibility.output('Sound engine started');
  assert.equal(win.hidden(),false,'starting was suppressed, so no evidence should hide anything');
  visibility.stop();
});

test('repeated start/stop cycles without a helper stay a no-op for the process layer',()=>{
  const win=fakeWindow();
  const visibility=gameWindowVisibility(win,()=>true,null);
  for(let i=0;i<5;i++){assert.doesNotThrow(()=>visibility.started(true,100+i));visibility.stop();}
  assert.equal(win.hidden(),false);
});
