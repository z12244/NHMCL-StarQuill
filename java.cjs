const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const exec=require('node:util').promisify(require('node:child_process').execFile);
function memoryLimit(bytes=os.totalmem()){return Math.max(1,Math.floor(bytes/1024**3));}
function parseJava(text,file){
  const property=name=>text.match(new RegExp('^\\s*'+name.replaceAll('.','\\.')+'\\s*=\\s*(.+)$','m'))?.[1]?.trim();
  const version=property('java.version')||text.match(/version\s+"([^"]+)/i)?.[1];
  const major=Number(version?.replace(/^1\./,'').match(/^\d+/)?.[0]);
  if(!major)throw Error('无法识别 Java 版本');
  const arch=property('os.arch')||(/64-Bit/i.test(text)?'amd64':'x86');
  const native=property('native.encoding')||property('sun.jnu.encoding')||property('file.encoding')||'UTF-8';
  return {path:file,home:property('java.home'),major,version,arch,bits:/64|aarch64/.test(arch)?64:32,vendor:property('java.vendor')||'Java',stdoutEncoding:property('stdout.encoding')||native,stderrEncoding:property('stderr.encoding')||native,description:text.split('\n').find(s=>/version "/.test(s))?.trim()||version};
}
async function inspectJava(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||!/^javaw?\.exe$/i.test(path.basename(file)))throw Error('请选择有效的 java.exe 或 javaw.exe');
  if(/javaw\.exe$/i.test(file))file=path.join(path.dirname(file),'java.exe');
  try{file=await fs.realpath(file);const {stdout,stderr}=await exec(file,['-XshowSettings:properties','-version'],{windowsHide:true,timeout:10000,maxBuffer:256*1024});const info=parseJava(stdout+'\n'+stderr,file);if(info.home){try{info.path=await fs.realpath(path.join(info.home,'bin','java.exe'));}catch{}}return info;}catch{throw Error('Java 无法运行：'+file);}
}
async function registryHomes(){
  const roots=['HKLM\\SOFTWARE\\JavaSoft','HKLM\\SOFTWARE\\Eclipse Adoptium','HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft','HKCU\\SOFTWARE\\JavaSoft'];
  const rows=await Promise.all(roots.map(async key=>{try{return (await exec('reg.exe',['query',key,'/s'],{windowsHide:true,timeout:3000,maxBuffer:1024*1024})).stdout;}catch{return '';}}));
  return rows.join('\n').split(/\r?\n/).map(s=>s.match(/(?:JavaHome|InstallationPath|Path)\s+REG_SZ\s+(.+)/i)?.[1]?.trim()).filter(Boolean);
}
async function scanJava({bundled,selected,root,extraRoots=[],roots,inspect=inspectJava}={}){
  const candidates=new Set(),seen=new Set();let visited=0;
  const add=f=>{if(f)candidates.add(path.resolve(f));};add(bundled);add(selected);
  const dirs=roots||[process.env.JAVA_HOME,process.env.JDK_HOME,...(process.env.PATH||'').split(path.delimiter),...(await registryHomes()),
    ...['ProgramFiles','ProgramFiles(x86)'].flatMap(env=>['Java','Eclipse Adoptium','Microsoft','Zulu','BellSoft','Amazon Corretto','Eclipse Foundation','Semeru'].map(v=>process.env[env]&&path.join(process.env[env],v))),
    path.join(os.homedir(),'.jdks'),path.join(os.homedir(),'.jabba','jdk'),process.env.APPDATA&&path.join(process.env.APPDATA,'.minecraft','runtime'),
    process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs','Eclipse Adoptium'),root&&path.join(root,'runtime'),...extraRoots];
  async function walk(dir,depth){if(!dir||visited++>12000)return;const key=path.resolve(dir).toLowerCase();if(seen.has(key))return;seen.add(key);
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    if(entries.some(e=>e.isFile()&&e.name.toLowerCase()==='java.exe'))add(path.join(dir,entries.find(e=>e.name.toLowerCase()==='java.exe').name));
    if(depth<=0)return;
    for(const e of entries){if(e.isDirectory()&&!e.isSymbolicLink()&&!/^(node_modules|\.git|lib|legal|include|jmods|logs|cache)$/i.test(e.name))await walk(path.join(dir,e.name),depth-1);}
  }
  // PATH entries need only an adjacent bin; known installation roots may be nested.
  const paths=new Set((process.env.PATH||'').split(path.delimiter).map(p=>path.resolve(p).toLowerCase()));
  for(const dir of dirs.filter(Boolean))await walk(dir,paths.has(path.resolve(dir).toLowerCase())?1:5);
  const items=[],unique=new Set(),queue=[...candidates];
  await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(queue.length){const file=queue.shift();try{const item=await inspect(file);const key=item.path.toLowerCase();if(unique.has(key))continue;unique.add(key);item.bundled=!!bundled&&path.resolve(item.path).toLowerCase()===path.resolve(bundled).toLowerCase();items.push(item);}catch{}}}));
  return items.sort((a,b)=>b.major-a.major||b.bits-a.bits||b.version.localeCompare(a.version,undefined,{numeric:true}));
}
function vanillaJava(meta){if(Number.isInteger(meta.javaVersion?.majorVersion))return meta.javaVersion.majorVersion;
  const v=String(meta.id||'').match(/^1\.(\d+)(?:\.(\d+))?/);if(v){const minor=Number(v[1]),patch=Number(v[2]||0);if(minor>20||minor===20&&patch>=5)return 21;if(minor>=18)return 17;if(minor===17)return 16;}return 8;}
function normalizeJavaRequirement(value){
  if(Number.isInteger(value)&&value>0)return {min:value,max:value,preferred:value};
  if(!value||typeof value!=='object')throw Error('Java 兼容范围无效');
  const min=Number(value.min),max=Number(value.max),preferred=Number(value.preferred??min);
  const majors=value.majors===undefined?undefined:[...new Set(value.majors)];
  if(!Number.isInteger(min)||!Number.isInteger(max)||!Number.isInteger(preferred)||min<1||max<min||preferred<min||preferred>max||
    (majors&&(!majors.length||majors.some(v=>!Number.isInteger(v)||v<min||v>max)||!majors.includes(preferred))))throw Error('Java 兼容范围无效');
  return {min,max,preferred,...(majors?{majors:majors.sort((a,b)=>a-b)}:{})};
}
function javaRequirement(meta={}){
  if(meta.starQuill?.java!==undefined)return normalizeJavaRequirement(meta.starQuill.java);
  if(meta.compatibleJavaMajors!==undefined){
    const majors=meta.compatibleJavaMajors;
    if(!Array.isArray(majors)||!majors.length||majors.some(v=>!Number.isInteger(v)||v<1))throw Error('Java 兼容版本列表无效');
    const preferred=majors.includes(meta.javaVersion?.majorVersion)?meta.javaVersion.majorVersion:majors.includes(21)?21:Math.min(...majors);
    return normalizeJavaRequirement({min:Math.min(...majors),max:Math.max(...majors),preferred,majors});
  }
  return normalizeJavaRequirement(vanillaJava(meta));
}
function requiredJava(meta){return javaRequirement(meta).preferred;}
function javaCompatible(major,required){const r=normalizeJavaRequirement(required);return Number.isInteger(major)&&major>=r.min&&major<=r.max&&(!r.majors||r.majors.includes(major));}
function describeJava(required){const r=normalizeJavaRequirement(required);return r.majors&&r.majors.length>1?r.majors.join(' / '):r.min===r.max?String(r.min):`${r.min}–${r.max}`;}
function chooseJava(items,required,memory){const requirement=normalizeJavaRequirement(required),compatible=items.filter(j=>javaCompatible(j.major,requirement)&&j.bits===64&&/amd64|x86_64|x64/i.test(j.arch));
  compatible.sort((a,b)=>Number(b.bundled)-Number(a.bundled)||Number(b.major===requirement.preferred)-Number(a.major===requirement.preferred)||b.major-a.major||b.version.localeCompare(a.version,undefined,{numeric:true}));
  if(!compatible.length)throw Error(`未找到适合此版本的 64 位 Java ${describeJava(requirement)}。请安装后重新扫描，或在 Java 设置中手动选择。`);return compatible[0];}
module.exports={memoryLimit,parseJava,inspectJava,scanJava,requiredJava,javaRequirement,normalizeJavaRequirement,javaCompatible,describeJava,chooseJava};
