const fs = require('node:fs');
const path = require('node:path');
const indexes = new Map();
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function indexFor(kind) {
  if (kind !== 'mod' && kind !== 'modpack') return null;
  if (indexes.has(kind)) return indexes.get(kind);
  const entries = [], bySlug = new Map();
  const csv = fs.readFileSync(path.join(__dirname, '..', 'assets', 'addon', kind + '.csv'), 'utf8');
  for (const line of csv.split(/\r?\n/)) {
    if (!/^\d+,/.test(line)) continue;
    const [id, cf, mr, name, english, abbreviation, modIds = ''] = line.split(',').map(field => field.replaceAll('\\c', ','));
    if (!cf && !mr && kind!=='modpack') continue;
    const aliases = [name, english, abbreviation, cf, mr, ...modIds.split(';')].map(normalize).filter(Boolean);
    if(kind==='modpack')for(const title of [name,english]){
      const stem=String(title||'').normalize('NFKC').split(/[:：]/)[0].replace(/整合包/g,'').trim();
      const short=stem.replace(/(VIII|VII|VI|IV|III|II|IX|V|X|I)$/,r=>({I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10})[r]);
      if(stem.length>=2)aliases.push(normalize(stem),normalize(short));
    }
    const entry = {id, cf, mr, name, english, aliases, url:'https://www.mcmod.cn/' + (kind === 'mod' ? 'class' : 'modpack') + '/' + id + '.html'};
    entries.push(entry);
    if (cf) bySlug.set('curseforge:' + cf.toLowerCase(), entry);
    if (mr) bySlug.set('modrinth:' + mr.toLowerCase(), entry);
  }
  const index = {entries, bySlug};
  indexes.set(kind, index);
  return index;
}

// One edit allows common Chinese name typos without expanding short acronyms into unrelated mods.
function nearName(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + left.length - i + right.length - j <= 1;
}

function matchProjects(query, kind) {
  const key = normalize(kind==='modpack'?String(query||'').trim().replace(/整合包$/,'')||query:query);
  if (!key) return [];
  const index = indexFor(kind);
  if (!index) return [];
  const matches = [];
  const fuzzy = key.length >= 4 && /\p{Script=Han}/u.test(key);
  for (const entry of index.entries) {
    let score = 0;
    for (const alias of entry.aliases) {
      if (alias === key) { score = 100; break; }
      if (fuzzy && !score && nearName(key, alias)) score = 25;
      if (key.length >= 2 && alias.includes(key)) score = Math.max(score, (alias.startsWith(key) ? 60 : 40) + key.length / alias.length);
    }
    if (score) matches.push({entry, score});
  }
  return matches.sort((a,b) => b.score-a.score || Number(a.entry.id)-Number(b.entry.id)).slice(0,3);
}

function projectInfo(project) {
  return indexFor(project.kind)?.bySlug.get(project.source + ':' + String(project.slug || '').toLowerCase());
}
module.exports = {matchProjects, projectInfo};
