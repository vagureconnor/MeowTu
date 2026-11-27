// MTSelection — 选区算法：逐项翻译自 PhotoCraft（storytold/photocraft）
//   crates/algo/src/selection.rs（魔棒 wand_region_by / 套索 polygon / 组合 combine）
//   crates/algo/src/selection/marquee.rs（椭圆 Ellipse::ramp、矩形硬边填充）
//   crates/algo/src/selection/morphology.rs + distance.rs（扩展/收缩：精确欧氏距离变换）
//   crates/algo/src/selection_blur.rs（羽化：高斯 σ=半径、核截断 ⌈3σ⌉、画布外为零）
//   crates/algo/src/selection/inverse.rs（反选：逐字节 255−v）
// 选区掩膜统一为 Uint8Array(w*h)，0..255 覆盖度。浏览器与 Node 通用。
(function (g) {
  'use strict';
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const enc = v => Math.floor(clamp01(v) * 255 + 0.5); // PhotoCraft coverage8

  /* ---------- 矩形：硬边填充 [x0,x1)×[y0,y1) ---------- */
  function rect(w, h, x0, y0, x1, y1) {
    const m = new Uint8Array(w * h);
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(w, x1 | 0); y1 = Math.min(h, y1 | 0);
    for (let y = y0; y < y1; y++) m.fill(255, y * w + x0, y * w + x1);
    return m;
  }

  /* ---------- 椭圆：内切于 [x0,x1)×[y0,y1)，PhotoCraft Ellipse::ramp 抗锯齿 ---------- */
  function ellipse(w, h, x0, y0, x1, y1) {
    const m = new Uint8Array(w * h);
    const W = x1 - x0, H = y1 - y0;
    if (W <= 0 || H <= 0) return m;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = W / 2, ry = H / 2;
    const irx2 = 1 / (rx * rx), iry2 = 1 / (ry * ry);
    const small = Math.min(W, H) <= 3; // 最小边 ≤3px：4×4 子采样（marquee.rs SMALL=3）
    const inside = (px, py) => { const u = (px - cx) / rx, v = (py - cy) / ry; return u * u + v * v <= 1; };
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        let cov;
        if (small) {
          let n = 0;
          for (let i = 0; i < 16; i++) if (inside(x + ((i % 4) + 0.5) / 4, y + ((i / 4 | 0) + 0.5) / 4)) n++;
          cov = n / 16;
        } else {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const f = Math.sqrt((dx * dx) * irx2 + (dy * dy) * iry2);
          const across = Math.abs(dx) * irx2 + Math.abs(dy) * iry2; // f·(|∂F/∂x|+|∂F/∂y|)
          cov = across <= 0 ? 1 : clamp01(0.5 - (f - 1) * f / across);
        }
        if (cov > 0) m[y * w + x] = enc(cov);
      }
    }
    return m;
  }

  /* ---------- 套索：多边形 even-odd 填充，每像素行 4 子行、水平覆盖精确（polygon()） ---------- */
  function polygon(w, h, pts) {
    const m = new Uint8Array(w * h);
    if (!pts || pts.length < 3) return m;
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a[1] === b[1]) continue; // 水平边不穿越子行
      edges.push({ top: Math.min(a[1], b[1]), bot: Math.max(a[1], b[1]), a, b });
    }
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of pts) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
    const rowA = Math.max(0, Math.floor(by0)), rowB = Math.min(h - 1, Math.ceil(by1) - 1);
    const colA = Math.max(0, Math.floor(bx0)), colB = Math.min(w - 1, Math.ceil(bx1) - 1);
    if (rowB < rowA || colB < colA) return m;
    const acc = new Float32Array((colB - colA + 1) * (rowB - rowA + 1)), aw = colB - colA + 1;
    const SUB = 4, xs = [];
    for (let py = rowA; py <= rowB; py++) {
      for (let s = 0; s < SUB; s++) {
        const y = py + (s + 0.5) / SUB;
        xs.length = 0;
        for (const e of edges) {
          if (e.top <= y && y < e.bot) xs.push(e.a[0] + (y - e.a[1]) / (e.b[1] - e.a[1]) * (e.b[0] - e.a[0]));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, xs[k]), xb = Math.min(w, xs[k + 1]);
          if (xb <= xa) continue;
          for (let cx = Math.floor(xa); cx < Math.ceil(xb); cx++) {
            const cov = Math.min(cx + 1, xb) - Math.max(cx, xa);
            if (cov > 0) acc[(py - rowA) * aw + cx - colA] += cov / SUB;
          }
        }
      }
    }
    for (let py = rowA; py <= rowB; py++) for (let cx = colA; cx <= colB; cx++) {
      const v = acc[(py - rowA) * aw + cx - colA];
      if (v > 0) m[py * w + cx] = enc(Math.min(1, v));
    }
    return m;
  }

  /* ---------- 魔棒：wand_region_by 的 Wand 规则（LargestChannel 距离） ----------
     相似：RGB 最大通道差 ≤ 容差 且 alpha 差 ≤ 容差；两全透明像素恒匹配。
     连通 = span 泛洪填充（4 连通）；不连通 = 全图匹配。
     抗锯齿：区域外紧邻像素按「超出容差的量」在 FRINGE_LEVELS=216 级内衰减。 */
  const FRINGE_LEVELS = 216;
  function wand(data, w, h, sx, sy, tolerance, contiguous) {
    const marks = new Uint8Array(w * h), out = new Uint8Array(w * h);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
    const tol = Math.max(0, Math.floor(tolerance + 1e-3));
    const si = (sy * w + sx) * 4;
    const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
    const rgbDiff = i => { const j = i * 4; return Math.max(Math.abs(data[j] - tr), Math.abs(data[j + 1] - tg), Math.abs(data[j + 2] - tb)); };
    const similar = i => (ta === 0 && data[i * 4 + 3] === 0) || (rgbDiff(i) <= tol && Math.abs(data[i * 4 + 3] - ta) <= tol);
    if (contiguous) {
      const stack = [[sx, sy]];
      while (stack.length) {
        const [x, y] = stack.pop(), row = y * w;
        if (marks[row + x]) continue;
        let l = x, r = x;
        while (l > 0 && !marks[row + l - 1] && similar(row + l - 1)) l--;
        while (r + 1 < w && !marks[row + r + 1] && similar(row + r + 1)) r++;
        marks.fill(255, row + l, row + r + 1);
        for (const ny of [y - 1, y + 1]) {
          if (ny < 0 || ny >= h) continue;
          const nrow = ny * w;
          let inRun = false;
          for (let nx = l; nx <= r; nx++) {
            const ok = !marks[nrow + nx] && similar(nrow + nx);
            if (ok && !inRun) stack.push([nx, ny]);
            inRun = ok;
          }
        }
      }
    } else {
      for (let i = 0; i < w * h; i++) if (similar(i)) marks[i] = 255;
    }
    // 抗锯齿边缘：以二值 marks 判紧邻，写出到 out（PhotoCraft 同口径，避免链式扩散）
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (marks[i]) { out[i] = 255; continue; }
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && marks[ny * w + nx]) { touch = true; break; }
      }
      if (!touch) continue;
      const k = clamp01(1 - Math.max(0, rgbDiff(i) - tol) / FRINGE_LEVELS) * (Math.min(data[i * 4 + 3], ta) / 255);
      out[i] = Math.round(k * 255);
    }
    return out;
  }

  /* ---------- 羽化：高斯 σ=半径，核截断 ⌈3σ⌉ 归一化、画布外为零（selection_blur.rs 的直接定义） ---------- */
  function feather(mask, w, h, radius) {
    const sigma = Math.max(0, radius || 0);
    const src = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) src[i] = mask[i] / 255;
    if (sigma < 0.1 || !mask.length) return mask.slice();
    const r = Math.ceil(sigma * 3), taps = [];
    let sum = 0;
    for (let j = -r; j <= r; j++) { const v = Math.exp(-(j * j) / (2 * sigma * sigma)); taps.push(v); sum += v; }
    for (let j = 0; j < taps.length; j++) taps[j] /= sum;
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0;
      for (let j = -r; j <= r; j++) { const xx = x + j; if (xx >= 0 && xx < w) a += src[y * w + xx] * taps[j + r]; }
      tmp[y * w + x] = a;
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0;
      for (let j = -r; j <= r; j++) { const yy = y + j; if (yy >= 0 && yy < h) a += tmp[yy * w + x] * taps[j + r]; }
      out[y * w + x] = enc(a);
    }
    return out;
  }

  /* ---------- 精确欧氏距离变换（Felzenszwalb–Huttenlocher，distance.rs 同算法） ---------- */
  function edt1d(f) {
    const n = f.length, d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dx = q - v[k];
      d[q] = dx * dx + f[v[k]];
    }
    return d;
  }
  function edt(seeds, w, h) { // seeds: Uint8 0/1 → Float64Array 欧氏距离（无种子 = 1e10）
    const INF = 1e10, g = new Float64Array(w * h), out = new Float64Array(w * h);
    const col = new Float64Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) col[y] = seeds[y * w + x] ? 0 : INF;
      const d = edt1d(col);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    const row = new Float64Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) row[x] = g[y * w + x];
      const d = edt1d(row);
      for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  /* ---------- 扩展/收缩（morphology.rs modify） ----------
     在非零包围盒 + (⌈r⌉+1) 光晕窗口内算 EDT（窗口外结果恒为 0，与全画布口径一致）。
     expand 种子 = v≥0.5；contract 种子 = 补集（1−v≥0.5，含恰 0.5 的平局口径）。
     expand: out = max(v, clamp(r+1−d))；contract: out = 1 − max(1−v, clamp(r+1−d补))。 */
  function modify(mask, w, h, r, contract) {
    const out = new Uint8Array(w * h);
    if (!isFinite(r) || r < 0 || w <= 0 || h <= 0 || mask.length !== w * h) return out;
    let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask[y * w + x] !== 0) { if (x < bx0) bx0 = x; if (x + 1 > bx1) bx1 = x + 1; if (y < by0) by0 = y; if (y + 1 > by1) by1 = y + 1; }
    }
    if (bx1 === 0) return out; // 空选区：扩展/收缩后仍空（PhotoCraft 同口径）
    const halo = Math.ceil(r) + 1;
    const wx0 = Math.max(0, bx0 - halo), wy0 = Math.max(0, by0 - halo);
    const wx1 = Math.min(w, bx1 + halo), wy1 = Math.min(h, by1 + halo);
    const cw = wx1 - wx0, ch = wy1 - wy0, seeds = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = mask[(wy0 + y) * w + wx0 + x];
      seeds[y * cw + x] = contract ? (v <= 127 ? 1 : 0) : (v >= 128 ? 1 : 0);
    }
    const d = edt(seeds, cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = (wy0 + y) * w + wx0 + x, v = mask[i] / 255, fall = clamp01(r + 1 - d[y * cw + x]);
      out[i] = enc(contract ? 1 - Math.max(1 - v, fall) : Math.max(v, fall));
    }
    return out;
  }

  const api = {
    rect, ellipse, polygon, wand, feather,
    expand: (m, w, h, r) => modify(m, w, h, r, false),
    contract: (m, w, h, r) => modify(m, w, h, r, true),
    invert: m => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = 255 - m[i]; return o; },
    all: (w, h) => new Uint8Array(w * h).fill(255),
    count: m => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i] > 0) n++; return n; },
  };
  g.MTSelection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
