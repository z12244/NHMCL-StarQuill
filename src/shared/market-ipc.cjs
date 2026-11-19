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
     const installer=new ContentInstaller({root:settings.root,fetcher:ctx.fetcher,onLog:ctx.log,onStatus:ctx.progress,concurrency:settings.concurrency,source:settings.source,getCurseForgeKey:()=>projectKey});
     const loaders=new Loaders({root:settings.root,fetcher:ctx.fetcher,mode:settings.source,concurrency:settings.concurrency,chooseJava:ctx.chooseJava,getManifest:ctx.getManifest,onLog:ctx.log,onStatus:ctx.progress});
     services={names,resources,installer,loaders,packs:new Modpacks({resources,installer,loaders})};
     serviceRoot=settings.root;
   }
   services.loaders.mode=settings.source;
   services.installer.source=settings.source;
   return services;
 }
 function remember(plan){const id=crypto.randomUUID();plans.set(id,{...plan,root:ctx.settings().root,isolate:ctx.settings().isolate,expires:Date.now()+30*60*1000});while(plans.size>8)plans.delete(plans.keys().next().value);return {token:id,type:plan.type||'resources',name:plan.pack?.name||plan.project?.title,id:plan.id,target:plan.target,bundledFiles:plan.bundledFiles||0,files:plan.files.map((f,index)=>({index,title:f.chineseName||f.project?.title||f.original,filename:f.filename||f.path||f.original,version:f.version,reason:f.reason||'整合包文件',size:f.size,manual:!f.url&&!f.cached,manualUrl:f.manualUrl,wiki:f.wiki})),warnings:plan.warnings||[]};}
 function planFor(token){const p=plans.get(token);if(!p||p.expires<Date.now())throw Error('安装清单已过期，请重新生成');if(p.root!==ctx.settings().root||p.isolate!==ctx.settings().isolate)throw Error('游戏目录或隔离设置已改变，请重新生成清单');return p;}
 async function target(id){return targetInfo(ctx.settings().root,id,ctx.settings());}
 ipcMain.handle('market-boot',async()=>{const items=[];for(const v of (await scan(ctx.settings().root)).filter(v=>v.ready))try{items.push(await target(v.id));}catch{}return {targets:items};});
 function searchService(){const s=get();return s.search||(s.search=new ResourceSearch(s.resources,s.names));}
 let searchController;
 ipcMain.handle('market-search',async(_,input)=>{
   searchController?.abort();
   const controller=new AbortController();
   searchController=controller;
   try{return await searchService().search(input,controller.signal);}
   finally{if(searchController===controller)searchController=null;}
 });
 ipcMain.handle('market-wiki',(_,id)=>get().names.page(String(id)));
 ipcMain.handle('market-details',async(_,input)=>{const t=input.kind==='modpack'||!input.target?{}:await target(input.target);if(!input.target||input.kind==='modpack')t.game=String(input.game||'');
 if(input.loader==='all')delete t.loader;
 if(input.loader&&['forge','neoforge','fabric','cleanroom'].includes(input.loader))t.loader=input.loader;return searchService().details(input,t);});
 async function planResource(input,signal){const s=get(),project=await s.resources.project(input.source,input.id,signal);if(project.kind==='modpack'){const f=await s.resources.file(project,input.versionId,{},signal);if(!f.url)return {type:'manual-pack',url:f.manualUrl||project.url,name:project.title};const archive=await s.installer.cached(f,signal);const plan=await s.packs.plan(archive,input.name,signal);plan.pack.icon=project.icon;return remember(plan);}const plan=await s.resources.plan(project,input.versionId,await target(input.target),signal);if(input.chineseName&&input.chineseName.trim()){plan.files[0].chineseName=input.chineseName.trim().slice(0,44);plan.files[0].filename=filename(plan.files[0].original,plan.files[0].chineseName);}return remember(plan);}
 ipcMain.handle('market-plan',(_,input)=>ctx.job(signal=>planResource(input,signal),'解析版本与前置依赖'));
 ipcMain.handle('market-drop-pack',async(_,file)=>{ctx.idle();if(typeof file!=='string'||!path.isAbsolute(file)||!/\.(mrpack|zip)$/i.test(file)||!(await fs.stat(file)).isFile())throw Error('请拖入一个 .mrpack 或整合包 ZIP 文件');return ctx.job(async signal=>remember(await get().packs.plan(file,'',signal)),'读取拖入的整合包');});
 ipcMain.handle('market-import-pack',async(_,name)=>{ctx.idle();const r=await dialog.showOpenDialog(ctx.window(),{title:'选择客户端整合包',properties:['openFile'],filters:[{name:'整合包',extensions:['mrpack','zip']}]});if(r.canceled)return null;return ctx.job(async signal=>remember(await get().packs.plan(r.filePaths[0],name,signal)),'读取整合包');});
 ipcMain.handle('market-manual',async(_,input)=>{ctx.idle();const plan=planFor(input.token),file=plan.files[input.index];if(!file||file.url)throw Error('手动下载条目无效');const r=await dialog.showOpenDialog(ctx.window(),{title:'导入 '+file.original,properties:['openFile']});if(r.canceled)return false;return get().installer.importManual(file,r.filePaths[0]);});
 async function installToken(token,signal){const plan=planFor(token),s=get();if(plan.type!=='pack'){const fresh=await target(plan.target.id);plan.target.blockModUpdates=fresh.blockModUpdates;if(fresh.game!==plan.target.game||fresh.loader!==plan.target.loader||fresh.folder!==plan.target.folder)throw Error('目标版本已变化，请重新生成清单');}const result=plan.type==='pack'?await s.packs.install(plan,signal):await s.installer.install(plan,signal);plans.delete(token);await ctx.changed(typeof result==='string'?result:undefined);return result;}
 ipcMain.handle('market-install',(_,token)=>ctx.job(signal=>installToken(token,signal),'安装资源'));
 ipcMain.handle('ai-install-resource',(_,input)=>ctx.job(async signal=>{
   let instance='';
   let command=require('./ai-assistant.cjs').actionFrom(input);
   if(input?.type==='instance'){
     const helper=require('./assistant-instance.cjs'),c=helper.versionRequest(input.request);
     if(!c?.loader)throw Error('无法识别版本安装指令');
     instance=await helper.ensureInstance(c,{root:ctx.settings().root,loaders:get().loaders,signal,settings:ctx.settings(),changed:ctx.changed});
     if(!c.mod)return {instanceOnly:true,target:instance};
     command={type:'install',kind:'mod',value:c.mod,game:c.game,loader:c.loader,target:instance};
   }
   if(command?.type!=='install')throw Error('无法识别安装指令');
   if(!instance)command.value=require('./assistant-install.cjs').requestName(input.request,command);
   const targets=[];
   if(command.kind==='mod')for(const item of (await scan(ctx.settings().root)).filter(v=>v.ready)){
     try{targets.push(await target(item.id));}catch{}
   }
   if(!instance&&command.kind==='mod'&&!command.target&&/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/.test(command.game)&&['forge','neoforge','fabric'].includes(command.loader)){
     const words=String(input.request||'').normalize('NFKC').toLowerCase();
     const namedLoaders=words.match(/neoforge|forge|fabric/g)||[];
     if(words.includes(command.game)&&namedLoaders.includes(command.loader)&&!targets.some(t=>t.game===command.game&&t.loader===command.loader)){
       instance=await require('./assistant-instance.cjs').ensureInstance(command,{root:ctx.settings().root,loaders:get().loaders,settings:ctx.settings(),signal,changed:ctx.changed});
       command.target=instance;targets.push(await target(instance));
     }
   }
   const service=searchService();
   let plan;try{plan=await require('./assistant-install.cjs').prepareInstall(command,{
     targets,selected:ctx.settings().selected,
     search:(query,s)=>service.search(query,s),details:(p,t,s)=>service.details(p,t,s),plan:planResource
   },signal);}catch(error){
     signal.throwIfAborted();
     if(instance)return {partial:'版本 '+instance+' 已就绪；未安装「'+command.value+'」：'+error.message};
     if(command.kind!=='modpack'||!/资源平台暂时无法连接|未找到指定条件下的兼容文件|未找到可用下载来源/.test(error.message))throw error;
     plan={type:'search-choice'};
   }
   signal.throwIfAborted();
   if(command.kind==='modpack'&&['catalog-guide','search-choice','manual-pack'].includes(plan.type)&&!plan.message?.startsWith('找到多个同名')){
     ctx.progress('正在联网搜索整合包及作者发布的客户端文件…',0);
     const found=await require('./pack-discovery.cjs').discover(command,ctx.fetcher,signal);
     const fallback={guide:{name:found.name,url:found.page,warnings:found.warnings||[]}};
     if(found.file){
       try{const s=get(),archive=await s.installer.cached(found.file,signal),raw=await s.packs.plan(archive,'',signal);
         if(command.game&&command.game!==raw.pack.game||command.loader&&command.loader!==raw.pack.loader){fallback.guide.warnings.push('发布文件与指定的游戏版本或加载器不符');return fallback;}
         plan=remember(raw);
       }catch(error){signal.throwIfAborted();fallback.guide.warnings.push('发布文件未能通过下载或导入检查：'+error.message);return fallback;}
     }else if(plan.type!=='manual-pack')return fallback;
   }
   if(plan.type==='search-choice'){if(instance)plan.message='版本 '+instance+' 已就绪；未找到可确认支持 Minecraft '+command.game+' / '+command.loader+' 的「'+command.value+'」。'+plan.message;return {choice:plan};}
   if(plan.type==='catalog-guide')return {guide:plan};
   if(plan.type==='manual-pack'||plan.files.some(f=>f.manual))return {manual:plan};
   const result=await installToken(plan.token,signal);
   return {name:plan.type==='pack'?result:plan.name,target:plan.type==='pack'?result:plan.target.id,count:plan.files.length,kind:command.kind};
 },'搜索并安装「'+String(input?.value||'').slice(0,120)+'」'));
 ipcMain.handle('loader-list',async(_,input)=>{const rows=await get().loaders.list(input.game,input.loader);const ticket=crypto.randomUUID();loaderLists.set(ticket,rows);while(loaderLists.size>5)loaderLists.delete(loaderLists.keys().next().value);return {ticket,rows};});
 ipcMain.handle('loader-install',async(_,input)=>{
   const lookup=(ticket,version)=>loaderLists.get(ticket)?.find(row=>row.version===version);
   const optifine=input.optifine && lookup(input.optifine.ticket,input.optifine.version);
   if(input.optifine && optifine?.loader!=='optifine')throw Error('OptiFine 列表已失效，请重新选择版本');
   const spec=input.ticket?lookup(input.ticket,input.version):optifine && {game:optifine.game};
   if(!spec||spec.loader==='optifine'||(input.game&&input.game!==spec.game))throw Error('加载器列表已失效，请重新选择版本');
   const extras=require('./loader-extras.cjs');extras.checkCombination(spec,optifine);
   return ctx.job(async signal=>{
     const services=get();
     const id=spec.loader==='cleanroom'?await extras.installCleanroom(services,spec,input.name,signal):await services.loaders.install(spec,input.name,signal,optifine);
     await ctx.changed(id);return id;
   },'安装 Minecraft 版本');
 });
 ipcMain.handle('market-open',async(_,value)=>{const url=new URL(httpsURL(value));if(!['modrinth.com','www.curseforge.com','curseforge.com','www.mcmod.cn','search.mcmod.cn','bbsmc.net','github.com','www.bing.com'].includes(url.hostname))throw Error('仅能打开资源平台的官方页面');return shell.openExternal(url.href);});
 return {redact:text=>projectKey?text.replaceAll(projectKey,'[redacted]'):text};
}
module.exports={registerMarket};
