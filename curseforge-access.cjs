const official = 'https://api.curseforge.com/v1';
const mirror = 'https://mod.mcimirror.top';

function modrinthMirror(value) {
  const url = new URL(value);
  if (url.origin !== 'https://cdn.modrinth.com' || url.username || url.password || url.search || url.hash ||
      !/^\/data\/[\w-]+\/versions\/[^/]+\/[^/]+$/.test(url.pathname)) return null;
  return mirror + url.pathname;
}

function downloadSources(value, direct, allowModrinthMirror = false) {
  if (allowModrinthMirror) {
    const fallback = modrinthMirror(value);
    if (fallback) return [value, fallback];
  }
  const url = new URL(value);
  if (!['https://edge.forgecdn.net','https://mediafilez.forgecdn.net'].includes(url.origin) ||
      !/^\/files\/\d+\/\d+\//.test(url.pathname) || url.search) return [value];
  const mirrored = mirror + url.pathname;
  return direct ? [value, mirrored] : [mirrored, value];
}

module.exports = {official, mirror, downloadSources, modrinthMirror};
