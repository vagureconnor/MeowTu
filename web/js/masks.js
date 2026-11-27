// MTMasks — 区域掩膜：单遍扫描出 0..1 浮点掩膜，供一句话修图/智能增强按区域生效。
// 输入 {data,width,height}（RGBA），输出 Float32Array(w*h)。浏览器与 Node 通用。
(function (g) {
  'use strict';
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const ramp = (v, a, b) => clamp01((v - a) / (b - a));            // a→0, b→1 平滑过渡
  const hueDist = (h, c) => { const d = Math.abs(h - c) % 360; return d > 180 ? 360 - d : d; };
  // 位置权重：亲和度 s 在 0.4..0.6 间快速过渡，偏向侧平台为 1、另一侧 0.1（天空/水面靠此区分）
  const posW = (t, top) => { const s = top ? 1 - t : t; return 0.1 + 0.9 * ramp(s - 0.4, 0, 0.2); };

  // 规则表：每种掩膜 = 色彩打分函数 (h,s,l,r,g,b,y,cb,cr) + 位置偏向
  const RULES = {
    sky:      { pos: 'top', score: (h, s, l) => ramp(70 - hueDist(h, 215), 0, 35) * ramp(s, 0.08, 0.25) * ramp(l, 0.22, 0.42) },
    water:    { pos: 'bot', score: (h, s, l) => ramp(65 - hueDist(h, 200), 0, 32) * ramp(s, 0.10, 0.28) * ramp(l, 0.15, 0.32) },
    greenery: { pos: null,  score: (h, s, l) => ramp(62 - hueDist(h, 115), 0, 30) * ramp(s, 0.18, 0.38) * ramp(l, 0.10, 0.22) * ramp(0.92 - l, 0, 0.12) },
    skin:     { pos: null,  score: (h, s, l, r, gg, b, y, cb, cr) =>
                  ramp(cb, 72, 82) * ramp(132 - cb, 0, 10) * ramp(cr, 128, 138) * ramp(178 - cr, 0, 10) *
                  (r > 95 && gg > 40 && b > 20 && r > gg && r > b && r - gg > 15 ? 1 : 0) },
  };

  // 可分离 box blur 羽化，滑动窗口 O(n)
  function feather(m, w, h, rad) {
    if (!rad || rad < 1) return m;
    const tmp = new Float32Array(m.length), out = new Float32Array(m.length), win = 2 * rad + 1;
    for (let y = 0; y < h; y++) {                       // 横向
      const row = y * w; let acc = 0;
      for (let x = -rad; x <= rad; x++) acc += m[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        acc += m[row + Math.min(w - 1, x + rad + 1)] - m[row + Math.max(0, x - rad)];
      }
    }
    for (let x = 0; x < w; x++) {                       // 纵向
      let acc = 0;
      for (let y = -rad; y <= rad; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / win;
        acc += tmp[Math.min(h - 1, y + rad + 1) * w + x] - tmp[Math.max(0, y - rad) * w + x];
      }
    }
    return out;
  }

  function make(img, name, opt) {
    const { data, width: w, height: h } = img, rule = RULES[name];
    const rad = typeof opt === 'number' ? opt : (opt && opt.feather) || 0;
    const m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const pw = rule.pos ? posW(y / h, rule.pos === 'top') : 1, row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4, r = data[i], gg = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn, l = (mx + mn) / 510;
        let hue = 0; const s = d ? (l > 0.5 ? d / (510 - mx - mn) : d / (mx + mn)) : 0;
        if (d) { hue = mx === r ? 60 * ((gg - b) / d % 6) : mx === gg ? 60 * ((b - r) / d + 2) : 60 * ((r - gg) / d + 4); if (hue < 0) hue += 360; }
        const yy = 0.299 * r + 0.587 * gg + 0.114 * b;   // YCbCr（肤色规则用）
        m[row + x] = rule.score(hue, s, l, r, gg, b, yy, 128 - 0.168 * r - 0.331 * gg + 0.5 * b, 128 + 0.5 * r - 0.419 * gg - 0.081 * b) * pw;
      }
    }
    return feather(m, w, h, rad);
  }

  const zip = (a, b, f) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = f(a[i], b[i]); return o; };
  const api = {
    feather,
    invert: a => zip(a, a, v => 1 - v),
    multiply: (a, b) => zip(a, b, (x, y) => x * y),
    add: (a, b) => zip(a, b, (x, y) => Math.min(1, x + y)),
    fromAlpha(img, opt) {
      const { data, width: w, height: h } = img, m = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) m[i] = data[i * 4 + 3] / 255;
      const rad = typeof opt === 'number' ? opt : (opt && opt.feather) || 0;
      return feather(m, w, h, rad);
    },
  };
  for (const name of Object.keys(RULES)) api[name] = (img, opt) => make(img, name, opt);
  g.MTMasks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
