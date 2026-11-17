const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SharedLogins,windowsUserStorage}=require('../shared-logins.cjs');
const {createAssistant}=require('../ai-assistant.cjs');
const {AccountStore}=require('../accounts.cjs');
const {YggdrasilAuth}=require('../yggdrasil.cjs');
const {importConnections}=require('../legacy-connections.cjs');

test('Windows user cache persists across copies, retains local accounts and cannot revive cleared sessions',{skip:process.platform!=='win32'},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'sq-store-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const directory=path.join(temp,'local'),helper=path.resolve(__dirname,'../tools/user-storage-key.exe');
  const cache=()=>new SharedLogins(directory,windowsUserStorage(directory,helper));
  const one=cache(),two=cache();
  try{
    const unused={isEncryptionAvailable:()=>false};
    const a=new AccountStore(path.join(temp,'a','accounts.json'),unused,one);
    const b=new AccountStore(path.join(temp,'b','accounts.json'),unused,two);
    const auth=new YggdrasilAuth({}),skin=auth.account({server:{url:'https://example.invalid/',name:'test'},tokens:{accessToken:'example-token',clientToken:'example-client'}},{name:'TestSkin',id:'1'.repeat(32)});
    await a.load();await a.put(skin,true);await b.load();assert.equal(b.current().id,skin.id);
    assert.ok(!(await fs.readFile(a.file,'utf8')).includes('example-token'));
    await b.addOffline('LocalTest');
    const ai=createAssistant({shared:()=>one});
    await ai.save({base:'https://example.invalid/v1',model:'model',key:'test-secret-value'});
    assert.deepEqual(await createAssistant({shared:()=>two}).config(),{base:'https://example.invalid/v1/chat/completions',model:'model',hasKey:true,autoAnalyze:true});
    const bytes=await fs.readFile(path.join(directory,'connections.sqlite'));
    for(const value of ['test-secret-value','example-token','TestSkin'])assert.equal(bytes.includes(value),false);
    two.clear();a.syncShared();b.syncShared();assert.equal(a.public().accounts.length,0);assert.equal(b.current().name,'LocalTest');
    await assert.rejects(a.put(skin),/清除/);
    assert.equal((await ai.config()).hasKey,false);
    const legacy=path.join(temp,'chosen');await fs.mkdir(legacy);
    const portableSafe={decryptString:bytes=>bytes.toString()};
    await fs.writeFile(path.join(legacy,'ai-provider.json'),JSON.stringify({base:'https://example.invalid/v1',model:'legacy',secret:Buffer.from('previous-key').toString('base64')}));
    const {tokens,...details}=skin;
    await fs.writeFile(path.join(legacy,'accounts.json'),JSON.stringify({active:skin.id,accounts:[{...details,encryptedTokens:Buffer.from(JSON.stringify(tokens)).toString('base64')}]}));
    assert.deepEqual(await importConnections(legacy,two,portableSafe,helper),{ai:1,skins:1});
    assert.deepEqual(await importConnections(legacy,two,portableSafe,helper),{ai:0,skins:0});
    a.syncShared();assert.equal(a.current().tokens.accessToken,tokens.accessToken);
  }finally{one.close();two.close();}
});
