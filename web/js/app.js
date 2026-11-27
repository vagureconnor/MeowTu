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

/* ---------------- 打开图片：选文件 / 拖拽 / 粘贴 ---------------- */
async function loadFile(file) {
  if (!editor || !file) return;
  if (file.type && !file.type.startsWith('image/')) { setStatus('这不是图片文件'); return; }
  if (isDirty() && !await confirmDiscard()) { setStatus('已取消打开'); return; }
  setStatus('正在打开 ' + (file.name || '图片') + '…');
  const ok = await call(() => editor.loadFile(file), '打开失败');
  if (ok) {
    try { setOrig(URL.createObjectURL(file)); } catch (e) { snapshotFromCanvas(); }
    setStatus('已打开 ' + (file.name || '图片'));
    exitSelectMode();
    exportedCounter = changeCounter;
    syncUIFromEngine();
    refresh();
  }
}
async function loadSample() {
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  if (isDirty() && !await confirmDiscard()) { setStatus('已取消'); return; }
  setStatus('正在生成示例图…');
  const ok = await call(() => editor.newSample(), '示例图生成失败');
  if (ok) {
    setStatus('示例图已生成，可以开始试用各功能');
    exitSelectMode();
    snapshotFromCanvas();
    exportedCounter = changeCounter;
    syncUIFromEngine();
    refresh();
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
  else if (mode === 'text') setMode('browse');
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
let mode = 'browse';           // browse | crop | cutout | text | persp
let selection = null;          // 原图坐标 {x,y,w,h}
let perspQuad = null;          // 透视四角（原图坐标）[左上,右上,右下,左下]
let dragInfo = null;           // 拖动过程状态

function setMode(m) {
  mode = m;
  overlay.style.pointerEvents = (m === 'browse') ? 'none' : 'auto';
  overlay.style.cursor = (m === 'crop' || m === 'cutout') ? 'crosshair' : (m === 'persp' ? 'move' : 'default');
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
  if (mode === 'crop' || mode === 'cutout' || mode === 'persp') setMode(currentTab === 'text' ? 'text' : 'browse');
  selection = null; perspQuad = null; dragInfo = null;
  $('#selBar').hidden = true;
  clearOverlay();
}
$('#selCancel').addEventListener('click', () => { exitSelectMode(); setStatus('已取消'); });
$('#selOk').addEventListener('click', () => {
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
  if (mode === 'crop' || mode === 'cutout') {
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
  if (!dragInfo) return;
  const p = toImage(e);
  if (dragInfo.kind === 'select') {
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
overlay.addEventListener('pointerup', () => { dragInfo = null; });
overlay.addEventListener('pointercancel', () => { dragInfo = null; });
new ResizeObserver(() => { sizeOverlay(); if (selection || perspQuad) drawOverlay(); }).observe(wrap);

/* ---------------- 抠图 ----------------
   输入取引擎的全分辨率当前效果（不再用降采样预览，否则大图抠完尺寸缩水）；
   结果经 applyCanvas 作为一步可撤销操作回灌（不再走打开文件、历史不清空）。 */
function runGrabCut(rect) {
  if (!window.MTGrabCut || typeof window.MTGrabCut.cut !== 'function') { setStatus('抠图模块未就绪'); return; }
  if (!editor || typeof editor.renderFullCanvas !== 'function') { setStatus('编辑引擎未就绪'); return; }
  exitSelectMode();
  $('#busyText').textContent = '正在抠图，大图会慢一点…';
  $('#busy').hidden = false;
  // 同步重活：先让忙碌态画出来，再开算
  setTimeout(() => {
    const fail = msg => { $('#busy').hidden = true; setStatus('抠图失败：' + msg); };
    try {
      const full = editor.renderFullCanvas();
      if (!full) { fail('没有图片'); return; }
      const fctx = full.getContext('2d');
      const imgData = fctx.getImageData(0, 0, full.width, full.height);
      const handle = r => {
        if (!r || !r.width) { fail('结果格式无法识别'); return; }
        const c = document.createElement('canvas');
        c.width = r.width; c.height = r.height;
        c.getContext('2d').putImageData(r, 0, 0);
        $('#busy').hidden = true;
        call(() => editor.applyCanvas(c), '抠图失败').then(ok => { if (ok) afterOp('抠图完成'); });
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
$('#btnCutMode').addEventListener('click', () => enterSelectMode('cutout'));

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
function checkpoint() {
  if (editor && typeof editor.checkpointAdjust === 'function') {
    try { editor.checkpointAdjust(); } catch (e) { /* 忽略 */ }
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
curveCanvas.addEventListener('pointerup', () => { curveDrag = null; checkpoint(); });
curveCanvas.addEventListener('pointercancel', () => { if (curveDrag != null) { curveDrag = null; checkpoint(); } });
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
  if (best >= 0) { pts.splice(best, 1); curveSel = -1; drawCurve(); applyCurves(); checkpoint(); }
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
  drawCurve(); applyCurves(); checkpoint();
  setStatus('已删除曲线点');
});
$('#curveChannel').addEventListener('change', e => { curveState.channel = e.target.value; curveSel = -1; drawCurve(); });
$('#btnCurveReset').addEventListener('click', () => {
  curveState.points[curveState.channel] = [[0, 0], [255, 255]];
  drawCurve(); applyCurves(); checkpoint();
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
  for (const f of window.MTFilters.list) {
    const b = document.createElement('button');
    b.className = 'filter-btn';
    b.textContent = f.name;
    b.addEventListener('click', async () => {
      if (!hasImg()) { setStatus('先打开一张图片'); return; }
      if (await call(() => editor.applyFilter(f.id), '滤镜失败')) afterOp('已应用滤镜：' + f.name);
    });
    grid.appendChild(b);
  }
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
function fmtExt(f) { return f === 'jpeg' ? 'jpg' : f; }
function syncQualityRow() {
  $('#qualityRow').style.display = $('#selFormat').value === 'png' ? 'none' : 'flex';
}
$('#selFormat').addEventListener('change', () => {
  lastExport.format = $('#selFormat').value; syncQualityRow();
});
$('#inQuality').addEventListener('input', () => {
  $('#qualityVal').textContent = $('#inQuality').value;
  lastExport.quality = parseInt($('#inQuality').value, 10) / 100;
});
syncQualityRow();

async function doExport(format, quality) {
  if (!editor) { setStatus('编辑引擎未就绪'); return; }
  if (!hasImg()) { setStatus('先打开一张图片'); return; }
  setStatus('正在导出…');
  $('#busyText').textContent = '正在导出…';
  $('#busy').hidden = false;
  await new Promise(r => setTimeout(r, 60)); // 先让忙碌态画出来，大图导出是同步重活
  let blob = null;
  try { blob = await editor.exportBlob({ format: format, quality: quality }); }
  catch (e) { $('#busy').hidden = true; setStatus('导出失败：' + (e && e.message ? e.message : '未知错误')); return; }
  $('#busy').hidden = true;
  if (!blob) { setStatus('导出失败：没有生成文件'); return; }
  exportedCounter = changeCounter;
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name = 'meowtu-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
               pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.' + fmtExt(format);
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
  else if (k === 'o') { e.preventDefault(); fileInput.click(); }
  else if (k === 's') { e.preventDefault(); doExport(lastExport.format, lastExport.quality); }
});

/* ---------------- 容错：模块未就绪时隐藏 ---------------- */
(function hideMissingModules() {
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
