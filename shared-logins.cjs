const path=require('node:path');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');

// Electron safeStorage is scoped to Chromium's user-data directory. Protect
// this independent key with Windows DPAPI so movable EXEs can share sessions.
function windowsUserStorage(directory,helper){
  const crypto=require('node:crypto');
  let key;
  function getKey(){
    if(!key){
      try {key=require('node:child_process').execFileSync(helper,[directory],{windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:8000});}
      catch {throw Error('当前 Windows 用户无法解锁本机登录缓存');}
      if(key.length!==32){key=null;throw Error('本机登录缓存密钥无效');}
    }
    return key;
  }
  return {isEncryptionAvailable:()=>!!getKey(),
    encryptString(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',getKey(),iv);
      const encrypted=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);},
    decryptString(data){const decipher=crypto.createDecipheriv('aes-256-gcm',getKey(),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));
      return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');}
  };
}
class SharedLogins {
  constructor(directory,storage){
    fs.mkdirSync(directory,{recursive:true});
    this.storage=storage;
    this.db=new DatabaseSync(path.join(directory,'connections.sqlite'));
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, value BLOB NOT NULL)');
  }
  version(){return this.db.prepare('PRAGMA data_version').get().data_version;}
  transaction(fn){
    this.db.exec('BEGIN IMMEDIATE');
    try {const value=fn();this.db.exec('COMMIT');return value;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  encode(value){
    if(!this.storage.isEncryptionAvailable())throw Error('系统加密存储当前不可用');
    return this.storage.encryptString(JSON.stringify(value));
  }
  decode(row){return row?JSON.parse(this.storage.decryptString(Buffer.from(row.value))):null;}
  read(id){return this.decode(this.db.prepare('SELECT value FROM entries WHERE id=?').get(id));}
  put(id,value){this.db.prepare('INSERT OR REPLACE INTO entries (id,value) VALUES (?,?)').run(id,this.encode(value));}
  remove(id){this.db.prepare('DELETE FROM entries WHERE id=?').run(id);}
  skins(){return this.db.prepare("SELECT value FROM entries WHERE id LIKE 'authlib:%' ORDER BY rowid").all().map(row=>this.decode(row));}
  clear(){this.db.exec('DELETE FROM entries');}
  close(){this.db.close();}
}
module.exports={SharedLogins,windowsUserStorage};
