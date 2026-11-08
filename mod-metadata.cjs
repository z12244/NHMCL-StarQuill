const Zip = require('adm-zip');
const {parse} = require('smol-toml');

function textEntry(zip, name) {
  const entry = zip.getEntry(name);
  return entry && entry.header.size <= 1024 * 1024 ? entry.getData().toString('utf8') : null;
}

function readModMetadata(file) {
  try {
    const zip = new Zip(file);
    const fabric = textEntry(zip, 'fabric.mod.json');
    if (fabric) {
      const {id, name, version} = JSON.parse(fabric);
      return {ids: id ? [id] : [], title: name || id, version};
    }
    const manifest = textEntry(zip, 'META-INF/neoforge.mods.toml') || textEntry(zip, 'META-INF/mods.toml');
    if (manifest) {
      const {mods} = parse(manifest);
      if (!Array.isArray(mods) || !mods.length) return {ids:[]};
      const first = mods[0];
      return {
        ids: [...new Set(mods.map(mod=>mod.modId).filter(id=>typeof id==='string' && id))],
        title: first.displayName || first.modId,
        version: typeof first.version==='string' && !first.version.includes('${') ? first.version : undefined
      };
    }
    const legacy = textEntry(zip, 'mcmod.info');
    if (legacy) {
      const parsed = JSON.parse(legacy);
      const mods = Array.isArray(parsed) ? parsed : parsed.modList || [];
      return {ids: mods.map(mod=>mod.modid).filter(Boolean), title: mods[0]?.name, version: mods[0]?.version};
    }
  } catch {}
  return {ids: []};
}

module.exports = {readModMetadata};
