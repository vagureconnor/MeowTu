// MTStyles — 图层样式（效果）。参数结构与像素算法逐项翻译自 PhotoCraft（storytold/photocraft）：
//   crates/engine-core/src/layer_style.rs   effect_defaults（各效果出厂参数与单位）
//   crates/compose/src/effects.rs           渲染顺序：投影/外发光在层下；层内容之上依次叠加类、
//                                           光泽、内发光、内阴影、描边、内斜面；内部效果先除以形状
//                                           覆盖度（relative_to_shape）再取形状 alpha
//   crates/compose/src/effects/paint.rs     shadow_map / glow_map(Softer) / spread_split / offset /
//                                           gradient_t / sample_gradient（ranged LUT = min(v/range,1)）
//   crates/compose/src/effects/blur.rs      tent（两遍 box）/ box_line / dilate / SIZE_ONE_TAPS
//   crates/compose/src/effects/distance.rs  5×5 chamfer 距离（步长 1, √2, √5；INSIDE_EPS = 0.5/255）
//   crates/compose/src/effects/bevel.rs     bevel_maps（Smooth 内斜面：高度图 = 形状 tent 模糊，
//                                           法线·光照分高光/阴影）/ satin_map
//   crates/compose/src/effects/composite.rs stroke_widths / 描边覆盖 (宽 + 0.5 − 距离)
// 未译（源项目有）：等高线 Contour（一律 Linear）、噪声、发光 Precise 技术、斜面 Chisel 技术与
//   外斜面/浮雕/枕形样式、描边的渐变/图案填充、图案叠加（仓库无图案库数据源）、同类多实例效果、
//   发光 Softer 的小 Range 实测修正 LUT（softer_edge_lut）。每层每类效果至多一条。
// 掩膜 = Float32Array(w*h) 覆盖度 0..1；buildPaints 产出 {ext, int} 两组油漆
// {data:Uint8ClampedArray RGBA, mode}，由 engine 用 blendCompositeInto 按序合成：
// ext 在层之下（合成顺序即数组序），int 在层内容之上（engine 画完后恢复层 alpha）。
(function (g) {
  'use strict';
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const EPS = 0.5 / 255; // INSIDE_EPS（distance.rs）

  /* ---------------- 定义表（出厂参数译自 effect_defaults；UI 与管线共用） ---------------- */
  // 参数行：{k, label, t:'range'|'color'|'select'|'check'|'blend', min, max, def, opts}
  const R = (k, label, min, max, def) => ({ k, label, t: 'range', min, max, def });
  const C = (k, label, def) => ({ k, label, t: 'color', def });
  const B = (k, def) => ({ k, label: '混合模式', t: 'blend', def });
  const O = (k, def) => R(k, '不透明度', 0, 100, def);
  const DEFS = [
    { id: 'bevel', name: '斜面和浮雕', params: [
      R('depth', '深度 %', 0, 1000, 100), R('size', '大小 px', 0, 100, 5), R('soften', '软化 px', 0, 100, 0),
      R('angle', '角度 °', -180, 180, 120), R('altitude', '高度 °', 0, 90, 30),
      { k: 'up', label: '方向上浮', t: 'check', def: true },
      C('highlightColor', '高光颜色', '#ffffff'), O('highlightOpacity', 75),
      C('shadowColor', '阴影颜色', '#000000'), O('shadowOpacity', 75)] },
    { id: 'stroke', name: '描边', params: [
      R('size', '大小 px', 0, 100, 1),
      { k: 'position', label: '位置', t: 'select', def: 'inside', opts: [['outside', '外部'], ['inside', '内部'], ['center', '居中']] },
      B('blend', 'normal'), O('opacity', 100), C('color', '颜色', '#000000')] },
    { id: 'innerShadow', name: '内阴影', params: [
      B('blend', 'multiply'), C('color', '颜色', '#000000'), O('opacity', 75),
      R('angle', '角度 °', -180, 180, 120), R('distance', '距离 px', 0, 100, 5),
      R('choke', '阻塞 %', 0, 100, 0), R('size', '大小 px', 0, 100, 5)] },
    { id: 'innerGlow', name: '内发光', params: [
      B('blend', 'screen'), O('opacity', 75), C('color', '颜色', '#ffffbe'),
      { k: 'source', label: '源', t: 'select', def: 'edge', opts: [['edge', '边缘'], ['center', '中心']] },
      R('choke', '阻塞 %', 0, 100, 0), R('size', '大小 px', 0, 100, 5), R('range', '范围 %', 1, 100, 50)] },
    { id: 'satin', name: '光泽', params: [
      B('blend', 'multiply'), C('color', '颜色', '#000000'), O('opacity', 50),
      R('angle', '角度 °', -180, 180, 90), R('distance', '距离 px', 0, 100, 50), R('size', '大小 px', 0, 100, 80),
      { k: 'invert', label: '反相', t: 'check', def: true }] },
    { id: 'colorOverlay', name: '颜色叠加', params: [
      B('blend', 'normal'), C('color', '颜色', '#ff0000'), O('opacity', 100)] },
    { id: 'gradientOverlay', name: '渐变叠加', params: [
      B('blend', 'normal'), O('opacity', 100), C('from', '起始色', '#000000'), C('to', '结束色', '#ffffff'),
      { k: 'style', label: '样式', t: 'select', def: 'linear', opts: [['linear', '线性'], ['radial', '径向'], ['angle', '角度'], ['reflected', '对称'], ['diamond', '菱形']] },
      R('angle', '角度 °', -180, 180, 90), R('scale', '缩放 %', 10, 150, 100),
      { k: 'reverse', label: '反向', t: 'check', def: false }] },
    { id: 'outerGlow', name: '外发光', params: [
      B('blend', 'screen'), O('opacity', 35), C('color', '颜色', '#ffffff'),
      R('spread', '扩展 %', 0, 100, 0), R('size', '大小 px', 0, 100, 7), R('range', '范围 %', 1, 100, 50)] },
    { id: 'dropShadow', name: '投影', params: [
      B('blend', 'multiply'), C('color', '颜色', '#000000'), O('opacity', 75),
      R('angle', '角度 °', -180, 180, 120), R('distance', '距离 px', 0, 100, 5),
      R('spread', '扩展 %', 0, 100, 0), R('size', '大小 px', 0, 100, 5)] },
  ];
  const DEF_BY_ID = {};
  for (const d of DEFS) DEF_BY_ID[d.id] = d;

  function fresh(id) {
    const d = DEF_BY_ID[id];
    if (!d) return null;
    const o = { on: true };
    for (const p of d.params) o[p.k] = p.def;
    return o;
  }
  /** 用出厂值补齐一条效果的缺失参数（旧状态/手改状态的兜底）。 */
  function withDefaults(id, saved) {
    const o = fresh(id);
    if (!o) return null;
    if (saved) for (const k in saved) o[k] = saved[k];
    o.on = !!(saved && saved.on);
    return o;
  }
  function isActive(style) {
    if (!style) return false;
    for (const d of DEFS) if (style[d.id] && style[d.id].on) return true;
    return false;
  }

  /* ---------------- 掩膜工具（译自 effects.rs Map / paint.rs / blur.rs / distance.rs） ---------------- */
  const copy = m => Float32Array.from(m);
  function shifted(m, w, h, dx, dy, outside) {
    // offset() 已把偏移取整（paint.rs offset），故平移是整像素的（源项目的双线性只为抗锯齿等高线偏移服务，此处未译）
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = y - dy;
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        out[y * w + x] = (sx < 0 || sy < 0 || sx >= w || sy >= h) ? outside : m[sy * w + sx];
      }
    }
    return out;
  }
  function offset(angle, distance) { // paint.rs offset：阴影背向光源，取整到像素
    const a = angle * Math.PI / 180;
    return [Math.round(-Math.cos(a) * distance), Math.round(Math.sin(a) * distance)];
  }
  function spreadSplit(size, spread) { // paint.rs spread_split
    return [Math.round(size * spread / 100), size * (1 - spread / 100)];
  }
  // 5×5 chamfer 两遍扫描（distance.rs chamfer_from，步长 1/√2/√5）
  const CH_INF = 1e20;
  const CH_FWD = [[-1, 0, 1], [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
    [-1, -2, Math.sqrt(5)], [1, -2, Math.sqrt(5)], [-2, -1, Math.sqrt(5)], [2, -1, Math.sqrt(5)]];
  function chamferFrom(seeds, w, h) {
    const d = Float32Array.from(seeds);
    const relax = (x, y, sign) => {
      const i = y * w + x;
      let best = d[i];
      for (let k = 0; k < 8; k++) {
        const nx = x + CH_FWD[k][0] * sign, ny = y + CH_FWD[k][1] * sign;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const c = d[ny * w + nx] + CH_FWD[k][2];
        if (c < best) best = c;
      }
      d[i] = best;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) relax(x, y, 1);
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) relax(x, y, -1);
    return d;
  }
  /** 形状外距离（chamfer 口径，dist_outside_by）：内部像素 −0.5，部分覆盖种子带亚像素偏移。 */
  function distOutside(shape, w, h) {
    const seeds = new Float32Array(w * h);
    for (let i = 0; i < seeds.length; i++) seeds[i] = shape[i] > EPS ? 1 - Math.min(shape[i], 1) : CH_INF;
    const d = chamferFrom(seeds, w, h);
    for (let i = 0; i < d.length; i++) d[i] = shape[i] > EPS ? -0.5 : d[i] - 0.5;
    return d;
  }
  /** 形状内距离（描边内侧用）：外部像素为 0 源；硬边形状与 stroke_inside_distance 等价。 */
  function distInside(shape, w, h) {
    const seeds = new Float32Array(w * h);
    for (let i = 0; i < seeds.length; i++) seeds[i] = shape[i] <= EPS ? 0 : CH_INF;
    const d = chamferFrom(seeds, w, h);
    for (let i = 0; i < d.length; i++) d[i] = shape[i] <= EPS ? -0.5 : d[i] - 0.5;
    return d;
  }
  function dilate(m, w, h, r) { // blur.rs dilate
    if (!(r > 0)) return copy(m);
    const d = distOutside(m, w, h);
    const out = copy(m);
    for (let i = 0; i < out.length; i++) {
      out[i] = d[i] < 0 ? Math.min(out[i] + r, 1) : Math.max(out[i], clamp01(r + 0.5 - d[i]));
    }
    return out;
  }
  // box 几何（blur.rs box_geom）：整宽 bw 的全权抽头 2r−1 个 + 两端抽头权重 f
  function boxGeom(bw) {
    bw = isNaN(bw) ? 1 : Math.min(Math.max(bw, 1), 512);
    const half = bw / 2;
    const r = Math.max(0, Math.ceil(half - 0.5));
    const f = Math.min(Math.max(half - (r - 0.5), 0), 1);
    return [r, f, 1 / bw];
  }
  function boxLine(src, x0, dst, bw) { // blur.rs box_line：dst[k] 对应 src 坐标 x0+k，界外读 0
    const [r, f, norm] = boxGeom(bw);
    const n = src.length;
    const at = i => (i >= 0 && i < n) ? src[i] : 0;
    if (r === 0) { for (let k = 0; k < dst.length; k++) dst[k] = at(x0 + k); return; }
    let inner = 0;
    for (let i = x0 - (r - 1); i <= x0 + (r - 1); i++) inner += at(i);
    for (let k = 0; k < dst.length; k++) {
      const x = x0 + k;
      dst[k] = (inner + f * (at(x - r) + at(x + r))) * norm;
      inner += at(x + r) - at(x - r + 1);
    }
  }
  function tentLine(src, bw) { // blur.rs tent_line：第一遍在两端各外延 r 个样本
    const r = boxGeom(bw)[0];
    const mid = new Float64Array(src.length + 2 * r);
    boxLine(src, -r, mid, bw);
    const out = new Float64Array(src.length);
    boxLine(mid, r, out, bw);
    return out;
  }
  function tent(m, w, h, size) { // blur.rs tent：两遍 box = tent 核；size ≤ 1 为恒等
    if (!(size > 1) || !m.length) return m;
    const row = new Float64Array(w), col = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) row[x] = m[y * w + x];
      const o = tentLine(row, size);
      for (let x = 0; x < w; x++) m[y * w + x] = o[x];
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) col[y] = m[y * w + x];
      const o = tentLine(col, size);
      for (let y = 0; y < h; y++) m[y * w + x] = o[y];
    }
    return m;
  }
  function sizeOneBlur(m, w, h) { // blur.rs SIZE_ONE_TAPS = [¼, ½, ¼]，两轴各一遍
    const t = [0.25, 0.5, 0.25];
    const a = new Float32Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : m[yy * w + xx];
      a[y * w + x] = t[0] * g(x - 1, y) + t[1] * g(x, y) + t[2] * g(x + 1, y);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : a[yy * w + xx];
      m[y * w + x] = t[0] * g(x, y - 1) + t[1] * g(x, y) + t[2] * g(x, y + 1);
    }
    return m;
  }

  /* ---------------- 各效果的覆盖图（译自 paint.rs / bevel.rs） ---------------- */
  function shadowMap(shape, w, h, s, inner) {
    const [dx, dy] = offset(s.angle, s.distance);
    let src = copy(shape);
    if (inner) for (let i = 0; i < src.length; i++) src[i] = 1 - src[i];
    let m = shifted(src, w, h, dx, dy, inner ? 1 : 0);
    const [r, bw] = spreadSplit(s.size, inner ? s.choke : s.spread);
    m = dilate(m, w, h, r);
    if (inner && s.size === 1 && s.choke === 0) sizeOneBlur(m, w, h); // paint.rs #14933 的 Size 1 特例
    else tent(m, w, h, bw);
    if (inner) for (let i = 0; i < m.length; i++) m[i] *= shape[i];
    return m;
  }
  function glowMap(shape, w, h, s, inner) { // Softer 技术；Linear 等高线 → ranged LUT = min(v/range, 1)
    let src = copy(shape);
    if (inner) for (let i = 0; i < src.length; i++) src[i] = 1 - src[i];
    const [r, bw] = spreadSplit(s.size, inner ? s.choke : s.spread);
    let m;
    if (inner && s.source !== 'center' && s.size === 1 && s.choke === 0) { // paint.rs #14924 的 Size 1 特例
      m = src; sizeOneBlur(m, w, h);
    } else {
      m = dilate(src, w, h, r);
      tent(m, w, h, bw);
    }
    const range = Math.min(Math.max(s.range / 100, 0.01), 1);
    for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i] / range, 1);
    if (inner && s.source === 'center') for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
    if (inner) for (let i = 0; i < m.length; i++) m[i] *= shape[i];
    return m;
  }
  function satinMap(shape, w, h, s) { // bevel.rs satin_map
    const [dx, dy] = offset(s.angle, Math.max(s.distance, 1)); // satin_distance：距离 0 按 1 px
    let a = shifted(shape, w, h, dx, dy, 0);
    let b = shifted(shape, w, h, -dx, -dy, 0);
    if (s.size === 1) { sizeOneBlur(a, w, h); sizeOneBlur(b, w, h); }
    else { tent(a, w, h, s.size); tent(b, w, h, s.size); }
    const m = new Float32Array(w * h);
    for (let i = 0; i < m.length; i++) {
      let v = Math.abs(a[i] - b[i]);
      if (s.invert) v = 1 - v;
      m[i] = v * shape[i];
    }
    return m;
  }
  function bevelMaps(shape, w, h, s) { // bevel.rs bevel_maps（Smooth + 内斜面）；返回 [高光图, 阴影图]
    const size = Math.max(s.size, 1);
    const hmap = copy(shape);
    tent(hmap, w, h, size);
    if (s.soften >= 1) tent(hmap, w, h, s.soften);
    const depth = (s.depth / 100) * size * (s.up ? 1 : -1); // bevel_geom：depth × width（Smooth）
    const a = s.angle * Math.PI / 180, e = s.altitude * Math.PI / 180;
    const lv = [Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e)];
    const se = Math.sin(e);
    const hi = new Float32Array(w * h), sh = new Float32Array(w * h);
    const hg = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : hmap[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (hg(x + 1, y) - hg(x - 1, y)) * 0.5 * depth;
      const gy = (hg(x, y + 1) - hg(x, y - 1)) * 0.5 * depth;
      const len = Math.sqrt(gx * gx + gy * gy + 1);
      const shade = (-gx * lv[0] - gy * lv[1] + lv[2]) / len;
      const k = shade - se; // gloss 等高线 = Linear → 恒等
      if (k > 0) hi[i] = clamp01(k / Math.max(1 - se, 1e-3)) * shape[i];
      else sh[i] = clamp01(-k / Math.max(se, 1e-3)) * shape[i];
    }
    return [hi, sh];
  }
  function strokeWidths(s) { // composite.rs stroke_widths
    return s.position === 'outside' ? [0, s.size] : s.position === 'center' ? [s.size / 2, s.size / 2] : [s.size, 0];
  }
  function strokeMaps(shape, w, h, s) { // 覆盖 = (宽 + 0.5 − 距离) 钳制（inside_stroke_coverage / stroke_band）
    const [inW, outW] = strokeWidths(s);
    let inMap = null, outMap = null;
    if (inW > 0) {
      const din = distInside(shape, w, h);
      inMap = new Float32Array(w * h);
      for (let i = 0; i < inMap.length; i++) inMap[i] = shape[i] > EPS ? clamp01(inW + 0.5 - din[i]) : 0;
    }
    if (outW > 0) {
      const dout = distOutside(shape, w, h);
      outMap = new Float32Array(w * h);
      for (let i = 0; i < outMap.length; i++) outMap[i] = clamp01(outW + 0.5 - dout[i]);
    }
    return { inMap, outMap };
  }

  /* ---------------- 渐变（译自 paint.rs gradient_t / sample_gradient） ---------------- */
  function gradientT(style, angle, scale, reverse, w, h, x, y) {
    const cx = w / 2, cy = h / 2;
    const rad = angle * Math.PI / 180, sn = Math.sin(rad), cs = Math.cos(rad);
    const dx = x - cx, dy = y - cy;
    const along = dx * cs - dy * sn, across = dx * sn + dy * cs;
    const len = Math.max(1, Math.sqrt((cs * w) * (cs * w) + (sn * h) * (sn * h)));
    const chord = Math.max(1, Math.min(w / Math.max(Math.abs(cs), 1e-6), h / Math.max(Math.abs(sn), 1e-6)));
    const ch = chord * Math.max(scale, 1e-3), ln = len * Math.max(scale, 1e-3);
    const corner = 0.5 * (cs - sn);
    let t;
    if (style === 'reflected') t = Math.abs((along - corner) / (ch / 2));
    else if (style === 'radial') t = Math.sqrt(dx * dx + dy * dy) / (ln / 2);
    else if (style === 'diamond') t = (Math.abs(along) + Math.abs(across)) / (ln / 2);
    else if (style === 'angle') t = (((rad - Math.atan2(-dy, dx)) / (2 * Math.PI)) % 1 + 1) % 1;
    else t = (along - corner) / ch + 0.5;
    t = clamp01(t);
    return reverse ? 1 - t : t;
  }
  function sampleStops(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (let j = 1; j < stops.length; j++) {
      if (t <= stops[j][0]) {
        const [p0, c0] = stops[j - 1], [p1, c1] = stops[j];
        const k = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return stops[stops.length - 1][1];
  }
  const hexRGB = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

  /* ---------------- 油漆构建 ---------------- */
  function solidPaint(rgb, map, opacityPct) {
    const data = new Uint8ClampedArray(map.length * 4);
    const k = opacityPct / 100;
    for (let i = 0, j = 0; i < map.length; i++, j += 4) {
      data[j] = rgb[0]; data[j + 1] = rgb[1]; data[j + 2] = rgb[2];
      data[j + 3] = Math.round(clamp01(map[i]) * k * 255);
    }
    return data;
  }
  function relative(m, shape) { // composite.rs relative_to_shape：内部效果先除以形状覆盖度
    const out = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) out[i] = shape[i] > EPS ? Math.min(m[i] / shape[i], 1) : 0;
    return out;
  }
  /** 由形状（已含蒙版调制的 alpha 覆盖度）构建两组油漆。
   *  opts.knockOut：0..1，投影被形状挖去的比例（层混合模式非普通时为 1，译自 shadow_see_through；
   *  本引擎无填充不透明度，普通模式下取 0）。 */
  function buildPaints(shape, w, h, style, opts) {
    const ext = [], int = [];
    const S = id => { const s = style && style[id]; return (s && s.on) ? withDefaults(id, s) : null; };
    let s;
    if ((s = S('dropShadow'))) {
      let m = shadowMap(shape, w, h, s, false);
      const ko = (opts && opts.knockOut) || 0; // 出厂 knocksOut = true
      if (ko > 0) for (let i = 0; i < m.length; i++) m[i] *= 1 - shape[i] * ko;
      ext.push({ data: solidPaint(hexRGB(s.color), m, s.opacity), mode: s.blend });
    }
    if ((s = S('outerGlow'))) {
      ext.push({ data: solidPaint(hexRGB(s.color), glowMap(shape, w, h, s, false), s.opacity), mode: s.blend });
    }
    let stroke = null;
    if ((s = S('stroke'))) { stroke = s; }
    const sm = stroke ? strokeMaps(shape, w, h, stroke) : null;
    if (sm && sm.outMap) { // 外侧描边在层之下、外部效果之上（composite.rs paint_outside_strokes）
      ext.push({ data: solidPaint(hexRGB(stroke.color), sm.outMap, stroke.opacity), mode: stroke.blend });
    }
    if ((s = S('gradientOverlay'))) {
      const stops = [[0, hexRGB(s.from)], [1, hexRGB(s.to)]];
      const data = new Uint8ClampedArray(w * h * 4);
      const op = Math.round(255 * s.opacity / 100);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4;
        if (shape[i] <= EPS) continue;
        const c = sampleStops(stops, gradientT(s.style, s.angle, s.scale / 100, s.reverse, w, h, x + 0.5, y + 0.5));
        data[j] = c[0]; data[j + 1] = c[1]; data[j + 2] = c[2]; data[j + 3] = op;
      }
      int.push({ data, mode: s.blend });
    }
    if ((s = S('colorOverlay'))) {
      const full = new Float32Array(w * h);
      for (let i = 0; i < full.length; i++) full[i] = shape[i] > EPS ? 1 : 0;
      int.push({ data: solidPaint(hexRGB(s.color), relative(full, shape), s.opacity), mode: s.blend });
    }
    if ((s = S('satin'))) {
      int.push({ data: solidPaint(hexRGB(s.color), relative(satinMap(shape, w, h, s), shape), s.opacity), mode: s.blend });
    }
    if ((s = S('innerGlow'))) {
      int.push({ data: solidPaint(hexRGB(s.color), relative(glowMap(shape, w, h, s, true), shape), s.opacity), mode: s.blend });
    }
    if ((s = S('innerShadow'))) {
      int.push({ data: solidPaint(hexRGB(s.color), relative(shadowMap(shape, w, h, s, true), shape), s.opacity), mode: s.blend });
    }
    if (sm && sm.inMap) {
      int.push({ data: solidPaint(hexRGB(stroke.color), relative(sm.inMap, shape), stroke.opacity), mode: stroke.blend });
    }
    if ((s = S('bevel'))) {
      const [hi, sh] = bevelMaps(shape, w, h, s);
      int.push({ data: solidPaint(hexRGB(s.highlightColor), relative(hi, shape), s.highlightOpacity), mode: 'screen' });
      int.push({ data: solidPaint(hexRGB(s.shadowColor), relative(sh, shape), s.shadowOpacity), mode: 'multiply' });
    }
    return { ext, int };
  }

  const api = {
    DEFS, fresh, withDefaults, isActive, buildPaints,
    _t: { offset, spreadSplit, shifted, distOutside, distInside, dilate, tent, sizeOneBlur,
      shadowMap, glowMap, satinMap, bevelMaps, strokeMaps, strokeWidths, gradientT, sampleStops, relative },
  };
  g.MTStyles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
