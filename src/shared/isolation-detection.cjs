const fs = require('node:fs/promises');
const path = require('node:path');
const { layout, scan } = require('./storage.cjs');

const UNKNOWN = 'unknown';
const isolated = 'isolated', shared = 'shared';
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.relative(a, b) === '';

async function text(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return '';
    const bytes = await fs.readFile(file);
    return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  } catch { return ''; }
}
async function json(file) {
  try { return JSON.parse(await text(file)); } catch { return null; }
}
function pclMode(ini) {
  const value = key => new RegExp('^\\s*' + key + '\\s*[:=]\\s*([^\\r\\n]+)', 'im').exec(ini)?.[1].trim().toLowerCase();
  const current = value('VersionArgumentIndieV2');
  if (current === 'true' || current === '1') return isolated;
  if (current === 'false' || current === '0') return shared;
  return ({'1':isolated, '2':shared})[value('VersionArgumentIndie')];
}
function customMode(dir, root, version) {
  if (!dir || typeof dir !== 'string' || !path.isAbsolute(dir)) return UNKNOWN;
  return samePath(dir, root) ? shared : samePath(dir, version) ? isolated : UNKNOWN;
}
function hmclMode(modern, legacy, root, version) {
  if (modern) {
    if (modern.overrideProperties?.includes?.('runningDirectory') || modern.runningDirectory) {
      return modern.runningDirectory ? customMode(modern.runningDirectory, root, version) : isolated;
    }
    return; // Modern settings inherit the preset, even if an old file remains.
  }
  if (!legacy || legacy.usesGlobal === true) return;
  switch (String(legacy.gameDirType).toUpperCase()) {
    case '0': case 'ROOT_FOLDER': return shared;
    case '1': case 'VERSION_FOLDER': return isolated;
    case '2': case 'CUSTOM': return customMode(legacy.gameDir, root, version);
  }
}
async function gameData(directory) {
  let entries;
  try { entries = await fs.readdir(directory, {withFileTypes:true}); } catch { return false; }
  if (entries.some(e => e.isFile() && ['options.txt','servers.dat'].includes(e.name.toLowerCase()))) return true;
  for (const e of entries) {
    if (!e.isDirectory() || !['saves','mods','config','resourcepacks','shaderpacks','screenshots'].includes(e.name.toLowerCase())) continue;
    try {
      const dir = await fs.opendir(path.join(directory, e.name));
      for await (const item of dir) {
        if (item.name.startsWith('.')) continue;
        if (e.name.toLowerCase() === 'saves' ? item.isDirectory() : item.isFile() || item.isDirectory()) return true;
      }
    } catch { /* Other gameplay files may still identify the directory. */ }
  }
  return false;
}
function consensus(modes) {
  const values = new Set(modes.filter(Boolean));
  return values.size > 1 ? UNKNOWN : values.values().next().value;
}
async function detectIsolation(root, instances) {
  root = path.resolve(root);
  instances ??= await scan(root);
  const [rootHasData, profiles, storeProfiles] = await Promise.all([
    gameData(root), json(path.join(root,'launcher_profiles.json')), json(path.join(root,'launcher_profiles_microsoft_store.json'))
  ]);
  const official = [...Object.values(profiles?.profiles || {}), ...Object.values(storeProfiles?.profiles || {})];
  const versions = Object.create(null);
  const counts = {isolated:0,shared:0,unknown:0};
  for (const item of instances.filter(v => v.ready)) {
    const version = layout(root,item.id).version;
    const [pcl, modern, legacy, pack] = await Promise.all([
      text(path.join(version,'PCL','Setup.ini')), json(path.join(version,'.hmcl','config','instance-game-settings.json')),
      json(path.join(version,'hmclversion.cfg')), json(path.join(version,'modpack.cfg'))
    ]);
    const foreign = consensus([pclMode(pcl), pack ? isolated : hmclMode(modern,legacy,root,version)]);
    const matching = official.filter(p => p?.lastVersionId === item.id);
    const explicitDirs = matching.filter(p => p.gameDir).map(p => customMode(p.gameDir,root,version));
    const mode = foreign ?? consensus(explicitDirs) ?? (await gameData(version) ? isolated : rootHasData || matching.length ? shared : UNKNOWN);
    if (mode !== UNKNOWN) versions[item.id] = mode;
    const effective = item.forcedIsolation ? isolated : [shared,isolated].includes(item.configuredIsolation) ? item.configuredIsolation : mode;
    counts[effective]++;
  }
  return {root, versions, counts};
}
function inferredMode(report,root,id) {
  if (!report || !samePath(report.root,root) || !Object.hasOwn(report.versions || {},id)) return;
  const mode = report.versions[id];
  return mode === isolated || mode === shared ? mode : undefined;
}
function effectiveIsolation(forced, configured, detected, fallback) {
  const mode = configured === shared || configured === isolated ? configured : detected;
  return forced === true || (mode ? mode === isolated : fallback !== false);
}
module.exports = {detectIsolation,inferredMode,samePath,effectiveIsolation};

