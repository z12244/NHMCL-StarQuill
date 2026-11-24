// Builds the macOS app bundle without a Mac: it downloads the official Electron
// darwin runtime and rewrites that zip entry by entry, keeping the framework
// symlinks as real zip symlink entries (a plain unzip on Windows would flatten
// them and break the .app). The same app.asar as the Windows build is injected,
// Info.plist is patched, and both architectures are written to dist/.
//
// The result is unsigned. macOS Gatekeeper therefore needs the one-time ad-hoc
// signature step documented in the generated README-使用说明.txt.
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const yazl = require('yazl');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build', 'mac');
const cache = path.join(root, 'build', 'cache');
const dist = path.join(root, 'dist');
const pkg = require(path.join(root, 'package.json'));
const productName = pkg.productName || pkg.build?.productName || pkg.name;
const electronVersion = String(require(path.join(root, 'node_modules', 'electron', 'package.json')).version);
const archList = (process.argv.find(a => a.startsWith('--arch='))?.split('=')[1] || 'x64,arm64').split(',').filter(Boolean);

const readme = () => `NHMCL-StarQuill ${pkg.displayVersion || pkg.version} · macOS 使用说明

1. 把本压缩包解压到「应用程序」文件夹（或任意可写目录），得到 ${productName}.app。
   请用 macOS 自带的「归档实用工具」或 ditto 解压；第三方解压工具可能丢失框架符号链接。
2. 首次打开前，在「终端」执行一次 ad-hoc 签名（未使用 Apple 开发者证书，签名会随包不同而失效）：
     xattr -dr com.apple.quarantine "/Applications/${productName}.app"
     codesign --force --deep --sign - "/Applications/${productName}.app"
3. 双击 ${productName}.app 运行。若提示"已损坏"，请重复第 2 步并确认路径正确。

运行要求
- macOS 12 或更高版本；Apple Silicon（arm64）与 Intel（x64）各有一个包，请下载对应架构。
- 本包不内置 Java：首次启动后在「启动设置 → 运行环境」中扫描或手动选择 Java 21（Apple Silicon 需 arm64 JDK，Intel 需 x64 JDK）。游戏版本仍按各自的 Java 要求匹配。
- 账号仅支持离线账号与皮肤站；微软登录未接入。
- 游戏数据与启动器设置保存在 ~/Library/Application Support/NHMCL-StarQuill（.minecraft 与 .starquill-profile），不写入 .app 内部。

已知限制
- 未在 macOS 实机验证；界面按 834×514 逻辑像素设计，窗口不可拖拽。
- 自动隐藏启动器改为按游戏日志判定，可能比 Windows 稍慢；不包含 Windows 专用 helper。
- 本包不含 Apple 公证，分发时请保留本说明。
`;

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function sha256(file) { const h = crypto.createHash('sha256'); for await (const chunk of fssync.createReadStream(file)) h.update(chunk); return h.digest('hex'); }

async function download(url, target) {
  console.log(`下载 ${path.basename(target)} ← ${new URL(url).host} …`);
  const response = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(1200000)});
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}: ${url}`);
  const total = Number(response.headers.get('content-length') || 0);
  const temp = target + '.part';
  await fs.rm(temp, {force: true});
  const out = fssync.createWriteStream(temp);
  let received = 0, reported = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
    if (received - reported > 20 * 1024 * 1024) {
      reported = received;
      console.log(`  ${(received / 1048576).toFixed(0)}${total ? '/' + (total / 1048576).toFixed(0) : ''} MB`);
    }
  }
  await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
  const size = (await fs.stat(temp)).size;
  if (size < 50 * 1024 * 1024) throw new Error('Electron 运行时下载不完整：' + size);
  await fs.rename(temp, target);
  console.log(`  完成 ${(size / 1048576).toFixed(1)} MB`);
}

const electronMirrors = [
  (version, arch) => `https://npmmirror.com/mirrors/electron/${version}/electron-v${version}-darwin-${arch}.zip`,
  (version, arch) => `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-darwin-${arch}.zip`,
];

async function electronZip(arch) {
  const file = path.join(cache, `electron-v${electronVersion}-darwin-${arch}.zip`);
  if (await exists(file)) return file;
  let lastError;
  for (const mirror of electronMirrors) {
    try {
      await download(mirror(electronVersion, arch), file);
      return file;
    } catch (error) {
      lastError = error;
      console.log('  该源失败：' + error.message);
    }
  }
  throw lastError || new Error('无法下载 Electron darwin 运行时');
}

async function stageApp() {
  const stage = path.join(build, 'stage');
  await fs.rm(stage, {recursive: true, force: true});
  await fs.mkdir(stage, {recursive: true});
  await fs.cp(path.join(root, 'src'), path.join(stage, 'src'), {recursive: true});
  await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'), path.join(stage, 'THIRD-PARTY-NOTICES.txt'));
  // Keep runtime entry points, drop build-only tooling from the packaged manifest.
  const manifest = {...pkg, main: 'src/main/main.cjs', scripts: undefined, devDependencies: undefined, build: undefined, overrides: undefined};
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
  await copyProductionModules(stage);
  const out = path.join(build, 'app.asar');
  await asar.createPackage(stage, out);
  return out;
}

// electron-builder packs the production dependency tree automatically; this
// script has to follow the same closure itself so the bundle can start.
async function copyProductionModules(stage) {
  const seen = new Set();
  const modules = path.join(root, 'node_modules');
  async function walk(name) {
    if (seen.has(name) || name.startsWith('@types/')) return;
    seen.add(name);
    const dir = path.join(modules, ...name.split('/'));
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')); }
    catch { return; } // optional dependency that is not installed
    for (const dep of Object.keys(manifest.dependencies || {})) await walk(dep);
    const target = path.join(stage, 'node_modules', ...name.split('/'));
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.cp(dir, target, {recursive: true, dereference: true});
  }
  for (const dep of Object.keys(pkg.dependencies || {})) await walk(dep);
  console.log(`  打包生产依赖 ${seen.size} 个`);
}

const plistValues = {
  CFBundleDisplayName: productName,
  CFBundleName: productName,
  CFBundleIdentifier: pkg.build?.appId || 'cn.starQuill.nhmcl',
  CFBundleExecutable: productName,
  CFBundleShortVersionString: pkg.version.replace(/-.*$/, ''),
  CFBundleVersion: pkg.version.replace(/-.*$/, ''),
};
function patchPlist(text) {
  for (const [key, value] of Object.entries(plistValues)) {
    const pattern = new RegExp(`(<key>${key}<\\/key>\\s*<string>)[^<]*(</string>)`);
    if (!pattern.test(text)) throw new Error('Info.plist 缺少字段：' + key);
    text = text.replace(pattern, `$1${value}$2`);
  }
  return text;
}

function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, {lazyEntries: true, autoClose: true}, (error, zip) => error ? reject(error) : resolve(zip)));
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

// Streams every entry of the Electron zip exactly once. Directory entries carry
// no content, symlinks carry their target path as content.
async function eachEntry(zipFile, handler) {
  const zip = await openZip(zipFile);
  await new Promise((resolve, reject) => {
    zip.once('error', reject);
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) {
        Promise.resolve(handler(entry, null)).then(() => zip.readEntry(), reject);
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        collect(stream).then(buffer => handler(entry, buffer)).then(() => zip.readEntry(), reject);
      });
    });
    zip.once('end', resolve);
    zip.readEntry();
  });
}

const unixMode = entry => (entry.externalFileAttributes >>> 16) & 0xFFFF;
const isSymlink = entry => (unixMode(entry) & 0o170000) === 0o120000;

async function packArch(arch, electronFile, appAsar) {
  console.log(`\n== macOS ${arch} ==`);
  const tmp = path.join(build, 'tmp', arch);
  await fs.rm(tmp, {recursive: true, force: true});
  await fs.mkdir(tmp, {recursive: true});
  const zip = new yazl.ZipFile();
  await fs.mkdir(dist, {recursive: true});
  const artifact = path.join(dist, `${productName}-${pkg.releaseName || pkg.displayVersion || pkg.version}-mac-${arch}-untested.zip`);
  await fs.rm(artifact, {force: true});
  const sink = fssync.createWriteStream(artifact);
  const finished = new Promise((resolve, reject) => { sink.once('close', resolve); sink.once('error', reject); });
  zip.outputStream.pipe(sink);

  const bundle = `${productName}.app`;
  const mapName = name => name.startsWith('Electron.app/') ? bundle + name.slice('Electron.app'.length) : name;
  let index = 0;
  await eachEntry(electronFile, async (entry, buffer) => {
    const name = entry.fileName;
    if (name === 'Electron.app/Contents/Resources/default_app.asar') return;
    if (!buffer) {
      zip.addEmptyDirectory(mapName(name), {mode: unixMode(entry) || 0o40755, mtime: entry.getLastModDate()});
      return;
    }
    const target = path.join(tmp, String(index++));
    if (name === 'Electron.app/Contents/Info.plist') await fs.writeFile(target, patchPlist(buffer.toString('utf8')));
    else await fs.writeFile(target, buffer);
    const renamed = name === 'Electron.app/Contents/MacOS/Electron' ? 'Electron.app/Contents/MacOS/' + productName : name;
    zip.addFile(target, mapName(renamed), {mode: unixMode(entry) || 0o100644, mtime: entry.getLastModDate()});
  });

  const res = `${bundle}/Contents/Resources`;
  zip.addFile(appAsar, `${res}/app.asar`, {mode: 0o100644, mtime: new Date()});
  const tools = (await fs.readdir(path.join(root, 'tools'))).filter(name => !/\.exe$/i.test(name));
  for (const name of tools) zip.addFile(path.join(root, 'tools', name), `${res}/tools/${name}`, {mode: /\.sh$/.test(name) ? 0o100755 : 0o100644, mtime: new Date()});
  const runtime = path.join(root, `runtime-darwin-${arch}`);
  if (await exists(runtime)) {
    console.log('  注入 runtime-darwin-' + arch);
    await addTree(zip, runtime, `${res}/runtime-${arch}`);
  } else console.log('  提示：未提供 runtime-darwin-' + arch + '，此包使用系统 Java。');
  zip.addBuffer(Buffer.from(readme(), 'utf8'), 'README-使用说明.txt', {mode: 0o100644, mtime: new Date()});

  zip.end();
  await finished;
  console.log(`  ${path.basename(artifact)}  ${((await fs.stat(artifact)).size / 1048576).toFixed(1)} MB  sha256=${await sha256(artifact)}`);
  return artifact;
}

async function addTree(zip, dir, prefix) {
  for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    const source = path.join(dir, item.name), name = `${prefix}/${item.name}`;
    if (item.isDirectory()) { zip.addEmptyDirectory(name, {mode: 0o40755, mtime: new Date()}); await addTree(zip, source, name); }
    else zip.addFile(source, name, {mode: 0o100644, mtime: new Date()});
  }
}

(async () => {
  await fs.mkdir(cache, {recursive: true});
  await fs.mkdir(dist, {recursive: true});
  const appAsar = await stageApp();
  const artifacts = [];
  for (const arch of archList) {
    if (!['x64', 'arm64'].includes(arch)) throw new Error('未知架构：' + arch);
    artifacts.push(await packArch(arch, await electronZip(arch), appAsar));
  }
  console.log('\n完成：');
  for (const artifact of artifacts) console.log('  ' + path.relative(root, artifact));
})().catch(error => { console.error('\n构建失败：' + error.message); process.exitCode = 1; });
