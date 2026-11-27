// MTLut — LUT 电影调色模块（3D LUT）。
// 采样口径翻译自 PhotoCraft crates/compose/src/adjust/color.rs 的 lut3d_sample（三线性分支）：
//   表 = n³ 个 RGB 三元组、red 变化最快；坐标钳 0..1 后 ×(n-1)，下角 min(n-2)，三线性混合。
//   （源项目另有 tetrahedral 分支，本模块只取其默认的三线性口径。）
// .cube 解析：PhotoCraft 的解析在外部 crate craft_cms::lutfile，未随克隆提供，故按 .cube
//   行业通用文本格式自研：# 注释、TITLE、LUT_3D_SIZE、DOMAIN_MIN/MAX（仅支持 0..1），
//   其后须恰好 n³ 行三元组（red 最快），多/少/非数字一律拒绝。
// 内置 LUT 不用外部文件：一张「预设 → 变换算子表」，运行时由算子解释器采样生成 17³ 表并缓存。
(function (g) {
  'use strict';

  var SIZE = 17;
  var c01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var lum = function (r, gg, b) { return 0.299 * r + 0.587 * gg + 0.114 * b; };

  // ---- 算子表解释器（每个算子作用于 0..1 的 [r,g,b]，输出钳 0..1） ----
  var OPS = {
    gain: function (c, p) { return [c[0] * p[0], c[1] * p[1], c[2] * p[2]]; },
    lift: function (c, p) { return [c[0] + p[0], c[1] + p[1], c[2] + p[2]]; },
    gamma: function (c, p) { var e = 1 / p; return [Math.pow(c[0], e), Math.pow(c[1], e), Math.pow(c[2], e)]; },
    contrast: function (c, p) { return [(c[0] - 0.5) * p + 0.5, (c[1] - 0.5) * p + 0.5, (c[2] - 0.5) * p + 0.5]; },
    sat: function (c, p) { var l = lum(c[0], c[1], c[2]); return [l + (c[0] - l) * p, l + (c[1] - l) * p, l + (c[2] - l) * p]; },
    gray: function (c, p) { var l = lum(c[0], c[1], c[2]); return [c[0] + (l - c[0]) * p, c[1] + (l - c[1]) * p, c[2] + (l - c[2]) * p]; },
    // p = [暗部色, 高光色, 强度]：按明度把两端染色（青橙/赛博等分调色调的基础算子）
    split: function (c, p) {
      var l = lum(c[0], c[1], c[2]), s = p[0], h = p[1], a = p[2];
      return [c[0] + (s[0] * (1 - l) + h[0] * l) * a,
              c[1] + (s[1] * (1 - l) + h[1] * l) * a,
              c[2] + (s[2] * (1 - l) + h[2] * l) * a];
    },
    // p = [黑点r,黑点g,黑点b, 白点r,白点g,白点b]：v → 黑点 + v×(白点-黑点)（褪色/抬黑）
    fade: function (c, p) {
      return [p[0] + c[0] * (p[3] - p[0]), p[1] + c[1] * (p[4] - p[1]), p[2] + c[2] * (p[5] - p[2])];
    }
  };
  function applyOps(ops, r, gg, b) {
    var c = [r, gg, b];
    for (var i = 0; i < ops.length; i++) {
      c = OPS[ops[i][0]](c, ops[i][1]);
      c = [c01(c[0]), c01(c[1]), c01(c[2])];
    }
    return c;
  }

  // ---- 内置预设（数据驱动：预设名 → 算子表） ----
  var PRESETS = [
    { id: 'tealOrange', name: '青橙', ops: [['split', [[-0.03, 0.05, 0.10], [0.11, 0.04, -0.07], 0.9]], ['sat', 1.18], ['contrast', 1.08]] },
    { id: 'fuji', name: '富士', ops: [['fade', [0.03, 0.045, 0.03, 1, 0.98, 0.95]], ['gain', [0.98, 1.03, 0.97]], ['sat', 0.88], ['contrast', 0.96]] },
    { id: 'film', name: '胶片', ops: [['fade', [0.07, 0.06, 0.05, 0.97, 0.96, 0.94]], ['gain', [1.04, 1.0, 0.92]], ['sat', 0.85], ['contrast', 1.05], ['gamma', 0.96]] },
    { id: 'blackGold', name: '黑金', ops: [['gray', 0.82], ['split', [[-0.01, 0, 0.02], [0.15, 0.08, -0.05], 0.85]], ['contrast', 1.12], ['sat', 1.06]] },
    { id: 'cream', name: '奶油', ops: [['fade', [0.05, 0.045, 0.03, 1, 0.99, 0.97]], ['gain', [1.03, 1.0, 0.94]], ['sat', 0.92], ['contrast', 0.92], ['gamma', 1.06]] },
    { id: 'japanese', name: '日系清新', ops: [['fade', [0.10, 0.10, 0.09, 1, 1, 1]], ['gain', [0.99, 1.02, 1.03]], ['sat', 0.82], ['contrast', 0.94]] },
    { id: 'cyber', name: '赛博', ops: [['split', [[0.07, -0.03, 0.11], [-0.05, 0.07, 0.11], 1.0]], ['sat', 1.30], ['contrast', 1.15]] },
    { id: 'bwFilm', name: '黑白电影', ops: [['gray', 1], ['contrast', 1.18], ['fade', [0.02, 0.02, 0.02, 0.99, 0.99, 0.99]], ['gamma', 1.03]] }
  ];
  var presetById = {};
  PRESETS.forEach(function (p) { presetById[p.id] = p; });

  /** 由任意 (r,g,b)→[r,g,b] 变换函数采样生成 n³ 表（red 最快）。 */
  function generate(n, fn) {
    var data = new Float32Array(n * n * n * 3), m = n - 1, i = 0;
    for (var b = 0; b < n; b++) for (var gg = 0; gg < n; gg++) for (var r = 0; r < n; r++) {
      var c = fn(r / m, gg / m, b / m);
      data[i++] = c01(c[0]); data[i++] = c01(c[1]); data[i++] = c01(c[2]);
    }
    return { size: n, data: data };
  }
  function identity(n) { return generate(n || 2, function (r, gg, b) { return [r, gg, b]; }); }

  var tableCache = {};   // 预设 id → 表
  var cubeCache = {};    // 自定义 cube 文本 → 表（解析失败缓存 null，避免反复解析坏文件）
  function resolve(state) {
    if (!state || !state.id) return null;
    if (state.id === 'custom') {
      if (typeof state.cube !== 'string' || !state.cube) return null;
      if (!(state.cube in cubeCache)) {
        try { cubeCache[state.cube] = parseCube(state.cube); } catch (e) { cubeCache[state.cube] = null; }
      }
      return cubeCache[state.cube];
    }
    var p = presetById[state.id];
    if (!p) return null;
    if (!tableCache[p.id]) {
      tableCache[p.id] = generate(SIZE, function (r, gg, b) { return applyOps(p.ops, r, gg, b); });
    }
    return tableCache[p.id];
  }
  function isActive(state) {
    return !!(state && state.id && (typeof state.strength !== 'number' || state.strength > 0) && resolve(state));
  }

  // ---- 三线性采样（译自 PhotoCraft lut3d_sample 的 trilinear 分支） ----
  function sample(data, n, r, gg, b) {
    if (n < 2 || data.length < n * n * n * 3) return [r, gg, b];
    var m = n - 1;
    var pr = c01(r) * m, pg = c01(gg) * m, pb = c01(b) * m;
    var i0 = [Math.min(Math.floor(pr), n - 2), Math.min(Math.floor(pg), n - 2), Math.min(Math.floor(pb), n - 2)];
    var fr = pr - i0[0], fg = pg - i0[1], fb = pb - i0[2];
    function at(dr, dg, db) {
      var idx = (((i0[2] + db) * n + i0[1] + dg) * n + i0[0] + dr) * 3;
      return [data[idx], data[idx + 1], data[idx + 2]];
    }
    function lerp(a, bb, t) { return [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t]; }
    var c00 = lerp(at(0, 0, 0), at(1, 0, 0), fr), c10 = lerp(at(0, 1, 0), at(1, 1, 0), fr);
    var c01v = lerp(at(0, 0, 1), at(1, 0, 1), fr), c11 = lerp(at(0, 1, 1), at(1, 1, 1), fr);
    return lerp(lerp(c00, c10, fg), lerp(c01v, c11, fg), fb);
  }

  /** 把 LUT 状态应用到 ImageData（原地）：out = 原值 + (采样值 − 原值) × 强度。alpha 不动。 */
  function apply(imgData, state) {
    var lut = resolve(state);
    if (!lut) return false;
    var k = (typeof state.strength === 'number' ? state.strength : 100) / 100;
    if (k <= 0) return false;
    if (k > 1) k = 1;
    var d = imgData.data, n = lut.size, data = lut.data;
    for (var i = 0; i < d.length; i += 4) {
      var s = sample(data, n, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      d[i] = Math.round(d[i] + (s[0] * 255 - d[i]) * k);
      d[i + 1] = Math.round(d[i + 1] + (s[1] * 255 - d[i + 1]) * k);
      d[i + 2] = Math.round(d[i + 2] + (s[2] * 255 - d[i + 2]) * k);
    }
    return true;
  }

  /** 对画布应用 LUT 状态，返回新画布（原画布不动）；无有效 LUT 时返回克隆。 */
  function applyToCanvas(canvas, state) {
    var out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    var ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    if (resolve(state)) {
      var img = ctx.getImageData(0, 0, out.width, out.height);
      apply(img, state);
      ctx.putImageData(img, 0, 0);
    }
    return out;
  }

  // ---- .cube 解析 / 写出（通用文本格式，自研） ----
  function parseCube(text) {
    function bad(msg) { throw new Error('LUT 文件无效：' + msg); }
    if (typeof text !== 'string' || !text.trim()) bad('文件是空的');
    var size = 0, title = '', rows = [];
    var lines = text.split(/\r\n|\r|\n/);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line || line.charAt(0) === '#') continue;
      var sp = line.search(/\s/);
      var head = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
      var rest = sp < 0 ? '' : line.slice(sp).trim();
      if (head === 'TITLE') { title = rest.replace(/^"|"$/g, ''); continue; }
      if (head === 'LUT_3D_SIZE') {
        size = parseInt(rest, 10);
        if (!(size >= 2 && size <= 256)) bad('LUT_3D_SIZE 应为 2..256，实际是「' + rest + '」');
        continue;
      }
      if (head === 'LUT_1D_SIZE') bad('只支持 3D LUT（文件里是 1D）');
      if (head === 'LUT_1D_INPUT_RANGE' || head === 'LUT_3D_INPUT_RANGE') continue;
      if (head === 'DOMAIN_MIN' || head === 'DOMAIN_MAX') {
        var dv = rest.split(/\s+/).map(Number);
        var want = head === 'DOMAIN_MIN' ? 0 : 1;
        if (dv.length !== 3 || dv.some(function (v) { return v !== want; })) bad('只支持 DOMAIN 范围 0..1');
        continue;
      }
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(head)) { rows.push(line); continue; }
      bad('看不懂的一行：' + line.slice(0, 40));
    }
    if (!size) bad('缺少 LUT_3D_SIZE');
    var need = size * size * size;
    if (rows.length !== need) bad('数据行数不对：应为 ' + need + ' 行（' + size + '³），实际 ' + rows.length + ' 行');
    var data = new Float32Array(need * 3);
    for (var i = 0; i < need; i++) {
      var parts = rows[i].split(/\s+/);
      if (parts.length !== 3) bad('第 ' + (i + 1) + ' 行数据不是三个数');
      for (var c = 0; c < 3; c++) {
        var v = Number(parts[c]);
        if (!isFinite(v)) bad('第 ' + (i + 1) + ' 行有非数字');
        data[i * 3 + c] = c01(v);
      }
    }
    return { size: size, data: data, title: title };
  }
  function writeCube(lut, title) {
    var out = ['TITLE "' + (title || 'MeowTu LUT') + '"', 'LUT_3D_SIZE ' + lut.size, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    var d = lut.data, f = function (v) { return String(Math.round(v * 1000000) / 1000000); };
    for (var i = 0; i < d.length; i += 3) out.push(f(d[i]) + ' ' + f(d[i + 1]) + ' ' + f(d[i + 2]));
    return out.join('\n') + '\n';
  }

  var api = {
    list: PRESETS.map(function (p) { return { id: p.id, name: p.name }; }),
    SIZE: SIZE,
    parseCube: parseCube, writeCube: writeCube, sample: sample,
    resolve: resolve, isActive: isActive, apply: apply, applyToCanvas: applyToCanvas,
    generate: generate, identity: identity,
    _t: { applyOps: applyOps, OPS: OPS, PRESETS: PRESETS }
  };
  g.MTLut = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
