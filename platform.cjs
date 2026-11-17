const path = require('node:path');
const windows = process.platform === 'win32';
const javaBinary = windows ? 'java.exe' : 'java';
const minecraftOS = {win32: 'windows', linux: 'linux', darwin: 'osx'}[process.platform];
const isJavaBinary = name => windows ? /^javaw?\.exe$/i.test(name) : name === javaBinary;
function pathKey(file) {
  const resolved = path.resolve(file);
  return windows ? resolved.toLowerCase() : resolved;
}
module.exports = {windows, javaBinary, minecraftOS, isJavaBinary, pathKey};
