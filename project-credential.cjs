const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The same launcher must open this envelope on any Windows machine.
// This protects plain text at rest, not against reverse engineering the EXE.
function sealProjectKey(value) {
  const wrappingKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const aes = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
  const encrypted = Buffer.concat([aes.update(value, 'utf8'), aes.final()]);
  return {wrappingKey, envelope:Buffer.concat([Buffer.from([1]), iv, aes.getAuthTag(), encrypted]).toString('base64')};
}
function openProjectKey(encoded = require('./package.json').starQuillProjectCredential, wrappingKey) {
  if (!encoded) return '';
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes[0] !== 1 || bytes.length <= 29) throw Error('项目接口配置损坏，请重新下载启动器');
  const key = wrappingKey || fs.readFileSync(path.join(__dirname,'internal','project.bin'));
  const aes = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(1,13));
  aes.setAuthTag(bytes.subarray(13,29));
  return Buffer.concat([aes.update(bytes.subarray(29)), aes.final()]).toString('utf8');
}
module.exports = {sealProjectKey, openProjectKey};
