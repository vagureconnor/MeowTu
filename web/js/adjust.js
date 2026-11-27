// 喵图 MeowTu 网页版「高级调整」模块（adjust.js）
// 算法逐项翻译自 PhotoCraft（storytold/photocraft）Rust 源码，口径为 8-bit RGB 文档：
//   色阶        crates/compose/src/adjust/tone.rs 的 levels_q（quantum=255 三步整级取舍）+ levels_gamma（gamma>1 的影调趾部）
//   通道混合器  crates/compose/src/adjust.rs 的 ChannelMixer（行系数钳制 0..1、单色取第一行）
//   黑白        crates/compose/src/adjust/color.rs 的 black_white_gray（默认权重 40 60 40 60 20 80）
//   可选颜色    同文件 selective_color / selective_color_weights（9 个范围，相对/绝对）
//   照片滤镜    同文件 photo_filter_matrix + adjust.rs 8-bit 路径（线性光矩阵、保留明度走 blend::set_lum）
//   渐变映射    同文件 gradient（W3C 明度 0.3/0.59/0.11 驱动）+ filters.js 的 GRAD_MAPS 色带
//   阈值        crates/compose/src/adjust/channels.rs 的 threshold_white（U8 口径）
//   色调分离    tone.rs 的 posterize（8-bit 口径）
// 参数范围/默认值对齐 crates/engine-core/src/adjust_params.rs。
// 对外契约：window.MTAdjust = { defs, apply(imageData, adjState), isActive, autoOptimize }
// adjState：以调整 id 为键的对象，键存在 = 该调整启用；整体为 null = 全部关闭。
(function () {
  'use strict';

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lum3(c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
  function srgbToLinear(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function linearToSrgb(v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function mat3Mul(m, c) {
    return [
      m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
      m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
      m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2]
    ];
  }

  // ---------- 色阶（tone.rs levels_gamma / levels_q，quantum = 255） ----------
  function levelsGamma(u, g) {
    var c = 1 / g;
    if (g <= 1) return Math.pow(u, c);
    var a = Math.pow(2, g), q = 2.2; // LEVELS_TOE_POWER
    var u1 = Math.pow((1 - c / q) / (a * (1 - 1 / q)), 1 / (1 - c));
    if (u >= u1 || u1 <= 0) return Math.pow(u, c);
    var b = (a * u1 - Math.pow(u1, c)) / Math.pow(u1, q);
    if (!isFinite(b)) return Math.pow(u, c);
    return a * u - b * Math.pow(u, q);
  }
  // st: {inBlack:0..255, gamma, inWhite:0..255}（输出范围恒等，与 PhotoCraft 默认一致）
  function levelsLut(st) {
    var ib = st.inBlack / 255, iw = st.inWhite / 255, gamma = Math.max(0.01, st.gamma);
    var range = Math.max(1e-6, iw - ib), q = 255;
    var lut = new Uint8Array(256);
    for (var k = 0; k < 256; k++) {
      var v = Math.round(k / 255 * q) / q;
      var u = Math.floor(clamp01((v - ib) / range) * q + 0.5 + 1e-3) / q;
      var t = Math.floor(levelsGamma(u, gamma) * q + 0.5) / q;
      lut[k] = Math.round(t * 255);
    }
    return lut;
  }

  // ---------- 黑白（color.rs black_white_gray） ----------
  function bwGray(r, g, b, w) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var mid = r + g + b - max - min;
    var primary = (r >= g && r >= b) ? 0 : (g >= b ? 2 : 4);
    var secondary = (b <= r && b <= g) ? 1 : (r <= g ? 3 : 5);
    return min + (mid - min) * w[secondary] / 100 + (max - mid) * w[primary] / 100;
  }

  // ---------- 可选颜色（color.rs selective_color_weights / selective_color） ----------
  function selWeights(c) {
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
    var mid = c[0] + c[1] + c[2] - max - min;
    function top(i) { return c[i] >= max ? max - mid : 0; }
    function bottom(i) { return c[i] <= min ? mid - min : 0; }
    return [
      top(0), bottom(2), top(1), bottom(0), top(2), bottom(1),
      Math.max(0, (min - 0.5) * 2),
      Math.min(1, Math.max(0, 1 - Math.abs(max - 0.5) - Math.abs(min - 0.5))),
      Math.max(0, (0.5 - max) * 2)
    ];
  }
  function selColor(c, relative, adj) {
    var w = selWeights(c);
    var delta = [0, 0, 0];
    for (var r = 0; r < 9; r++) {
      if (w[r] <= 0) continue;
      var a = adj[r];
      for (var i = 0; i < 3; i++) {
        var ink = 1 - c[i];
        var d = (a[i] + a[3]) / 100;
        if (relative) d = d * ink;
        else if (d > 0) d = d * Math.min(1, 2 * (1 - ink));
        else d = d * Math.min(1, 2 * ink);
        delta[i] += d * w[r];
      }
    }
    return [clamp01(c[0] - delta[0]), clamp01(c[1] - delta[1]), clamp01(c[2] - delta[2])];
  }

  // ---------- 照片滤镜（color.rs photo_filter_matrix；crates/color 的 D50 矩阵与 blend::set_lum） ----------
  var D50 = [0.96422, 1.0, 0.82521];
  var SRGB_TO_XYZ_D50 = [[0.436074, 0.385064, 0.143080], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]];
  var XYZ_D50_TO_SRGB = [[3.133856, -1.616867, -0.490615], [-0.978768, 1.916142, 0.033454], [0.071945, -0.228991, 1.405243]];
  function clipColor(c) {
    var l = lum3(c);
    var n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
    var out = c.slice(), i;
    if (n < 0) { var d = l - n; for (i = 0; i < 3; i++) out[i] = (l > 0 && d > 0) ? l + (out[i] - l) * l / d : l; }
    if (x > 1) { var d2 = x - l; for (i = 0; i < 3; i++) out[i] = (l < 1 && d2 > 0) ? l + (out[i] - l) * (1 - l) / d2 : l; }
    return out;
  }
  function setLum(c, l) {
    var d = l - lum3(c);
    return clipColor([c[0] + d, c[1] + d, c[2] + d]);
  }
  // color: [r,g,b] 0..255；density: 0..100。8-bit 路径不做 Y 归一（PhotoCraft 仅 32-bit 做）
  function photoMatrix(color, density) {
    var d = Math.min(1, Math.max(0, density / 100));
    var xyz = mat3Mul(SRGB_TO_XYZ_D50, color.map(function (v) { return srgbToLinear(v / 255); }));
    var s = [0, 1, 2].map(function (i) { return 1 - d + d * xyz[i] / D50[i]; });
    return XYZ_D50_TO_SRGB.map(function (row, r) {
      return row.map(function (_, cc) {
        return XYZ_D50_TO_SRGB[r][0] * s[0] * SRGB_TO_XYZ_D50[0][cc]
             + XYZ_D50_TO_SRGB[r][1] * s[1] * SRGB_TO_XYZ_D50[1][cc]
             + XYZ_D50_TO_SRGB[r][2] * s[2] * SRGB_TO_XYZ_D50[2][cc];
      });
    });
  }
  function photoApply(c, m, preserve) {
    var f = mat3Mul(m, c.map(srgbToLinear)).map(function (v) { return linearToSrgb(Math.max(0, v)); });
    if (preserve) f = setLum(f, lum3(c));
    return [clamp01(f[0]), clamp01(f[1]), clamp01(f[2])];
  }

  // ---------- 渐变映射（color.rs gradient；色带与 filters.js GRAD_MAPS 共用） ----------
  function gradEval(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (var i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        var k = stops[i + 1][0] > stops[i][0] ? (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]) : 0;
        var a = stops[i][1], b = stops[i + 1][1];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      }
    }
    return stops[stops.length - 1][1];
  }

  // ---------- 阈值（channels.rs threshold_white，U8 口径） ----------
  function thresholdWhite(r, g, b, level) {
    return (30 * r + 59 * g + 11 * b) > 100 * level - 50;
  }

  // ---------- 色调分离（tone.rs posterize，8-bit 口径） ----------
  function posterizeLut(levels) {
    var n = Math.min(255, Math.max(2, Math.round(levels)));
    var lut = new Uint8Array(256);
    for (var v = 0; v < 256; v++) {
      var bin = Math.min(Math.floor(v * n / 256), n - 1);
      lut[v] = Math.floor(bin * 255 / (n - 1));
    }
    return lut;
  }

  // ================= 管线：固定顺序逐像素应用已启用的调整 =================
  // 顺序：色阶 → 通道混合器 → 可选颜色 → 照片滤镜 → 黑白 → 渐变映射 → 色调分离 → 阈值
  function apply(img, adj) {
    if (!img || !img.data || !adj) return img;
    var stages = [];
    if (adj.levels) {
      var ll = levelsLut(adj.levels);
      stages.push(function (c) {
        return [ll[Math.round(c[0] * 255)] / 255, ll[Math.round(c[1] * 255)] / 255, ll[Math.round(c[2] * 255)] / 255];
      });
    }
    if (adj.mixer) {
      var rows = adj.mixer.m, mono = adj.mixer.mono;
      stages.push(function (c) {
        function mix(row) {
          return clamp01((row[0] * c[0] + row[1] * c[1] + row[2] * c[2]) / 100 + row[3] / 100);
        }
        var r = mix(rows[0]);
        return mono ? [r, r, r] : [r, mix(rows[1]), mix(rows[2])];
      });
    }
    if (adj.selcolor) {
      var sa = adj.selcolor.a, rel = !!adj.selcolor.rel;
      stages.push(function (c) { return selColor(c, rel, sa); });
    }
    if (adj.photo) {
      var pm = photoMatrix(adj.photo.color, adj.photo.density), pp = !!adj.photo.preserve;
      stages.push(function (c) { return photoApply(c, pm, pp); });
    }
    if (adj.bw) {
      var bw = adj.bw.w;
      stages.push(function (c) { var g = clamp01(bwGray(c[0], c[1], c[2], bw)); return [g, g, g]; });
    }
    if (adj.gradmap) {
      var F = (typeof window !== 'undefined') ? window.MTFilters : globalThis.MTFilters;
      var gm = F && F.gradMaps && F.gradMaps[adj.gradmap.map];
      if (gm) {
        var stops = gm.stops.map(function (s) { return [s[0], s[1].map(function (v) { return v / 255; })]; });
        var amt = Math.min(100, Math.max(0, adj.gradmap.amount)) / 100;
        stages.push(function (c) {
          var o = gradEval(stops, lum3(c));
          return [c[0] + (o[0] - c[0]) * amt, c[1] + (o[1] - c[1]) * amt, c[2] + (o[2] - c[2]) * amt];
        });
      }
    }
    if (adj.posterize) {
      var pl = posterizeLut(adj.posterize.levels);
      stages.push(function (c) {
        return [pl[Math.round(c[0] * 255)] / 255, pl[Math.round(c[1] * 255)] / 255, pl[Math.round(c[2] * 255)] / 255];
      });
    }
    if (adj.threshold) {
      var lv = Math.round(adj.threshold.level);
      stages.push(function (c) {
        var w = thresholdWhite(Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), lv) ? 1 : 0;
        return [w, w, w];
      });
    }
    if (!stages.length) return img;
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var c = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
      for (var s = 0; s < stages.length; s++) c = stages[s](c);
      d[i] = Math.round(clamp01(c[0]) * 255);
      d[i + 1] = Math.round(clamp01(c[1]) * 255);
      d[i + 2] = Math.round(clamp01(c[2]) * 255);
    }
    return img;
  }

  function isActive(adj) {
    if (!adj) return false;
    for (var k in adj) if (adj[k]) return true;
    return false;
  }

  // ================= 智能一键优化（自研：PhotoCraft 无此策略） =================
  // 输入编辑器直方图 {r,g,b,l}（计数数组），输出 13 项调节参数的一组增量。
  // 原则：只纠正明显问题（欠曝/过曝/发灰/偏色），正常照片增量接近 0；每项有上限。
  function autoOptimize(hist) {
    var out = { exposure: 0, contrast: 0, saturation: 0, shadows: 0, highlights: 0, temperature: 0 };
    if (!hist || !hist.l) return out;
    var L = hist.l, total = 0, sum = 0, i;
    for (i = 0; i < 256; i++) { total += L[i]; sum += L[i] * i; }
    if (!total) return out;
    function pct(p) {
      var need = total * p, acc = 0;
      for (var k = 0; k < 256; k++) { acc += L[k]; if (acc >= need) return k / 255; }
      return 1;
    }
    var mean = sum / total / 255, p1 = pct(0.01), p99 = pct(0.99), span = p99 - p1;
    function cap(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    // 曝光：把平均亮度拉向 0.46（log2 域），最多 ±1 档
    if (mean > 0.01) out.exposure = cap(Math.log2(0.46 / mean), -1, 1);
    // 对比度：亮度跨度不足时拉开（只加不减）
    if (span < 0.98) out.contrast = cap((0.98 / Math.max(0.1, span) - 1) * 55, 0, 45);
    // 发灰（跨度小）时顺带补一点饱和度
    if (span < 0.75) out.saturation = cap((0.75 - span) * 40, 0, 20);
    // 阴影/高光：欠曝提阴影，过曝压高光，黑场上浮（雾）时压黑场由 blacks 承担不在此列
    if (mean < 0.3) out.shadows = cap((0.3 - mean) * 160, 0, 35);
    if (p99 < 0.9 && mean < 0.55) out.highlights = cap((0.9 - p99) * 120, 0, 30);
    if (mean > 0.62) out.highlights = -cap((mean - 0.62) * 150, 0, 35);
    // 色温：按三通道均值差估偏色（红高蓝低 = 偏暖 → 降色温纠正）
    var mr = 0, mg = 0, mb = 0, tr = 0, tg = 0, tb = 0;
    for (i = 0; i < 256; i++) { tr += hist.r[i]; mr += hist.r[i] * i; tg += hist.g[i]; mg += hist.g[i] * i; tb += hist.b[i]; mb += hist.b[i] * i; }
    if (tr && tb) out.temperature = cap(((mb / tb) - (mr / tr)) / 255 * 180, -25, 25);
    return out;
  }

  // ================= UI 定义（数据驱动：滑杆/选项声明，界面自动生成） =================
  // sliders(st)：[{label, min, max, step, get(st), set(st, v)}]
  // extras(st)：[{type:'select'|'check'|'color', label, options?, get(st), set(st, v)}]
  function S(label, min, max, step, get, set) { return { label: label, min: min, max: max, step: step, get: get, set: set }; }

  var PHOTO_FILTERS = [
    ['暖化 (85)', [236, 138, 0]], ['暖化 (LBA)', [250, 150, 0]], ['暖化 (81)', [235, 177, 19]],
    ['冷化 (80)', [0, 109, 255]], ['冷化 (LBB)', [0, 93, 255]], ['冷化 (82)', [0, 181, 255]],
    ['红', [234, 26, 26]], ['橙', [243, 132, 23]], ['黄', [249, 227, 28]], ['绿', [25, 201, 25]],
    ['青', [29, 203, 234]], ['蓝', [29, 53, 234]], ['紫', [155, 29, 234]], ['洋红', [227, 24, 227]],
    ['棕褐', [172, 122, 51]], ['深红', [255, 0, 0]], ['深蓝', [0, 34, 205]], ['深绿', [0, 140, 0]],
    ['深黄', [255, 213, 0]], ['水下', [0, 194, 177]]
  ];
  var SEL_RANGES = ['红色', '黄色', '绿色', '青色', '蓝色', '洋红', '白色', '中性色', '黑色'];
  var BW_NAMES = ['红', '黄', '绿', '青', '蓝', '洋红'];
  var MIX_ROWS = ['输出红', '输出绿', '输出蓝'];
  var MIX_COLS = ['红', '绿', '蓝', '常数'];

  var DEFS = [
    {
      id: 'levels', name: '色阶',
      make: function () { return { inBlack: 0, gamma: 1, inWhite: 255 }; },
      sliders: function () {
        return [
          S('黑场', 0, 253, 1, function (s) { return s.inBlack; }, function (s, v) { s.inBlack = Math.min(v, s.inWhite - 2); }),
          S('灰场', 0.1, 9.99, 0.01, function (s) { return s.gamma; }, function (s, v) { s.gamma = v; }),
          S('白场', 2, 255, 1, function (s) { return s.inWhite; }, function (s, v) { s.inWhite = Math.max(v, s.inBlack + 2); })
        ];
      }
    },
    {
      id: 'mixer', name: '通道混合器',
      make: function () { return { m: [[100, 0, 0, 0], [0, 100, 0, 0], [0, 0, 100, 0]], mono: 0 }; },
      sliders: function (st) {
        var out = [];
        var rows = st.mono ? [0] : [0, 1, 2];
        rows.forEach(function (r) {
          MIX_COLS.forEach(function (cn, ci) {
            out.push(S((st.mono ? '灰' : MIX_ROWS[r]) + ' · ' + cn, -200, 200, 1,
              function (s) { return s.m[r][ci]; }, function (s, v) { s.m[r][ci] = Math.round(v); }));
          });
        });
        return out;
      },
      extras: function () {
        return [
          { type: 'check', label: '单色', get: function (s) { return !!s.mono; },
            set: function (s, v) { s.mono = v ? 1 : 0; if (v) s.m[0] = [40, 40, 20, 0]; } },
          { type: 'preset', label: '预置单色', apply: function (s) { s.mono = 1; s.m[0] = [40, 40, 20, 0]; } }
        ];
      }
    },
    {
      id: 'selcolor', name: '可选颜色',
      make: function () {
        return { range: 0, rel: 1, a: Array.from({ length: 9 }, function () { return [0, 0, 0, 0]; }) };
      },
      sliders: function (st) {
        var names = ['青', '洋红', '黄', '黑'];
        return names.map(function (nm, ci) {
          return S(nm, -100, 100, 1,
            function (s) { return s.a[s.range][ci]; }, function (s, v) { s.a[s.range][ci] = Math.round(v); });
        });
      },
      extras: function () {
        return [
          { type: 'select', label: '颜色范围', options: SEL_RANGES.map(function (t, i) { return { v: i, t: t }; }),
            get: function (s) { return s.range; }, set: function (s, v) { s.range = v; } },
          { type: 'check', label: '相对', get: function (s) { return !!s.rel; }, set: function (s, v) { s.rel = v ? 1 : 0; } }
        ];
      }
    },
    {
      id: 'photo', name: '照片滤镜',
      make: function () { return { preset: 0, color: PHOTO_FILTERS[0][1].slice(), density: 25, preserve: 1 }; },
      sliders: function () {
        return [S('浓度', 0, 100, 1, function (s) { return s.density; }, function (s, v) { s.density = v; })];
      },
      extras: function () {
        return [
          { type: 'select', label: '滤镜', options: PHOTO_FILTERS.map(function (f, i) { return { v: i, t: f[0] }; }).concat([{ v: -1, t: '自定义颜色' }]),
            get: function (s) { return s.preset; },
            set: function (s, v) { s.preset = v; if (v >= 0) s.color = PHOTO_FILTERS[v][1].slice(); } },
          { type: 'color', label: '颜色', get: function (s) { return s.color; },
            set: function (s, v) { s.color = v; s.preset = -1; } },
          { type: 'check', label: '保留明度', get: function (s) { return !!s.preserve; }, set: function (s, v) { s.preserve = v ? 1 : 0; } }
        ];
      }
    },
    {
      id: 'bw', name: '黑白',
      make: function () { return { w: [40, 60, 40, 60, 20, 80] }; },
      sliders: function () {
        return BW_NAMES.map(function (nm, i) {
          return S(nm, -200, 300, 1, function (s) { return s.w[i]; }, function (s, v) { s.w[i] = Math.round(v); });
        });
      }
    },
    {
      id: 'gradmap', name: '渐变映射',
      make: function () { return { map: 0, amount: 100 }; },
      sliders: function () {
        return [S('强度', 0, 100, 1, function (s) { return s.amount; }, function (s, v) { s.amount = v; })];
      },
      extras: function () {
        var F = (typeof window !== 'undefined') ? window.MTFilters : null;
        var names = (F && F.gradMaps) ? F.gradMaps.map(function (g) { return g.name; }) : ['黑金', '青橙', '蓝紫', '红粉'];
        return [
          { type: 'select', label: '色带', options: names.map(function (t, i) { return { v: i, t: t }; }),
            get: function (s) { return s.map; }, set: function (s, v) { s.map = v; } }
        ];
      }
    },
    {
      id: 'posterize', name: '色调分离',
      make: function () { return { levels: 4 }; },
      sliders: function () {
        return [S('色阶数', 2, 255, 1, function (s) { return s.levels; }, function (s, v) { s.levels = Math.round(v); })];
      }
    },
    {
      id: 'threshold', name: '阈值',
      make: function () { return { level: 128 }; },
      sliders: function () {
        return [S('阈值', 1, 255, 1, function (s) { return s.level; }, function (s, v) { s.level = Math.round(v); })];
      }
    }
  ];

  var root = (typeof window !== 'undefined') ? window : globalThis;
  root.MTAdjust = { defs: DEFS, apply: apply, isActive: isActive, autoOptimize: autoOptimize };
})();
