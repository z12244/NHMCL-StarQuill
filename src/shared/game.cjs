const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');const {promisify}=require('node:util');
const Zip=require('adm-zip');
const {pipeJavaLog}=require('./java-output.cjs');
const {gameWindow,syncGameDisplay}=require('./window-settings.cjs');
const advanced=require('./advanced.cjs');
const {runPreLaunch,highPerformanceGpu,linuxGameEnv}=require('./launch-system.cjs');
const {Downloads,MANIFEST,pool}=require('./downloads.cjs');
const {layout,under,readJSON,writeJSON,resolveVersion,libraryKey}=require('./storage.cjs');
const {inspectJava,requiredJava,javaRequirement,javaCompatible,describeJava,javaArchSupported}=require('./java.cjs');
const exec=promisify(execFile);
function allowed(rules,context={}){
  if(!rules)return true;let allow=false;const name=context.os||({win32:'windows',darwin:'osx',linux:'linux'}[process.platform]);
  const arch=context.arch||(process.arch==='x64'?'amd64':process.arch==='ia32'?'x86':process.arch),version=context.version||os.release();
  for(const rule of rules){if(rule.os?.name&&rule.os.name!==name)continue;if(rule.os?.arch&&!new RegExp(rule.os.arch).test(arch))continue;if(rule.os?.version&&!new RegExp(rule.os.version).test(version))continue;
    if(Object.entries(rule.features||{}).some(([key,value])=>!!context.features?.[key]!==value))continue;allow=rule.action==='allow';}return allow;
}
function maven(name){const [coordinate,extension='jar']=name.split('@');const [group,artifact,version,classifier]=coordinate.split(':');if(!group||!artifact||!version)throw Error('无效的 Maven 坐标：'+name);return `${group.replaceAll('.','/')}/${artifact}/${version}/${artifact}-${version}${classifier?'-'+classifier:''}.${extension}`;}
function classifiedMaven(name,classifier){const [coordinate,extension]=name.split('@');return maven(coordinate.split(':').slice(0,3).join(':')+':'+classifier+(extension?'@'+extension:''));}
function libraryURL(base,relative){return String(base||'https://libraries.minecraft.net/').replace(/^http:/i,'https:').replace(/\/$/,'')+'/'+relative;}
function libraryFiles(meta,paths,context={}){const files=[],classes=[],natives=[];for(const lib of meta.libraries||[]){if(!allowed(lib.rules,context))continue;
    const artifact=lib.downloads?.artifact;const relative=artifact?.path||maven(lib.name);const file=under(paths.libraries,relative);
    // Legacy native-only descriptors have classifiers but no classpath artifact.
    if(artifact||!lib.natives){files.push({...artifact,file,sha1:artifact?.sha1||lib.sha1,size:artifact?.size??lib.size,hashes:lib.sha512||lib.sha256?{sha512:lib.sha512,sha256:lib.sha256}:undefined,url:artifact?.url||(lib.url||!lib.downloads?libraryURL(lib.url,relative):undefined)});classes.push(file);}
    const key=lib.natives?.[context.os || require('./platform.cjs').minecraftOS]?.replace('${arch}','64');
    // Old Forge/MultiMC profiles describe natives with Maven coordinates only.
    // An explicit classifier map is authoritative; do not invent missing OS builds.
    const native=key&&(lib.downloads?.classifiers?.[key]||(!lib.downloads?.classifiers?{url:libraryURL(lib.url,classifiedMaven(lib.name,key))}:undefined));
    if(native){const f=under(paths.libraries,native.path||classifiedMaven(lib.name,key));files.push({...native,file:f});natives.push({file:f,exclude:lib.extract?.exclude||['META-INF/']});}
  }return {files,classes,natives};}
function expand(list,variables){return (list||[]).flatMap(arg=>typeof arg==='string'?[arg]:allowed(arg.rules)?(Array.isArray(arg.value)?arg.value:[arg.value]):[]).map(arg=>{
  if(typeof arg!=='string')throw Error('版本启动参数无效');return arg.replace(/\$\{([^}]+)\}/g,(_,name)=>{if(!(name in variables))throw Error('不支持的启动参数：'+name);return String(variables[name]);});});}
function splitLegacy(text){return (text.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g)||[]).map(s=>s.replace(/^("|')(.*)\1$/,'$2'));}
function offlineUUID(name){const bytes=crypto.createHash('md5').update('OfflinePlayer:'+name).digest();bytes[6]=(bytes[6]&15)|48;bytes[8]=(bytes[8]&63)|128;return bytes.toString('hex');}
// Some mirrors no longer serve this legacy object. Use Mojang's exact bytes
// only for manifests requesting this specific revision of the logging config.
async function supplyLegacyLoggingConfig(descriptor, file, downloads) {
  const sha1 = '50c9cc4af6d853d9fc137c84bcd153e2bd3a9a82';
  if (descriptor.id !== 'client-1.7.xml' || descriptor.sha1?.toLowerCase() !== sha1 ||
      (descriptor.size != null && descriptor.size !== 966)) return;
  if (await downloads.valid({...descriptor, file})) return;
  let bytes;
  try { bytes = await fs.readFile(path.join(__dirname, '..', 'assets', 'log_configs', 'client-1.7.xml')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (crypto.createHash('sha1').update(bytes).digest('hex') !== sha1) return;
  downloads.checkAbort();
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, bytes, {flag:'wx'});
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, {force:true});
  }
}
class Game {
  constructor(options){this.options=options;this.log=options.onLog||(()=>{});this.downloads=new Downloads({root:options.sharedRoot||options.root,mode:options.source||'auto',concurrency:options.concurrency||16,signal:options.signal,onProgress:options.onProgress,onLog:this.log,fetcher:options.fetcher,sourceResolver:options.sourceResolver});}
  async manifest(){if(this.options.getManifest)return this.options.getManifest();try{const data=await this.downloads.json(MANIFEST);await writeJSON(path.join(this.options.root,'.starquill','version_manifest_v2.json'),data);return {versions:data.versions,cached:false};}catch(error){try{return {versions:(await readJSON(path.join(this.options.root,'.starquill','version_manifest_v2.json'))).versions,cached:true};}catch{throw error;}}}
  async resolve(){if(this.resolved)return this.resolved;this.resolved=await resolveVersion(this.options.root,this.options.version,async id=>{this.manifestData ||= await this.manifest();const item=this.manifestData.versions.find(v=>v.id===id);if(!item)throw Error('官方列表中没有版本 '+id+'，请检查是否缺少父版本文件');return this.downloads.json(item.url,item.sha1);});return this.resolved;}
  async prepare({forLaunch=false}={}){const options=advanced.effective(this.options.advanced);
    this.downloads.trustExisting=forLaunch && options.skipFileCheck;
    await this.downloads.init();const {meta,chain,raw}=await this.resolve();const o=this.options,p=layout(o.root,o.version,raw.starQuill?.isolate===true||o.isolate!==false,o.sharedRoot);this.paths=p;
    await fs.mkdir(p.game,{recursive:true});await fs.mkdir(p.natives,{recursive:true});
    if(meta.starQuill?.loader==='cleanroom')await require('./cleanroom-mods.cjs').repairTemplate(o.root,p.game,this.downloads);
    // Use a named custom jar when present, otherwise follow the inherited client jar.
    let jarOwner=chain[0].id,client=chain[0].raw.downloads?.client;
    for(const entry of chain){if(entry.raw.downloads?.client){jarOwner=entry.id;client=entry.raw.downloads.client;}}
    if(meta.jar){jarOwner=meta.jar;client=chain.find(entry=>entry.id===meta.jar)?.raw.downloads?.client||client;}
    const ownJar=layout(o.root,o.version).jar;
    try{await fs.access(ownJar);if(!raw.downloads?.client){jarOwner=o.version;client=undefined;}}catch{}
    const jar=layout(o.root,jarOwner).jar;
    const libs=libraryFiles(meta,p);const files=[{...client,file:jar},...libs.files];
    let index,assetIndex=meta.assetIndex?.id||meta.assets;
    if(assetIndex){
      const indexFile=under(p.assets,'indexes/'+assetIndex+'.json');
      const knownLegacy=new Map([['legacy','770572e819335b6c0a053f8378ad88eda189fc14'],['pre-1.6','3d8e55480977e32acd9844e545177e69a52f594b']]);
      const sha1=knownLegacy.get(assetIndex);
      const descriptor=meta.assetIndex||(sha1?{sha1,url:'https://piston-meta.mojang.com/v1/packages/'+sha1+'/'+assetIndex+'.json'}:{});
      if(descriptor.sha1){
        try{await fs.access(indexFile);}catch{
          const alias=under(p.assets,'indexes/'+o.version+'.json');
          if(await this.downloads.valid({...descriptor,file:alias})){await fs.mkdir(path.dirname(indexFile),{recursive:true});await fs.copyFile(alias,indexFile);}
        }
      }
      this.downloads.stats.total++;
      await this.downloads.ensure({...descriptor,file:indexFile});
      this.downloads.stats.done++;
      index=await readJSON(indexFile);
      if(!index?.objects||typeof index.objects!=='object'||Array.isArray(index.objects))throw Error('资源索引格式无效：'+assetIndex);
      for(const asset of Object.values(index.objects)){if(!asset||!Number.isSafeInteger(asset.size)||asset.size<0||!/^[a-f0-9]{40}$/i.test(asset.hash))throw Error('资源索引包含无效哈希');files.push({assetObject:true,file:under(p.assets,`objects/${asset.hash.slice(0,2)}/${asset.hash}`),sha1:asset.hash,size:asset.size,url:`https://resources.download.minecraft.net/${asset.hash.slice(0,2)}/${asset.hash}`});}
    }
    const logging=meta.logging?.client;let loggingFile;
    if(logging?.file){
      loggingFile=under(p.assets,'log_configs/'+logging.file.id);
      await supplyLegacyLoggingConfig(logging.file,loggingFile,this.downloads);
      files.push({...logging.file,file:loggingFile});
    }
    const stamp=path.join(p.game,'.starquill','prepared-'+crypto.createHash('sha256').update(o.version).digest('hex')+'.json');
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([chain,index,libs,o.java,o.javaMajor,o.javaVersion,this.downloads.trustExisting])).digest('hex');
    let previous;try{previous=await readJSON(stamp);}catch{}
    const prepared=previous?.fingerprint===fingerprint;
    await this.downloads.all(files,{prepared});
    const nativeState={};
    const signature=async file=>{
      const stat=await fs.stat(file);
      return [stat.size,stat.mtimeMs,stat.ctimeMs].join('/');
    };
    let reuseNatives=prepared&&previous.natives;
    if(reuseNatives){
      for(const [file,saved] of Object.entries(previous.natives)){
        try{if(await signature(file)===saved)continue;}catch(error){if(error.code!=='ENOENT')throw error;}
        reuseNatives=false;break;
      }
    }
    if(!reuseNatives)for(const native of libs.natives){
      nativeState[native.file]=await signature(native.file);
      const zip=new Zip(native.file);
      for(const entry of zip.getEntries()){
        if(entry.isDirectory||native.exclude.some(prefix=>entry.entryName.startsWith(prefix)))continue;
        const file=under(p.natives,entry.entryName);
        await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,entry.getData());
        nativeState[file]=await signature(file);
      }
    }
    let gameAssets=p.assets;
    const mappings=[];
    if(index?.virtual)mappings.push(under(p.assets,'virtual/'+assetIndex));
    if(index?.map_to_resources)mappings.push(path.join(p.game,'resources'));
    for(const folder of mappings){
      gameAssets=folder;
      await pool(Object.entries(index.objects),this.downloads.concurrency,async([name,item])=>{
        const target=under(folder,name);
        if(await this.downloads.valid({...item,sha1:item.hash,file:target}))return;
        const source=under(p.assets,'objects/'+item.hash.slice(0,2)+'/'+item.hash);
        await fs.mkdir(path.dirname(target),{recursive:true});
        const temp=target+'.'+crypto.randomUUID()+'.tmp';
        try{await fs.copyFile(source,temp);await fs.rename(temp,target);await this.downloads.valid({...item,sha1:item.hash,file:target});}finally{await fs.rm(temp,{force:true});}
      });
    }
    if(mappings.length)await this.downloads.flush();
    const classpath=[...libs.classes,jar].join(path.delimiter);
    const account=o.account||{type:'offline',name:o.name,uuid:offlineUUID(o.name)};
    const online=account.type==='microsoft',external=account.type==='authlib',authenticated=online||external;if(authenticated&&!account.tokens?.accessToken)throw Error('账号登录已失效，请重新登录');
    const display=o.display||gameWindow(o.windows);
    const variables={natives_directory:p.natives,launcher_name:'NHMCL-StarQuill',launcher_version:require('../../package.json').displayVersion,classpath,classpath_separator:path.delimiter,library_directory:p.libraries,
      auth_player_name:account.name,auth_uuid:account.uuid,auth_access_token:authenticated?account.tokens.accessToken:'0',auth_session:authenticated?`token:${account.tokens.accessToken}:${account.uuid}`:'0',user_type:online?'msa':external?'mojang':'legacy',user_properties:'{}',auth_xuid:online?account.tokens.xuid:'0',clientid:online?account.clientId:'0',
      version_name:o.version,version_type:meta.type||'custom',game_directory:p.game,assets_root:p.assets,assets_index_name:assetIndex||'legacy',game_assets:gameAssets,resolution_width:display.width,resolution_height:display.height};
    let jvm=expand(meta.arguments?.jvm,variables);
    // BootstrapLauncher ignores the vanilla jar by file name. With standard
    // inheritance that file belongs to the parent, not the displayed instance.
    jvm=jvm.map(arg=>arg.startsWith('-DignoreList=')?'-DignoreList='+[...new Set([...arg.slice(13).split(','),path.basename(jar)])].join(','):arg);
    if(!jvm.some(v=>v==='-cp'||v==='-classpath'||v==='--class-path'))jvm.push('-cp',classpath);
    if(!jvm.some(v=>v.startsWith('-Djava.library.path=')))jvm.unshift('-Djava.library.path='+p.natives);
    if(loggingFile&&logging.argument)jvm.push(logging.argument.replace('${path}',loggingFile));
    const gameArgs=meta.minecraftArguments?expand(splitLegacy(meta.minecraftArguments),variables):expand(meta.arguments?.game,variables);
    if(!meta.mainClass)throw Error('版本缺少 mainClass，无法启动');
    const major=Number.isInteger(o.javaMajor)?o.javaMajor:requiredJava(meta), toolsDir=o.toolsDir||path.join(__dirname,'..','..','tools');
    const custom=advanced.splitArguments(options.jvmArgs);
    const gc=advanced.collectorArgs(options.gc,major,custom);
    if(gc.length||custom.some(v=>advanced.collector.test(v)))jvm=jvm.filter(v=>!advanced.collector.test(v));
    const tuning=[...gc];
    if(options.blockModUpdates)tuning.push('-Dfml.disableVersionCheck=true');
    const usesUnsafe=(meta.libraries||[]).some(l=>/^org\.lwjgl:lwjgl:3\.4\.[01](?:$|[@:])/.test(l.name));
    if(!options.disableUnsafeAgent && major>=25 && usesUnsafe)tuning.push('-javaagent:'+path.join(toolsDir,'lwjgl-unsafe-agent-2.0.jar'));
    // RFB and other custom system loaders must see the real classpath at VM startup.
    // A -jar wrapper overrides -cp before that loader can be instantiated.
    const customSystemLoader=[...jvm,...custom,...(o.extraJvmArgs||[])].some(v=>v.startsWith('-Djava.system.class.loader='));
    const wrapper=process.platform==='win32' && major<19 && !options.disableWrapper && !customSystemLoader
      ? ['-jar',path.join(toolsDir,'java_launch_wrapper-1.4.4.jar')] : [];
    const displayArgs=['--width',String(display.width),'--height',String(display.height)];
    if(display.fullscreen)displayArgs.push('--fullscreen');
    const sized=advanced.mergeGameArgs(gameArgs.filter(a=>a!=='--fullscreen'&&!a.startsWith('--fullscreen=')),displayArgs);
    const args=['-Xms512M','-Xmx'+o.memory+'G',...jvm,...tuning,...custom,...(o.extraJvmArgs||[]),...wrapper,meta.mainClass,
      ...advanced.mergeGameArgs(sized,advanced.splitArguments(options.gameArgs))];
    this.log(`文件准备完成：复用 ${this.downloads.stats.reused} 项，下载 ${this.downloads.stats.downloaded} 项`);
    if(!reuseNatives){
      const temp=stamp+'.'+crypto.randomUUID();
      await fs.mkdir(path.dirname(stamp),{recursive:true});
      try{await fs.writeFile(temp,JSON.stringify({fingerprint,natives:nativeState}));await fs.rename(temp,stamp);}finally{await fs.rm(temp,{force:true});}
    }
    return {args,cwd:p.game,jar,assetIndex,paths:p,stats:{...this.downloads.stats},javaVersion:major};
  }
  async launch(){const resolved=await this.resolve(),java=await inspectJava(this.options.java);const required=javaRequirement(resolved.meta);if(!javaCompatible(java.major,required))throw Error(`此版本需要 Java ${describeJava(required)}，当前为 Java ${java.major}。请在设置中选择对应 Java 或启用自动选择。`);
    if(java.bits!==64||!javaArchSupported(java.arch))throw Error('此启动器需要 64 位 Java（x64；Apple Silicon 上可用 arm64），请重新选择 Java。');
    this.options.javaMajor=java.major;this.options.javaVersion=java.version;
    const prepared=await this.prepare({forLaunch:true}), o=this.options, options=advanced.effective(o.advanced);
    this.downloads.checkAbort();
    await runPreLaunch(options.preLaunch,{cwd:prepared.cwd,root:o.root,version:o.version,java:o.java,signal:o.signal,log:this.log,encoding:java.stdoutEncoding});
    this.downloads.checkAbort();await o.beforeSpawn?.(prepared);
    await syncGameDisplay(prepared.cwd,o.display||gameWindow(o.windows));this.downloads.checkAbort();
    if(!prepared.args.some(a=>a.startsWith('-XX:ErrorFile=')))prepared.args.unshift('-XX:ErrorFile='+path.join(prepared.cwd,'hs_err_pid%p.log'));
    let restoreGpu;
    if(options.highPerformance)try {restoreGpu=await highPerformanceGpu(o.java,this.log);}catch(e){this.log('Windows 显卡偏好设置失败，使用系统选择：'+e.message);}
    const restore=()=>restoreGpu?.().catch(e=>this.log('还原 Windows 显卡偏好失败：'+e.message));
    try {this.downloads.checkAbort();
    const child=spawn(this.options.java,prepared.args,{cwd:prepared.cwd,windowsHide:true,detached:false,
      env:await linuxGameEnv(options.highPerformance)});
    child.once('close',restore);
    const started=require('node:events').once(child,'spawn');
    pipeJavaLog(child.stdout,java.stdoutEncoding,this.log);
    pipeJavaLog(child.stderr,java.stderrEncoding,this.log);
    await started;
    this.options.onSpawn?.(child.pid);
    return child;
    } catch(error){await restore();throw error;}
  }
}
module.exports={Game,allowed,maven,libraryFiles,expand,splitLegacy,offlineUUID,inspectJava};
