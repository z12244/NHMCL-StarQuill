const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const {redact} = require('./core.cjs');
const {noLinks} = require('./content-utils.cjs');
const FILE_LIMIT = 16 * 1024 * 1024;
const REPORT_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{12}$/;

function logBuffer(limit = FILE_LIMIT) {
  const parts = []; let bytes = 0;
  return {
    append(text) {
      let b = Buffer.from(String(text));
      if (b.length > limit) b = b.subarray(-limit);
      parts.push(b); bytes += b.length;
      while (bytes > limit && parts.length > 1) bytes -= parts.shift().length;
    },
    text: () => Buffer.concat(parts).toString('utf8')
  };
}

function analyzeCrash(text, code, signal) {
  const findings = [];
  const rules = [
    ['heap', /OutOfMemoryError:\s*(?:Java heap space|GC overhead limit exceeded)|Out of memory!/i, '游戏堆内存不足', '在有足够可用内存时适当提高分配；也可减少模组、视距或资源包。'],
    ['native-memory', /There is insufficient memory|Native memory allocation.*failed|Could not reserve enough space|unable to create native thread|OutOfMemoryError:\s*(?:Direct buffer memory|Metaspace)/i, '系统或 Java 本地内存不足', '关闭不需要的程序，并给 Windows 留出内存；不要继续盲目提高游戏最大内存。'],
    ['java', /UnsupportedClassVersionError|compiled by a more recent version|class file version .*only recognizes|Unrecognized VM option|Invalid maximum heap size/i, 'Java 版本或启动参数不兼容', '先启用自动匹配 Java，核对版本设置中的手动 Java 与额外启动参数。'],
    ['dependency', /Missing (?:mandatory|required) dependencies|requires? .*which is missing|requires? .*not installed|ModResolutionException|Incompatible mod set|MissingModsException/i, '可能缺少前置模组或模组版本不兼容', '查看日志列出的模组和版本要求，安装对应前置，并核对 Minecraft 与加载器版本。'],
    ['duplicate', /DuplicateModsFoundException|Found duplicate mods|Duplicate mods/i, '可能安装了重复模组', '在版本设置中检查同一模组的多个文件，暂时禁用重复版本后重试。'],
    ['mixin', /MixinApplyError|MixinTransformerError|InvalidMixinException|InjectionError|Mixin apply .*failed/i, '模组注入失败，可能存在版本冲突', '查看下方线索涉及的模组；更新或逐个禁用最近新增的模组，核对加载器版本。'],
    ['graphics', /GLFW error 65542|does not support OpenGL|Failed to create (?:a )?(?:GLFW|OpenGL).*window|Pixel format not accelerated|Problematic frame[^\n]*\n[^\n]*(?:nvoglv|atio6axx|ig.*(?:icd|gl))/i, '可能与显卡驱动或 OpenGL 支持有关', '检查游戏版本要求及显卡驱动；若使用渲染模组或光影，先禁用后重试。'],
    ['disk', /No space left on device|There is not enough space on the disk|磁盘空间不足|ENOSPC/i, '磁盘空间不足', '为游戏目录和系统临时目录所在磁盘释放空间，然后重新启动。'],
    ['native', /EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime Environment|SIGSEGV/i, 'Java 或本地组件发生致命错误', '结合 hs_err 文件中的 Problematic frame 检查 Java、显卡驱动和本地组件；退出码本身不能确定具体原因。']
  ];
  for (const [id, pattern, title, suggestion] of rules) {
    const match = pattern.exec(text);
    if (match) {
      const start = text.lastIndexOf('\n', match.index) + 1;
      const end = text.indexOf('\n', match.index + match[0].length);
      findings.push({id, title, suggestion, evidence: text.slice(start, end < 0 ? start + 600 : Math.min(end, start + 600)).trim()});
    }
  }
  if (!findings.length) findings.push({id: 'unknown', title: '暂未识别出明确原因', suggestion: '查看报告中的日志末尾与崩溃文件；可先禁用最近新增的模组，再核对 Java 和加载器。', evidence: `退出代码：${code ?? '无'}；信号：${signal || '无'}`});
  return findings;
}

async function fatalFiles(root, gameDir) {
  const result = [];
  for (const [folder, pattern] of [[path.join(gameDir, 'crash-reports'), /^crash-.*\.txt$/i], [gameDir, /^hs_err_pid\d+\.log$/i]]) {
    await noLinks(root, folder);
    const names = await fs.readdir(folder).catch(e => {if (e.code === 'ENOENT') return []; throw e;});
    for (const name of names.filter(name => pattern.test(name))) {
      const file = path.join(folder, name), stat = await fs.lstat(file).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) result.push({file, size: stat.size, mtime: stat.mtimeMs});
    }
  }
  return result.sort((a, b) => b.mtime - a.mtime);
}

async function crashBaseline(root, gameDir) {
  return new Map((await fatalFiles(root, gameDir)).map(f => [f.file, `${f.mtime}:${f.size}`]));
}
async function freshFatalFiles(context) {
  const files = await fatalFiles(context.root, context.gameDir);
  return files.filter(f => f.mtime >= context.startedAt - 1500 && context.baseline?.get(f.file) !== `${f.mtime}:${f.size}`).slice(0, 6);
}
function unexpectedExit(code, signal, manual, freshCount = 0, error = '') {
  return !manual && (code !== 0 || !!signal || freshCount > 0 || !!error);
}

async function readLog(root, file, preserveHead = false) {
  await noLinks(root, file);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error('不是普通日志文件');
    if (preserveHead && stat.size > FILE_LIMIT) {
      const head = Buffer.alloc(FILE_LIMIT / 4), tail = Buffer.alloc(FILE_LIMIT * 3 / 4);
      const first = await handle.read(head, 0, head.length, 0), last = await handle.read(tail, 0, tail.length, stat.size - tail.length);
      return head.subarray(0, first.bytesRead).toString('utf8') + '\n[文件过大，中间内容省略]\n' + tail.subarray(0, last.bytesRead).toString('utf8');
    }
    const size = Math.min(stat.size, FILE_LIMIT), bytes = Buffer.alloc(size);
    const {bytesRead} = await handle.read(bytes, 0, size, Math.max(0, stat.size - size));
    return (stat.size > size ? '[日志过大，仅保留末尾 16 MiB]\n' : '') + bytes.subarray(0, bytesRead).toString('utf8');
  } finally {await handle.close();}
}

async function exportCrash(context, {code, signal, error = '', fatal = []}, sanitize = redact) {
  const clean = text => redact(sanitize(String(text)));
  const entries = [], notes = [];const events=await require('./windows-events.cjs').windowsEvents(context);notes.push(events.status);if(events.xml)entries.push({name:'windows-events.xml',text:clean(events.xml)});
  if(context.pid){for(const folder of [...new Set([process.env.TMP,process.env.TEMP,require('node:os').tmpdir()].filter(Boolean))]){
    const file=path.join(folder,'hs_err_pid'+context.pid+'.log');
    try{const s=await fs.lstat(file);if(s.isFile()&&!s.isSymbolicLink()&&s.mtimeMs>=context.startedAt-1500)entries.push({name:'native-fallback/hs_err_pid'+context.pid+'.log',text:clean(await readLog(folder,file,true))});}catch(e){if(e.code!=='ENOENT')notes.push('临时目录 JVM 日志读取失败：'+e.code);}
    if(entries.length)break;
  }}
  if(context.environment)entries.push({name:'environment.json',text:clean(JSON.stringify({...context.environment,pid:context.pid,startedAt:new Date(context.startedAt).toISOString(),exitMemory:require('./memory.cjs').memorySnapshot()},null,2))});
  entries.push({name: 'launcher.log', text: clean(context.logs.text())});
  for (const name of ['latest.log', 'debug.log']) {
    const file = path.join(context.gameDir, 'logs', name);
    try {
      await noLinks(context.root, file);
      const stat = await fs.stat(file);
      if (stat.mtimeMs < context.startedAt - 1500) {notes.push(`${name} 未在本次运行更新，未收录。`); continue;}
      entries.push({name: 'logs/' + name, text: clean(await readLog(context.root, file))});
    } catch (e) {notes.push(clean(`${name} 未收录：${e.code || e.message}`));}
  }
  for (const item of fatal.slice(0, 6)) {
    try {entries.push({name: 'crash-reports/' + path.basename(item.file), text: clean(await readLog(context.root, item.file, true))});}
    catch (e) {notes.push(clean(`${path.basename(item.file)} 未收录：${e.code || e.message}`));}
  }
  const combined=entries.filter(e=>e.name!=='environment.json').map(e=>e.text).join('\n');
  const hasNative=/EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected|Problematic frame:/i.test(combined),hasStack=/^\s*at [\w.$]+\([^\n]+\)/m.test(combined);
  const findings = analyzeCrash(combined + '\n' + clean(error), code, signal);
  const signed=Number.isInteger(code)?code|0:null,hex=Number.isInteger(code)?'0x'+(code>>>0).toString(16).padStart(8,'0').toUpperCase():null;
  notes.push('退出码：原始 '+code+'；有符号 '+signed+'；十六进制 '+hex+'。退出码不能单独证明崩溃原因。');
  notes.push(hasNative?'已收录 JVM 原生崩溃信息。':'未发现 JVM 原生崩溃文件：进程可能未生成文件、被外部终止，或文件无法写入。不能凭空恢复堆栈。');
  notes.push(hasStack?'已收录 Java 调用栈。':'未发现 Java 调用栈；最后输出日志的模组仅是时间线线索，不能据此认定原因。');
  if(context.memory<=4)notes.push('分配内存为 '+context.memory+' GB。大型整合包可在系统可用内存充足时尝试提高分配；当前记录本身不能证明内存不足。');
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(6).toString('hex');
  const report = {id, createdAt: new Date().toISOString(), version: context.version, exitCode: code, exitCodeSigned:signed, exitCodeHex:hex, evidence:{javaStack:hasStack,nativeCrash:hasNative}, environment:context.environment, pid:context.pid, signal: signal || '', error: clean(error), java: context.java, memoryGB: context.memory, findings, notes, files: entries.map(e => e.name)};
  notes.forEach(note=>findings.push({id:'collection',title:'采集与诊断说明',suggestion:note,evidence:''}));
  const analysis = ['NHMCL-StarQuill · 游戏意外退出报告', `版本：${report.version}`, `时间：${report.createdAt}`, `退出代码：${code ?? '无'}；信号：${signal || '无'}`, `Java：${report.java || '未知'}；分配内存：${report.memoryGB} GB`, '', '以下是基于日志关键词的初步判断，可能同时存在多个问题。', ...findings.flatMap(f => ['', '可能原因：' + f.title, '建议：' + f.suggestion, '日志线索：' + f.evidence]), '', '收集说明：仅本地保存，不自动上传。已过滤常见令牌和密码；分享前请检查玩家名、服务器地址和本地路径等个人信息。', '每份日志最多收集 16 MiB；普通日志保留末尾，过大的崩溃文件保留开头和末尾。最多收集 6 份本次新增或更新的崩溃文件。', ...notes].join('\r\n');
  const dir = path.join(context.root, '.starquill', 'crash-reports');
  await noLinks(context.root, dir);
  await fs.mkdir(dir, {recursive: true});
  const zip = new Zip();
  for (const entry of entries) zip.addFile(entry.name, Buffer.from(entry.text));
  zip.addFile('分析报告.txt', Buffer.from(clean(analysis)));
  zip.addFile('report.json', Buffer.from(clean(JSON.stringify(report, null, 2))));
  const file = path.join(dir, id + '.zip'), temp = file + '.tmp';
  try {
    await fs.writeFile(temp, await zip.toBufferPromise(), {flag: 'wx'});
    await fs.rename(temp, file);
  } catch (e) {await fs.unlink(temp).catch(() => {}); throw e;}
  // The archive is already complete even if remembering the latest report fails.
  try {await noLinks(context.root, path.join(dir, 'latest.json'));await fs.writeFile(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2));} catch {}
  return {...report, file};
}

async function latestCrash(root) {
  const dir = path.join(root, '.starquill', 'crash-reports'), pointer = path.join(dir, 'latest.json');
  try {
    await noLinks(root, pointer);
    if ((await fs.stat(pointer)).size > 128 * 1024) return null;
    const report = JSON.parse(await fs.readFile(pointer, 'utf8'));
    if (!REPORT_ID.test(report.id) || !Array.isArray(report.findings)) return null;
    const file = path.join(dir, report.id + '.zip');
    await noLinks(root, file);
    if (!(await fs.stat(file)).isFile()) return null;
    return {...report, file};
  } catch {return null;}
}
module.exports = {logBuffer, analyzeCrash, crashBaseline, freshFatalFiles, unexpectedExit, exportCrash, latestCrash};
