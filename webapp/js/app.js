'use strict';
/* ================================================================
   喵图 MeowTu 网页原生版 —— 界面外壳
   引擎契约：window.MT.createEditor(canvas)
   滤镜：window.MTFilters.list / 抠图：window.MTGrabCut.cut(imageData, rect)
   ================================================================ */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const editorCanvas = $('#editorCanvas');
const overlay = $('#overlay');
const wrap = $('#canvasWrap');
const stage = $('#stage');
const fileInput = $('#fileInput');

/* ---------------- 引擎 ---------------- */
let editor = null;
try {
  if (window.MT && typeof window.MT.createEditor === 'function') {
    editor = window.MT.createEditor(editorCanvas);
  }
} catch (e) { console.error(e); }

function setStatus(t) { $('#statusText').textContent = t; }
if (!editor) setStatus('编辑引擎未就绪，请刷新页面重试');

function hasImg() {
  try { return !!(editor && editor.hasImage && editor.hasImage()); }
  catch (e) { return false; }
}
/* 当前活动层是否为调整图层（无像素，抠图/删除/填充等像素操作要给提示） */
function activeIsAdj() {
  const metas = (lastState && lastState.layers) || [];
  const m = metas[lastState ? lastState.activeLayer : -1];
  return !!(m && m.kind === 'adj');
}
function imgSize() {
  if (!editor || !editor.getSize) return null;
  try {
    const s = editor.getSize();
    if (!s) return null;
    const w = s.width != null ? s.width : s.w;
    const h = s.height != null ? s.height : s.h;
    return (w && h) ? { w: w, h: h } : null;
  } catch (e) { return null; }
}
/* 显示尺寸确定性适配：CSS 百分比约束存在参照循环，旋转交换宽高后会溢出舞台；
   改为按舞台可用区（扣 padding）与画布宽高比算显式 px 尺寸，wrap 随画布尺寸走。
   不放大（k≤1），与旧行为一致。坐标换算都走 getBoundingClientRect 比例，不受影响。 */
function fitDisplay() {
  if (!hasImg() || !editorCanvas.width || !editorCanvas.height) {
    editorCanvas.style.width = ''; editorCanvas.style.height = '';
    return;
  }
  const cs = getComputedStyle(stage);
  const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (aw <= 0 || ah <= 0) return;
  const k = Math.min(1, aw / editorCanvas.width, ah / editorCanvas.height);
  editorCanvas.style.width = Math.max(1, Math.floor(editorCanvas.width * k)) + 'px';
  editorCanvas.style.height = Math.max(1, Math.floor(editorCanvas.height * k)) + 'px';
}
window.addEventListener('resize', fitDisplay);

/* 安全调用引擎方法（支持同步/异步），失败时提示 */
async function call(fn, failMsg) {
  if (!editor) { setStatus('编辑引擎未就绪'); return false; }
  try { const r = await fn(); return r !== false; }
  catch (e) { setStatus((failMsg || '操作失败') + '：' + (e && e.message ? e.message : '未知错误')); return false; }
}

/* ---------------- 原图快照（对比用） ---------------- */
let origURL = null;
function setOrig(url) {
  if (origURL && origURL.startsWith('blob:')) URL.revokeObjectURL(origURL);
  origURL = url;
}
function snapshotFromCanvas() {
  try { setOrig(editorCanvas.toDataURL('image/png')); } catch (e) { /* 忽略 */ }
}
/* ---- 修改追踪：有没有未导出的修改（打开新图/关页前提醒用） ---- */
let changeCounter = 0;
let exportedCounter = 0;
function bumpChange() { changeCounter++; }
function hasPendingEdits() {
  if (texts.length > 0) return true;
  try {
    if (editor && editor.getAdj && editor.getAdj()) return true;
    if (editor && editor.getFilter && editor.getFilter()) return true;
  } catch (e) { /* 忽略 */ }
  for (const k in sliderEls) if (parseFloat(sliderEls[k].input.value) !== 0) return true;
  for (const ch of ['rgb', 'r', 'g', 'b']) {
    const p = curveState.points[ch];
    if (p.length !== 2 || p[0][0] !== 0 || p[0][1] !== 0 || p[1][0] !== 255 || p[1][1] !== 255) return true;
  }
  return false;
}
function isDirty() {
  if (!hasImg()) return false;
  if (changeCounter === exportedCounter) return false;
  return (lastState && lastState.canUndo) || hasPendingEdits();
}
/* 自制确认框（放弃未导出修改？） */
let confirmResolve = null;
function confirmDiscard() {
  return new Promise(res => {
    confirmResolve = res;
    $('#confirmDlg').hidden = false;
  });
}
function settleConfirm(v) {
  $('#confirmDlg').hidden = true;
  if (confirmResolve) confirmResolve(v);
  confirmResolve = null;
}
window.addEventListener('beforeunload', e => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

/* 把界面三套状态（滑杆/曲线/文字列表）与引擎当前状态对齐。
   离散操作后引擎会把待生效项合并归零、撤销/重做会恢复整套状态，
   界面必须跟着同步，否则数值和效果对不上。 */
function syncUIFromEngine() {
  if (!editor) return;
  try {
    const p = typeof editor.getAdjust === 'function' ? editor.getAdjust() : null;
    if (p) {
      for (const k in sliderEls) {
        const s = sliderEls[k];
        const v = typeof p[k] === 'number' ? p[k] : 0;
        s.input.value = v;
        s.val.textContent = s.def.step < 1 ? v.toFixed(2) : String(Math.round(v));
      }
    }
  } catch (e) { /* 忽略 */ }
  try {
    const cv = typeof editor.getCurves === 'function' ? editor.getCurves() : null;
    if (cv) {
      for (const ch of ['rgb', 'r', 'g', 'b']) {
        if (Array.isArray(cv[ch])) curveState.points[ch] = cv[ch].map(pt => [pt[0], pt[1]]);
      }
      curveSel = -1;
      drawCurve();
    }
  } catch (e) { /* 忽略 */ }
  try {
    const ts = typeof editor.getTexts === 'function' ? editor.getTexts() : null;
    if (ts) {
      texts = ts.map(t => ({ id: ++textSeq, text: t.text, x: t.x, y: t.y, size: t.size, color: t.color, bold: t.bold }));
      renderTextList();
    }
  } catch (e) { /* 忽略 */ }
}

/* 离散操作（滤镜/几何/裁剪/撤销等）完成后：同步界面状态与刷新。
   注意：这里不再刷新原图快照——对比要看的永远是刚打开时的原图。 */
function afterOp(label) {
  if (label) setStatus(label);
  bumpChange();
  syncUIFromEngine();
  setTimeout(() => { refresh(); }, 80);
}

/* ---------------- 打开图片 / 工程：选文件 / 拖拽 / 粘贴 ---------------- */
async function loadFile(file) {
  if (!editor || !file) return;
  if (/\.meowtu$/i.test(file.name || '')) { loadProjectFile(file); return; }
  if (file.type && !file.type.startsWith('image/')) { setStatus('这不是图片文件'); return; }
  if (isDirty() && !await confirmDiscard()) { setStatus('已取消打开'); return; }
  sourceFormat = { 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/png': 'png' }[file.type] || 'png';
  sourceBytes = file.size || 0;
  setStatus('正在打开 ' + (file.name || '图片') + '…');
  const ok = await call(() => editor.loadFile(file), '打开失败');
  if (ok) {
    try { setOrig(URL.createObjectURL(file)); } catch (e) { snapshotFromCanvas(); }
    setStatus('已打开 ' + (file.name || '图片'));
    exitSelectMode();
    exportedCounter = changeCounter;
    syncUIFromEngine();
    refresh();
    applyExportDefault();
  }
}
/* 打开 .meowtu 工程：解析 JSON → 引擎校验恢复（一步可撤销）；
   文件损坏/版本不符时引擎给中文错误，当前文档不受影响。 */
async function loadProjectFile(file) {
  if (isDirty() && !await confirmDiscard()) { setStatus('已取消打开'); return; }
  setStatus('正在打开工程 ' + (file.name || '') + '…');
  let proj = null;
  try { proj = JSON.parse(await file.text()); }
  catch (e) { setStatus('打开工程失败：文件已损坏，不是有效的工程文件'); return; }
  const ok = await call(() => editor.importProject(proj), '打开工程失败');
  if (ok) {
    sourceFormat = null; sourceBytes = 0;
    setStatus('已打开工程 ' + (file.name || ''));
    exitSelectMode();
    snapshotFromCanvas();
    exportedCounter = changeCounter;
    syncUIFromEngine();
    refresh();
    applyExportDefault();
  }
}
async function loadSample() {
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  if (isDirty() && !await confirmDiscard()) { setStatus('已取消'); return; }
  setStatus('正在生成示例图…');
  const ok = await call(() => editor.newSample(), '示例图生成失败');
  if (ok) {
    sourceFormat = null; sourceBytes = 0;
    setStatus('示例图已生成，可以开始试用各功能');
    exitSelectMode();
    snapshotFromCanvas();
    exportedCounter = changeCounter;
    syncUIFromEngine();
    refresh();
    applyExportDefault();
  }
}

$('#btnOpen').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});
$('#btnSample').addEventListener('click', loadSample);
$('#dropzone').addEventListener('click', () => fileInput.click());

stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dragging'); });
stage.addEventListener('dragleave', e => { if (e.target === stage) stage.classList.remove('dragging'); });
stage.addEventListener('drop', e => {
  e.preventDefault(); stage.classList.remove('dragging');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
document.addEventListener('paste', e => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { loadFile(f); e.preventDefault(); }
      return;
    }
  }
});

/* ---------------- 界面刷新（状态/尺寸/按钮/直方图） ---------------- */
let histTimer = null;
let lastState = null;
function refresh(state) {
  const has = hasImg();
  $('#dropzone').hidden = has;
  wrap.style.visibility = has ? 'visible' : 'hidden';
  fitDisplay();
  // 无 state 的刷新（afterOp 的延迟刷新）沿用最近一次引擎状态，
  // 否则会把重做按钮误置为禁用（引擎状态事件才是准绳）
  const st = state || lastState;
  const canU = st && st.canUndo != null ? st.canUndo : has;
  const canR = st && st.canRedo != null ? st.canRedo : false;
  $('#btnUndo').disabled = !canU;
  $('#btnRedo').disabled = !canR;
  const s = imgSize();
  requestAnimationFrame(() => {
    let info = '';
    if (has && s) {
      let zoom = '';
      if (editorCanvas.width) {
        const r = editorCanvas.getBoundingClientRect();
        if (r.width) zoom = ' · ' + Math.round(r.width / editorCanvas.width * 100) + '%';
      }
      info = s.w + ' × ' + s.h + zoom;
    }
    $('#sizeInfo').textContent = info;
  });
  // 尺寸输入框（未聚焦时才回填）
  if (s) {
    const iw = $('#inW'), ih = $('#inH');
    if (document.activeElement !== iw) iw.value = s.w;
    if (document.activeElement !== ih) ih.value = s.h;
    sizeRatio = s.w / s.h;
  }
  clearTimeout(histTimer);
  histTimer = setTimeout(drawHist, 160);
  updateBrushTargetHint();
  renderHistory();
}
/* 历史面板：条目来自引擎状态的 history（标签在各操作入栈时收集）；
   当前步高亮、未来步（可重做）置灰，点任意步 = historyGoTo 跳转。 */
function renderHistory() {
  const box = $('#historyList');
  if (!box) return;
  const hist = lastState && lastState.history;
  box.innerHTML = '';
  if (!hist || !hist.labels.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有打开图片';
    box.appendChild(p);
    return;
  }
  hist.labels.forEach((label, i) => {
    const row = document.createElement('button');
    row.className = 'history-row' + (i === hist.index ? ' active' : (i > hist.index ? ' future' : ''));
    row.textContent = (i + 1) + '. ' + label;
    row.addEventListener('click', async () => {
      if (i === hist.index || !editor) return;
      if (await call(() => editor.historyGoTo(i), '跳转历史失败')) afterOp('已跳到「' + label + '」');
    });
    box.appendChild(row);
  });
}
if (editor && typeof editor.on === 'function') {
  try { editor.on('state', s => { lastState = s; refresh(s); }); } catch (e) { /* 忽略 */ }
}

/* ---------------- 标签页 & 工具 ---------------- */
let currentTab = 'adjust';
function switchTab(name) {
  currentTab = name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === name));
  if (name === 'text') setMode('text');
  else if (name === 'select') setMode('select');
  else if (name === 'brush') setMode('brush');
  else if (mode === 'text' || mode === 'select' || mode === 'brush') setMode('browse');
  if (name === 'adjust') { drawCurve(); drawHist(); }
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

function setTool(name) {
  $$('.tool').forEach(t => t.classList.toggle('active', t.dataset.tool === name));
  if (name === 'crop') { switchTab('geometry'); if (hasImg()) enterSelectMode('crop'); else setStatus('先打开一张图片，再裁剪'); }
  else if (name === 'text') switchTab('text');
  else if (name === 'cutout') { switchTab('cutout'); }
  else if (name === 'perspective') { switchTab('geometry'); if (hasImg()) enterPerspectiveMode(); else setStatus('先打开一张图片，再做透视矫正'); }
  else switchTab(currentTab); // browse：保持当前标签
}
$$('.tool').forEach(t => t.addEventListener('click', () => setTool(t.dataset.tool)));

/* ---------------- 撤销 / 重做 / 保存 ---------------- */
$('#btnUndo').addEventListener('click', async () => { if (await call(() => editor.undo(), '撤销失败')) afterOp('已撤销'); });
$('#btnRedo').addEventListener('click', async () => { if (await call(() => editor.redo(), '重做失败')) afterOp('已重做'); });

/* ---------------- 选框模式（裁剪 / 抠图共用）与文字拖动 ---------------- */
let mode = 'browse';           // browse | crop | cutout | text | persp | select
let selection = null;          // 原图坐标 {x,y,w,h}
let perspQuad = null;          // 透视四角（原图坐标）[左上,右上,右下,左下]
let dragInfo = null;           // 拖动过程状态

function setMode(m) {
  mode = m;
  overlay.style.pointerEvents = (m === 'browse') ? 'none' : 'auto';
  overlay.style.cursor = (m === 'crop' || m === 'cutout' || m === 'select' || m === 'brush') ? 'crosshair' : (m === 'persp' ? 'move' : 'default');
}
setMode('browse');

function enterSelectMode(m) {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  setMode(m);
  selection = null;
  perspQuad = null;
  $('#selHint').textContent = m === 'crop' ? '拖出要保留的区域' : '拖出要抠的主体';
  $('#selInfo').textContent = '';
  $('#selBar').hidden = false;
  sizeOverlay(); drawOverlay();
  setStatus(m === 'crop' ? '裁剪：在图片上拖出选框，点确认完成' : '抠图：在图片上拖出选框，点确认开始');
}
function enterPerspectiveMode() {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  const s = imgSize();
  if (!s) return;
  setMode('persp');
  selection = null;
  perspQuad = [
    { x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }
  ];
  $('#selHint').textContent = '拖动四个角，对准要拉直的区域';
  $('#selBar').hidden = false;
  sizeOverlay(); drawOverlay();
  setStatus('透视矫正：拖动四个角点，点确认拉直');
}
function exitSelectMode() {
  if (mode === 'transform') { exitTransform(false); return; }
  if (mode === 'crop' || mode === 'cutout' || mode === 'persp') setMode(currentTab === 'text' ? 'text' : 'browse');
  selection = null; perspQuad = null; dragInfo = null;
  $('#selBar').hidden = true;
  clearOverlay();
}
$('#selCancel').addEventListener('click', () => {
  if (mode === 'transform') { exitTransform(false); setStatus('已取消自由变换'); return; }
  exitSelectMode(); setStatus('已取消');
});
$('#selOk').addEventListener('click', () => {
  if (mode === 'transform') { exitTransform(true); return; }
  if (mode === 'persp') {
    if (!perspQuad) return;
    // 四边形不能自交：相邻边叉积必须同号（凸四边形）
    let sign = 0, okQuad = true;
    for (let i = 0; i < 4; i++) {
      const a = perspQuad[i], b = perspQuad[(i + 1) % 4], c = perspQuad[(i + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross === 0) { okQuad = false; break; }
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) { okQuad = false; break; }
    }
    if (!okQuad) { setStatus('四个角的位置不对：请让四边形不要交叉、不要凹进去'); return; }
    runPerspective(perspQuad.map(p => ({ x: p.x, y: p.y })));
    return;
  }
  if (!selection || selection.w < 4 || selection.h < 4) { setStatus('先在图片上拖出选框'); return; }
  const sel = { x: Math.round(selection.x), y: Math.round(selection.y), w: Math.round(selection.w), h: Math.round(selection.h) };
  if (mode === 'crop') {
    exitSelectMode();
    call(() => editor.cropTo(sel.x, sel.y, sel.w, sel.h), '裁剪失败').then(ok => { if (ok) afterOp('已裁剪'); });
  } else if (mode === 'cutout') {
    runGrabCut(sel);
  }
});
function runPerspective(quad) {
  exitSelectMode();
  $('#busyText').textContent = '正在做透视矫正…';
  $('#busy').hidden = false;
  setTimeout(async () => {
    const ok = await call(() => editor.warpPerspective(quad), '透视矫正失败');
    $('#busy').hidden = true;
    if (ok) afterOp('透视矫正完成');
  }, 60);
}

/* ---------------- 自由变换（只变换活动像素层；预览走引擎预览合成，
   提交才按 MTTransform 全分辨率烘焙，一步撤销） ----------------
   手柄口径：角点拖动 = 缩放（保持平行四边形的仿射解，锚点为对角；
   Shift = 等比；Alt = 四角自由，即透视/扭曲）；边点拖动 = 沿法线单轴缩放，
   Shift+边点 = 沿切线斜切；上方圆柄（或框外）拖动 = 旋转；框内拖动 = 平移。
   PhotoCraft 的 Free Transform 同样以四角 quad 统摄这些模式（transform.rs）。 */
let tfQuad = null;        // 当前四角（原图坐标）[左上,右上,右下,左下]
let tfDrag = null;        // {kind:'corner'|'edge'|'rotate'|'move', idx, start, orig, center}
let tfPvPending = false;
const TF_IJ = [[0, 0], [1, 0], [1, 1], [0, 1]];
const vSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });

function enterTransformMode() {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  if (activeIsAdj()) { setStatus('当前是调整图层，没有像素可以变换，请先切换到像素图层'); return; }
  const s = imgSize();
  if (!s) return;
  setMode('transform');
  selection = null; perspQuad = null;
  tfQuad = [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }];
  tfDrag = null;
  $('#selHint').textContent = '自由变换（当前图层）';
  $('#selBar').hidden = false;
  editor.setTransformPreview(tfQuad);
  sizeOverlay(); drawOverlay(); updateTfInfo();
  setStatus('自由变换：拖角缩放、拖边单轴、拖圆柄旋转，回车确认 / Esc 取消');
}
function exitTransform(commit) {
  const q = tfQuad;
  tfQuad = null; tfDrag = null;
  if (mode === 'transform') setMode(currentTab === 'text' ? 'text' : 'browse');
  $('#selBar').hidden = true;
  clearOverlay();
  if (!editor) return;
  editor.setTransformPreview(null);
  if (!commit || !q) { refresh(); return; }
  const s = imgSize();
  const same = s && q.every((p, i) => Math.abs(p.x - [0, s.w, s.w, 0][i]) < 0.01 && Math.abs(p.y - [0, 0, s.h, s.h][i]) < 0.01);
  if (same) { refresh(); setStatus('变换没有变化，已取消'); return; }
  call(() => editor.transformLayer(q), '自由变换失败').then(ok => { if (ok) afterOp('自由变换已应用'); });
}
function tfClampP(p) {
  const s = imgSize() || { w: 1, h: 1 };
  return { x: Math.max(-s.w, Math.min(2 * s.w, p.x)), y: Math.max(-s.h, Math.min(2 * s.h, p.y)) };
}
function tfCenterOf(q) { return { x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 }; }
function tfIsPara(q) {
  return Math.abs(q[0].x + q[2].x - q[1].x - q[3].x) < 0.01 && Math.abs(q[0].y + q[2].y - q[1].y - q[3].y) < 0.01;
}
/** 在 (U,V) 基下解 a·U + b·V = rhs（角点仿射缩放用）。 */
function tfSolve(U, V, rhs) {
  const det = U.x * V.y - U.y * V.x;
  if (Math.abs(det) < 1e-9) return null;
  return { a: (rhs.x * V.y - rhs.y * V.x) / det, b: (U.x * rhs.y - U.y * rhs.x) / det };
}
function tfDragCorner(idx, P, shift, alt) {
  const q = tfDrag.orig;
  if (alt || !tfIsPara(q)) { const nq = q.map(p => ({ ...p })); nq[idx] = P; return nq; }
  const [i, j] = TF_IJ[idx];
  const U = vSub(q[1], q[0]), V = vSub(q[3], q[0]);
  const A = q[(idx + 2) % 4];
  const sU = { x: (2 * i - 1) * U.x, y: (2 * i - 1) * U.y };
  const sV = { x: (2 * j - 1) * V.x, y: (2 * j - 1) * V.y };
  let a, b;
  if (shift) {
    const D = vAdd(sU, sV), den = D.x * D.x + D.y * D.y;
    const s = den ? ((P.x - A.x) * D.x + (P.y - A.y) * D.y) / den : 1;
    a = s; b = s;
  } else {
    const sol = tfSolve(sU, sV, vSub(P, A));
    if (!sol) return q;
    a = sol.a; b = sol.b;
  }
  const U2 = { x: U.x * a, y: U.y * a }, V2 = { x: V.x * b, y: V.y * b };
  const O2 = { x: A.x - (1 - i) * U2.x - (1 - j) * V2.x, y: A.y - (1 - i) * U2.y - (1 - j) * V2.y };
  return [O2, vAdd(O2, U2), vAdd(vAdd(O2, U2), V2), vAdd(O2, V2)];
}
function tfDragEdge(idx, P, shift) {
  const q = tfDrag.orig;
  const d = vSub(P, tfDrag.start);
  const U = vSub(q[1], q[0]), V = vSub(q[3], q[0]);
  const basis = (idx === 0 || idx === 2) ? (shift ? U : V) : (shift ? V : U);
  const den = basis.x * basis.x + basis.y * basis.y;
  if (!den) return q;
  const t = (d.x * basis.x + d.y * basis.y) / den;
  const delta = { x: basis.x * t, y: basis.y * t };
  const nq = q.map(p => ({ ...p }));
  const ab = [[0, 1], [1, 2], [2, 3], [3, 0]][idx];
  nq[ab[0]] = vAdd(nq[ab[0]], delta);
  nq[ab[1]] = vAdd(nq[ab[1]], delta);
  return nq;
}
function tfDragRotate(P) {
  const c = tfDrag.center;
  const da = Math.atan2(P.y - c.y, P.x - c.x) - Math.atan2(tfDrag.start.y - c.y, tfDrag.start.x - c.x);
  const cos = Math.cos(da), sin = Math.sin(da);
  return tfDrag.orig.map(p => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos
  }));
}
/** 旋转柄位置（原图坐标）：上边中点沿外法线方向外推 28 显示 px。 */
function tfRotateHandlePos(q) {
  const s = imgSize();
  const cr = editorCanvas.getBoundingClientRect();
  const disp = s && cr.width ? cr.width / s.w : 1;
  const mid = { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 };
  const U = vSub(q[1], q[0]);
  let n = { x: -U.y, y: U.x };
  const len = Math.hypot(n.x, n.y) || 1;
  n = { x: n.x / len, y: n.y / len };
  const c = tfCenterOf(q);
  if ((mid.x - c.x) * n.x + (mid.y - c.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  return { x: mid.x + n.x * 28 / disp, y: mid.y + n.y * 28 / disp };
}
function tfUpdateFromDrag(e) {
  const P = tfClampP(toImage(e));
  if (tfDrag.kind === 'corner') tfQuad = tfDragCorner(tfDrag.idx, P, e.shiftKey, e.altKey);
  else if (tfDrag.kind === 'edge') tfQuad = tfDragEdge(tfDrag.idx, P, e.shiftKey);
  else if (tfDrag.kind === 'rotate') tfQuad = tfDragRotate(P);
  else if (tfDrag.kind === 'move') {
    const d = vSub(P, tfDrag.start);
    tfQuad = tfDrag.orig.map(p => vAdd(p, d));
  }
  if (!tfPvPending) {
    tfPvPending = true;
    requestAnimationFrame(() => {
      tfPvPending = false;
      if (tfQuad && mode === 'transform' && editor) editor.setTransformPreview(tfQuad);
    });
  }
  drawOverlay();
  updateTfInfo();
}
function updateTfInfo() {
  if (!tfQuad) return;
  const q = tfQuad;
  const w = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2;
  const h = (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
  const ang = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180 / Math.PI;
  $('#selInfo').textContent = Math.round(w) + ' × ' + Math.round(h) + ' · ' + ang.toFixed(1) + '°';
}
function drawTransformBox(ctx, ox, oy, sx, sy, dpr) {
  const X = v => ox + v * sx, Y = v => oy + v * sy;
  const pts = tfQuad.map(p => ({ x: X(p.x), y: Y(p.y) }));
  ctx.save();
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 1.6 * dpr;
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath(); ctx.stroke();
  const handle = (x, y, r) => {
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 1.6 * dpr; ctx.stroke();
  };
  const hr = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ? 9 : 6;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    handle((a.x + b.x) / 2, (a.y + b.y) / 2, hr * 0.8 * dpr);
  }
  pts.forEach(p => handle(p.x, p.y, hr * dpr));
  const hp = tfRotateHandlePos(tfQuad);
  const hx = X(hp.x), hy = Y(hp.y);
  const topMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(hx, hy);
  ctx.strokeStyle = '#4da3ff'; ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, hy, hr * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#4da3ff'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.restore();
}

/* 画布坐标换算：事件坐标 <-> 原图坐标。
   注意必须换算到原图（全分辨率）坐标：显示画布是降采样预览，
   大图上用预览坐标裁剪/放文字会整体错位。 */
function toImage(e) {
  const r = editorCanvas.getBoundingClientRect();
  const s = imgSize();
  if (!r.width || !s) return { x: 0, y: 0 };
  return {
    x: (e.clientX - r.left) * s.w / r.width,
    y: (e.clientY - r.top) * s.h / r.height
  };
}
function clampSel(s) {
  const sz = imgSize();
  const W = sz ? sz.w : editorCanvas.width, H = sz ? sz.h : editorCanvas.height;
  s.x = Math.max(0, Math.min(s.x, W)); s.y = Math.max(0, Math.min(s.y, H));
  s.w = Math.max(0, Math.min(s.w, W - s.x)); s.h = Math.max(0, Math.min(s.h, H - s.y));
  return s;
}
function clampPoint(p) {
  const sz = imgSize();
  const W = sz ? sz.w : editorCanvas.width, H = sz ? sz.h : editorCanvas.height;
  p.x = Math.max(0, Math.min(p.x, W));
  p.y = Math.max(0, Math.min(p.y, H));
  return p;
}
function sizeOverlay() {
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.max(1, Math.round(r.width * dpr));
  overlay.height = Math.max(1, Math.round(r.height * dpr));
}
function clearOverlay() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

/* ---------------- 选区蚂蚁线 + 拖拽草稿（选区状态在引擎里，这里只负责画） ---------------- */
let selDraft = null;      // {tool:'rect'|'ellipse', x0,y0,x1,y1} | {tool:'lasso', pts:[[x,y],...]}（原图坐标）
let antsCache = { key: '', pts: [] };
let antsPhase = 0, antsTimer = null;
function selOutlinePts() {
  if (!editor || typeof editor.selGetMaskAt !== 'function' || !editorCanvas.width) return [];
  const st = lastState && lastState.selection;
  if (!st || !st.active) return [];
  const w = editorCanvas.width, h = editorCanvas.height;
  const key = st.rev + ':' + w + 'x' + h;
  if (antsCache.key === key) return antsCache.pts;
  const m = editor.selGetMaskAt(w, h);
  const pts = [];
  if (m) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (m[y * w + x] <= 127) continue;
      const inner = x > 0 && m[y * w + x - 1] > 127 && x < w - 1 && m[y * w + x + 1] > 127 &&
                    y > 0 && m[(y - 1) * w + x] > 127 && y < h - 1 && m[(y + 1) * w + x] > 127;
      if (!inner) pts.push(x, y);
    }
  }
  antsCache = { key, pts };
  return pts;
}
function drawSelAnts(ctx, ox, oy, sx, sy, sz) {
  const pts = selOutlinePts();
  if (!pts.length) {
    if (antsTimer) { clearInterval(antsTimer); antsTimer = null; }
    return;
  }
  const psx = sx * sz.w / editorCanvas.width, psy = sy * sz.h / editorCanvas.height;
  ctx.fillStyle = antsPhase ? '#101010' : '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    ctx.rect(ox + pts[i] * psx, oy + pts[i + 1] * psy, Math.max(1, psx), Math.max(1, psy));
  }
  ctx.fill();
  if (!antsTimer) {
    antsTimer = setInterval(() => { antsPhase ^= 1; drawOverlay(); }, 450);
  }
}
function drawSelDraft(ctx, ox, oy, sx, sy, dpr) {
  if (!selDraft) return;
  const X = v => ox + v * sx, Y = v => oy + v * sy;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6 * dpr;
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.beginPath();
  if (selDraft.tool === 'lasso') {
    const pts = selDraft.pts;
    if (pts.length) {
      ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
      ctx.closePath();
    }
  } else {
    const x0 = Math.min(selDraft.x0, selDraft.x1), x1 = Math.max(selDraft.x0, selDraft.x1);
    const y0 = Math.min(selDraft.y0, selDraft.y1), y1 = Math.max(selDraft.y0, selDraft.y1);
    if (selDraft.tool === 'ellipse') {
      if (x1 > x0 && y1 > y0) ctx.ellipse(X((x0 + x1) / 2), Y((y0 + y1) / 2), (x1 - x0) * sx / 2, (y1 - y0) * sy / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(X(x0), Y(y0), Math.max(0, (x1 - x0) * sx), Math.max(0, (y1 - y0) * sy));
    }
  }
  ctx.stroke();
  ctx.restore();
}
function drawOverlay() {
  const ctx = overlay.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const sz = imgSize();
  if (!sz || !editorCanvas.width) return;
  const cr = editorCanvas.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const ox = (cr.left - wr.left) * dpr, oy = (cr.top - wr.top) * dpr;
  const sx = cr.width / sz.w * dpr, sy = cr.height / sz.h * dpr;
  drawSelAnts(ctx, ox, oy, sx, sy, sz);
  drawSelDraft(ctx, ox, oy, sx, sy, dpr);
  drawBrushOverlay(ctx, ox, oy, sx, sy, dpr);
  if (mode === 'transform' && tfQuad) { drawTransformBox(ctx, ox, oy, sx, sy, dpr); return; }
  if (mode === 'persp' && perspQuad) {
    const pts = perspQuad.map(p => ({ x: ox + p.x * sx, y: oy + p.y * sy }));
    ctx.fillStyle = 'rgba(0,0,0,0.48)';
    ctx.beginPath();
    ctx.rect(ox, oy, cr.width * dpr, cr.height * dpr);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath(); ctx.stroke();
    const handleR = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ? 13 : 11;
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, handleR * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#4da3ff'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * dpr; ctx.stroke();
    }
    const ow = Math.round(Math.max(Math.hypot(perspQuad[1].x - perspQuad[0].x, perspQuad[1].y - perspQuad[0].y),
                                   Math.hypot(perspQuad[2].x - perspQuad[3].x, perspQuad[2].y - perspQuad[3].y)));
    const oh = Math.round(Math.max(Math.hypot(perspQuad[3].x - perspQuad[0].x, perspQuad[3].y - perspQuad[0].y),
                                   Math.hypot(perspQuad[2].x - perspQuad[1].x, perspQuad[2].y - perspQuad[1].y)));
    $('#selInfo').textContent = '拉直后约 ' + ow + ' × ' + oh;
    return;
  }
  if (!selection) return;
  $('#selInfo').textContent = selection.w >= 1 && selection.h >= 1
    ? '选区 ' + Math.round(selection.w) + ' × ' + Math.round(selection.h) : '';
  const x = ox + selection.x * sx, y = oy + selection.y * sy;
  const w = selection.w * sx, h = selection.h * sy;
  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  ctx.fillRect(ox, oy, cr.width * dpr, cr.height * dpr);
  ctx.clearRect(x, y, w, h);
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(x + w / 3, y); ctx.lineTo(x + w / 3, y + h);
  ctx.moveTo(x + 2 * w / 3, y); ctx.lineTo(x + 2 * w / 3, y + h);
  ctx.moveTo(x, y + h / 3); ctx.lineTo(x + w, y + h / 3);
  ctx.moveTo(x, y + 2 * h / 3); ctx.lineTo(x + w, y + 2 * h / 3);
  ctx.stroke();
}

overlay.addEventListener('pointerdown', e => {
  if (!hasImg()) return;
  const p = toImage(e);
  if (mode === 'brush') {
    brushHover = p;
    if (paintToolIsShape()) {
      shapeDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      overlay.setPointerCapture(e.pointerId);
      drawOverlay();
    } else {
      startStroke(p, e);
    }
  } else if (mode === 'select') {
    if (selTool === 'wand') {
      const sz = imgSize();
      const px = Math.max(0, Math.min(sz.w - 1, Math.floor(p.x)));
      const py = Math.max(0, Math.min(sz.h - 1, Math.floor(p.y)));
      call(() => editor.selWand(px, py, wandTol, $('#chkWandContig').checked), '魔棒失败')
        .then(ok => { if (ok) setStatus('魔棒选区已生成'); });
    } else if (selTool === 'lasso') {
      dragInfo = { kind: 'lasso' };
      selDraft = { tool: 'lasso', pts: [[p.x, p.y]] };
      overlay.setPointerCapture(e.pointerId);
      drawOverlay();
    } else {
      dragInfo = { kind: 'seldrag' };
      selDraft = { tool: selTool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      overlay.setPointerCapture(e.pointerId);
      drawOverlay();
    }
  } else if (mode === 'transform' && tfQuad) {
    // 命中判定在显示像素空间做（圆柄→角点→边点→框内平移）
    const cr = editorCanvas.getBoundingClientRect();
    const sz = imgSize();
    if (!sz) return;
    const toClient = q => ({ x: cr.left + q.x / sz.w * cr.width, y: cr.top + q.y / sz.h * cr.height });
    const tol = e.pointerType === 'touch' ? 32 : 20;
    const hp = toClient(tfRotateHandlePos(tfQuad));
    let kind = null, idx = -1;
    if (Math.hypot(hp.x - e.clientX, hp.y - e.clientY) < tol) kind = 'rotate';
    if (!kind) tfQuad.forEach((q, i) => {
      const c = toClient(q);
      if (Math.hypot(c.x - e.clientX, c.y - e.clientY) < tol) { kind = 'corner'; idx = i; }
    });
    if (!kind) for (let i = 0; i < 4; i++) {
      const a = toClient(tfQuad[i]), b = toClient(tfQuad[(i + 1) % 4]);
      if (Math.hypot((a.x + b.x) / 2 - e.clientX, (a.y + b.y) / 2 - e.clientY) < tol) { kind = 'edge'; idx = i; break; }
    }
    if (!kind) {
      // 框内 = 平移（点在四边形内判定：四条边叉积同号）
      let sign = 0, inside = true;
      for (let i = 0; i < 4; i++) {
        const a = tfQuad[i], b = tfQuad[(i + 1) % 4];
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s; else if (s !== sign) { inside = false; break; }
      }
      if (inside) kind = 'move';
    }
    if (kind) {
      tfDrag = { kind, idx, start: p, orig: tfQuad.map(q => ({ ...q })), center: tfCenterOf(tfQuad) };
      overlay.setPointerCapture(e.pointerId);
    }
  } else if (mode === 'crop' || mode === 'cutout') {
    dragInfo = { kind: 'select', ax: p.x, ay: p.y };
    selection = clampSel({ x: p.x, y: p.y, w: 0, h: 0 });
    overlay.setPointerCapture(e.pointerId);
  } else if (mode === 'persp' && perspQuad) {
    // 命中判定在显示像素空间做，与图分辨率无关；触摸时放大到 32px，鼠标保持 20px 精度
    const cr = editorCanvas.getBoundingClientRect();
    const sz = imgSize();
    if (!sz) return;
    let best = -1, bestD = e.pointerType === 'touch' ? 32 : 20;
    perspQuad.forEach((q, i) => {
      const qx = cr.left + q.x / sz.w * cr.width, qy = cr.top + q.y / sz.h * cr.height;
      const d = Math.hypot(qx - e.clientX, qy - e.clientY);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      dragInfo = { kind: 'persp', idx: best };
      overlay.setPointerCapture(e.pointerId);
    }
  } else if (mode === 'text') {
    const t = hitText(p);
    if (t) {
      dragInfo = { kind: 'text', obj: t, dx: p.x - t.x, dy: p.y - t.y };
      overlay.setPointerCapture(e.pointerId);
    }
  }
});
overlay.addEventListener('pointermove', e => {
  if (mode === 'transform' && tfDrag) { tfUpdateFromDrag(e); return; }
  if (mode === 'brush') {
    const p = toImage(e);
    brushHover = p;
    if (strokeCtx) { strokeCtx.stroke.move(p.x, p.y); flushStroke(); }
    else if (shapeDrag) { shapeDrag.x1 = p.x; shapeDrag.y1 = p.y; }
    drawOverlay();
    return;
  }
  if (!dragInfo) return;
  const p = toImage(e);
  if (dragInfo.kind === 'seldrag' && selDraft) {
    selDraft.x1 = p.x; selDraft.y1 = p.y;
    drawOverlay();
  } else if (dragInfo.kind === 'lasso' && selDraft) {
    const last = selDraft.pts[selDraft.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.5) { selDraft.pts.push([p.x, p.y]); drawOverlay(); }
  } else if (dragInfo.kind === 'select') {
    selection = clampSel({
      x: Math.min(dragInfo.ax, p.x), y: Math.min(dragInfo.ay, p.y),
      w: Math.abs(p.x - dragInfo.ax), h: Math.abs(p.y - dragInfo.ay)
    });
    drawOverlay();
  } else if (dragInfo.kind === 'persp' && perspQuad) {
    perspQuad[dragInfo.idx] = clampPoint({ x: p.x, y: p.y });
    drawOverlay();
  } else if (dragInfo.kind === 'text') {
    dragInfo.obj.x = Math.round(p.x - dragInfo.dx);
    dragInfo.obj.y = Math.round(p.y - dragInfo.dy);
    syncTexts();
  }
});
overlay.addEventListener('pointerup', () => {
  if (tfDrag) { tfDrag = null; if (tfQuad && mode === 'transform' && editor) editor.setTransformPreview(tfQuad); }
  if (strokeCtx) finishStroke();
  else if (shapeDrag) commitShape();
  if (dragInfo && (dragInfo.kind === 'seldrag' || dragInfo.kind === 'lasso')) commitSelDraft();
  dragInfo = null;
});
overlay.addEventListener('pointercancel', () => {
  tfDrag = null;
  if (strokeCtx) finishStroke();
  if (shapeDrag) { shapeDrag = null; drawOverlay(); }
  dragInfo = null;
  if (selDraft) { selDraft = null; drawOverlay(); }
});
new ResizeObserver(() => {
  sizeOverlay();
  if (selection || perspQuad || tfQuad || selDraft || (lastState && lastState.selection && lastState.selection.active)) drawOverlay();
}).observe(wrap);
overlay.addEventListener('dblclick', () => { if (mode === 'transform') exitTransform(true); });
$('#btnTransform').addEventListener('click', enterTransformMode);

/* 选区草稿落定：矩形/椭圆按拖拽覆盖的像素范围（[floor(min), floor(max)+1)），套索直接交点列 */
function commitSelDraft() {
  const d = selDraft;
  selDraft = null;
  if (!d) { drawOverlay(); return; }
  if (d.tool === 'lasso') {
    if (d.pts.length >= 3) {
      call(() => editor.selPolygon(d.pts), '套索失败').then(ok => { if (ok) setStatus('套索选区已生成'); });
    }
    drawOverlay();
    return;
  }
  const x0 = Math.floor(Math.min(d.x0, d.x1)), x1 = Math.floor(Math.max(d.x0, d.x1)) + 1;
  const y0 = Math.floor(Math.min(d.y0, d.y1)), y1 = Math.floor(Math.max(d.y0, d.y1)) + 1;
  if (x1 - x0 >= 1 && y1 - y0 >= 1) {
    const fn = d.tool === 'ellipse' ? 'selEllipse' : 'selRect';
    call(() => editor[fn](x0, y0, x1, y1), '选区失败').then(ok => { if (ok) setStatus('选区已生成'); });
  }
  drawOverlay();
}

/* ---------------- 抠图 ----------------
   输入取活动层的全分辨率已生效像素（图层模型下抠图只作用于活动层）；
   结果经 applyCanvas 回灌到活动层，作为一步可撤销操作（历史不清空）。 */
let lastCutSource = null;   // 最近一次抠图前的原图（「虚化原图」背景用）
function runGrabCut(rect) {
  if (activeIsAdj()) { setStatus('当前是调整图层，没有像素可以抠图，请先切换到一个像素图层'); return; }
  if (!window.MTGrabCut || typeof window.MTGrabCut.cut !== 'function') { setStatus('抠图模块未就绪'); return; }
  if (!editor || typeof editor.renderActiveLayerCanvas !== 'function') { setStatus('编辑引擎未就绪'); return; }
  exitSelectMode();
  $('#busyText').textContent = '正在抠图，大图会慢一点…';
  $('#busy').hidden = false;
  // 同步重活：先让忙碌态画出来，再开算
  setTimeout(() => {
    const fail = msg => { $('#busy').hidden = true; setStatus('抠图失败：' + msg); };
    try {
      const full = editor.renderActiveLayerCanvas();
      if (!full) { fail('没有图片'); return; }
      lastCutSource = full;
      const fctx = full.getContext('2d');
      const imgData = fctx.getImageData(0, 0, full.width, full.height);
      const handle = r => {
        if (!r || !r.width) { fail('结果格式无法识别'); return; }
        const c = document.createElement('canvas');
        c.width = r.width; c.height = r.height;
        c.getContext('2d').putImageData(r, 0, 0);
        $('#busy').hidden = true;
        call(() => editor.applyCanvas(c), '抠图失败').then(ok => { if (ok) { afterOp('抠图完成'); applyExportDefault(); } });
      };
      const result = window.MTGrabCut.cut(imgData, rect);
      if (result && typeof result.then === 'function') {
        result.then(handle).catch(err => fail(err && err.message ? err.message : '未知错误'));
      } else {
        handle(result);
      }
    } catch (err) {
      fail(err && err.message ? err.message : '未知错误');
    }
  }, 60);
}
$('#btnCutMode').addEventListener('click', () => {
  if (activeIsAdj()) { setStatus('当前是调整图层，没有像素可以抠图，请先切换到一个像素图层'); return; }
  enterSelectMode('cutout');
});

/* ---------------- 一键换背景 ----------------
   主体 = 活动层已生效像素（抠图结果/自带透明），边缘先柔化；背景层插到主体正下方，
   与主体替换同属一步撤销（beginOp/endOp 事务）。 */
function applyBackground(bg) {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  if (activeIsAdj()) { setStatus('当前是调整图层，没有像素可以换背景，请先切换到一个像素图层'); return; }
  const size = imgSize(); if (!size) return;
  let blurCanvas = null;
  if (bg.type === 'blur') {
    const src = (lastCutSource && lastCutSource.width === size.w && lastCutSource.height === size.h)
      ? lastCutSource : editor.renderFullCanvas();
    blurCanvas = editor.applyStateToCanvas(src, { filter: 'gaussianBlur', filterParams: { radius: Math.max(4, Math.round(Math.min(size.w, size.h) * .02)) } });
  }
  const bgCanvas = window.MTNLEdit.renderBackground(bg, size.w, size.h, blurCanvas);
  const softened = window.MTNLEdit.softenAlpha(editor.renderActiveLayerCanvas());
  editor.beginOp('一键换背景');
  editor.replaceActiveCanvas(softened);
  editor.insertLayerBelowActive(bgCanvas, '背景·' + bg.name);
  editor.endOp();
  afterOp('已换背景：' + bg.name);
}
if (window.MTNLEdit) {
  const grid = $('#bgGrid');
  for (const bg of window.MTNLEdit.BACKGROUNDS) {
    const b = document.createElement('button');
    b.className = 'cell-btn bg-btn'; b.dataset.bg = bg.id;
    const sw = document.createElement('span'); sw.className = 'bg-swatch'; sw.style.background = bg.css;
    b.append(sw, document.createTextNode(bg.name));
    b.addEventListener('click', () => applyBackground(bg));
    grid.appendChild(b);
  }
}

/* ---------------- 一句话修图 ----------------
   MTNL 解析（nl/ 生成，纯规则）→ MTNLEdit 落地；解读区先行展示，点执行才改图。 */
let nlParsed = null;
function nlDescribe() {
  const box = $('#nlRead');
  const text = $('#nlInput').value.trim();
  nlParsed = null;
  if (!text) { box.innerHTML = '<p class="hint">输入后这里会先列出我理解的动作，点「执行修图」才真正改图。</p>'; return; }
  if (!window.MTNL) { box.innerHTML = '<p class="nl-bad">解析模块未就绪，请刷新页面重试。</p>'; return; }
  const r = window.MTNL.parseInstruction(text);
  nlParsed = r;
  const lines = window.MTNLEdit.describe(r);
  let html = '';
  if (lines.length) html += '<ul>' + lines.map(l => '<li>' + l + '</li>').join('') + '</ul>';
  if (r.unsupported.length) html += '<p class="nl-bad">这些暂时做不了：' + r.unsupported.join('、') + '</p>';
  if (r.unknown.length) html += '<p class="nl-ex">没听懂：「' + r.unknown.join('」「') + '」</p>';
  if (!lines.length && !r.unsupported.length) {
    html += '<p class="nl-ex">没太听懂，可以试试：「让天空更蓝」「照片太暗了」「背景虚化，人物亮一点」「来点电影感」。</p>';
  } else if (!lines.length && r.unsupported.length) {
    html += '<p class="nl-ex">这句里能做的暂时都还做不了，换个说法试试。</p>';
  }
  box.innerHTML = html;
}
$('#nlInput').addEventListener('input', nlDescribe);
$('#btnNLGo').addEventListener('click', () => {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  if (!nlParsed) nlDescribe();
  const r = nlParsed;
  if (!r || (!r.ops.length && !r.unsupported.length)) { setStatus('没听懂这句，看看下面的示例换个说法'); return; }
  if (!r.ops.length) { setStatus('这些暂时做不了：' + r.unsupported.join('、')); return; }
  const res = window.MTNLEdit.apply(editor, r);
  let msg = '一句话修图完成：执行了 ' + res.done + ' 项';
  if (res.skipped) msg += '；有 ' + res.skipped + ' 组区域调整需要像素图层，已跳过';
  if (r.unsupported.length) msg += '；做不了的：' + r.unsupported.join('、');
  afterOp(msg);
});

/* ---------------- 调节：13 个滑杆 ---------------- */
const ADJUST = [
  { key: 'exposure',    label: '曝光',     min: -3,   max: 3,   step: 0.01 },
  { key: 'brightness',  label: '亮度',     min: -100, max: 100, step: 1 },
  { key: 'contrast',    label: '对比度',   min: -100, max: 100, step: 1 },
  { key: 'temperature', label: '色温',     min: -100, max: 100, step: 1 },
  { key: 'tint',        label: '色调',     min: -100, max: 100, step: 1 },
  { key: 'saturation',  label: '饱和度',   min: -100, max: 100, step: 1 },
  { key: 'vibrance',    label: '自然饱和', min: -100, max: 100, step: 1 },
  { key: 'highlights',  label: '高光',     min: -100, max: 100, step: 1 },
  { key: 'shadows',     label: '阴影',     min: -100, max: 100, step: 1 },
  { key: 'whites',      label: '白色',     min: -100, max: 100, step: 1 },
  { key: 'blacks',      label: '黑色',     min: -100, max: 100, step: 1 },
  { key: 'clarity',     label: '清晰度',   min: -100, max: 100, step: 1 },
  { key: 'sharpen',     label: '锐化',     min: 0,    max: 100, step: 1 }
];
const sliderEls = {};
(function buildSliders() {
  const box = $('#sliderBox');
  for (const a of ADJUST) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    const head = document.createElement('div');
    head.className = 'sr-head';
    const lab = document.createElement('label');
    lab.textContent = a.label;
    lab.title = '双击重置这一项';
    const val = document.createElement('span');
    val.className = 'sr-val'; val.textContent = '0';
    const input = document.createElement('input');
    input.type = 'range'; input.min = a.min; input.max = a.max; input.step = a.step; input.value = 0;
    input.setAttribute('aria-label', a.label);
    head.appendChild(lab); head.appendChild(val);
    row.appendChild(head); row.appendChild(input);
    box.appendChild(row);
    sliderEls[a.key] = { input, val, def: a };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = a.step < 1 ? v.toFixed(2) : String(Math.round(v));
      bumpChange();
      if (editor) { const p = {}; p[a.key] = v; try { editor.setAdjust(p); } catch (e) { /* 忽略 */ } }
    });
    // 数值常驻不归零；松手时只记一个撤销检查点，Ctrl+Z 可逐步退回调节。
    input.addEventListener('change', () => checkpoint());
    lab.addEventListener('dblclick', () => resetOneSlider(a.key));
  }
})();
function resetOneSlider(key) {
  const s = sliderEls[key];
  if (!s) return;
  s.input.value = 0; s.val.textContent = '0';
  bumpChange();
  if (editor) {
    const p = {}; p[key] = 0;
    try { editor.setAdjust(p); } catch (e) { /* 忽略 */ }
    checkpoint();
  }
}
/* 调节/曲线一段操作结束时记撤销检查点（引擎判断无变化则不记） */
function checkpoint(label) {
  if (editor && typeof editor.checkpointAdjust === 'function') {
    try { editor.checkpointAdjust(label || '调节'); } catch (e) { /* 忽略 */ }
  }
}
$('#btnResetAdjust').addEventListener('click', async () => {
  if (!editor) return;
  if (await call(() => editor.resetAdjust(), '重置失败')) {
    bumpChange();
    syncUIFromEngine();
    checkpoint(); // 重置本身也记一步，可撤销回来
    setStatus('已重置全部调节');
    refresh();
  }
});

/* ---------------- 曲线 ---------------- */
const curveState = {
  channel: 'rgb',
  points: {
    rgb: [[0, 0], [255, 255]],
    r: [[0, 0], [255, 255]],
    g: [[0, 0], [255, 255]],
    b: [[0, 0], [255, 255]]
  }
};
const curveCanvas = $('#curveCanvas');
/* 曲线编辑器画线与引擎用同一条 Catmull-Rom 样条（与 engine.js 的 evalSpline 同算法），
   保证画出来的线就是实际生效的线。 */
function evalSplinePts(pts, x) {
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (i < n - 2 && x > pts[i + 1][0]) i++;
  const p1 = pts[i], p2 = pts[i + 1];
  const p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
  const p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
  const t = (x - p1[0]) / Math.max(1, p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
    + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
    + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return Math.max(0, Math.min(255, y));
}
function curveLUT(pts) {
  const arr = pts.slice().sort((a, b) => a[0] - b[0]);
  if (!arr.length || arr[0][0] > 0) arr.unshift([0, arr.length ? arr[0][1] : 0]);
  if (arr[arr.length - 1][0] < 255) arr.push([255, arr[arr.length - 1][1]]);
  const lut = new Array(256);
  for (let x = 0; x < 256; x++) lut[x] = Math.round(evalSplinePts(arr, x));
  return lut;
}
function applyCurves() {
  if (!editor || typeof editor.setCurves !== 'function') return;
  bumpChange();
  try {
    // 引擎 setCurves 接收控制点 [[x,y],...] 并自行按 Catmull-Rom 生成 LUT（与 Java 版一致）；
    // 本文件的 curveLUT 只供曲线编辑器画线显示用，不要传给引擎。
    editor.setCurves({
      rgb: curveState.points.rgb,
      r: curveState.points.r,
      g: curveState.points.g,
      b: curveState.points.b
    });
  } catch (e) { /* 忽略 */ }
}
const CH_COLORS = { rgb: '#e8e8e8', r: '#ff7070', g: '#7bd88a', b: '#6bb5ff' };
function curveXY(e) {
  const r = curveCanvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * curveCanvas.width / r.width;
  const py = (e.clientY - r.top) * curveCanvas.height / r.height;
  return { px, py, x: (px - 14) / (curveCanvas.width - 28) * 255, y: 255 - (py - 14) / (curveCanvas.height - 28) * 255 };
}
function drawCurve() {
  const ctx = curveCanvas.getContext('2d');
  const W = curveCanvas.width, H = curveCanvas.height, pad = 14;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#3d3d3d'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(pad + (W - 2 * pad) * i / 4, pad); ctx.lineTo(pad + (W - 2 * pad) * i / 4, H - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, pad + (H - 2 * pad) * i / 4); ctx.lineTo(W - pad, pad + (H - 2 * pad) * i / 4); ctx.stroke();
  }
  ctx.strokeStyle = '#555';
  ctx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
  // 其它通道淡显
  for (const ch of ['rgb', 'r', 'g', 'b']) {
    if (ch === curveState.channel) continue;
    ctx.strokeStyle = CH_COLORS[ch]; ctx.globalAlpha = 0.25; ctx.lineWidth = 2;
    ctx.beginPath();
    const lut = curveLUT(curveState.points[ch]);
    for (let x = 0; x < 256; x++) {
      const px = pad + x / 255 * (W - 2 * pad), py = pad + (255 - lut[x]) / 255 * (H - 2 * pad);
      if (x === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // 当前通道
  const pts = curveState.points[curveState.channel].slice().sort((a, b) => a[0] - b[0]);
  const lut = curveLUT(pts);
  ctx.strokeStyle = CH_COLORS[curveState.channel]; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x < 256; x++) {
    const px = pad + x / 255 * (W - 2 * pad), py = pad + (255 - lut[x]) / 255 * (H - 2 * pad);
    if (x === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  const ptR = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ? 11 : 7;
  for (const [x, y] of pts) {
    const px = pad + x / 255 * (W - 2 * pad), py = pad + (255 - y) / 255 * (H - 2 * pad);
    ctx.beginPath(); ctx.arc(px, py, ptR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = CH_COLORS[curveState.channel]; ctx.lineWidth = 2.5; ctx.stroke();
  }
}
let curveDrag = null;
let curveSel = -1;
/* 抓取半径按显示像素定：触摸 34px、鼠标 20px，再换算成画布内部像素
   （画布 520 宽显示约 272px，内部 26px 只相当于显示 13.6px，手指根本抓不准） */
function curveGrabRadius(e) {
  const r = curveCanvas.getBoundingClientRect();
  const per = r.width ? curveCanvas.width / r.width : 1;
  return (e && e.pointerType === 'touch' ? 34 : 20) * per;
}
curveCanvas.addEventListener('pointerdown', e => {
  const { px, py, x, y } = curveXY(e);
  const pts = curveState.points[curveState.channel];
  const pad = 14, W = curveCanvas.width, H = curveCanvas.height;
  let best = -1, bestD = curveGrabRadius(e);
  pts.forEach(([qx, qy], i) => {
    const d = Math.hypot(pad + qx / 255 * (W - 2 * pad) - px, pad + (255 - qy) / 255 * (H - 2 * pad) - py);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0) {
    const nx = Math.max(0, Math.min(255, Math.round(x)));
    const ny = Math.max(0, Math.min(255, Math.round(y)));
    pts.push([nx, ny]);
    best = pts.length - 1;
  }
  curveDrag = best;
  curveSel = best;
  curveCanvas.setPointerCapture(e.pointerId);
  drawCurve(); applyCurves();
});
curveCanvas.addEventListener('pointermove', e => {
  if (curveDrag == null) return;
  const { x, y } = curveXY(e);
  const pts = curveState.points[curveState.channel];
  pts[curveDrag] = [Math.max(0, Math.min(255, Math.round(x))), Math.max(0, Math.min(255, Math.round(y)))];
  drawCurve(); applyCurves();
});
curveCanvas.addEventListener('pointerup', () => { curveDrag = null; checkpoint('曲线'); });
curveCanvas.addEventListener('pointercancel', () => { if (curveDrag != null) { curveDrag = null; checkpoint('曲线'); } });
curveCanvas.addEventListener('dblclick', e => {
  const { px, py } = curveXY(e);
  const pts = curveState.points[curveState.channel];
  if (pts.length <= 2) return;
  const pad = 14, W = curveCanvas.width, H = curveCanvas.height;
  let best = -1, bestD = curveGrabRadius(null);
  pts.forEach(([qx, qy], i) => {
    const d = Math.hypot(pad + qx / 255 * (W - 2 * pad) - px, pad + (255 - qy) / 255 * (H - 2 * pad) - py);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best >= 0) { pts.splice(best, 1); curveSel = -1; drawCurve(); applyCurves(); checkpoint('曲线'); }
});
// Esc 退出选框/透视模式；Delete/Backspace 删除选中的曲线点（双击删点的兜底）
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (mode === 'crop' || mode === 'cutout' || mode === 'persp')) {
    exitSelectMode(); setStatus('已取消'); return;
  }
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const pts = curveState.points[curveState.channel];
  if (curveSel < 0 || curveSel >= pts.length || pts.length <= 2) return;
  pts.splice(curveSel, 1);
  curveSel = -1;
  drawCurve(); applyCurves(); checkpoint('曲线');
  setStatus('已删除曲线点');
});
$('#curveChannel').addEventListener('change', e => { curveState.channel = e.target.value; curveSel = -1; drawCurve(); });
$('#btnCurveReset').addEventListener('click', () => {
  curveState.points[curveState.channel] = [[0, 0], [255, 255]];
  drawCurve(); applyCurves(); checkpoint('曲线');
  setStatus('曲线已重置');
});

/* ---------------- 直方图 ---------------- */
function drawHist() {
  const c = $('#histCanvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!editor || typeof editor.getHistogram !== 'function' || !hasImg()) return;
  let data;
  try { data = editor.getHistogram(); } catch (e) { return; }
  if (!data) return;
  let chans = [];
  if (Array.isArray(data)) chans = [{ arr: data, color: 'rgba(220,220,220,0.75)' }];
  else {
    const R = data.r || data.red, G = data.g || data.green, B = data.b || data.blue;
    const L = data.lum || data.luminance || data.gray || data.y;
    if (R && G && B) chans = [
      { arr: R, color: 'rgba(255,90,90,0.55)' },
      { arr: G, color: 'rgba(90,220,120,0.55)' },
      { arr: B, color: 'rgba(90,150,255,0.55)' }
    ];
    else if (L) chans = [{ arr: L, color: 'rgba(220,220,220,0.75)' }];
    else if (data.rgb) chans = [{ arr: data.rgb, color: 'rgba(220,220,220,0.75)' }];
  }
  if (!chans.length) return;
  let max = 1;
  for (const ch of chans) for (let i = 0; i < ch.arr.length; i++) if (ch.arr[i] > max) max = ch.arr[i];
  ctx.globalCompositeOperation = 'lighter';
  for (const ch of chans) {
    ctx.fillStyle = ch.color;
    ctx.beginPath();
    const n = ch.arr.length;
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * c.width;
      const h = ch.arr[i] / max * (c.height - 6);
      ctx.rect(x, c.height - h, Math.max(1, c.width / n), h);
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- 通用滑杆行（滤镜对话框 / 高级调整共用，数据驱动生成） ---------------- */
function sliderRowEl(label, min, max, step, value, onInput, onChange) {
  const dec = (String(step).split('.')[1] || '').length;
  const fmt = v => dec ? Number(v).toFixed(dec) : String(Math.round(v));
  const row = document.createElement('div');
  row.className = 'slider-row';
  const head = document.createElement('div');
  head.className = 'sr-head';
  const lab = document.createElement('label');
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 'sr-val'; val.textContent = fmt(value);
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  input.setAttribute('aria-label', label);
  head.appendChild(lab); head.appendChild(val);
  row.appendChild(head); row.appendChild(input);
  input.addEventListener('input', () => { const v = parseFloat(input.value); val.textContent = fmt(v); onInput(v); });
  if (onChange) input.addEventListener('change', () => onChange(parseFloat(input.value)));
  return row;
}

/* ---------------- 滤镜 ---------------- */
(function buildFilters() {
  const grid = $('#filterGrid');
  const ready = window.MTFilters && Array.isArray(window.MTFilters.list) && window.MTFilters.list.length;
  if (!ready) {
    // 滤镜模块未就绪：整页隐藏
    const tab = $('.tab[data-tab="filters"]'), page = $('.page[data-page="filters"]');
    if (tab) tab.hidden = true;
    if (page) page.hidden = true;
    return;
  }
  const btnById = new Map();
  const markActive = fid => {
    btnById.forEach((b, id) => b.classList.toggle('active', (id || null) === (fid || null)));
  };
  const noneBtn = document.createElement('button');
  noneBtn.className = 'filter-btn active';
  noneBtn.textContent = '无滤镜';
  noneBtn.addEventListener('click', async () => {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    closeFilterDlg(false);
    if (await call(() => editor.clearFilter(), '取消滤镜失败')) afterOp('已取消滤镜');
  });
  grid.appendChild(noneBtn);
  btnById.set(null, noneBtn);
  for (const f of window.MTFilters.list) {
    const b = document.createElement('button');
    b.className = 'filter-btn';
    b.textContent = f.name;
    b.addEventListener('click', async () => {
      if (!hasImg()) { setStatus('先打开一张图片'); return; }
      if (f.params && f.params.length) { openFilterDlg(f); return; }
      closeFilterDlg(false);
      if (await call(() => editor.applyFilter(f.id), '滤镜失败')) afterOp('已应用滤镜：' + f.name);
    });
    grid.appendChild(b);
    btnById.set(f.id, b);
  }
  if (editor && typeof editor.on === 'function') {
    try { editor.on('state', s => markActive(s && s.filter)); } catch (e) { /* 忽略 */ }
  }

  /* ---- 参数对话框：滑杆由 f.params 自动生成，拖动经 setFilterLive 实时预览；
          应用 = checkpoint 记一步撤销；取消 = 把滤镜状态调回打开前 ---- */
  const dlg = $('#filterDlg');
  let dlgCtx = null; // {f, prev:{id, params}, cur:{}}
  function openFilterDlg(f) {
    if (!editor || typeof editor.setFilterLive !== 'function') return;
    const prev = { id: editor.getFilter(), params: editor.getFilterParams ? editor.getFilterParams() : null };
    const cur = {};
    for (const d of f.params) {
      const v = (prev.id === f.id && prev.params && typeof prev.params[d.key] === 'number') ? prev.params[d.key] : d.def;
      cur[d.key] = Math.min(d.max, Math.max(d.min, v));
    }
    dlgCtx = { f, prev, cur };
    $('#filterDlgTitle').textContent = f.name + ' 参数';
    const box = $('#filterDlgSliders');
    box.innerHTML = '';
    for (const d of f.params) {
      box.appendChild(sliderRowEl(d.name, d.min, d.max, d.step, cur[d.key], v => {
        cur[d.key] = v;
        try { editor.setFilterLive(f.id, { ...cur }); } catch (e) { /* 忽略 */ }
      }));
    }
    dlg.hidden = false;
    try { editor.setFilterLive(f.id, { ...cur }); } catch (e) { /* 忽略 */ }
  }
  function closeFilterDlg(apply) {
    if (!dlgCtx) { dlg.hidden = true; return; }
    const { f, prev } = dlgCtx;
    dlgCtx = null;
    dlg.hidden = true;
    if (apply) {
      checkpoint('滤镜')
      afterOp('已应用滤镜：' + f.name);
    } else {
      try { editor.setFilterLive(prev.id, prev.params); } catch (e) { /* 忽略 */ }
      refresh();
    }
  }
  $('#fdApply').addEventListener('click', () => closeFilterDlg(true));
  $('#fdCancel').addEventListener('click', () => closeFilterDlg(false));
  dlg.addEventListener('click', e => { if (e.target === dlg) closeFilterDlg(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dlgCtx) { e.stopPropagation(); closeFilterDlg(false); }
  }, true);
})();

/* ---------------- LUT 电影调色墙 ----------------
   格子 = 当前合成预览缩略图逐个过 LUT 的实时渲染；点格子 = applyLut（状态式一步撤销），
   悬停 = setLutLive 在大图上预览、移开恢复；强度滑杆走 setLutLive + checkpoint。 */
(function buildLutWall() {
  const grid = $('#lutGrid');
  if (!grid || !window.MTLut || !editor) { if (grid) grid.hidden = true; const b = $('#btnLutImport'); if (b) b.hidden = true; return; }
  const LU = window.MTLut;
  let customState = null;          // 导入的 .cube（{id:'custom', name, cube, strength}）
  let hoverSaved = undefined;      // 悬停预览前的大图 LUT 状态（undefined = 未悬停）
  const cells = new Map();         // key(null|'tealOrange'|...|'custom') → {btn, cv}
  let wallSig = '', wallDirty = true, wallTimer = null;

  let painting = false;   // 抓底图时临时摘 LUT 会触发状态事件，用它挡住重入
  /* 底图 = 当前合成预览临时摘掉活动层 LUT 的样子（否则套了一个 LUT 后，
     其他格子的预览会叠在已调色的图上，所见非所得）。 */
  function baseThumb() {
    const cur = editor.getLut ? editor.getLut() : null;
    if (cur) {
      painting = true;
      try { editor.setLutLive(null); } catch (e) { /* 忽略 */ }
    }
    const src = editorCanvas;
    const w = 96, h = Math.max(1, Math.round(96 * src.height / Math.max(1, src.width)));
    const base = document.createElement('canvas');
    base.width = w; base.height = h;
    base.getContext('2d').drawImage(src, 0, 0, w, h);
    if (cur) {
      try { editor.setLutLive(cur); } catch (e) { /* 忽略 */ }
      painting = false;
      markActive(cur);
    }
    return base;
  }
  function paintCell(key, base) {
    const c = cells.get(key);
    if (!c) return;
    const st = key === null ? null : key === 'custom' ? customState : { id: key, strength: 100 };
    if (key === 'custom' && !customState) return;
    const t = st ? LU.applyToCanvas(base, { ...st, strength: 100 }) : base;
    c.cv.width = t.width; c.cv.height = t.height;
    c.cv.getContext('2d').drawImage(t, 0, 0);
  }
  function rebuildWall() {
    if (!hasImg()) return;
    const base = baseThumb();
    cells.forEach((c, key) => paintCell(key, base));
    wallDirty = false;
  }
  function markActive(lut) {
    const key = !lut ? null : lut.id === 'custom' ? 'custom' : lut.id;
    cells.forEach((c, k) => c.btn.classList.toggle('active', k === key));
    const box = $('#lutStrengthBox');
    if (box) box.style.display = lut ? '' : 'none';
    if (lut && strengthInput) {
      strengthInput.value = typeof lut.strength === 'number' ? lut.strength : 100;
      strengthVal.textContent = String(strengthInput.value);
    }
  }
  function ensureCustomCell() {
    if (!customState) return;
    if (!cells.has('custom')) addCell('custom', '自定义');
    if (hasImg()) paintCell('custom', baseThumb());
  }
  function cellState(key) {
    const cur = editor.getLut ? editor.getLut() : null;
    const strength = cur && typeof cur.strength === 'number' ? cur.strength : 100;
    if (key === 'custom') return customState ? { ...customState, strength } : null;
    return { id: key, strength };
  }
  function addCell(key, label) {
    const btn = document.createElement('button');
    btn.className = 'filter-btn lut-cell';
    btn.dataset.lut = key === null ? '' : key;
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 64;
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(cv); btn.appendChild(span);
    btn.addEventListener('click', async () => {
      if (!hasImg()) { setStatus('先打开一张图片'); return; }
      hoverSaved = undefined;
      if (key === null) {
        if (await call(() => editor.clearLut(), '清除 LUT 失败')) afterOp('已清除 LUT 调色');
        return;
      }
      const st = cellState(key);
      if (!st) { setStatus('先导入一个 .cube 文件'); return; }
      if (await call(() => editor.applyLut(st), '应用 LUT 失败')) afterOp('已应用调色：' + label);
    });
    btn.addEventListener('mouseenter', () => {
      if (!hasImg() || key === null) return;
      const st = cellState(key);
      if (!st) return;
      hoverSaved = editor.getLut();
      try { editor.setLutLive(st); } catch (e) { /* 忽略 */ }
    });
    btn.addEventListener('mouseleave', () => {
      if (hoverSaved === undefined) return;
      const prev = hoverSaved;
      hoverSaved = undefined;
      try { editor.setLutLive(prev); } catch (e) { /* 忽略 */ }
      refresh();
    });
    grid.appendChild(btn);
    cells.set(key, { btn, cv });
  }
  addCell(null, '无 LUT');
  for (const p of LU.list) addCell(p.id, p.name);

  /* 强度滑杆：拖动实时混合，松手记一步 */
  let strengthInput = null, strengthVal = null;
  const sBox = $('#lutStrengthBox');
  if (sBox) {
    const row = sliderRowEl('强度', 0, 100, 1, 100, v => {
      const cur = editor.getLut();
      if (!cur) return;
      const next = { ...cur, strength: v };
      if (next.id === 'custom' && customState) customState.strength = v;
      try { editor.setLutLive(next); } catch (e) { /* 忽略 */ }
    }, () => checkpoint('LUT 调色'));
    sBox.appendChild(row);
    strengthInput = row.querySelector('input');
    strengthVal = row.querySelector('.sr-val');
    sBox.style.display = 'none';
  }

  /* 导入 .cube：先由 MTLut.parseCube 校验，坏文件给中文提示、不动图 */
  $('#btnLutImport').addEventListener('click', () => {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    $('#cubeInput').click();
  });
  $('#cubeInput').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      LU.parseCube(text); // 只为校验（引擎应用时会再解析并缓存）
      customState = { id: 'custom', name: f.name, cube: text, strength: 100 };
      ensureCustomCell();
      if (await call(() => editor.applyLut({ ...customState }), '应用 LUT 失败')) {
        afterOp('已导入并应用 LUT：' + f.name);
      }
    } catch (err) {
      setStatus('导入失败：' + (err && err.message ? err.message : '文件无效'));
    }
  });

  if (editor && typeof editor.on === 'function') {
    try {
      editor.on('state', s => {
        if (painting) return;
        if (s && s.lut && s.lut.id === 'custom' && (!customState || customState.cube !== s.lut.cube)) {
          customState = s.lut; // 工程文件打开/撤销带来的自定义 LUT
          ensureCustomCell();
        }
        markActive(s ? s.lut : null);
        const sig = !s || !s.hasImage ? '' :
          s.w + 'x' + s.h + '|' + s.activeLayer + '|' + changeCounter + '|' +
          s.layers.map(l => l.rev + '/' + l.maskRev).join(',');
        if (sig !== wallSig) { wallSig = sig; wallDirty = true; }
        if (wallDirty && $('.page[data-page="filters"]').classList.contains('active')) {
          clearTimeout(wallTimer);
          wallTimer = setTimeout(rebuildWall, 250);
        }
      });
    } catch (e) { /* 忽略 */ }
  }
  const tabBtn = $('.tab[data-tab="filters"]');
  if (tabBtn) tabBtn.addEventListener('click', () => setTimeout(() => { if (wallDirty) rebuildWall(); }, 60));
})();

/* ---------------- 高级调整（MTAdjust.defs 数据驱动生成） ---------------- */
let adjUIState = null;   // 与引擎活动层 adj 状态同步的镜像
let adjSig = '';
let adjDragging = false;
(function buildAdjUI() {
  const box = $('#adjBox');
  if (!box || !window.MTAdjust || !editor) { if (box) box.hidden = true; return; }
  const groups = {};
  function adjLive() {
    bumpChange();
    try { editor.setAdj(adjUIState && Object.keys(adjUIState).length ? adjUIState : null); } catch (e) { /* 忽略 */ }
  }
  function extraRow(def, ex, st) {
    const row = document.createElement('div');
    row.className = 'adj-extra';
    const lab = document.createElement('label');
    lab.textContent = ex.label;
    row.appendChild(lab);
    if (ex.type === 'select') {
      const sel = document.createElement('select');
      for (const o of ex.options) {
        const op = document.createElement('option');
        op.value = o.v; op.textContent = o.t;
        sel.appendChild(op);
      }
      sel.value = ex.get(st);
      sel.addEventListener('change', () => { ex.set(st, parseFloat(sel.value)); paintBody(def); adjLive(); checkpoint('高级调整'); });
      row.appendChild(sel);
    } else if (ex.type === 'check') {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!ex.get(st);
      cb.addEventListener('change', () => { ex.set(st, cb.checked); paintBody(def); adjLive(); checkpoint('高级调整'); });
      row.appendChild(cb);
    } else if (ex.type === 'color') {
      const ci = document.createElement('input');
      ci.type = 'color';
      const c = ex.get(st);
      ci.value = '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
      ci.addEventListener('input', () => {
        const h = ci.value;
        ex.set(st, [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
        adjLive();
      });
      ci.addEventListener('change', () => checkpoint('高级调整'));
      row.appendChild(ci);
    } else if (ex.type === 'preset') {
      const b = document.createElement('button');
      b.className = 'mini-btn adj-preset';
      b.textContent = ex.label;
      b.addEventListener('click', () => { ex.apply(st); paintBody(def); adjLive(); checkpoint('高级调整'); });
      row.appendChild(b);
    }
    return row;
  }
  function paintBody(def) {
    const g = groups[def.id];
    if (!g) return;
    const st = adjUIState && adjUIState[def.id];
    g.check.checked = !!st;
    g.body.innerHTML = '';
    if (!st) { g.body.hidden = true; g.group.classList.remove('open'); return; }
    g.body.hidden = false;
    g.group.classList.add('open');
    for (const ex of (def.extras ? def.extras(st) : [])) g.body.appendChild(extraRow(def, ex, st));
    for (const sl of def.sliders(st)) {
      g.body.appendChild(sliderRowEl(sl.label, sl.min, sl.max, sl.step, sl.get(st),
        v => { adjDragging = true; sl.set(st, v); adjLive(); },
        () => { adjDragging = false; checkpoint('高级调整'); }));
    }
  }
  function paintAll() { for (const def of window.MTAdjust.defs) paintBody(def); }
  for (const def of window.MTAdjust.defs) {
    const group = document.createElement('div');
    group.className = 'adj-group';
    const head = document.createElement('div');
    head.className = 'adj-head';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', '启用' + def.name);
    const name = document.createElement('span');
    name.className = 'adj-name'; name.textContent = def.name;
    const arrow = document.createElement('span');
    arrow.className = 'adj-arrow'; arrow.textContent = '▶';
    head.appendChild(check); head.appendChild(name); head.appendChild(arrow);
    const body = document.createElement('div');
    body.className = 'adj-body';
    body.hidden = true;
    group.appendChild(head); group.appendChild(body);
    box.appendChild(group);
    groups[def.id] = { group, body, check };
    check.addEventListener('change', () => {
      if (!hasImg()) { check.checked = false; setStatus('先打开一张图片'); return; }
      adjUIState = adjUIState || {};
      if (check.checked) adjUIState[def.id] = def.make();
      else delete adjUIState[def.id];
      paintBody(def);
      adjLive();
      checkpoint('高级调整');
      setStatus(check.checked ? '已启用调整：' + def.name : '已关闭调整：' + def.name);
    });
    head.addEventListener('click', e => {
      if (e.target === check) return;
      if (!adjUIState || !adjUIState[def.id]) return;
      body.hidden = !body.hidden;
      group.classList.toggle('open', !body.hidden);
    });
  }
  // 引擎状态变化（切换图层/撤销/重做/载入）时把界面镜像同步回来
  if (editor && typeof editor.on === 'function') {
    try {
      editor.on('state', s => {
        if (adjDragging) return;
        const sig = JSON.stringify((s && s.adj) || null);
        if (sig === adjSig) return;
        adjSig = sig;
        adjUIState = s && s.adj ? JSON.parse(sig) : null;
        paintAll();
      });
    } catch (e) { /* 忽略 */ }
  }
})();

/* ---------------- 智能一键优化 ---------------- */
$('#btnSmart').addEventListener('click', () => {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  if (!window.MTAdjust || !editor || typeof editor.getHistogram !== 'function') { setStatus('优化模块未就绪'); return; }
  const d = window.MTAdjust.autoOptimize(editor.getHistogram());
  const labels = {};
  for (const a of ADJUST) labels[a.key] = a.label;
  const parts = [];
  const merged = {};
  const cur = editor.getAdjust();
  for (const k in d) {
    if (Math.abs(d[k]) < 0.01) continue;
    merged[k] = (cur[k] || 0) + d[k];
    parts.push(labels[k] + ' ' + (d[k] > 0 ? '+' : '') + (k === 'exposure' ? d[k].toFixed(2) : Math.round(d[k])));
  }
  if (!parts.length) { setStatus('画面已经不错，不用优化'); return; }
  editor.setAdjust(merged);
  bumpChange();
  checkpoint('智能一键优化');
  syncUIFromEngine();
  refresh();
  setStatus('智能优化完成：' + parts.join('、'));
});

/* ---------------- 图层 ---------------- */
const BLEND_MODES = [
  ['normal', '正常'], ['dissolve', '溶解'], ['darken', '变暗'], ['multiply', '正片叠底'],
  ['colorBurn', '颜色加深'], ['linearBurn', '线性加深'], ['darkerColor', '深色'],
  ['lighten', '变亮'], ['screen', '滤色'], ['colorDodge', '颜色减淡'], ['linearDodge', '线性减淡'],
  ['lighterColor', '浅色'], ['overlay', '叠加'], ['softLight', '柔光'], ['hardLight', '强光'],
  ['vividLight', '亮光'], ['linearLight', '线性光'], ['pinLight', '点光'], ['hardMix', '实色混合'],
  ['difference', '差值'], ['exclusion', '排除'], ['subtract', '减去'], ['divide', '划分'],
  ['hue', '色相'], ['saturation', '饱和度'], ['color', '颜色'], ['luminosity', '明度']
];
(function buildLayersUI() {
  const listBox = $('#layerList');
  const blendSel = $('#layerBlend');
  const opInput = $('#layerOpacity');
  const opVal = $('#layerOpacityVal');
  if (!listBox || !blendSel || !opInput) return;
  for (const [id, name] of BLEND_MODES) {
    const o = document.createElement('option');
    o.value = id; o.textContent = name;
    blendSel.appendChild(o);
  }
  let sig = '';
  let opacityDragging = false;

  function drawThumb(canvas, layerId) {
    const src = editor && typeof editor.getLayerCanvas === 'function' ? editor.getLayerCanvas(layerId) : null;
    drawFit(canvas, src);
  }

  function drawMaskThumb(canvas, layerId) {
    const src = editor && typeof editor.getLayerMaskCanvas === 'function' ? editor.getLayerMaskCanvas(layerId) : null;
    drawFit(canvas, src);
  }

  function drawFit(canvas, src) {
    if (!src || !src.width) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(canvas.width / src.width, canvas.height / src.height);
    const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
    ctx.drawImage(src, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
  }

  /* 调整图层缩略图：半黑半白圆（Photoshop 调整层图标的简化画法） */
  function drawAdjThumb(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(canvas.width, canvas.height) / 2 - 4;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#e8e8e8'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); ctx.fillStyle = '#1c1c1c'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = '#8a8a8a'; ctx.stroke();
  }

  function startRename(item, meta, idx) {
    const span = item.querySelector('.layer-name');
    if (!span || item.querySelector('.layer-name-input')) return;
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = meta.name;
    span.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = async commit => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      sig = ''; // 强制面板重绘（恢复名称显示）
      if (commit && v && v !== meta.name) {
        if (editor.getActiveLayerIndex && editor.getActiveLayerIndex() !== idx) editor.setActiveLayer(idx);
        if (await call(() => editor.renameLayer(v), '改名失败')) afterOp('图层已改名为「' + v + '」');
        else { sig = ''; renderPanel(lastState); }
      } else {
        sig = '';
        renderPanel(lastState);
      }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', e => e.stopPropagation());
  }

  function renderPanel(s) {
    if (!s || !Array.isArray(s.layers)) return;
    const metas = s.layers;
    const active = metas[s.activeLayer] || null;
    // 顶部控件跟随活动层（拖不透明度时不回写滑杆，避免打架）
    if (active) {
      blendSel.disabled = active.kind === 'adj'; // 调整层混合模式固定普通
      if (document.activeElement !== blendSel) blendSel.value = active.blendMode;
      if (!opacityDragging) {
        opInput.value = Math.round(active.opacity * 100);
        opVal.textContent = Math.round(active.opacity * 100) + '%';
      }
    }
    const newSig = JSON.stringify([s.w, s.h, s.activeLayer,
      metas.map(m => [m.id, m.name, m.kind, m.visible, m.opacity, m.blendMode, m.rev,
        m.hasMask, m.maskEnabled, m.maskRev, m.maskSelected, m.hasStyle])]);
    if (newSig === sig) return;
    if (listBox.querySelector('.layer-name-input')) return; // 正在改名，别冲掉输入框
    sig = newSig;
    listBox.innerHTML = '';
    // 列表自上而下显示（数组是自下而上，倒序渲染）
    for (let vi = metas.length - 1; vi >= 0; vi--) {
      const meta = metas[vi];
      const idx = vi;
      const item = document.createElement('div');
      item.className = 'layer-item' + (meta.active ? ' active' : '');
      const eye = document.createElement('button');
      eye.className = 'layer-eye' + (meta.visible ? '' : ' off');
      eye.title = meta.visible ? '隐藏图层' : '显示图层';
      eye.innerHTML = meta.visible
        ? '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 4l16 16"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17.6 17.6 0 0 1-2.7 3.1M6.1 8A16.9 16.9 0 0 0 2.5 12S6 18 12 18c1.2 0 2.3-.2 3.3-.6"/></svg>';
      eye.addEventListener('click', async e => {
        e.stopPropagation();
        if (!hasImg()) { setStatus('先打开一张图片'); return; }
        if (await call(() => editor.setLayerVisibleAt(idx, !meta.visible), '显隐切换失败')) {
          afterOp(meta.visible ? '已隐藏图层' : '已显示图层');
        }
      });
      const thumb = document.createElement('canvas');
      thumb.className = 'layer-thumb';
      thumb.width = 52; thumb.height = 38;
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = meta.name;
      name.title = meta.name + '（双击改名）';
      item.appendChild(eye); item.appendChild(thumb);
      if (meta.hasMask) {
        const mthumb = document.createElement('canvas');
        mthumb.className = 'layer-thumb layer-mask-thumb' +
          (meta.maskSelected ? ' sel' : '') + (meta.maskEnabled ? '' : ' off');
        mthumb.width = 38; mthumb.height = 38;
        mthumb.title = meta.maskEnabled ? '图层蒙版（点击选中蒙版）' : '图层蒙版（已停用，点击选中）';
        mthumb.addEventListener('click', async e => {
          e.stopPropagation();
          if (!editor || !hasImg()) return;
          if (editor.getActiveLayerIndex && editor.getActiveLayerIndex() !== idx) {
            await call(() => editor.setActiveLayer(idx), '切换图层失败');
          }
          await call(() => editor.setMaskTarget(meta.maskSelected ? null : meta.id), '选中蒙版失败');
          setStatus(meta.maskSelected ? '已取消选中蒙版' : '已选中「' + meta.name + '」的蒙版：反相/停用/删除将对它生效');
        });
        item.appendChild(mthumb);
        drawMaskThumb(mthumb, meta.id);
      }
      item.appendChild(name);
      if (meta.kind === 'adj') {
        const tag = document.createElement('span');
        tag.className = 'layer-tag';
        tag.textContent = '调整';
        item.appendChild(tag);
      }
      if (meta.hasStyle) {
        const ftag = document.createElement('span');
        ftag.className = 'layer-tag';
        ftag.textContent = 'fx';
        ftag.title = '已添加图层样式';
        item.appendChild(ftag);
      }
      item.addEventListener('click', async () => {
        if (!editor || !hasImg()) return;
        if (editor.getActiveLayerIndex && editor.getActiveLayerIndex() === idx) return;
        if (await call(() => editor.setActiveLayer(idx), '切换图层失败')) {
          syncUIFromEngine();
          refresh();
          setStatus('当前图层：' + meta.name);
        }
      });
      item.addEventListener('dblclick', () => startRename(item, meta, idx));
      listBox.appendChild(item);
      if (meta.kind === 'adj') drawAdjThumb(thumb); else drawThumb(thumb, meta.id);
    }
  }
  if (editor && typeof editor.on === 'function') {
    try { editor.on('state', renderPanel); } catch (e) { /* 忽略 */ }
  }

  async function layerOp(fn, label) {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    if (await call(fn, '图层操作失败')) afterOp(label);
  }
  $('#btnLayerAdd').addEventListener('click', () => layerOp(() => editor.addLayer(), '已新建图层'));
  $('#btnLayerDup').addEventListener('click', () => layerOp(() => editor.duplicateLayer(), '已复制图层'));
  $('#btnLayerDel').addEventListener('click', () => layerOp(() => editor.deleteLayer(), '已删除图层'));
  $('#btnLayerUp').addEventListener('click', () => layerOp(() => editor.moveLayer(1), '图层已上移'));
  $('#btnLayerDown').addEventListener('click', () => layerOp(() => editor.moveLayer(-1), '图层已下移'));
  $('#btnLayerMerge').addEventListener('click', () => layerOp(() => editor.mergeDown(), '已向下合并'));
  $('#btnLayerFlatten').addEventListener('click', () => layerOp(() => editor.flatten(), '已拼合为一层'));
  $('#btnLayerAdj').addEventListener('click', () => layerOp(() => editor.addAdjustmentLayer(), '已新建调整图层：用调节/曲线/高级调整给它设置效果，它会作用到下面的层'));
  // ----- 蒙版按钮 -----
  const metaFind = pred => ((lastState && lastState.layers) || []).find(pred) || null;
  const maskTargetMeta = () => metaFind(m => m.maskSelected) || metaFind(m => m.active);
  async function maskOp(fn, label, needMask) {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    if (needMask) {
      const t = maskTargetMeta();
      if (!t || !t.hasMask) { setStatus('还没有蒙版，先给图层添加一个蒙版'); return; }
    }
    if (await call(fn, '蒙版操作失败')) afterOp(label);
  }
  $('#btnMaskWhite').addEventListener('click', () => maskOp(() => editor.addLayerMask('white'), '已给当前层添加白色蒙版（全部显示）'));
  $('#btnMaskBlack').addEventListener('click', () => maskOp(() => editor.addLayerMask('black'), '已给当前层添加黑色蒙版（全部隐藏）'));
  $('#btnMaskSel').addEventListener('click', () => {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    if (!editor.selHas || !editor.selHas()) { setStatus('还没有选区，先用选区工具在图上选一块'); return; }
    maskOp(() => editor.addLayerMask('selection'), '已从选区给当前层添加蒙版');
  });
  $('#btnMaskInvert').addEventListener('click', () => maskOp(() => editor.invertLayerMask(), '蒙版已反相', true));
  $('#btnMaskDel').addEventListener('click', () => maskOp(() => editor.removeLayerMask(), '蒙版已删除', true));
  $('#btnMaskToggle').addEventListener('click', () => {
    const t = maskTargetMeta();
    maskOp(() => editor.setLayerMaskEnabled(!t.maskEnabled),
      t && t.maskEnabled ? '蒙版已停用（图层恢复全部显示）' : '蒙版已启用', true);
  });
  blendSel.addEventListener('change', async () => {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    const name = (BLEND_MODES.find(m => m[0] === blendSel.value) || [])[1] || blendSel.value;
    if (await call(() => editor.setLayerBlendMode(blendSel.value), '混合模式设置失败')) afterOp('混合模式：' + name);
  });
  opInput.addEventListener('input', () => {
    opacityDragging = true;
    const v = parseInt(opInput.value, 10);
    opVal.textContent = v + '%';
    bumpChange();
    if (editor) { try { editor.setLayerOpacity(v / 100); } catch (e) { /* 忽略 */ } }
  });
  opInput.addEventListener('change', () => { opacityDragging = false; checkpoint('图层不透明度'); });
})();

/* ---------------- 图层样式对话框（MTStyles.DEFS 数据驱动生成；拖动经 setLayerStyleLive 实时预览，
   应用 = checkpoint 记一步撤销，取消 = 调回打开前的值；与滤镜参数对话框同口径） ---------------- */
(function buildStyleDlg() {
  const dlgEl = $('#styleDlg');
  const body = $('#styleDlgBody');
  const btn = $('#btnLayerStyle');
  if (!dlgEl || !body || !btn || !window.MTStyles || !editor) return;
  let ctx = null; // {prev, draft}
  const live = () => {
    try { editor.setLayerStyleLive(Object.keys(ctx.draft).length ? ctx.draft : null); } catch (e) { /* 忽略 */ }
  };
  function paramRow(fx, p) {
    if (p.t === 'range') {
      return sliderRowEl(p.label, p.min, p.max, p.step || 1, fx[p.k], v => { fx[p.k] = v; live(); });
    }
    const row = document.createElement('div');
    row.className = 'adj-extra';
    const lab = document.createElement('label');
    lab.textContent = p.label;
    row.appendChild(lab);
    if (p.t === 'color') {
      const ci = document.createElement('input');
      ci.type = 'color'; ci.value = fx[p.k];
      ci.addEventListener('input', () => { fx[p.k] = ci.value; live(); });
      row.appendChild(ci);
    } else if (p.t === 'check') {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!fx[p.k];
      cb.addEventListener('change', () => { fx[p.k] = cb.checked; live(); });
      row.appendChild(cb);
    } else { // select / blend
      const sel = document.createElement('select');
      for (const [v, t] of (p.t === 'blend' ? BLEND_MODES : p.opts)) {
        const op = document.createElement('option');
        op.value = v; op.textContent = t;
        sel.appendChild(op);
      }
      sel.value = fx[p.k];
      sel.addEventListener('change', () => { fx[p.k] = sel.value; live(); });
      row.appendChild(sel);
    }
    return row;
  }
  function paint() {
    body.innerHTML = '';
    for (const def of window.MTStyles.DEFS) {
      const fx = ctx.draft[def.id];
      const group = document.createElement('div');
      group.className = 'adj-group' + (fx && fx.on ? ' open' : '');
      const head = document.createElement('div');
      head.className = 'adj-head';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!(fx && fx.on);
      cb.addEventListener('change', () => {
        if (cb.checked) ctx.draft[def.id] = window.MTStyles.withDefaults(def.id, ctx.draft[def.id] || window.MTStyles.fresh(def.id));
        else if (ctx.draft[def.id]) ctx.draft[def.id].on = false;
        paint(); live();
      });
      const nm = document.createElement('span');
      nm.textContent = def.name;
      head.appendChild(cb); head.appendChild(nm);
      group.appendChild(head);
      if (fx && fx.on) {
        const bd = document.createElement('div');
        bd.className = 'adj-body';
        const full = window.MTStyles.withDefaults(def.id, fx);
        ctx.draft[def.id] = full;
        for (const p of def.params) bd.appendChild(paramRow(full, p));
        group.appendChild(bd);
      }
      body.appendChild(group);
    }
  }
  function open() {
    if (!hasImg()) { setStatus('先打开一张图片'); return; }
    if (activeIsAdj()) { setStatus('调整图层不能添加图层样式，请先切换到一个像素图层'); return; }
    const prev = editor.getLayerStyle ? editor.getLayerStyle() : null;
    ctx = { prev, draft: prev ? JSON.parse(JSON.stringify(prev)) : {} };
    paint();
    dlgEl.hidden = false;
  }
  function close(apply) {
    if (!ctx) { dlgEl.hidden = true; return; }
    const prev = ctx.prev;
    ctx = null;
    dlgEl.hidden = true;
    if (apply) { checkpoint('图层样式'); afterOp('已应用图层样式'); }
    else { try { editor.setLayerStyleLive(prev); } catch (e) { /* 忽略 */ } refresh(); }
  }
  btn.addEventListener('click', open);
  $('#sdApply').addEventListener('click', () => close(true));
  $('#sdCancel').addEventListener('click', () => close(false));
  $('#sdClear').addEventListener('click', () => { if (ctx) { ctx.draft = {}; paint(); live(); } });
  dlgEl.addEventListener('click', e => { if (e.target === dlgEl) close(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ctx) { e.stopPropagation(); close(false); }
  }, true);
})();

/* ---------------- 画笔页（算法在 brush.js，逐项翻译自 PhotoCraft；UI 数据驱动） ---------------- */
const PAINT_TOOLS = [
  { id: 'brush', name: '画笔', sliders: [['size', '大小', 1, 300, 1], ['hard', '硬度', 0, 100, 1], ['opacity', '不透明度', 1, 100, 1]] },
  { id: 'eraser', name: '橡皮擦', sliders: [['size', '大小', 1, 300, 1], ['hard', '硬度', 0, 100, 1], ['opacity', '不透明度', 1, 100, 1]] },
  { id: 'smudge', name: '涂抹', sliders: [['size', '大小', 1, 300, 1], ['hard', '硬度', 0, 100, 1], ['strength', '强度', 1, 100, 1]] },
];
const SHAPE_KINDS = [['rect', '矩形'], ['ellipse', '椭圆'], ['polygon', '多边形'], ['star', '星形'], ['line', '直线']];
let paintTool = 'brush';
let shapeTool = null;               // null = 画笔类工具；否则为形状 kind
const toolParams = {
  brush: { size: 40, hard: 80, opacity: 100 },
  eraser: { size: 40, hard: 80, opacity: 100 },
  smudge: { size: 40, hard: 50, strength: 50 },
};
const shapeParams = { sides: 6, points: 5, ratio: 40 };
let shapeStrokeW = 3;
let brushHover = null;              // 原图坐标（笔尖圆圈用）
let shapeDrag = null;               // {x0,y0,x1,y1} 原图坐标
let strokeCtx = null;               // {stroke, ctx, img} 进行中的一笔
const paintToolIsShape = () => !!shapeTool;
const shapeOpt = () => ({ sides: shapeParams.sides, points: shapeParams.points, ratio: shapeParams.ratio / 100 });
function hexToRgb(hex) { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function updateBrushTargetHint() {
  const el = $('#brushTargetHint');
  if (!el || !editor || !editor.getMaskTarget) return;
  el.textContent = editor.getMaskTarget() != null
    ? '当前目标：选中图层的蒙版（画笔按颜色灰度画、橡皮擦涂黑=隐藏、涂抹晕开灰度）。在图上拖动即可画，一笔算一步撤销。'
    : '当前目标：当前图层像素。在图上拖动即可画，一笔算一步撤销。';
}

function startStroke(p, e) {
  if (!window.MTBrush || !editor.beginPaint) { setStatus('画笔模块未就绪'); return; }
  const info = editor.beginPaint(paintTool === 'eraser' ? '橡皮擦' : paintTool === 'smudge' ? '涂抹' : '画笔');
  if (info === false) { setStatus('当前是调整图层，没有像素可以画（给它加蒙版并选中蒙版，或先切换到像素图层）'); return; }
  if (!info) return;
  const tp = toolParams[paintTool];
  const isMask = info.target === 'mask';
  const opts = {
    size: tp.size, hardness: tp.hard / 100,
    sel: (editor.selHas && editor.selHas()) ? editor.selGetMask() : null,
  };
  if (paintTool === 'eraser') {
    // 橡皮作用于像素层 = destination-out（alpha *= 1−k，PhotoCraft erase 口径）；
    // 作用于蒙版（无 alpha 的灰度面）= 涂黑（隐藏），等同 Photoshop 在蒙版上以前景黑擦
    Object.assign(opts, isMask ? { kind: 'gray', gray: 0, opacity: tp.opacity / 100 }
                               : { kind: 'erase', opacity: tp.opacity / 100 });
  } else if (paintTool === 'smudge') {
    Object.assign(opts, { kind: 'smudge', strength: tp.strength / 100 });
  } else {
    const fg = hexToRgb($('#inBrushColor').value);
    // 画笔作用于蒙版：前景色取灰度（Rec.601 亮度）；作用于像素层：原色
    Object.assign(opts, isMask ? { kind: 'gray', gray: Math.round(0.299 * fg[0] + 0.587 * fg[1] + 0.114 * fg[2]), opacity: tp.opacity / 100 }
                               : { kind: 'paint', color: fg, opacity: tp.opacity / 100 });
  }
  const ctx2 = info.canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx2.getImageData(0, 0, info.w, info.h);
  const stroke = window.MTBrush.createStroke(opts);
  stroke.attach(img);
  strokeCtx = { stroke, ctx: ctx2, img };
  try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  stroke.start(p.x, p.y);
  flushStroke();
}
function flushStroke() {
  if (!strokeCtx) return;
  const d = strokeCtx.stroke.dirty;
  if (isFinite(d.x0) && d.x1 > d.x0 && d.y1 > d.y0) {
    strokeCtx.ctx.putImageData(strokeCtx.img, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    strokeCtx.stroke.clearDirty();
    editor.paintRefresh();
  }
}
function finishStroke() {
  if (!strokeCtx) return;
  flushStroke();
  strokeCtx = null;
  editor.endPaint();
  bumpChange();
}

/* 形状松手落笔：在临时画布上按几何+填充/描边画好，经 stampCanvas 落到活动层 */
function commitShape() {
  const d = shapeDrag;
  shapeDrag = null;
  drawOverlay();
  if (!d || !window.MTBrush) return;
  if (shapeTool !== 'line' && (Math.abs(d.x1 - d.x0) < 2 || Math.abs(d.y1 - d.y0) < 2)) { setStatus('形状太小，没有画'); return; }
  if (activeIsAdj()) { setStatus('当前是调整图层，没有像素可以画形状，请先切换到像素图层'); return; }
  const sz = imgSize();
  if (!sz) return;
  const tmp = document.createElement('canvas');
  tmp.width = sz.w; tmp.height = sz.h;
  const tctx = tmp.getContext('2d');
  const geom = window.MTBrush.shapeGeom(shapeTool, d.x0, d.y0, d.x1, d.y1, shapeOpt());
  window.MTBrush.tracePath(tctx, geom);
  if (geom.type === 'line') {
    tctx.strokeStyle = $('#chkShapeStroke').checked ? $('#inShapeStroke').value : $('#inShapeFill').value;
    tctx.lineWidth = shapeStrokeW;
    tctx.lineCap = 'round';
    tctx.stroke();
  } else {
    if ($('#chkShapeFill').checked) {
      if ($('#chkShapeGrad').checked) { // 线性渐变沿拖拽方向（t = 投影/拖拽长度，PhotoCraft 口径）
        const gr = tctx.createLinearGradient(d.x0, d.y0, d.x1, d.y1);
        gr.addColorStop(0, $('#inShapeFill').value);
        gr.addColorStop(1, $('#inShapeGrad2').value);
        tctx.fillStyle = gr;
      } else {
        tctx.fillStyle = $('#inShapeFill').value;
      }
      tctx.fill();
    }
    if ($('#chkShapeStroke').checked && shapeStrokeW > 0) {
      tctx.strokeStyle = $('#inShapeStroke').value;
      tctx.lineWidth = shapeStrokeW;
      tctx.stroke();
    }
  }
  call(() => editor.stampCanvas(tmp, (SHAPE_KINDS.find(k => k[0] === shapeTool) || [])[1] || '形状'), '形状绘制失败').then(ok => { if (ok) afterOp('形状已绘制'); });
}

/* overlay 上的形状预览与笔尖圆圈 */
function drawBrushOverlay(ctx, ox, oy, sx, sy, dpr) {
  if (mode !== 'brush') return;
  const X = v => ox + v * sx, Y = v => oy + v * sy;
  if (shapeDrag && window.MTBrush) {
    const geom = window.MTBrush.shapeGeom(shapeTool, shapeDrag.x0, shapeDrag.y0, shapeDrag.x1, shapeDrag.y1, shapeOpt());
    ctx.save();
    ctx.beginPath();
    if (geom.type === 'rect') ctx.rect(X(geom.x), Y(geom.y), geom.w * sx, geom.h * sy);
    else if (geom.type === 'ellipse') ctx.ellipse(X(geom.cx), Y(geom.cy), Math.max(0, geom.rx * sx), Math.max(0, geom.ry * sy), 0, 0, Math.PI * 2);
    else if (geom.type === 'line') { ctx.moveTo(X(geom.x0), Y(geom.y0)); ctx.lineTo(X(geom.x1), Y(geom.y1)); }
    else if (geom.type === 'poly' && geom.pts.length) {
      ctx.moveTo(X(geom.pts[0][0]), Y(geom.pts[0][1]));
      for (let i = 1; i < geom.pts.length; i++) ctx.lineTo(X(geom.pts[i][0]), Y(geom.pts[i][1]));
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(77,163,255,0.30)';
    ctx.fill();
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (brushHover && !paintToolIsShape()) {
    const r = toolParams[paintTool].size / 2 * sx;
    const cxp = X(brushHover.x), cyp = Y(brushHover.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1.8 * dpr;
    ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.arc(cxp, cyp, Math.max(0, r - 1.2 * dpr), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

(function buildBrushUI() {
  const toolsBox = $('#brushTools'), shapeBox = $('#shapeTools');
  if (!toolsBox || !shapeBox || !editor) return;
  const markTools = () => {
    $$('#brushTools .cell-btn').forEach(b => b.classList.toggle('active', !shapeTool && b.dataset.ptool === paintTool));
    $$('#shapeTools .cell-btn').forEach(b => b.classList.toggle('active', shapeTool === b.dataset.shape));
  };
  const rebuildSliders = () => {
    const box = $('#brushSliders');
    box.innerHTML = '';
    const def = PAINT_TOOLS.find(t => t.id === paintTool);
    for (const [key, label, mn, mx, st] of def.sliders) {
      box.appendChild(sliderRowEl(label, mn, mx, st, toolParams[paintTool][key], v => { toolParams[paintTool][key] = v; }));
    }
    $('#brushColorField').style.display = paintTool === 'brush' ? '' : 'none';
    const sbox = $('#shapeSliders');
    sbox.innerHTML = '';
    if (shapeTool === 'polygon') sbox.appendChild(sliderRowEl('边数', 3, 12, 1, shapeParams.sides, v => { shapeParams.sides = v; }));
    if (shapeTool === 'star') {
      sbox.appendChild(sliderRowEl('角数', 3, 16, 1, shapeParams.points, v => { shapeParams.points = v; }));
      sbox.appendChild(sliderRowEl('内径比 %', 5, 95, 1, shapeParams.ratio, v => { shapeParams.ratio = v; }));
    }
  };
  for (const t of PAINT_TOOLS) {
    const b = document.createElement('button');
    b.className = 'cell-btn';
    b.textContent = t.name;
    b.dataset.ptool = t.id;
    b.addEventListener('click', () => {
      paintTool = t.id; shapeTool = null;
      markTools(); rebuildSliders(); updateBrushTargetHint();
      if (hasImg()) setMode('brush');
    });
    toolsBox.appendChild(b);
  }
  for (const [id, name] of SHAPE_KINDS) {
    const b = document.createElement('button');
    b.className = 'cell-btn';
    b.textContent = name;
    b.dataset.shape = id;
    b.addEventListener('click', () => {
      shapeTool = id;
      markTools(); rebuildSliders();
      if (hasImg()) setMode('brush');
    });
    shapeBox.appendChild(b);
  }
  $('#shapeStrokeBox').appendChild(sliderRowEl('描边宽', 1, 40, 1, shapeStrokeW, v => { shapeStrokeW = v; }));
  markTools();
  rebuildSliders();
})();

/* ---------------- 选区页 ---------------- */
let selTool = 'rect';
let wandTol = 32;
(function buildSelectUI() {
  const tools = $$('#selTools .sel-tool');
  if (!tools.length || !editor) return;
  tools.forEach(b => b.addEventListener('click', () => {
    selTool = b.dataset.seltool;
    tools.forEach(x => x.classList.toggle('active', x === b));
    if (hasImg()) setMode('select');
  }));
  $('#wandTolBox').appendChild(sliderRowEl('魔棒容差', 0, 255, 1, wandTol, v => { wandTol = v; }));
  let featherR = 5;
  $('#selFeatherBox').appendChild(sliderRowEl('羽化半径', 0, 100, 1, featherR, v => { featherR = v; }));
  const needImg = () => { if (!hasImg()) { setStatus('先打开一张图片'); return false; } return true; };
  const needSel = () => {
    if (!needImg()) return false;
    if (!editor.selHas || !editor.selHas()) { setStatus('还没有选区，先用选区工具在图上选一块'); return false; }
    return true;
  };
  const selOp = (fn, label) => { if (needSel()) call(fn, '选区操作失败').then(ok => { if (ok) setStatus(label); }); };
  $('#btnSelAll').addEventListener('click', () => { if (needImg()) call(() => editor.selAll(), '全选失败').then(ok => { if (ok) setStatus('已全选'); }); });
  $('#btnSelInvert').addEventListener('click', () => selOp(() => editor.selInvert(), '已反选'));
  $('#btnSelNone').addEventListener('click', () => { if (needImg()) call(() => editor.selNone(), '取消选区失败').then(ok => { if (ok) setStatus('已取消选区'); }); });
  $('#btnSelFeather').addEventListener('click', () => selOp(() => editor.selFeather(featherR), '已羽化 ' + featherR + ' px'));
  $('#btnSelExpand').addEventListener('click', () => {
    const n = parseInt($('#inSelMorph').value, 10);
    if (n > 0) selOp(() => editor.selExpand(n), '选区已扩展 ' + n + ' px'); else setStatus('先填扩展像素数');
  });
  $('#btnSelContract').addEventListener('click', () => {
    const n = parseInt($('#inSelMorph').value, 10);
    if (n > 0) selOp(() => editor.selContract(n), '选区已收缩 ' + n + ' px'); else setStatus('先填收缩像素数');
  });
  $('#btnSelDelete').addEventListener('click', async () => {
    if (!needSel()) return;
    if (activeIsAdj()) { setStatus('当前是调整图层，没有像素内容可以删除'); return; }
    if (await call(() => editor.selDeleteContent(), '删除失败')) afterOp('已删除选区内容');
  });
  $('#btnSelFill').addEventListener('click', async () => {
    if (!needSel()) return;
    if (activeIsAdj()) { setStatus('当前是调整图层，没有像素可以填充'); return; }
    const hex = $('#inSelFillColor').value || '#000000';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    if (await call(() => editor.selFill(r, g, b), '填充失败')) afterOp('已填充选区');
  });
  // 选区状态行 + 选区变化时重画蚂蚁线（rev 变了才重画）
  let lastSelRev = -1;
  try {
    editor.on('state', s => {
      const sel = s && s.selection;
      const el = $('#selStat');
      if (el) el.textContent = sel && sel.active ? '当前选区：约 ' + sel.count.toLocaleString() + ' 个像素（含部分覆盖的边缘）' : '无选区';
      const rev = sel ? sel.rev : -1;
      if (rev !== lastSelRev) { lastSelRev = rev; drawOverlay(); }
    });
  } catch (e) { /* 忽略 */ }
})();

/* ---------------- 几何 ---------------- */
let sizeRatio = 1;
$('#btnRotL').addEventListener('click', async () => { if (await call(() => editor.rotate90(-1), '旋转失败')) afterOp('已向左旋转 90°'); });
$('#btnRotR').addEventListener('click', async () => { if (await call(() => editor.rotate90(1), '旋转失败')) afterOp('已向右旋转 90°'); });
$('#btnFlipH').addEventListener('click', async () => { if (await call(() => editor.flipH(), '翻转失败')) afterOp('已水平翻转'); });
$('#btnFlipV').addEventListener('click', async () => { if (await call(() => editor.flipV(), '翻转失败')) afterOp('已垂直翻转'); });
$('#inW').addEventListener('input', () => {
  if (!$('#chkAspect').checked) return;
  const w = parseFloat($('#inW').value);
  if (w > 0 && sizeRatio) $('#inH').value = Math.max(1, Math.round(w / sizeRatio));
});
$('#inH').addEventListener('input', () => {
  if (!$('#chkAspect').checked) return;
  const h = parseFloat($('#inH').value);
  if (h > 0 && sizeRatio) $('#inW').value = Math.max(1, Math.round(h * sizeRatio));
});
$('#btnResize').addEventListener('click', async () => {
  const w = Math.round(parseFloat($('#inW').value));
  const h = Math.round(parseFloat($('#inH').value));
  if (!w || !h || w < 1 || h < 1) { setStatus('宽高要填正整数'); return; }
  if (await call(() => editor.resizeTo(w, h), '改尺寸失败')) afterOp('尺寸已改为 ' + w + ' × ' + h);
});
$('#btnCropMode').addEventListener('click', () => enterSelectMode('crop'));

/* ---------------- 文字 ---------------- */
let texts = [];
let textSeq = 0;
const scratchCtx = document.createElement('canvas').getContext('2d');
function textFont(t) { return (t.bold ? '700 ' : '400 ') + t.size + 'px sans-serif'; }
function syncTexts() {
  bumpChange();
  if (!editor || typeof editor.setTexts !== 'function') return;
  try {
    editor.setTexts(texts.map(t => ({ text: t.text, x: t.x, y: t.y, size: t.size, color: t.color, bold: t.bold })));
  } catch (e) { /* 忽略 */ }
}
function hitText(p) {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    scratchCtx.font = textFont(t);
    const w = scratchCtx.measureText(t.text).width;
    if (p.x >= t.x && p.x <= t.x + w && p.y >= t.y && p.y <= t.y + t.size * 1.25) return t;
  }
  return null;
}
function renderTextList() {
  const box = $('#textList');
  box.innerHTML = '';
  for (const t of texts) {
    const item = document.createElement('div');
    item.className = 'text-item';
    const span = document.createElement('span');
    span.textContent = t.text;
    span.title = t.text;
    const del = document.createElement('button');
    del.textContent = '删除';
    del.addEventListener('click', () => {
      texts = texts.filter(x => x.id !== t.id);
      syncTexts(); renderTextList();
    });
    item.appendChild(span); item.appendChild(del);
    box.appendChild(item);
  }
}
$('#btnAddText').addEventListener('click', () => {
  const txt = $('#inText').value.trim();
  if (!txt) { setStatus('先输入文字内容'); return; }
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  const s = imgSize() || { w: 800, h: 600 };
  const size = Math.max(8, Math.min(400, parseInt($('#inTextSize').value, 10) || 48));
  scratchCtx.font = ( $('#chkTextBold').checked ? '700 ' : '400 ') + size + 'px sans-serif';
  const w = scratchCtx.measureText(txt).width;
  texts.push({
    id: ++textSeq, text: txt,
    x: Math.round((s.w - w) / 2), y: Math.round(s.h / 2 - size / 2),
    size: size, color: $('#inTextColor').value, bold: $('#chkTextBold').checked
  });
  syncTexts(); renderTextList();
  setStatus('文字已添加，在图片上拖动可改位置');
});
$('#btnCommitTexts').addEventListener('click', async () => {
  if (!texts.length) { setStatus('还没有添加文字'); return; }
  if (await call(() => editor.commitTexts(), '应用文字失败')) {
    texts = []; renderTextList();
    afterOp('文字已应用到图片');
  }
});

/* ---------------- 导出 / 保存 ---------------- */
const lastExport = { format: 'png', quality: 0.92 };
let sourceFormat = null, sourceBytes = 0; // 当前图片的来源格式/体积：默认导出跟随它，避免 JPG 照片被默认存成巨大的 PNG
function fmtExt(f) { return f === 'jpeg' ? 'jpg' : f; }
function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB'; }
function syncQualityRow() {
  $('#qualityRow').style.display = $('#selFormat').value === 'png' ? 'none' : 'flex';
}
$('#selFormat').addEventListener('change', () => {
  lastExport.format = $('#selFormat').value; syncQualityRow(); scheduleQuickEstimate();
});
$('#inQuality').addEventListener('input', () => {
  $('#qualityVal').textContent = $('#inQuality').value;
  lastExport.quality = parseInt($('#inQuality').value, 10) / 100;
  scheduleQuickEstimate();
});
/* 画布（预览合成）里有没有透明像素：缩小采样扫 alpha，够判定默认格式用 */
function hasTransparency() {
  try {
    const t = document.createElement('canvas'); t.width = 48; t.height = 48;
    const x = t.getContext('2d'); x.drawImage(editorCanvas, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch (e) { /* 忽略 */ }
  return false;
}
/* 载入新图后定默认导出格式：有透明 → PNG 保真；否则跟随原图格式；样片/工程默认 JPEG */
function applyExportDefault() {
  let f = sourceFormat || 'jpeg';
  if (hasTransparency()) f = 'png';
  lastExport.format = f;
  $('#selFormat').value = f;
  syncQualityRow();
  scheduleQuickEstimate();
}
/* 导出栏旁的体积预估：按当前格式/质量真实编码一次，并与原图体积对照 */
let qeTimer = null;
function scheduleQuickEstimate() { clearTimeout(qeTimer); qeTimer = setTimeout(quickEstimate, 500); }
async function quickEstimate() {
  const el = $('#quickEst');
  if (!el) return;
  if (!editor || !hasImg()) { el.textContent = ''; return; }
  try {
    const blob = await editor.exportBlob({ format: lastExport.format, quality: lastExport.quality });
    el.textContent = '约 ' + fmtBytes(blob.size) + (sourceBytes ? '（原图 ' + fmtBytes(sourceBytes) + '）' : '');
  } catch (e) { el.textContent = ''; }
}
try { editor.on('state', scheduleQuickEstimate); } catch (e) { /* 忽略 */ }
syncQualityRow();

async function doExport(format, quality, opts) {
  opts = opts || {};
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  setStatus('正在导出…');
  $('#busyText').textContent = '正在导出…';
  $('#busy').hidden = false;
  await new Promise(r => setTimeout(r, 60)); // 先让忙碌态画出来，大图导出是同步重活
  let blob = null;
  try { blob = await editor.exportBlob({ format: format, quality: quality, scaleTo: opts.scaleTo || null }); }
  catch (e) { $('#busy').hidden = true; setStatus('导出失败：' + (e && e.message ? e.message : '未知错误')); return; }
  $('#busy').hidden = true;
  if (!blob) { setStatus('导出失败：没有生成文件'); return; }
  exportedCounter = changeCounter;
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  let name = 'meowtu-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
               pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.' + fmtExt(format);
  if (opts.name) { // 对话框给的文件名：去掉路径与旧扩展名，按格式补扩展名
    const base = String(opts.name).replace(/[\\/:*?"<>|]/g, '').replace(/\.[a-z0-9]+$/i, '').trim();
    if (base) name = base + '.' + fmtExt(format);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  setStatus('已导出 ' + name);
}
$('#btnExport').addEventListener('click', () => {
  lastExport.format = $('#selFormat').value;
  lastExport.quality = parseInt($('#inQuality').value, 10) / 100;
  doExport(lastExport.format, lastExport.quality);
});
$('#btnSave').addEventListener('click', () => doExport(lastExport.format, lastExport.quality));

/* ---------------- 保存工程（.meowtu：完整图层文档 JSON 下载） ---------------- */
function saveProject() {
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  const proj = editor.exportProject();
  if (!proj) { setStatus('保存工程失败'); return; }
  const json = JSON.stringify(proj);
  const name = expDefaultName() + '.meowtu';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  // 大图防呆：估算体积过大只提示、不阻断
  if (json.length > 80 * 1024 * 1024) {
    setStatus('工程文件较大（约 ' + (json.length / 1048576).toFixed(0) + ' MB），已保存为 ' + name);
  } else {
    setStatus('已保存工程 ' + name);
  }
}
$('#btnSaveProject').addEventListener('click', saveProject);

/* ---------------- 修图配方（.meowtu-recipe：只存层状态不存像素） ---------------- */
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function fileToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
async function readRecipeFile(file) {
  let obj = null;
  try { obj = JSON.parse(await file.text()); } catch (e) { /* 下面统一报损坏 */ }
  if (!obj || obj.format !== window.MT.recipe.format) throw new Error('这不是喵图配方文件');
  if (obj.version !== window.MT.recipe.version) throw new Error('配方文件版本不受支持（版本 ' + obj.version + '）');
  if (!Array.isArray(obj.layers) || !obj.layers.length) throw new Error('配方文件已损坏，无法打开');
  return obj;
}
$('#btnRecipeSave').addEventListener('click', () => {
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  const recipe = editor.exportRecipe();
  if (!recipe) { setStatus('保存配方失败'); return; }
  const name = expDefaultName() + '.meowtu-recipe';
  downloadBlob(new Blob([JSON.stringify(recipe)], { type: 'application/json' }), name);
  setStatus('已保存配方 ' + name + '（共 ' + recipe.layers.length + ' 层状态）');
});
let recipeInputMode = 'apply';   // 'apply' 套到当前图 | 'batch' 先收配方再选图
let batchRecipe = null;
$('#btnRecipeApply').addEventListener('click', () => {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  recipeInputMode = 'apply';
  $('#recipeInput').click();
});
$('#btnRecipeBatch').addEventListener('click', () => {
  if (batchRecipe) { $('#batchInput').click(); return; }
  recipeInputMode = 'batch';
  setStatus('先选一个配方文件，再选要批量处理的图片');
  $('#recipeInput').click();
});
$('#recipeInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let recipe = null;
  try { recipe = await readRecipeFile(f); }
  catch (err) { setStatus('配方打开失败：' + (err && err.message ? err.message : '文件无效')); return; }
  if (recipeInputMode === 'batch') {
    if (recipe.layers.length !== 1) {
      setStatus('批量套用只支持单层配方，这个配方有 ' + recipe.layers.length + ' 层，已取消');
      return;
    }
    batchRecipe = recipe;
    $('#recipeInfo').textContent = '已载入配方：' + f.name + '（单层），点「批量套用」可继续换图。';
    setStatus('配方已载入，再选要批量处理的图片');
    $('#batchInput').click();
    return;
  }
  const ok = await call(() => editor.applyRecipe(recipe), '应用配方失败');
  if (ok) {
    bumpChange();
    const metas = editor.getLayers();
    setStatus('已应用配方（套了 ' + Math.min(recipe.layers.length, metas.length) + ' 层' +
      (recipe.layers.length > metas.length ? '；配方共 ' + recipe.layers.length + ' 层，多出的已忽略' : '') + '）');
    refresh();
  }
});
$('#batchInput').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length || !batchRecipe) return;
  let done = 0;
  for (const f of files) {
    setStatus('批量处理中 ' + (done + 1) + '/' + files.length + '：' + f.name);
    try {
      const cv = await fileToCanvas(f);
      const ed2 = window.MT.createEditor(document.createElement('canvas'));
      ed2.loadCanvas(cv);
      ed2.applyRecipe(batchRecipe);
      const blob = await ed2.exportBlob({ format: 'png' });
      downloadBlob(blob, f.name.replace(/\.[^.]+$/, '') + '-配方.png');
      done++;
    } catch (err) { /* 单张失败不中断其余 */ }
    await new Promise(r => setTimeout(r, 120));
  }
  setStatus(done ? '批量完成：已导出 ' + done + ' 张（文件名带 -配方 后缀）' : '批量失败：一张都没处理成功');
});

/* ---------------- 导出对话框（构成参考 PhotoCraft Export As：格式/质量/
   尺寸（比例或指定宽度）/文件名/体积预估；预估按当前设置真实编码一次，
   设置变化防抖重估。对话框导出会更新 lastExport，Ctrl+S 快速保存随之走） ---------------- */
let expTimer = null;
function expTargetSize() {
  const s = imgSize();
  if (!s) return null;
  const mode = $('#expScale').value;
  if (mode === 'width') {
    const w = Math.max(1, parseInt($('#expWidth').value, 10) || s.w);
    return { w: w, h: Math.max(1, Math.round(s.h * w / s.w)) };
  }
  const f = parseFloat(mode) || 1;
  return { w: Math.max(1, Math.round(s.w * f)), h: Math.max(1, Math.round(s.h * f)) };
}
function expSyncRows() {
  $('#expQualityRow').style.display = $('#expFormat').value === 'png' ? 'none' : 'flex';
  $('#expWidthRow').hidden = $('#expScale').value !== 'width';
  const t = expTargetSize();
  $('#expSizeInfo').textContent = t ? '输出尺寸：' + t.w + ' × ' + t.h : '';
}
async function expEstimate() {
  const el = $('#expEstimate');
  if (!hasImg() || !editor) { el.textContent = '预估体积：—'; return; }
  const format = $('#expFormat').value;
  const quality = parseInt($('#expQuality').value, 10) / 100;
  const t = expTargetSize();
  el.textContent = '预估体积：计算中…';
  try {
    const blob = await editor.exportBlob({ format: format, quality: quality, scaleTo: t });
    if ($('#exportDlg').hidden) return;
    el.textContent = '预估体积：约 ' + (blob.size >= 1048576
      ? (blob.size / 1048576).toFixed(2) + ' MB' : (blob.size / 1024).toFixed(1) + ' KB');
  } catch (e) { el.textContent = '预估体积：计算失败'; }
}
function expSchedule() { clearTimeout(expTimer); expTimer = setTimeout(expEstimate, 250); }
function expDefaultName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return 'meowtu-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function openExportDlg() {
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  $('#expFormat').value = lastExport.format;
  $('#expQuality').value = Math.round(lastExport.quality * 100);
  $('#expQualityVal').textContent = $('#expQuality').value;
  $('#expScale').value = '1';
  $('#expName').value = expDefaultName();
  expSyncRows();
  $('#exportDlg').hidden = false;
  expEstimate();
}
$('#btnExportDlg').addEventListener('click', openExportDlg);
$('#expCancel').addEventListener('click', () => { $('#exportDlg').hidden = true; });
$('#exportDlg').addEventListener('click', e => { if (e.target === $('#exportDlg')) $('#exportDlg').hidden = true; });
$('#expFormat').addEventListener('change', () => { expSyncRows(); expSchedule(); });
$('#expScale').addEventListener('change', () => { expSyncRows(); expSchedule(); });
$('#expWidth').addEventListener('input', () => { expSyncRows(); expSchedule(); });
$('#expQuality').addEventListener('input', () => {
  $('#expQualityVal').textContent = $('#expQuality').value;
  expSchedule();
});
$('#expOk').addEventListener('click', () => {
  const format = $('#expFormat').value;
  const quality = parseInt($('#expQuality').value, 10) / 100;
  const t = expTargetSize();
  const name = $('#expName').value;
  lastExport.format = format;
  lastExport.quality = quality;
  $('#selFormat').value = format;
  syncQualityRow();
  $('#exportDlg').hidden = true;
  doExport(format, quality, { name: name, scaleTo: t });
});

/* ---------------- 对比：按住看原图 ---------------- */
const compareView = $('#compareView');
function showCompare() {
  if (!origURL || !hasImg()) return;
  const cr = editorCanvas.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  compareView.style.left = (cr.left - wr.left) + 'px';
  compareView.style.top = (cr.top - wr.top) + 'px';
  compareView.style.width = cr.width + 'px';
  compareView.style.height = cr.height + 'px';
  if (compareView.getAttribute('src') !== origURL) compareView.src = origURL;
  compareView.classList.add('on');
}
function hideCompare() { compareView.classList.remove('on'); }
$('#btnCompare').addEventListener('pointerdown', e => { e.preventDefault(); showCompare(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('#btnCompare').addEventListener(ev, hideCompare));

/* ---------------- 快捷键 ---------------- */
document.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); $('#btnUndo').click(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); $('#btnRedo').click(); }
  else if (k === 'a' && hasImg() && editor && editor.selAll) { e.preventDefault(); editor.selAll(); setStatus('已全选'); }
  else if (k === 'd' && hasImg() && editor && editor.selNone) { e.preventDefault(); editor.selNone(); setStatus('已取消选区'); }
  else if (k === 'i' && e.shiftKey && hasImg() && editor && editor.selInvert) { e.preventDefault(); editor.selInvert(); setStatus('已反选'); }
  else if (k === 'o') { e.preventDefault(); fileInput.click(); }
  else if (k === 's') { e.preventDefault(); doExport(lastExport.format, lastExport.quality); }
  else if (k === 't' && hasImg()) { e.preventDefault(); enterTransformMode(); }
});
/* 自由变换模式的确认/取消键（输入框聚焦时不触发） */
document.addEventListener('keydown', e => {
  if (mode !== 'transform') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
  if (e.key === 'Enter') { e.preventDefault(); exitTransform(true); }
  else if (e.key === 'Escape') { e.preventDefault(); exitTransform(false); setStatus('已取消自由变换'); }
});

/* ---------------- 容错：模块未就绪时隐藏 ---------------- */
(function hideMissingModules() {
  if (!(window.MTSelection && typeof window.MTSelection.wand === 'function')) {
    const tab = $('.tab[data-tab="select"]'), page = $('.page[data-page="select"]');
    if (tab) tab.hidden = true;
    if (page) page.hidden = true;
    if (currentTab === 'select') switchTab('adjust');
  }
  if (!(window.MTGrabCut && typeof window.MTGrabCut.cut === 'function')) {
    const tab = $('.tab[data-tab="cutout"]'), page = $('.page[data-page="cutout"]');
    const tool = $('.tool[data-tool="cutout"]');
    if (tab) tab.hidden = true;
    if (page) page.hidden = true;
    if (tool) tool.style.display = 'none';
    if (currentTab === 'cutout') switchTab('adjust');
  }
  if (editor && typeof editor.setCurves !== 'function') {
    // 引擎不支持曲线时不报错，applyCurves 已做静默处理
  }
})();

/* ---------------- 初始化 ---------------- */
$('#cfOk').addEventListener('click', () => settleConfirm(true));
$('#cfCancel').addEventListener('click', () => settleConfirm(false));
$('#btnPerspMode').addEventListener('click', () => enterPerspectiveMode());
sizeOverlay();
drawCurve();
refresh();
if (editor) setStatus('就绪');

/* ================================================================
   展示打磨（新增，全部走新控件 + 既有公开路径，不改引擎语义）
   ① 展示样片菜单 ② before/after 对比滑杆 ③ 一键演示
   ================================================================ */

/* ---------- ① 展示样片：MTSamples 程序绘制，载入走 editor.loadCanvas ---------- */
async function loadSampleArt(id, skipConfirm) {
  if (!editor || !window.MTSamples) { setStatus('样片模块未就绪'); return false; }
  if (!skipConfirm && isDirty() && !await confirmDiscard()) { setStatus('已取消'); return false; }
  const c = window.MTSamples.make(id);
  if (!c) return false;
  const ok = await call(() => editor.loadCanvas(c), '样片载入失败');
  if (ok) {
    sourceFormat = null; sourceBytes = 0;
    const meta = window.MTSamples.list.find(s => s.id === id);
    setStatus('已载入展示样片：' + (meta ? meta.name : id));
    exitSelectMode();
    snapshotFromCanvas();
    exportedCounter = changeCounter;
    syncUIFromEngine();
    refresh();
    applyExportDefault();
  }
  return ok;
}
(function buildSampleMenu() {
  const btn = $('#btnSampleMenu');
  if (!btn || !window.MTSamples) return;
  const menu = document.createElement('div');
  menu.id = 'sampleMenu'; menu.hidden = true;
  const addItem = (label, thumbCanvas, fn) => {
    const b = document.createElement('button');
    b.className = 'sample-item';
    if (thumbCanvas) b.appendChild(thumbCanvas);
    const s = document.createElement('span');
    s.className = 'si-name'; s.textContent = label;
    b.appendChild(s);
    b.addEventListener('click', () => { menu.hidden = true; fn(); });
    menu.appendChild(b);
    return b;
  };
  addItem('经典示例图', null, () => loadSample());
  for (const s of window.MTSamples.list) {
    const b = addItem('样片 · ' + s.name, null, () => loadSampleArt(s.id, false));
    b.dataset.sample = s.id;
    b.dataset.thumbPending = '1';
  }
  document.body.appendChild(menu);
  let thumbsDone = false;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!menu.hidden) { menu.hidden = true; return; }
    if (!thumbsDone) {           // 缩略图懒画一次：用样片原图缩小
      thumbsDone = true;
      menu.querySelectorAll('[data-thumb-pending]').forEach(b => {
        const c = window.MTSamples.make(b.dataset.sample);
        if (!c) return;
        const t = document.createElement('canvas');
        t.width = 168; t.height = 112;
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        b.insertBefore(t, b.firstChild);
        delete b.dataset.thumbPending;
      });
    }
    const r = btn.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = Math.max(6, Math.min(r.left, innerWidth - 220)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
  });
  document.addEventListener('pointerdown', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) menu.hidden = true;
  });
})();

/* ---------- ② 对比滑杆：左 = 原图（origURL 快照），右 = 当前效果 ----------
   compareCanvas 只在分界线左侧画原图、其余透明，底下的 editorCanvas 就是效果图；
   重绘时机：引擎 state 事件 / 拖动 / 开关 / 窗口尺寸变化。与「按住对比」互不影响。 */
const cmpCv = $('#compareCanvas'), cmpCtx = cmpCv.getContext('2d'), cmpBar = $('#compareBar');
let cmpOn = false, cmpPos = 0.5, cmpImg = null, cmpImgURL = null;
function drawCompare() {
  if (!cmpOn) return;
  const w = editorCanvas.width, h = editorCanvas.height;
  if (!w || !h || !origURL) return;
  if (cmpImgURL !== origURL) {
    cmpImgURL = origURL; cmpImg = null;
    const im = new Image();
    im.onload = () => { if (cmpImgURL === origURL) { cmpImg = im; drawCompare(); } };
    im.src = origURL;
  }
  if (cmpCv.width !== w || cmpCv.height !== h) { cmpCv.width = w; cmpCv.height = h; }
  cmpCtx.clearRect(0, 0, w, h);
  if (cmpImg) {
    const px = Math.round(w * cmpPos);
    cmpCtx.save();
    cmpCtx.beginPath(); cmpCtx.rect(0, 0, px, h); cmpCtx.clip();
    cmpCtx.drawImage(cmpImg, 0, 0, w, h);
    cmpCtx.restore();
  }
  cmpBar.style.left = (cmpPos * 100) + '%';
}
function setComparePos(f) {
  cmpPos = Math.min(0.98, Math.max(0.02, f));
  drawCompare();
}
function setCompare(on) {
  if (on && !hasImg()) { setStatus('先打开一张图片'); return; }
  cmpOn = on;
  cmpCv.classList.toggle('on', on);
  cmpBar.hidden = !on;
  $('#btnCompareSlider').classList.toggle('active', on);
  if (on) { drawCompare(); setStatus('对比滑杆：左边原图、右边效果，拖动中间的圆钮移动分界线'); }
}
$('#btnCompareSlider').addEventListener('click', () => setCompare(!cmpOn));
(function cmpDrag() {
  let dragging = false;
  const posFromEvent = e => {
    const r = editorCanvas.getBoundingClientRect();
    return r.width ? (e.clientX - r.left) / r.width : cmpPos;
  };
  cmpBar.addEventListener('pointerdown', e => {
    dragging = true;
    cmpBar.setPointerCapture(e.pointerId);
    setComparePos(posFromEvent(e));
    e.preventDefault();
  });
  cmpBar.addEventListener('pointermove', e => { if (dragging) setComparePos(posFromEvent(e)); });
  ['pointerup', 'pointercancel'].forEach(ev => cmpBar.addEventListener(ev, () => { dragging = false; }));
})();
if (editor && typeof editor.on === 'function') {
  try { editor.on('state', () => { if (cmpOn) drawCompare(); }); } catch (e) { /* 忽略 */ }
}
window.addEventListener('resize', drawCompare);
window.MTCompare = { setPos: setComparePos, pos: () => cmpPos, on: () => cmpOn, set: setCompare };

/* ---------- ③ 一键演示：预设脚本走真实按钮/API 路径，每步字幕说明，可随时停 ---------- */
let demo = null;   // { stop:bool, step:int }
const demoSleep = ms => new Promise(r => setTimeout(r, ms));
async function demoWait(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!demo || demo.stop) throw new Error('demo-stop');
    await demoSleep(120);
  }
}
async function demoWaitFor(fn, timeout, what) {
  const t0 = Date.now();
  while (!fn()) {
    if (!demo || demo.stop) throw new Error('demo-stop');
    if (Date.now() - t0 > timeout) throw new Error('演示等待超时：' + what);
    await demoSleep(150);
  }
}
function sayNl(text) {
  switchTab('smart');
  const inp = $('#nlInput');
  inp.value = text;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}
const DEMO_STEPS = [
  { cap: '第 1 步：载入「风景」展示样片（程序绘制：天空、远山、湖面、草地）', run: async () => { await loadSampleArt('landscape', true); } },
  { cap: '第 2 步：一句话修图 ——「让天空更蓝，照片更有电影感」，本机解析、按区域执行', run: async () => {
      sayNl('让天空更蓝，照片更有电影感'); await demoWait(700); $('#btnNLGo').click(); } },
  { cap: '第 3 步：再套一层电影调色 LUT「青橙」（悬停可预览、点选即生效）', run: async () => {
      switchTab('filters'); await demoWait(400);
      const cell = $('.lut-cell[data-lut="tealOrange"]'); if (cell) cell.click(); } },
  { cap: '第 4 步：换「人像」样片 —— 肤色人物 + 影棚背景', run: async () => { await loadSampleArt('portrait', true); } },
  { cap: '第 5 步：一句话 ——「背景虚化，人物亮一点」，背景和人像分开处理', run: async () => {
      sayNl('背景虚化，人物亮一点'); await demoWait(700); $('#btnNLGo').click(); } },
  { cap: '第 6 步：框选抠图（GrabCut），再一键换上「蓝天白云」背景', run: async () => {
      switchTab('cutout'); $('#btnCutMode').click(); await demoWait(500);
      const s = imgSize(); if (!s) throw new Error('无人像样片');
      selection = clampSel({ x: s.w * 0.27, y: s.h * 0.06, w: s.w * 0.46, h: s.h * 0.92 });
      drawOverlay();
      await demoWait(600);
      $('#selOk').click();
      await demoWaitFor(() => $('#busy').hidden, 30000, '抠图');
      await demoWait(500);
      const bg = $('#bgGrid [data-bg="sceneSky"]'); if (bg) bg.click(); } },
  { cap: '第 7 步：新建图层写上「喵图 MeowTu」，再给文字层加投影', run: async () => {
      switchTab('layers'); $('#btnLayerAdd').click(); await demoWait(500);
      switchTab('text');
      $('#inText').value = '喵图 MeowTu';
      $('#inTextSize').value = 76;
      $('#inTextColor').value = '#ffffff';
      $('#chkTextBold').checked = true;
      $('#btnAddText').click(); await demoWait(400);
      $('#btnCommitTexts').click();
      await demoWaitFor(() => !$('#textList').children.length, 8000, '文字应用');
      switchTab('layers'); $('#btnLayerStyle').click(); await demoWait(600);
      const grp = Array.from($('#styleDlgBody').querySelectorAll('.adj-group'))
        .find(gr => gr.querySelector('.adj-head span') && gr.querySelector('.adj-head span').textContent === '投影');
      if (!grp) throw new Error('样式对话框没有投影项');
      const cb = grp.querySelector('.adj-head input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
      await demoWait(600);
      $('#sdApply').click(); } },
  { cap: '第 8 步：打开导出对话框收尾 —— 格式、质量、缩放、体积预估一目了然', run: async () => {
      $('#btnExportDlg').click(); await demoWait(400); } },
];
async function startDemo() {
  if (demo && !demo.stop) return;
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  demo = { stop: false, step: -1 };
  $('#demoBar').hidden = false;
  $('#btnDemo').disabled = true;
  try {
    for (let i = 0; i < DEMO_STEPS.length; i++) {
      demo.step = i;
      $('#demoCaption').textContent = DEMO_STEPS[i].cap;
      await demoWait(650);
      await DEMO_STEPS[i].run();
      await demoWait(2000);
    }
    demo.step = DEMO_STEPS.length;
    $('#demoCaption').textContent = '演示完成：一句话修图、LUT 调色、区域虚化、抠图换背景、文字层投影、导出 —— 全程真实功能';
    setStatus('一键演示完成');
    await demoSleep(3200);
  } catch (e) {
    if (!e || e.message !== 'demo-stop') setStatus('演示中断：' + (e && e.message ? e.message : '未知错误'));
    else setStatus('演示已停止');
  }
  $('#demoBar').hidden = true;
  $('#btnDemo').disabled = false;
  demo = null;
}
function stopDemo() { if (demo) demo.stop = true; }
$('#btnDemo').addEventListener('click', startDemo);
$('#btnDemoStop').addEventListener('click', stopDemo);
window.MTDemo = {
  start: startDemo, stop: stopDemo,
  info: () => ({ running: !!demo, step: demo ? demo.step : -1, caption: $('#demoCaption').textContent }),
  loadSampleArt,
};
