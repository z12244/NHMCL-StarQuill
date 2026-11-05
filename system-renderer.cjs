(() => {
  const $ = id => document.getElementById(id), api = window.starquill;
  let timer, reading = false, snapshot, currentPage = 'home';
  const gb = value => (value / 1024 ** 3).toFixed(1);
  const visible = () => !document.hidden && ['settings', 'instance'].includes(currentPage);
  function renderMemory() {
    if (!snapshot) return;
    $('memory-available').textContent = `当前可用 ${gb(snapshot.available)} GB`;
    $('instance-memory-available').textContent = `当前可用 ${gb(snapshot.available)} GB`;
    $('memory-used').textContent = `已使用 ${gb(snapshot.used)} / ${gb(snapshot.total)} GB`;
    $('memory-meter').max = snapshot.total || 1;
    $('memory-meter').value = snapshot.used;
    const low = Number($('memory').value) * 1024 ** 3 > snapshot.available;
    $('memory-availability-note').textContent = low ? '分配值高于当前可用内存。游戏运行时可能使用虚拟内存；可关闭其他程序或降低分配。' : '当前可用量包含系统可立即回收的内存；随其他程序的使用变化。';
    $('memory-availability-note').classList.toggle('memory-low', low);
  }
  async function sample() {
    if (reading || !visible()) return;
    reading = true;
    try {snapshot = await api.systemMemory(); if (visible()) renderMemory();}
    catch {$('memory-available').textContent = '可用内存暂无法读取';$('instance-memory-available').textContent = '可用内存暂无法读取';}
    finally {reading = false;}
  }
  function schedule() {
    clearInterval(timer);timer = null;
    if (visible()) {sample();timer = setInterval(sample, 2000);}
  }
  window.systemUI = {pageChanged(name) {currentPage = name;schedule();}};
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('beforeunload', () => clearInterval(timer));
  $('memory').addEventListener('input', renderMemory);

  function showCrash(report, announce = false) {
    $('crash-card').classList.toggle('hidden', !report);
    $('crash-banner').classList.toggle('hidden', !report);
    if (!report) return;
    $('crash-summary').textContent = `${report.version} · ${new Date(report.createdAt).toLocaleString('zh-CN')} · 退出代码 ${report.exitCode ?? '无'}`;
    $('crash-path').textContent = report.file;
    const list = $('crash-findings');list.replaceChildren();
    for (const item of report.findings || []) {
      const row = document.createElement('li'), title = document.createElement('b'), advice = document.createElement('p'), evidence = document.createElement('pre');
      title.textContent = item.title;advice.textContent = item.suggestion;evidence.textContent = item.evidence;
      row.append(title, advice, evidence);list.append(row);
    }
    $('crash-banner-text').textContent = '最近一次意外退出：' + (report.findings?.[0]?.title || '日志已保存');
    if (announce) toast('游戏意外退出，日志与初步分析已自动保存。点击“查看分析”查看。');
  }
  $('crash-view').onclick = () => page('logs');
  $('crash-open').onclick = async () => {try {await api.crashFolder();} catch (e) {toast(e.message);}};
  api.onCrash(report => showCrash(report, !!report));
  api.onCrashError(text => {log(text);toast(text);page('logs');});
  window.starquillReady.then(async () => {if (!window.bootError) showCrash(await api.latestCrash());}).catch(e => log(e.message));
})();
