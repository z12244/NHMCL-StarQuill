// Browsers can attach an ordinary hyperlink and a separate authlib URI to one card.
const {guideEndpoint: skinGuideEndpoint} = typeof module !== 'undefined' && module.exports ? require('../shared/skin-sites.cjs') : window.skinSites;
const skinDragFormats = ['text/plain', 'text/uri-list', 'text/x-moz-url'];
function skinCardAddress(data) {
  const prefix = 'authlib-injector:yggdrasil-server:';
  let apiAddress = '', fallback = '';
  for (const mime of skinDragFormats) {
    const lines = (data.getData(mime) || '').slice(0, 8192).split(/\r?\n/);
    for (const line of mime === 'text/x-moz-url' ? lines.slice(0,1) : lines) {
      const value = line.trim();
      const explicit = value.toLowerCase().startsWith(prefix);
      if (!explicit && !/^https:\/\//i.test(value)) continue;
      try {
        let address = explicit ? value.slice(prefix.length) : value;
        if (explicit && !/^https:\/\//i.test(address)) address = decodeURIComponent(address);
        const url = new URL(address);
        if (url.protocol !== 'https:' || url.username || url.password || url.search) continue;
        const guide = skinGuideEndpoint(url);
        if (url.hash && !guide) continue;
        if (explicit) return guide || url.href;
        if (!apiAddress && /\/api\/yggdrasil\/?$/i.test(url.pathname)) apiAddress = url.href;
        if (!fallback && /\/yggdrasil\/?$/i.test(url.pathname)) fallback = guide || url.href;
      } catch {}
    }
  }
  return apiAddress || fallback;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {skinCardAddress};
if (typeof document !== 'undefined') {
  function dropType(data) {
    if (data.types.includes('Files')) return 'file';
    if (data.types.some(t => skinDragFormats.includes(t))) return 'link';
    return '';
  }
  document.addEventListener('dragover', event => {
    if (dropType(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, true);
  document.addEventListener('drop', async event => {
    const data = event.dataTransfer, type = dropType(data);
    if (!type) return;
    const file = data.files[0], count = data.files.length;
    const address = type === 'link' ? skinCardAddress(data) : '';
    if (!address && type === 'link' && event.target.closest?.('textarea,input:not([readonly])') &&
        !data.types.includes('text/uri-list')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!address && type !== 'file') return;
    if (type === 'file' && (count !== 1 || !/\.(zip|mrpack)$/i.test(file?.name || ''))) {
      toast('请拖入一个 ZIP 或 MRPACK 整合包'); return;
    }
    try {
      await window.starquillReady;
      if (loginPending || externalPending || externalBusy || skinImportPending ||
          welcomeWorking || ['running','downloading','preparing','diagnosing'].includes(currentState.phase)) {
        toast('请先结束当前任务，再拖入整合包或皮肤站'); return;
      }
      if (el('ai-dialog').open) el('ai-dialog').close();
      if (el('welcome-dialog').open && address) {
        await finishWelcome('skin');
        if (el('welcome-dialog').open) return;
      }
      if (type === 'file') {
        // Defer onboarding without marking it complete or creating an account.
        if (el('welcome-dialog').open) el('welcome-dialog').close();
        if (el('add-account-dialog').open) el('add-account-dialog').close();
        await window.marketUI.droppedPack(file);
        return;
      }
      page('accounts');
      window.referenceUI.accountTab('server');
      const preset = skinServers.find(s => s.url.replace(/\/$/,'') === address.replace(/\/$/,''));
      const provider = el('authlib-provider');
      provider.value = preset?.id || 'custom';
      provider.onchange();
      el('authlib-url').value = address;
      el('authlib-username').value = '';
      el('authlib-password').value = '';
      el('authlib-discover').click();
    } catch (error) { toast(error.message); }
  }, true);
}
