const os = require('node:os');
const path = require('node:path');


function memorySnapshot(system = os) {
  const total = Math.max(0, system.totalmem());
  const available = Math.max(0, Math.min(total, system.freemem()));
  return {total, available, used: total - available, sampledAt: Date.now()};
}

async function optimizeMemory(pids,signal){signal?.throwIfAborted();return {supported:false,...memorySnapshot()};}
module.exports={memorySnapshot,optimizeMemory,trimScript:()=>{throw Error("PowerShell optimization removed")}};
