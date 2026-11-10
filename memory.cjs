const os = require('node:os');

function memorySnapshot(system = os) {
  const total = Math.max(0, system.totalmem());
  const available = Math.max(0, Math.min(total, system.freemem()));
  return {total, available, used: total - available, sampledAt: Date.now()};
}

// The session is local to this process. It doesn't open a debugger port.
async function collectPreparationGarbage() {
  const {Session} = require('node:inspector');
  const session = new Session();
  session.connect();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('启动器内存回收超时')), 2500);
      session.post('HeapProfiler.collectGarbage', error => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    });
  } finally {
    session.disconnect();
  }
}

function releasePageCache(contents) {
  if (!contents || contents.isDestroyed()) return Promise.resolve(false);
  const {MessageChannelMain} = require('electron');
  const {port1, port2} = new MessageChannelMain();
  return new Promise(resolve => {
    function finish(cleared) {
      clearTimeout(timer);
      port1.close();
      resolve(cleared);
    }
    const timer = setTimeout(() => finish(false), 1000);
    port1.once('message', event => finish(event.data === true));
    port1.start();
    try {
      contents.postMessage('release-page-memory', null, [port2]);
    } catch {
      port2.close();
      finish(false);
    }
  });
}

async function optimizeMemory(contents, signal) {
  signal?.throwIfAborted();
  const heapBefore = process.memoryUsage().heapUsed;
  const [pageCacheCleared] = await Promise.all([releasePageCache(contents), collectPreparationGarbage()]);
  signal?.throwIfAborted();
  return {...memorySnapshot(), heapBefore, heapAfter:process.memoryUsage().heapUsed, pageCacheCleared};
}

module.exports = {memorySnapshot, optimizeMemory};
