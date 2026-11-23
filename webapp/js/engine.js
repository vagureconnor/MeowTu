/*
 * 喵图 MeowTu 网页版引擎核心（engine.js）
 * 纯原生 JS，无第三方库。像素算法逐行移植自 Java 版：
 *   - 调节三段流水线  ← core/LutEngine.java（LUT 段 + 逐像素影调/色彩段 + 清晰度/锐化空间段）
 *   - 盒式/高斯模糊    ← core/Img.java（可分离滑动窗口盒式模糊，三次叠加近似高斯）
 *   - 曲线             ← core/Curves.java（Catmull-Rom 样条 + 端点反射，合成顺序 out = 单通道LUT[RGB LUT[v]]）
 *   - 直方图           ← core/Histogram.java（降采样步长、跳过全透明像素、明度权重 0.2126/0.7152/0.0722）
 *   - 示例图           ← MainFrame.makeSampleImage（960×640，同色值同顺序）
 *   - 提交/撤销语义    ← MainFrame.commitImage / commitAdjust / rasterizeTexts
 * 状态模型：baseCanvas（已提交像素）+ 预览参数（调节 + 曲线 + 文字对象）。
 * 预览走降采样副本（最长边 1100，与 Java 版 previewAdjust 的 downscale 一致），导出走全分辨率管线。
 */
(function () {
  'use strict';

  var PREVIEW_MAX_SIDE = 1100; // 与 Java 版预览降采样一致
  var HISTORY_MAX = 12;        // 契约：撤销栈上限 12 步

  // ---------------- 基础工具 ----------------

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }

  function cloneCanvas(src) {
    var c = makeCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  /** 等比降采样：最长边不超过 maxSide（移植 Img.downscale；浏览器双线性≈Java BILINEAR）。 */
  function downscaleCanvas(src, maxSide) {
    var w = src.width, h = src.height, m = Math.max(w, h);
    if (m <= maxSide) return cloneCanvas(src);
    var s = maxSide / m;
    var c = makeCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  // ---------------- 模糊（移植 Img.boxBlur / gaussianBlur，ARGB 打包像素） ----------------

  function imageDataToARGB(data) {
    var n = data.length / 4, out = new Uint32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      out[i] = ((data[j + 3] << 24) | (data[j] << 16) | (data[j + 1] << 8) | data[j + 2]) >>> 0;
    }
    return out;
  }

  function argbToImageData(px, data) {
    for (var i = 0, j = 0; i < px.length; i++, j += 4) {
      var c = px[i];
      data[j] = (c >> 16) & 0xFF;
      data[j + 1] = (c >> 8) & 0xFF;
      data[j + 2] = c & 0xFF;
      data[j + 3] = (c >>> 24) & 0xFF;
    }
  }

  /** 一趟滑动窗口盒式模糊（移植 Img.blurPass，含 alpha 通道、边缘钳制、整数除法截断）。 */
  function blurPass(inp, out, w, h, r, horizontal) {
    var span = 2 * r + 1, x, y, i, p;
    if (horizontal) {
      for (y = 0; y < h; y++) {
        var sa = 0, sr = 0, sg = 0, sb = 0, row = y * w;
        for (i = -r; i <= r; i++) {
          p = inp[row + clamp(i, 0, w - 1)];
          sa += p >>> 24; sr += (p >> 16) & 0xFF; sg += (p >> 8) & 0xFF; sb += p & 0xFF;
        }
        for (x = 0; x < w; x++) {
          out[row + x] = ((Math.floor(sa / span) << 24) | (Math.floor(sr / span) << 16) |
                          (Math.floor(sg / span) << 8) | Math.floor(sb / span)) >>> 0;
          var sub = inp[row + clamp(x - r, 0, w - 1)];
          var add = inp[row + clamp(x + r + 1, 0, w - 1)];
          sa += (add >>> 24) - (sub >>> 24);
          sr += ((add >> 16) & 0xFF) - ((sub >> 16) & 0xFF);
          sg += ((add >> 8) & 0xFF) - ((sub >> 8) & 0xFF);
          sb += (add & 0xFF) - (sub & 0xFF);
        }
      }
    } else {
      for (x = 0; x < w; x++) {
        var sa2 = 0, sr2 = 0, sg2 = 0, sb2 = 0;
        for (i = -r; i <= r; i++) {
          p = inp[clamp(i, 0, h - 1) * w + x];
          sa2 += p >>> 24; sr2 += (p >> 16) & 0xFF; sg2 += (p >> 8) & 0xFF; sb2 += p & 0xFF;
        }
        for (y = 0; y < h; y++) {
          out[y * w + x] = ((Math.floor(sa2 / span) << 24) | (Math.floor(sr2 / span) << 16) |
                            (Math.floor(sg2 / span) << 8) | Math.floor(sb2 / span)) >>> 0;
          var sub2 = inp[clamp(y - r, 0, h - 1) * w + x];
          var add2 = inp[clamp(y + r + 1, 0, h - 1) * w + x];
          sa2 += (add2 >>> 24) - (sub2 >>> 24);
          sr2 += ((add2 >> 16) & 0xFF) - ((sub2 >> 16) & 0xFF);
          sg2 += ((add2 >> 8) & 0xFF) - ((sub2 >> 8) & 0xFF);
          sb2 += (add2 & 0xFF) - (sub2 & 0xFF);
        }
      }
    }
  }

  function boxBlur(px, w, h, radius) {
    if (radius <= 0) return px.slice();
    var tmp = new Uint32Array(px.length), out = new Uint32Array(px.length);
    blurPass(px, tmp, w, h, radius, true);
    blurPass(tmp, out, w, h, radius, false);
    return out;
  }

  /** 近似高斯：三次盒式叠加（移植 Img.gaussianBlur，半径取 radius/2 向下取整、至少 1）。 */
  function gaussianBlur(px, w, h, radius) {
    if (radius <= 0) return px.slice();
    var r = Math.max(1, Math.floor(radius / 2)), img = px;
    for (var i = 0; i < 3; i++) img = boxBlur(img, w, h, r);
    return img;
  }

  // ---------------- 调节引擎（移植 LutEngine） ----------------

  var PARAM_DEFS = [
    // [键名, 最小, 最大]：范围与 AdjustPanel 滑杆一致（exposure 滑杆 -30..30 × 0.1）
    ['exposure', -3, 3],
    ['brightness', -100, 100],
    ['contrast', -100, 100],
    ['temperature', -100, 100],
    ['tint', -100, 100],
    ['saturation', -100, 100],
    ['vibrance', -100, 100],
    ['highlights', -100, 100],
    ['shadows', -100, 100],
    ['whites', -100, 100],
    ['blacks', -100, 100],
    ['clarity', -100, 100],
    ['sharpen', 0, 100]
  ];

  function freshParams() {
    var p = {};
    for (var i = 0; i < PARAM_DEFS.length; i++) p[PARAM_DEFS[i][0]] = 0;
    return p;
  }

  function paramsIsIdentity(p) {
    for (var i = 0; i < PARAM_DEFS.length; i++) if (p[PARAM_DEFS[i][0]] !== 0) return false;
    return true;
  }

  /** 生成 R/G/B 三条 256 级 LUT：曝光、电平（黑白场）、亮度、对比度、色温/色调增益（移植 buildChannelLuts）。 */
  function buildChannelLuts(p) {
    var ev = Math.pow(2.0, p.exposure);
    var inBlack = Math.max(0, p.blacks) / 100.0 * 0.28 - Math.min(0, p.blacks) / 100.0 * 0.06;
    var inWhite = 1.0 - Math.max(0, p.whites) / 100.0 * 0.28 + Math.min(0, p.whites) / 100.0 * 0.06;
    var lift = Math.max(0, -p.blacks) / 100.0 * 0.12;
    var ceil = 1.0 - Math.max(0, -p.whites) / 100.0 * 0.12;
    var bri = p.brightness / 100.0 * 0.28;
    var con = p.contrast / 100.0;
    var conK = con >= 0 ? 1 + con * 1.6 : 1 + con * 0.85;
    var temp = p.temperature / 100.0;
    var tint = p.tint / 100.0;
    var gain = [
      (1 + temp * 0.28) * (1 + tint * 0.10),
      (1 - Math.abs(temp) * 0.05) * (1 - tint * 0.22),
      (1 - temp * 0.28) * (1 + tint * 0.10)
    ];
    var denom = Math.max(0.05, inWhite - inBlack);
    var luts = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for (var ch = 0; ch < 3; ch++) {
      for (var v = 0; v < 256; v++) {
        var x = v / 255.0;
        x *= ev * gain[ch];
        x = (x - inBlack) / denom;
        x = x * (ceil - lift) + lift;
        x += bri;
        x = (x - 0.5) * conK + 0.5;
        luts[ch][v] = clamp255(Math.round(x * 255));
      }
    }
    return luts;
  }

  /** 第 1+2 段：通道 LUT → 逐像素高光/阴影（明度掩膜）→ 饱和度/自然饱和度。原地改 ImageData，alpha 不动。 */
  function applyAdjustPixelStages(data, p) {
    var luts = buildChannelLuts(p);
    var lr = luts[0], lg = luts[1], lb = luts[2];
    var shAmt = p.shadows / 100.0 * 0.38;
    var hiAmt = p.highlights / 100.0 * 0.38;
    var satK = 1 + p.saturation / 100.0;
    var vibAmt = p.vibrance / 100.0;
    var tonal = shAmt !== 0 || hiAmt !== 0;
    var color = satK !== 1 || vibAmt !== 0;
    for (var i = 0; i < data.length; i += 4) {
      var r = lr[data[i]], g = lg[data[i + 1]], b = lb[data[i + 2]];
      if (tonal || color) {
        var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
        if (tonal) {
          var d = shAmt * (1 - lum) * (1 - lum) + hiAmt * lum * lum;
          var add = Math.round(d * 255);
          r = clamp255(r + add); g = clamp255(g + add); b = clamp255(b + add);
          lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
        }
        if (color) {
          var k = satK;
          if (vibAmt !== 0) {
            var mx = Math.max(r, Math.max(g, b));
            var mn = Math.min(r, Math.min(g, b));
            var curSat = mx === 0 ? 0 : (mx - mn) / mx;
            k += vibAmt * (1 - curSat) * (vibAmt > 0 ? 1.0 : 0.6);
          }
          var L = lum * 255;
          r = clamp255(Math.round(L + (r - L) * k));
          g = clamp255(Math.round(L + (g - L) * k));
          b = clamp255(Math.round(L + (b - L) * k));
        }
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }

  /** 清晰度：大半径高斯作低频，中调加权加回高频（移植 applyClarity）。 */
  function applyClarity(px, w, h, clarity) {
    var radius = Math.max(4, Math.floor(Math.min(w, h) / 48));
    var blur = gaussianBlur(px, w, h, radius);
    var amt = clarity / 100.0 * 1.4;
    var out = new Uint32Array(px.length);
    for (var i = 0; i < px.length; i++) {
      var ca = px[i], cb = blur[i];
      var r0 = (ca >> 16) & 0xFF, g0 = (ca >> 8) & 0xFF, b0 = ca & 0xFF;
      var lum = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255.0;
      var mask = 1 - Math.abs(lum - 0.5) * 1.6;
      if (mask < 0) mask = 0;
      var k = amt * mask;
      out[i] = ((ca & 0xFF000000) |
        (clamp255(Math.round(r0 + (r0 - ((cb >> 16) & 0xFF)) * k)) << 16) |
        (clamp255(Math.round(g0 + (g0 - ((cb >> 8) & 0xFF)) * k)) << 8) |
        clamp255(Math.round(b0 + (b0 - (cb & 0xFF)) * k))) >>> 0;
    }
    return out;
  }

  /** 锐化：半径 1 盒式模糊的 USM（移植 applySharpen）。 */
  function applySharpen(px, w, h, sharpen) {
    var blur = boxBlur(px, w, h, 1);
    var amt = sharpen / 100.0 * 1.6;
    var out = new Uint32Array(px.length);
    for (var i = 0; i < px.length; i++) {
      var ca = px[i], cb = blur[i];
      var r0 = (ca >> 16) & 0xFF, g0 = (ca >> 8) & 0xFF, b0 = ca & 0xFF;
      out[i] = ((ca & 0xFF000000) |
        (clamp255(Math.round(r0 + (r0 - ((cb >> 16) & 0xFF)) * amt)) << 16) |
        (clamp255(Math.round(g0 + (g0 - ((cb >> 8) & 0xFF)) * amt)) << 8) |
        clamp255(Math.round(b0 + (b0 - (cb & 0xFF)) * amt))) >>> 0;
    }
    return out;
  }

  // ---------------- 曲线（移植 Curves：Catmull-Rom 样条） ----------------

  var CURVE_KEYS = ['rgb', 'r', 'g', 'b'];
  var IDENTITY_POINTS = [[0, 0], [255, 255]];

  function sanitizePoints(pts) {
    if (!Array.isArray(pts)) return null;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) continue;
      var x = Array.isArray(p) ? p[0] : p.x;
      var y = Array.isArray(p) ? p[1] : p.y;
      if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) continue;
      out.push([clamp(Math.round(x), 0, 255), clamp(Math.round(y), 0, 255)]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out.length ? out : IDENTITY_POINTS.map(function (p) { return p.slice(); });
  }

  /** Catmull-Rom 样条求值（移植 evalSpline：端点用反射虚拟点，两点直线时严格线性）。 */
  function evalSpline(pts, x) {
    var n = pts.length;
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    var i = 0;
    while (i < n - 2 && x > pts[i + 1][0]) i++;
    var p1 = pts[i], p2 = pts[i + 1];
    var p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    var p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    var t = (x - p1[0]) / Math.max(1, p2[0] - p1[0]);
    var t2 = t * t, t3 = t2 * t;
    var y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
      + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
      + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    return clamp(y, 0, 255);
  }

  /** 单条曲线 LUT（移植 lut()：首尾缺端点时按端点 y 水平外延补齐）。 */
  function curveLut(points) {
    var pts = points.slice().sort(function (a, b) { return a[0] - b[0]; });
    if (!pts.length || pts[0][0] > 0) pts.unshift([0, pts.length ? pts[0][1] : 0]);
    if (pts[pts.length - 1][0] < 255) pts.push([255, pts[pts.length - 1][1]]);
    var lut = new Uint8Array(256);
    for (var v = 0; v < 256; v++) lut[v] = Math.round(evalSpline(pts, v));
    return lut;
  }

  /** 合成 LUT：out[ch][v] = 单通道LUT_ch[ RGB LUT[v] ]（移植 combinedLuts）。恒等时返回 null。 */
  function combinedCurveLuts(curvePts) {
    var rgb = curveLut(curvePts.rgb);
    var single = [curveLut(curvePts.r), curveLut(curvePts.g), curveLut(curvePts.b)];
    var out = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    var identity = true;
    for (var ch = 0; ch < 3; ch++) {
      for (var v = 0; v < 256; v++) {
        out[ch][v] = single[ch][rgb[v]];
        if (out[ch][v] !== v) identity = false;
      }
    }
    return identity ? null : out;
  }

  function freshCurvePoints() {
    return {
      rgb: IDENTITY_POINTS.map(function (p) { return p.slice(); }),
      r: IDENTITY_POINTS.map(function (p) { return p.slice(); }),
      g: IDENTITY_POINTS.map(function (p) { return p.slice(); }),
      b: IDENTITY_POINTS.map(function (p) { return p.slice(); })
    };
  }

  // ---------------- 管线：base → 调节 → 曲线 →（清晰度/锐化） ----------------
  // Java 版调节与曲线是两次独立提交；网页版按契约合并预览/烘焙，顺序取：
  // 先 LutEngine 的逐点段（LUT+影调+色彩），再曲线 LUT，最后空间段（清晰度、锐化），与 LutEngine 内部“空间项最后”一致。

  function runPipeline(srcCanvas, params, curveLuts) {
    var adjIdentity = paramsIsIdentity(params);
    if (adjIdentity && !curveLuts) return srcCanvas; // 恒等：直接返回源（调用方保证不原地改它）
    var w = srcCanvas.width, h = srcCanvas.height;
    var work = makeCanvas(w, h);
    var ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    var imgData = ctx.getImageData(0, 0, w, h);
    var data = imgData.data;
    if (!adjIdentity) applyAdjustPixelStages(data, params);
    if (curveLuts) {
      var cr = curveLuts[0], cg = curveLuts[1], cb = curveLuts[2];
      for (var i = 0; i < data.length; i += 4) {
        data[i] = cr[data[i]]; data[i + 1] = cg[data[i + 1]]; data[i + 2] = cb[data[i + 2]];
      }
    }
    if (!adjIdentity && (params.clarity !== 0 || params.sharpen > 0)) {
      var px = imageDataToARGB(data);
      if (params.clarity !== 0) px = applyClarity(px, w, h, params.clarity);
      if (params.sharpen > 0) px = applySharpen(px, w, h, params.sharpen);
      argbToImageData(px, data);
    }
    ctx.putImageData(imgData, 0, 0);
    return work;
  }

  // ---------------- 文字（移植 TextObject.render 的画法） ----------------

  function drawTexts(ctx, texts, scale) {
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      if (!t || t.text == null || String(t.text) === '') continue;
      var text = String(t.text);
      var size = (typeof t.size === 'number' && t.size > 0 ? t.size : 48) * scale;
      var x = (t.x || 0) * scale, y = (t.y || 0) * scale;
      ctx.save();
      ctx.font = (t.bold ? 'bold ' : '') + size + 'px ' + (t.font || 'sans-serif');
      ctx.textBaseline = 'top'; // 近似 Java 的 y+ascent 基线定位（y 为文字顶边）
      // Java 版默认描边：黑色 alpha=160、四方向偏移 max(1, size/18)
      var d = Math.max(1, size / 18);
      ctx.fillStyle = 'rgba(0,0,0,0.627)';
      ctx.fillText(text, x - d, y);
      ctx.fillText(text, x + d, y);
      ctx.fillText(text, x, y - d);
      ctx.fillText(text, x, y + d);
      ctx.fillStyle = t.color || '#ffffff';
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  }

  // ---------------- 示例图（移植 MainFrame.makeSampleImage） ----------------

  function fillEllipse(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function fillPolygon(ctx, xs, ys) {
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (var i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.closePath();
    ctx.fill();
  }

  function makeSampleCanvas() {
    var w = 960, h = 640;
    var c = makeCanvas(w, h);
    var g = c.getContext('2d');
    var sky = g.createLinearGradient(0, 0, 0, h * 2 / 3);
    sky.addColorStop(0, '#7EC8E3');
    sky.addColorStop(1, '#F7E8C3');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#FFD93D';
    fillEllipse(g, w - 220, 60, 110, 110);            // 太阳
    g.fillStyle = '#5B8C5A';
    fillPolygon(g, [0, 260, 520], [430, 210, 430]);   // 远山
    g.fillStyle = '#49744A';
    fillPolygon(g, [300, 560, 820], [440, 240, 440]); // 近山
    g.fillStyle = '#77B255';
    g.fillRect(0, 430, w, h - 430);                   // 草地
    g.fillStyle = '#E5534B';
    fillEllipse(g, 120, 460, 90, 90);                 // 红圆
    g.fillStyle = '#4A9EFF';
    fillEllipse(g, 240, 480, 60, 60);                 // 蓝圆
    g.fillStyle = 'rgba(255,255,255,0.784)';          // 云（Java alpha=200）
    fillEllipse(g, 80, 90, 150, 44);
    fillEllipse(g, 150, 70, 110, 40);
    return c;
  }

  // ---------------- 滤镜调用的抽样校验和（判断 MTFilters 是否改了像素） ----------------

  function sampleChecksum(data) {
    var s = data.length >>> 0;
    for (var i = 0; i < data.length; i += 4099) s = (s * 31 + data[i]) >>> 0;
    return s;
  }

  // ---------------- 编辑器 ----------------

  function createEditor(displayCanvas) {
    var dctx = displayCanvas.getContext('2d');
    var base = null;          // 已提交像素（全分辨率 canvas）；一经设定不再原地修改
    var previewSrc = null;    // base 的降采样副本（预览管线输入）
    var previewCanvas = null; // 最近一次预览管线结果（直方图数据源）
    var params = freshParams();
    var curvePts = freshCurvePoints();
    var curveLuts = null;     // combinedCurveLuts 结果，恒等为 null
    var texts = [];
    var undoStack = [], redoStack = [];
    var stateListeners = [];

    function emitState() {
      var s = {
        hasImage: !!base,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        w: base ? base.width : 0,
        h: base ? base.height : 0
      };
      for (var i = 0; i < stateListeners.length; i++) {
        try { stateListeners[i](s); } catch (e) { /* 监听器异常不影响引擎 */ }
      }
    }

    function refreshPreviewSrc() {
      previewSrc = base ? downscaleCanvas(base, PREVIEW_MAX_SIDE) : null;
    }

    /** 把预览管线结果画到显示画布，文字按预览/原图比例缩放绘制在最上层。 */
    function render() {
      if (!base) {
        previewCanvas = null;
        dctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        emitState();
        return;
      }
      var out = runPipeline(previewSrc, params, curveLuts);
      previewCanvas = out;
      if (displayCanvas.width !== out.width || displayCanvas.height !== out.height) {
        displayCanvas.width = out.width;
        displayCanvas.height = out.height;
      }
      dctx.clearRect(0, 0, out.width, out.height);
      dctx.drawImage(out, 0, 0);
      if (texts.length) drawTexts(dctx, texts, out.width / base.width);
      emitState();
    }

    /** 通用提交（移植 commitImage）：旧 base 入撤销栈（上限 12）、清重做栈、换新 base。 */
    function commitImage(newBase) {
      if (base) {
        undoStack.push(cloneCanvas(base));
        while (undoStack.length > HISTORY_MAX) undoStack.shift();
      }
      redoStack.length = 0;
      base = newBase;
      refreshPreviewSrc();
      render();
    }

    /** 载入新图（打开/示例图）：清历史、清全部预览状态（移植 openImage / makeSampleImage 的状态清理）。 */
    function setFreshImage(canvas) {
      base = canvas;
      undoStack.length = 0;
      redoStack.length = 0;
      params = freshParams();
      curvePts = freshCurvePoints();
      curveLuts = null;
      texts = [];
      refreshPreviewSrc();
      render();
    }

    function drawSourceToBase(source, w, h) {
      var c = makeCanvas(w, h);
      c.getContext('2d').drawImage(source, 0, 0);
      setFreshImage(c);
    }

    var editor = {

      // ----- 载入 -----

      loadFile: function (file) {
        return new Promise(function (resolve, reject) {
          function useBitmap(bmp) {
            drawSourceToBase(bmp, bmp.width, bmp.height);
            if (bmp.close) bmp.close();
            resolve(editor.getSize());
          }
          function fallbackImage() {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
              drawSourceToBase(img, img.naturalWidth, img.naturalHeight);
              URL.revokeObjectURL(url);
              resolve(editor.getSize());
            };
            img.onerror = function (err) {
              URL.revokeObjectURL(url);
              reject(err || new Error('MT: image decode failed'));
            };
            img.src = url;
          }
          if (typeof createImageBitmap === 'function') {
            createImageBitmap(file, { imageOrientation: 'from-image' }).then(useBitmap, function () {
              createImageBitmap(file).then(useBitmap, fallbackImage);
            });
          } else {
            fallbackImage();
          }
        });
      },

      loadImage: function (img) {
        var self = this;
        function doLoad() {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) return Promise.reject(new Error('MT: image has no size'));
          drawSourceToBase(img, w, h);
          return editor.getSize();
        }
        if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && !img.complete) {
          return new Promise(function (resolve, reject) {
            img.addEventListener('load', function () { doLoad().then(resolve, reject); }, { once: true });
            img.addEventListener('error', function (e) { reject(e || new Error('MT: image load failed')); }, { once: true });
          });
        }
        return Promise.resolve().then(doLoad);
      },

      newSample: function () {
        setFreshImage(makeSampleCanvas());
        return editor;
      },

      // ----- 调节 / 曲线 -----

      setAdjust: function (partial) {
        if (partial) {
          for (var i = 0; i < PARAM_DEFS.length; i++) {
            var key = PARAM_DEFS[i][0];
            if (typeof partial[key] === 'number' && isFinite(partial[key])) {
              params[key] = clamp(partial[key], PARAM_DEFS[i][1], PARAM_DEFS[i][2]);
            }
          }
        }
        render();
        return editor;
      },

      getAdjust: function () {
        var p = {};
        for (var i = 0; i < PARAM_DEFS.length; i++) p[PARAM_DEFS[i][0]] = params[PARAM_DEFS[i][0]];
        return p;
      },

      /** 把当前调节+曲线烘焙进 base 并推撤销栈，参数与曲线归零（移植 commitAdjust+commitCurves 的合并语义）。 */
      commitAdjust: function () {
        if (!base) return false;
        if (paramsIsIdentity(params) && !curveLuts) { render(); return false; }
        var out = runPipeline(base, params, curveLuts);
        params = freshParams();
        curvePts = freshCurvePoints();
        curveLuts = null;
        commitImage(out);
        return true;
      },

      /** 重置全部预览调节：参数归零 + 曲线恢复恒等。 */
      resetAdjust: function () {
        params = freshParams();
        curvePts = freshCurvePoints();
        curveLuts = null;
        render();
        return editor;
      },

      /** 部分更新曲线：只替换传入的通道（rgb/r/g/b），点为 [x,y] 数组（0..255）。 */
      setCurves: function (curves) {
        if (curves) {
          for (var i = 0; i < CURVE_KEYS.length; i++) {
            var key = CURVE_KEYS[i];
            if (curves[key] != null) {
              var pts = sanitizePoints(curves[key]);
              if (pts) curvePts[key] = pts;
            }
          }
          curveLuts = combinedCurveLuts(curvePts);
        }
        render();
        return editor;
      },

      getCurves: function () {
        var out = {};
        for (var i = 0; i < CURVE_KEYS.length; i++) {
          out[CURVE_KEYS[i]] = curvePts[CURVE_KEYS[i]].map(function (p) { return p.slice(); });
        }
        return out;
      },

      // ----- 滤镜（实现位于 filters.js，本引擎只负责调用与烘焙） -----

      applyFilter: function (name) {
        if (!base) return false;
        var F = window.MTFilters;
        if (!F || typeof F.apply !== 'function') return false; // 不存在时静默跳过
        var work = cloneCanvas(base);
        var wctx = work.getContext('2d', { willReadFrequently: true });
        var handled = false;
        // 先试 ImageData 约定：返回新 ImageData 或原地改像素都认
        try {
          var imgData = wctx.getImageData(0, 0, work.width, work.height);
          var before = sampleChecksum(imgData.data);
          var ret = F.apply(imgData, name);
          if (ret && ret.data && ret.width === work.width && ret.height === work.height) {
            wctx.putImageData(ret, 0, 0);
            handled = true;
          } else if (sampleChecksum(imgData.data) !== before) {
            wctx.putImageData(imgData, 0, 0);
            handled = true;
          }
        } catch (e) { /* 落到 ctx 约定再试 */ }
        // 再试 ctx 约定
        if (!handled) {
          try { F.apply(wctx, name); handled = true; } catch (e) { return false; }
        }
        if (!handled) return false;
        commitImage(work);
        return true;
      },

      // ----- 几何（烘焙进 base 并推栈） -----

      rotate90: function (dir) {
        if (!base) return false;
        var cw = !(dir === -1 || dir === 'ccw' || dir === false);
        var w = base.width, h = base.height;
        var srcCtx = base.getContext('2d', { willReadFrequently: true });
        var sd = srcCtx.getImageData(0, 0, w, h).data;
        var out = makeCanvas(h, w);
        var octx = out.getContext('2d');
        var imgData = octx.createImageData(h, w);
        var dd = imgData.data;
        for (var y = 0; y < w; y++) {          // 输出高 = 原宽
          for (var x = 0; x < h; x++) {        // 输出宽 = 原高
            // 移植 Geometry.rotate90 的逆映射：CW dst(x,y)=src(y, h-1-x)；CCW dst(x,y)=src(w-1-y, x)
            var sx = cw ? y : (w - 1 - y);
            var sy = cw ? (h - 1 - x) : x;
            var si = (sy * w + sx) * 4, di = (y * h + x) * 4;
            dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = sd[si + 3];
          }
        }
        octx.putImageData(imgData, 0, 0);
        commitImage(out);
        return true;
      },

      flipH: function () {
        if (!base) return false;
        var out = makeCanvas(base.width, base.height);
        var ctx = out.getContext('2d');
        ctx.translate(base.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(base, 0, 0);
        commitImage(out);
        return true;
      },

      flipV: function () {
        if (!base) return false;
        var out = makeCanvas(base.width, base.height);
        var ctx = out.getContext('2d');
        ctx.translate(0, base.height);
        ctx.scale(1, -1);
        ctx.drawImage(base, 0, 0);
        commitImage(out);
        return true;
      },

      resizeTo: function (w, h) {
        if (!base) return false;
        w = Math.max(1, Math.round(w));
        h = Math.max(1, Math.round(h));
        if (!isFinite(w) || !isFinite(h)) return false;
        var out = makeCanvas(w, h);
        var ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(base, 0, 0, w, h);
        commitImage(out);
        return true;
      },

      cropTo: function (x, y, w, h) {
        if (!base) return false;
        // 移植 Geometry.crop：与图像范围求交，空交集不动
        var x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
        var x1 = Math.min(base.width, Math.ceil(x + w)), y1 = Math.min(base.height, Math.ceil(y + h));
        if (x1 - x0 <= 0 || y1 - y0 <= 0) return false;
        var out = makeCanvas(x1 - x0, y1 - y0);
        out.getContext('2d').drawImage(base, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
        commitImage(out);
        return true;
      },

      // ----- 文字 -----

      setTexts: function (arr) {
        texts = Array.isArray(arr) ? arr.map(function (t) {
          var o = {};
          for (var k in t) o[k] = t[k];
          return o;
        }) : [];
        render();
        return editor;
      },

      getTexts: function () {
        return texts.map(function (t) {
          var o = {};
          for (var k in t) o[k] = t[k];
          return o;
        });
      },

      /** 把文字按原图坐标全分辨率烘焙进 base（移植 rasterizeTexts），随后清空文字列表。 */
      commitTexts: function () {
        if (!base || !texts.length) return false;
        var out = cloneCanvas(base);
        drawTexts(out.getContext('2d'), texts, 1);
        texts = [];
        commitImage(out);
        return true;
      },

      // ----- 历史 -----

      undo: function () {
        if (!undoStack.length) return false;
        redoStack.push(cloneCanvas(base));
        base = undoStack.pop();
        refreshPreviewSrc();
        render();
        return true;
      },

      redo: function () {
        if (!redoStack.length) return false;
        undoStack.push(cloneCanvas(base));
        while (undoStack.length > HISTORY_MAX) undoStack.shift();
        base = redoStack.pop();
        refreshPreviewSrc();
        render();
        return true;
      },

      // ----- 导出 / 统计 / 状态 -----

      /** 全分辨率输出当前完整效果（base + 预览调节 + 曲线 + 文字）。 */
      exportBlob: function (options) {
        if (!base) return Promise.reject(new Error('MT: no image loaded'));
        options = options || {};
        var typeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
        var type = typeMap[options.format || 'png'] || 'image/png';
        var quality = typeof options.quality === 'number' ? clamp(options.quality, 0, 1) : 0.92;
        var out = runPipeline(base, params, curveLuts);
        if (texts.length) {
          if (out === base) out = cloneCanvas(base);
          drawTexts(out.getContext('2d'), texts, 1);
        }
        return new Promise(function (resolve, reject) {
          out.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('MT: export failed'));
          }, type, quality);
        });
      },

      /** 基于当前预览（降采样后）的直方图（移植 Histogram.compute 的步长与口径）。 */
      getHistogram: function () {
        function zeros() { return new Array(256).fill(0); }
        var result = { r: zeros(), g: zeros(), b: zeros(), l: zeros() };
        if (!base || !previewCanvas) return result;
        var w = previewCanvas.width, h = previewCanvas.height;
        var data = previewCanvas.getContext('2d', { willReadFrequently: true })
          .getImageData(0, 0, w, h).data;
        var step = Math.max(1, Math.floor(Math.sqrt(w * h / 1000000)));
        for (var y = 0; y < h; y += step) {
          for (var x = 0; x < w; x += step) {
            var i = (y * w + x) * 4;
            if (data[i + 3] === 0) continue; // 跳过全透明像素（Java 同口径）
            var r = data[i], g = data[i + 1], b = data[i + 2];
            result.r[r]++; result.g[g]++; result.b[b]++;
            result.l[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
          }
        }
        return result;
      },

      getSize: function () {
        return base ? { w: base.width, h: base.height } : null;
      },

      hasImage: function () { return !!base; },

      on: function (eventName, cb) {
        if (eventName === 'state' && typeof cb === 'function') {
          stateListeners.push(cb);
          return function () {
            var i = stateListeners.indexOf(cb);
            if (i >= 0) stateListeners.splice(i, 1);
          };
        }
        return function () {};
      }
    };

    return editor;
  }

  window.MT = { createEditor: createEditor };
})();
