const path=require('node:path');
const {layout}=require('./storage.cjs');
const {inspectJava,scanJava,chooseJava,normalizeJavaRequirement,javaCompatible,describeJava}=require('./java.cjs');

const JAVA_MODES=['auto','major','folder','manual'];
function validMajor(value){return Number.isInteger(value)&&value>=8&&value<=99;}
function validateJavaSelection(settings,{inherit=false}={}){
 const mode=settings.javaMode;
 if(!JAVA_MODES.includes(mode)&&!(inherit&&mode==='inherit'))throw Error('Java 选择策略无效');
 if(mode==='major'&&!validMajor(settings.javaMajor))throw Error('请选择要自动匹配的 Java 主版本');
 if(typeof settings.java!=='string'||settings.java.length>1024)throw Error('Java 路径无效');
 if(mode==='manual'&&(!path.isAbsolute(settings.java)||!/^javaw?\.exe$/i.test(path.basename(settings.java))))throw Error('请浏览并选择有效的 java.exe 或 javaw.exe');
 return {javaMode:mode,javaMajor:validMajor(settings.javaMajor)?settings.javaMajor:21};
}
function inside(folder,file){const relative=path.relative(path.resolve(folder),path.resolve(file));return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
async function resolveJavaSelection({root,id,settings,required,items=[],inspect=inspectJava,scan=scanJava}){
 const selection=validateJavaSelection({...settings,java:settings.java||'',javaMode:settings.javaMode||(settings.java?'manual':'auto')}),requirement=normalizeJavaRequirement(required);
 let java;
 if(selection.javaMode==='manual')java=await inspect(settings.java);
 else if(selection.javaMode==='folder'){
  if(!id)throw Error('使用版本文件夹中的 Java 需要先选择目标版本；安装新版本时可改用自动选择或指定 Java');
  const folder=layout(root,id).version;
  const local=(await scan({roots:[folder]})).filter(j=>inside(folder,j.path));
  if(!local.length)throw Error('版本文件夹内未找到可运行的 Java：'+folder+'。请放入 JRE/JDK，或改用其他 Java 选择策略');
  java=chooseJava(local,requirement,settings.memory);
 }else{
  const runtimes=typeof items==='function'?await items():await items;
  if(selection.javaMode==='major'){
   if(!javaCompatible(selection.javaMajor,requirement))throw Error(`此版本需要 Java ${describeJava(requirement)}，当前指定自动选择 Java ${selection.javaMajor}；请更换 Java 主版本或使用自动选择`);
   java=chooseJava(runtimes,selection.javaMajor,settings.memory);
  }else java=chooseJava(runtimes,requirement,settings.memory);
 }
 if(!javaCompatible(java.major,requirement))throw Error(`此版本需要 Java ${describeJava(requirement)}，当前选择为 Java ${java.major}；请更换 Java 选择策略`);
 if(java.bits!==64||!/amd64|x86_64|x64/i.test(java.arch||''))throw Error('此启动器需要 Windows x64 Java，请选择 64 位 Java');
 return java;
}
module.exports={JAVA_MODES,validMajor,validateJavaSelection,resolveJavaSelection};
