/*
 * 喵图 MeowTu 网页版引擎核心（engine.js）
 * 纯原生 JS，无第三方库。像素算法逐行移植自 Java 版：
 *   - 调节三段流水线  ← core/LutEngine.java（LUT 段 + 逐像素影调/色彩段 + 清晰度/锐化空间段）
 *   - 盒式/高斯模糊    ← core/Img.java（可分离滑动窗口盒式模糊，三次叠加近似高斯）
 *   - 曲线             ← core/Curves.java（Catmull-Rom 样条 + 端点反射，合成顺序 out = 单通道LUT[RGB LUT[v]]）
 *   - 直方图           ← core/Histogram.java（降采样步长、跳过全透明像素、明度权重 0.2126/0.7152/0.0722）
 *   - 示例图           ← MainFrame.makeSampleImage（960×640，同色值同顺序）
 *   - 提交/撤销语义    ← MainFrame.commitImage / commitAdjust / rasterizeTexts
 * 状态模型：图层文档（layers 自下而上，每层 canvas + 自己的调节/曲线/滤镜状态）
 * + 编辑器级文字覆盖层（过渡）。合成走 27 种混合模式逐像素公式（blendCompositeInto）。
 * 图层蒙版与调整层翻译自 PhotoCraft（doc/lib.rs LayerMask 灰度语义 + compose 的
 * Adjustment 分支）：蒙版灰度乘进有效 alpha；调整层无像素、管线作用于其下合成结果再 blend back。
 * 预览走降采样副本（最长边 1100，与 Java 版 previewAdjust 的 downscale 一致），导出走全分辨率管线。
 */
(function () {
  'use strict';

  var PREVIEW_MAX_SIDE = 1100; // 与 Java 版预览降采样一致
  var HISTORY_MAX = 12;        // 契约：撤销栈上限 12 步
  // 工程文件（.meowtu）格式头：单个 JSON，图层像素/蒙版以 PNG dataURL 内嵌。
  // 格式本体自研（PhotoCraft 的 PSD/ORA 是二进制栈，只参考其分层文档的字段构成）。
  var PROJECT_FORMAT = 'meowtu-project';
  var PROJECT_VERSION = 1;
  var RECIPE_FORMAT = 'meowtu-recipe';
  var RECIPE_VERSION = 1;

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

  function lutActive(st) {
    var LU = (typeof window !== 'undefined') ? window.MTLut : null;
    return !!(LU && st && LU.isActive(st));
  }

  function runPipeline(srcCanvas, params, curveLuts, filterId, filterParams, adj, lut) {
    var adjIdentity = paramsIsIdentity(params);
    var AJ = (typeof window !== 'undefined') ? window.MTAdjust : null;
    var hasAdj = !!(AJ && adj && AJ.isActive(adj));
    var hasLut = lutActive(lut);
    if (adjIdentity && !curveLuts && !filterId && !hasAdj && !hasLut) return srcCanvas; // 恒等：直接返回源（调用方保证不原地改它）
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
    if (hasAdj) { try { AJ.apply(imgData, adj); } catch (e) { /* 调整异常不影响管线 */ } }
    // LUT 调色段：高级调整之后、滤镜之前（MTLut 三线性采样，强度与 LUT 前像素混合）
    if (hasLut) { try { window.MTLut.apply(imgData, lut); } catch (e) { /* LUT 异常不影响管线 */ } }
    if (filterId) {
      // 滤镜是管线的最后一段：只按当前状态应用一次（状态式，不烘焙、重复点击不叠加）
      var F = (typeof window !== 'undefined') ? window.MTFilters : null;
      if (F && typeof F.apply === 'function') { try { F.apply(imgData, filterId, filterParams || undefined); } catch (e) { /* 滤镜异常不影响管线 */ } }
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

  // ---------------- 透视：单应矩阵求解（8 元线性方程组，高斯消元） ----------------

  /** 求把 src 四点映到 dst 四点的单应矩阵（行主序 9 元，最后一元归一为 1）。 */
  function solveHomography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var n = 8;
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-12) return null;
      if (piv !== col) { var ta = A[piv]; A[piv] = A[col]; A[col] = ta; var tb = b[piv]; b[piv] = b[col]; b[col] = tb; }
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var f = A[r2][col] / A[col][col];
        if (f === 0) continue;
        for (var c2 = col; c2 < n; c2++) A[r2][c2] -= f * A[col][c2];
        b[r2] -= f * b[col];
      }
    }
    var H = [];
    for (var i2 = 0; i2 < n; i2++) H.push(b[i2] / A[i2][i2]);
    H.push(1);
    return H;
  }

  /** 双线性采样用的单点读取（坐标钳制到图内）。 */
  function samplePx(data, w, h, x, y, ch) {
    var cx = x < 0 ? 0 : (x >= w ? w - 1 : x);
    var cy = y < 0 ? 0 : (y >= h ? h - 1 : y);
    return data[(cy * w + cx) * 4 + ch];
  }

  // ---------------- 混合模式（Photoshop 27 种，逐像素公式） ----------------
  // 数值口径：通道值用 0..1 浮点；可分离模式逐通道，非分离模式（hue/saturation/color/
  // luminosity）用 W3C Compositing and Blending 的 Lum/Sat/SetLum/SetSat/ClipColor 辅助函数，
  // darkerColor/lighterColor 按三通道总和比较（Photoshop 口径）。
  // dissolve（溶解）在 Photoshop 里是按 alpha 随机抖动，本实现以 normal 近似（设计允许）。
  // subtract 取 clamp(Cb-Cs)（Wikipedia/GIMP 口径）；divide 取 Cb/Cs 钳制（Cs=0 时为 1）。

  var BLEND_MODE_LIST = [
    'normal', 'dissolve', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor',
    'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor',
    'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
    'difference', 'exclusion', 'subtract', 'divide',
    'hue', 'saturation', 'color', 'luminosity'
  ];

  function bBurn(cb, cs) { return cs <= 0 ? 0 : Math.max(0, 1 - (1 - cb) / cs); }
  function bDodge(cb, cs) { return cs >= 1 ? 1 : Math.min(1, cb / (1 - cs)); }
  function bSoftD(cb) { return cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb); }

  /** 可分离模式的单通道混合函数 B(cb, cs)，输入输出均为 0..1。 */
  function blendChannel(mode, cb, cs) {
    switch (mode) {
      case 'darken': return Math.min(cb, cs);
      case 'multiply': return cb * cs;
      case 'colorBurn': return bBurn(cb, cs);
      case 'linearBurn': return Math.max(0, cb + cs - 1);
      case 'lighten': return Math.max(cb, cs);
      case 'screen': return 1 - (1 - cb) * (1 - cs);
      case 'colorDodge': return bDodge(cb, cs);
      case 'linearDodge': return Math.min(1, cb + cs);
      case 'overlay': return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
      case 'softLight':
        if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
        return cb + (2 * cs - 1) * (bSoftD(cb) - cb);
      case 'hardLight': return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
      case 'vividLight': return cs <= 0.5 ? bBurn(cb, 2 * cs) : bDodge(cb, 2 * (cs - 0.5));
      case 'linearLight': return cs <= 0.5 ? Math.max(0, cb + 2 * cs - 1) : Math.min(1, cb + 2 * (cs - 0.5));
      case 'pinLight': return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * (cs - 0.5));
      case 'hardMix': {
        var v = cs <= 0.5 ? bBurn(cb, 2 * cs) : bDodge(cb, 2 * (cs - 0.5));
        return v < 0.5 ? 0 : 1;
      }
      case 'difference': return Math.abs(cb - cs);
      case 'exclusion': return cb + cs - 2 * cb * cs;
      case 'subtract': return Math.max(0, cb - cs);
      case 'divide': return cs <= 0 ? 1 : Math.min(1, cb / cs);
      default: return cs; // normal / dissolve
    }
  }

  function lum3(c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
  function sat3(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }

  function clipColor(c) {
    var l = lum3(c);
    var mn = Math.min(c[0], c[1], c[2]), mx = Math.max(c[0], c[1], c[2]);
    var out = [c[0], c[1], c[2]], i;
    if (mn < 0) for (i = 0; i < 3; i++) out[i] = l + (out[i] - l) * l / (l - mn);
    if (mx > 1) for (i = 0; i < 3; i++) out[i] = l + (out[i] - l) * (1 - l) / (mx - l);
    return out;
  }

  function setLum(c, l) {
    var d = l - lum3(c);
    return clipColor([c[0] + d, c[1] + d, c[2] + d]);
  }

  function setSat(c, s) {
    var idx = [0, 1, 2].sort(function (a, b) { return c[a] - c[b]; });
    var out = [0, 0, 0];
    var mn = c[idx[0]], md = c[idx[1]], mx = c[idx[2]];
    if (mx > mn) { out[idx[1]] = (md - mn) * s / (mx - mn); out[idx[2]] = s; }
    return out;
  }

  /** 三通道混合：cb/cs 为 [r,g,b]（0..1），返回混合色 [r,g,b]（不含 alpha 合成）。 */
  function blendTriple(mode, cb, cs) {
    switch (mode) {
      case 'darkerColor': {
        var sb = cb[0] + cb[1] + cb[2], ss = cs[0] + cs[1] + cs[2];
        return (ss < sb ? cs : cb).slice();
      }
      case 'lighterColor': {
        var sb2 = cb[0] + cb[1] + cb[2], ss2 = cs[0] + cs[1] + cs[2];
        return (ss2 > sb2 ? cs : cb).slice();
      }
      case 'hue': return setLum(setSat(cs, sat3(cb)), lum3(cb));
      case 'saturation': return setLum(setSat(cb, sat3(cs)), lum3(cb));
      case 'color': return setLum(cs, lum3(cb));
      case 'luminosity': return setLum(cb, lum3(cs));
      default:
        return [
          blendChannel(mode, cb[0], cs[0]),
          blendChannel(mode, cb[1], cs[1]),
          blendChannel(mode, cb[2], cs[2])
        ];
    }
  }

  /** 供测试/外部调用的 0..255 口径混合（仅混合色，不做 alpha 合成）。 */
  function blendApply255(mode, cb, cs) {
    var B = blendTriple(mode,
      [cb[0] / 255, cb[1] / 255, cb[2] / 255],
      [cs[0] / 255, cs[1] / 255, cs[2] / 255]);
    return [
      clamp255(Math.round(B[0] * 255)),
      clamp255(Math.round(B[1] * 255)),
      clamp255(Math.round(B[2] * 255))
    ];
  }

  /**
   * 把一层像素（srcData）按混合模式 + 图层不透明度合成到累积缓冲（accData，原地修改）。
   * 合成公式（W3C / Photoshop 口径，非预乘）：
   *   αs = 源alpha × opacity；αo = αs + αb(1-αs)
   *   Co = [αs(1-αb)Cs + αs·αb·B(Cb,Cs) + (1-αs)αb·Cb] / αo
   */
  function blendCompositeInto(accData, srcData, mode, opacity, mb) {
    var n = accData.length;
    for (var i = 0; i < n; i += 4) {
      // 图层蒙版调制有效 alpha（PhotoCraft 口径：sa = 源alpha × opacity × 蒙版灰度，doc/lib.rs LayerMask）
      var as = srcData[i + 3] / 255 * opacity * (mb ? mb[i >> 2] / 255 : 1);
      if (as <= 0) continue;
      var ab = accData[i + 3] / 255;
      var cb = [accData[i] / 255, accData[i + 1] / 255, accData[i + 2] / 255];
      var cs = [srcData[i] / 255, srcData[i + 1] / 255, srcData[i + 2] / 255];
      var B = blendTriple(mode, cb, cs);
      var ao = as + ab * (1 - as);
      for (var ch = 0; ch < 3; ch++) {
        var co = as * (1 - ab) * cs[ch] + as * ab * B[ch] + (1 - as) * ab * cb[ch];
        accData[i + ch] = clamp255(Math.round((ao > 0 ? co / ao : 0) * 255));
      }
      accData[i + 3] = clamp255(Math.round(ao * 255));
    }
  }

  // ---------------- 编辑器（图层文档模型） ----------------
  // 文档 = layers 数组（自下而上），每层持有自己的 canvas 与编辑状态
  // （params/curvePts/curveLuts/filter）；调节/曲线/滤镜只改活动层的状态。
  // 合成 = 自下而上逐层：每层先过自己的管线，再按 blendMode+opacity 叠加。
  // texts 仍是编辑器级覆盖层（过渡方案，画在合成结果最上层）。

  function createEditor(displayCanvas) {
    var dctx = displayCanvas.getContext('2d');
    var docW = 0, docH = 0;
    var layers = [];          // 自下而上
    var activeIdx = -1;
    var layerSeq = 0;
    // 活动层的编辑状态（与活动层对象共享引用，切换时 pull/bind 同步）
    var params = freshParams();
    var curvePts = freshCurvePoints();
    var curveLuts = null;
    var activeFilter = null;
    var filterParams = null;
    var adjState = null;
    var lutState = null;
    var texts = [];
    var undoStack = [], redoStack = [];
    // 历史标签（与两栈平行：undoLabels[i] 是 undoStack[i] 那个状态的名字，
    // curLabel 是当前状态的名字；条目构成参考 PhotoCraft 的 History 面板 entries）
    var undoLabels = [], redoLabels = [], curLabel = '打开图片';
    var stateListeners = [];
    var lastSettled = null;   // 上一个「已安定」状态快照（调节检查点用）
    // 选区（编辑器级，不属于任何图层、不进撤销栈——与 Photoshop 一致；
    // 几何变换时掩膜做同一变换，文档尺寸对不上时丢弃）。算法在 selection.js（MTSelection）。
    var selMask = null;       // Uint8Array(docW*docH) 覆盖度 0..255
    var selCount = 0;         // 覆盖度 >0 的像素数
    var selRev = 0;           // 选区换代计数（UI 蚂蚁线缓存失效判断）
    var selCanvasCache = null, selCanvasRev = -1;  // 选区灰度画布缓存（缩放取数用）
    var selScaleCache = null;                      // {rev,w,h,bytes} 缩放后的掩膜字节缓存
    var selScratch = null;                         // 预览约束结果的复用画布
    var maskTargetId = null;  // UI 选中的蒙版所属图层 id（删除/反相的作用对象）；不进撤销栈
    var paintCtx = null;      // 进行中的一笔 {L, target:'layer'|'mask'}（beginPaint/endPaint 之间）
    var tfQuad = null;        // 自由变换预览中的四角（文档坐标）；只影响预览合成，不进快照

    // ----- 图层对象 -----

    function makeLayer(canvas, name, kind) {
      return {
        id: ++layerSeq,
        kind: kind || 'pixel',   // 'pixel' 像素层 | 'adj' 调整层（无像素，canvas 为 null）
        name: name || ((kind === 'adj' ? '调整图层 ' : '图层 ') + layerSeq),
        canvas: canvas,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        mask: null,               // 灰度画布（文档尺寸，白=显示/黑=隐藏）；null = 无蒙版
        maskEnabled: true,
        maskRev: 1,               // 蒙版换代计数（UI 缩略图失效判断）
        _mb: null, _mbFor: null, _mbW: 0, _mbH: 0,  // 蒙版字节缓存（按尺寸）
        params: freshParams(),
        curvePts: freshCurvePoints(),
        curveLuts: null,
        filter: null,
        filterParams: null,   // 参数化滤镜的参数（无参/未设为 null）
        adj: null,            // 高级调整状态（MTAdjust 的 adjState，null = 未启用任何调整）
        lut: null,            // LUT 调色状态 {id, strength, cube?, name?}（MTLut，null = 无 LUT）
        style: null,          // 图层样式（MTStyles 的 style 对象，null = 无样式；调整层不挂）
        _fxSig: '', _fxPaints: null,  // 样式油漆缓存（预览尺寸，签名同管线缓存口径）
        rev: 1,               // canvas 换代计数（UI 缩略图失效判断）
        _pv: null, _pvFor: null,                    // 预览尺寸的原图缓存
        _pipePv: null, _pipeSrc: null, _pipeLuts: null, _pipeSig: ''  // 预览管线结果缓存
      };
    }

    function curLayer() { return activeIdx >= 0 && activeIdx < layers.length ? layers[activeIdx] : null; }

    function setLayerCanvas(L, c) {
      L.canvas = c;
      L.rev++;
      L._pv = null; L._pvFor = null;
      L._pipePv = null; L._pipeSrc = null;
    }

    function resetLayerEdits(L) {
      L.params = freshParams();
      L.curvePts = freshCurvePoints();
      L.curveLuts = null;
      L.filter = null;
      L.filterParams = null;
      L.adj = null;
      L.lut = null;
    }

    // ----- 蒙版（灰度画布，白=显示、黑=隐藏；翻译 PhotoCraft LayerMask 的灰度语义） -----

    function setLayerMask(L, c) {
      L.mask = c || null;
      L.maskRev++;
      L._mb = null; L._mbFor = null;
    }

    function makeMaskCanvas(fillWhite) {
      var c = makeCanvas(docW, docH);
      var x = c.getContext('2d');
      x.fillStyle = fillWhite ? '#ffffff' : '#000000';
      x.fillRect(0, 0, docW, docH);
      return c;
    }

    /** 蒙版在目标尺寸下的灰度字节（双线性缩放，按 蒙版画布+尺寸 缓存）。 */
    function maskBytesAt(L, w, h) {
      if (!L.mask) return null;
      if (L._mb && L._mbFor === L.mask && L._mbW === w && L._mbH === h) return L._mb;
      var c = makeCanvas(w, h);
      var x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = true;
      x.drawImage(L.mask, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data;
      var b = new Uint8Array(w * h);
      for (var i = 0; i < b.length; i++) b[i] = d[i * 4];
      L._mb = b; L._mbFor = L.mask; L._mbW = w; L._mbH = h;
      return b;
    }

    /** 蒙版操作的作用层：选中的蒙版所属层（须仍有蒙版），否则活动层。 */
    function maskTargetLayer() {
      if (maskTargetId != null) {
        for (var i = 0; i < layers.length; i++) {
          if (layers[i].id === maskTargetId && layers[i].mask) return layers[i];
        }
      }
      return curLayer();
    }

    /** 层的 adj 高级调整是否启用（MTAdjust 口径）。 */
    function hasAdjActive(L) {
      var AJ = (typeof window !== 'undefined') ? window.MTAdjust : null;
      return !!(AJ && L.adj && AJ.isActive(L.adj));
    }

    /** 层的管线（调节→曲线→adj→LUT，不含滤镜）是否非恒等——调整层是否「有事可做」。 */
    function layerEditsActive(L) {
      return !paramsIsIdentity(L.params) || !!L.curveLuts || hasAdjActive(L) || lutActive(L.lut);
    }

    function copyJSON(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }

    /** 闭包里的活动层状态变量 → 写回活动层对象（引用赋值）。 */
    function bindActive() {
      var L = curLayer();
      if (!L) return;
      L.params = params; L.curvePts = curvePts; L.curveLuts = curveLuts; L.filter = activeFilter;
      L.filterParams = filterParams; L.adj = adjState; L.lut = lutState;
    }

    /** 活动层对象 → 载入闭包状态变量（共享引用，之后的原地修改自动落在层上）。 */
    function pullActive() {
      var L = curLayer();
      if (!L) {
        params = freshParams(); curvePts = freshCurvePoints(); curveLuts = null; activeFilter = null;
        filterParams = null; adjState = null; lutState = null;
        return;
      }
      params = L.params; curvePts = L.curvePts; curveLuts = L.curveLuts; activeFilter = L.filter;
      filterParams = L.filterParams; adjState = L.adj; lutState = L.lut;
    }

    function copyParams(p) {
      var o = {};
      for (var i = 0; i < PARAM_DEFS.length; i++) o[PARAM_DEFS[i][0]] = p[PARAM_DEFS[i][0]];
      return o;
    }

    function copyCurves(cp) {
      var o = {};
      for (var i = 0; i < CURVE_KEYS.length; i++) o[CURVE_KEYS[i]] = cp[CURVE_KEYS[i]].map(function (p) { return p.slice(); });
      return o;
    }

    function copyTexts(ts) {
      return ts.map(function (t) { var o = {}; for (var k in t) o[k] = t[k]; return o; });
    }

    // ----- 状态事件 -----

    function layersMeta() {
      return layers.map(function (L, i) {
        return {
          id: L.id, name: L.name, kind: L.kind, visible: L.visible, opacity: L.opacity,
          blendMode: L.blendMode, active: i === activeIdx, rev: L.rev,
          hasStyle: !!(L.style && typeof window !== 'undefined' && window.MTStyles && window.MTStyles.isActive(L.style)),
          hasMask: !!L.mask, maskEnabled: L.maskEnabled, maskRev: L.maskRev,
          maskSelected: !!L.mask && L.id === maskTargetId
        };
      });
    }

    function emitState() {
      var s = {
        hasImage: layers.length > 0,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        filter: activeFilter,
        filterParams: copyJSON(filterParams),
        adj: copyJSON(adjState),
        lut: copyJSON(lutState),
        layers: layersMeta(),
        activeLayer: activeIdx,
        history: historyInfo(),
        selection: selMask ? { active: selCount > 0, count: selCount, rev: selRev } : null,
        w: docW,
        h: docH
      };
      for (var i = 0; i < stateListeners.length; i++) {
        try { stateListeners[i](s); } catch (e) { /* 监听器异常不影响引擎 */ }
      }
    }

    // ----- 合成 -----

    function previewDims() {
      var m = Math.max(docW, docH);
      if (m <= PREVIEW_MAX_SIDE) return { w: docW, h: docH };
      var s = PREVIEW_MAX_SIDE / m;
      return { w: Math.max(1, Math.round(docW * s)), h: Math.max(1, Math.round(docH * s)) };
    }

    /** 图层在预览尺寸下的原始像素（缓存，canvas 换代才重建）。 */
    function layerPreview(L, w, h) {
      if (L._pv && L._pvFor === L.canvas && L._pv.width === w && L._pv.height === h) return L._pv;
      var c = makeCanvas(w, h);
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(L.canvas, 0, 0, w, h);
      L._pv = c; L._pvFor = L.canvas;
      return c;
    }

    function paramsSig(p) {
      var s = '';
      for (var i = 0; i < PARAM_DEFS.length; i++) s += p[PARAM_DEFS[i][0]] + ',';
      return s;
    }

    /** 图层在给定尺寸下的「已生效」像素：原 canvas（或预览降采样）过自己的管线。
     *  有选区时，活动层的管线结果只作用于选区内（按覆盖度与原像素混合）。 */
    function layerRendered(L, w, h, preview) {
      var src = preview ? layerPreview(L, w, h) : L.canvas;
      var AJ = (typeof window !== 'undefined') ? window.MTAdjust : null;
      var hasAdj = !!(AJ && L.adj && AJ.isActive(L.adj));
      if (paramsIsIdentity(L.params) && !L.curveLuts && !L.filter && !hasAdj && !lutActive(L.lut)) return src;
      var out;
      if (!preview) {
        out = runPipeline(src, L.params, L.curveLuts, L.filter, L.filterParams, L.adj, L.lut);
      } else {
        var sig = paramsSig(L.params) + '|' + (L.filter || '') + '|' +
          JSON.stringify(L.filterParams || null) + '|' + JSON.stringify(L.adj || null) + '|' +
          JSON.stringify(L.lut || null);
        if (L._pipePv && L._pipeSrc === src && L._pipeLuts === L.curveLuts && L._pipeSig === sig) {
          out = L._pipePv;
        } else {
          out = runPipeline(src, L.params, L.curveLuts, L.filter, L.filterParams, L.adj, L.lut);
          L._pipePv = out; L._pipeSrc = src; L._pipeLuts = L.curveLuts; L._pipeSig = sig;
        }
      }
      if (selMask && selCount > 0 && L === curLayer()) out = constrainResult(out, src, w, h, preview);
      return out;
    }

    // ----- 选区内部 -----

    function selModule() { return (typeof window !== 'undefined') ? window.MTSelection : null; }

    /** 设置选区掩膜（null = 无选区）；计数与换代同步更新，触发重渲染。 */
    function setSelMask(mask) {
      selMask = mask || null;
      selCount = 0;
      if (selMask) for (var i = 0; i < selMask.length; i++) if (selMask[i] > 0) selCount++;
      selRev++;
      render();
    }

    /** 选区灰度画布（文档尺寸，R 通道 = 覆盖度），按 selRev 缓存。 */
    function selCanvas() {
      if (!selMask) return null;
      if (selCanvasCache && selCanvasRev === selRev) return selCanvasCache;
      var c = makeCanvas(docW, docH);
      var ctx = c.getContext('2d');
      var img = ctx.createImageData(docW, docH);
      for (var i = 0, j = 0; i < selMask.length; i++, j += 4) {
        img.data[j] = img.data[j + 1] = img.data[j + 2] = selMask[i];
        img.data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      selCanvasCache = c; selCanvasRev = selRev;
      return c;
    }

    /** 选区掩膜在任意目标尺寸下的字节（预览约束/蚂蚁线用，双线性缩放）。 */
    function selBytesAt(w, h) {
      if (!selMask) return null;
      if (w === docW && h === docH) return selMask;
      if (selScaleCache && selScaleCache.rev === selRev && selScaleCache.w === w && selScaleCache.h === h) {
        return selScaleCache.bytes;
      }
      var mc = selCanvas();
      if (!mc) return null;
      var c = makeCanvas(w, h);
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mc, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;
      var bytes = new Uint8Array(w * h);
      for (var i = 0; i < bytes.length; i++) bytes[i] = d[i * 4];
      selScaleCache = { rev: selRev, w: w, h: h, bytes: bytes };
      return bytes;
    }

    /** 把 out 的像素按选区覆盖度与 src 混合（out 原地改）：选区内 = out，选区外 = src。 */
    function constrainInPlace(out, src, w, h) {
      var mb = selBytesAt(w, h);
      if (!mb) return out;
      var octx = out.getContext('2d', { willReadFrequently: true });
      var img = octx.getImageData(0, 0, w, h), dd = img.data;
      var sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      for (var i = 0, j = 0; i < mb.length; i++, j += 4) {
        var m = mb[i];
        if (m === 255) continue;
        if (m === 0) { dd[j] = sd[j]; dd[j + 1] = sd[j + 1]; dd[j + 2] = sd[j + 2]; dd[j + 3] = sd[j + 3]; continue; }
        var k = m / 255, u = 1 - k;
        dd[j] = sd[j] * u + dd[j] * k;
        dd[j + 1] = sd[j + 1] * u + dd[j + 1] * k;
        dd[j + 2] = sd[j + 2] * u + dd[j + 2] * k;
        dd[j + 3] = sd[j + 3] * u + dd[j + 3] * k;
      }
      octx.putImageData(img, 0, 0);
      return out;
    }

    /** 约束一份管线结果：全分辨率结果是新鲜画布可原地改；预览结果可能来自缓存，
     *  画进复用画布再改，避免污染管线缓存。 */
    function constrainResult(out, src, w, h, preview) {
      if (!preview) { constrainInPlace(out, src, w, h); return out; }
      if (!selScratch || selScratch.width !== w || selScratch.height !== h) selScratch = makeCanvas(w, h);
      var ctx = selScratch.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(out, 0, 0);
      constrainInPlace(selScratch, src, w, h);
      return selScratch;
    }

    /** 图层样式的油漆（MTStyles.buildPaints，算法译自 PhotoCraft compose/effects）：
     *  形状 = 已生效像素的 alpha × 蒙版灰度。预览时按 尺寸+层rev+管线签名+选区+蒙版+
     *  混合模式+样式 签名缓存（与管线预览缓存同口径）；全分辨率每次现算。 */
    function stylePaints(L, sd, mb, w, h, preview) {
      var STY = (typeof window !== 'undefined') ? window.MTStyles : null;
      if (!STY || !L.style || !STY.isActive(L.style)) return null;
      var sig = '';
      if (preview) {
        sig = w + 'x' + h + '|' + L.rev + '|' + paramsSig(L.params) + '|' + (L.filter || '') + '|' +
          JSON.stringify(L.filterParams || null) + '|' + JSON.stringify(L.adj || null) + '|' +
          JSON.stringify(L.curvePts) + '|' + selRev + '|' +
          (L.mask ? L.maskRev + '/' + L.maskEnabled : '-') + '|' +
          L.blendMode + '|' + JSON.stringify(L.style);
        if (L._fxPaints && L._fxSig === sig) return L._fxPaints;
      }
      var shape = new Float32Array(w * h);
      for (var i = 0, j = 3; i < shape.length; i++, j += 4) {
        shape[i] = sd[j] / 255 * (mb ? mb[i] / 255 : 1);
      }
      var paints = STY.buildPaints(shape, w, h, L.style,
        { knockOut: (L.blendMode === 'normal' || L.blendMode === 'dissolve') ? 0 : 1 });
      if (preview) { L._fxPaints = paints; L._fxSig = sig; }
      return paints;
    }

    /** 把一摞图层（自下而上）合成为一张画布（不含编辑器级文字）。
     *  调整层（翻译 PhotoCraft compose 的 Adjustment 分支）：无自有像素，把自己的管线
     *  （调节→曲线→adj，不含滤镜）作用于「其下已合成结果」，再按不透明度 blend back：
     *  out = backdrop×(1-k) + adjusted×k（仅 RGB，背景 alpha 不变），k = opacity。 */
    function compositeStack(stack, w, h, preview) {
      var out = makeCanvas(w, h);
      var octx = out.getContext('2d', { willReadFrequently: true });
      var acc = octx.createImageData(w, h);
      var ad = acc.data;
      for (var li = 0; li < stack.length; li++) {
        var L = stack[li];
        if (!L.visible || L.opacity <= 0) continue;
        if (L.kind === 'adj') {
          if (!layerEditsActive(L)) continue;
          var bc = makeCanvas(w, h);
          bc.getContext('2d').putImageData(acc, 0, 0);
          var ac = runPipeline(bc, L.params, L.curveLuts, null, null, L.adj, L.lut);
          var ax = (ac === bc ? bc : ac).getContext('2d', { willReadFrequently: true });
          var ajd = ax.getImageData(0, 0, w, h).data;
          var k = L.opacity, u = 1 - k;
          for (var i = 0; i < ad.length; i += 4) {
            ad[i] = clamp255(Math.round(ad[i] * u + ajd[i] * k));
            ad[i + 1] = clamp255(Math.round(ad[i + 1] * u + ajd[i + 1] * k));
            ad[i + 2] = clamp255(Math.round(ad[i + 2] * u + ajd[i + 2] * k));
          }
          continue;
        }
        var srcC = layerRendered(L, w, h, preview);
        // 自由变换预览：活动层换成按 tfQuad 变形后的样子（提交才全分辨率烘焙）
        var tfHere = !!(preview && tfQuad && stack === layers && L === curLayer() && L.kind !== 'adj');
        if (tfHere) srcC = tfWarpTo(srcC, w, h) || srcC;
        var sd = srcC.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        var mb = (L.mask && L.maskEnabled) ? (tfHere ? tfWarpMask(L, w, h) : maskBytesAt(L, w, h)) : null;
        var paints = stylePaints(L, sd, mb, w, h, preview);
        if (paints) {
          // 层之下：投影 → 外发光 → 外侧描边（PhotoCraft effects 的栈序）。
          // 源项目里层不透明度作用于整个效果栈，此处以缩放外部油漆不透明度近似。
          for (var ei = 0; ei < paints.ext.length; ei++) {
            blendCompositeInto(ad, paints.ext[ei].data, paints.ext[ei].mode, L.opacity, null);
          }
          if (paints.int.length) {
            // 层之上：叠加类 → 光泽 → 内发光 → 内阴影 → 内侧描边 → 斜面；
            // 内部效果取形状的 alpha（effects.rs），画完恢复层自身 alpha 通道。
            var keepA = new Uint8Array(w * h);
            for (var ai = 0, aj = 3; ai < keepA.length; ai++, aj += 4) keepA[ai] = sd[aj];
            for (var ii = 0; ii < paints.int.length; ii++) {
              blendCompositeInto(sd, paints.int[ii].data, paints.int[ii].mode, 1, null);
            }
            for (var bi = 0, bj = 3; bi < keepA.length; bi++, bj += 4) sd[bj] = keepA[bi];
          }
        }
        blendCompositeInto(ad, sd, L.blendMode, L.opacity, mb);
      }
      octx.putImageData(acc, 0, 0);
      return out;
    }

    // ----- 自由变换预览（变形算法在 transform.js，译自 PhotoCraft transform.rs） -----

    function tfModule() { return (typeof window !== 'undefined') ? window.MTTransform : null; }

    /** 把一张 (w,h) 画布按当前 tfQuad（文档坐标等比缩放过来）变形并贴回 (w,h) 透明底。 */
    function tfWarpTo(c, w, h) {
      var TF = tfModule();
      if (!TF || !tfQuad) return null;
      var kx = w / docW, ky = h / docH;
      var q = tfQuad.map(function (p) { return { x: p.x * kx, y: p.y * ky }; });
      var res = TF.warp(c, q);
      if (!res) return null;
      var out = makeCanvas(w, h);
      out.getContext('2d').drawImage(res.canvas, res.offX, res.offY);
      return out;
    }

    /** 蒙版字节按 tfQuad 变形（先把字节铺成灰度画布，变形后读回 R 通道）。 */
    function tfWarpMask(L, w, h) {
      var mb = maskBytesAt(L, w, h);
      if (!mb) return null;
      var c = makeCanvas(w, h);
      var ctx = c.getContext('2d', { willReadFrequently: true });
      var img = ctx.createImageData(w, h);
      for (var i = 0, j = 0; i < mb.length; i++, j += 4) {
        img.data[j] = img.data[j + 1] = img.data[j + 2] = mb[i];
        img.data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      var warped = tfWarpTo(c, w, h);
      if (!warped) return mb;
      var d = warped.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      var out = new Uint8Array(w * h);
      for (var k = 0; k < out.length; k++) out[k] = d[k * 4] * d[k * 4 + 3] / 255;
      return out;
    }

    /** 活动层全分辨率「已生效」像素（恒等时也返回克隆，调用方可原地绘制）。
     *  有选区时同样只在选区内生效（与合成口径一致，提交/抠图取到的就是所见）。 */
    function bakeActiveLayer() {
      var L = curLayer();
      if (!L || L.kind === 'adj') return null; // 调整层无像素可烘焙
      var out = runPipeline(L.canvas, L.params, L.curveLuts, L.filter, L.filterParams, L.adj, L.lut);
      if (out === L.canvas) return cloneCanvas(L.canvas);
      if (selMask && selCount > 0) constrainInPlace(out, L.canvas, docW, docH);
      return out;
    }

    /** 当前完整效果的全分辨率合成：全部图层 + 编辑器级文字（所见即所得）。 */
    function bakeCurrent() {
      var out = compositeStack(layers, docW, docH, false);
      if (texts.length) drawTexts(out.getContext('2d'), texts, 1);
      return out;
    }

    /** 工程预览图：拼合结果缩到最长边 512 的 PNG dataURL（供将来文件缩略图用）。 */
    function projectThumb(src) {
      var m = Math.max(src.width, src.height);
      if (m > 512) {
        var k = 512 / m;
        var c = makeCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        src = c;
      }
      return src.toDataURL('image/png');
    }

    /** dataURL → 画布（工程恢复用）；null 直接返回 null，解码失败 reject。 */
    function decodeDataURL(url) {
      return new Promise(function (resolve, reject) {
        if (!url) { resolve(null); return; }
        var img = new Image();
        img.onload = function () {
          var c = makeCanvas(img.naturalWidth, img.naturalHeight);
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c);
        };
        img.onerror = function () { reject(new Error('工程文件已损坏，无法打开')); };
        img.src = url;
      });
    }

    // ----- 渲染 -----

    var previewCanvas = null; // 最近一次预览合成结果（直方图数据源）

    function render() {
      if (!layers.length) {
        previewCanvas = null;
        dctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        emitState();
        return;
      }
      var pd = previewDims();
      var out = compositeStack(layers, pd.w, pd.h, true);
      previewCanvas = out;
      if (displayCanvas.width !== out.width || displayCanvas.height !== out.height) {
        displayCanvas.width = out.width;
        displayCanvas.height = out.height;
      }
      dctx.clearRect(0, 0, out.width, out.height);
      dctx.drawImage(out, 0, 0);
      if (texts.length) drawTexts(dctx, texts, out.width / docW);
      emitState();
    }

    // ----- 快照 / 历史 -----

    /** 完整状态快照：全部图层（canvas 克隆 + 各层编辑状态）+ 活动索引 + 文字。 */
    function snapshotState() {
      return {
        docW: docW, docH: docH,
        layers: layers.map(function (L) {
          return {
            id: L.id, name: L.name, kind: L.kind,
            canvas: L.canvas ? cloneCanvas(L.canvas) : null,
            mask: L.mask ? cloneCanvas(L.mask) : null, maskEnabled: L.maskEnabled,
            visible: L.visible, opacity: L.opacity, blendMode: L.blendMode,
            params: copyParams(L.params), curves: copyCurves(L.curvePts), filter: L.filter,
            filterParams: copyJSON(L.filterParams), adj: copyJSON(L.adj), style: copyJSON(L.style),
            lut: copyJSON(L.lut)
          };
        }),
        activeIdx: activeIdx,
        texts: copyTexts(texts)
      };
    }

    function restoreState(s) {
      docW = s.docW; docH = s.docH;
      layers = s.layers.map(function (sl) {
        var L = makeLayer(sl.canvas, sl.name, sl.kind);
        L.id = sl.id;
        if (sl.mask) setLayerMask(L, sl.mask);
        L.maskEnabled = sl.maskEnabled !== false;
        L.visible = sl.visible; L.opacity = sl.opacity; L.blendMode = sl.blendMode;
        L.params = copyParams(sl.params);
        L.curvePts = copyCurves(sl.curves);
        L.curveLuts = combinedCurveLuts(L.curvePts);
        L.filter = sl.filter || null;
        L.filterParams = copyJSON(sl.filterParams);
        L.adj = copyJSON(sl.adj);
        L.style = copyJSON(sl.style);
        L.lut = copyJSON(sl.lut);
        return L;
      });
      if (layerSeq < layers.length) layerSeq = layers.length;
      for (var i = 0; i < layers.length; i++) if (layers[i].id > layerSeq) layerSeq = layers[i].id;
      activeIdx = layers.length ? clamp(s.activeIdx, 0, layers.length - 1) : -1;
      texts = copyTexts(s.texts);
      // 选区不进快照：撤销/重做后文档尺寸与掩膜对不上时丢弃选区（其余情况保留）
      if (selMask && selMask.length !== docW * docH) { selMask = null; selCount = 0; selRev++; }
      pullActive();
      render();
      lastSettled = snapshotState();
    }

    /** 离散操作的标准开场：当前状态整套入撤销栈（上限 12）、清重做栈。
     *  label = 本次操作的名字，成为操作后当前状态的历史标签。 */
    function beginDiscrete(label) {
      undoStack.push(snapshotState());
      undoLabels.push(curLabel);
      while (undoStack.length > HISTORY_MAX) { undoStack.shift(); undoLabels.shift(); }
      redoStack.length = 0;
      redoLabels.length = 0;
      if (label) curLabel = label;
    }

    /** 历史面板数据：全部状态名（旧→新）+ 当前下标。 */
    function historyInfo() {
      var labels = undoLabels.concat([curLabel]);
      for (var i = redoLabels.length - 1; i >= 0; i--) labels.push(redoLabels[i]);
      return { labels: labels, index: undoStack.length };
    }

    /** 离散操作的标准收尾：重渲染 + 更新安定快照。 */
    function endDiscrete() {
      render();
      lastSettled = snapshotState();
    }

    /** 载入新图（打开/示例图）：单图层文档，清历史与全部状态（含选区）。 */
    function setFreshImage(canvas) {
      docW = canvas.width; docH = canvas.height;
      layers = [makeLayer(canvas, '背景')];
      activeIdx = 0;
      undoStack.length = 0;
      redoStack.length = 0;
      undoLabels.length = 0;
      redoLabels.length = 0;
      curLabel = '打开图片';
      texts = [];
      selMask = null; selCount = 0; selRev++;
      maskTargetId = null;
      tfQuad = null;
      pullActive();
      render();
      lastSettled = snapshotState();
    }

    function drawSourceToBase(source, w, h) {
      var c = makeCanvas(w, h);
      c.getContext('2d').drawImage(source, 0, 0);
      setFreshImage(c);
    }

    /** 把画布适配到文档尺寸（同尺寸克隆；否则按左上原尺寸贴入、超出裁掉、不足透明）。 */
    function fitToDoc(src) {
      if (src.width === docW && src.height === docH) return cloneCanvas(src);
      var c = makeCanvas(docW, docH);
      c.getContext('2d').drawImage(src, 0, 0);
      return c;
    }

    /** 几何变换前把编辑器级文字栅格化到活动层（保持旧版「变换即合并文字」的可见效果）。
     *  活动层是调整层（无像素）时，改烘焙到其下最近的像素层；找不到则保持覆盖层。 */
    function bakeTextsIntoActive() {
      if (!texts.length) return;
      var L = curLayer();
      if (L && L.kind === 'adj') {
        var ti = activeIdx - 1;
        while (ti >= 0 && layers[ti].kind === 'adj') ti--;
        if (ti < 0) return;
        var TL = layers[ti];
        var tout = runPipeline(TL.canvas, TL.params, TL.curveLuts, TL.filter, TL.filterParams, TL.adj, TL.lut);
        if (tout === TL.canvas) tout = cloneCanvas(TL.canvas);
        drawTexts(tout.getContext('2d'), texts, 1);
        setLayerCanvas(TL, tout);
        resetLayerEdits(TL);
        texts = [];
        pullActive();
        return;
      }
      if (!L) return;
      var out = bakeActiveLayer();
      drawTexts(out.getContext('2d'), texts, 1);
      setLayerCanvas(L, out);
      resetLayerEdits(L);
      texts = [];
      pullActive();
    }

    /** 对全部图层逐层做同一画布变换（保住图层结构），文档尺寸随之更新。
     *  选区掩膜做同一变换（旋转/翻转精确，缩放走双线性覆盖度插值，裁剪同矩形）。 */
    function transformAll(fn, newW, newH) {
      bakeTextsIntoActive();
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].canvas) setLayerCanvas(layers[i], fn(layers[i].canvas));
        if (layers[i].mask) setLayerMask(layers[i], fn(layers[i].mask)); // 蒙版跟随同一变换
      }
      if (selMask) {
        var mc = selCanvas();
        var nmc = mc ? fn(mc) : null;
        if (nmc && nmc.width === newW && nmc.height === newH) {
          var nd = nmc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, newW, newH).data;
          var nm = new Uint8Array(newW * newH);
          for (var j = 0; j < nm.length; j++) nm[j] = nd[j * 4];
          selMask = nm;
          selCount = 0;
          for (var k = 0; k < nm.length; k++) if (nm[k] > 0) selCount++;
        } else { selMask = null; selCount = 0; }
        selRev++;
      }
      docW = newW; docH = newH;
      endDiscrete();
    }

    // ----- 单层画布变换（几何用） -----

    function rotateCanvas90(src, cw) {
      var w = src.width, h = src.height;
      var sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      var out = makeCanvas(h, w);
      var octx = out.getContext('2d');
      var imgData = octx.createImageData(h, w);
      var dd = imgData.data;
      for (var y = 0; y < w; y++) {
        for (var x = 0; x < h; x++) {
          // 移植 Geometry.rotate90 的逆映射：CW dst(x,y)=src(y, h-1-x)；CCW dst(x,y)=src(w-1-y, x)
          var sx = cw ? y : (w - 1 - y);
          var sy = cw ? (h - 1 - x) : x;
          var si = (sy * w + sx) * 4, di = (y * h + x) * 4;
          dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = sd[si + 3];
        }
      }
      octx.putImageData(imgData, 0, 0);
      return out;
    }

    function flipCanvas(src, horizontal) {
      var out = makeCanvas(src.width, src.height);
      var ctx = out.getContext('2d');
      if (horizontal) { ctx.translate(src.width, 0); ctx.scale(-1, 1); }
      else { ctx.translate(0, src.height); ctx.scale(1, -1); }
      ctx.drawImage(src, 0, 0);
      return out;
    }

    function resizeCanvasTo(src, w, h) {
      var out = makeCanvas(w, h);
      var ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      return out;
    }

    function cropCanvas(src, x0, y0, w, h) {
      var out = makeCanvas(w, h);
      out.getContext('2d').drawImage(src, x0, y0, w, h, 0, 0, w, h);
      return out;
    }

    function warpCanvas(src, Hm, outW, outH) {
      var W = src.width, H = src.height;
      var sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
      var out = makeCanvas(outW, outH);
      var octx = out.getContext('2d');
      var img = octx.createImageData(outW, outH);
      var dd = img.data;
      for (var y = 0; y < outH; y++) {
        for (var x = 0; x < outW; x++) {
          var wgt = Hm[6] * x + Hm[7] * y + 1;
          var sx = (Hm[0] * x + Hm[1] * y + Hm[2]) / wgt;
          var sy = (Hm[3] * x + Hm[4] * y + Hm[5]) / wgt;
          var x0 = Math.floor(sx), y0 = Math.floor(sy);
          var fx = sx - x0, fy = sy - y0;
          var di = (y * outW + x) * 4;
          for (var ch = 0; ch < 4; ch++) {
            var v = 0;
            v += samplePx(sd, W, H, x0, y0, ch) * (1 - fx) * (1 - fy);
            v += samplePx(sd, W, H, x0 + 1, y0, ch) * fx * (1 - fy);
            v += samplePx(sd, W, H, x0, y0 + 1, ch) * (1 - fx) * fy;
            v += samplePx(sd, W, H, x0 + 1, y0 + 1, ch) * fx * fy;
            dd[di + ch] = Math.round(v);
          }
        }
      }
      octx.putImageData(img, 0, 0);
      return out;
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
            img.onerror = function () {
              URL.revokeObjectURL(url);
              reject(new Error('图片已损坏或格式不支持'));
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

      /** 直接以画布载入为新文档（单图层）。 */
      loadCanvas: function (canvas) {
        if (!canvas || !canvas.width || !canvas.height) return false;
        setFreshImage(cloneCanvas(canvas));
        return true;
      },

      newSample: function () {
        setFreshImage(makeSampleCanvas());
        return editor;
      },

      // ----- 调节 / 曲线（作用于活动层） -----

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

      getAdjust: function () { return copyParams(params); },

      /** 把活动层的调节+曲线+滤镜（及待生效文字）烘焙进活动层画布并推撤销栈（一步）。 */
      commitAdjust: function () {
        if (!layers.length) return false;
        if (curLayer().kind === 'adj') return false; // 调整层无像素，不做烘焙提交
        var AJ = (typeof window !== 'undefined') ? window.MTAdjust : null;
        var hasAdj = !!(AJ && adjState && AJ.isActive(adjState));
        if (paramsIsIdentity(params) && !curveLuts && !texts.length && !activeFilter && !hasAdj && !lutActive(lutState)) { render(); return false; }
        beginDiscrete('提交调节');
        var L = curLayer();
        var out = bakeActiveLayer();
        if (texts.length) { drawTexts(out.getContext('2d'), texts, 1); texts = []; }
        setLayerCanvas(L, out);
        resetLayerEdits(L);
        pullActive();
        endDiscrete();
        return true;
      },

      /** 调节检查点：滑杆松手/曲线拖完/不透明度松手时调用。若活动层的调节、曲线、
       *  滤镜或不透明度与上个安定状态不同，把安定状态存入撤销栈。
       *  label = 这段连续操作的名字（历史标签），省略 = 「调节」。 */
      checkpointAdjust: function (label) {
        if (!layers.length || !lastSettled) return false;
        var sL = lastSettled.layers[lastSettled.activeIdx];
        var L = curLayer();
        var same = !!sL && lastSettled.activeIdx === activeIdx && sL.id === L.id;
        if (same) {
          for (var i = 0; i < PARAM_DEFS.length; i++) {
            var key = PARAM_DEFS[i][0];
            if (params[key] !== sL.params[key]) { same = false; break; }
          }
        }
        if (same) {
          for (var j = 0; j < CURVE_KEYS.length; j++) {
            var a = curvePts[CURVE_KEYS[j]], b = sL.curves[CURVE_KEYS[j]];
            if (a.length !== b.length) { same = false; break; }
            for (var k = 0; k < a.length; k++) {
              if (a[k][0] !== b[k][0] || a[k][1] !== b[k][1]) { same = false; break; }
            }
            if (!same) break;
          }
        }
        if (same && L.opacity !== sL.opacity) same = false;
        if (same && activeFilter !== (sL.filter || null)) same = false;
        if (same && JSON.stringify(filterParams || null) !== JSON.stringify(sL.filterParams || null)) same = false;
        if (same && JSON.stringify(adjState || null) !== JSON.stringify(sL.adj || null)) same = false;
        if (same && JSON.stringify(lutState || null) !== JSON.stringify(sL.lut || null)) same = false;
        if (same && JSON.stringify(L.style || null) !== JSON.stringify(sL.style || null)) same = false;
        if (same) return false;
        undoStack.push(lastSettled);
        undoLabels.push(curLabel);
        while (undoStack.length > HISTORY_MAX) { undoStack.shift(); undoLabels.shift(); }
        redoStack.length = 0;
        redoLabels.length = 0;
        if (label) curLabel = label;
        lastSettled = snapshotState();
        emitState();
        return true;
      },

      /** 重置活动层全部预览调节：参数归零 + 曲线恢复恒等（滤镜保留，与旧版一致）。 */
      resetAdjust: function () {
        params = freshParams();
        curvePts = freshCurvePoints();
        curveLuts = null;
        bindActive();
        render();
        return editor;
      },

      /** 部分更新活动层曲线：只替换传入的通道（rgb/r/g/b），点为 [x,y] 数组（0..255）。 */
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
          bindActive();
        }
        render();
        return editor;
      },

      getCurves: function () { return copyCurves(curvePts); },

      // ----- 滤镜（状态式，归属活动层；实现位于 filters.js） -----

      /** 滤镜：只记录活动层的当前滤镜 id，合成时由其管线应用一次。
       *  重复点击同一个滤镜不叠加；点另一个滤镜直接替换；撤销可退回上一个滤镜。 */
      applyFilter: function (name) {
        if (!layers.length) return false;
        var F = window.MTFilters;
        if (!F || typeof F.apply !== 'function') return false; // 不存在时静默跳过
        if (activeFilter === name) return true; // 已是该滤镜：不重复应用、不叠加
        beginDiscrete('滤镜');
        activeFilter = name;
        filterParams = null; // 换滤镜：参数回到新滤镜的默认值
        bindActive();
        endDiscrete();
        return true;
      },

      /** 取消活动层滤镜，回到无滤镜状态（同样可撤销）。 */
      clearFilter: function () {
        if (!layers.length || !activeFilter) return false;
        beginDiscrete('清除滤镜');
        activeFilter = null;
        filterParams = null;
        bindActive();
        endDiscrete();
        return true;
      },

      getFilter: function () { return activeFilter; },

      getFilterParams: function () { return copyJSON(filterParams); },

      /** 实时设置活动层滤镜及其参数（参数对话框拖动预览用）：只渲染、不入撤销栈；
       *  确认时由 checkpointAdjust 记一步，取消时用打开前的值调回来即可。 */
      setFilterLive: function (id, paramsObj) {
        if (!layers.length) return false;
        activeFilter = id || null;
        filterParams = paramsObj ? copyJSON(paramsObj) : null;
        bindActive();
        render();
        return true;
      },

      /** 实时替换活动层的高级调整状态（调节页滑杆用）：只渲染、不入撤销栈，
       *  松手时由 checkpointAdjust 记一步。传 null = 关闭全部调整。 */
      setAdj: function (adj) {
        if (!layers.length) return false;
        adjState = adj ? copyJSON(adj) : null;
        bindActive();
        render();
        return true;
      },

      getAdj: function () { return copyJSON(adjState); },

      // ----- LUT 调色（状态式，归属活动层；实现位于 lut.js，管线在 adj 之后、滤镜之前） -----

      getLut: function () { return copyJSON(lutState); },

      /** 点选一个 LUT（状态式：替换当前 LUT，一步可撤销；同 id+同 cube 再点不叠加）。 */
      applyLut: function (state) {
        if (!layers.length || !state || !state.id) return false;
        var next = copyJSON(state);
        if (typeof next.strength !== 'number') next.strength = 100;
        if (lutState && lutState.id === next.id && lutState.cube === next.cube &&
            lutState.strength === next.strength) return true;
        beginDiscrete('LUT 调色');
        lutState = next;
        bindActive();
        endDiscrete();
        return true;
      },

      clearLut: function () {
        if (!layers.length || !lutState) return false;
        beginDiscrete('清除 LUT');
        lutState = null;
        bindActive();
        endDiscrete();
        return true;
      },

      /** 实时设置 LUT（强度滑杆拖动/调色墙悬停预览用）：只渲染、不入撤销栈；
       *  松手时由 checkpointAdjust 记一步。 */
      setLutLive: function (state) {
        if (!layers.length) return false;
        lutState = state ? copyJSON(state) : null;
        bindActive();
        render();
        return true;
      },

      // ----- 图层样式（归属图层对象本身，合成时由 MTStyles 按形状生成；调整层不挂） -----

      /** 活动层的图层样式（深拷贝）；调整层/无图层返回 null。 */
      getLayerStyle: function () {
        var L = curLayer();
        return (L && L.kind !== 'adj') ? copyJSON(L.style) : null;
      },

      /** 实时替换活动层样式（样式对话框拖动预览用）：只渲染、不入撤销栈；
       *  确认时由 checkpointAdjust 记一步，取消时用打开前的值调回来即可。 */
      setLayerStyleLive: function (style) {
        var L = curLayer();
        if (!L || L.kind === 'adj') return false; // 调整层不挂样式（守卫）
        L.style = style ? copyJSON(style) : null;
        render();
        return true;
      },

      // ----- 图层 -----

      /** 图层元信息（自下而上），UI 渲染列表用。 */
      getLayers: function () { return layersMeta(); },

      getActiveLayerIndex: function () { return activeIdx; },

      /** 图层原始画布（只读：供 UI 画缩略图，勿修改）。按 id 找，找不到返回 null。 */
      getLayerCanvas: function (id) {
        for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return layers[i].canvas;
        return null;
      },

      /** 新建图层（插入到活动层上方并成为活动层）。
       *  canvas 省略 = 透明空层；给出则适配到文档尺寸。一步可撤销。 */
      addLayer: function (canvas, name) {
        if (!layers.length) return false;
        beginDiscrete('新建图层');
        var content = (canvas && canvas.width) ? fitToDoc(canvas) : makeCanvas(docW, docH);
        var L = makeLayer(content, name || null);
        layers.splice(activeIdx + 1, 0, L);
        activeIdx++;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 复制活动层（含其编辑状态），副本在原层上方并成为活动层。 */
      duplicateLayer: function () {
        if (!layers.length) return false;
        beginDiscrete('复制图层');
        var src = curLayer();
        var L = makeLayer(src.canvas ? cloneCanvas(src.canvas) : null, src.name + ' 副本', src.kind);
        if (src.mask) setLayerMask(L, cloneCanvas(src.mask));
        L.maskEnabled = src.maskEnabled;
        L.visible = src.visible; L.opacity = src.opacity; L.blendMode = src.blendMode;
        L.params = copyParams(src.params);
        L.curvePts = copyCurves(src.curvePts);
        L.curveLuts = combinedCurveLuts(L.curvePts);
        L.filter = src.filter;
        L.filterParams = copyJSON(src.filterParams);
        L.adj = copyJSON(src.adj);
        L.style = copyJSON(src.style);
        L.lut = copyJSON(src.lut);
        layers.splice(activeIdx + 1, 0, L);
        activeIdx++;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 删除活动层（至少保留一层）。 */
      deleteLayer: function () {
        if (layers.length <= 1) return false;
        beginDiscrete('删除图层');
        layers.splice(activeIdx, 1);
        if (activeIdx >= layers.length) activeIdx = layers.length - 1;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 活动层上移（dir=1）/下移（dir=-1）一层，活动层跟随移动。 */
      moveLayer: function (dir) {
        if (!layers.length) return false;
        var t = activeIdx + (dir > 0 ? 1 : -1);
        if (t < 0 || t >= layers.length) return false;
        beginDiscrete('移动图层');
        var tmp = layers[t];
        layers[t] = layers[activeIdx];
        layers[activeIdx] = tmp;
        activeIdx = t;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 切换活动层（选择本身不进撤销栈，与 Photoshop 一致）。 */
      setActiveLayer: function (idx) {
        if (idx < 0 || idx >= layers.length || idx === activeIdx) return false;
        activeIdx = idx;
        pullActive();
        render();
        lastSettled = snapshotState();
        return true;
      },

      /** 活动层不透明度（0..1，实时生效不入栈；松手后由 checkpointAdjust 记一步）。 */
      setLayerOpacity: function (v) {
        var L = curLayer();
        if (!L || typeof v !== 'number' || !isFinite(v)) return false;
        L.opacity = clamp(v, 0, 1);
        render();
        return true;
      },

      /** 活动层混合模式（一步可撤销）。 */
      setLayerBlendMode: function (mode) {
        var L = curLayer();
        if (!L || L.kind === 'adj') return false; // 调整层混合模式固定普通（PhotoCraft 主路径口径）
        if (BLEND_MODE_LIST.indexOf(mode) < 0) return false;
        if (L.blendMode === mode) return true;
        beginDiscrete('混合模式');
        L.blendMode = mode;
        endDiscrete();
        return true;
      },

      /** 活动层显隐（一步可撤销）。 */
      setLayerVisible: function (v) {
        var L = curLayer();
        if (!L) return false;
        v = !!v;
        if (L.visible === v) return true;
        beginDiscrete('图层显隐');
        L.visible = v;
        endDiscrete();
        return true;
      },

      /** 按索引设置某层显隐（UI 眼睛按钮用；一步可撤销）。 */
      setLayerVisibleAt: function (idx, v) {
        if (idx < 0 || idx >= layers.length) return false;
        v = !!v;
        if (layers[idx].visible === v) return true;
        beginDiscrete('图层显隐');
        layers[idx].visible = v;
        endDiscrete();
        return true;
      },

      /** 重命名活动层（一步可撤销）。 */
      renameLayer: function (name) {
        var L = curLayer();
        if (!L || typeof name !== 'string') return false;
        name = name.trim();
        if (!name || name === L.name) return false;
        beginDiscrete('重命名图层');
        L.name = name;
        endDiscrete();
        return true;
      },

      /** 向下合并：活动层与其下一层按当前外观合成成一层（继承下层名称与位置）。
       *  合成结果 = 两层单独成摞的合成（各层自己的管线/混合/不透明度都算在内），
       *  与合并前看到的画面一致；合并后编辑状态归零。 */
      mergeDown: function () {
        if (layers.length < 2 || activeIdx <= 0) return false;
        // 两层都是调整层时无像素可烘焙，拒绝；其余组合一律按「两层单独成摞的合成」
        // 所见即所得（调整层效果/蒙版都烘焙进结果像素，蒙版烘焙进 alpha）。
        if (layers[activeIdx].kind === 'adj' && layers[activeIdx - 1].kind === 'adj') return false;
        beginDiscrete('向下合并');
        bakeTextsIntoActive();
        var top = layers[activeIdx], bot = layers[activeIdx - 1];
        var merged = compositeStack([bot, top], docW, docH, false);
        var L = makeLayer(merged, bot.name);
        layers.splice(activeIdx - 1, 2, L);
        activeIdx--;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 拼合：全部可见层合成为一层（隐藏层按 Photoshop 惯例丢弃），文字覆盖层保留。 */
      flatten: function () {
        if (layers.length <= 1) return false;
        beginDiscrete('拼合图层');
        var vis = layers.filter(function (L) { return L.visible; });
        var out = vis.length ? compositeStack(vis, docW, docH, false) : makeCanvas(docW, docH);
        layers = [makeLayer(out, '背景')];
        activeIdx = 0;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 新建调整图层（插入到活动层上方并成为活动层）：无像素画布，携带自己的
       *  params/曲线/adj 状态，合成时作用于其下已合成结果。一步可撤销。 */
      addAdjustmentLayer: function (name) {
        if (!layers.length) return false;
        beginDiscrete('调整图层');
        var L = makeLayer(null, name || null, 'adj');
        layers.splice(activeIdx + 1, 0, L);
        activeIdx++;
        pullActive();
        endDiscrete();
        return true;
      },

      // ----- 图层蒙版（灰度：白=显示、黑=隐藏；作用对象 = 选中的蒙版层，否则活动层） -----

      /** 蒙版画布（只读，供 UI 画缩略图）。按 id 找，找不到/无蒙版返回 null。 */
      getLayerMaskCanvas: function (id) {
        for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return layers[i].mask;
        return null;
      },

      /** 选中某层的蒙版（UI 选中态；不进撤销栈）。传 null = 取消选中。 */
      setMaskTarget: function (id) {
        maskTargetId = id || null;
        render();
        return true;
      },

      getMaskTarget: function () { return maskTargetId; },

      /** 给活动层添加蒙版：mode = 'white' 全白 | 'black' 全黑 | 'selection' 从当前选区生成。
       *  一步可撤销；新蒙版自动成为选中蒙版。 */
      addLayerMask: function (mode) {
        var L = curLayer();
        if (!L) return false;
        var c;
        if (mode === 'black') c = makeMaskCanvas(false);
        else if (mode === 'selection') {
          if (!selMask || selCount === 0) return false;
          c = selCanvas();
          if (!c) return false;
        } else c = makeMaskCanvas(true);
        beginDiscrete('添加蒙版');
        setLayerMask(L, c);
        L.maskEnabled = true;
        maskTargetId = L.id;
        endDiscrete();
        return true;
      },

      /** 删除蒙版（作用对象见上；一步可撤销）。 */
      removeLayerMask: function () {
        var L = maskTargetLayer();
        if (!L || !L.mask) return false;
        beginDiscrete('删除蒙版');
        setLayerMask(L, null);
        if (maskTargetId === L.id) maskTargetId = null;
        endDiscrete();
        return true;
      },

      /** 启用/停用蒙版（停用 = 蒙版值恒为 1，PhotoCraft LayerMask.enabled 口径）。 */
      setLayerMaskEnabled: function (v) {
        var L = maskTargetLayer();
        if (!L || !L.mask) return false;
        v = !!v;
        if (L.maskEnabled === v) return true;
        beginDiscrete('蒙版启停');
        L.maskEnabled = v;
        endDiscrete();
        return true;
      },

      /** 反相蒙版（灰度逐点 255-v）。 */
      invertLayerMask: function () {
        var L = maskTargetLayer();
        if (!L || !L.mask) return false;
        beginDiscrete('反相蒙版');
        var c = cloneCanvas(L.mask);
        var x = c.getContext('2d', { willReadFrequently: true });
        var img = x.getImageData(0, 0, docW, docH), d = img.data;
        for (var i = 0; i < d.length; i += 4) { var nv = 255 - d[i]; d[i] = d[i + 1] = d[i + 2] = nv; }
        x.putImageData(img, 0, 0);
        setLayerMask(L, c);
        endDiscrete();
        return true;
      },

      // ----- 选区（编辑器级；算法在 selection.js，逐项翻译自 PhotoCraft） -----
      // 选区本身不进撤销栈；受选区约束的编辑（管线/删除/填充）照常可撤销。

      /** 是否有选区（覆盖度 >0 的像素数 >0）。 */
      selHas: function () { return !!(selMask && selCount > 0); },

      /** 选区掩膜副本（文档尺寸 Uint8Array），无选区返回 null。 */
      selGetMask: function () { return selMask ? selMask.slice() : null; },

      /** 选区掩膜在目标尺寸下的副本（蚂蚁线/UI 用）。 */
      selGetMaskAt: function (w, h) {
        var b = selBytesAt(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        return b ? b.slice() : null;
      },

      /** 直接设置选区掩膜（须为文档尺寸的 Uint8Array）；传 null/全零 = 取消选区。 */
      selSetMask: function (mask) {
        if (!layers.length) return false;
        if (!mask) { if (selMask) setSelMask(null); return true; }
        if (mask.length !== docW * docH) return false;
        setSelMask(mask.slice ? mask.slice() : mask);
        return true;
      },

      /** 矩形选区（整数像素，[x0,x1)×[y0,y1)，硬边）。 */
      selRect: function (x0, y0, x1, y1) {
        var S = selModule();
        if (!layers.length || !S) return false;
        setSelMask(S.rect(docW, docH, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)));
        return true;
      },

      /** 椭圆选区（内切于给定矩形，PhotoCraft ramp 抗锯齿）。 */
      selEllipse: function (x0, y0, x1, y1) {
        var S = selModule();
        if (!layers.length || !S) return false;
        setSelMask(S.ellipse(docW, docH, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)));
        return true;
      },

      /** 套索选区：points 为文档坐标 [[x,y],...]（自动闭合，even-odd + 子行抗锯齿）。 */
      selPolygon: function (points) {
        var S = selModule();
        if (!layers.length || !S || !points || points.length < 3) return false;
        setSelMask(S.polygon(docW, docH, points));
        return true;
      },

      /** 魔棒：以 (x,y) 处像素为种子（采样自全图合成，所见即所选），
       *  tolerance 0..255，contiguous = 只选连通区域。 */
      selWand: function (x, y, tolerance, contiguous) {
        var S = selModule();
        if (!layers.length || !S) return false;
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || y < 0 || x >= docW || y >= docH) return false;
        var comp = compositeStack(layers, docW, docH, false);
        var data = comp.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, docW, docH).data;
        setSelMask(S.wand(data, docW, docH, x, y,
          typeof tolerance === 'number' ? tolerance : 32, contiguous !== false));
        return true;
      },

      selAll: function () {
        var S = selModule();
        if (!layers.length || !S) return false;
        setSelMask(S.all(docW, docH));
        return true;
      },

      selNone: function () {
        if (!layers.length) return false;
        if (selMask) setSelMask(null);
        return true;
      },

      selInvert: function () {
        var S = selModule();
        if (!layers.length || !S) return false;
        // 无选区时反选 = 全选（Photoshop 口径：空选区取反为全部）
        setSelMask(selMask ? S.invert(selMask) : S.all(docW, docH));
        return true;
      },

      /** 羽化：高斯 σ=半径（PhotoCraft 口径）。 */
      selFeather: function (radius) {
        var S = selModule();
        if (!layers.length || !S || !selMask) return false;
        if (!(radius > 0)) return true;
        setSelMask(S.feather(selMask, docW, docH, radius));
        return true;
      },

      selExpand: function (px) {
        var S = selModule();
        if (!layers.length || !S || !selMask) return false;
        if (!(px > 0)) return true;
        setSelMask(S.expand(selMask, docW, docH, px));
        return true;
      },

      selContract: function (px) {
        var S = selModule();
        if (!layers.length || !S || !selMask) return false;
        if (!(px > 0)) return true;
        setSelMask(S.contract(selMask, docW, docH, px));
        return true;
      },

      /** 删除选区内容：活动层在选区内的像素按覆盖度变透明（一步可撤销）。 */
      selDeleteContent: function () {
        if (!layers.length || !selMask || selCount === 0) return false;
        if (curLayer().kind === 'adj') return false; // 调整层无像素内容可删
        beginDiscrete('删除选区内容');
        var L = curLayer();
        var c = cloneCanvas(L.canvas);
        var ctx = c.getContext('2d', { willReadFrequently: true });
        var img = ctx.getImageData(0, 0, docW, docH), dd = img.data;
        for (var i = 0, j = 0; i < selMask.length; i++, j += 4) {
          if (selMask[i]) dd[j + 3] = Math.round(dd[j + 3] * (1 - selMask[i] / 255));
        }
        ctx.putImageData(img, 0, 0);
        setLayerCanvas(L, c);
        endDiscrete();
        return true;
      },

      /** 填充颜色：把 (r,g,b) 以选区覆盖度 source-over 到活动层（一步可撤销）。 */
      selFill: function (r, g, b) {
        if (!layers.length || !selMask || selCount === 0) return false;
        if (curLayer().kind === 'adj') return false; // 调整层无像素可填充
        beginDiscrete('填充选区');
        var L = curLayer();
        var c = cloneCanvas(L.canvas);
        var ctx = c.getContext('2d', { willReadFrequently: true });
        var img = ctx.getImageData(0, 0, docW, docH), dd = img.data;
        for (var i = 0, j = 0; i < selMask.length; i++, j += 4) {
          var k = selMask[i] / 255;
          if (!k) continue;
          var ad = dd[j + 3] / 255, ao = k + ad * (1 - k);
          if (ao <= 0) { dd[j + 3] = 0; continue; }
          dd[j] = Math.round((r * k + dd[j] * ad * (1 - k)) / ao);
          dd[j + 1] = Math.round((g * k + dd[j + 1] * ad * (1 - k)) / ao);
          dd[j + 2] = Math.round((b * k + dd[j + 2] * ad * (1 - k)) / ao);
          dd[j + 3] = Math.round(ao * 255);
        }
        ctx.putImageData(img, 0, 0);
        setLayerCanvas(L, c);
        endDiscrete();
        return true;
      },

      // ----- 几何（逐层应用，保住图层结构） -----

      rotate90: function (dir) {
        if (!layers.length) return false;
        var cw = !(dir === -1 || dir === 'ccw' || dir === false);
        beginDiscrete('旋转');
        transformAll(function (c) { return rotateCanvas90(c, cw); }, docH, docW);
        return true;
      },

      flipH: function () {
        if (!layers.length) return false;
        beginDiscrete('水平翻转');
        transformAll(function (c) { return flipCanvas(c, true); }, docW, docH);
        return true;
      },

      flipV: function () {
        if (!layers.length) return false;
        beginDiscrete('垂直翻转');
        transformAll(function (c) { return flipCanvas(c, false); }, docW, docH);
        return true;
      },

      resizeTo: function (w, h) {
        if (!layers.length) return false;
        w = Math.max(1, Math.round(w));
        h = Math.max(1, Math.round(h));
        if (!isFinite(w) || !isFinite(h)) return false;
        // 护栏：超大尺寸会让浏览器直接崩溃，先拦下来
        if (w > 12000 || h > 12000 || w * h > 100000000) return false;
        beginDiscrete('修改尺寸');
        transformAll(function (c) { return resizeCanvasTo(c, w, h); }, w, h);
        return true;
      },

      cropTo: function (x, y, w, h) {
        if (!layers.length) return false;
        // 移植 Geometry.crop：与文档范围求交，空交集不动；同一矩形逐层裁
        var x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
        var x1 = Math.min(docW, Math.ceil(x + w)), y1 = Math.min(docH, Math.ceil(y + h));
        if (x1 - x0 <= 0 || y1 - y0 <= 0) return false;
        beginDiscrete('裁剪');
        var cw = x1 - x0, ch = y1 - y0;
        transformAll(function (c) { return cropCanvas(c, x0, y0, cw, ch); }, cw, ch);
        return true;
      },

      /** 透视矫正：quad 为原图坐标的四个角 [左上, 右上, 右下, 左下]，
       *  同一单应变换逐层应用，把四边形区域拉直成矩形。 */
      warpPerspective: function (quad) {
        if (!layers.length || !quad || quad.length !== 4) return false;
        function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
        var outW = Math.round(Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])));
        var outH = Math.round(Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2])));
        if (outW < 8 || outH < 8 || outW > 12000 || outH > 12000 || outW * outH > 100000000) return false;
        var Hm = solveHomography(
          [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }], quad);
        if (!Hm) return false;
        beginDiscrete('透视矫正');
        transformAll(function (c) { return warpCanvas(c, Hm, outW, outH); }, outW, outH);
        return true;
      },

      /** 自由变换预览：设置/清除变换四角（文档坐标 [左上,右上,右下,左下]），
       *  只重渲染预览、不进撤销栈；传 null 清除。 */
      setTransformPreview: function (quad) {
        tfQuad = (quad && quad.length === 4) ? quad.map(function (p) { return { x: +p.x, y: +p.y }; }) : null;
        render();
        return true;
      },

      /** 自由变换提交：把活动层的已生效像素按 quad 全分辨率变形（MTTransform，
       *  逆映射+预乘双线性，译自 PhotoCraft transform.rs），结果贴回文档尺寸画布
       *  （超出文档的部分裁掉——本引擎图层无偏移量，口径在此注明），蒙版跟随同一
       *  变形，活动层编辑状态归零。一步可撤销；调整层拒绝。 */
      transformLayer: function (quad) {
        if (!layers.length || !quad || quad.length !== 4) return false;
        var L = curLayer();
        if (!L || L.kind === 'adj') return false; // 调整层无像素可变换
        var TF = tfModule();
        if (!TF) return false;
        var src = bakeActiveLayer();
        if (!src) return false;
        var res = TF.warp(src, quad);
        if (!res) return false;
        var maskRes = L.mask ? TF.warp(L.mask, quad) : null;
        beginDiscrete('自由变换');
        var out = makeCanvas(docW, docH);
        out.getContext('2d').drawImage(res.canvas, res.offX, res.offY);
        setLayerCanvas(L, out);
        if (L.mask && maskRes) {
          var mc = makeCanvas(docW, docH);
          var mx = mc.getContext('2d');
          mx.fillStyle = '#000000'; // 变形范围外的蒙版 = 黑（隐藏）
          mx.fillRect(0, 0, docW, docH);
          mx.drawImage(maskRes.canvas, maskRes.offX, maskRes.offY);
          setLayerMask(L, mc);
        }
        resetLayerEdits(L);
        tfQuad = null;
        pullActive();
        endDiscrete();
        return true;
      },

      /** 把外部算好的画布应用到活动层（抠图结果回灌用）：替换活动层像素，
       *  活动层编辑状态归零（结果已包含它们），一步可撤销。 */
      applyCanvas: function (canvas, label) {
        if (!layers.length || !canvas || !canvas.width) return false;
        if (curLayer().kind === 'adj') return false; // 调整层无像素，抠图结果无处回灌
        beginDiscrete(label || '抠图');
        var L = curLayer();
        setLayerCanvas(L, fitToDoc(canvas));
        resetLayerEdits(L);
        pullActive();
        endDiscrete();
        return true;
      },

      // ----- 画笔 / 形状（像素级绘制，算法在 brush.js；一笔 = 一步撤销） -----

      /** 开始一笔：目标 = 选中的蒙版（有蒙版时），否则活动层像素（调整层返回 false）。
       *  整笔只入一次撤销栈；目标画布克隆后装回，后续绘制原地改这张克隆。 */
      beginPaint: function (label) {
        if (!layers.length || paintCtx) return null;
        var L = null, target = 'layer';
        if (maskTargetId != null) {
          for (var i = 0; i < layers.length; i++) {
            if (layers[i].id === maskTargetId && layers[i].mask) { L = layers[i]; target = 'mask'; break; }
          }
        }
        if (!L) {
          L = curLayer();
          if (!L) return null;
          if (L.kind === 'adj') return false; // 调整层无像素可画（其蒙版被选中时走上面分支）
        }
        beginDiscrete(label || '绘画');
        var c = cloneCanvas(target === 'mask' ? L.mask : L.canvas);
        if (target === 'mask') setLayerMask(L, c); else setLayerCanvas(L, c);
        paintCtx = { L: L, target: target };
        render();
        return { target: target, canvas: c, w: docW, h: docH };
      },

      /** 一笔进行中刷新：使该层的管线/预览缓存失效并重渲染。 */
      paintRefresh: function () {
        if (!paintCtx) return false;
        if (paintCtx.target === 'mask') setLayerMask(paintCtx.L, paintCtx.L.mask);
        else setLayerCanvas(paintCtx.L, paintCtx.L.canvas);
        render();
        return true;
      },

      /** 结束一笔：收尾（撤销栈里只有 beginPaint 入的那一步）。 */
      endPaint: function () {
        if (!paintCtx) return false;
        paintCtx = null;
        endDiscrete();
        return true;
      },

      /** 形状落笔：把 src（文档尺寸、透明底形状图）按选区覆盖 source-over 到活动层，
       *  一步可撤销（与 selFill 同一合成口径；不重置图层编辑状态）。 */
      stampCanvas: function (src, label) {
        if (!layers.length || !src || !src.width) return false;
        if (curLayer().kind === 'adj') return false; // 调整层无像素，形状无处落
        beginDiscrete(label || '形状');
        var L = curLayer();
        var c = cloneCanvas(L.canvas);
        var ctx = c.getContext('2d', { willReadFrequently: true });
        var img = ctx.getImageData(0, 0, docW, docH), dd = img.data;
        var sd = fitToDoc(src).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, docW, docH).data;
        var sel = (selMask && selCount > 0) ? selMask : null;
        for (var i = 0, j = 0; i < docW * docH; i++, j += 4) {
          var sa = sd[j + 3] / 255;
          if (!sa) continue;
          var k = sel ? sa * sel[i] / 255 : sa;
          if (!k) continue;
          var ad = dd[j + 3] / 255, ao = k + ad * (1 - k);
          if (ao <= 0) { dd[j + 3] = 0; continue; }
          dd[j] = Math.round((sd[j] * k + dd[j] * ad * (1 - k)) / ao);
          dd[j + 1] = Math.round((sd[j + 1] * k + dd[j + 1] * ad * (1 - k)) / ao);
          dd[j + 2] = Math.round((sd[j + 2] * k + dd[j + 2] * ad * (1 - k)) / ao);
          dd[j + 3] = Math.round(ao * 255);
        }
        ctx.putImageData(img, 0, 0);
        setLayerCanvas(L, c);
        endDiscrete();
        return true;
      },

      // ----- 复合操作事务（一句话修图 / 一键换背景共用）：beginOp..endOp 之间
      // 可混用状态修改与下面两个无撤销接口，整体只算一步撤销。 -----

      beginOp: function (label) { if (layers.length) beginDiscrete(label || '操作'); },
      endOp: function () { if (layers.length) endDiscrete(); },

      /** 用一份独立状态（{params 增量表, curves, adj, filter, filterParams}）处理任意画布，
       *  返回新画布（恒等时返回克隆）。区域调整「全图先按参数调整一份」用。 */
      applyStateToCanvas: function (canvas, spec) {
        if (!canvas) return null;
        spec = spec || {};
        var p = freshParams();
        if (spec.params) for (var i = 0; i < PARAM_DEFS.length; i++) {
          var k = PARAM_DEFS[i][0];
          if (typeof spec.params[k] === 'number') p[k] = clamp(spec.params[k], PARAM_DEFS[i][1], PARAM_DEFS[i][2]);
        }
        var luts = null;
        if (spec.curves) {
          var cp = freshCurvePoints();
          for (var ci = 0; ci < CURVE_KEYS.length; ci++) {
            var key = CURVE_KEYS[ci];
            if (spec.curves[key] != null) { var sp = sanitizePoints(spec.curves[key]); if (sp) cp[key] = sp; }
          }
          luts = combinedCurveLuts(cp);
        }
        var out = runPipeline(canvas, p, luts, spec.filter || null, spec.filterParams || null, spec.adj || null, spec.lut || null);
        return out === canvas ? cloneCanvas(canvas) : out;
      },

      /** 把画布装为活动层像素并清该层编辑状态（结果已包含它们）；不入撤销栈，
       *  须在 beginOp/endOp 之间调用。 */
      replaceActiveCanvas: function (canvas) {
        if (!layers.length || !canvas || curLayer().kind === 'adj') return false;
        var L = curLayer();
        setLayerCanvas(L, fitToDoc(canvas));
        resetLayerEdits(L);
        pullActive();
        render();
        return true;
      },

      /** 在活动层正下方插入一个像素层（成为背景用）；不入撤销栈，须在事务内调用。 */
      insertLayerBelowActive: function (canvas, name) {
        if (!layers.length || !canvas) return false;
        var L = makeLayer(fitToDoc(canvas), name || '背景');
        layers.splice(activeIdx, 0, L);
        activeIdx++;
        render();
        return true;
      },

      /** 当前完整效果的全分辨率画布（不改变任何状态）。 */
      renderFullCanvas: function () {
        if (!layers.length) return null;
        return bakeCurrent();
      },

      // ----- 工程文件（.meowtu：单 JSON 往返完整图层文档） -----

      /** 序列化当前文档为工程对象（纯 JSON 可序列化）：以快照为蓝本，
       *  每层像素与蒙版换成 PNG dataURL（无损），附拼合预览图。 */
      exportProject: function () {
        if (!layers.length) return null;
        var s = snapshotState();
        return {
          format: PROJECT_FORMAT, version: PROJECT_VERSION,
          docW: s.docW, docH: s.docH, activeIdx: s.activeIdx, texts: s.texts,
          layers: s.layers.map(function (sl) {
            return {
              id: sl.id, name: sl.name, kind: sl.kind,
              visible: sl.visible, opacity: sl.opacity, blendMode: sl.blendMode,
              maskEnabled: sl.maskEnabled,
              params: sl.params, curves: sl.curves, filter: sl.filter,
              filterParams: sl.filterParams, adj: sl.adj, style: sl.style, lut: sl.lut,
              image: sl.canvas ? sl.canvas.toDataURL('image/png') : null,
              mask: sl.mask ? sl.mask.toDataURL('image/png') : null
            };
          }),
          preview: projectThumb(bakeCurrent())
        };
      },

      /** 恢复工程对象：先全量校验 + 解码全部图片，成功后才以一步可撤销
       *  （标签「打开工程」）替换当前文档；任何失败都 reject 且不动当前文档。 */
      importProject: function (proj) {
        function bad(msg) { return Promise.reject(new Error(msg)); }
        if (!proj || typeof proj !== 'object') return bad('工程文件已损坏，无法打开');
        if (proj.format !== PROJECT_FORMAT) return bad('这不是喵图工程文件');
        if (proj.version !== PROJECT_VERSION) return bad('工程文件版本不受支持（版本 ' + proj.version + '）');
        if (!Array.isArray(proj.layers) || !proj.layers.length ||
            !(proj.docW > 0) || !(proj.docH > 0)) return bad('工程文件已损坏，无法打开');
        for (var i = 0; i < proj.layers.length; i++) {
          var pl = proj.layers[i];
          if (!pl || (pl.kind !== 'pixel' && pl.kind !== 'adj') ||
              (pl.kind === 'pixel' && typeof pl.image !== 'string') ||
              !pl.params || !pl.curves) return bad('工程文件已损坏，无法打开');
          for (var c = 0; c < CURVE_KEYS.length; c++) {
            if (!Array.isArray(pl.curves[CURVE_KEYS[c]])) return bad('工程文件已损坏，无法打开');
          }
        }
        var jobs = [];
        proj.layers.forEach(function (p) { jobs.push(decodeDataURL(p.image), decodeDataURL(p.mask)); });
        return Promise.all(jobs).then(function (cs) {
          var s = {
            docW: proj.docW, docH: proj.docH,
            activeIdx: typeof proj.activeIdx === 'number' ? proj.activeIdx : proj.layers.length - 1,
            texts: Array.isArray(proj.texts) ? proj.texts : [],
            layers: proj.layers.map(function (p, i) {
              return {
                id: p.id, name: p.name, kind: p.kind,
                canvas: cs[i * 2], mask: cs[i * 2 + 1], maskEnabled: p.maskEnabled,
                visible: p.visible !== false,
                opacity: typeof p.opacity === 'number' ? p.opacity : 1,
                blendMode: p.blendMode || 'normal',
                params: p.params, curves: p.curves, filter: p.filter || null,
                filterParams: p.filterParams || null, adj: p.adj || null, style: p.style || null,
                lut: p.lut || null
              };
            })
          };
          maskTargetId = null;
          tfQuad = null;
          beginDiscrete('打开工程');
          restoreState(s);
          return editor.getSize();
        });
      },

      // ----- 修图配方（.meowtu-recipe：只存各层编辑状态，不含像素） -----

      /** 导出配方：以快照为蓝本剥掉像素（canvas/蒙版不进配方），其余层状态字段与工程文件同构。 */
      exportRecipe: function () {
        if (!layers.length) return null;
        var s = snapshotState();
        return {
          format: RECIPE_FORMAT, version: RECIPE_VERSION,
          layers: s.layers.map(function (sl) {
            return {
              kind: sl.kind, visible: sl.visible, opacity: sl.opacity, blendMode: sl.blendMode,
              params: sl.params, curves: sl.curves, filter: sl.filter,
              filterParams: sl.filterParams, adj: sl.adj, style: sl.style, lut: sl.lut
            };
          })
        };
      },

      /** 套用配方：按层序把状态套到当前文档前 min(配方层数, 文档层数) 层，一步可撤销
       *  （标签「应用配方」）。层数不一致时多出的配方层被忽略，返回值告知实际套用数。
       *  格式不对直接抛中文错误且不动当前文档。 */
      applyRecipe: function (recipe) {
        if (!recipe || typeof recipe !== 'object') throw new Error('配方文件已损坏，无法打开');
        if (recipe.format !== RECIPE_FORMAT) throw new Error('这不是喵图配方文件');
        if (recipe.version !== RECIPE_VERSION) throw new Error('配方文件版本不受支持（版本 ' + recipe.version + '）');
        if (!Array.isArray(recipe.layers) || !recipe.layers.length) throw new Error('配方文件已损坏，无法打开');
        for (var v = 0; v < recipe.layers.length; v++) {
          var rl = recipe.layers[v];
          if (!rl || !rl.params || !rl.curves) throw new Error('配方文件已损坏，无法打开');
        }
        if (!layers.length) return { applied: 0, total: recipe.layers.length };
        beginDiscrete('应用配方');
        var n = Math.min(recipe.layers.length, layers.length);
        for (var i = 0; i < n; i++) {
          var sl = recipe.layers[i], L = layers[i];
          L.visible = sl.visible !== false;
          L.opacity = typeof sl.opacity === 'number' ? clamp(sl.opacity, 0, 1) : 1;
          L.blendMode = BLEND_MODE_LIST.indexOf(sl.blendMode) >= 0 ? sl.blendMode : 'normal';
          var p = freshParams();
          for (var d = 0; d < PARAM_DEFS.length; d++) {
            var key = PARAM_DEFS[d][0];
            if (typeof sl.params[key] === 'number') p[key] = clamp(sl.params[key], PARAM_DEFS[d][1], PARAM_DEFS[d][2]);
          }
          L.params = p;
          var cp = freshCurvePoints();
          for (var c = 0; c < CURVE_KEYS.length; c++) {
            var ck = CURVE_KEYS[c];
            if (sl.curves[ck] != null) { var sp = sanitizePoints(sl.curves[ck]); if (sp) cp[ck] = sp; }
          }
          L.curvePts = cp;
          L.curveLuts = combinedCurveLuts(cp);
          L.filter = sl.filter || null;
          L.filterParams = copyJSON(sl.filterParams);
          L.adj = copyJSON(sl.adj);
          L.lut = copyJSON(sl.lut);
          if (L.kind !== 'adj') L.style = copyJSON(sl.style);
        }
        pullActive();
        endDiscrete();
        return { applied: n, total: recipe.layers.length };
      },

      /** 活动层全分辨率「已生效」画布（抠图取输入用：只抠活动层）。 */
      renderActiveLayerCanvas: function () {
        if (!layers.length) return null;
        return bakeActiveLayer();
      },

      // ----- 文字（编辑器级覆盖层，过渡方案） -----

      setTexts: function (arr) {
        texts = Array.isArray(arr) ? copyTexts(arr) : [];
        render();
        return editor;
      },

      getTexts: function () { return copyTexts(texts); },

      /** 把文字栅格化到活动层（连同活动层待生效调节一并烘焙），随后清空文字列表。 */
      commitTexts: function () {
        if (!layers.length || !texts.length) return false;
        beginDiscrete('应用文字');
        bakeTextsIntoActive();
        endDiscrete();
        return true;
      },

      // ----- 历史 -----

      undo: function () {
        if (!undoStack.length) return false;
        redoStack.push(snapshotState());
        redoLabels.push(curLabel);
        curLabel = undoLabels.pop();
        restoreState(undoStack.pop());
        return true;
      },

      redo: function () {
        if (!redoStack.length) return false;
        undoStack.push(snapshotState());
        undoLabels.push(curLabel);
        while (undoStack.length > HISTORY_MAX) { undoStack.shift(); undoLabels.shift(); }
        curLabel = redoLabels.pop();
        restoreState(redoStack.pop());
        return true;
      },

      /** 历史面板数据（同状态事件里的 history 字段）。 */
      getHistory: function () { return historyInfo(); },

      /** 跳到历史第 idx 步（0 = 最旧的状态）：连 undo/redo 到位。
       *  在旧状态上做新操作会截断未来分支（beginDiscrete 清重做栈的既有语义）。 */
      historyGoTo: function (idx) {
        if (!layers.length || typeof idx !== 'number' || !isFinite(idx)) return false;
        idx = clamp(Math.round(idx), 0, undoStack.length + redoStack.length);
        var guard = 0;
        while (undoStack.length > idx && guard++ < 64) editor.undo();
        while (undoStack.length < idx && guard++ < 64) editor.redo();
        return undoStack.length === idx;
      },

      // ----- 导出 / 统计 / 状态 -----

      /** 全分辨率输出当前完整效果（全部图层合成 + 编辑器级文字）。 */
      exportBlob: function (options) {
        if (!layers.length) return Promise.reject(new Error('MT: no image loaded'));
        options = options || {};
        var typeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
        var type = typeMap[options.format || 'png'] || 'image/png';
        var quality = typeof options.quality === 'number' ? clamp(options.quality, 0, 1) : 0.92;
        var out;
        var single = layers.length === 1 ? layers[0] : null;
        if (single && single.kind === 'pixel' && !single.mask && single.visible && single.opacity === 1 && single.blendMode === 'normal') {
          // 单层快速路径：与旧版一致，恒等时直接用原画布
          out = runPipeline(single.canvas, single.params, single.curveLuts, single.filter, single.filterParams, single.adj, single.lut);
          if (out !== single.canvas && selMask && selCount > 0) constrainInPlace(out, single.canvas, docW, docH);
          if (texts.length) {
            if (out === single.canvas) out = cloneCanvas(single.canvas);
            drawTexts(out.getContext('2d'), texts, 1);
          }
        } else {
          out = bakeCurrent();
        }
        // 导出对话框的缩放（PhotoCraft Export As 的 size 口径）：等比缩放后的尺寸
        if (options.scaleTo && (options.scaleTo.w !== out.width || options.scaleTo.h !== out.height)) {
          var sc = makeCanvas(Math.max(1, Math.round(options.scaleTo.w)), Math.max(1, Math.round(options.scaleTo.h)));
          var sctx = sc.getContext('2d');
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(out, 0, 0, sc.width, sc.height);
          out = sc;
        }
        return new Promise(function (resolve, reject) {
          out.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('MT: export failed'));
          }, type, quality);
        });
      },

      /** 基于当前预览合成的直方图（移植 Histogram.compute 的步长与口径）。 */
      getHistogram: function () {
        function zeros() { return new Array(256).fill(0); }
        var result = { r: zeros(), g: zeros(), b: zeros(), l: zeros() };
        if (!layers.length || !previewCanvas) return result;
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
        return layers.length ? { w: docW, h: docH } : null;
      },

      hasImage: function () { return layers.length > 0; },

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

  window.MT = {
    createEditor: createEditor,
    blend: { list: BLEND_MODE_LIST.slice(), apply255: blendApply255 },
    project: { format: PROJECT_FORMAT, version: PROJECT_VERSION },
    recipe: { format: RECIPE_FORMAT, version: RECIPE_VERSION }
  };
})();
