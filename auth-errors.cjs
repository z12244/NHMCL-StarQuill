// Only known classifications and correlation UUIDs may leave the auth process.
// Never export raw HTTP bodies, request headers or tokens.
const STAGES={device:'获取微软登录码',token:'微软网页授权',xbl:'Xbox Live 登录',xsts:'Xbox 游戏授权',minecraft:'Minecraft 令牌交换',entitlements:'Minecraft Java 版权益验证',profile:'Minecraft 玩家档案'};
function stageFor(url){if(url.includes('/devicecode'))return 'device';if(url.includes('/oauth2/'))return 'token';if(url.includes('user.auth.xboxlive.com/'))return 'xbl';if(url.includes('xsts.auth.xboxlive.com/'))return 'xsts';if(url.includes('/login_with_xbox'))return 'minecraft';if(url.includes('/entitlements/'))return 'entitlements';return 'profile';}
class AuthFailure extends Error{
  constructor(message,details){super(message);this.name='AuthFailure';this.details=Object.freeze({...details});}
}
function failure(stage,r={},fallback='登录失败，请稍后重试。'){
  const status=Number.isInteger(r.status)?r.status:0;
  // These values are used only for classification, never interpolated or logged.
  const body=r.data&&typeof r.data==='object'?r.data:{};
  const words=[body.error,body.errorMessage,body.developerMessage,body.message].filter(v=>typeof v==='string').join(' ').slice(0,8192);
  let code='AUTH_FAILED',text=fallback,action='retry';
  if(stage==='minecraft'&&status===403&&/\binvalid app registration\b/i.test(words)){
    code='APP_NOT_APPROVED';action='review';text='Minecraft 服务返回“Invalid app registration”：此应用注册未被 Minecraft 服务接受。请由项目维护者核对当前 Client ID 的 Minecraft API 审核状态；若已通过，请联系 Minecraft 支持核查。重新登录或增加内存无法解决此拒绝。';
  }else if(status===403){code=r.format==='non-json'?'NON_JSON_FORBIDDEN':'FORBIDDEN';text=stage==='minecraft'?'微软和 Xbox 授权已完成，但 Minecraft 令牌接口拒绝访问（403）。服务端未明确说明是应用授权问题，不能断定账号无正版权益。可导出诊断供排查。':fallback+'（HTTP 403）';
  }else if(status===429){code='RATE_LIMITED';text='认证服务请求过于频繁（429），请稍后再试，避免连续登录。';
  }else if(status>=500){code='SERVICE_UNAVAILABLE';text='认证服务暂时不可用（'+status+'），已停止本次登录，请稍后重试。';
  }else if(status===401){code='UNAUTHORIZED';text=fallback+'（HTTP 401，请重新授权）';
  }else if(r.format==='non-json'){code='INVALID_RESPONSE';text='认证服务返回了非 JSON 响应。请检查网络、代理或服务状态后重试。';}
  const requestId=[body.requestId,body.correlationId,r.requestId].find(v=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v));
  return new AuthFailure(text,{stage,stageLabel:STAGES[stage]||'认证',status,code,action,...(requestId?{requestId}:{})});
}
module.exports={AuthFailure,failure,stageFor};
