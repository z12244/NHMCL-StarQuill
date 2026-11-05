const path=require('node:path');
function validate(o,max=require('./java.cjs').memoryLimit()){if(!o)throw Error('请选择有效的游戏版本');require('./storage.cjs').versionName(o.version);if(o.accountType==='authlib'){if(typeof o.name!=='string'||!/^[\p{L}\p{N}_]{1,16}$/u.test(o.name))throw Error('皮肤站角色名无效');}else if(!/^[a-zA-Z0-9_]{3,16}$/.test(o.name))throw Error('玩家名须为 3–16 位英文字母、数字或下划线');if(!Number.isInteger(o.memory)||o.memory<1||o.memory>max)throw Error(`内存须为 1–${max} GB（系统物理内存上限）`);return o;}
function javaMajor(text){const m=text.match(/version\s+"(?:1\.)?(\d+)/i);return m?Number(m[1]):null;}
function runtimePath(resources,devRoot,packaged){return path.join(packaged?resources:devRoot,'runtime','bin','java.exe');}
function redact(text){return String(text)
  .replace(/(--accessToken(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,'$1[redacted]')
  .replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]')
  .replace(/(["']?(?:access_?token|refresh_?token|client_?token|device_code|identityToken|password)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,'$1"[redacted]"')
  .replace(/(XBL3\.0\s+x=)[^\s"']+/gi,'$1[redacted]')
  .replace(/token:[^:\s"']+:[a-f\d-]{32,36}/gi,'token:[redacted]:[redacted]');}
module.exports={validate,javaMajor,runtimePath,redact};
