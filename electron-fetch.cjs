const {Readable} = require('node:stream');

// Electron's net.fetch rejects manual redirects. Its ClientRequest redirect
// event exposes the next URL before another request (and its headers) is sent.
function electronFetch(net, url, options = {}) {
  if (options.redirect !== 'manual') return net.fetch(url, options);
  return new Promise((resolve, reject) => {
    const {signal, method = 'GET', headers} = options;
    signal?.throwIfAborted();
    if (method !== 'GET' && method !== 'HEAD') throw Error('手动跳转仅用于读取资源');
    const request = net.request({url, method, redirect:'manual', credentials:'omit'});
    let incoming;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(signal.reason);
      incoming?.destroy(signal.reason);
      request.abort();
    };
    // ClientRequest is a Writable with autoDestroy enabled. Its write side
    // can close immediately after end(), before Chromium delivers even the
    // first response header. Track the incoming message's lifetime instead.
    request.once('error', error => {
      cleanup();
      incoming?.destroy(error);
      reject(error);
    });
    request.once('redirect', (status, _method, location) => {
      cleanup();
      resolve(new Response(null, {status, headers:{location}}));
      // Do not call followRedirect. The caller validates the destination and
      // computes a fresh set of credentials for it.
    });
    request.once('response', message => {
      incoming = message;
      message.once('error', reject);
      message.once('end', cleanup);
      message.once('close', cleanup);
      const responseHeaders = new Headers();
      for (const [name, values] of Object.entries(message.headers)) {
        for (const value of [].concat(values)) responseHeaders.append(name, value);
      }
      const status = message.statusCode;
      const noBody = method === 'HEAD' || [204, 205, 304].includes(status);
      const stream = noBody ? null : Readable.toWeb(message);
      if (noBody) message.resume();
      message.once('aborted', () => message.destroy(new Error('网络连接已中断')));
      resolve(new Response(stream, {status, headers:responseHeaders}));
    });
    for (const [name,value] of new Headers(headers)) request.setHeader(name, value);
    signal?.addEventListener('abort', abort, {once:true});
    request.end();
  });
}
module.exports = {electronFetch};
