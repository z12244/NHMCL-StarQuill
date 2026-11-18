// Presentation state contains the short user code only, never OAuth device codes.
const HOSTS=new Set(['microsoft.com','www.microsoft.com','login.microsoftonline.com']);
class DeviceLogin{
  constructor({clipboard,openExternal,now=Date.now}){this.clipboard=clipboard;this.openExternal=openExternal;this.now=now;this.current=null;}
  active(){const d=this.current;if(!d||this.now()>=d.expiresAt)throw Error('登录码已过期或本次登录已结束，请重新登录。');return d;}
  async start(device){
    const url=new URL(device.verification_uri);
    if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.username||url.password||url.port||!device.user_code||!Number.isFinite(device.expiresAt))throw Error('微软授权页面地址或登录码无效');
    this.current={userCode:device.user_code,url:url.href,expiresAt:device.expiresAt};
    let copied=false,browserOpened=false;
    try{this.copy();copied=true;}catch{}
    try{await this.open();browserOpened=true;}catch{}
    return {...this.current,copied,browserOpened};
  }
  copy(){this.clipboard.writeText(this.active().userCode);return true;}
  open(){return this.openExternal(this.active().url);}
  clear(){this.current=null;}
}
module.exports={DeviceLogin};
