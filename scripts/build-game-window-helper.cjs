const path=require('node:path');
const {execFileSync}=require('node:child_process');
function buildGameWindowHelper() {
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  execFileSync(compiler,['/nologo','/target:exe','/optimize+','/platform:x64','/out:'+path.join(__dirname,'../tools/game-window-ready.exe'),path.join(__dirname,'GameWindowReady.cs')],{windowsHide:true});
  execFileSync(compiler,['/nologo','/target:exe','/optimize+','/platform:x64','/reference:System.Security.dll','/out:'+path.join(__dirname,'../tools/user-storage-key.exe'),path.join(__dirname,'UserStorageKey.cs')],{windowsHide:true});
}
if(require.main===module)buildGameWindowHelper();
module.exports={buildGameWindowHelper};
