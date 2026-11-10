const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {ModNames}=require('./mod-names.cjs'),{Resources}=require('./resources.cjs'),{Loaders,targetInfo}=require('./loaders.cjs'),{ContentInstaller}=require('./content-install.cjs'),{Modpacks}=require('./modpacks.cjs');
const {scan}=require('./storage.cjs');const {httpsURL,filename}=require('./content-utils.cjs');
const {ResourceSearch}=require('./resource-search.cjs');
const {openProjectKey}=require('./project-credential.cjs');
function registerMarket(ctx){const {ipcMain,dialog,shell}=ctx;
 const projectKey=openProjectKey();
 let services,serviceRoot;const plans=new Map(),loaderLists=new Map();
 function get(){
   const settings=ctx.settings();
   if(!services||serviceRoot!==settings.root){
     const names=new ModNames({root:settings.root,fetcher:ctx.fetcher});
     const resources=new Resources({fetcher:ctx.fetcher,key:projectKey,names,onStatus:ctx.progress});
     const installer=new ContentInstaller({root:settings.root,fetcher:ctx.fetcher,onLog:ctx.log,onStatus:ctx.progress,concurrency:settings.concurrency,getCurseForgeKey:()=>projectKey});
     const loaders=new Loaders({root:settings.root,fetcher:ctx.fetcher,mode:settings.source,concurrency:settings.concurrency,chooseJava:ctx.chooseJava,getManifest:ctx.getManifest,onLog:ctx.log,onStatus:ctx.progress});
     services={names,resources,installer,loaders,packs:new Modpacks({resources,installer,loaders})};
     serviceRoot=settings.root;
   }
   services.loaders.mode=settings.source;
   return services;
 }
 function remember(plan){const id=crypto.randomUUID();plans.set(id,{...plan,root:ctx.settings().root,isolate:ctx.settings().isolate,expires:Date.now()+30*60*1000});while(plans.size>8)plans.delete(plans.keys().next().value);return {token:id,type:plan.type||'resources',name:plan.pack?.name||plan.project?.title,id:plan.id,target:plan.target,bundledFiles:plan.bundledFiles||0,files:plan.files.map((f,index)=>({index,title:f.chineseName||f.project?.title||f.original,filename:f.filename||f.path||f.original,version:f.version,reason:f.reason||'整合包文件',size:f.size,manual:!f.url,manualUrl:f.manualUrl,wiki:f.wiki})),warnings:plan.warnings||[]};}
 function planFor(token){const p=plans.get(token);if(!p||p.expires<Date.now())throw Error('安装清单已过期，请重新生成');if(p.root!==ctx.settings().root||p.isolate!==ctx.settings().isolate)throw Error('游戏目录或隔离设置已改变，请重新生成清单');return p;}
 async function target(id){return targetInfo(ctx.settings().root,id,ctx.settings().isolate,ctx.settings().advanced);}
 ipcMain.handle('market-boot',async()=>{const items=[];for(const v of (await scan(ctx.settings().root)).filter(v=>v.ready))try{items.push(await target(v.id));}catch{}return {targets:items};});
 function searchService(){const s=get();return s.search||(s.search=new ResourceSearch(s.resources,s.names));}
 ipcMain.handle('market-search',(_,input)=>searchService().search(input));
 ipcMain.handle('market-wiki',(_,id)=>get().names.page(String(id)));
 ipcMain.handle('market-details',async(_,input)=>{const t=input.kind==='modpack'||!input.target?{}:await target(input.target);if(input.loader&&['forge','neoforge','fabric','cleanroom'].includes(input.loader))t.loader=input.loader;return searchService().details(input,t);});
 ipcMain.handle('market-plan',async(_,input)=>{ctx.idle();return ctx.job(async signal=>{const s=get(),project=await s.resources.project(input.source,input.id,signal);if(project.kind==='modpack'){const f=await s.resources.file(project,input.versionId,{},signal);const archive=await s.installer.cached(f,signal);const plan=await s.packs.plan(archive,input.name,signal);plan.pack.icon=project.icon;return remember(plan);}const plan=await s.resources.plan(project,input.versionId,await target(input.target),signal);if(input.chineseName&&input.chineseName.trim()){plan.files[0].chineseName=input.chineseName.trim().slice(0,44);plan.files[0].filename=filename(plan.files[0].original,plan.files[0].chineseName);}return remember(plan);},'解析版本与前置依赖');});
 ipcMain.handle('market-drop-pack',async(_,file)=>{ctx.idle();if(typeof file!=='string'||!path.isAbsolute(file)||!/\.(mrpack|zip)$/i.test(file)||!(await fs.stat(file)).isFile())throw Error('请拖入一个 .mrpack 或整合包 ZIP 文件');return ctx.job(async signal=>remember(await get().packs.plan(file,'',signal)),'读取拖入的整合包');});
 ipcMain.handle('market-import-pack',async(_,name)=>{ctx.idle();const r=await dialog.showOpenDialog(ctx.window(),{title:'选择客户端整合包',properties:['openFile'],filters:[{name:'整合包',extensions:['mrpack','zip']}]});if(r.canceled)return null;return ctx.job(async signal=>remember(await get().packs.plan(r.filePaths[0],name,signal)),'读取整合包');});
 ipcMain.handle('market-manual',async(_,input)=>{ctx.idle();const plan=planFor(input.token),file=plan.files[input.index];if(!file||file.url)throw Error('手动下载条目无效');const r=await dialog.showOpenDialog(ctx.window(),{title:'导入 '+file.original,properties:['openFile']});if(r.canceled)return false;return get().installer.importManual(file,r.filePaths[0]);});
 ipcMain.handle('market-install',async(_,token)=>{const plan=planFor(token);return ctx.job(async signal=>{const s=get();if(plan.type!=='pack'){const fresh=await target(plan.target.id);plan.target.blockModUpdates=fresh.blockModUpdates;if(fresh.game!==plan.target.game||fresh.loader!==plan.target.loader||fresh.folder!==plan.target.folder)throw Error('目标版本已变化，请重新生成清单');}const result=plan.type==='pack'?await s.packs.install(plan,signal):await s.installer.install(plan,signal);plans.delete(token);await ctx.changed(typeof result==='string'?result:undefined);return result;},'安装资源');});
 ipcMain.handle('loader-list',async(_,input)=>{const rows=await get().loaders.list(input.game,input.loader);const ticket=crypto.randomUUID();loaderLists.set(ticket,rows);while(loaderLists.size>5)loaderLists.delete(loaderLists.keys().next().value);return {ticket,rows};});
 ipcMain.handle('loader-install',async(_,input)=>{const spec=loaderLists.get(input.ticket)?.find(v=>v.version===input.version);if(!spec)throw Error('加载器列表已失效，请重新读取');return ctx.job(async signal=>{const id=await get().loaders.install(spec,input.name,signal);await ctx.changed(id);return id;},'安装模组加载器');});
 ipcMain.handle('market-open',async(_,value)=>{const url=new URL(httpsURL(value));if(!['modrinth.com','www.curseforge.com','curseforge.com','www.mcmod.cn','search.mcmod.cn'].includes(url.hostname))throw Error('仅能打开资源平台的官方页面');return shell.openExternal(url.href);});
 return {redact:text=>projectKey?text.replaceAll(projectKey,'[redacted]'):text};
}
module.exports={registerMarket};
