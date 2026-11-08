const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const Zip=require('adm-zip');
const {layout,readJSON,writeJSON,resolveVersion,versionName,under}=require('./storage.cjs');
const {readInstanceConfig,instanceOptions,versionAdvanced,versionKey}=require('./instance-config.cjs');
const {noLinks,exists,relativeFile}=require('./content-utils.cjs');
const {targetInfo}=require('./loaders.cjs');
const {memoryLimit}=require('./java.cjs');
const {readModMetadata}=require('./mod-metadata.cjs');
const advanced=require('./advanced.cjs');
const FOLDERS={mods:'.jar',resourcepacks:'.zip',shaderpacks:'.zip'};
const stamp=s=>s.size+':'+s.mtimeMs;
const metaCache=new Map();
async function registry(folder){try{const r=await readJSON(path.join(folder,'.starquill-content.json'));if(!Array.isArray(r.files))throw Error();return r;}catch(e){if(e.code==='ENOENT')return {schema:1,files:[]};throw Error('资源管理记录损坏，请检查 .starquill-content.json');}}
function metadata(file,kind){return kind==='mods'?readModMetadata(file):{};}
class InstanceManager{
  constructor(root,settings,persist=async()=>{}){this.root=root;this.settings=settings;this.persist=persist;}
  async info(id){const r=await resolveVersion(this.root,id),config=await readInstanceConfig(this.root,id),effective=await instanceOptions(this.root,id,this.settings,r.raw);return {id,config:{...config,advanced:versionAdvanced(this.root,id,this.settings,config)},globalAdvanced:advanced.effective(this.settings.advanced),effective:{advanced:effective.advanced,memory:effective.memory,javaMode:effective.javaMode,java:effective.java,isolate:effective.isolate},target:await targetInfo(this.root,id,this.settings.isolate),forcedIsolation:r.raw.starQuill?.isolate===true,memoryLimit:memoryLimit()};}
  async save(id,c){const info=await this.info(id);if(!['inherit','auto','manual'].includes(c.javaMode)||!['inherit','isolated','shared'].includes(c.isolate))throw Error('版本设置选项无效');if(c.memory!==null&&(!Number.isInteger(c.memory)||c.memory<1||c.memory>memoryLimit()))throw Error('内存设置超出本机物理内存');if(typeof c.java!=='string'||c.java.length>1024||c.javaMode==='manual'&&(!path.isAbsolute(c.java)||path.basename(c.java).toLowerCase()!=='java.exe'))throw Error('请选择有效的 java.exe');if(info.forcedIsolation&&c.isolate==='shared')throw Error('此模组版本 / 整合包使用独立目录，不能关闭隔离');if(typeof c.displayName!=='string'||c.displayName.length>80)throw Error('显示名称最多 80 字');const file=path.join(layout(this.root,id).version,'.starquill-settings.json');await noLinks(this.root,file);
    const chosen=advanced.overrides(c.advanced ?? info.config.advanced);
    const local=Object.fromEntries(['preLaunch','jvmArgs'].filter(k=>Object.hasOwn(chosen,k)).map(k=>[k,chosen[k]]));
    const key=versionKey(this.root,id), previous=this.settings.localVersionArgs;
    this.settings.localVersionArgs={...previous};
    if(Object.keys(local).length)this.settings.localVersionArgs[key]=local;else delete this.settings.localVersionArgs[key];
    try {await this.persist();}catch(error){this.settings.localVersionArgs=previous;throw error;}
    try {await writeJSON(file,{schema:1,advanced:advanced.portableOverrides(chosen),displayName:c.displayName.trim(),javaMode:c.javaMode,java:c.java,memory:c.memory,isolate:c.isolate,...(info.config.portableJava?{portableJava:info.config.portableJava}:{})});}catch(error){this.settings.localVersionArgs=previous;await this.persist();throw error;}return this.info(id);}
  async files(id,kind){if(!FOLDERS[kind])throw Error('资源分类无效');const info=await this.info(id),folder=path.join(info.target.folder,kind);await noLinks(this.root,folder);let entries=[];try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}const records=await registry(info.target.folder),files=[];
    for(const e of entries){if(!e.isFile()||!e.name.toLowerCase().endsWith(FOLDERS[kind])&&!e.name.toLowerCase().endsWith(FOLDERS[kind]+'.disabled'))continue;const file=path.join(folder,e.name),s=await fs.stat(file),record=records.files.find(r=>typeof r.path==='string'&&r.path.toLowerCase()===(kind+'/'+e.name).toLowerCase());const key=file+':'+stamp(s);let m=metaCache.get(key);if(!m){m=metadata(file,kind);metaCache.set(key,m);while(metaCache.size>2048)metaCache.delete(metaCache.keys().next().value);}files.push({name:e.name,title:record?.chineseName||m.title||e.name.replace(/\.disabled$/i,''),version:m.version||'',ids:m.ids||[],disabled:e.name.toLowerCase().endsWith('.disabled'),managed:!!record,size:s.size,stamp:stamp(s)});}
    files.sort((a,b)=>a.disabled-b.disabled||a.title.localeCompare(b.title,'zh-CN',{numeric:true}));return {files,folder,shared:!info.effective.isolate};
  }
  async change(input){const {id,kind,name,operation}=input;if(!FOLDERS[kind]||!['toggle','remove'].includes(operation))throw Error('文件操作无效');versionName(name);if(!name.toLowerCase().endsWith(FOLDERS[kind])&&!name.toLowerCase().endsWith(FOLDERS[kind]+'.disabled'))throw Error('文件类型无效');const info=await this.info(id),folder=info.target.folder,relative=kind+'/'+name,file=under(folder,relative);await noLinks(this.root,file);const stat=await fs.lstat(file);if(!stat.isFile()||stamp(stat)!==input.stamp)throw Error('文件已变化，请刷新后重试');const record=await registry(folder),original=record.files.find(r=>r.path.toLowerCase()===relative.toLowerCase());let destination,trash;
    if(operation==='toggle'){const next=name.toLowerCase().endsWith('.disabled')?name.slice(0,-9):name+'.disabled';destination=under(folder,kind+'/'+next);await noLinks(this.root,destination);if(await exists(destination))throw Error('已存在同名文件，未覆盖');record.files=record.files.map(r=>r===original?{...r,path:kind+'/'+next,disabled:next.endsWith('.disabled')}:r);}
    else{trash=crypto.randomUUID();const dir=path.join(this.root,'.starquill','content-trash',trash);await noLinks(this.root,dir);await fs.mkdir(dir,{recursive:true});destination=path.join(dir,name);await writeJSON(path.join(dir,'record.json'),{schema:1,id,folder,kind,name,record:original,removedAt:new Date().toISOString()});record.files=record.files.filter(r=>r!==original);}
    await fs.rename(file,destination);try{await writeJSON(path.join(folder,'.starquill-content.json'),record);}catch(e){await fs.rename(destination,file);throw e;}return {trash};
  }
  async restore(id,token){if(typeof token!=='string'||!/^[-a-f0-9]{36}$/.test(token))throw Error('撤销编号无效');const dir=path.join(this.root,'.starquill','content-trash',token);await noLinks(this.root,dir);const item=await readJSON(path.join(dir,'record.json')),info=await this.info(id);if(item.id!==id||item.folder!==info.target.folder||!FOLDERS[item.kind])throw Error('版本目录已改变，不能在此处撤销');versionName(item.name);const file=under(info.target.folder,relativeFile(item.kind+'/'+item.name)),source=path.join(dir,item.name);await noLinks(this.root,file);await noLinks(this.root,source);if(await exists(file))throw Error('已有同名文件，请先处理后再撤销');const records=await registry(info.target.folder);if(item.record)records.files.push(item.record);await fs.mkdir(path.dirname(file),{recursive:true});await fs.rename(source,file);try{await writeJSON(path.join(info.target.folder,'.starquill-content.json'),records);}catch(e){await fs.rename(file,source);throw e;}return true;}
  async import(id,kind,sources){if(!FOLDERS[kind]||sources.length>100)throw Error('每次最多导入 100 个资源');const info=await this.info(id),folder=path.join(info.target.folder,kind),existing=(await this.files(id,kind)).files,queue=[],names=new Set(),ids=new Set(existing.flatMap(f=>f.ids));await noLinks(this.root,folder);
    for(const source of sources){const name=versionName(path.basename(source)),key=name.toLowerCase();if(!key.endsWith(FOLDERS[kind]))throw Error('文件类型不匹配：'+name);if(names.has(key)||await exists(path.join(folder,name))||await exists(path.join(folder,name+'.disabled')))throw Error('同名资源已存在：'+name);const s=await fs.stat(source);if(!s.isFile()||s.size>512*1024**2)throw Error('资源文件过大或无效：'+name);const z=new Zip(source);if(!z.getEntries().length)throw Error('资源压缩包为空：'+name);const m=metadata(source,kind),modKeys=m.ids||[];if(modKeys.some(i=>ids.has(i)))throw Error('已存在相同模组 ID，请先移除旧版本：'+name);modKeys.forEach(i=>ids.add(i));names.add(key);queue.push({source,file:path.join(folder,name)});}
    await fs.mkdir(folder,{recursive:true});const copied=[];try{for(const f of queue){await fs.copyFile(f.source,f.file,require('node:fs').constants.COPYFILE_EXCL);copied.push(f.file);}}catch(e){for(const file of copied)await fs.unlink(file);throw e;}return {count:copied.length};
  }
}
function registerInstances(ctx){const {ipcMain,dialog,shell}=ctx;const manager=()=>new InstanceManager(ctx.settings().root,ctx.settings(),ctx.persist);
  let changing=false;async function edit(fn){ctx.idle();if(changing)throw Error('版本操作进行中，请稍候');changing=true;try{return await ctx.job(fn,'正在更新版本设置与文件');}finally{changing=false;}}
  ipcMain.handle('instance-info',(_,id)=>manager().info(id));
  ipcMain.handle('instance-save',(_,input)=>edit(async()=>{const r=await manager().save(input.id,input.config);await ctx.changed();return r;}));
  ipcMain.handle('instance-files',(_,input)=>manager().files(input.id,input.kind));
  ipcMain.handle('instance-file-change',(_,input)=>edit(()=>manager().change(input)));
  ipcMain.handle('instance-restore',(_,input)=>edit(()=>manager().restore(input.id,input.token)));
  ipcMain.handle('instance-import',(_,input)=>edit(async()=>{if(!FOLDERS[input.kind])throw Error('资源分类无效');const r=await dialog.showOpenDialog(ctx.window(),{title:'导入到当前版本（保留原文件）',properties:['openFile','multiSelections'],filters:[{name:'Minecraft 资源',extensions:[FOLDERS[input.kind].slice(1)]}]});if(r.canceled)return null;return manager().import(input.id,input.kind,r.filePaths);}));
  ipcMain.handle('instance-folder',async(_,input)=>{if(!['','mods','resourcepacks','shaderpacks','config','saves','screenshots'].includes(input.kind))throw Error('目录无效');const info=await manager().info(input.id),folder=path.join(info.target.folder,input.kind);await noLinks(ctx.settings().root,folder);await fs.mkdir(folder,{recursive:true});const error=await shell.openPath(folder);if(error)throw Error(error);});
}
module.exports={InstanceManager,registerInstances};
