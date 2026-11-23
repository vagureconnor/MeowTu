// 喵图 MeowTu 网页版滤镜模块
// 逐个移植自 Java 版 meowtu.filters.Filters（纯像素算法，零第三方库）。
// 对外契约：window.MTFilters = { list: [{id, name}], apply(imageData, id) }
// apply 在传入的 ImageData 上原地处理并返回它，alpha 通道保持不变。
// 说明：Java 版 apply 带 strength 参数并在最后与原图混合；网页契约无强度参数，
// 因此这里一律按全强度（s=1）移植，马赛克块大小也取 s=1 时的 24px。
(function () {
  'use strict';

  // ================= 通用小工具（对应 Java Filters 的工具方法） =================

  // 对应 Java：Filters.clamp255（截断后钳制）
  function clamp255(v) {
    v = v | 0; // 等价于 Java 的 (int) 截断（本模块入参均为非负或已处理符号的值域外钳制）
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  // 对应 Java：Filters.clampD（四舍五入并钳制到 0..255）
  function clampD(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : (v + 0.5) | 0);
  }

  // 对应 Java：Filters.mix
  function mix(a, b, t) {
    return clampD(a + (b - a) * t);
  }

  // 对应 Java：Filters.lum（整数除法明度）
  function lum(r, g, b) {
    return Math.floor((r * 299 + g * 587 + b * 114) / 1000);
  }

  // 对应 Java：Filters.sat（以明度为锚缩放饱和度）
  function sat(c, l, f) {
    return clampD(l + (c - l) * f);
  }

  // 对应 Java：Filters.dist2（归一化径向距离平方）
  function dist2(x, y, w, h) {
    var nx = (w <= 1) ? 0 : (x - (w - 1) / 2.0) / ((w - 1) / 2.0);
    var ny = (h <= 1) ? 0 : (y - (h - 1) / 2.0) / ((h - 1) / 2.0);
    return nx * nx + ny * ny;
  }

  // 对应 Java：Filters.noise（32 位整数哈希，必须用 imul 复刻 Java int 溢出语义）
  function noise(x, y, seed) {
    var n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 974711)) | 0;
    n = Math.imul(n ^ (n >> 13), 1274126177);
    n = n ^ (n >> 16);
    return ((n & 0xFFFF) / 32767.5) - 1.0;
  }

  // 对应 Java：Filters.applyVignette（原地修改通道）
  function applyVignette(ch, w, h, amount) {
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var d2 = dist2(x, y, w, h);
        var t = (d2 - 0.35) / 1.3;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        t = t * t * (3 - 2 * t); // smoothstep
        if (t <= 0) continue;
        var f = 1.0 - amount * t;
        var i = y * w + x;
        ch.r[i] = clampD(ch.r[i] * f);
        ch.g[i] = clampD(ch.g[i] * f);
        ch.b[i] = clampD(ch.b[i] * f);
      }
    }
  }

  // ================= 可分离高斯模糊（对应 Java 的盒式模糊三遍近似） =================

  // 对应 Java：Filters.clampIdx
  function clampIdx(i, size) {
    return i < 0 ? 0 : (i >= size ? size - 1 : i);
  }

  // 对应 Java：Filters.boxBlurH
  function boxBlurH(src, dst, w, h, r) {
    var diam = 2 * r + 1;
    for (var y = 0; y < h; y++) {
      var base = y * w;
      var sum = 0;
      for (var i = -r; i <= r; i++) sum += src[base + clampIdx(i, w)];
      for (var x = 0; x < w; x++) {
        dst[base + x] = sum / diam;
        sum += src[base + clampIdx(x + r + 1, w)] - src[base + clampIdx(x - r, w)];
      }
    }
  }

  // 对应 Java：Filters.boxBlurV
  function boxBlurV(src, dst, w, h, r) {
    var diam = 2 * r + 1;
    for (var x = 0; x < w; x++) {
      var sum = 0;
      for (var i = -r; i <= r; i++) sum += src[clampIdx(i, h) * w + x];
      for (var y = 0; y < h; y++) {
        dst[y * w + x] = sum / diam;
        sum += src[clampIdx(y + r + 1, h) * w + x] - src[clampIdx(y - r, h) * w + x];
      }
    }
  }

  // 对应 Java：Filters.gaussianBlur（单通道原地模糊，ch 为 Float32Array）
  function gaussianBlur(ch, w, h, sigma) {
    if (sigma < 0.4 || ch.length === 0) return;
    var tmp = new Float32Array(ch.length);
    var n = 3;
    var wl = Math.floor(Math.sqrt(12 * sigma * sigma / n + 1));
    if (wl % 2 === 0) wl -= 1;
    if (wl < 1) wl = 1;
    var wu = wl + 2;
    var mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    var m = Math.round(mIdeal);
    m = Math.max(0, Math.min(n, m));
    for (var i = 0; i < n; i++) {
      var size = (i < m) ? wl : wu;
      var r = (size - 1) / 2;
      if (r <= 0) continue;
      boxBlurH(ch, tmp, w, h, r);
      boxBlurV(tmp, ch, w, h, r);
    }
  }

  // 对应 Java：Filters.blurImage（三通道高斯模糊，返回新的通道组，值已 clampD）
  function blurChannels(ch, w, h, sigma) {
    var n = w * h;
    var fr = new Float32Array(n), fg = new Float32Array(n), fb = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      fr[i] = ch.r[i];
      fg[i] = ch.g[i];
      fb[i] = ch.b[i];
    }
    gaussianBlur(fr, w, h, sigma);
    gaussianBlur(fg, w, h, sigma);
    gaussianBlur(fb, w, h, sigma);
    var out = { r: new Uint8ClampedArray(n), g: new Uint8ClampedArray(n), b: new Uint8ClampedArray(n) };
    for (var j = 0; j < n; j++) {
      out.r[j] = clampD(fr[j]);
      out.g[j] = clampD(fg[j]);
      out.b[j] = clampD(fb[j]);
    }
    return out;
  }

  // 对应 Java：Filters.lumArray
  function lumArray(ch) {
    var n = ch.r.length;
    var out = new Int32Array(n);
    for (var i = 0; i < n; i++) out[i] = lum(ch.r[i], ch.g[i], ch.b[i]);
    return out;
  }

  // 对应 Java：Filters.lumAt（坐标钳制的明度采样）
  function lumAt(lm, w, h, x, y) {
    return lm[clampIdx(y, h) * w + clampIdx(x, w)];
  }

  function copyChannels(ch) {
    return {
      r: new Uint8ClampedArray(ch.r),
      g: new Uint8ClampedArray(ch.g),
      b: new Uint8ClampedArray(ch.b)
    };
  }

  // ================= 色调类滤镜（全强度版本） =================

  // 对应 Java：Filters.sepia（棕褐色调矩阵，就地改 rgb 数组）
  function sepia(rgb, t) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var sr = clamp255(Math.floor(0.393 * r + 0.769 * g + 0.189 * b));
    var sg = clamp255(Math.floor(0.349 * r + 0.686 * g + 0.168 * b));
    var sb = clamp255(Math.floor(0.272 * r + 0.534 * g + 0.131 * b));
    rgb[0] = mix(r, sr, t);
    rgb[1] = mix(g, sg, t);
    rgb[2] = mix(b, sb, t);
  }

  // 复古：棕褐色调 + 轻微褪色 + 暗角 —— 对应 Java 方法 Filters.vintage
  function fVintage(ch, w, h) {
    var out = copyChannels(ch);
    var c = [0, 0, 0];
    var n = w * h;
    for (var i = 0; i < n; i++) {
      c[0] = ch.r[i]; c[1] = ch.g[i]; c[2] = ch.b[i];
      sepia(c, 0.62);
      for (var k = 0; k < 3; k++) c[k] = clampD(c[k] * 0.93 + 9);
      out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2];
    }
    applyVignette(out, w, h, 0.38);
    return out;
  }

  // 老照片：强 sepia + 褪色 + 噪点 + 更重暗角 —— 对应 Java 方法 Filters.oldPhoto
  function fOldPhoto(ch, w, h) {
    var out = copyChannels(ch);
    var c = [0, 0, 0];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        c[0] = ch.r[i]; c[1] = ch.g[i]; c[2] = ch.b[i];
        sepia(c, 0.9);
        var nz = noise(x, y, 7) * 13;
        for (var k = 0; k < 3; k++) c[k] = clampD(c[k] * 0.82 + 16 + nz);
        out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2];
      }
    }
    applyVignette(out, w, h, 0.6);
    return out;
  }

  // 黑白：明度灰度 + 略提对比 —— 对应 Java 方法 Filters.blackWhite
  function fBlackWhite(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var v = lum(ch.r[i], ch.g[i], ch.b[i]);
      v = clampD((v - 128) * 1.18 + 128);
      out.r[i] = v; out.g[i] = v; out.b[i] = v;
    }
    return out;
  }

  // 褪色：降对比、抬黑位、降饱和 —— 对应 Java 方法 Filters.faded
  function fFaded(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = ch.r[i], g = ch.g[i], b = ch.b[i];
      var l = lum(r, g, b);
      r = sat(r, l, 0.62);
      g = sat(g, l, 0.62);
      b = sat(b, l, 0.62);
      out.r[i] = clampD(28 + r * 0.78);
      out.g[i] = clampD(28 + g * 0.78);
      out.b[i] = clampD(30 + b * 0.78);
    }
    return out;
  }

  // 日系：提亮、降对比、偏青蓝、柔和 —— 对应 Java 方法 Filters.japanese
  function fJapanese(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = ch.r[i], g = ch.g[i], b = ch.b[i];
      var l = lum(r, g, b);
      r = sat(r, l, 0.82);
      g = sat(g, l, 0.82);
      b = sat(b, l, 0.82);
      var t = l / 255.0;
      out.r[i] = clampD((r - 128) * 0.84 + 128 + 15 - 4);
      out.g[i] = clampD((g - 128) * 0.84 + 128 + 15 + 3);
      out.b[i] = clampD((b - 128) * 0.84 + 128 + 15 + 12 + (1 - t) * 8); // 阴影再添青蓝
    }
    return out;
  }

  // 青橙：阴影偏青、高光偏橙（分色调）+ 饱和提升 —— 对应 Java 方法 Filters.tealOrange
  function fTealOrange(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = ch.r[i], g = ch.g[i], b = ch.b[i];
      var l = lum(r, g, b);
      r = sat(r, l, 1.24);
      g = sat(g, l, 1.24);
      b = sat(b, l, 1.24);
      var t = l / 255.0;
      var sw = (1 - t) * (1 - t); // 阴影权重
      var hw = t * t;             // 高光权重
      out.r[i] = clampD((r - 128) * 1.05 + 128 - 9 * sw + 15 * hw);
      out.g[i] = clampD((g - 128) * 1.05 + 128 + 6 * sw + 4 * hw);
      out.b[i] = clampD((b - 128) * 1.05 + 128 + 17 * sw - 13 * hw);
    }
    return out;
  }

  // ================= 空间类滤镜 =================

  // 对应 Java：Filters.rectSum（积分图矩形和）
  function rectSum(integral, iw, x0, y0, x1, y1) {
    return integral[y1 * iw + x1] - integral[y0 * iw + x1]
         - integral[y1 * iw + x0] + integral[y0 * iw + x0];
  }

  // 积分图构建（Java 版按条带构建以省内存，结果等价，这里整图一次构建）
  function buildIntegral(vals, w, h) {
    var iw = w + 1;
    var I = new Float64Array(iw * (h + 1));
    for (var y = 0; y < h; y++) {
      var run = 0;
      var base = y * w, iBase = (y + 1) * iw, iUp = y * iw;
      for (var x = 0; x < w; x++) {
        run += vals[base + x];
        I[iBase + x + 1] = I[iUp + x + 1] + run;
      }
    }
    return I;
  }

  // 油画：Kuwahara 滤波（4 子区取方差最小者均值）—— 对应 Java 方法 Filters.oilPaint
  function fOilPaint(ch, w, h) {
    var n = w * h;
    var out = copyChannels(ch);
    var r = Math.max(3, Math.min(5, Math.floor(Math.min(w, h) / 250))); // 半径随图尺寸 3~5（Java 为整数除法）
    var iw = w + 1;
    var lm = lumArray(ch);
    var q = new Float64Array(n); // 明度平方，用于方差
    for (var i = 0; i < n; i++) q[i] = lm[i] * lm[i];
    var sR = buildIntegral(ch.r, w, h);
    var sG = buildIntegral(ch.g, w, h);
    var sB = buildIntegral(ch.b, w, h);
    var sQ = buildIntegral(q, w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var bestVar = Infinity;
        var br = 0, bg = 0, bb = 0;
        for (var qq = 0; qq < 4; qq++) {
          var qx0, qx1, qy0, qy1;
          if (qq === 0)      { qx0 = x - r; qx1 = x + 1;     qy0 = y - r; qy1 = y + 1; }
          else if (qq === 1) { qx0 = x;     qx1 = x + r + 1; qy0 = y - r; qy1 = y + 1; }
          else if (qq === 2) { qx0 = x - r; qx1 = x + 1;     qy0 = y;     qy1 = y + r + 1; }
          else               { qx0 = x;     qx1 = x + r + 1; qy0 = y;     qy1 = y + r + 1; }
          qx0 = Math.max(0, qx0);
          qx1 = Math.min(w, qx1);
          qy0 = Math.max(0, qy0);
          qy1 = Math.min(h, qy1);
          var sumR = rectSum(sR, iw, qx0, qy0, qx1, qy1);
          var sumG = rectSum(sG, iw, qx0, qy0, qx1, qy1);
          var sumB = rectSum(sB, iw, qx0, qy0, qx1, qy1);
          var sumQ = rectSum(sQ, iw, qx0, qy0, qx1, qy1);
          var cnt = (qx1 - qx0) * (qy1 - qy0);
          var meanL = (0.299 * sumR + 0.587 * sumG + 0.114 * sumB) / cnt;
          var variance = sumQ / cnt - meanL * meanL;
          if (variance < bestVar) {
            bestVar = variance;
            br = Math.floor(sumR / cnt + 0.5);
            bg = Math.floor(sumG / cnt + 0.5);
            bb = Math.floor(sumB / cnt + 0.5);
          }
        }
        var idx = y * w + x;
        out.r[idx] = br; out.g[idx] = bg; out.b[idx] = bb;
      }
    }
    return out;
  }

  // 对应 Java：Filters.sketchGray（灰度反相模糊后颜色减淡，返回 Float32Array）
  function sketchGray(ch, w, h) {
    var n = w * h;
    var gray = new Float32Array(n);
    var inv = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var g = lum(ch.r[i], ch.g[i], ch.b[i]);
      gray[i] = g;
      inv[i] = 255 - g;
    }
    var sigma = Math.max(2.5, Math.min(9.0, Math.min(w, h) / 110.0));
    gaussianBlur(inv, w, h, sigma);
    var out = new Float32Array(n);
    for (var j = 0; j < n; j++) {
      var denom = 255.0 - inv[j];
      var v = (denom <= 0.5) ? 255.0 : gray[j] * 255.0 / denom;
      out[j] = Math.min(255.0, v);
    }
    return out;
  }

  // 素描：铅笔线条（颜色减淡）—— 对应 Java 方法 Filters.sketch
  function fSketch(ch, w, h) {
    var s = sketchGray(ch, w, h);
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var v = clampD(s[i]);
      out.r[i] = v; out.g[i] = v; out.b[i] = v;
    }
    return out;
  }

  // 彩铅：素描与原色混合并增饱和 —— 对应 Java 方法 Filters.colorPencil
  function fColorPencil(ch, w, h) {
    var s = sketchGray(ch, w, h);
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = ch.r[i], g = ch.g[i], b = ch.b[i];
      var sv = clampD(s[i]);
      r = clampD(r * 0.55 + sv * 0.45);
      g = clampD(g * 0.55 + sv * 0.45);
      b = clampD(b * 0.55 + sv * 0.45);
      var l = lum(r, g, b);
      r = sat(r, l, 1.35);
      g = sat(g, l, 1.35);
      b = sat(b, l, 1.35);
      out.r[i] = clampD(r * 1.03);
      out.g[i] = clampD(g * 1.03);
      out.b[i] = clampD(b * 1.03);
    }
    return out;
  }

  // 浮雕：3x3 浮雕卷积核，灰度输出 —— 对应 Java 方法 Filters.emboss
  function fEmboss(ch, w, h) {
    var lm = lumArray(ch);
    var out = copyChannels(ch);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = -2 * lumAt(lm, w, h, x - 1, y - 1) - lumAt(lm, w, h, x, y - 1)
              - lumAt(lm, w, h, x - 1, y)
              + lumAt(lm, w, h, x, y)
              + lumAt(lm, w, h, x + 1, y)
              + lumAt(lm, w, h, x, y + 1) + 2 * lumAt(lm, w, h, x + 1, y + 1)
              + 128;
        var i = y * w + x;
        var vv = v < 0 ? 0 : (v > 255 ? 255 : v); // 对应 Java clamp255(int)
        out.r[i] = vv; out.g[i] = vv; out.b[i] = vv;
      }
    }
    return out;
  }

  // 马赛克：方块均值；Java 块大小随强度 4~24px，网页版固定全强度取 24 —— 对应 Java 方法 Filters.mosaic
  function fMosaic(ch, w, h) {
    var block = 24;
    var out = copyChannels(ch);
    for (var by = 0; by < h; by += block) {
      var y1 = Math.min(h, by + block);
      for (var bx = 0; bx < w; bx += block) {
        var x1 = Math.min(w, bx + block);
        var sr = 0, sg = 0, sb = 0, cnt = 0;
        for (var y = by; y < y1; y++) {
          for (var x = bx; x < x1; x++) {
            var p = y * w + x;
            sr += ch.r[p]; sg += ch.g[p]; sb += ch.b[p];
            cnt++;
          }
        }
        var ar = Math.floor(sr / cnt), ag = Math.floor(sg / cnt), ab = Math.floor(sb / cnt);
        for (var yy = by; yy < y1; yy++) {
          for (var xx = bx; xx < x1; xx++) {
            var i = yy * w + xx;
            out.r[i] = ar; out.g[i] = ag; out.b[i] = ab;
          }
        }
      }
    }
    return out;
  }

  // 对应 Java：Filters.posterize（色阶量化）
  function posterize(v, levels) {
    var step = 255.0 / (levels - 1);
    return clampD(Math.round(v / step) * step);
  }

  // 水彩：多次小半径平滑 + 色阶量化 + 边缘加深 + 饱和提升 —— 对应 Java 方法 Filters.watercolor
  function fWatercolor(ch, w, h) {
    var sm = blurChannels(blurChannels(ch, w, h, 1.6), w, h, 1.6);
    var lm = lumArray(ch);
    var out = copyChannels(ch);
    var levels = 14;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var r = sm.r[i], g = sm.g[i], b = sm.b[i];
        r = mix(r, posterize(r, levels), 0.55);
        g = mix(g, posterize(g, levels), 0.55);
        b = mix(b, posterize(b, levels), 0.55);
        var l = lum(r, g, b);
        r = sat(r, l, 1.3);
        g = sat(g, l, 1.3);
        b = sat(b, l, 1.3);
        // Sobel 边缘加深
        var gx = -lumAt(lm, w, h, x - 1, y - 1) - 2 * lumAt(lm, w, h, x - 1, y)
               - lumAt(lm, w, h, x - 1, y + 1)
               + lumAt(lm, w, h, x + 1, y - 1) + 2 * lumAt(lm, w, h, x + 1, y)
               + lumAt(lm, w, h, x + 1, y + 1);
        var gy = -lumAt(lm, w, h, x - 1, y - 1) - 2 * lumAt(lm, w, h, x, y - 1)
               - lumAt(lm, w, h, x + 1, y - 1)
               + lumAt(lm, w, h, x - 1, y + 1) + 2 * lumAt(lm, w, h, x, y + 1)
               + lumAt(lm, w, h, x + 1, y + 1);
        var e = Math.min(1.0, (Math.abs(gx) + Math.abs(gy)) / 765.0);
        var f = 1.0 - 0.45 * e;
        out.r[i] = clampD(r * f);
        out.g[i] = clampD(g * f);
        out.b[i] = clampD(b * f);
      }
    }
    return out;
  }

  // ================= 光效与伪彩类滤镜 =================

  // 梦幻柔光：模糊提亮后滤色（screen）混合 —— 对应 Java 方法 Filters.softGlow
  function fSoftGlow(ch, w, h) {
    var sigma = Math.max(3.0, Math.min(10.0, Math.min(w, h) / 90.0));
    var bl = blurChannels(ch, w, h, sigma);
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = ch.r[i], g = ch.g[i], b = ch.b[i];
      var gr = clampD(bl.r[i] * 1.28 + 10);
      var gg = clampD(bl.g[i] * 1.28 + 10);
      var gb = clampD(bl.b[i] * 1.28 + 10);
      // screen 混合（除法对应 Java 整数除法）后与原图按 0.75 混合，避免过曝
      var sr = 255 - Math.floor((255 - r) * (255 - gr) / 255);
      var sg = 255 - Math.floor((255 - g) * (255 - gg) / 255);
      var sb = 255 - Math.floor((255 - b) * (255 - gb) / 255);
      out.r[i] = mix(r, sr, 0.75);
      out.g[i] = mix(g, sg, 0.75);
      out.b[i] = mix(b, sb, 0.75);
    }
    return out;
  }

  // 光晕：强模糊加色混合，中心更亮 —— 对应 Java 方法 Filters.halo
  function fHalo(ch, w, h) {
    var sigma = Math.max(8.0, Math.min(26.0, Math.min(w, h) / 45.0));
    var bl = blurChannels(ch, w, h, sigma);
    var out = copyChannels(ch);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var cf = 1.0 + 0.22 * Math.max(0.0, 1.0 - dist2(x, y, w, h) / 1.2);
        var r = clampD(ch.r[i] + bl.r[i] * 0.55);
        var g = clampD(ch.g[i] + bl.g[i] * 0.55);
        var b = clampD(ch.b[i] + bl.b[i] * 0.55);
        out.r[i] = clampD(r * cf);
        out.g[i] = clampD(g * cf);
        out.b[i] = clampD(b * cf);
      }
    }
    return out;
  }

  // X光：反相 + 偏蓝青 + 提对比 —— 对应 Java 方法 Filters.xray
  function fXray(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = clampD((255 - ch.r[i] - 128) * 1.3 + 128);
      var g = clampD((255 - ch.g[i] - 128) * 1.3 + 128);
      var b = clampD((255 - ch.b[i] - 128) * 1.3 + 128);
      out.r[i] = clampD(r * 0.70);
      out.g[i] = clampD(g * 0.92);
      out.b[i] = clampD(b * 1.05);
    }
    return out;
  }

  // 红外：通道重排近似（植被发红发白、天空变暗）—— 对应 Java 方法 Filters.infrared
  function fInfrared(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var r = ch.r[i], g = ch.g[i], b = ch.b[i];
      var nr = g;
      var ng = clampD(b * 0.6 + r * 0.4);
      var nb = r;
      // 植被（绿色占优）额外提红提亮，近似红外胶片效果
      var veg = Math.max(0.0, Math.min(1.0, (g - Math.max(r, b)) / 96.0));
      nr = clampD(nr + veg * 55);
      ng = clampD(ng + veg * 22);
      nb = clampD(nb - veg * 12);
      nr = clampD((nr - 128) * 1.08 + 128);
      ng = clampD((ng - 128) * 1.08 + 128);
      nb = clampD((nb - 128) * 1.08 + 128);
      var l = lum(nr, ng, nb);
      out.r[i] = sat(nr, l, 1.15);
      out.g[i] = sat(ng, l, 1.15);
      out.b[i] = sat(nb, l, 1.15);
    }
    return out;
  }

  // 热力伪彩色映射表：黑→紫→红→橙→黄→白（对应 Java Filters.THERMAL_POS / THERMAL_RGB）
  var THERMAL_POS = [0.0, 0.16, 0.32, 0.48, 0.63, 0.78, 0.90, 1.0];
  var THERMAL_RGB = [
    [0, 0, 0], [40, 0, 90], [120, 0, 160], [215, 25, 45],
    [255, 110, 0], [255, 185, 10], [255, 245, 90], [255, 255, 255]
  ];

  // 热力：按明度映射伪彩色 —— 对应 Java 方法 Filters.thermal
  function fThermal(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var t = lum(ch.r[i], ch.g[i], ch.b[i]) / 255.0;
      var seg = 0;
      while (seg < THERMAL_POS.length - 2 && t > THERMAL_POS[seg + 1]) seg++;
      var f = (t - THERMAL_POS[seg]) / (THERMAL_POS[seg + 1] - THERMAL_POS[seg]);
      out.r[i] = clampD(THERMAL_RGB[seg][0] + (THERMAL_RGB[seg + 1][0] - THERMAL_RGB[seg][0]) * f);
      out.g[i] = clampD(THERMAL_RGB[seg][1] + (THERMAL_RGB[seg + 1][1] - THERMAL_RGB[seg][1]) * f);
      out.b[i] = clampD(THERMAL_RGB[seg][2] + (THERMAL_RGB[seg + 1][2] - THERMAL_RGB[seg][2]) * f);
    }
    return out;
  }

  // 夜视：绿色单色 + 提亮暗部 + 噪点 + 暗角 —— 对应 Java 方法 Filters.nightVision
  function fNightVision(ch, w, h) {
    var out = copyChannels(ch);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var l = lum(ch.r[i], ch.g[i], ch.b[i]);
        var gl = Math.pow(l / 255.0, 0.62); // gamma 提亮暗部
        var v = clampD(gl * 255 * 1.12 + noise(x, y, 21) * 9);
        out.r[i] = clampD(v * 0.22);
        out.g[i] = v;
        out.b[i] = clampD(v * 0.28);
      }
    }
    applyVignette(out, w, h, 0.55);
    return out;
  }

  // ================= 对外契约 =================

  // 顺序与中文名与 Java 版 Filters.all()（FiltersPanel 遍历顺序）完全一致
  var LIST = [
    { id: 'vintage',     name: '复古' },
    { id: 'oldphoto',    name: '老照片' },
    { id: 'bw',          name: '黑白' },
    { id: 'faded',       name: '褪色' },
    { id: 'japanese',    name: '日系' },
    { id: 'tealorange',  name: '青橙' },
    { id: 'oilpaint',    name: '油画' },
    { id: 'sketch',      name: '素描' },
    { id: 'colorpencil', name: '彩铅' },
    { id: 'emboss',      name: '浮雕' },
    { id: 'mosaic',      name: '马赛克' },
    { id: 'watercolor',  name: '水彩' },
    { id: 'softglow',    name: '梦幻柔光' },
    { id: 'halo',        name: '光晕' },
    { id: 'xray',        name: 'X光' },
    { id: 'infrared',    name: '红外' },
    { id: 'thermal',     name: '热力' },
    { id: 'nightvision', name: '夜视' }
  ];

  var IMPL = {
    vintage: fVintage,
    oldphoto: fOldPhoto,
    bw: fBlackWhite,
    faded: fFaded,
    japanese: fJapanese,
    tealorange: fTealOrange,
    oilpaint: fOilPaint,
    sketch: fSketch,
    colorpencil: fColorPencil,
    emboss: fEmboss,
    mosaic: fMosaic,
    watercolor: fWatercolor,
    softglow: fSoftGlow,
    halo: fHalo,
    xray: fXray,
    infrared: fInfrared,
    thermal: fThermal,
    nightvision: fNightVision
  };

  // 在传入的 ImageData 上原地应用滤镜并返回它；未知 id 原样返回（与 Java 版一致）
  function apply(imageData, id) {
    var fn = IMPL[id];
    if (!fn || !imageData || !imageData.data) return imageData;
    var w = imageData.width, h = imageData.height, data = imageData.data;
    var n = w * h;
    var ch = {
      r: new Uint8ClampedArray(n),
      g: new Uint8ClampedArray(n),
      b: new Uint8ClampedArray(n)
    };
    for (var i = 0; i < n; i++) {
      ch.r[i] = data[i * 4];
      ch.g[i] = data[i * 4 + 1];
      ch.b[i] = data[i * 4 + 2];
    }
    var out = fn(ch, w, h);
    for (var j = 0; j < n; j++) {
      data[j * 4] = out.r[j];
      data[j * 4 + 1] = out.g[j];
      data[j * 4 + 2] = out.b[j];
      // alpha（data[j*4+3]）保持不变，对应 Java 版保留原图 alpha
    }
    return imageData;
  }

  var root = (typeof window !== 'undefined') ? window : globalThis;
  root.MTFilters = { list: LIST, apply: apply };
})();
