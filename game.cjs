const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');const {promisify}=require('node:util');
const Zip=require('adm-zip');
const {Downloads,MANIFEST}=require('./downloads.cjs');
const {layout,under,readJSON,writeJSON,resolveVersion,libraryKey}=require('./storage.cjs');
const {inspectJava,requiredJava}=require('./java.cjs');
const exec=promisify(execFile);
function allowed(rules,context={}){
  if(!rules)return true;let allow=false;const name=context.os||({win32:'windows',darwin:'osx',linux:'linux'}[process.platform]);
  const arch=context.arch||(process.arch==='x64'?'amd64':process.arch==='ia32'?'x86':process.arch),version=context.version||os.release();
  for(const rule of rules){if(rule.os?.name&&rule.os.name!==name)continue;if(rule.os?.arch&&!new RegExp(rule.os.arch).test(arch))continue;if(rule.os?.version&&!new RegExp(rule.os.version).test(version))continue;
    if(Object.entries(rule.features||{}).some(([key,value])=>!!context.features?.[key]!==value))continue;allow=rule.action==='allow';}return allow;
}
function maven(name){const [coordinate,extension='jar']=name.split('@');const [group,artifact,version,classifier]=coordinate.split(':');if(!group||!artifact||!version)throw Error('无效的 Maven 坐标：'+name);return `${group.replaceAll('.','/')}/${artifact}/${version}/${artifact}-${version}${classifier?'-'+classifier:''}.${extension}`;}
function libraryFiles(meta,paths){const files=[],classes=[],natives=[];for(const lib of meta.libraries||[]){if(!allowed(lib.rules))continue;
    const artifact=lib.downloads?.artifact;const relative=artifact?.path||maven(lib.name);const file=under(paths.libraries,relative);
    // Legacy native-only descriptors have classifiers but no classpath artifact.
    if(artifact||!lib.natives){files.push({...artifact,file,sha1:artifact?.sha1||lib.sha1,size:artifact?.size??lib.size,hashes:lib.sha512||lib.sha256?{sha512:lib.sha512,sha256:lib.sha256}:undefined,url:artifact?.url||(lib.url?lib.url.replace(/\/$/,'')+'/'+relative:(!lib.downloads?'https://libraries.minecraft.net/'+relative:undefined))});classes.push(file);}
    const key=lib.natives?.windows?.replace('${arch}','64');const native=key&&lib.downloads?.classifiers?.[key];
    if(native){const f=under(paths.libraries,native.path||maven(lib.name+':'+key));files.push({...native,file:f});natives.push({file:f,exclude:lib.extract?.exclude||['META-INF/']});}
  }return {files,classes,natives};}
function expand(list,variables){return (list||[]).flatMap(arg=>typeof arg==='string'?[arg]:allowed(arg.rules)?(Array.isArray(arg.value)?arg.value:[arg.value]):[]).map(arg=>{
  if(typeof arg!=='string')throw Error('版本启动参数无效');return arg.replace(/\$\{([^}]+)\}/g,(_,name)=>{if(!(name in variables))throw Error('不支持的启动参数：'+name);return String(variables[name]);});});}
function splitLegacy(text){return (text.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g)||[]).map(s=>s.replace(/^("|')(.*)\1$/,'$2'));}
function offlineUUID(name){const bytes=crypto.createHash('md5').update('OfflinePlayer:'+name).digest();bytes[6]=(bytes[6]&15)|48;bytes[8]=(bytes[8]&63)|128;return bytes.toString('hex');}
class Game {
  constructor(options){this.options=options;this.log=options.onLog||(()=>{});this.downloads=new Downloads({root:options.root,mode:options.source||'auto',concurrency:options.concurrency||16,signal:options.signal,onProgress:options.onProgress,onLog:this.log,fetcher:options.fetcher,sourceResolver:options.sourceResolver});}
  async manifest(){if(this.options.getManifest)return this.options.getManifest();try{const data=await this.downloads.json(MANIFEST);await writeJSON(path.join(this.options.root,'.starquill','version_manifest_v2.json'),data);return {versions:data.versions,cached:false};}catch(error){try{return {versions:(await readJSON(path.join(this.options.root,'.starquill','version_manifest_v2.json'))).versions,cached:true};}catch{throw error;}}}
  async resolve(){if(this.resolved)return this.resolved;this.resolved=await resolveVersion(this.options.root,this.options.version,async id=>{this.manifestData ||= await this.manifest();const item=this.manifestData.versions.find(v=>v.id===id);if(!item)throw Error('官方列表中没有版本 '+id+'，请检查是否缺少父版本文件');return this.downloads.json(item.url,item.sha1);});return this.resolved;}
  async prepare(){await this.downloads.init();const {meta,chain,raw}=await this.resolve();const o=this.options,p=layout(o.root,o.version,raw.starQuill?.isolate===true||o.isolate!==false);this.paths=p;
    await fs.mkdir(p.game,{recursive:true});await fs.mkdir(p.natives,{recursive:true});
    // Use a named custom jar when present, otherwise follow the inherited client jar.
    let jarOwner=chain[0].id,client=chain[0].raw.downloads?.client;
    for(const entry of chain){if(entry.raw.downloads?.client){jarOwner=entry.id;client=entry.raw.downloads.client;}}
    if(meta.jar){jarOwner=meta.jar;client=chain.find(entry=>entry.id===meta.jar)?.raw.downloads?.client||client;}
    const ownJar=layout(o.root,o.version).jar;
    try{await fs.access(ownJar);if(!raw.downloads?.client){jarOwner=o.version;client=undefined;}}catch{}
    const jar=layout(o.root,jarOwner).jar;
    const libs=libraryFiles(meta,p);const files=[{...client,file:jar},...libs.files];
    let index,assetIndex=meta.assetIndex?.id||meta.assets;
    if(meta.assetIndex){const indexFile=under(p.assets,'indexes/'+assetIndex+'.json');
      // Migrate the old Aster/MCLC alias without creating a second download.
      try{await fs.access(indexFile);}catch{try{const alias=under(p.assets,'indexes/'+o.version+'.json');const candidate={file:alias,sha1:meta.assetIndex.sha1,size:meta.assetIndex.size};if(await this.downloads.valid(candidate)){await fs.mkdir(path.dirname(indexFile),{recursive:true});await fs.copyFile(alias,indexFile);}}catch{}}
      this.downloads.stats.total++;await this.downloads.ensure({...meta.assetIndex,file:indexFile});this.downloads.stats.done++;index=await readJSON(indexFile);
      for(const asset of Object.values(index.objects||{})){if(!/^[a-f0-9]{40}$/i.test(asset.hash))throw Error('资源索引包含无效哈希');files.push({file:under(p.assets,`objects/${asset.hash.slice(0,2)}/${asset.hash}`),sha1:asset.hash,size:asset.size,url:`https://resources.download.minecraft.net/${asset.hash.slice(0,2)}/${asset.hash}`});}
    }
    const logging=meta.logging?.client;let loggingFile;
    if(logging?.file){loggingFile=under(p.assets,'log_configs/'+logging.file.id);files.push({...logging.file,file:loggingFile});}
    await this.downloads.all(files);
    for(const native of libs.natives){const zip=new Zip(native.file);for(const entry of zip.getEntries()){if(entry.isDirectory||native.exclude.some(prefix=>entry.entryName.startsWith(prefix)))continue;const file=under(p.natives,entry.entryName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,entry.getData());}}
    let gameAssets=p.assets;
    if(index?.virtual||index?.map_to_resources){gameAssets=index.map_to_resources?path.join(p.game,'resources'):under(p.assets,'virtual/'+assetIndex);for(const [name,item]of Object.entries(index.objects)){const target=under(gameAssets,name);try{await fs.access(target);}catch{await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(under(p.assets,`objects/${item.hash.slice(0,2)}/${item.hash}`),target);}}}
    const classpath=[...libs.classes,jar].join(path.delimiter);
    const account=o.account||{type:'offline',name:o.name,uuid:offlineUUID(o.name)};
    const online=account.type==='microsoft',external=account.type==='authlib',authenticated=online||external;if(authenticated&&!account.tokens?.accessToken)throw Error('账号登录已失效，请重新登录');
    const variables={natives_directory:p.natives,launcher_name:'NHMCL-StarQuill',launcher_version:'beta-0.8.6',classpath,classpath_separator:path.delimiter,library_directory:p.libraries,
      auth_player_name:account.name,auth_uuid:account.uuid,auth_access_token:authenticated?account.tokens.accessToken:'0',auth_session:authenticated?`token:${account.tokens.accessToken}:${account.uuid}`:'0',user_type:online?'msa':external?'mojang':'legacy',user_properties:'{}',auth_xuid:online?account.tokens.xuid:'0',clientid:online?account.clientId:'0',
      version_name:o.version,version_type:meta.type||'custom',game_directory:p.game,assets_root:p.assets,assets_index_name:assetIndex||'legacy',game_assets:gameAssets,resolution_width:'1100',resolution_height:'700'};
    let jvm=expand(meta.arguments?.jvm,variables);
    // BootstrapLauncher ignores the vanilla jar by file name. With standard
    // inheritance that file belongs to the parent, not the displayed instance.
    jvm=jvm.map(arg=>arg.startsWith('-DignoreList=')?'-DignoreList='+[...new Set([...arg.slice(13).split(','),path.basename(jar)])].join(','):arg);
    if(!jvm.some(v=>v==='-cp'||v==='-classpath'||v==='--class-path'))jvm.push('-cp',classpath);
    if(!jvm.some(v=>v.startsWith('-Djava.library.path=')))jvm.unshift('-Djava.library.path='+p.natives);
    if(loggingFile&&logging.argument)jvm.push(logging.argument.replace('${path}',loggingFile));
    const gameArgs=meta.minecraftArguments?expand(splitLegacy(meta.minecraftArguments),variables):expand(meta.arguments?.game,variables);
    if(!meta.mainClass)throw Error('版本缺少 mainClass，无法启动');
    const args=[`-Xms512M`,`-Xmx${o.memory}G`,...(o.extraJvmArgs||[]),...jvm,meta.mainClass,...gameArgs];
    this.log(`文件准备完成：复用 ${this.downloads.stats.reused} 项，下载 ${this.downloads.stats.downloaded} 项`);
    return {args,cwd:p.game,jar,assetIndex,paths:p,stats:{...this.downloads.stats},javaVersion:requiredJava(meta)};
  }
  async launch(){const resolved=await this.resolve(),java=await inspectJava(this.options.java);const required=requiredJava(resolved.meta);if(java.major!==required)throw Error(`此版本需要 Java ${required}，当前为 Java ${java.major}。请在设置中选择对应 java.exe 或启用自动选择。`);
    if(java.bits!==64||!/amd64|x86_64|x64/i.test(java.arch))throw Error('此启动器需要 x64 架构的 Java，请选择 64 位 Windows Java。');
    const prepared=await this.prepare();this.downloads.checkAbort();await this.options.beforeSpawn?.(prepared);this.downloads.checkAbort();prepared.args=prepared.args.filter(a=>!a.startsWith('-XX:ErrorFile=')&&a!=='-XX:+OmitStackTraceInFastThrow');prepared.args.unshift('-XX:ErrorFile='+path.join(prepared.cwd,'hs_err_pid%p.log'),'-XX:-OmitStackTraceInFastThrow');const child=spawn(this.options.java,prepared.args,{cwd:prepared.cwd,windowsHide:true,detached:false});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');this.options.onSpawn?.(child.pid);child.stdout.on('data',d=>this.log(d.toString()));child.stderr.on('data',d=>this.log(d.toString()));return child;}
}
module.exports={Game,allowed,maven,libraryFiles,expand,splitLegacy,offlineUUID,inspectJava};
