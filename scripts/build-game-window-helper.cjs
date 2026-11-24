const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const tools = path.join(__dirname, '../tools');
const jobs = [
  {source: path.join(__dirname, 'GameWindowReady.cs'), output: path.join(tools, 'game-window-ready.exe'), args: []},
  {source: path.join(__dirname, 'UserStorageKey.cs'), output: path.join(tools, 'user-storage-key.exe'), args: ['/reference:System.Security.dll']},
];

function upToDate(job) {
  try {
    return fs.statSync(job.output).mtimeMs >= fs.statSync(job.source).mtimeMs;
  } catch {
    return false;
  }
}

function buildGameWindowHelper() {
  if (process.platform !== 'win32') return;
  const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(compiler)) throw new Error('未找到 .NET Framework 4.x 编译器：' + compiler);
  for (const job of jobs) {
    // Rebuilding unchanged helpers rewrote committed binaries on every build.
    if (upToDate(job)) continue;
    execFileSync(compiler, ['/nologo', '/target:exe', '/optimize+', '/platform:x64', ...job.args, '/out:' + job.output, job.source], {windowsHide: true});
  }
}
if (require.main === module) buildGameWindowHelper();
module.exports = {buildGameWindowHelper};
