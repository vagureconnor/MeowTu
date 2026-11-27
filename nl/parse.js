// 一句话修图 · 解析器 v2（词库驱动，纯规则，零依赖）
// 输入中文指令 -> { ops: [{region, op, delta} | {op, reset:true}], styles, unsupported, unknown }
'use strict';
const LEX = require('./lexicon.json');

// 预处理：所有词按长度降序（长词优先，避免「天空」被「天」抢、「自然饱和」被「饱和」抢）
function flatWords(groups, key) {
  const out = [];
  for (const g of groups) for (const w of g[key || 'words']) out.push({ w, g });
  out.sort((a, b) => b.w.length - a.w.length);
  return out;
}
const REGION_WORDS = flatWords(LEX.regions);
const ATTR_WORDS = flatWords(LEX.attrs);
const DEGREE_WORDS = flatWords(LEX.degrees);
const COMPLAINT_WORDS = flatWords(LEX.complaints);
const STYLE_WORDS = flatWords(LEX.styles);
const PARAM_ENTRIES = Object.entries(LEX.paramNames).sort((a, b) => b[0].length - a[0].length);

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (s === '百') return 100;
  let m = s.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
  if (CN_NUM[s]) return CN_NUM[s];
  return null;
}

function findRegion(clause) {
  for (const { w, g } of REGION_WORDS) if (clause.includes(w)) return g.id;
  return 'global';
}
function findDegree(clause) {
  for (const { w, g } of DEGREE_WORDS) if (clause.includes(w)) return g.mult;
  return 1.0;
}
// 找出分句中全部属性词（不重叠、同一组只取一次，按出现位置排序）
function findAttrs(clause) {
  const hits = [];
  const used = new Array(clause.length).fill(false);
  const seenGroups = new Set();
  for (const { w, g } of ATTR_WORDS) {
    if (seenGroups.has(g)) continue;
    const i = clause.indexOf(w);
    if (i < 0) continue;
    let overlap = false;
    for (let k = i; k < i + w.length; k++) if (used[k]) { overlap = true; break; }
    if (overlap) continue;
    for (let k = i; k < i + w.length; k++) used[k] = true;
    seenGroups.add(g);
    hits.push({ pos: i, g });
  }
  return hits.sort((a, b) => a.pos - b.pos).map(h => h.g);
}
const ATTR_REGION = { skyBlue: 'sky', hueGreen: 'greenery', skinWhiten: 'portrait', skinSmooth: 'portrait' };

function parseClause(rawClause, result) {
  let clause = rawClause;
  for (const n of LEX.nouns) clause = clause.split(n).join('＊');
  // 不支持的说法：识别出来单独报告
  for (const u of LEX.unsupported) if (clause.includes(u)) result.unsupported.push(u);
  // 取消/恢复类
  if (/取消|去掉|恢复|还原|清除/.test(clause)) {
    const attrs = findAttrs(clause);
    if (attrs.length) for (const g of attrs) result.ops.push({ region: findRegion(clause), op: g.op, reset: true });
    else result.ops.push({ region: 'global', op: 'all', reset: true });
    return;
  }
  // 抱怨句式 -> 修复方案（整句优先于属性词扫描）
  for (const { w, g } of COMPLAINT_WORDS) {
    if (clause.includes(w)) {
      for (const o of g.ops) {
        let r = g.region || findRegion(clause);
        if (o.op === 'blur' && r === 'global') r = 'background';
        result.ops.push({ region: r, op: o.op, delta: o.delta });
      }
      return;
    }
  }
  // 风格词 -> 预置配方（可与属性词叠加）
  let styled = false;
  for (const { w, g } of STYLE_WORDS) {
    if (clause.includes(w)) {
      for (const o of g.ops) result.ops.push({ region: g.region || findRegion(clause), op: o.op, delta: o.delta });
      styled = true;
      break;
    }
  }
  const region = findRegion(clause);
  const mult = findDegree(clause);
  const negate = /不要|别太|别/.test(clause);
  let produced = styled;
  // 数字直达：参数名 + (加|减|调到|设为) + 数字；无数字时「高/低」给默认步长
  const numericOps = new Set();
  for (const [name, op] of PARAM_ENTRIES) {
    const re = new RegExp(name + '\\s*(加|减|增加|提高|降低|调到|设为|设置为|到)?\\s*(\\d+|[一二两三四五六七八九十百]+)');
    const m = clause.match(re);
    if (m) {
      const v = cnToNum(m[2]);
      if (v != null) {
        const neg = /减|降低/.test(m[1] || '');
        result.ops.push({ region, op, delta: neg ? -v : v, absolute: /调到|设为|到/.test(m[1] || '') });
        numericOps.add(op);
        produced = true;
      }
    } else if (clause.includes(name)) {
      const seg = clause.slice(clause.indexOf(name) + name.length);
      if (/高|大|多/.test(seg)) { result.ops.push({ region, op, delta: Math.round(10 * mult) }); produced = true; }
      else if (/低|小|少/.test(seg)) { result.ops.push({ region, op, delta: Math.round(-10 * mult) }); produced = true; }
    }
  }
  // 属性词（已被数字直达接管的操作跳过，避免重复计数）
  for (const g of findAttrs(clause)) {
    if (numericOps.has(g.op)) continue;
    let r = ATTR_REGION[g.op] || region;
    if (g.op === 'blur' && r === 'global') r = 'background';
    let delta = Math.round(g.base * g.dir * mult);
    if (negate) delta = Math.round(-delta * 0.7);
    result.ops.push({ region: r, op: g.op, delta });
    produced = true;
  }
  // 裸颜色词兜底：「天空非常蓝」「草地好绿」这类程度词+颜色
  if ((region === 'sky' || region === 'water') && clause.includes('蓝') && !result.ops.some(o => o.op === 'skyBlue')) {
    result.ops.push({ region, op: 'skyBlue', delta: Math.round(18 * mult) }); produced = true;
  }
  if (region === 'greenery' && clause.includes('绿') && !result.ops.some(o => o.op === 'hueGreen')) {
    result.ops.push({ region, op: 'hueGreen', delta: Math.round(16 * mult) }); produced = true;
  }
  if (!produced) result.unknown.push(rawClause);
}

function parseInstruction(text) {
  const result = { ops: [], unsupported: [], unknown: [] };
  const clauses = String(text).split(/[，,、；;。]|还有|并且|然后|而且/).map(s => s.trim()).filter(Boolean);
  for (const c of clauses) parseClause(c, result);
  // 合并同区域同操作（叠加并钳制），避免重复计数
  const merged = new Map();
  const out = [];
  for (const o of result.ops) {
    if (o.reset || o.absolute) { out.push(o); continue; }
    const k = o.region + '|' + o.op;
    if (merged.has(k)) merged.get(k).delta += o.delta;
    else { const c = { ...o }; merged.set(k, c); out.push(c); }
  }
  for (const o of out) if (o.delta != null && o.op !== 'bw') o.delta = Math.max(-60, Math.min(60, o.delta));
  result.ops = out;
  return result;
}

module.exports = { parseInstruction };

/* ---------------- 测试电池 ---------------- */
if (require.main === module) {
  // expects: {r:区域, op, s:方向±1} 或 {op, eq:精确值} 或 'unsupported' / 'reset' / 'none'
  const CASES = [
    ['让天空更蓝', [{ r: 'sky', op: 'skyBlue', s: 1 }]],
    ['让天空更蓝，人像亮一点，背景虚化', [{ r: 'sky', op: 'skyBlue', s: 1 }, { r: 'portrait', op: 'brightness', s: 1 }, { r: 'background', op: 'blur', s: 1 }]],
    ['照片太暗了，整体亮一些', [{ r: 'global', op: 'brightness', s: 1 }]],
    ['灰蒙蒙的，去雾，颜色鲜艳一点', [{ op: 'dehaze', s: 1 }, { op: 'saturation', s: 1 }]],
    ['人太黑了，脸再白一点', [{ r: 'portrait', op: 'brightness', s: 1 }, { r: 'portrait', op: 'skinWhiten', s: 1 }]],
    ['给她磨皮，美白一下', [{ r: 'portrait', op: 'skinSmooth', s: 1 }, { r: 'portrait', op: 'skinWhiten', s: 1 }]],
    ['背景太乱了', [{ r: 'background', op: 'blur', s: 1 }]],
    ['照片偏黄，冷一点', [{ op: 'temperature', s: -1 }]],
    ['天空非常蓝', [{ r: 'sky', op: 'skyBlue', s: 1 }]],
    ['给月亮加点魔法', ['none']],
    ['亮度加20', [{ op: 'brightness', eq: 20 }]],
    ['饱和度减十', [{ op: 'saturation', eq: -10 }]],
    ['对比度调到30', [{ op: 'contrast', eq: 30 }]],
    ['来点电影感', [{ op: 'contrast', s: 1 }, { op: 'saturation', s: -1 }, { op: 'vignette', s: 1 }]],
    ['日系小清新一点', [{ op: 'brightness', s: 1 }, { op: 'saturation', s: -1 }]],
    ['复古一点，加点颗粒感', [{ op: 'temperature', s: 1 }, { op: 'grain', s: 1 }]],
    ['拍糊了，锐化一下', [{ op: 'sharpen', s: 1 }]],
    ['噪点太多', [{ op: 'denoise', s: 1 }]],
    ['草地更绿一些', [{ r: 'greenery', op: 'hueGreen', s: 1 }]],
    ['海水更蓝', [{ op: 'skyBlue', s: 1 }]],
    ['高光压一下，暗部提亮', [{ op: 'highlights', s: -1 }, { op: 'shadows', s: 1 }]],
    ['黑白大片', [{ op: 'bw', s: 1 }, { op: 'contrast', s: 1 }]],
    ['不要太鲜艳', [{ op: 'saturation', s: -1 }]],
    ['取消滤镜效果', ['reset']],
    ['想瘦脸', ['unsupported']],
    ['夜景模式', [{ op: 'brightness', s: 1 }, { op: 'denoise', s: 1 }]],
    ['食物看起来好吃的样子，鲜艳一点', [{ op: 'saturation', s: 1 }]],
    ['画面通透一点，质感拉满', [{ op: 'clarity', s: 1 }]],
    ['太素了', [{ op: 'saturation', s: 1 }]],
    ['脸黄黄的', [{ r: 'portrait', op: 'temperature', s: -1 }]],
    ['整体柔和一点', [{ op: 'soften', s: 1 }]],
    ['锐过头了', [{ op: 'soften', s: 1 }]],
    ['死黑死白没细节', [{ op: 'shadows', s: 1 }, { op: 'highlights', s: -1 }]],
    ['森系一点', [{ op: 'hueGreen', s: 1 }]],
    ['赛博朋克风', [{ op: 'saturation', s: 1 }, { op: 'tint', s: 1 }]],
    ['曝光减5', [{ op: 'exposure', eq: -5 }]],
    ['色温高一点', [{ op: 'temperature', s: 1 }]],
    ['色温低一点', [{ op: 'temperature', s: -1 }]],
    ['天空一片白', [{ r: 'sky', op: 'highlights', s: -1 }]],
    ['海不够蓝', [{ r: 'water', op: 'skyBlue', s: 1 }]],
    ['主体不突出', [{ r: 'background', op: 'blur', s: 1 }]],
    ['来个青橙色调', [{ op: 'tint', s: 1 }, { op: 'contrast', s: 1 }]],
    ['富士色', [{ op: 'clarity', s: 1 }]],
    ['去掉路人', ['unsupported']],
  ];
  let pass = 0, fail = 0;
  for (const [text, expects] of CASES) {
    const r = parseInstruction(text);
    const problems = [];
    for (const e of expects) {
      if (e === 'unsupported') { if (!r.unsupported.length) problems.push('应识别为暂不支持'); continue; }
      if (e === 'reset') { if (!r.ops.some(o => o.reset)) problems.push('应有 reset'); continue; }
      if (e === 'none') { if (r.ops.length) problems.push('不应产生操作'); continue; }
      const hit = r.ops.find(o => o.op === e.op && (!e.r || o.region === e.r));
      if (!hit) { problems.push('缺 ' + (e.r || '') + ':' + e.op); continue; }
      if (e.eq != null && hit.delta !== e.eq) problems.push(e.op + ' 应为 ' + e.eq + ' 实为 ' + hit.delta);
      if (e.s && hit.delta != null && Math.sign(hit.delta) !== e.s) problems.push(e.op + ' 方向应为 ' + e.s + ' 实为 ' + hit.delta);
    }
    if (problems.length) { fail++; console.log('FAIL', '「' + text + '」', problems.join('；'), '=>', JSON.stringify(r.ops)); }
    else pass++;
  }
  console.log('== ' + pass + ' passed, ' + fail + ' failed ==');
}
