const fs = require('node:fs/promises');
const path = require('node:path');
const {noLinks} = require('./content-utils.cjs');

const defaults = Object.freeze({launcherWidth:834, launcherHeight:514, followLauncher:true, gameWidth:834, gameHeight:514, fullscreen:false});
function windowSettings(input = {}) {
  const result = {...defaults, ...input};
  for (const [key, name, min, max] of [
    ['launcherWidth','启动器宽度',720,7680], ['launcherHeight','启动器高度',460,4320],
    ['gameWidth','游戏宽度',320,16384], ['gameHeight','游戏高度',240,16384]
  ]) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max)
      throw Error(name+'须为 '+min+'–'+max+' 的整数');
  }
  for (const key of ['followLauncher','fullscreen']) if (typeof result[key] !== 'boolean') throw Error('窗口设置无效');
  return Object.fromEntries(Object.keys(defaults).map(key => [key, result[key]]));
}
function launcherBounds(prefs, area, previous = {}) {
  const width = Math.min(area.width, Number.isInteger(previous.width) ? previous.width : prefs.launcherWidth);
  const height = Math.min(area.height, Number.isInteger(previous.height) ? previous.height : prefs.launcherHeight);
  const position = (old,start,space,size) => Math.round(Math.min(start+space-size,Math.max(start,old ?? (start+(space-size)/2))));
  return {width,height,x:position(previous.x,area.x,area.width,width),y:position(previous.y,area.y,area.height,height)};
}
function gameWindow(prefs, launcher) {
  const p = windowSettings(prefs);
  return {width:p.followLauncher ? (launcher?.width ?? p.launcherWidth) : p.gameWidth,
    height:p.followLauncher ? (launcher?.height ?? p.launcherHeight) : p.gameHeight, fullscreen:p.fullscreen};
}
// Minecraft also reads saved display options after parsing its launch arguments.
async function syncGameDisplay(directory, display) {
  const file = path.join(directory,'options.txt');
  await noLinks(directory,file);
  let original;
  try { original = await fs.readFile(file,'utf8'); } catch (e) { if (e.code==='ENOENT') return; throw e; }
  const values={fullscreen:String(display.fullscreen),overrideWidth:'0',overrideHeight:'0'};
  const next=original.replace(/^(fullscreen|overrideWidth|overrideHeight):[^\r\n]*/gm, (_,key)=>key+':'+values[key]);
  if(next!==original) {
    const tmp=path.join(directory,'.starquill-options-'+require('node:crypto').randomUUID()+'.tmp');
    try { await fs.writeFile(tmp,next,{flag:'wx'}); await fs.rename(tmp,file); }
    finally { await fs.rm(tmp,{force:true}); }
  }
}
module.exports={defaults,windowSettings,launcherBounds,gameWindow,syncGameDisplay};
