const {app,BrowserWindow,ipcMain,dialog,shell,net,safeStorage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Game,inspectJava}=require('./game.cjs');
const advanced=require('./advanced.cjs');
const publicSettings=()=>{const {localVersionArgs,...visible}=settings;return visible;};
const {layout,scan,markStandalone,writeJSON,migrateLegacy}=require('./storage.cjs');
const {validate,runtimePath,redact}=require('./core.cjs');
const {scanJava,chooseJava,requiredJava,javaRequirement,javaCompatible,describeJava,memoryLimit}=require('./java.cjs');
const {AccountStore,MicrosoftAuth,validClient}=require('./accounts.cjs');
const {importSkin,previewSkin,startSkinServer}=require('./skins.cjs');
const {YggdrasilAuth,PRESETS}=require('./yggdrasil.cjs');
const {ManifestCatalog}=require('./catalog.cjs');
const {registerMarket}=require('./market-ipc.cjs');
const {registerInstances}=require('./instance-manager.cjs');
const {registerOfflinePacks}=require('./offline-pack.cjs');
const {instanceOptions}=require('./instance-config.cjs');
const {validateJavaSelection,resolveJavaSelection,validMajor}=require('./java-selection.cjs');
const {targetInfo}=require('./loaders.cjs');
const {memorySnapshot,optimizeMemory}=require('./memory.cjs');
const {logBuffer,crashBaseline,freshFatalFiles,unexpectedExit,exportCrash,latestCrash}=require('./crash-reports.cjs');
const crypto=require('node:crypto');
let catalog,market,externalBusy=false,externalController,externalServer,externalSession,externalTimer;
let accounts,accountError='',javaItems=[],javaScan,loginController,skinServer;
const {electronFetch}=require('./electron-fetch.cjs');
const fetcher=(url,options)=>electronFetch(net,url,options);
const auth=new MicrosoftAuth({fetcher});
const externalAuth=new YggdrasilAuth({fetcher});
let win,child,busy=false,controller,settings,logs=[],closing=false,gameStopRequested=false,sessionLogs=null,lastCrash=null;
let welcomeNeeded=true;
const appearanceSync=new Map(),appearanceResults=new Map();
let state={phase:'idle',text:'准备就绪',percent:0};
const settingsAccount=()=>accounts.accounts.find(a=>a.id===accounts.active)||{name:'Guest',type:'offline'};
const home=()=>path.join(portable(),'.starquill-profile');
const portable=()=>process.env.PORTABLE_EXECUTABLE_DIR||(app.isPackaged?path.dirname(process.execPath):__dirname);
const defaults=()=>({advanced:advanced.effective(),name:'Player',memory:Math.min(4,Math.max(1,Math.floor(os.totalmem()/1024**3/2))),optimizeMemory:false,java:'',javaMode:'auto',javaMajor:21,javaRoots:[],microsoftClientId:'',selected:'1.21.1',snapshots:false,root:path.join(portable(),'.minecraft'),isolate:true,source:'auto',concurrency:16});
const bundled=()=>runtimePath(process.resourcesPath,__dirname,app.isPackaged);
function send(event,data){if(win&&!win.isDestroyed())win.webContents.send(event,data);}
function status(phase,text,percent=0){state={phase,text,percent:Number.isFinite(percent)?Math.min(100,Math.max(0,percent)):0};send('state',state);}
function cleanLog(text){let clean=market?.redact(redact(text))||redact(text);for(const a of [...(accounts?.accounts||[]),externalSession].filter(Boolean))for(const key of ['accessToken','refreshToken','clientToken'])if(a.tokens?.[key])clean=clean.replaceAll(a.tokens[key],'[redacted]');return clean;}
function log(text){const line='['+new Date().toLocaleTimeString('zh-CN')+'] '+cleanLog(text);sessionLogs?.append(line+'\n');logs.push(line.slice(-65536));if(logs.length>1000)logs.shift();send('log',line.slice(-65536));}
async function persist(){await writeJSON(path.join(home(),'settings.json'),settings);}
async function local(){return scan(settings.root);}
function requireIdle(){if(busy||loginController||externalBusy)throw Error('请等待当前任务或账号登录结束后再修改设置或账号');}
function scanRuntimes(){if(!javaScan)javaScan=scanJava({bundled:bundled(),selected:settings.java,root:settings.root,extraRoots:settings.javaRoots||[]}).then(items=>{javaItems=items;send('java-list',items);return items;}).finally(()=>{javaScan=null;});return javaScan;}
async function accountView(){const data=accounts.public();for(const a of data.accounts){if(a.type==='authlib'){const key=settings.root+'\0'+a.id,cached=appearanceResults.get(key)||await require('./appearance.cjs').cachedAppearance(settings.root,a);if(cached){a.preview=cached.skin;a.appearance={model:cached.model,default:cached.default,cape:!!cached.cape,warning:cached.warning||''};}a.appearancePending=appearanceSync.has(key);}else if(a.skin)a.preview=await previewSkin(settings.root,a.skin);}return data;}
async function changedAccounts(){const data=await accountView();send('accounts-changed',data);return data;}
function queueAccountAppearance(account,force=false){
  if(account?.type!=='authlib')return Promise.resolve();
  const root=settings.root,key=root+'\0'+account.id;if(appearanceSync.has(key)){const current=appearanceSync.get(key);if(force&&!current.force){current.force=true;current.promise=current.promise.then(()=>queueAccountAppearance(account,true));}return current.promise;}
  const controller=new AbortController();
  const promise=(async()=>{try{const value=await require('./appearance.cjs').appearance(root,account,fetcher,{force,signal:controller.signal});if(!controller.signal.aborted&&accounts.accounts.some(a=>a.id===account.id)){appearanceResults.set(key,value);while(appearanceResults.size>128)appearanceResults.delete(appearanceResults.keys().next().value);}return value;}catch(error){if(!controller.signal.aborted)log('角色外观读取失败：'+error.message);}finally{appearanceSync.delete(key);if(settings.root===root&&accounts.accounts.some(a=>a.id===account.id))await changedAccounts();}})();
  appearanceSync.set(key,{promise,controller,force});return promise;
}
function stopSkin(){skinServer?.close();skinServer=null;}
function engine(extra={}){return new Game({...settings,toolsDir:path.join(app.isPackaged?process.resourcesPath:__dirname,'tools'),java:settings.java||bundled(),version:settings.selected,onLog:log,fetcher,getManifest:()=>catalog.refresh(false),...extra});}
const agentFile=()=>path.join(app.isPackaged?process.resourcesPath:__dirname,'tools','authlib-injector-1.2.8.jar');
async function discardExternal(){clearTimeout(externalTimer);const old=externalSession;externalSession=null;if(old)await externalAuth.invalidate(old).catch(()=>{});}
const runJob=async(fn,title)=>{requireIdle();busy=true;controller=new AbortController();status('preparing',title);try{const result=await fn(controller.signal);status('idle','准备就绪');return result;}catch(e){log(e.message);status('error',e.message);throw e;}finally{busy=false;controller=null;}};
registerInstances({ipcMain,dialog,shell,persist,window:()=>win,settings:()=>settings,idle:requireIdle,job:runJob,changed:async()=>send('instances-changed',await local())});
registerOfflinePacks({ipcMain,dialog,window:()=>win,settings:()=>settings,job:runJob,progress:(text,percent)=>status('downloading',text,percent),chooseJava:async(id,required,options)=>resolveJavaSelection({root:settings.root,id,settings:options,required,items:scanRuntimes}),changed:async id=>{settings.selected=id;await persist();send('instances-changed',await local());send('market-changed',{selected:id});}});
function selectInstallerJava(required){
  // A new instance has no runtime directory until it has been installed.
  const policy=settings.javaMode==='folder'?{...settings,javaMode:'auto'}:settings;
  return resolveJavaSelection({settings:policy,required,items:scanRuntimes});
}
market=registerMarket({ipcMain,dialog,shell,fetcher,log,window:()=>win,settings:()=>settings,idle:requireIdle,getManifest:()=>catalog.refresh(false),progress:(text,percent=0)=>status('downloading',text,percent),chooseJava:selectInstallerJava,changed:async id=>{if(id){settings.selected=id;await persist();}send('instances-changed',await local());send('market-changed',{selected:id});},job:runJob});
require('node:fs').mkdirSync(home(),{recursive:true});app.setPath('userData',home());
app.whenReady().then(async()=>{
  await fs.mkdir(home(),{recursive:true});settings=defaults();try{const saved=JSON.parse(await fs.readFile(path.join(home(),'settings.json'),'utf8'));settings={...settings,...saved,javaMode:saved.javaMode||(saved.java?'manual':'auto')};}catch{}
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
  settings.optimizeMemory=settings.memoryOptimizationVersion===1&&settings.optimizeMemory===true;
  lastCrash=await latestCrash(settings.root);
  catalog=new ManifestCatalog({root:settings.root,mode:settings.source,fetcher,onUpdate:data=>send('versions-changed',data)});
  accounts=new AccountStore(path.join(home(),'accounts.json'),safeStorage);try{await accounts.load();}catch(e){accountError=e.message;}
  try{const receipt=JSON.parse(await fs.readFile(path.join(home(),'welcome.json'),'utf8'));welcomeNeeded=safeStorage.decryptString(Buffer.from(receipt.receipt,'base64'))!==('starquill-welcome-v1:'+os.hostname());}catch{welcomeNeeded=true;}
  // Match the supplied HMCL window's saved logical size, independent of DPI.
  win=new BrowserWindow({show:false,width:834,height:514,minWidth:834,minHeight:514,maxWidth:834,maxHeight:514,resizable:false,maximizable:false,fullscreenable:false,frame:false,backgroundColor:'#f3eee7',title:'NHMCL-StarQuill · 星翎启动器',icon:path.join(__dirname,'assets','icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.removeMenu();
  win.on('app-command',(event,command)=>{if(command==='browser-backward'){event.preventDefault();send('navigate-back');}});
  win.webContents.setZoomFactor(1);
  win.webContents.setVisualZoomLevelLimits(1,1).catch(()=>{});
  win.webContents.on('zoom-changed',()=>win.webContents.setZoomLevel(0));
  win.webContents.on('before-input-event',(event,input)=>{if(input.key==='F11'||((input.control||input.meta)&&['+','-','=','0','Add','Subtract'].includes(input.key)))event.preventDefault();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  win.on('close',e=>{if(busy&&!closing){e.preventDefault();dialog.showMessageBox(win,{type:'question',message:'当前任务尚未结束，是否关闭？',detail:'下载将保留已完成文件与续传数据；运行中的游戏将结束。',buttons:['继续运行','关闭并结束任务'],defaultId:0,cancelId:0}).then(({response})=>{if(response===1){closing=true;controller?.abort();child?.kill();app.exit(0);}});}});
  win.on('focus',()=>{if(settings&&!busy)local().then(items=>send('instances-changed',items)).catch(()=>{});});
  win.webContents.setBackgroundThrottling(false);
  await win.loadFile(path.join(__dirname,'index.html'));
  // Reveal only after the new shell and local bootstrap have finished.
  // Allow the hidden compositor to replace its initial frame before showing.
  await win.webContents.executeJavaScript('Promise.resolve(window.starquillReady).then(() => document.fonts.ready).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  if(!win.isDestroyed()){win.show();win.webContents.setBackgroundThrottling(true);}
  setImmediate(()=>{
    for(const account of accounts.accounts)queueAccountAppearance(account).catch(()=>{});
    scanRuntimes().catch(e=>log(e.message));
  });
});
app.on('before-quit',()=>{loginController?.abort();externalController?.abort();clearTimeout(externalTimer);controller?.abort();for(const job of appearanceSync.values())job.controller.abort();stopSkin();});
app.on('window-all-closed',()=>app.quit());
ipcMain.handle('boot',async()=>({settings:publicSettings(),welcomeNeeded,instances:await local(),accounts:await accountView(),accountError,javaItems,skinServers:PRESETS,totalMemory:memoryLimit(),physicalMemory:(os.totalmem()/1024**3).toFixed(1),state,version:require('./package.json').displayVersion||app.getVersion()}));
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
  const javaSelection=validateJavaSelection(o);
  if(o.microsoftClientId&&!validClient(o.microsoftClientId))throw Error('Client ID 应为应用注册提供的 UUID，不是密钥');
  const launchAdvanced=advanced.effective(o.advanced===undefined?settings.advanced:o.advanced);
  await fs.mkdir(o.root,{recursive:true});await fs.access(o.root,require('node:fs').constants.W_OK);
  const rootChanged=path.resolve(o.root)!==settings.root;
  settings.customRoot=path.relative(path.join(portable(),'.minecraft'),path.resolve(o.root))?path.resolve(o.root):null;
  settings={...settings,advanced:launchAdvanced,name:settingsAccount().name,memory:o.memory,optimizeMemory:o.optimizeMemory===undefined?settings.optimizeMemory:o.optimizeMemory===true,memoryOptimizationVersion:1,java:o.java,javaMode:javaSelection.javaMode,javaMajor:javaSelection.javaMajor,microsoftClientId:o.microsoftClientId||'',selected:o.selected,snapshots:!!o.snapshots,root:path.resolve(o.root),isolate:o.isolate!==false,source:o.source,concurrency:o.concurrency};await persist();catalog.mode=settings.source;catalog.root=settings.root;catalog.file=path.join(settings.root,'.starquill','catalog-cache.json');if(rootChanged){lastCrash=await latestCrash(settings.root);send('crash-report',lastCrash);}await changedAccounts();return {settings:publicSettings(),instances:await local()};
});
ipcMain.handle('select-root',async()=>{requireIdle();const r=await dialog.showOpenDialog(win,{title:'选择已有 .minecraft 或启动器所在文件夹',defaultPath:settings.root,properties:['openDirectory','createDirectory']});if(r.canceled)return null;let root=r.filePaths[0];try{if((await fs.stat(path.join(root,'.minecraft'))).isDirectory())root=path.join(root,'.minecraft');}catch{}return {root,instances:await scan(root)};});
ipcMain.handle('migrate',async()=>{requireIdle();const r=await dialog.showOpenDialog(win,{title:'选择旧 Aster 的 instances 文件夹（复制导入，不删除原数据）',defaultPath:path.join(app.getPath('appData'),'aster-launcher','instances'),properties:['openDirectory']});if(r.canceled)return null;
  busy=true;status('preparing','正在复制旧版数据');try{const result=await migrateLegacy(r.filePaths[0],settings.root,text=>status('preparing',text));log(`迁移完成：${result.versions} 个版本，复制 ${result.copied} 个文件，跳过已有 ${result.skipped} 个文件`);if(result.conflicts.length)log('同名版本配置不同，未覆盖：'+result.conflicts.join('、'));send('instances-changed',await local());status('idle','迁移完成');return result;}catch(e){status('error',e.message);throw e;}finally{busy=false;}
});
ipcMain.handle('java',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择 java.exe',properties:['openFile'],filters:[{name:'Java',extensions:['exe']}]});return r.canceled?null:inspectJava(r.filePaths[0]);});
ipcMain.handle('scan-java',()=>scanRuntimes());
ipcMain.handle('scan-java-folder',async()=>{requireIdle();const r=await dialog.showOpenDialog(win,{title:'选择 Java 所在文件夹（扫描最多 5 层子目录）',properties:['openDirectory']});if(r.canceled)return null;settings.javaRoots=[...new Set([...(settings.javaRoots||[]),r.filePaths[0]])].slice(-20);await persist();if(javaScan)await javaScan;return scanRuntimes();});
ipcMain.handle('welcome-complete',async(_,input)=>{requireIdle();if(!['offline','skip','skin'].includes(input?.mode))throw Error('请选择进入方式');if(input.mode==='offline')await accounts.addOffline(input.name);if(safeStorage.isEncryptionAvailable())await writeJSON(path.join(home(),'welcome.json'),{receipt:safeStorage.encryptString('starquill-welcome-v1:'+os.hostname()).toString('base64')});welcomeNeeded=false;return changedAccounts();});
ipcMain.handle('account-add',async(_,name)=>{requireIdle();await accounts.addOffline(name);return changedAccounts();});
ipcMain.handle('account-select',async(_,id)=>{requireIdle();await accounts.select(id);queueAccountAppearance(accounts.current()).catch(()=>{});return changedAccounts();});
ipcMain.handle('account-remove',async(_,id)=>{requireIdle();if(accounts.accounts.length<=1)throw Error('请至少保留一个账号');const account=accounts.accounts.find(a=>a.id===id);externalBusy=true;try{if(account?.type==='authlib')await externalAuth.invalidate(account).catch(()=>log('皮肤站暂不可用：已移除本地登录，远端会话撤销未确认'));await accounts.remove(id);return changedAccounts();}finally{externalBusy=false;}});
ipcMain.handle('account-skin-import',async(_,input)=>{requireIdle();const account=accounts.current();if(account.type!=='offline')throw Error('请先选择离线账号');const model=input?.model;if(!['default','slim'].includes(model))throw Error('请选择普通或纤细手臂');busy=true;try{const result=await dialog.showOpenDialog(win,{title:'选择离线角色的 PNG 皮肤',properties:['openFile'],filters:[{name:'Minecraft PNG 皮肤',extensions:['png']}]});if(result.canceled||!result.filePaths[0])return null;const skin=await importSkin(settings.root,result.filePaths[0],model,bytes=>{const image=require('electron').nativeImage.createFromBuffer(bytes),size=image.getSize();if(image.isEmpty()||size.width!==64||![32,64].includes(size.height))throw Error('无法读取这张 PNG 皮肤，请选择完整的 64×64 或 64×32 图片');return image.toPNG();});await accounts.put({...account,skin});return changedAccounts();}finally{busy=false;}});
ipcMain.handle('auth-config-save',async(_,value)=>{requireIdle();if(typeof value!=='string')throw Error('应用编号格式无效');const id=value.trim();if(id&&!validClient(id))throw Error('请填写 Application (client) ID，不是租户 ID、对象 ID 或密钥');settings.microsoftClientId=id;await persist();return {clientId:id};});
ipcMain.handle('auth-config-check',()=>({clientId:settings.microsoftClientId||'',validClient:validClient(settings.microsoftClientId),secureStorage:safeStorage.isEncryptionAvailable(),remoteVerified:false}));
ipcMain.handle('auth-setup-link',(_,kind)=>{const urls={register:'https://entra.microsoft.com/',review:'https://aka.ms/mce-reviewappid',docs:'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code'};if(!Object.hasOwn(urls,kind))throw Error('未知设置入口');return shell.openExternal(urls[kind]);});
ipcMain.handle('login-start',async()=>{throw Error('暂不支持微软登录，请使用皮肤站或离线登录');requireIdle();if(!safeStorage.isEncryptionAvailable())throw Error('Windows 安全存储不可用，无法保存微软登录');
  const controller=new AbortController();loginController=controller;
  try{const device=await auth.begin(settings.microsoftClientId,controller.signal);
    auth.poll(device,controller.signal).then(async account=>{if(controller.signal.aborted)return;await accounts.put(account,true);await changedAccounts();send('login-state',{phase:'success',text:'微软正版账号已登录'});}).catch(e=>send('login-state',{phase:'error',text:e.message})).finally(()=>{if(loginController===controller)loginController=null;});
    return {userCode:device.user_code,url:device.verification_uri,expiresAt:device.expiresAt};
  }catch(e){loginController=null;throw e;}
});
ipcMain.handle('login-cancel',()=>{loginController?.abort();return true;});
ipcMain.handle('login-browser',()=>shell.openExternal('https://www.microsoft.com/link'));
ipcMain.handle('authlib-discover',async(_,url)=>{requireIdle();externalBusy=true;externalController=new AbortController();try{await discardExternal();externalServer=null;const server=await externalAuth.discover(url,externalController.signal);externalServer={...server,ticket:crypto.randomUUID(),expiresAt:Date.now()+10*60*1000};return {ticket:externalServer.ticket,url:server.url,name:server.name};}finally{externalBusy=false;externalController=null;}});
ipcMain.handle('authlib-login',async(_,input)=>{requireIdle();if(!safeStorage.isEncryptionAvailable())throw Error('Windows 安全存储不可用，无法保存皮肤站会话');if(!externalServer||input?.ticket!==externalServer.ticket||Date.now()>externalServer.expiresAt)throw Error('请先重新识别并核对皮肤站地址');externalBusy=true;externalController=new AbortController();
  try{await discardExternal();let session;try{session=await externalAuth.authenticate(externalServer,input.username,input.password,externalController.signal);}finally{input.password='';}
    if(externalController.signal.aborted){await externalAuth.invalidate(session).catch(()=>{});throw Error('皮肤站登录已取消');}
    externalSession={...session,id:crypto.randomUUID(),expiresAt:Date.now()+5*60*1000};externalTimer=setTimeout(()=>{discardExternal().finally(()=>send('authlib-state',{phase:'expired',text:'角色选择已过期，请重新登录皮肤站'}));},5*60*1000);
    if(session.profiles.length===1){const account=await externalAuth.bind(session,session.profiles[0].id,externalController.signal);if(externalController.signal.aborted){await externalAuth.invalidate(account).catch(()=>{});throw Error('皮肤站登录已取消');}await accounts.put(account,true);queueAccountAppearance(account,true).catch(()=>{});clearTimeout(externalTimer);externalSession=null;return {accounts:await changedAccounts()};}
    return {sessionId:externalSession.id,profiles:session.profiles};
  }finally{externalBusy=false;externalController=null;}
});
ipcMain.handle('authlib-profile',async(_,input)=>{requireIdle();if(!externalSession||input?.sessionId!==externalSession.id||Date.now()>externalSession.expiresAt)throw Error('角色选择已过期，请重新登录');externalBusy=true;externalController=new AbortController();try{const account=await externalAuth.bind(externalSession,input.profileId,externalController.signal);if(externalController.signal.aborted){await externalAuth.invalidate(account).catch(()=>{});throw Error('皮肤站登录已取消');}await accounts.put(account,true);queueAccountAppearance(account,true).catch(()=>{});clearTimeout(externalTimer);externalSession=null;return changedAccounts();}finally{externalBusy=false;externalController=null;}});
ipcMain.handle('authlib-cancel',async()=>{externalController?.abort();externalServer=null;await discardExternal();return true;});
ipcMain.handle('folder',async(_,id)=>{const p=id?(await targetInfo(settings.root,id,settings.isolate)).folder:settings.root;await fs.mkdir(p,{recursive:true});const error=await shell.openPath(p);if(error)throw Error(error);});
ipcMain.handle('export-log',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'NHMCL-StarQuill-log.txt',filters:[{name:'文本日志',extensions:['txt']}]});if(r.canceled)return false;await fs.writeFile(r.filePath,logs.join('\r\n'));return true;});
ipcMain.handle('stop',()=>{if(child){gameStopRequested=true;child.kill();return true;}if(controller){controller.abort();return true;}return false;});
ipcMain.handle('launch',async()=>{requireIdle();if(accountError)throw Error(accountError);validate({version:settings.selected,...settings,name:accounts.current().name,accountType:accounts.current().type});busy=true;controller=new AbortController();status('preparing','检查本地版本与 Java');
  sessionLogs=logBuffer(32*1024*1024);const crash={root:settings.root,version:settings.selected,logs:sessionLogs};
  const game=engine({signal:controller.signal,onProgress:p=>{const mb=(p.speed/1024**2).toFixed(1);status('downloading',`文件 ${p.done}/${p.total} · 已复用 ${p.reused} · 下载 ${p.downloaded} · ${mb} MB/s`,p.total?p.done/p.total*100:0);}});
  try{log('游戏根目录：'+settings.root);log('版本隔离：'+(settings.isolate?'开启':'关闭')+' · 下载源：'+settings.source);
    const resolved=await game.resolve(),required=javaRequirement(resolved.meta);
    const launchSettings=await instanceOptions(settings.root,settings.selected,settings,resolved.raw);Object.assign(game.options,launchSettings,{version:settings.selected});
    const java=await resolveJavaSelection({root:settings.root,id:settings.selected,settings:launchSettings,required,items:scanRuntimes});
    log('版本独立设置：'+launchSettings.memory+' GB · '+(launchSettings.isolate?'隔离目录':'共享目录'));
    game.options.java=java.path;game.options.javaMajor=java.major;log(`${({auto:'自动选择',major:'按主版本选择',folder:'使用版本内',manual:'手动指定'})[launchSettings.javaMode]||'自动选择'} Java ${java.version} (${java.bits} 位)：${java.path}`);
    let account=accounts.current();if(account.type==='microsoft'){throw Error('暂不支持微软登录，请使用皮肤站或离线登录');status('preparing','验证微软正版账号');account=await auth.refresh(account,controller.signal,a=>accounts.put(a));await accounts.put(account);await changedAccounts();}
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
    let processError='';child.once('error',e=>{processError=e.message;log(e.message);});
    child.once('close',(code,signal)=>{
      const manual=gameStopRequested||closing;stopSkin();child=null;controller=null;gameStopRequested=false;
      (async()=>{
        log(manual?'用户结束游戏':`游戏退出，代码 ${code}，信号 ${signal||'无'}`);
        let fatal=[];if(!manual)try{fatal=await freshFatalFiles(crash);if(code!==0){status('diagnosing','等待崩溃日志写入…');await new Promise(resolve=>setTimeout(resolve,1500));fatal=await freshFatalFiles(crash);}} catch(e){log('读取崩溃文件失败：'+e.message);}
        if(unexpectedExit(code,signal,manual,fatal.length,processError)){
          status('diagnosing','游戏意外退出，正在导出日志并分析…');
          try{lastCrash=await exportCrash(crash,{code,signal,error:processError,fatal},cleanLog);send('crash-report',lastCrash);log('崩溃日志已自动导出：'+lastCrash.file);status('error','游戏意外退出 · 日志与初步分析已保存');}
          catch(e){log('自动导出崩溃日志失败：'+e.message);send('crash-export-error','日志自动导出失败：'+e.message+'。可到运行日志手动导出。');status('error','游戏意外退出 · 自动导出失败，可手动导出日志');}
        }else status('idle',manual?'游戏已结束':'游戏已退出');
      })().catch(e=>{log(e.message);status('error','退出处理失败：'+e.message);}).finally(()=>{busy=false;sessionLogs=null;send('state',state);local().then(items=>send('instances-changed',items)).catch(e=>log(e.message));});
    });return true;
  }catch(e){stopSkin();busy=false;child=null;controller=null;sessionLogs=null;status('error',e.message);log(e.message);local().then(items=>send('instances-changed',items)).catch(()=>{});throw e;}
});

const loadResourceIcon=require('./resource-icons.cjs').createIconLoader((...args)=>fetcher(...args),buffer=>{const img=require('electron').nativeImage.createFromBuffer(buffer);if(img.isEmpty())return null;const size=img.getSize();if(size.width>4096||size.height>4096)return null;return img.resize({width:128,height:128,quality:'best'}).toDataURL();});
ipcMain.handle('resource-icon',(_,url)=>loadResourceIcon(url));
ipcMain.handle('instance-icon',(_,id)=>require('./instance-icons.cjs').readInstanceIcon(settings.root,id,loadResourceIcon));

const appearanceJobs=new Map();async function accountAppearance(id){const a=accounts.accounts.find(a=>a.id===id);if(!a)throw Error('账号已被移除');const root=settings.root,sync=appearanceSync.get(root+'\0'+id);if(sync)await sync.promise;const ready=appearanceResults.get(root+'\0'+id);if(a.type==='authlib'&&ready)return ready;const key=root+'\0'+id+JSON.stringify(a.skin||null);if(!appearanceJobs.has(key))appearanceJobs.set(key,require('./appearance.cjs').appearance(root,a,fetcher).finally(()=>appearanceJobs.delete(key)));return appearanceJobs.get(key);}
ipcMain.handle('account-appearance',(_,id)=>accountAppearance(id));
ipcMain.handle('account-appearance-export',async(_,id)=>{const a=accounts.accounts.find(a=>a.id===id);if(!a)throw Error('账号已被移除');const data=await accountAppearance(id);const result=await dialog.showSaveDialog(win,{title:'导出皮肤',defaultPath:a.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'-skin.png',filters:[{name:'PNG 图片',extensions:['png']}]});if(result.canceled||!result.filePath)return false;await fs.writeFile(result.filePath,Buffer.from(data.skin.split(',')[1],'base64'));return true;});
