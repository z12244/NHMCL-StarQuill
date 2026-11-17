const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {parse} = require('node-html-parser');
const Zip = require('adm-zip');
const {Downloads, hashFile, MIRROR} = require('./downloads.cjs');
const {layout, readJSON, writeJSON, resolveVersion, versionName, under} = require('./storage.cjs');
const {json, response, noLinks} = require('./content-utils.cjs');

const optifineSite = 'https://optifine.net';
const cleanroomRepo = 'https://github.com/CleanroomMC/Cleanroom/releases/download/';
function optifineRows(html, game) {
  const prefix = 'OptiFine_' + game + '_';
  const rows = [];
  for (const row of parse(html).querySelectorAll('tr.downloadLine')) {
    const href = row.querySelector('.colMirror a')?.getAttribute('href');
    if (!href) continue;
    const filename = new URL(href, optifineSite).searchParams.get('f') || '';
    const name = filename.replace(/^preview_/, '');
    if (!name.startsWith(prefix) || !/^HD_[A-Za-z0-9_]+\.jar$/.test(name.slice(prefix.length))) continue;
    const forge = (row.querySelector('.colForge')?.textContent || '').trim().replace(/^Forge\s*/i, '');
    const version = name.slice(prefix.length, -4);
    rows.push({game,loader:'optifine',version,filename,forge,stable:!/^preview_|_pre\d/i.test(filename)});
  }
  return rows;
}
async function listOptifine(fetcher, game, signal) {
  const page = await response(fetcher, optifineSite + '/downloads', signal);
  return optifineRows(await page.text(), game);
}
function cleanroomRows(releases) {
  const rows=[];
  for (const release of releases) {
    if (release.draft) continue;
    const tag = release.tag_name || '', version = tag.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(version)) continue;
    const asset = release.assets?.find(a=>['cleanroom-'+version+'.zip','cleanroom-mmc-instance-'+version+'.zip'].includes(a.name.toLowerCase())
      && a.browser_download_url===cleanroomRepo+tag+'/'+a.name);
    if (!asset) continue;
    rows.push({loader:'cleanroom',game:'1.12.2',version,stable:!release.prerelease && !/alpha|beta|rc/i.test(version),
      url:asset.browser_download_url,filename:asset.name,size:asset.size,
      hashes:/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')?{sha256:asset.digest.slice(7)}:undefined});
  }
  return rows;
}
async function listCleanroom(fetcher, game, signal) {
  if (game !== '1.12.2') return [];
  const rows = [];
  for (let page = 1; ; page++) {
    let releases;
    try {
      releases = await json(fetcher,'https://api.github.com/repos/CleanroomMC/Cleanroom/releases?per_page=100&page='+page,signal);
    } catch (error) {
      signal?.throwIfAborted();
      if(rows.length) return rows;
      // GitHub's release catalog may be rate-limited while its assets are reachable.
      const version='0.7.14-alpha', filename='cleanroom-'+version+'.zip';
      return [{game,loader:'cleanroom',version,filename,stable:false,bundledEntry:true,size:13788,
        url:cleanroomRepo+version+'/'+filename,hashes:{sha256:'117705e59789c9a173c73787adbdc50ff8a16c579f13a95e5cceba4f67525f04'}}];
    }
    rows.push(...cleanroomRows(releases));
    if (releases.length < 100) return rows;
  }
}
function checkCombination(spec, optifine) {
  if (!optifine) return;
  if (spec.game !== optifine.game || optifine.loader !== 'optifine') throw Error('OptiFine 与 Minecraft 版本不匹配');
  if (spec.loader && (spec.loader !== 'forge' || !/\d/.test(optifine.forge))) throw Error('此组合没有可用的 OptiFine 安装方式。请选择原版或 OptiFine 支持的 Forge。');
}
async function optifineJar(loaders, selection, directory, signal) {
  const {fetcher}=loaders;
  const name=versionName(selection.filename);
  const file=path.join(directory,name);
  const downloader=new Downloads({root:directory,mode:'official',fetcher,signal});
  if (loaders.mode!=='official') {
    const mirror=MIRROR+'/maven/com/optifine/'+encodeURIComponent(selection.game)+'/'+encodeURIComponent(name);
    try {
      const timeout=AbortSignal.timeout(10000);
      const head=await fetcher(mirror,{method:'HEAD',redirect:'manual',signal:signal?AbortSignal.any([signal,timeout]):timeout});
      const sha1=head.headers.get('x-bmclapi-hash');
      if ([200,301,302,303,307,308].includes(head.status) && /^[a-f0-9]{40}$/i.test(sha1||'')) {
        await downloader.ensure({file,url:mirror+'?sha1='+sha1,sha1});
        if (new Zip(file).getEntry('optifine/Installer.class')) return file;
        await fs.rm(file,{force:true});
      }
    } catch (error) {
      signal?.throwIfAborted();
      await fs.rm(file,{force:true});
      loaders.onLog('OptiFine 镜像不可用，尝试官网：'+error.message);
    }
  }
  const info=await response(fetcher,optifineSite+'/adloadx?f='+encodeURIComponent(name),signal);
  const links=parse(await info.text()).querySelectorAll('a[href]').map(a=>a.getAttribute('href'));
  const link=links.map(href=>{try{return new URL(href,optifineSite);}catch{return null;}})
    .find(url=>url?.origin===optifineSite && url.pathname==='/downloadx' && url.searchParams.get('f')===name);
  if (!link) throw Error('OptiFine 官网尚未提供所选版本的下载文件，请重新读取版本');
  await downloader.ensure({url:link.href,file});
  const zip=new Zip(file);
  if (!zip.getEntry('optifine/Installer.class')) throw Error('OptiFine 官网返回的文件不是有效的安装包');
  return file;
}
async function installOptifine(loaders,stage,spec,selection,signal) {
  checkCombination(spec,selection);
  loaders.onStatus('下载 OptiFine '+selection.version);
  const jar=await optifineJar(loaders,selection,stage.root,signal);
  const target=layout(stage.root,stage.id);
  if (spec.loader==='forge') {
    const mods=path.join(target.game,'mods');
    await fs.mkdir(mods,{recursive:true});
    await fs.copyFile(jar,path.join(mods,selection.filename));
  } else {
    // Patch into staging. Only publish complete, hashed libraries to the shared cache.
    const xmcl=require('@xmcl/installer');
    const {plan}=await xmcl.resolveOptifineInstallManifest(jar,stage.root,{versionId:stage.id,inheritsFrom:stage.game,java:stage.java.path,signal});
    const generated=JSON.parse(plan.tasks[0].operations[0].content);
    const coordinate='optifine:Optifine:'+stage.game+'_'+selection.version;
    if (!generated.libraries.some(l=>l.name===coordinate)) throw Error('OptiFine 安装包与所选版本不匹配');
    const patch=plan.tasks.find(task=>task.type==='java');
    const destination=patch.outputs[0].path;
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const runJava=cmd=>promisify(execFile)(cmd.executable,cmd.args,{cwd:stage.root,windowsHide:true,signal,maxBuffer:8*1024*1024});
    loaders.onStatus('安装 OptiFine '+selection.version);
    await xmcl.executeInstallManifest(plan,xmcl.createNodeInstallRuntime({runJava,signal}),{signal,attempts:1});
    const profile=await readJSON(target.json);
    for (const lib of profile.libraries.filter(l=>l.name.startsWith('optifine:'))) {
      const relative=require('./game.cjs').maven(lib.name);
      const source=under(path.join(stage.root,'libraries'),relative);
      const sha1=await hashFile(source),size=(await fs.stat(source)).size;
      const dest=under(path.join(loaders.root,'libraries'),relative);
      await noLinks(loaders.root,dest);
      await fs.mkdir(path.dirname(dest),{recursive:true});
      const temp=dest+'.'+require('node:crypto').randomUUID()+'.tmp';
      try { await fs.copyFile(source,temp);await fs.rename(temp,dest); }
      finally {await fs.rm(temp,{force:true});}
      lib.downloads={artifact:{path:relative,sha1,size}};
    }
    const base=await resolveVersion(stage.root,stage.game);
    if(base.meta.minecraftArguments)profile.minecraftArguments=base.meta.minecraftArguments+' --tweakClass optifine.OptiFineTweaker';
    await writeJSON(target.json,profile);
  }
  const meta=await readJSON(target.json);
  meta.starQuill={...meta.starQuill,game:stage.game,isolate:true,optifine:selection.version};
  await writeJSON(target.json,meta);
}
async function installCleanroom(services,spec,id,signal) {
  if(spec.game!=='1.12.2')throw Error('Cleanroom 仅支持 Minecraft 1.12.2');
  const root=services.loaders.root, cache=under(root,'.starquill/downloads/cleanroom/'+versionName(spec.filename));
  await noLinks(root,cache);
  const download=new Downloads({root,mode:'official',fetcher:services.loaders.fetcher,signal});
  await download.ensure({...spec,file:cache});
  const plan=await services.packs.plan(cache,id,signal);
  if(plan.pack.loader!=='cleanroom'||plan.pack.version!==spec.version||plan.pack.game!==spec.game)throw Error('Cleanroom 官方实例与所选版本不匹配');
  if (plan.id===spec.game) throw Error('独立版本名称不能与原版相同');
  return services.packs.install(plan,signal);
}
module.exports={optifineRows,cleanroomRows,listOptifine,listCleanroom,checkCombination,installOptifine,installCleanroom};
