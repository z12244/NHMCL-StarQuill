(() => {
  const fields = [
    {key:'jvmArgs', label:'Java 虚拟机参数', type:'textarea', hint:'参数以空格分隔。含空格的路径或值请用双引号括起。'},
    {key:'gameArgs', label:'游戏参数', type:'text', example:'--width 1280 --height 720'},
    {key:'preLaunch', label:'启动前执行命令', type:'text', hint:'在游戏目录中执行，成功后启动 Java。可使用 %STARQUILL_GAME_DIR% 和 %STARQUILL_JAVA%。'},
    {key:'gc', label:'内存管理', type:'select', options:[
      ['default','由 Java 自动选择'], ['g1','调优 G1GC'], ['parallel','并行 GC'], ['zgc','ZGC（Java 15+）'], ['serial','串行 GC']
    ]},
    {key:'disableWrapper', label:'禁用 Java Launch Wrapper', type:'flag', hint:'适用于 Windows 上 Java 8–18 的命令行编码兼容。'},
    {key:'disableUnsafeAgent', label:'禁用 LWJGL Unsafe Agent', type:'flag', hint:'适用于 Java 25+ 搭配 LWJGL 3.4.0 或 3.4.1。'},
    {key:'highPerformance', label:'优先使用高性能显卡', type:'flag', hint:'启动时向 Windows 请求高性能 GPU，游戏退出后还原原有偏好。'},
    {key:'blockModUpdates', label:'禁止更新已有模组', type:'flag', hint:'阻止资源工坊替换已有模组，仍可安装新模组。'},
    {key:'skipFileCheck', label:'跳过启动前的本地文件校验', type:'flag', hint:'复用已有文件，缺少的文件仍会补全并校验。'}
  ];
  const panels = {};
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  for (const scope of ['global','instance']) {
    const parent = document.getElementById(scope+'-advanced-fields');
    const panel = panels[scope] = {items:[], global:{}, locked:false};
    const instance = scope === 'instance';
    for (const field of fields) {
      if(scope==='global'&&field.key==='gc')parent.append(document.getElementById('advanced-scanner'));
      const row = element('div','advanced-row'), name = element('label','advanced-name',field.label);
      const box = element('div','advanced-value'), id = scope+'-advanced-'+field.key;
      const text = ['text','textarea'].includes(field.type);
      const input = element(text ? (field.type==='text'?'input':'textarea') :
        (field.type === 'flag' && !instance ? 'input' : 'select'));
      input.id = id;
      name.htmlFor = id;
      if (field.example) input.placeholder = field.example;
      if (text) { input.maxLength = 8192; input.spellcheck = false; }
      const item = {field,input,row};
      if (instance && text) {
        const mode = element('select','advanced-mode');
        mode.id=id+'-mode'; mode.setAttribute('aria-label',field.label+'的来源');
        mode.add(new Option('跟随全局设置','inherit')); mode.add(new Option('自定义','custom'));
        mode.onchange = () => {
          if(mode.value==='inherit'){item.draft=input.value; input.value=panel.global[field.key]||'';}
          else input.value=item.draft ?? panel.global[field.key] ?? '';
          lock(scope,panel.locked);
        };
        box.append(mode); item.mode=mode;
      }
      if (input.tagName === 'SELECT') {
        if (instance) input.add(new Option('跟随全局设置','inherit'));
        const options = field.type==='flag' ? [['true','开启'],['false','关闭']] : field.options;
        for (const [value,title] of options) input.add(new Option(title,value));
      } else if (field.type==='flag') {input.type='checkbox';row.classList.add('advanced-switch');}
      box.append(input);
      if (field.hint) {
        const help=element('small','advanced-help',field.hint);help.id=id+'-help';
        input.setAttribute('aria-describedby',help.id);box.append(help);
      }
      row.append(name,box);parent.append(row);panel.items.push(item);
    }
  }
  function fill(scope,values={},global={}) {
    const panel=panels[scope];panel.global=global;
    for (const item of panel.items) {
      const {key,type,options}=item.field, own=values[key];
      if(item.mode) {
        item.draft=own;item.mode.value=own==null?'inherit':'custom';item.input.value=own??global[key]??'';
      } else if(item.input.type==='checkbox') item.input.checked=own===true;
      else {
        if(scope==='instance'){
          const value=type==='flag'?(global[key]?'开启':'关闭'):options?.find(([v])=>v===global[key])?.[1];
          item.input.options[0].text='跟随全局设置'+(value?' · '+value:'');
        }
        item.input.value=own==null?(scope==='instance'?'inherit':''):String(own);
      }
    }
    lock(scope,panel.locked);
  }
  function read(scope) {
    const result={};
    for(const {field,input,mode} of panels[scope].items){
      if(mode?.value==='inherit' || (input.tagName==='SELECT'&&input.value==='inherit'))continue;
      result[field.key]=field.type==='flag'?(input.type==='checkbox'?input.checked:input.value==='true'):input.value;
    }
    return result;
  }
  function lock(scope,disabled) {
    const panel=panels[scope];panel.locked=disabled;
    for(const {input,mode} of panel.items){
      if(mode)mode.disabled=disabled;
      input.disabled=disabled||mode?.value==='inherit';
    }
  }
  window.advancedUI={fill,read,lock};
})();
