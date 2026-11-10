const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

async function listFiles(directory, prefix = '') {
  const files = [];
  const entries = await fs.readdir(directory, {withFileTypes:true});
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name,'en'))) {
    const relative = path.join(prefix,entry.name);
    const absolute = path.join(directory,entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute,relative));
    else if (entry.isFile()) {
      const hash = crypto.createHash('sha256');
      for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      files.push({relative, size:(await fs.stat(absolute)).size, digest:hash.digest('hex')});
    } else throw new Error('Unexpected entry in Windows payload: '+relative);
  }
  return files;
}

async function packPortable({directory, artifact, bundle, temp, project}) {
  const files = await listFiles(directory);
  const cacheId = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,32);
  const checks = path.join(temp,'files.nsh');
  const escape = value => value.replaceAll('$', () => '$$');
  await fs.writeFile(checks, '\uFEFF'+files.map(f =>
    '!insertmacro CheckFile "'+escape(f.relative)+'" '+f.size+' '+f.digest
  ).join('\r\n'), 'utf8');
  const root = path.resolve(__dirname,'..');
  const nsis = path.join(bundle,'windows');
  const numeric = project.version.match(/^(\d+\.\d+\.\d+)/)[1]+'.0';
  const result = spawnSync(path.join(nsis,'makensis.exe'), [
    '/V2','/INPUTCHARSET','UTF8','/DARTIFACT='+artifact,'/DAPP_DIR='+directory,
    '/DCACHE_ID='+cacheId,'/DCHECK_FILES='+checks,'/DNUMERIC_VERSION='+numeric,
    '/DDISPLAY_VERSION='+project.displayVersion,'/DICON='+path.join(root,'assets/icon.ico'),
    '/DSTD_UTILS='+path.join(path.dirname(require.resolve('app-builder-lib/package.json')),'templates/nsis/include/StdUtils.nsh'),
    path.join(__dirname,'portable-cache.nsi')
  ], {
    cwd:root, stdio:'inherit', windowsHide:true, env:{...process.env,NSISDIR:nsis}
  });
  if (result.error) throw result.error;
  if (result.status!==0) throw new Error('Windows portable wrapper build failed: '+result.status);
  console.log('Portable EXE: '+artifact+' · engine cache '+cacheId);
}
module.exports={packPortable};
