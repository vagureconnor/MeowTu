// MTBrush — 画笔 / 橡皮 / 涂抹 / 形状的像素算法，逐项翻译自 PhotoCraft（storytold/photocraft）：
//   crates/paint/src/lib.rs       笔尖剖面 TIP_SHAPE（对 Photoshop 的实测表）、tip_shape、soft_exp、dab_coverage
//   crates/paint/src/dynamics.rs  间距步进 step_len = 直径 × spacing（直径下限 1、步长下限 0.5px）；dab.alpha = flow
//   crates/paint/src/render.rs    覆盖累积 c ← c + v·(ceil − c)（ceil = dab 不透明度上限，默认 1）；
//                                 整笔合成 k = c × 笔刷不透明度 × 选区覆盖；橡皮 px[a] *= 1 − k
//   crates/paint/src/retouch.rs   涂抹 Smudge：携带色缓冲（预乘空间），lay_down k = cov × strength，
//                                 pickup 时缓冲以 keep = strength 与当前像素混合
//   crates/vector/src/shapes.rs   多边形/星形：内切于拖拽矩形的椭圆、首顶点在顶部、星形奇数顶点按 star_ratio 缩放
//   crates/compose/src/gradient_fill.rs + crates/algo/src/paint.rs
//                                 线性渐变 t = 沿拖拽方向的投影 / 拖拽长度，钳制 0..1（填充用 Canvas2D 同式实现）
// 形状的路径填充/描边走 Canvas2D（与 engine.js 既有 fillEllipse/fillPolygon 同一口径），顶点几何按上源生成。
// 像素统一为 RGBA 字节（ImageData.data），浏览器与 Node 通用。
(function (g) {
  'use strict';
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);

  /* ---------- 笔尖剖面（lib.rs TIP_SHAPE / tip_shape / TipProfile） ---------- */
  // [核心半径占比, 肩部宽度占比]，按硬度 0, 0.1, …, 1 线性插值
  const TIP_SHAPE = [[0, 0.664], [0.14, 0.58], [0.28, 0.50], [0.40, 0.44], [0.52, 0.36], [0.63, 0.29],
                     [0.70, 0.24], [0.78, 0.19], [0.84, 0.15], [0.89, 0.11], [1.00, 0.0]];
  const TIP_EDGE_PX = 1.2; // 抗锯齿边缘：肩部不窄于此、核心至少内缩此值（小笔尖按比例收窄）
  function tipProfile(radius, hardness) {
    const h = (isNaN(hardness) ? 0 : Math.max(0, Math.min(1, hardness))) * 10;
    const i = Math.min(9, Math.floor(h)), t = h - i;
    const r0 = TIP_SHAPE[i][0] + (TIP_SHAPE[i + 1][0] - TIP_SHAPE[i][0]) * t;
    const s0 = TIP_SHAPE[i][1] + (TIP_SHAPE[i + 1][1] - TIP_SHAPE[i][1]) * t;
    const R = isFinite(radius) ? Math.max(0, radius) : 0;
    const edge = Math.max(0.25, Math.min(TIP_EDGE_PX, 0.3 * R));
    const core = Math.max(0, Math.min(r0 * R, R - edge));
    const shoulder = Math.max(1e-3, s0 * R, edge);
    return { core, shoulder, reach: core + 2.6 * shoulder };
  }
  // exp(−u) 的定点近似：(1 − u/64) 连平方 6 次 = ^64（lib.rs soft_exp）
  function softExp(u) {
    let x = clamp01(1 - u / 64);
    for (let i = 0; i < 6; i++) x *= x;
    return x;
  }
  function dabCoverage(p, d) {
    if (!(d >= 0) || d >= p.reach + 0.5) return 0;
    if (d <= p.core) return 1;
    const x = (d - p.core) / p.shoulder;
    return softExp(x * x);
  }

  /* ---------- 路径步进（dynamics.rs PathWalker / step_len_for） ---------- */
  function stepLen(size, spacing) {
    return Math.max(Math.max(size, 1) * Math.max(spacing, 0.01), 0.5);
  }
  // 从 pts[0] 起，每 stepLen 沿折线发一个 dab（段间余距结转）
  function walkDabs(pts, step, emit) {
    if (!pts.length || !(step > 0)) return;
    emit(pts[0][0], pts[0][1]);
    let left = step;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1];
      const dx = pts[i][0] - ax, dy = pts[i][1] - ay;
      const seg = Math.hypot(dx, dy);
      let used = 0;
      while (left <= seg - used) {
        used += left;
        const t = seg ? used / seg : 0;
        emit(ax + dx * t, ay + dy * t);
        left = step;
      }
      left -= seg - used;
    }
  }

  /* ---------- 一笔（画笔 / 橡皮 / 蒙版灰 / 涂抹） ----------
   * opts: { kind:'paint'|'erase'|'gray'|'smudge', color:[r,g,b], gray:0..255,
   *         size, hardness:0..1, opacity:0..1, flow:0..1（默认 1）, spacing（默认 0.1）,
   *         strength:0..1（涂抹）, sel:Uint8Array|null（选区覆盖 0..255） }
   * 用法：const st = createStroke(opts); st.attach(imgData); st.start(x,y); st.move(x,y); st.end();
   * imgData 被原地改写；st.dirty 是已改动的包围盒 {x0,y0,x1,y1}（x1/y1 不含），供局部回写画布。 */
  function createStroke(o) {
    const kind = o.kind || 'paint';
    const radius = Math.max(0.5, (o.size || 20) / 2);
    const prof = tipProfile(radius, o.hardness == null ? 1 : o.hardness);
    const opacity = o.opacity == null ? 1 : clamp01(o.opacity);
    const flow = o.flow == null ? 1 : clamp01(o.flow);
    const strength = o.strength == null ? 0.5 : clamp01(o.strength);
    const step = stepLen(o.size || 20, o.spacing == null ? 0.1 : o.spacing);
    const sel = o.sel || null;
    let data = null, W = 0, H = 0;
    let last = null;
    const dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const markDirty = (x0, y0, x1, y1) => {
      if (x0 < dirty.x0) dirty.x0 = x0; if (y0 < dirty.y0) dirty.y0 = y0;
      if (x1 > dirty.x1) dirty.x1 = x1; if (y1 > dirty.y1) dirty.y1 = y1;
    };
    const selAt = (x, y) => sel ? sel[y * W + x] / 255 : 1;

    /* 覆盖累积缓冲（按包围盒生长）+ 笔前像素快照：合成恒从快照重算，
       与 PhotoCraft「私有笔触层累积覆盖、再整笔合成到笔前像素」同义。 */
    let cov = null, orig = null, bx = 0, by = 0, bw = 0, bh = 0;
    function growCov(x0, y0, x1, y1) {
      if (cov && x0 >= bx && y0 >= by && x1 <= bx + bw && y1 <= by + bh) return;
      const nx = cov ? Math.min(bx, x0) : x0, ny = cov ? Math.min(by, y0) : y0;
      const nw = (cov ? Math.max(bx + bw, x1) : x1) - nx, nh = (cov ? Math.max(by + bh, y1) : y1) - ny;
      const nc = new Float32Array(nw * nh), no = new Uint8ClampedArray(nw * nh * 4);
      // 新区域的快照取自当前 data（尚未被本笔写过，仍是笔前像素）
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const si = ((ny + y) * W + (nx + x)) * 4, di = (y * nw + x) * 4;
        no[di] = data[si]; no[di + 1] = data[si + 1]; no[di + 2] = data[si + 2]; no[di + 3] = data[si + 3];
      }
      if (cov) for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const si = (y * bw + x), di = ((by - ny + y) * nw + (bx - nx + x));
        nc[di] = cov[si];
        const s4 = si * 4, d4 = di * 4;
        no[d4] = orig[s4]; no[d4 + 1] = orig[s4 + 1]; no[d4 + 2] = orig[s4 + 2]; no[d4 + 3] = orig[s4 + 3];
      }
      cov = nc; orig = no; bx = nx; by = ny; bw = nw; bh = nh;
    }
    // 从快照按覆盖 c 合成一个像素（k = c × opacity × 选区；render.rs composite / erase 口径）
    function compositeAt(x, y) {
      const ci = (y - by) * bw + (x - bx), si = ci * 4, di = (y * W + x) * 4;
      const k = cov[ci] * opacity * selAt(x, y);
      if (k <= 0) return;
      const sr = orig[si], sg = orig[si + 1], sb = orig[si + 2], sa = orig[si + 3];
      if (kind === 'erase') { // px[a] *= 1 − k（RGB 不动）
        data[di] = sr; data[di + 1] = sg; data[di + 2] = sb;
        data[di + 3] = clamp255(sa * (1 - k));
        return;
      }
      if (kind === 'gray') { // 蒙版是灰度面：over_native 无 alpha 路径 dst += (src − dst)·k
        const gv = o.gray || 0;
        data[di] = clamp255(sr + (gv - sr) * k);
        data[di + 1] = clamp255(sg + (gv - sg) * k);
        data[di + 2] = clamp255(sb + (gv - sb) * k);
        data[di + 3] = sa;
        return;
      }
      // paint：source-over（over_native，源 alpha = k）
      const da = sa / 255, oa = k + da * (1 - k);
      if (oa <= 0) { data[di + 3] = 0; return; }
      const col = o.color || [0, 0, 0];
      data[di] = clamp255((col[0] * k + sr * da * (1 - k)) / oa);
      data[di + 1] = clamp255((col[1] * k + sg * da * (1 - k)) / oa);
      data[di + 2] = clamp255((col[2] * k + sb * da * (1 - k)) / oa);
      data[di + 3] = clamp255(oa * 255);
    }
    function stampDab(cx, cy) {
      const x0 = Math.max(0, Math.floor(cx - prof.reach - 0.5)), x1 = Math.min(W - 1, Math.ceil(cx + prof.reach + 0.5));
      const y0 = Math.max(0, Math.floor(cy - prof.reach - 0.5)), y1 = Math.min(H - 1, Math.ceil(cy + prof.reach + 0.5));
      if (x1 < x0 || y1 < y0) return;
      growCov(x0, y0, x1 + 1, y1 + 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const v = dabCoverage(prof, Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) * flow;
        if (v <= 0) continue;
        const ci = (y - by) * bw + (x - bx);
        const c = cov[ci];
        cov[ci] = c + v * (1 - c); // ceil = 1（dab 不透明度上限，render.rs accumulate）
        compositeAt(x, y);
      }
      markDirty(x0, y0, x1 + 1, y1 + 1);
    }

    /* ---------- 涂抹（retouch.rs Smudge）：携带色缓冲（预乘，0..1 浮点） ---------- */
    const SR = Math.ceil(radius) + 2;              // sampling_radius：ceil(最大半径) + 2
    const SIDE = 2 * SR + 1;
    let carry = null;
    const premultAt = (x, y, out, i) => {
      const di = (y * W + x) * 4, a = data[di + 3] / 255;
      out[i] = data[di] / 255 * a; out[i + 1] = data[di + 1] / 255 * a; out[i + 2] = data[di + 2] / 255 * a; out[i + 3] = a;
    };
    function smudgeDab(cxF, cyF) {
      const cx = Math.floor(cxF), cy = Math.floor(cyF);
      if (!carry) { // 首 dab：从笔下像素拾色（钳制到画布内）
        carry = new Float32Array(SIDE * SIDE * 4);
        const one = [0, 0, 0, 0];
        for (let qy = 0; qy < SIDE; qy++) for (let qx = 0; qx < SIDE; qx++) {
          const x = Math.max(0, Math.min(W - 1, cx + qx - SR)), y = Math.max(0, Math.min(H - 1, cy + qy - SR));
          premultAt(x, y, one, 0);
          carry.set(one, (qy * SIDE + qx) * 4);
        }
      }
      // lay down：足迹内逐像素，k = cov × strength × 选区，预乘空间 lerp（mix_premultiplied）
      const x0 = Math.max(0, Math.floor(cxF - prof.reach - 0.5)), x1 = Math.min(W - 1, Math.ceil(cxF + prof.reach + 0.5));
      const y0 = Math.max(0, Math.floor(cyF - prof.reach - 0.5)), y1 = Math.min(H - 1, Math.ceil(cyF + prof.reach + 0.5));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const covv = dabCoverage(prof, Math.hypot(x + 0.5 - cxF, y + 0.5 - cyF));
        const k = covv * strength * selAt(x, y);
        const qx = x - cx + SR, qy = y - cy + SR;
        if (k <= 0 || qx < 0 || qy < 0 || qx >= SIDE || qy >= SIDE) continue;
        const qi = (qy * SIDE + qx) * 4, di = (y * W + x) * 4;
        const ca = carry[qi + 3];
        const sr = ca > 1e-6 ? carry[qi] / ca : 0, sg = ca > 1e-6 ? carry[qi + 1] / ca : 0, sb = ca > 1e-6 ? carry[qi + 2] / ca : 0;
        const da = data[di + 3] / 255;
        const oa = da + (ca - da) * k;
        for (let ch = 0; ch < 3; ch++) {
          const sv = ch === 0 ? sr : ch === 1 ? sg : sb;
          const pm = data[di + ch] / 255 * da + (sv * ca - data[di + ch] / 255 * da) * k;
          data[di + ch] = clamp255((oa > 1e-6 ? pm / oa : (data[di + ch] / 255 + (sv - data[di + ch] / 255) * k)) * 255);
        }
        data[di + 3] = clamp255(oa * 255);
      }
      if (x1 >= x0 && y1 >= y0) markDirty(x0, y0, x1 + 1, y1 + 1);
      // pickup：缓冲整体以 keep = strength 与当前像素（预乘）混合
      const keep = strength, one = [0, 0, 0, 0];
      for (let qy = 0; qy < SIDE; qy++) for (let qx = 0; qx < SIDE; qx++) {
        const x = cx + qx - SR, y = cy + qy - SR;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        premultAt(x, y, one, 0);
        const qi = (qy * SIDE + qx) * 4;
        for (let ch = 0; ch < 4; ch++) carry[qi + ch] = carry[qi + ch] * keep + one[ch] * (1 - keep);
      }
    }

    const dab = kind === 'smudge' ? smudgeDab : stampDab;
    return {
      dirty,
      attach(img) { data = img.data; W = img.width; H = img.height; },
      start(x, y) { last = [x, y]; dab(x, y); },
      move(x, y) {
        if (!last) { this.start(x, y); return; }
        const from = last;
        walkDabs([from, [x, y]], step, (dx, dy) => dab(dx, dy));
        last = [x, y];
      },
      clearDirty() { dirty.x0 = dirty.y0 = Infinity; dirty.x1 = dirty.y1 = -Infinity; },
    };
  }

  /* ---------- 形状几何（vector/src/shapes.rs） ---------- */
  // 多边形/星形：内切于 (x,y,w,h) 的椭圆，首顶点在顶部；星形奇数顶点按 ratio 缩放；边数钳制 3..100
  function polygonPts(x, y, w, h, sides, ratio) {
    const n = Math.max(3, Math.min(100, Math.round(sides) || 3));
    const star = ratio > 0 && ratio < 1;
    const count = star ? n * 2 : n;
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry, pts = [];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + 2 * Math.PI * i / count;
      const k = star && i % 2 === 1 ? ratio : 1;
      pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
    }
    return pts;
  }
  // 拖拽 (x0,y0)→(x1,y1) 的形状几何描述
  function shapeGeom(kind, x0, y0, x1, y1, opt) {
    opt = opt || {};
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    switch (kind) {
      case 'ellipse': return { type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
      case 'polygon': return { type: 'poly', pts: polygonPts(x, y, w, h, opt.sides || 6, 1) };
      case 'star': return { type: 'poly', pts: polygonPts(x, y, w, h, opt.points || 5, opt.ratio == null ? 0.4 : opt.ratio) };
      case 'line': return { type: 'line', x0, y0, x1, y1 };
      default: return { type: 'rect', x, y, w, h };
    }
  }
  // 在 2D 上下文上描出形状路径（调用方决定 fill/stroke）
  function tracePath(ctx, geom) {
    ctx.beginPath();
    if (geom.type === 'rect') ctx.rect(geom.x, geom.y, geom.w, geom.h);
    else if (geom.type === 'ellipse') ctx.ellipse(geom.cx, geom.cy, Math.max(0, geom.rx), Math.max(0, geom.ry), 0, 0, Math.PI * 2);
    else if (geom.type === 'line') { ctx.moveTo(geom.x0, geom.y0); ctx.lineTo(geom.x1, geom.y1); }
    else if (geom.type === 'poly' && geom.pts.length) {
      ctx.moveTo(geom.pts[0][0], geom.pts[0][1]);
      for (let i = 1; i < geom.pts.length; i++) ctx.lineTo(geom.pts[i][0], geom.pts[i][1]);
      ctx.closePath();
    }
  }
  /* 线性渐变参数 t（algo/src/paint.rs tool_gradient_t 的 Linear 分支）：
     t = ((p − from) · (to − from)) / |to − from|²，钳制 0..1。 */
  function gradientT(x, y, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    if (len2 <= 0) return 0;
    return clamp01(((x - x0) * dx + (y - y0) * dy) / len2);
  }

  const api = { tipProfile, dabCoverage, stepLen, walkDabs, createStroke, polygonPts, shapeGeom, tracePath, gradientT };
  g.MTBrush = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
