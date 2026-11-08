const path = require('node:path');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {once} = require('node:events');
const {pipeJavaLog} = require('./java-output.cjs');
const exec = promisify(execFile);
const systemTool = name => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);

async function runPreLaunch(command, {cwd, root, version, java, signal, log, encoding}) {
  if (!command.trim()) return;
  signal?.throwIfAborted();
  log('正在执行启动前命令…');
  const windows = process.platform === 'win32';
  const child = spawn(windows ? systemTool('cmd.exe') : '/bin/sh',
    windows ? ['/d', '/s', '/c', '"' + command + '"'] : ['-c', command], {
      cwd, windowsHide: true, windowsVerbatimArguments: windows, stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, STARQUILL_GAME_DIR: cwd, STARQUILL_ROOT: root, STARQUILL_VERSION: version, STARQUILL_JAVA: java}
    });
  const closed = once(child, 'close');
  const cancel = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode) return;
    if (windows) exec(systemTool('taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], {windowsHide:true}).catch(() => child.kill());
    else child.kill();
  };
  signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) cancel();
  pipeJavaLog(child.stdout, encoding, log);
  pipeJavaLog(child.stderr, encoding, log);
  try {
    const [code] = await closed;
    signal?.throwIfAborted();
    if (code !== 0) throw Error('启动前命令执行失败，退出码 ' + code);
    log('启动前命令已完成');
  } finally { signal?.removeEventListener('abort', cancel); }
}

const gpuKey = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
async function gpuValue(executable) {
  const reg = systemTool('reg.exe');
  // reg.exe prints REG_SZ and preference tokens in ASCII on all Windows locales.
  try {
    const {stdout} = await exec(reg, ['query',gpuKey,'/v',executable], {windowsHide:true, timeout:5000});
    const match = stdout.match(/\sREG_SZ\s+([^\r\n]*)/i);
    if (!match) throw Error('Windows 显卡偏好格式无法读取');
    return match[1].trim();
  } catch (e) { if (e.code === 1) return null; throw e; }
}
async function highPerformanceGpu(executable, log) {
  if (process.platform !== 'win32') return;
  const original = await gpuValue(executable);
  if (/(?:^|;)GpuPreference=2(?:;|$)/i.test(original || '')) return;
  const settings = (original || '').split(';').filter(s => s && !/^GpuPreference=/i.test(s));
  const value = [...settings, 'GpuPreference=2', ''].join(';');
  const run = args => exec(systemTool('reg.exe'),args,{windowsHide:true, timeout:5000});
  await run(['add',gpuKey,'/v',executable,'/t','REG_SZ','/d',value,'/f']);
  log('已为本次游戏 Java 设置 Windows 高性能显卡偏好');
  return async () => {
    if (await gpuValue(executable) !== value) return;
    if (original === null) await run(['delete',gpuKey,'/v',executable,'/f']);
    else await run(['add',gpuKey,'/v',executable,'/t','REG_SZ','/d',original,'/f']);
  };
}
module.exports = {runPreLaunch, highPerformanceGpu};
