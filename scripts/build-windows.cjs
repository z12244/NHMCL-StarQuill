const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {getBinFromUrl} = require('app-builder-lib/out/binDownload');
const {sealProjectKey} = require('../project-credential.cjs');
const project = require('../package.json');

function buildKey() {
  const supplied = (process.env.NHMCL_CURSEFORGE_API_KEY || '').trim();
  delete process.env.NHMCL_CURSEFORGE_API_KEY;
  if (process.platform !== 'win32') return supplied;
  const {Entry} = require('@napi-rs/keyring');
  const entry = new Entry('NHMCL-StarQuill.Build', 'curseforge-project');
  if (supplied && process.env.NHMCL_REMEMBER_BUILD_KEY === '1') entry.setPassword(supplied);
  if (supplied) return supplied;
  return entry.getPassword() || '';
}
async function main() {
  const value = buildKey();
  const config = {...project.build};
  const bundle = process.env.ELECTRON_BUILDER_NSIS_DIR || await getBinFromUrl(
    'nsis@2.0.1', 'nsis-bundle-3.12.tar.gz',
    'fe36a357f3a220db893498e830fd80e0769768a18a99f4e4d2447b982538feed'
  );
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'starquill-build-'));
  const input = path.join(temp,'project.bin'), configFile = path.join(temp,'build.json');
  try {
    if (value) {
      const {envelope, wrappingKey} = sealProjectKey(value);
      await fs.writeFile(input, wrappingKey, {mode:0o600});
      config.extraMetadata = {...config.extraMetadata, starQuillProjectCredential:envelope};
      config.files = [...config.files, {from:temp,to:'internal',filter:['project.bin']}];
    }
    await fs.writeFile(configFile,JSON.stringify(config),{mode:0o600});
    const result = spawnSync(process.execPath, [
      require.resolve('electron-builder/cli.js'), '--win', 'portable', '--x64',
      '--publish','never','--config',configFile,...process.argv.slice(2)
    ], {
      cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true,
      env:{...process.env,ELECTRON_BUILDER_NSIS_DIR:bundle,
        ELECTRON_BUILDER_NSIS_RESOURCES_DIR:process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR || bundle}
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    await fs.rm(input,{force:true});
    await fs.rm(configFile,{force:true});
    await fs.rmdir(temp);
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
