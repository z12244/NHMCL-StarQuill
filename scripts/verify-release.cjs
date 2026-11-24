// Verifies the release artifacts that are present in dist/ and writes
// dist/verification.json, the file the docs promise next to a release.
//
//   node scripts/verify-release.cjs                 # check what exists
//   node scripts/verify-release.cjs --require-all   # fail unless all three platforms exist
//
// It never downloads anything and never modifies the artifacts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const project = require(path.join(root, 'package.json'));
const display = project.displayVersion || project.version;
const release = project.releaseName || display;
const requireAll = process.argv.includes('--require-all');

const artifacts = [
  {platform: 'windows', file: path.join(dist, `NHMCL-StarQuill-${release}-win-x64.exe`), kind: 'portable-exe'},
  {platform: 'linux', file: path.join(dist, `${release}-linux`), kind: 'single-file-elf'},
  {platform: 'mac-x64', file: path.join(dist, `NHMCL-StarQuill-${release}-mac-x64-untested.zip`), kind: 'app-zip'},
  {platform: 'mac-arm64', file: path.join(dist, `NHMCL-StarQuill-${release}-mac-arm64-untested.zip`), kind: 'app-zip'},
];

const sha256 = file => {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
};

function checksForWindows() {
  const asarFile = process.env.NHMCL_WIN_UNPACKED ? path.join(process.env.NHMCL_WIN_UNPACKED, 'resources', 'app.asar') : path.join(dist, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarFile)) return {skipped: '缺少 dist/win-unpacked/resources/app.asar'};
  const manifest = JSON.parse(asar.extractFile(asarFile, 'package.json').toString());
  const body = fs.readFileSync(asarFile);
  const markers = ['requestSingleInstanceLock', 'RETIRED_CLIENT_ID', 'javaArchSupported']
    .filter(name => body.includes(Buffer.from(name)));
  return {
    displayVersion: manifest.displayVersion,
    main: manifest.main,
    displayVersionMatches: manifest.displayVersion === display,
    mainEntry: manifest.main === 'src/main/main.cjs',
    markers,
    // Packaged apps are read through Electron's own asar layer, which can
    // disagree with the asar package when an archive was rebuilt by hand.
    electronReadsAsar: electronReadsAsarFile(asarFile),
  };
}

function electronReadsAsarFile(asarFile) {
  const exe = path.join(path.dirname(path.dirname(asarFile)), 'NHMCL-StarQuill.exe');
  if (!fs.existsSync(exe)) return {skipped: '缺少 win-unpacked/NHMCL-StarQuill.exe'};
  const code = "const fs=require('fs');const b=fs.readFileSync(process.argv[1]+'/src/shared/storage.cjs');process.stdout.write(b.slice(0,20).toString())";
  try {
    const out = execFileSync(exe, ['-e', code, asarFile], {encoding: 'utf8', timeout: 60000, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
    return {prefix: out, ok: out.startsWith('const fs=require')};
  } catch (error) {
    return {ok: false, error: error.message};
  }
}

function checksForMac(file) {
  const list = execFileSync('tar', ['-tvf', file], {encoding: 'utf8', maxBuffer: 128 * 1024 * 1024});
  const lines = list.split(/\r?\n/).filter(Boolean);
  const symlinks = lines.filter(line => /^l/.test(line)).length;
  const text = list;
  return {
    entries: lines.length,
    symlinks,
    hasAppAsar: /Resources\/app\.asar/.test(text),
    hasWindowsHelper: /\.exe\b/.test(text),
    hasReadme: /README-/.test(text),
  };
}

function main() {
  const results = [];
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact.file)) {
      results.push({...artifact, present: false});
      continue;
    }
    const stat = fs.statSync(artifact.file);
    const entry = {platform: artifact.platform, kind: artifact.kind, file: path.relative(root, artifact.file).split(path.sep).join('/'), present: true, size: stat.size, sha256: sha256(artifact.file)};
    if (artifact.platform === 'windows') entry.checks = checksForWindows();
    if (artifact.platform.startsWith('mac')) entry.checks = checksForMac(artifact.file);
    results.push(entry);
  }

  const missing = results.filter(item => !item.present).map(item => item.platform);
  if (requireAll && missing.length) {
    console.error('缺少产物：' + missing.join(', '));
    process.exitCode = 1;
  }

  const report = {
    release,
    displayVersion: display,
    generatedAt: new Date().toISOString(),
    automatedTests: process.env.NHMCL_TEST_SUMMARY || 'node --test tests/*.test.cjs',
    artifacts: results,
    limitations: [
      'Windows 与 macOS 产物未做商业代码签名；macOS 包未在实机验证。',
      '微软登录为源码预留、发行版不接入，只提供离线与皮肤站登录。',
      'Windows 10 需在实机复测。',
    ],
  };
  fs.writeFileSync(path.join(dist, 'verification.json'), JSON.stringify(report, null, 2));
  for (const item of results) {
    if (!item.present) console.log(`缺失  ${item.platform}`);
    else console.log(`${item.platform.padEnd(10)} ${(item.size / 1048576).toFixed(1)} MB  ${item.sha256}`);
  }
  console.log('已写入 dist/verification.json');
}

main();
