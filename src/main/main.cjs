require('./stdio-guard.cjs').install();
const {app,BrowserWindow,ipcMain,dialog,shell,screen,net,safeStorage:desktopStorage,clipboard}=require('electron');
// Chromium's basic_text backend does not protect secrets with a user keyring.
const safeStorage = {
  isEncryptionAvailable: () => desktopStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || !['basic_text','unknown'].includes(desktopStorage.getSelectedStorageBackend())),
  encryptString(value) {
    if (!this.isEncryptionAvailable()) throw Error('请先解锁桌面密钥环');
    return desktopStorage.encryptString(value);
  },
  decryptString: value => desktopStorage.decryptString(value)
};
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {detectIsolation,inferredMode,samePath,effectiveIsolation}=require('../shared/isolation-detection.cjs');
let pendingIsolation;
const {windowSettings, launcherBounds, gameWindow} = require('../shared/window-settings.cjs');
const {Game,inspectJava}=require('../shared/game.cjs');
const advanced=require('../shared/advanced.cjs');
const publicSettings=()=>{const {localVersionArgs,importedIsolation,...visible}=settings;return {...visible,isolationCounts:samePath(importedIsolation?.root,settings.root)?importedIsolation.counts:null};};
const {layout,scan,markStandalone,writeJSON,migrateLegacy}=require('../shared/storage.cjs');
const {validate,runtimePath,redact}=require('../shared/core.cjs');
const {scanJava,chooseJava,requiredJava,javaRequirement,javaCompatible,describeJava,memoryLimit}=require('../shared/java.cjs');
const {AccountStore,MicrosoftAuth,validClient,PROJECT_CLIENT_ID,RETIRED_CLIENT_ID,resolveClientId}=require('../shared/accounts.cjs');
const {importSkin,previewSkin,startSkinServer}=require('../shared/skins.cjs');
const {YggdrasilAuth,PRESETS}=require('../shared/yggdrasil.cjs');
const {ManifestCatalog}=require('../shared/catalog.cjs');
const {registerMarket}=require('../shared/market-ipc.cjs');
const {registerInstances}=require('../shared/instance-manager.cjs');
const {registerOfflinePacks}=require('../shared/offline-pack.cjs');
const {instanceOptions}=require('../shared/instance-config.cjs');
const {validateJavaSelection,resolveJavaSelection,validMajor}=require('../shared/java-selection.cjs');
const {targetInfo}=require('../shared/loaders.cjs');
const {memorySnapshot,optimizeMemory}=require('../shared/memory.cjs');
const {logBuffer,crashBaseline,freshFatalFiles,unexpectedExit,exportCrash,latestCrash}=require('../shared/crash-reports.cjs');
const crypto=require('node:crypto');
let catalog,market,externalBusy=false,externalController,externalServer,externalSession,externalTimer;
let accounts,accountError='',javaItems=[],javaScan,loginController,skinServer;
const {electronFetch}=require('../shared/electron-fetch.cjs');
const fetcher=(url,options)=>electronFetch(net,url,options);
const auth=new MicrosoftAuth({fetcher});
const deviceLogin=new (require('../shared/device-login.cjs').DeviceLogin)({clipboard,openExternal:url=>shell.openExternal(url)});
const externalAuth=new YggdrasilAuth({fetcher});
let gameVisibility;
let win,child,busy=false,controller,settings,logs=[],closing=false,gameStopRequested=false,sessionLogs=null,lastCrash=null;
let welcomeNeeded=true,lastAuthFailure=null;
function authFailureDetails(error){if(!error.details)return null;lastAuthFailure={time:new Date().toISOString(),clientId:settings.microsoftClientId,version:require('../../package.json').displayVersion,...error.details};log('微软登录诊断：'+JSON.stringify(lastAuthFailure));return lastAuthFailure;}
const appearanceSync=new Map(),appearanceResults=new Map();
let state={phase:'idle',text:'准备就绪',percent:0};
const settingsAccount=()=>accounts.accounts.find(a=>a.id===accounts.active)||{name:'Guest',type:'offline'};
const home=()=>path.join(portable(),'.starquill-profile');
const linuxData = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local','share'), 'NHMCL-StarQuill');
const macData=path.join(os.homedir(),'Library','Application Support','NHMCL-StarQuill');
const portable=()=>process.env.PORTABLE_EXECUTABLE_DIR || (process.platform==='linux' ? linuxData : process.platform==='darwin' ? macData : null) ||(app.isPackaged?path.dirname(process.execPath):path.join(__dirname,'..','..'));
const {SharedLogins,windowsUserStorage}=require('../shared/shared-logins.cjs');
const systemLoginDir=process.platform==='darwin' ? macData : process.platform==='linux' ? linuxData : path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NHMCL-StarQuill');
const keyHelper=()=>path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'..','..'),'tools','user-storage-key.exe');
let loginDatabase;
function sharedLogins(){return loginDatabase??=new SharedLogins(systemLoginDir,process.platform!=='win32' ? safeStorage : windowsUserStorage(systemLoginDir,keyHelper()));}
const defaults=()=>({hideOnGameStart:true,windows:windowSettings(),advanced:advanced.effective(),name:'Player',memory:Math.min(4,Math.max(1,Math.floor(os.totalmem()/1024**3/2))),optimizeMemory:false,java:'',javaMode:'auto',javaMajor:21,javaRoots:[],microsoftClientId:PROJECT_CLIENT_ID,selected:'1.21.1',snapshots:false,root:path.join(portable(),'.minecraft'),isolate:true,source:'auto',concurrency:16});
const bundled=()=>runtimePath(process.resourcesPath,path.join(__dirname,'..','..'),app.isPackaged);
function send(event,data){if(win&&!win.isDestroyed())win.webContents.send(event,data);}
function status(phase,text,percent=0){state={phase,text,percent:Number.isFinite(percent)?Math.min(100,Math.max(0,percent)):0};send('state',state);}
function cleanLog(text){let clean=market?.redact(redact(text))||redact(text);for(const a of [...(accounts?.accounts||[]),externalSession].filter(Boolean))for(const key of ['accessToken','refreshToken','clientToken'])if(a.tokens?.[key])clean=clean.replaceAll(a.tokens[key],'[redacted]');return clean;}
function log(text){gameVisibility?.output(text);const line='['+new Date().toLocaleTimeString('zh-CN')+'] '+cleanLog(text);sessionLogs?.append(line+'\n');logs.push(line.slice(-65536));if(logs.length>1000)logs.shift();send('log',line.slice(-65536));}
async function persist(){await writeJSON(path.join(home(),'settings.json'),settings);}
async function local(){
  const items=await scan(settings.root);
  for(const item of items){
    const detected=inferredMode(settings.importedIsolation,settings.root,item.id);
    item.isolated=effectiveIsolation(item.forcedIsolation,item.configuredIsolation,detected,settings.isolate);
  }
  return items;
}
function requireIdle(){if(busy||loginController||externalBusy)throw Error('请等待当前任务或账号登录结束后再修改设置或账号');}
function scanRuntimes(){if(!javaScan)javaScan=scanJava({bundled:bundled(),selected:settings.java,root:settings.root,extraRoots:settings.javaRoots||[]}).then(items=>{javaItems=items;send('java-list',items);return items;}).finally(()=>{javaScan=null;});return javaScan;}
async function accountView(){if(!accountError)accounts.syncShared();const data=accounts.public();for(const a of data.accounts){if(a.type==='authlib'){const key=settings.root+'\0'+a.id,cached=appearanceResults.get(key)||await require('../shared/appearance.cjs').cachedAppearance(settings.root,a);if(cached){a.preview=cached.skin;a.appearance={model:cached.model,default:cached.default,cape:!!cached.cape,warning:cached.warning||''};}a.appearancePending=appearanceSync.has(key);}else if(a.skin)a.preview=await previewSkin(settings.root,a.skin);}return data;}
async function changedAccounts(){const data=await accountView();send('accounts-changed',data);return data;}
function queueAccountAppearance(account,force=false){
  if(account?.type!=='authlib')return Promise.resolve();
  const root=settings.root,key=root+'\0'+account.id;if(appearanceSync.has(key)){const current=appearanceSync.get(key);if(force&&!current.force){current.force=true;current.promise=current.promise.then(()=>queueAccountAppearance(account,true));}return current.promise;}
  const controller=new AbortController();
  const promise=(async()=>{try{const value=await require('../shared/appearance.cjs').appearance(root,account,fetcher,{force,signal:controller.signal});if(!controller.signal.aborted&&accounts.accounts.some(a=>a.id===account.id)){appearanceResults.set(key,value);while(appearanceResults.size>128)appearanceResults.delete(appearanceResults.keys().next().value);}return value;}catch(error){if(!controller.signal.aborted)log('角色外观读取失败：'+error.message);}finally{appearanceSync.delete(key);if(settings.root===root&&accounts.accounts.some(a=>a.id===account.id))await changedAccounts();}})();
  appearanceSync.set(key,{promise,controller,force});return promise;
}
function stopSkin(){skinServer?.close();skinServer=null;}
function engine(extra={}){return new Game({...settings,toolsDir:path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'..','..'),'tools'),java:settings.java||bundled(),version:settings.selected,onLog:log,fetcher,getManifest:()=>catalog.refresh(false),...extra});}
const agentFile=()=>path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'..','..'),'tools','authlib-injector-1.2.8.jar');
async function discardExternal(){clearTimeout(externalTimer);const old=externalSession;externalSession=null;if(old)await externalAuth.invalidate(old).catch(()=>{});}
const runJob=async(fn,title)=>{requireIdle();busy=true;controller=new AbortController();status('preparing',title);try{const result=await fn(controller.signal);status('idle','准备就绪');return result;}catch(e){log(e.message);status('error',e.message);throw e;}finally{busy=false;controller=null;}};
registerInstances({ipcMain,dialog,shell,persist,window:()=>win,settings:()=>settings,idle:requireIdle,job:runJob,changed:async()=>send('instances-changed',await local())});
registerOfflinePacks({ipcMain,dialog,window:()=>win,settings:()=>settings,job:runJob,progress:(text,percent)=>status('downloading',text,percent),chooseJava:async(id,required,options)=>resolveJavaSelection({root:settings.root,id,settings:options,required,items:scanRuntimes}),changed:async id=>{settings.selected=id;await persist();send('instances-changed',await local());send('market-changed',{selected:id});}});
const {createAssistant,scrub}=require('../shared/ai-assistant.cjs');
const assistant=createAssistant({
  shared:sharedLogins,fetcher,online:()=>net.isOnline(),
  context:async analyze=>{
    const data={version:settings.selected,memoryGB:settings.memory,javaMode:settings.javaMode,phase:state.phase};
    if(analyze){
      const clean=value=>scrub(cleanLog(String(value)));
      data.log=logs.slice(-100).map(line=>clean(line.slice(-1400))).join('\n').slice(-12000);
      if(lastCrash)data.crash={version:clean(lastCrash.version||''),exitCode:lastCrash.exitCode,findings:(lastCrash.findings||[]).slice(0,6).map(f=>clean([f.title,f.evidence,f.suggestion].filter(Boolean).join(' · ')).slice(0,700))};
    }
    return data;
  }
});
let latestDiagnosis=null, diagnosisGeneration=0;
const diagnosisFile=root=>path.join(root,'.starquill','ai-diagnosis.json');
async function getDiagnosis(){
  if(latestDiagnosis?.root===settings.root)return latestDiagnosis.result;
  try{return JSON.parse(await fs.readFile(diagnosisFile(settings.root),'utf8'));}catch{return null;}
}
async function analyzeFailure(crash,report,reason){
  const token=++diagnosisGeneration,root=crash.root;
  const recent=crash.logs.text().slice(-14000);
  const config=await assistant.config();
  if(!config.base||!config.autoAnalyze||token!==diagnosisGeneration)return;
  const result={id:report?.id||crypto.randomUUID(),version:crash.version,time:new Date().toISOString(),pending:true,text:''};
  function publish(){
    if(token!==diagnosisGeneration||root!==settings.root)return;
    latestDiagnosis={root,result};send('ai-diagnosis',result);
  }
  publish();
  try{
    const clean=value=>scrub(cleanLog(String(value)));
    const snapshot={version:crash.version,java:crash.java,memoryGB:crash.memory,exitCode:report?.exitCode,reason:clean(reason),log:clean(recent).slice(-12000),
      findings:(report?.findings||[]).slice(0,6).map(f=>clean([f.title,f.evidence,f.suggestion].join(' · ')).slice(0,800))};
    result.text=(await assistant.ask({mode:'analyze'},snapshot)).text;
  }catch(error){result.text=error.message;}
  result.pending=false;
  if(token!==diagnosisGeneration)return;
  await writeJSON(diagnosisFile(root),result);publish();
}
ipcMain.handle('ai-diagnosis-latest',getDiagnosis);
ipcMain.handle('ai-config',()=>assistant.config());
ipcMain.handle('ai-save',(_,input)=>assistant.save(input));
ipcMain.handle('ai-clear',()=>assistant.clear());
ipcMain.handle('ai-ask',(_,input)=>assistant.ask(input));
function selectInstallerJava(required){
  // A new instance has no runtime directory until it has been installed.
  const policy=settings.javaMode==='folder'?{...settings,javaMode:'auto'}:settings;
  return resolveJavaSelection({settings:policy,required,items:scanRuntimes});
}
market=registerMarket({ipcMain,dialog,shell,fetcher,log,window:()=>win,settings:()=>settings,idle:requireIdle,getManifest:()=>catalog.refresh(false),progress:(text,percent=0)=>status('downloading',text,percent),chooseJava:selectInstallerJava,changed:async id=>{if(id){settings.selected=id;await persist();}send('instances-changed',await local());send('market-changed',{selected:id});},job:runJob});
require('node:fs').mkdirSync(home(),{recursive:true});app.setPath('userData',home());
// Two copies would overwrite settings.json, accounts.json and the window state.
if(!app.requestSingleInstanceLock()){app.quit();return;}
app.on('second-instance',()=>{if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();});
app.whenReady().then(async()=>{
  await fs.mkdir(home(),{recursive:true});let newProfile=true;settings=defaults();try{const saved=JSON.parse(await fs.readFile(path.join(home(),'settings.json'),'utf8'));settings={...settings,...saved,javaMode:saved.javaMode||(saved.java?'manual':'auto')};newProfile=false;}catch{}
  try { settings.windows=windowSettings(settings.windows); } catch { settings.windows=windowSettings(); }
  // Microsoft sign-in stays unconnected: drop any identifier retired from older builds.
  const savedClientId=settings.microsoftClientId;
  settings.microsoftClientId=resolveClientId(savedClientId);
  if(savedClientId!==settings.microsoftClientId)await persist().catch(()=>{});
  settings.javaMajor=validMajor(settings.javaMajor)?settings.javaMajor:21;
  settings.memory=Math.min(memoryLimit(),Math.max(1,Math.floor(Number(settings.memory)||4)));
  const adjacentRoot=path.join(portable(),'.minecraft');
  // Previous profiles stored even the portable default as an absolute path. Only
  // persist an external root as a choice after the user explicitly saves it.
  const customRoot=settings.customRoot;
  settings.root=adjacentRoot;
  if(typeof customRoot==='string'&&path.isAbsolute(customRoot)){
    try {
      if(!(await fs.stat(customRoot)).isDirectory())throw Error('目录无效');
      settings.root=customRoot;
    } catch { log('上次选择的游戏目录当前不可用，已打开启动器旁的 .minecraft'); }
  }
  await fs.mkdir(settings.root,{recursive:true});
  if(newProfile){
    const existing=await scan(settings.root);
    if(existing.some(v=>v.ready)){
      settings.importedIsolation=await detectIsolation(settings.root,existing);
      await persist();
    }
  }
  settings.optimizeMemory=settings.memoryOptimizationVersion===1&&settings.optimizeMemory===true;
  lastCrash=await latestCrash(settings.root);
  catalog=new ManifestCatalog({root:settings.root,mode:settings.source,fetcher,onUpdate:data=>send('versions-changed',data)});
  accounts=new AccountStore(path.join(home(),'accounts.json'),safeStorage);try{accounts.shared=sharedLogins();await accounts.load();}catch(e){accountError=e.message;}
  try{const receipt=JSON.parse(await fs.readFile(path.join(home(),'welcome.json'),'utf8'));welcomeNeeded=receipt.completedOn===os.hostname()?false:safeStorage.decryptString(Buffer.from(receipt.receipt,'base64'))!==('starquill-welcome-v1:'+os.hostname());}catch{welcomeNeeded=true;}
  if(accounts.accounts.some(a=>a.type==='authlib'))welcomeNeeded=false;
  // Match the supplied HMCL window's saved logical size, independent of DPI.
  const positionFile=path.join(home(),'window-position.json');
  let saved;
  try {saved=JSON.parse(await fs.readFile(positionFile,'utf8'));} catch {}
  function restored(point){
    const display=screen.getAllDisplays().find(d=>d.id===point?.displayId && Number.isInteger(point.x) && Number.isInteger(point.y) && point.x>=d.workArea.x && point.x<d.workArea.x+d.workArea.width && point.y>=d.workArea.y && point.y<d.workArea.y+d.workArea.height);
    return launcherBounds(settings.windows,(display||screen.getPrimaryDisplay()).workArea,display?point:{});
  }
  win=new BrowserWindow({show:false,...restored(saved),resizable:false,maximizable:false,fullscreenable:false,frame:false,backgroundColor:'#f3eee7',title:'NHMCL-StarQuill · 星翎启动器',icon:path.join(__dirname,'..','assets','icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  function fitContent(){
    const [width,height]=win.getContentSize();
    win.webContents.setZoomFactor(Math.min(1,width/720,height/460));
  }
  function refit(){
    if(win.isDestroyed())return;
    const bounds=win.getBounds();
    win.setBounds(restored({...bounds,displayId:screen.getDisplayMatching(bounds).id}));
    fitContent();
  }
  screen.on('display-removed',refit);screen.on('display-metrics-changed',refit);
  win.once('closed',()=>{screen.removeListener('display-removed',refit);screen.removeListener('display-metrics-changed',refit);});
  win.on('close',()=>{if(win.isMinimized())return;const bounds=win.getBounds();try{require('node:fs').writeFileSync(positionFile,JSON.stringify({x:bounds.x,y:bounds.y,displayId:screen.getDisplayMatching(bounds).id}));}catch{}});
  win.on('resize',fitContent);
  win.webContents.on('dom-ready',fitContent);
  gameVisibility=require('../shared/game-window-visibility.cjs').gameWindowVisibility(win,()=>require('electron').nativeTheme.prefersReducedMotion,path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'..','..'),'tools',process.platform==='win32'?'game-window-ready.exe':process.platform==='linux'?'game-window-ready.sh':null));
  win.once('closed',()=>gameVisibility.stop());
  win.removeMenu();
  win.on('app-command',(event,command)=>{if(command==='browser-backward'){event.preventDefault();send('navigate-back');}});
  fitContent();
  win.webContents.setVisualZoomLevelLimits(1,1).catch(()=>{});
  win.webContents.on('zoom-changed',fitContent);
  win.webContents.on('before-input-event',(event,input)=>{if(input.key==='F11'||((input.control||input.meta)&&['+','-','=','0','Add','Subtract'].includes(input.key)))event.preventDefault();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  win.on('close',e=>{if(busy&&!closing){e.preventDefault();dialog.showMessageBox(win,{type:'question',message:'当前任务尚未结束，是否关闭？',detail:'下载将保留已完成文件与续传数据；运行中的游戏将结束。',buttons:['继续运行','关闭并结束任务'],defaultId:0,cancelId:0}).then(({response})=>{if(response===1){closing=true;controller?.abort();child?.kill();app.quit();}});}});
  let observedDataVersion=loginDatabase?.version();
  win.on('focus',()=>{
    if(settings&&!busy)local().then(items=>send('instances-changed',items)).catch(()=>{});
    if(!loginDatabase)return;
    try{const version=loginDatabase.version();if(version!==observedDataVersion){observedDataVersion=version;changedAccounts().catch(e=>log(e.message));send('login-cache-changed');}}
    catch(e){log(e.message);}
  });
  win.webContents.setBackgroundThrottling(false);
  await win.loadFile(path.join(__dirname,'..','index.html'));
  // Reveal only after the new shell and local bootstrap have finished.
  // Allow the hidden compositor to replace its initial frame before showing.
  await win.webContents.executeJavaScript('Promise.resolve(window.starquillReady).then(() => Promise.race([document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))),new Promise(resolve => setTimeout(resolve,450))]))');
  if(!win.isDestroyed()){win.show();win.webContents.setBackgroundThrottling(true);}
  setImmediate(()=>{
    for(const account of accounts.accounts)queueAccountAppearance(account).catch(()=>{});
    scanRuntimes().catch(e=>log(e.message));
  });
});
app.on('before-quit',()=>{closing=true;gameVisibility?.stop();loginController?.abort();externalController?.abort();clearTimeout(externalTimer);controller?.abort();for(const job of appearanceSync.values())job.controller.abort();stopSkin();});
app.on('window-all-closed',()=>app.quit());
ipcMain.handle('boot',async()=>({settings:publicSettings(),welcomeNeeded,instances:await local(),accounts:await accountView(),accountError,javaItems,skinServers:PRESETS,totalMemory:memoryLimit(),physicalMemory:(os.totalmem()/1024**3).toFixed(1),state,version:require('../../package.json').displayVersion||app.getVersion()}));
ipcMain.handle('versions',async(_,force=false)=>catalog.refresh(force===true));
ipcMain.handle('instances',()=>local());
ipcMain.handle('window-control',(event,command)=>{if(event.sender!==win?.webContents||!['minimize','close'].includes(command))return false;if(command==='minimize')win.minimize();else win.close();return true;});
ipcMain.handle('install-vanilla',async(_,id)=>runJob(async signal=>{const manifest=await catalog.refresh(false);if(!manifest.versions.some(v=>v.id===id))throw Error('请选择官方游戏版本');const game=engine({version:id,signal,onProgress:p=>status('downloading','安装 Minecraft '+id,p.total?p.done/p.total*100:0)});await game.prepare();await markStandalone(settings.root,id);settings.selected=id;await persist();send('instances-changed',await local());send('market-changed',{selected:id});return id;},'安装 Minecraft 原版'));
ipcMain.handle('system-memory',()=>memorySnapshot());
ipcMain.handle('crash-latest',()=>lastCrash);
ipcMain.handle('crash-folder',async()=>{if(!lastCrash)throw Error('还没有自动导出的崩溃报告');await fs.access(lastCrash.file);shell.showItemInFolder(lastCrash.file);return true;});
ipcMain.handle('settings',async(_,o)=>{requireIdle();validate({version:o.selected||'1.21.1',name:settingsAccount().name,accountType:settingsAccount().type,memory:o.memory});
  if(typeof o.java!=='string'||o.java.length>1024)throw Error('Java 路径无效');
  if(typeof o.root!=='string'||!path.isAbsolute(o.root))throw Error('请选择有效的 .minecraft 根目录');
  if(!['auto','bmclapi','official'].includes(o.source))throw Error('下载源无效');
  if(!Number.isInteger(o.concurrency)||o.concurrency<1||o.concurrency>32)throw Error('下载并发须为 1–32');
  const windows=windowSettings(o.windows ?? settings.windows);
  const javaSelection=validateJavaSelection(o);
  if(o.microsoftClientId&&!validClient(o.microsoftClientId))throw Error('Client ID 应为应用注册提供的 UUID，不是密钥');
  const launchAdvanced=advanced.effective(o.advanced===undefined?settings.advanced:o.advanced);
  await fs.mkdir(o.root,{recursive:true});await fs.access(o.root,require('node:fs').constants.W_OK);
  const rootChanged=!samePath(o.root,settings.root);
  const importedIsolation=samePath(pendingIsolation?.root,o.root)?pendingIsolation:rootChanged?await detectIsolation(o.root):settings.importedIsolation;
  settings.customRoot=path.relative(path.join(portable(),'.minecraft'),path.resolve(o.root))?path.resolve(o.root):null;
  settings={...settings,hideOnGameStart:o.hideOnGameStart===undefined?settings.hideOnGameStart:o.hideOnGameStart===true,windows,importedIsolation,advanced:launchAdvanced,name:settingsAccount().name,memory:o.memory,optimizeMemory:o.optimizeMemory===undefined?settings.optimizeMemory:o.optimizeMemory===true,memoryOptimizationVersion:1,java:o.java,javaMode:javaSelection.javaMode,javaMajor:javaSelection.javaMajor,microsoftClientId:resolveClientId(o.microsoftClientId),selected:o.selected,snapshots:!!o.snapshots,root:path.resolve(o.root),isolate:o.isolate!==false,source:o.source,concurrency:o.concurrency};await persist();
  const previous=win.getBounds(), area=screen.getDisplayMatching(previous).workArea;
  const bounds=launcherBounds(windows,area,previous);
  if(previous.width!==bounds.width||previous.height!==bounds.height) win.setBounds(bounds);
  pendingIsolation=null;catalog.mode=settings.source;catalog.root=settings.root;catalog.file=path.join(settings.root,'.starquill','catalog-cache.json');if(rootChanged){latestDiagnosis=null;diagnosisGeneration++;send('ai-diagnosis',await getDiagnosis());lastCrash=await latestCrash(settings.root);send('crash-report',lastCrash);}await changedAccounts();return {settings:publicSettings(),instances:await local()};
});
ipcMain.handle('login-cache-import',async()=>{
  requireIdle();
  const picked=await dialog.showOpenDialog(win,{properties:['openDirectory'],defaultPath:home(),title:'选择旧版 .starquill-profile 文件夹'});
  if(picked.canceled)return null;
  requireIdle();
  const result=await require('../shared/legacy-connections.cjs').importConnections(picked.filePaths[0],sharedLogins(),safeStorage,keyHelper());
  await changedAccounts();return result;
});
ipcMain.handle('login-cache-clear',async()=>{
  requireIdle();
  const {response}=await dialog.showMessageBox(win,{type:'question',title:'删除本机连接缓存',message:'删除此系统用户保存的 AI 连接和全部皮肤站登录？',detail:'同一系统用户下的所有启动器副本均会生效。游戏、存档和离线账号会保留。',buttons:['取消','删除缓存'],defaultId:0,cancelId:0});
  if(response!==1)return false;
  requireIdle();sharedLogins().clear();
  for(const job of appearanceSync.values())job.controller.abort();appearanceResults.clear();
  if(accountError){accounts.shared=sharedLogins();await accounts.load();accountError='';}else accounts.syncShared();
  await changedAccounts();return true;
});
ipcMain.handle('select-root',async()=>{requireIdle();const r=await dialog.showOpenDialog(win,{title:'选择已有 .minecraft 或启动器所在文件夹',defaultPath:settings.root,properties:['openDirectory','createDirectory']});if(r.canceled)return null;let root=r.filePaths[0];try{if((await fs.stat(path.join(root,'.minecraft'))).isDirectory())root=path.join(root,'.minecraft');}catch{}const instances=await scan(root);pendingIsolation=await detectIsolation(root,instances);return {root,instances,counts:pendingIsolation.counts};});
ipcMain.handle('migrate',async()=>{requireIdle();const r=await dialog.showOpenDialog(win,{title:'选择旧 Aster 的 instances 文件夹（复制导入，不删除原数据）',defaultPath:path.join(app.getPath('appData'),'aster-launcher','instances'),properties:['openDirectory']});if(r.canceled)return null;
  busy=true;status('preparing','正在复制旧版数据');try{const result=await migrateLegacy(r.filePaths[0],settings.root,text=>status('preparing',text));log(`迁移完成：${result.versions} 个版本，复制 ${result.copied} 个文件，跳过已有 ${result.skipped} 个文件`);if(result.conflicts.length)log('同名版本配置不同，未覆盖：'+result.conflicts.join('、'));send('instances-changed',await local());status('idle','迁移完成');return result;}catch(e){status('error',e.message);throw e;}finally{busy=false;}
});
ipcMain.handle('java',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择 Java 可执行文件',properties:['openFile'],...(process.platform==='win32'?{filters:[{name:'Java',extensions:['exe']}]}:{})});return r.canceled?null:inspectJava(r.filePaths[0]);});
ipcMain.handle('scan-java',()=>scanRuntimes());
ipcMain.handle('scan-java-folder',async()=>{requireIdle();const r=await dialog.showOpenDialog(win,{title:'选择 Java 所在文件夹（扫描最多 5 层子目录）',properties:['openDirectory']});if(r.canceled)return null;settings.javaRoots=[...new Set([...(settings.javaRoots||[]),r.filePaths[0]])].slice(-20);await persist();if(javaScan)await javaScan;return scanRuntimes();});
ipcMain.handle('welcome-complete',async(_,input)=>{requireIdle();if(!['offline','skip','skin'].includes(input?.mode))throw Error('请选择进入方式');if(input.mode==='offline')await accounts.addOffline(input.name);if(safeStorage.isEncryptionAvailable())await writeJSON(path.join(home(),'welcome.json'),{receipt:safeStorage.encryptString('starquill-welcome-v1:'+os.hostname()).toString('base64')});else await writeJSON(path.join(home(),'welcome.json'),{completedOn:os.hostname()});welcomeNeeded=false;return changedAccounts();});
ipcMain.handle('account-add',async(_,name)=>{requireIdle();await accounts.addOffline(name);return changedAccounts();});
ipcMain.handle('account-select',async(_,id)=>{requireIdle();await accounts.select(id);queueAccountAppearance(accounts.current()).catch(()=>{});return changedAccounts();});
ipcMain.handle('account-remove',async(_,id)=>{requireIdle();if(accounts.accounts.length<=1)throw Error('请至少保留一个账号');const account=accounts.accounts.find(a=>a.id===id);externalBusy=true;try{if(account?.type==='authlib')await externalAuth.invalidate(account).catch(()=>log('皮肤站暂不可用：已移除本地登录，远端会话撤销未确认'));await accounts.remove(id);return changedAccounts();}finally{externalBusy=false;}});
const creditEntries=require('../assets/credits/entries.json');
ipcMain.handle('credits-list',()=>{
  const {displayVersion,releaseName}=require('../../package.json');
  // The About card uses the full release name (stable-1.0.4); the sidebar keeps the short one (v1.0.4).
  return creditEntries.map(entry=>entry.id==='nhmcl'?{...entry,desc:'当前版本：'+(releaseName||displayVersion)}:entry);
});
ipcMain.handle('launcher-update-check',()=>require('../shared/launcher-updates.cjs').checkRelease(fetcher,require('../../package.json').version));
ipcMain.handle('launcher-release-open',(_,tag)=>{
  if(typeof tag==='string'&&/^[a-z0-9.-]{1,80}$/i.test(tag))return shell.openExternal('https://github.com/z12244/NHMCL-StarQuill/releases/tag/'+encodeURIComponent(tag));
});
ipcMain.handle('open-feedback',()=>shell.openExternal('https://github.com/z12244/NHMCL-StarQuill/issues/new/choose'));
ipcMain.handle('credit-open',(_,id)=>{
  const entry=creditEntries.find(item=>item.id===id);
  if(entry?.url)return shell.openExternal(entry.url);
});
function offlineSkinTarget(input){
  const account=input?.id===undefined?accounts.current():accounts.accounts.find(a=>a.id===input.id);
  if(account?.type!=='offline')throw Error('请选择离线账号');
  if(!['default','slim'].includes(input?.model))throw Error('请选择普通或纤细手臂');
  return account;
}
ipcMain.handle('account-skin-model',async(_,input)=>{
  requireIdle();const account=offlineSkinTarget(input),model=input.model;
  busy=true;
  try{
    let skin=account.skin;
    if(skin){
      const bytes=await require('../shared/skins.cjs').readSkin(settings.root,skin);
      if(model==='slim'&&bytes.readUInt32BE(20)!==64)throw Error('纤细手臂需要 64×64 皮肤');
      skin={...skin,model};
    }else{
      skin=await importSkin(settings.root,path.join(__dirname,'..','assets',model==='slim'?'alex.png':'steve.png'),model);
    }
    await accounts.put({...account,skin});return changedAccounts();
  }finally{busy=false;}
});
ipcMain.handle('account-skin-import',async(_,input)=>{requireIdle();const account=offlineSkinTarget(input),model=input.model;busy=true;try{const result=await dialog.showOpenDialog(win,{title:'选择离线角色的 PNG 皮肤',properties:['openFile'],filters:[{name:'Minecraft PNG 皮肤',extensions:['png']}]});if(result.canceled||!result.filePaths[0])return null;const skin=await importSkin(settings.root,result.filePaths[0],model,bytes=>{const image=require('electron').nativeImage.createFromBuffer(bytes),size=image.getSize();if(image.isEmpty()||size.width!==64||![32,64].includes(size.height))throw Error('无法读取这张 PNG 皮肤，请选择完整的 64×64 或 64×32 图片');return image.toPNG();});await accounts.put({...account,skin});return changedAccounts();}finally{busy=false;}});
ipcMain.handle('auth-config-save',async(_,value)=>{requireIdle();if(typeof value!=='string')throw Error('应用编号格式无效');const id=value.trim();if(id&&!validClient(id))throw Error('请填写 Application (client) ID，不是租户 ID、对象 ID 或密钥');settings.microsoftClientId=resolveClientId(id);await persist();return {clientId:settings.microsoftClientId};});
ipcMain.handle('auth-config-check',()=>({clientId:settings.microsoftClientId||'',validClient:validClient(settings.microsoftClientId),secureStorage:safeStorage.isEncryptionAvailable(),remoteVerified:false}));
ipcMain.handle('auth-setup-link',(_,kind)=>{const urls={register:'https://entra.microsoft.com/',review:'https://aka.ms/mce-reviewappid',docs:'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code'};if(!Object.hasOwn(urls,kind))throw Error('未知设置入口');return shell.openExternal(urls[kind]);});
ipcMain.handle('login-start',async()=>{requireIdle();if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，无法保存微软登录');
  const controller=new AbortController();loginController=controller;
  try{lastAuthFailure=null;const device=await auth.begin(settings.microsoftClientId,controller.signal);const presentation=await deviceLogin.start(device);if(controller.signal.aborted)throw Error('登录已取消');
    (async()=>{let result;try{const account=await auth.poll(device,controller.signal);if(controller.signal.aborted)throw Error('登录已取消');await accounts.put(account,true);await changedAccounts();result={phase:'success',text:'微软正版账号已登录'};}catch(e){result={phase:'error',text:e.message,diagnostic:authFailureDetails(e)};}finally{if(loginController===controller){loginController=null;deviceLogin.clear();}}send('login-state',result);})();
    return presentation;
  }catch(e){authFailureDetails(e);loginController=null;deviceLogin.clear();throw e;}
});
ipcMain.handle('auth-diagnostic',()=>lastAuthFailure);
ipcMain.handle('auth-diagnostic-export',async()=>{if(!lastAuthFailure)throw Error('当前没有可导出的微软登录诊断');const report={...lastAuthFailure};const result=await dialog.showSaveDialog(win,{title:'导出微软登录诊断（不含账号令牌）',defaultPath:'NHMCL-StarQuill-microsoft-diagnostic.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return false;await writeJSON(result.filePath,report);return true;});
ipcMain.handle('login-cancel',()=>{loginController?.abort();deviceLogin.clear();return true;});
ipcMain.handle('login-copy',()=>deviceLogin.copy());
ipcMain.handle('login-browser',()=>deviceLogin.open());
ipcMain.handle('authlib-discover',async(_,url)=>{requireIdle();externalBusy=true;externalController=new AbortController();try{await discardExternal();externalServer=null;const server=await externalAuth.discover(url,externalController.signal);externalServer={...server,ticket:crypto.randomUUID(),expiresAt:Date.now()+10*60*1000};return {ticket:externalServer.ticket,url:server.url,name:server.name};}finally{externalBusy=false;externalController=null;}});
ipcMain.handle('authlib-login',async(_,input)=>{requireIdle();if(!sharedLogins().storage.isEncryptionAvailable())throw Error('系统安全存储不可用，无法保存皮肤站会话');if(!externalServer||input?.ticket!==externalServer.ticket||Date.now()>externalServer.expiresAt)throw Error('请先重新识别并核对皮肤站地址');externalBusy=true;externalController=new AbortController();
  try{await discardExternal();let session;try{session=await externalAuth.authenticate(externalServer,input.username,input.password,externalController.signal);}finally{input.password='';}
    if(externalController.signal.aborted){await externalAuth.invalidate(session).catch(()=>{});throw Error('皮肤站登录已取消');}
    externalSession={...session,id:crypto.randomUUID(),expiresAt:Date.now()+5*60*1000};externalTimer=setTimeout(()=>{discardExternal().finally(()=>send('authlib-state',{phase:'expired',text:'角色选择已过期，请重新登录皮肤站'}));},5*60*1000);
    if(session.profiles.length===1){const account=await externalAuth.bind(session,session.profiles[0].id,externalController.signal);if(externalController.signal.aborted){await externalAuth.invalidate(account).catch(()=>{});throw Error('皮肤站登录已取消');}await accounts.put(account,true);queueAccountAppearance(account,true).catch(()=>{});clearTimeout(externalTimer);externalSession=null;return {accounts:await changedAccounts()};}
    return {sessionId:externalSession.id,profiles:session.profiles};
  }finally{externalBusy=false;externalController=null;}
});
ipcMain.handle('authlib-profile',async(_,input)=>{requireIdle();if(!externalSession||input?.sessionId!==externalSession.id||Date.now()>externalSession.expiresAt)throw Error('角色选择已过期，请重新登录');externalBusy=true;externalController=new AbortController();try{const account=await externalAuth.bind(externalSession,input.profileId,externalController.signal);if(externalController.signal.aborted){await externalAuth.invalidate(account).catch(()=>{});throw Error('皮肤站登录已取消');}await accounts.put(account,true);queueAccountAppearance(account,true).catch(()=>{});clearTimeout(externalTimer);externalSession=null;return changedAccounts();}finally{externalBusy=false;externalController=null;}});
ipcMain.handle('authlib-cancel',async()=>{externalController?.abort();externalServer=null;await discardExternal();return true;});
ipcMain.handle('folder',async(_,id)=>{const p=id?(await targetInfo(settings.root,id,settings)).folder:settings.root;await fs.mkdir(p,{recursive:true});const error=await shell.openPath(p);if(error)throw Error(error);});
ipcMain.handle('export-log',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'NHMCL-StarQuill-log.txt',filters:[{name:'文本日志',extensions:['txt']}]});if(r.canceled)return false;await fs.writeFile(r.filePath,logs.join('\r\n'));return true;});
ipcMain.handle('stop',()=>{if(child){gameStopRequested=true;child.kill();return true;}if(controller){controller.abort();return true;}return false;});
ipcMain.handle('launch',async()=>{requireIdle();if(accountError)throw Error(accountError);accounts.syncShared();validate({version:settings.selected,...settings,name:accounts.current().name,accountType:accounts.current().type});busy=true;controller=new AbortController();status('preparing','检查本地版本与 Java');
  sessionLogs=logBuffer(32*1024*1024);const crash={root:settings.root,version:settings.selected,logs:sessionLogs};
  const game=engine({display:gameWindow(settings.windows,launcherBounds(settings.windows,screen.getDisplayMatching(win.getBounds()).workArea)),signal:controller.signal,onProgress:p=>{const mb=(p.speed/1024**2).toFixed(1);status('downloading',`文件 ${p.done}/${p.total} · 已复用 ${p.reused} · 下载 ${p.downloaded} · ${mb} MB/s`,p.total?p.done/p.total*100:0);}});
  try{log('游戏根目录：'+settings.root);log('版本隔离：'+(settings.isolate?'开启':'关闭')+' · 下载源：'+settings.source);
    const resolved=await game.resolve(),required=javaRequirement(resolved.meta);
    const launchSettings=await instanceOptions(settings.root,settings.selected,settings,resolved.raw);Object.assign(game.options,launchSettings,{version:settings.selected});
    const java=await resolveJavaSelection({root:settings.root,id:settings.selected,settings:launchSettings,required,items:scanRuntimes});
    log('版本独立设置：'+launchSettings.memory+' GB · '+(launchSettings.isolate?'隔离目录':'共享目录'));
    game.options.java=java.path;game.options.javaMajor=java.major;log(`${({auto:'自动选择',major:'按主版本选择',folder:'使用版本内',manual:'手动指定'})[launchSettings.javaMode]||'自动选择'} Java ${java.version} (${java.bits} 位)：${java.path}`);
    let account=accounts.current();if(account.type==='microsoft'){status('preparing','验证微软正版账号');account=await auth.refresh(account,controller.signal,a=>accounts.put(a));await accounts.put(account);await changedAccounts();}
    if(account.type==='authlib'){status('preparing','验证皮肤站账号');account=await externalAuth.refresh(account,controller.signal);await accounts.put(account);queueAccountAppearance(account).catch(()=>{});await changedAccounts();game.options.extraJvmArgs=await externalAuth.launchArgs(account,agentFile(),controller.signal);log('外置登录：'+account.server.name+' · 角色 '+account.name);}
    game.options.name=account.name;game.options.account=account;
    if(account.type==='offline'&&account.skin){skinServer=await startSkinServer(settings.root,account,agentFile(),log);game.options.extraJvmArgs=skinServer.jvmArgs;log('使用离线皮肤：'+account.skin.sourceName+' · 玩家 UUID 保持不变');}
    game.options.onSpawn=pid=>{crash.pid=pid;log('游戏 Java PID：'+pid);};
    game.options.beforeSpawn=async prepared=>{
      if(launchSettings.optimizeMemory){
        status('preparing','正在回收启动器闲置内存…');
        try {
          const result=await optimizeMemory(win?.webContents,controller.signal);
          const before=(result.heapBefore/1024**2).toFixed(1),after=(result.heapAfter/1024**2).toFixed(1);
          log('启动前内存优化：启动器主进程 JS 堆 '+before+' → '+after+' MiB，'+(result.pageCacheCleared?'已清理页面闲置缓存':'页面缓存未清理'));
        } catch(error) {
          if(controller.signal.aborted)throw error;
          log('内存优化未完成，继续启动游戏：'+error.message);
        }
      }
      crash.gameDir=prepared.cwd;crash.memory=launchSettings.memory;crash.java=`Java ${java.version} (${java.bits} 位)`;crash.startedAt=Date.now();crash.environment={os:os.release(),arch:os.arch(),javaPath:java.path,memory:memorySnapshot(),mainClass:resolved.meta.mainClass,gameVersion:resolved.meta.id};
      try{crash.baseline=await crashBaseline(crash.root,crash.gameDir);}catch(e){crash.baseline=new Map();log('崩溃文件基线读取失败：'+e.message);}
      log('启动时系统可用内存：'+(memorySnapshot().available/1024**3).toFixed(1)+' GB');
    };
    gameStopRequested=false;child=await game.launch();controller=null;status('running','游戏正在运行',100);
    gameVisibility.started(settings.hideOnGameStart!==false,child.pid);
    let processError='';child.once('error',e=>{processError=e.message;log(e.message);});
    child.once('close',(code,signal)=>{
      if(!closing)gameVisibility.ended();
      const manual=gameStopRequested||closing;stopSkin();child=null;controller=null;gameStopRequested=false;
      (async()=>{
        log(manual?'用户结束游戏':`游戏退出，代码 ${code}，信号 ${signal||'无'}`);
        let fatal=[];if(!manual)try{fatal=await freshFatalFiles(crash);if(code!==0){status('diagnosing','等待崩溃日志写入…');await new Promise(resolve=>setTimeout(resolve,1500));fatal=await freshFatalFiles(crash);}} catch(e){log('读取崩溃文件失败：'+e.message);}
        if(unexpectedExit(code,signal,manual,fatal.length,processError)){
          let currentReport;
          status('diagnosing','游戏意外退出，正在导出日志并分析…');
          try{currentReport=lastCrash=await exportCrash(crash,{code,signal,error:processError,fatal},cleanLog);send('crash-report',lastCrash);log('崩溃日志已自动导出：'+lastCrash.file);status('error','游戏意外退出 · 日志与初步分析已保存');}
          catch(e){log('自动导出崩溃日志失败：'+e.message);send('crash-export-error','日志自动导出失败：'+e.message+'。可到运行日志手动导出。');status('error','游戏意外退出 · 自动导出失败，可手动导出日志');}
          analyzeFailure(crash,currentReport,processError||('进程退出 '+code)).catch(e=>log('AI 分析失败：'+e.message));
        }else status('idle',manual?'游戏已结束':'游戏已退出');
      })().catch(e=>{log(e.message);status('error','退出处理失败：'+e.message);}).finally(()=>{busy=false;sessionLogs=null;send('state',state);local().then(items=>send('instances-changed',items)).catch(e=>log(e.message));});
    });return true;
  }catch(e){const canceled=controller?.signal.aborted;stopSkin();busy=false;child=null;controller=null;sessionLogs=null;status('error',e.message);log(e.message);if(!canceled&&!closing)analyzeFailure(crash,null,e.message).catch(err=>log('AI 分析失败：'+err.message));local().then(items=>send('instances-changed',items)).catch(()=>{});throw e;}
});

const loadResourceIcon=require('../shared/resource-icons.cjs').createIconLoader((...args)=>fetcher(...args),buffer=>{const img=require('electron').nativeImage.createFromBuffer(buffer);if(img.isEmpty())return null;const size=img.getSize();if(size.width>4096||size.height>4096)return null;return img.resize({width:128,height:128,quality:'best'}).toDataURL();});
ipcMain.handle('resource-icon',(_,url)=>loadResourceIcon(url));
ipcMain.handle('instance-icon',(_,id)=>require('../shared/instance-icons.cjs').readInstanceIcon(settings.root,id,loadResourceIcon));

const appearanceJobs=new Map();async function accountAppearance(id){const a=accounts.accounts.find(a=>a.id===id);if(!a)throw Error('账号已被移除');const root=settings.root,sync=appearanceSync.get(root+'\0'+id);if(sync)await sync.promise;const ready=appearanceResults.get(root+'\0'+id);if(a.type==='authlib'&&ready)return ready;const key=root+'\0'+id+JSON.stringify(a.skin||null);if(!appearanceJobs.has(key))appearanceJobs.set(key,require('../shared/appearance.cjs').appearance(root,a,fetcher).finally(()=>appearanceJobs.delete(key)));return appearanceJobs.get(key);}
ipcMain.handle('account-appearance',async(_,id,force)=>{
  if(force!==true)return accountAppearance(id);
  const account=accounts.accounts.find(a=>a.id===id);
  if(!account)throw Error('账号已被移除');
  if(account.type==='authlib'){
    const value=await queueAccountAppearance(account,true);
    if(!value)throw Error('暂时无法刷新皮肤');
    return value;
  }
  return require('../shared/appearance.cjs').appearance(settings.root,account,fetcher,{force:true});
});
ipcMain.handle('account-appearance-export',async(_,id)=>{const a=accounts.accounts.find(a=>a.id===id);if(!a)throw Error('账号已被移除');const data=await accountAppearance(id);const result=await dialog.showSaveDialog(win,{title:'导出皮肤',defaultPath:a.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'-skin.png',filters:[{name:'PNG 图片',extensions:['png']}]});if(result.canceled||!result.filePath)return false;await fs.writeFile(result.filePath,Buffer.from(data.skin.split(',')[1],'base64'));return true;});
