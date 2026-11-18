// Upgrade an explicitly named, existing StarQuill pack without touching parents or game data.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {layout,readJSON}=require('../src/storage.cjs'),{noLinks}=require('../src/content-utils.cjs');
const {embedPack,hmclIsolation}=require('../src/pack-layout.cjs');
async function upgrade(root,id) {
 root=path.resolve(root);const p=layout(root,id),marker=path.join(p.version,'starquill-pack.json');
 await noLinks(root,marker);await noLinks(root,p.json);
 const pack=await readJSON(marker),raw=await readJSON(p.json);
 if(!pack.game||raw.id!==id||raw.starQuill?.game!==pack.game)throw Error('不是可确认的星翎整合包：'+id);
 const extendedNatives=raw.libraries?.some(l=>Object.keys(l.natives||{}).some(k=>!['windows','linux','osx'].includes(k)));
 if(raw.inheritsFrom||raw.jar||raw.starQuill.base||extendedNatives){
  const backup=path.join(root,'.starquill','layout-backups',randomUUID(),id+'.json');
  await noLinks(root,backup);await fs.mkdir(path.dirname(backup),{recursive:true});
  await fs.copyFile(p.json,backup,require('node:fs').constants.COPYFILE_EXCL);
  await embedPack(root,id,pack.game);console.log('原配置已备份：'+backup);
 }
 await hmclIsolation(root,id);
}
if(require.main===module)(async()=>{const [root,...ids]=process.argv.slice(2);
 if(!root||!ids.length)throw Error('用法：node scripts/embed-installed-pack.cjs <.minecraft 路径> <整合包目录名> [...]');
 for(const id of ids)await upgrade(root,id);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={upgrade};
