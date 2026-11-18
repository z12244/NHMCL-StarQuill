const defaults = Object.freeze({
  jvmArgs: '-XX:-OmitStackTraceInFastThrow', gameArgs: '', preLaunch: '',
  gc: 'g1', disableWrapper: false, disableUnsafeAgent: false,
  highPerformance: true, blockModUpdates: false, skipFileCheck: false
});

// Preserve Windows paths, including UNC names. Backslashes only quote a double
// quote when immediately adjacent to it (the Windows argv convention).
function splitArguments(input) {
  const args = [];
  let word = '', quote = '', started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && quote !== "'") {
      let end = i + 1;
      while (input[end] === '\\') end++;
      const count = end - i;
      if (input[end] === '"') {
        word += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) word += '"';
        else quote = quote === '"' ? '' : '"';
        i = end;
      } else { word += '\\'.repeat(count); i = end - 1; }
      started = true;
    } else if (c === quote) {
      quote = ''; started = true;
    } else if (!quote && (c === '"' || c === "'")) {
      quote = c; started = true;
    } else if (!quote && /\s/.test(c)) {
      if (started) args.push(word);
      word = ''; started = false;
    } else { word += c; started = true; }
  }
  if (quote) throw Error('启动参数中有未闭合的引号');
  if (started) args.push(word);
  return args;
}

function overrides(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('高级设置格式无效');
  const result = {};
  for (const key of Object.keys(defaults)) {
    const value = input[key];
    if (value == null) continue;
    if (typeof value !== typeof defaults[key]) throw Error('高级设置的值无效');
    if (typeof value === 'string' && (value.length > 8192 || value.includes('\0'))) throw Error('高级设置的文本过长或含有无效字符');
    if (key === 'preLaunch' && /[\r\n]/.test(value)) throw Error('启动前命令须为单行，可填写脚本路径');
    if (key === 'gc' && !['default', 'g1', 'parallel', 'zgc', 'serial'].includes(value)) throw Error('请选择可用的垃圾回收器');
    if (key === 'jvmArgs' || key === 'gameArgs') splitArguments(value);
    result[key] = value;
  }
  return result;
}
function effective(global, version) {
  return {...defaults, ...overrides(global), ...overrides(version)};
}
function portableOverrides(input = {}) {
  const {preLaunch, jvmArgs, ...rest} = input;
  return overrides(rest);
}

const collector = /^-XX:\+Use(?:G1|Parallel|ParallelOld|Z|Shenandoah|Serial|ConcMarkSweep|Epsilon)GC$/;
function collectorArgs(preset, javaMajor, custom) {
  if (custom.some(a => collector.test(a)) || preset === 'default') return [];
  if (preset === 'zgc' && javaMajor < 15) throw Error('ZGC 需要 Java 15 或更高版本，请更换此版本的内存管理选项');
  if (preset === 'g1') return ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=100'];
  return [{parallel:'-XX:+UseParallelGC', zgc:'-XX:+UseZGC', serial:'-XX:+UseSerialGC'}[preset]];
}
function mergeGameArgs(base, custom) {
  const name = arg => arg.split('=', 1)[0];
  const keys = new Set(custom.filter(s => s.startsWith('--')).map(name));
  // Old Forge profiles can require multiple independent tweak classes.
  keys.delete('--tweakClass');
  const result = [];
  for (let i = 0; i < base.length; i++) {
    if (!keys.has(name(base[i]))) { result.push(base[i]); continue; }
    if (!base[i].includes('=') && i + 1 < base.length && !base[i + 1].startsWith('--')) i++;
  }
  return result.concat(custom);
}

module.exports = {defaults, overrides, effective, portableOverrides, splitArguments, collector, collectorArgs, mergeGameArgs};
