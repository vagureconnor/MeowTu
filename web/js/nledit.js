// MTNLEdit — 一句话修图「执行层」与抠图一键换背景的背景库。
// PhotoCraft 的选区/主体分割是 ML 模型、无可译源码，故区域应用在此自研：
// 区域调整 = 全图按参数调整一份，再按区域掩膜（MTMasks 色彩分割 + 羽化）与原图混合。
// 解析不在此文件：MTNL（nl/ 生成）只产出 {region, op, delta} 操作表，本层负责落地。
(function (g) {
'use strict';
const clamp = (v, a, b) => v < a? a: v > b? b: v;
const clamp255 = v => v < 0? 0: v > 255? 255: Math.round(v);
const clamp01 = v => v < 0? 0: v > 1? 1: v;

const PARAM_LABEL = { exposure: '曝光', brightness: '亮度', contrast: '对比度', temperature: '色温', tint: '色调', saturation: '饱和度', vibrance: '自然饱和度', highlights: '高光', shadows: '阴影', whites: '白色色阶', blacks: '黑色色阶', clarity: '清晰度', sharpen: '锐化'};
const OP_LABEL = { dehaze: '去雾', soften: '柔化', bw: '黑白', denoise: '降噪', grain: '颗粒感', blur: '虚化', skinSmooth: '磨皮', skyBlue: '加蓝', hueGreen: '加绿', skinWhiten: '美白', vignette: '暗角'};
const REGION_LABEL = { global: '全图', sky: '天空', water: '水面', greenery: '绿植', portrait: '人像', foreground: '主体', background: '背景', food: '全图', night: '全图'};
// region → MTMasks 掩膜名（background 特殊处理，见 regionMask）
const MASK_OF = { sky: 'sky', water: 'water', greenery: 'greenery', portrait: 'skin', foreground: 'skin'};
// 复合 op → 引擎参数换算（自研近似：去雾≈对比+饱和+清晰，柔化≈负清晰）
const COMPOSITE = { dehaze: d => ({ contrast:.6 * d, saturation:.35 * d, clarity:.5 * d}), soften: d => ({ clarity: -.8 * d})};
// 滤镜类 op → 状态式滤镜（参数由 delta 推）
const FILTER_OPS = {
bw: () => ({ id: 'bw', params: null}),
denoise: d => ({ id: 'medianDenoise', params: { radius: d >= 25? 2: 1}}),
grain: d => ({ id: 'addNoise', params: { amount: clamp(Math.round(d * 1.2), 4, 120), monochrome: 1}}),
blur: d => ({ id: 'gaussianBlur', params: { radius: clamp(1 + d *.12, 1, 12)}}),
skinSmooth: d => ({ id: 'surfaceBlur', params: { radius: clamp(Math.round(2 + d *.1), 2, 12), threshold: 18}}),
};
// 自定义像素 op（引擎参数表达不了的：按颜色亲和加权，权重 0 时不动，避免整片染色）
const CUSTOM = {
skyBlue(data, d) {
for (let i = 0; i < data.length; i += 4) {
const w = clamp01((data[i + 2] - (data[i] + data[i + 1]) / 2 + 40) / 80); if (!w) continue;
data[i + 2] = clamp255(data[i + 2] + d * 1.4 * w);
data[i] = clamp255(data[i] - d *.18 * w);
data[i + 1] = clamp255(data[i + 1] - d *.06 * w);
}
},
hueGreen(data, d) {
for (let i = 0; i < data.length; i += 4) {
const w = clamp01((data[i + 1] - Math.max(data[i], data[i + 2]) + 30) / 70); if (!w) continue;
data[i + 1] = clamp255(data[i + 1] + d * 1.1 * w);
data[i] = clamp255(data[i] - d *.1 * w);
data[i + 2] = clamp255(data[i + 2] - d *.1 * w);
}
},
skinWhiten(data, d) {
const f = 1 + d / 100 *.45, s = 1 - d / 100 *.2;
for (let i = 0; i < data.length; i += 4) {
const y =.299 * data[i] +.587 * data[i + 1] +.114 * data[i + 2];
for (let c = 0; c < 3; c++) data[i + c] = clamp255((y + (data[i + c] - y) * s) * f);
}
},
vignette(data, d, w, h) {
const cx = w / 2, cy = h / 2, max = Math.hypot(cx, cy);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
const t = Math.hypot(x - cx, y - cy) / max, s = clamp01((t -.4) /.6);
if (!s) continue;
const i = (y * w + x) * 4, f = 1 - d / 100 *.55 * s * s;
data[i] *= f; data[i + 1] *= f; data[i + 2] *= f;
}
},
};

/* ---------- 计划：把解析结果分成 全图状态 / 区域烘焙 / 恢复 三类，并生成人话解读 ---------- */
function plan(parsed) {
const P = { params: {}, absolutes: {}, filter: null, jobs: [], resets: [], lines: [], count: 0};
const byRegion = {};
const jobFor = region => byRegion[region] ||
(byRegion[region] = { region, params: {}, filters: [], custom: []}, P.jobs.push(byRegion[region]), byRegion[region]);
const addParams = (dst, deltas) => { for (const k in deltas) dst[k] = (dst[k] || 0) + deltas[k];};
for (const o of parsed.ops || []) {
const rl = REGION_LABEL[o.region] || '全图';
if (o.reset) {
P.resets.push(o);
P.lines.push(o.op === 'all'? '恢复全部调节': (rl === '全图'? '': rl) + (PARAM_LABEL[o.op] || o.op) + '恢复默认');
P.count++; continue;
}
const regional =!!(MASK_OF[o.region] || o.region === 'background');
const deltas = {};
if (PARAM_LABEL[o.op]) deltas[o.op] = o.op === 'exposure'? o.delta *.1: o.delta; // 曝光：解析单位 → EV
else if (COMPOSITE[o.op]) Object.assign(deltas, COMPOSITE[o.op](o.delta));
if (Object.keys(deltas).length) {
if (regional) addParams(jobFor(o.region).params, deltas);
else if (o.absolute && PARAM_LABEL[o.op]) P.absolutes[o.op] = deltas[o.op];
else addParams(P.params, deltas);
P.lines.push(rl + (OP_LABEL[o.op] || PARAM_LABEL[o.op]) + ' ' + (o.delta > 0? '+': '') + o.delta);
P.count++; continue;
}
if (FILTER_OPS[o.op]) {
const f = FILTER_OPS[o.op](o.delta);
if (!regional &&!P.filter) P.filter = f; // 全图首个滤镜走状态
else jobFor(regional? o.region: 'global').filters.push(f); // 其余烘焙（全图=整幅掩膜）
P.lines.push(rl + OP_LABEL[o.op] + (o.op === 'bw'? '': ' +' + o.delta));
P.count++; continue;
}
if (CUSTOM[o.op]) {
jobFor(regional? o.region: 'global').custom.push({ op: o.op, delta: o.delta});
P.lines.push(rl + OP_LABEL[o.op] + ' +' + o.delta);
P.count++; continue;
}
P.lines.push(rl + (o.op || '') + '（暂无法执行）');
}
return P;
}

/* ---------- 区域掩膜（自研口径） ---------- */
function regionMask(imgData, region, w, h) {
const M = g.MTMasks; if (!M) return null;
const rad = Math.max(1, Math.round(Math.min(w, h) *.03));
if (region === 'background') {
// 主体 = 肤色区域；图里几乎没有肤色时兜底取中央椭圆（自研假设：主体在中央）
const skin = M.skin(imgData);
let sum = 0; for (let i = 0; i < skin.length; i++) sum += skin[i];
let subj = skin;
if (sum / skin.length <=.02) {
subj = new Float32Array(w * h);
const cx = w / 2, cy = h / 2, rx = w *.32, ry = h *.38;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
const dx = (x - cx) / rx, dy = (y - cy) / ry;
if (dx * dx + dy * dy <= 1) subj[y * w + x] = 1;
}
}
return M.feather(M.invert(subj), w, h, rad);
}
const name = MASK_OF[region];
return name? M[name](imgData, { feather: rad}): null;
}

// 一个区域任务：调整一份 → 按掩膜混合回原图
function applyJob(ed, base, job) {
let adj = base;
if (Object.keys(job.params).length) adj = ed.applyStateToCanvas(adj, { params: job.params});
for (const f of job.filters) adj = ed.applyStateToCanvas(adj, { filter: f.id, filterParams: f.params});
if (job.custom.length) {
const ctx = adj.getContext('2d'), img = ctx.getImageData(0, 0, adj.width, adj.height);
for (const c of job.custom) CUSTOM[c.op](img.data, c.delta, adj.width, adj.height);
ctx.putImageData(img, 0, 0);
}
if (job.region === 'global') return adj;
const bctx = base.getContext('2d');
const mask = regionMask(bctx.getImageData(0, 0, base.width, base.height), job.region, base.width, base.height);
if (!mask) return adj;
const bd = bctx.getImageData(0, 0, base.width, base.height), ad = adj.getContext('2d').getImageData(0, 0, adj.width, adj.height);
const out = document.createElement('canvas'); out.width = base.width; out.height = base.height;
const octx = out.getContext('2d'), oi = octx.createImageData(out.width, out.height);
for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
const m = mask[i];
oi.data[j] = bd.data[j] + (ad.data[j] - bd.data[j]) * m;
oi.data[j + 1] = bd.data[j + 1] + (ad.data[j + 1] - bd.data[j + 1]) * m;
oi.data[j + 2] = bd.data[j + 2] + (ad.data[j + 2] - bd.data[j + 2]) * m;
oi.data[j + 3] = bd.data[j + 3] + (ad.data[j + 3] - bd.data[j + 3]) * m;
}
octx.putImageData(oi, 0, 0);
return out;
}

/* ---------- 执行：整体一步撤销（标签「一句话修图」） ---------- */
function apply(ed, parsed) {
const P = plan(parsed);
if (!P.count) return { done: 0, lines: P.lines, baked: false, skipped: 0};
const meta = ed.getLayers()[ed.getActiveLayerIndex()];
const isAdj =!!(meta && meta.kind === 'adj');
const jobs = P.jobs.filter(j => Object.keys(j.params).length || j.filters.length || j.custom.length);
let done = P.count;
ed.beginOp('一句话修图');
for (const r of P.resets) {
if (r.op === 'all') {
const zero = {}; for (const k in PARAM_LABEL) zero[k] = 0;
ed.setAdjust(zero);
ed.setCurves({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]]});
ed.setAdj(null); ed.setFilterLive(null);
} else if (PARAM_LABEL[r.op]) ed.setAdjust({ [r.op]: 0});
}
const merged = {};
const cur = ed.getAdjust();
for (const k in P.params) merged[k] = cur[k] + P.params[k];
for (const k in P.absolutes) merged[k] = P.absolutes[k];
if (Object.keys(merged).length) ed.setAdjust(merged);
if (P.filter) ed.setFilterLive(P.filter.id, P.filter.params);
let baked = false;
if (jobs.length &&!isAdj) {
let E = ed.renderActiveLayerCanvas(); // 已含上面合并的全图状态，所见即所得
for (const job of jobs) E = applyJob(ed, E, job);
ed.replaceActiveCanvas(E); // 区域效果只能烘焙；全图状态已含在 E 里，不重复
baked = true;
} else if (jobs.length) done -= jobs.reduce((n, j) => n + Object.keys(j.params).length + j.filters.length + j.custom.length, 0);
ed.endOp();
return { done, lines: P.lines, baked, skipped: jobs.length && isAdj? jobs.length: 0};
}

/* ---------- 一键换背景：背景库（程序绘制，不用外部图片） ---------- */
const grad = (ctx, w, h, stops) => {
const gr = ctx.createLinearGradient(0, 0, 0, h);
for (const [t, c] of stops) gr.addColorStop(t, c);
ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
};
const cloud = (ctx, x, y, s, a) => {
ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
for (const [dx, dy, r] of [[0, 0, 1], [-.8,.15,.65], [.8,.12,.7], [.2, -.3,.55]]) {
ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s, r * s, r * s *.55, 0, 0, 7); ctx.fill();
}
};
const BACKGROUNDS = [
{ id: 'white', name: '纯白', type: 'color', color: '#ffffff', css: '#ffffff'},
{ id: 'black', name: '纯黑', type: 'color', color: '#101014', css: '#101014'},
{ id: 'red', name: '中国红', type: 'color', color: '#d93a2b', css: '#d93a2b'},
{ id: 'blue', name: '晴空蓝', type: 'color', color: '#2b6de8', css: '#2b6de8'},
{ id: 'green', name: '草地绿', type: 'color', color: '#3fae5a', css: '#3fae5a'},
{ id: 'yellow', name: '柠檬黄', type: 'color', color: '#f5c542', css: '#f5c542'},
{ id: 'pink', name: '樱花粉', type: 'color', color: '#f2a7c3', css: '#f2a7c3'},
{ id: 'gray', name: '高级灰', type: 'color', color: '#9aa0a6', css: '#9aa0a6'},
{ id: 'gradDawn', name: '晨曦', type: 'grad', stops: [[0, '#ffe3b3'], [1, '#ff9d7e']], css: 'linear-gradient(#ffe3b3,#ff9d7e)'},
{ id: 'gradSky', name: '晴空', type: 'grad', stops: [[0, '#7ec8ff'], [1, '#eaf8ff']], css: 'linear-gradient(#7ec8ff,#eaf8ff)'},
{ id: 'gradMint', name: '薄荷', type: 'grad', stops: [[0, '#c9ffe2'], [1, '#4fb98f']], css: 'linear-gradient(#c9ffe2,#4fb98f)'},
{ id: 'gradDusk', name: '紫夜', type: 'grad', stops: [[0, '#2e2560'], [1, '#b06ab3']], css: 'linear-gradient(#2e2560,#b06ab3)'},
{ id: 'blur', name: '虚化原图', type: 'blur', css: 'linear-gradient(135deg,#cfd8dc,#90a4ae)'},
{ id: 'sceneSky', name: '蓝天白云', type: 'scene', css: 'linear-gradient(#4f9be0,#cfeaff)', draw(ctx, w, h) {
grad(ctx, w, h, [[0, '#4f9be0'], [1, '#cfeaff']]);
const sg = ctx.createRadialGradient(w *.8, h *.18, 2, w *.8, h *.18, h *.22);
sg.addColorStop(0, 'rgba(255,244,190,.95)'); sg.addColorStop(1, 'rgba(255,244,190,0)');
ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
cloud(ctx, w *.25, h *.22, h *.09,.95); cloud(ctx, w *.6, h *.36, h *.06,.85); cloud(ctx, w *.45, h *.12, h *.05,.8);
ctx.fillStyle = 'rgba(70,130,140,.35)';
ctx.beginPath(); ctx.ellipse(w *.5, h * 1.12, w *.75, h *.22, 0, Math.PI, 7); ctx.fill();
}},
{ id: 'sceneDusk', name: '晚霞', type: 'scene', css: 'linear-gradient(#2c1e4f,#ff9e5e)', draw(ctx, w, h) {
grad(ctx, w, h, [[0, '#2c1e4f'], [.55, '#b84a6e'], [1, '#ff9e5e']]);
ctx.fillStyle = '#ffd9a0';
ctx.beginPath(); ctx.arc(w *.5, h *.68, h *.13, 0, 7); ctx.fill();
ctx.fillStyle = 'rgba(43,26,66,.85)';
ctx.beginPath(); ctx.ellipse(w *.15, h * 1.05, w *.6, h *.2, 0, Math.PI, 7); ctx.fill();
ctx.fillStyle = 'rgba(30,16,48,.95)';
ctx.beginPath(); ctx.ellipse(w *.85, h * 1.08, w *.65, h *.22, 0, Math.PI, 7); ctx.fill();
}},
{ id: 'sceneField', name: '绿地', type: 'scene', css: 'linear-gradient(#79b5e8 55%,#57a047 55%)', draw(ctx, w, h) {
grad(ctx, w, h, [[0, '#79b5e8'], [.55, '#dff3ff'], [.551, '#57a047'], [1, '#2e6b2e']]);
cloud(ctx, w *.3, h *.18, h *.07,.9); cloud(ctx, w *.72, h *.28, h *.05,.8);
ctx.fillStyle = '#2e6b2e';
for (const [tx, ts] of [[.12,.09], [.85,.11], [.68,.06]]) {
ctx.beginPath(); ctx.arc(w * tx, h *.55 - h * ts, h * ts, 0, 7); ctx.fill();
ctx.fillRect(w * tx - 2, h *.55 - h * ts, 4, h * ts);
}
}},
];

function renderBackground(bg, w, h, blurCanvas) {
const c = document.createElement('canvas'); c.width = w; c.height = h;
const ctx = c.getContext('2d');
if (bg.type === 'color') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, w, h);}
else if (bg.type === 'grad') grad(ctx, w, h, bg.stops);
else if (bg.type === 'scene') bg.draw(ctx, w, h);
else if (bg.type === 'blur' && blurCanvas) ctx.drawImage(blurCanvas, 0, 0, w, h);
else { ctx.fillStyle = '#dfe6ea'; ctx.fillRect(0, 0, w, h);}
return c;
}

/* 主体边缘柔化：alpha 当掩膜走 MTMasks.feather（既有羽化口径，半径 1），避免合成硬边。 */
function softenAlpha(canvas) {
const M = g.MTMasks, w = canvas.width, h = canvas.height;
const out = document.createElement('canvas'); out.width = w; out.height = h;
const ctx = out.getContext('2d');
ctx.drawImage(canvas, 0, 0);
if (!M) return out;
const img = ctx.getImageData(0, 0, w, h);
const soft = M.feather(M.fromAlpha(img), w, h, 1);
for (let i = 0; i < soft.length; i++) img.data[i * 4 + 3] = Math.round(255 * soft[i]);
ctx.putImageData(img, 0, 0);
return out;
}

g.MTNLEdit = { plan, describe: parsed => plan(parsed).lines, apply, BACKGROUNDS, renderBackground, softenAlpha};
if (typeof module!== 'undefined' && module.exports) module.exports = g.MTNLEdit;
})(globalThis);
