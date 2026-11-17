(() => {
  const littleSkin = {id:'littleskin',name:'LittleSkin',url:'https://littleskin.cn/api/yggdrasil/'};
  const PRESETS = [
    littleSkin,
    {id:'mua',name:'MUA 用户中心',url:'https://skin.mualliance.ltd/api/yggdrasil/'}
  ];
  function guideEndpoint(url) {
    if (url.origin === 'https://manual.littlesk.in' && !url.username && !url.password &&
        !url.search && /^\/yggdrasil\/?$/.test(url.pathname)) return littleSkin.url;
    return '';
  }
  const sites = {PRESETS,guideEndpoint};
  if (typeof module !== 'undefined' && module.exports) module.exports = sites;
  else window.skinSites = sites;
})();
