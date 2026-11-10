const path=require('node:path');
const {layout,readJSON,under}=require('./storage.cjs');
const {memoryLimit}=require('./java.cjs');
const {JAVA_MODES,validMajor}=require('./java-selection.cjs');
const advanced=require('./advanced.cjs');
function versionKey(root,id){return path.resolve(layout(root,id).version).toLowerCase();}
function versionAdvanced(root,id,global,config){
  return {...advanced.portableOverrides(config.advanced), ...advanced.overrides(global.localVersionArgs?.[versionKey(root,id)])};
}
async function readInstanceConfig(root,id){
  try{return await readJSON(path.join(layout(root,id).version,'.starquill-settings.json'));}
  catch(e){if(e.code==='ENOENT')return {};throw Error('版本独立设置损坏，请检查 .starquill-settings.json');}
}
async function instanceOptions(root,id,global,raw){
  const c=await readInstanceConfig(root,id);
  const memory=Math.min(memoryLimit(),Math.max(1,Number.isInteger(c.memory)?c.memory:global.memory||4));
  const ownJava=JAVA_MODES.includes(c.javaMode);
  let javaMode=ownJava?c.javaMode:global.javaMode||'auto';
  const javaMajor=validMajor(ownJava?c.javaMajor:global.javaMajor)?(ownJava?c.javaMajor:global.javaMajor):21;
  let java=c.javaMode==='manual'?c.java:global.java;
  if(c.portableJava&&javaMode==='auto'){if(!/^runtime\/starquill-pack-[a-f0-9]+\/bin\/java\.exe$/.test(c.portableJava))throw Error('离线包 Java 路径无效');java=under(root,c.portableJava);javaMode='manual';}
  const isolate=raw?.starQuill?.isolate===true|| (c.isolate==='isolated'?true:c.isolate==='shared'?false:global.isolate!==false);
  return {...global,memory,javaMode,javaMajor,java,isolate,advanced:advanced.effective(global.advanced,versionAdvanced(root,id,global,c)),displayName:c.displayName||id};
}
module.exports={readInstanceConfig,instanceOptions,versionKey,versionAdvanced};
