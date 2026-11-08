const official = 'https://api.curseforge.com/v1';
const mirror = 'https://mod.mcimirror.top';

function downloadSources(value, direct) {
  const url = new URL(value);
  if (!['https://edge.forgecdn.net','https://mediafilez.forgecdn.net'].includes(url.origin) ||
      !/^\/files\/\d+\/\d+\//.test(url.pathname) || url.search) return [value];
  const mirrored = mirror + url.pathname;
  return direct ? [value, mirrored] : [mirrored, value];
}

module.exports = {official, mirror, downloadSources};
