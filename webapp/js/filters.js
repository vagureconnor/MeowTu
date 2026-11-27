// 喵图 MeowTu 网页版滤镜模块
// 逐个移植自 Java 版 meowtu.filters.Filters（纯像素算法，零第三方库）。
// 对外契约：window.MTFilters = { list: [{id, name, params?}], apply(imageData, id, params?) }
// apply 在传入的 ImageData 上原地处理并返回它，alpha 通道保持不变。
// 第二批参数化滤镜通过 list 条目的 params 元数据 [{key, name, min, max, def, step}]
// 声明可调参数；apply 不传 params 时全部取默认值，旧的两参调用行为不变。
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

  // ================= 参数化滤镜（第二批，网页版新增） =================
  // 统一签名 fn(ch, w, h, p)：p 为按 PARAM_DEFS 合并默认值并钳制后的参数对象。
  // 契约扩展：apply(imageData, id, params)；不传 params 时全部取默认值，旧调用行为不变。

  // 参数元数据：{key, name, min, max, def, step}，供 UI 自动生成滑杆。
  // 范围/默认值对齐 PhotoCraft 的滤镜命令规格（crates/engine-core/src/filters.rs 的 specs()）：
  // 高斯 radius 0.1..1000=1、动感 angle -360..360=0 / distance 1..2000=10、径向 amount 1..100=10、
  // 表面 radius 1..100=5 / threshold 2..255=15、USM amount 1..500=50 / radius 0.1..1000=1、
  // 旋转 angle -999..999=50、球面化 amount -100..100=100、加噪 amount 0.1..400=12.5。
  // 例外：动感 distance 下限保留 0（=恒等，PhotoCraft 为 1）；中值半径上限 2（本实现直方图窗口的上限，
  // PhotoCraft 为 500）；波浪/波纹/风吹/云彩/光晕 PhotoCraft 无同口径参数模型，维持原定义。
  var PARAM_DEFS = {
    gaussianBlur: [
      { key: 'radius', name: '半径', min: 0.1, max: 1000, def: 1, step: 0.1 }
    ],
    motionBlur: [
      { key: 'distance', name: '距离', min: 0, max: 2000, def: 10, step: 1 },
      { key: 'angle', name: '角度', min: -360, max: 360, def: 0, step: 1 }
    ],
    radialBlur: [
      { key: 'amount', name: '数量', min: 1, max: 100, def: 10, step: 1 }
    ],
    surfaceBlur: [
      { key: 'radius', name: '半径', min: 1, max: 100, def: 5, step: 1 },
      { key: 'threshold', name: '阈值', min: 2, max: 255, def: 15, step: 1 }
    ],
    usmSharpen: [
      { key: 'amount', name: '数量', min: 1, max: 500, def: 50, step: 1 },
      { key: 'radius', name: '半径', min: 0.1, max: 1000, def: 1, step: 0.1 },
      { key: 'threshold', name: '阈值', min: 0, max: 255, def: 0, step: 1 }
    ],
    medianDenoise: [
      { key: 'radius', name: '半径', min: 1, max: 2, def: 1, step: 1 }
    ],
    twirl: [
      { key: 'angle', name: '角度', min: -999, max: 999, def: 50, step: 1 }
    ],
    wave: [
      { key: 'amplitude', name: '振幅', min: 0, max: 50, def: 10, step: 0.5 },
      { key: 'wavelength', name: '波长', min: 8, max: 400, def: 80, step: 1 }
    ],
    ripple: [
      { key: 'amount', name: '数量', min: 0, max: 50, def: 12, step: 0.5 }
    ],
    spherize: [
      { key: 'amount', name: '数量', min: -100, max: 100, def: 100, step: 1 }
    ],
    addNoise: [
      { key: 'amount', name: '数量', min: 0.1, max: 400, def: 12.5, step: 0.5 },
      { key: 'monochrome', name: '单色', min: 0, max: 1, def: 1, step: 1 }
    ],
    wind: [
      { key: 'direction', name: '方向', min: 0, max: 1, def: 0, step: 1 },
      { key: 'strength', name: '强度', min: 1, max: 100, def: 40, step: 1 }
    ],
    clouds: [
      { key: 'scale', name: '尺度', min: 4, max: 200, def: 60, step: 1 },
      { key: 'contrast', name: '对比', min: 0, max: 100, def: 50, step: 1 }
    ],
    lensFlare: [
      { key: 'brightness', name: '亮度', min: 0, max: 200, def: 100, step: 1 },
      { key: 'posX', name: '位置X', min: 0, max: 100, def: 50, step: 1 },
      { key: 'posY', name: '位置Y', min: 0, max: 100, def: 50, step: 1 }
    ],
    gradientMap: [
      { key: 'map', name: '映射', min: 0, max: 3, def: 0, step: 1 }
    ],
    // 色调分离/阈值的范围与默认值对齐 PhotoCraft 调整参数（engine-core/src/adjust_params.rs：
    // posterize levels 2..255=4、threshold level 1..255=128）
    posterize: [
      { key: 'levels', name: '色阶', min: 2, max: 255, def: 4, step: 1 }
    ],
    threshold: [
      { key: 'level', name: '阈值', min: 1, max: 255, def: 128, step: 1 }
    ]
    // invert / levelsAuto 无参数
  };

  // 合并参数：传入值优先（须为有限数），缺失取 def，最后钳制到 [min, max]
  function resolveParams(id, params) {
    var defs = PARAM_DEFS[id];
    if (!defs) return null;
    var p = {};
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var v = (params && typeof params[d.key] === 'number' && isFinite(params[d.key]))
        ? params[d.key] : d.def;
      if (v < d.min) v = d.min;
      if (v > d.max) v = d.max;
      p[d.key] = v;
    }
    return p;
  }

  // ---- 通用：双线性采样 + 几何变形 ----

  // 单通道双线性采样（坐标钳制到图内），返回浮点值
  function sampleCh(arr, w, h, fx, fy) {
    if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
    if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var x1 = (x0 + 1 < w) ? x0 + 1 : w - 1;
    var y1 = (y0 + 1 < h) ? y0 + 1 : h - 1;
    var tx = fx - x0, ty = fy - y0;
    var i00 = y0 * w + x0, i10 = y0 * w + x1, i01 = y1 * w + x0, i11 = y1 * w + x1;
    var top = arr[i00] + (arr[i10] - arr[i00]) * tx;
    var bot = arr[i01] + (arr[i11] - arr[i01]) * tx;
    return top + (bot - top) * ty;
  }

  var _sp = [0, 0]; // warp 采样点复用缓冲，避免逐像素分配

  // 几何变形：fn(x, y, _sp) 写入该输出像素的源采样坐标（逆映射）
  function warpChannels(ch, w, h, fn) {
    var n = w * h;
    var out = {
      r: new Uint8ClampedArray(n),
      g: new Uint8ClampedArray(n),
      b: new Uint8ClampedArray(n)
    };
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        fn(x, y, _sp);
        out.r[i] = clampD(sampleCh(ch.r, w, h, _sp[0], _sp[1]));
        out.g[i] = clampD(sampleCh(ch.g, w, h, _sp[0], _sp[1]));
        out.b[i] = clampD(sampleCh(ch.b, w, h, _sp[0], _sp[1]));
      }
    }
    return out;
  }

  // ================= 模糊家族 =================

  // 高斯模糊：复用三遍 box blur 近似的 blurChannels（O(n)，与半径无关）
  function fGaussianBlur(ch, w, h, p) {
    return blurChannels(ch, w, h, p.radius);
  }

  // 动感模糊：沿 angle 方向在 [-distance/2, +distance/2] 上等距采样求均值
  function fMotionBlur(ch, w, h, p) {
    var dist = Math.round(p.distance);
    if (dist <= 0) return copyChannels(ch);
    var n = w * h;
    var out = {
      r: new Uint8ClampedArray(n),
      g: new Uint8ClampedArray(n),
      b: new Uint8ClampedArray(n)
    };
    var rad = p.angle * Math.PI / 180;
    var dx = Math.cos(rad), dy = Math.sin(rad);
    // 步长 1px，共 steps+1 个采样点；距离超过 48 时改等距抽样（仍覆盖全程，
    // 均值结果近似不变），避免 distance 拉到 2000 时采样数爆炸
    var steps = Math.min(dist, 48);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var sr = 0, sg = 0, sb = 0;
        for (var t = 0; t <= steps; t++) {
          var f = (t / steps - 0.5) * dist;
          var sx = x + dx * f, sy = y + dy * f;
          sr += sampleCh(ch.r, w, h, sx, sy);
          sg += sampleCh(ch.g, w, h, sx, sy);
          sb += sampleCh(ch.b, w, h, sx, sy);
        }
        var cnt = steps + 1;
        out.r[i] = clampD(sr / cnt);
        out.g[i] = clampD(sg / cnt);
        out.b[i] = clampD(sb / cnt);
      }
    }
    return out;
  }

  // 径向模糊（旋转式）：绕中心在 [-amount/2, +amount/2] 度弧线上采样求均值
  function fRadialBlur(ch, w, h, p) {
    var n = w * h;
    var out = {
      r: new Uint8ClampedArray(n),
      g: new Uint8ClampedArray(n),
      b: new Uint8ClampedArray(n)
    };
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var K = 12;
    var total = p.amount * Math.PI / 180;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var px = x - cx, py = y - cy;
        var sr = 0, sg = 0, sb = 0;
        for (var k = 0; k < K; k++) {
          var ang = total * (k / (K - 1) - 0.5);
          var cs = Math.cos(ang), sn = Math.sin(ang);
          var sx = cx + px * cs - py * sn;
          var sy = cy + px * sn + py * cs;
          sr += sampleCh(ch.r, w, h, sx, sy);
          sg += sampleCh(ch.g, w, h, sx, sy);
          sb += sampleCh(ch.b, w, h, sx, sy);
        }
        out.r[i] = clampD(sr / K);
        out.g[i] = clampD(sg / K);
        out.b[i] = clampD(sb / K);
      }
    }
    return out;
  }

  // 表面模糊（保边）：可分离双边近似——先横后纵各做一遍一维双边，
  // 权重由明度差决定（联合双边，三通道共用权重避免彩边）
  function fSurfaceBlur(ch, w, h, p) {
    var n = w * h;
    var r = Math.max(1, Math.round(p.radius));
    var T = Math.max(1, p.threshold);
    var srcR = new Float32Array(n), srcG = new Float32Array(n), srcB = new Float32Array(n);
    var lumA = new Float32Array(n);
    for (var i0 = 0; i0 < n; i0++) {
      srcR[i0] = ch.r[i0]; srcG[i0] = ch.g[i0]; srcB[i0] = ch.b[i0];
      lumA[i0] = (ch.r[i0] * 299 + ch.g[i0] * 587 + ch.b[i0] * 114) / 1000;
    }
    var tmpR = new Float32Array(n), tmpG = new Float32Array(n), tmpB = new Float32Array(n);
    var tmpL = new Float32Array(n);
    var x, y, i, j, d, wt;
    // 横向一维双边
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var c = lumA[i];
        var ws = 0, sr = 0, sg = 0, sb = 0;
        for (var dx = -r; dx <= r; dx++) {
          j = y * w + clampIdx(x + dx, w);
          d = Math.abs(lumA[j] - c);
          if (d >= T) continue;
          wt = 1 - d / T;
          ws += wt;
          sr += srcR[j] * wt; sg += srcG[j] * wt; sb += srcB[j] * wt;
        }
        tmpR[i] = sr / ws; tmpG[i] = sg / ws; tmpB[i] = sb / ws;
        tmpL[i] = (tmpR[i] * 299 + tmpG[i] * 587 + tmpB[i] * 114) / 1000;
      }
    }
    // 纵向一维双边（输入为横向结果）
    var out = {
      r: new Uint8ClampedArray(n),
      g: new Uint8ClampedArray(n),
      b: new Uint8ClampedArray(n)
    };
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var c2 = tmpL[i];
        var ws2 = 0, sr2 = 0, sg2 = 0, sb2 = 0;
        for (var dy = -r; dy <= r; dy++) {
          j = clampIdx(y + dy, h) * w + x;
          d = Math.abs(tmpL[j] - c2);
          if (d >= T) continue;
          wt = 1 - d / T;
          ws2 += wt;
          sr2 += tmpR[j] * wt; sg2 += tmpG[j] * wt; sb2 += tmpB[j] * wt;
        }
        out.r[i] = clampD(sr2 / ws2);
        out.g[i] = clampD(sg2 / ws2);
        out.b[i] = clampD(sb2 / ws2);
      }
    }
    return out;
  }

  // ================= 锐化 / 降噪 =================

  // USM 锐化：out = 原图 + (原图 - 高斯模糊) × amount%，差值小于 threshold 的像素不动
  function fUsmSharpen(ch, w, h, p) {
    var bl = blurChannels(ch, w, h, p.radius);
    var k = p.amount / 100;
    var th = p.threshold;
    var out = copyChannels(ch);
    var n = w * h;
    var chans = ['r', 'g', 'b'];
    for (var i = 0; i < n; i++) {
      for (var c = 0; c < 3; c++) {
        var key = chans[c];
        var diff = ch[key][i] - bl[key][i];
        if (Math.abs(diff) > th) out[key][i] = clampD(ch[key][i] + diff * k);
      }
    }
    return out;
  }

  // 单通道滑动窗口中值：256 档直方图 + 增量中位数维护，
  // 每步只增删一列/一行（O(k)），不逐像素排序
  function medianChannel(src, w, h, r) {
    var out = new Uint8ClampedArray(w * h);
    var k = 2 * r + 1;
    var area = k * k;
    var medIdx = (area - 1) >> 1;
    var hist = new Int32Array(256);
    var med = 0, cntLess = 0, cntEq = 0;

    function rebalance() {
      while (cntLess > medIdx) {
        med--;
        cntEq = hist[med];
        cntLess -= cntEq;
      }
      while (cntLess + cntEq <= medIdx) {
        cntLess += cntEq;
        med++;
        cntEq = hist[med];
      }
    }
    function addVal(v) {
      hist[v]++;
      if (v < med) cntLess++;
      else if (v === med) cntEq++;
      rebalance();
    }
    function removeVal(v) {
      hist[v]--;
      if (v < med) cntLess--;
      else if (v === med) cntEq--;
      rebalance();
    }
    // 在 (x0, y0) 处整窗重建直方图并定位中位数（每行行首调用一次）
    function buildWindow(x0, y0) {
      hist.fill(0);
      for (var dy = -r; dy <= r; dy++) {
        var rowBase = clampIdx(y0 + dy, h) * w;
        for (var dx = -r; dx <= r; dx++) {
          hist[src[rowBase + clampIdx(x0 + dx, w)]]++;
        }
      }
      var acc = 0;
      med = 0;
      while (acc + hist[med] <= medIdx) { acc += hist[med]; med++; }
      cntLess = acc;
      cntEq = hist[med];
    }

    for (var y = 0; y < h; y++) {
      buildWindow(0, y);
      out[y * w] = med;
      for (var x = 1; x < w; x++) {
        for (var dy2 = -r; dy2 <= r; dy2++) {
          var rb = clampIdx(y + dy2, h) * w;
          removeVal(src[rb + clampIdx(x - 1 - r, w)]);
          addVal(src[rb + clampIdx(x + r, w)]);
        }
        out[y * w + x] = med;
      }
    }
    return out;
  }

  // 中值降噪：逐通道真中值（半径 1=3×3，2=5×5）
  function fMedianDenoise(ch, w, h, p) {
    var r = Math.max(1, Math.min(2, Math.round(p.radius)));
    return {
      r: medianChannel(ch.r, w, h, r),
      g: medianChannel(ch.g, w, h, r),
      b: medianChannel(ch.b, w, h, r)
    };
  }

  // ================= 扭曲 =================

  // 旋转扭曲：绕中心按半径衰减旋转，中心转角最大、边缘（min(w,h)/2）为零
  function fTwirl(ch, w, h, p) {
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var R = Math.max(1, Math.min(w, h) / 2);
    var maxAng = p.angle * Math.PI / 180;
    return warpChannels(ch, w, h, function (x, y, sp) {
      var dx = x - cx, dy = y - cy;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r === 0 || r >= R) { sp[0] = x; sp[1] = y; return; }
      var t = 1 - r / R;
      var a = maxAng * t * t;
      var cs = Math.cos(a), sn = Math.sin(a);
      sp[0] = cx + dx * cs + dy * sn;
      sp[1] = cy - dx * sn + dy * cs;
    });
  }

  // 波浪：x、y 分别被对方坐标的正弦推移
  function fWave(ch, w, h, p) {
    var amp = p.amplitude;
    var kk = 2 * Math.PI / Math.max(4, p.wavelength);
    return warpChannels(ch, w, h, function (x, y, sp) {
      sp[0] = x + amp * Math.sin(y * kk);
      sp[1] = y + amp * Math.sin(x * kk);
    });
  }

  // 波纹：沿径向的正弦位移（波长固定为 min(w,h)/6）
  function fRipple(ch, w, h, p) {
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var wl = Math.max(8, Math.min(w, h) / 6);
    var amp = p.amount;
    var kk = 2 * Math.PI / wl;
    return warpChannels(ch, w, h, function (x, y, sp) {
      var dx = x - cx, dy = y - cy;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r === 0) { sp[0] = x; sp[1] = y; return; }
      var nr = r + amp * Math.sin(r * kk);
      var s = nr / r;
      sp[0] = cx + dx * s;
      sp[1] = cy + dy * s;
    });
  }

  // 球面化：径向幂映射 rho' = rho^(1+amount/100)；正=凸起放大中心，负=凹陷
  function fSpherize(ch, w, h, p) {
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var R = Math.max(1, Math.min(w, h) / 2);
    var expo = 1 + p.amount / 100;
    if (expo < 0.15) expo = 0.15;
    if (expo > 3) expo = 3;
    return warpChannels(ch, w, h, function (x, y, sp) {
      var dx = x - cx, dy = y - cy;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r === 0 || r >= R) { sp[0] = x; sp[1] = y; return; }
      var nr = Math.pow(r / R, expo) * R;
      var s = nr / r;
      sp[0] = cx + dx * s;
      sp[1] = cy + dy * s;
    });
  }

  // ================= 风格化 / 渲染 =================

  // 加噪：确定性哈希噪声（与既有 noise() 同源）；单色时三通道同值
  function fAddNoise(ch, w, h, p) {
    var out = copyChannels(ch);
    var amp = p.amount * 1.28; // 0..100 → ±128
    var mono = p.monochrome >= 0.5;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (mono) {
          var nz = noise(x, y, 77) * amp;
          out.r[i] = clampD(ch.r[i] + nz);
          out.g[i] = clampD(ch.g[i] + nz);
          out.b[i] = clampD(ch.b[i] + nz);
        } else {
          out.r[i] = clampD(ch.r[i] + noise(x, y, 71) * amp);
          out.g[i] = clampD(ch.g[i] + noise(x, y, 72) * amp);
          out.b[i] = clampD(ch.b[i] + noise(x, y, 73) * amp);
        }
      }
    }
    return out;
  }

  // 风吹：沿水平方向的确定性长短拖影（窗口均值）；direction 0=向右 1=向左
  function fWind(ch, w, h, p) {
    var out = copyChannels(ch);
    var L = Math.max(1, Math.round(p.strength));
    var toRight = p.direction < 0.5;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var t = (noise(x, y, 55) + 1) / 2; // 0..1
        var len = 1 + Math.floor(t * L);
        var sr = 0, sg = 0, sb = 0;
        for (var s = 0; s < len; s++) {
          var xx = toRight ? x - s : x + s;
          var j = y * w + clampIdx(xx, w);
          sr += ch.r[j]; sg += ch.g[j]; sb += ch.b[j];
        }
        out.r[i] = clampD(sr / len);
        out.g[i] = clampD(sg / len);
        out.b[i] = clampD(sb / len);
      }
    }
    return out;
  }

  // 值噪声（fBm 用）：整数格点哈希 + smoothstep 插值，返回 0..1
  function hash01(ix, iy, seed) {
    var n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 974711)) | 0;
    n = Math.imul(n ^ (n >> 13), 1274126177);
    n = n ^ (n >> 16);
    return (n >>> 0) / 4294967295;
  }

  function valueNoise(fx, fy, seed) {
    var ix = Math.floor(fx), iy = Math.floor(fy);
    var tx = fx - ix, ty = fy - iy;
    var sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    var v00 = hash01(ix, iy, seed), v10 = hash01(ix + 1, iy, seed);
    var v01 = hash01(ix, iy + 1, seed), v11 = hash01(ix + 1, iy + 1, seed);
    var top = v00 + (v10 - v00) * sx;
    var bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy;
  }

  // 云彩：5 倍频程 fBm 程序化生成（与输入无关），天蓝→白色渐变，固定种子可复现
  function fClouds(ch, w, h, p) {
    var n = w * h;
    var out = {
      r: new Uint8ClampedArray(n),
      g: new Uint8ClampedArray(n),
      b: new Uint8ClampedArray(n)
    };
    var cell = Math.max(4, p.scale);
    var con = 1 + (p.contrast / 100) * 2; // 0..100 → 1..3 倍展开
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var fx = x / cell, fy = y / cell;
        var v = 0, a = 0.5, f = 1, tot = 0;
        for (var o = 0; o < 5; o++) {
          v += a * valueNoise(fx * f, fy * f, 91 + o * 7);
          tot += a;
          a *= 0.5;
          f *= 2;
        }
        v /= tot;
        var t = 0.5 + (v - 0.5) * con;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        out.r[i] = clampD(70 + (255 - 70) * t);
        out.g[i] = clampD(130 + (255 - 130) * t);
        out.b[i] = clampD(200 + (255 - 200) * t);
      }
    }
    return out;
  }

  // 镜头光晕：主辉光（高斯衰减，暖色）+ 光环 + 沿光轴的 4 个幽灵光斑，全部加色叠加
  function fLensFlare(ch, w, h, p) {
    var out = copyChannels(ch);
    var fx = (p.posX / 100) * (w - 1), fy = (p.posY / 100) * (h - 1);
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var maxD = Math.sqrt(w * w + h * h) / 2;
    if (maxD < 1) maxD = 1;
    var bright = p.brightness / 100;
    var glowR = maxD * 0.55;
    // 幽灵光斑：位置在 光源→中心 轴线上（比例 t 取中心对称侧），[t, 半径(×maxD), 强度, 色调r,g,b]
    var ghosts = [
      [0.32, 0.050, 0.20, 0.65, 0.80, 1.00],
      [0.68, 0.028, 0.26, 1.00, 0.85, 0.60],
      [1.15, 0.085, 0.15, 0.70, 0.95, 0.85],
      [1.55, 0.042, 0.20, 0.95, 0.70, 0.90]
    ];
    var gPos = [];
    for (var gi = 0; gi < ghosts.length; gi++) {
      gPos.push([
        cx + (cx - fx) * ghosts[gi][0],
        cy + (cy - fy) * ghosts[gi][0],
        ghosts[gi][1] * maxD
      ]);
    }
    var ringR = maxD * 0.38, ringW = maxD * 0.02 + 1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var ddx = x - fx, ddy = y - fy;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        var glow = Math.exp(-(d * d) / (glowR * glowR) * 3) * bright;
        var rd = (d - ringR) / ringW;
        var ring = Math.exp(-rd * rd) * 0.35 * bright;
        var ar = glow * 255 + ring * 170;
        var ag = glow * 235 + ring * 165;
        var ab = glow * 200 + ring * 175;
        for (var g2 = 0; g2 < ghosts.length; g2++) {
          var gx = x - gPos[g2][0], gy = y - gPos[g2][1];
          var gr = gPos[g2][2];
          var gd = Math.sqrt(gx * gx + gy * gy);
          if (gd < gr) {
            var gf = 1 - gd / gr;
            var ga = gf * gf * ghosts[g2][2] * bright;
            ar += ga * 255 * ghosts[g2][3];
            ag += ga * 255 * ghosts[g2][4];
            ab += ga * 255 * ghosts[g2][5];
          }
        }
        out.r[i] = clampD(ch.r[i] + ar);
        out.g[i] = clampD(ch.g[i] + ag);
        out.b[i] = clampD(ch.b[i] + ab);
      }
    }
    return out;
  }

  // 渐变映射内置色带（控制点 [位置 0..1, [r,g,b]]，线性插值成 256 级 LUT）
  // 经 MTFilters.gradMaps 对外公开（带名称），供「调节」页的渐变映射调整项共用同一套色带
  var GRAD_MAPS = [
    // 黑金
    [[0, [12, 10, 8]], [0.45, [92, 65, 28]], [0.75, [212, 168, 84]], [1, [255, 240, 200]]],
    // 青橙
    [[0, [4, 32, 40]], [0.4, [16, 110, 122]], [0.72, [232, 116, 44]], [1, [255, 226, 188]]],
    // 蓝紫
    [[0, [6, 8, 38]], [0.42, [38, 52, 148]], [0.74, [128, 84, 196]], [1, [238, 226, 255]]],
    // 红粉
    [[0, [26, 4, 10]], [0.4, [122, 22, 38]], [0.72, [232, 96, 92]], [1, [255, 232, 220]]]
  ];
  var GRAD_MAP_NAMES = ['黑金', '青橙', '蓝紫', '红粉'];

  function buildGradLut(stops) {
    var lut = new Uint8ClampedArray(256 * 3);
    for (var v = 0; v < 256; v++) {
      var t = v / 255;
      var seg = 0;
      while (seg < stops.length - 2 && t > stops[seg + 1][0]) seg++;
      var t0 = stops[seg][0], t1 = stops[seg + 1][0];
      var f = (t1 > t0) ? (t - t0) / (t1 - t0) : 0;
      for (var c = 0; c < 3; c++) {
        lut[v * 3 + c] = clampD(stops[seg][1][c] + (stops[seg + 1][1][c] - stops[seg][1][c]) * f);
      }
    }
    return lut;
  }

  // 渐变映射：按明度查所选色带 LUT
  function fGradientMap(ch, w, h, p) {
    var idx = Math.round(p.map);
    if (idx < 0) idx = 0;
    if (idx > GRAD_MAPS.length - 1) idx = GRAD_MAPS.length - 1;
    var lut = buildGradLut(GRAD_MAPS[idx]);
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var l = lum(ch.r[i], ch.g[i], ch.b[i]);
      out.r[i] = lut[l * 3];
      out.g[i] = lut[l * 3 + 1];
      out.b[i] = lut[l * 3 + 2];
    }
    return out;
  }

  // 色调分离：逐通道量化到 levels 个等级（复用既有 posterize 标量函数）
  function fPosterize(ch, w, h, p) {
    var lv = Math.max(2, Math.round(p.levels));
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      out.r[i] = posterize(ch.r[i], lv);
      out.g[i] = posterize(ch.g[i], lv);
      out.b[i] = posterize(ch.b[i], lv);
    }
    return out;
  }

  // 阈值：明度 >= level 输出纯白，否则纯黑
  function fThreshold(ch, w, h, p) {
    var lv = p.level;
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      var v = (lum(ch.r[i], ch.g[i], ch.b[i]) >= lv) ? 255 : 0;
      out.r[i] = v; out.g[i] = v; out.b[i] = v;
    }
    return out;
  }

  // 反相：255 - v
  function fInvert(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    for (var i = 0; i < n; i++) {
      out.r[i] = 255 - ch.r[i];
      out.g[i] = 255 - ch.g[i];
      out.b[i] = 255 - ch.b[i];
    }
    return out;
  }

  // 自动色阶：逐通道按实际 min/max 线性拉伸到 0..255；恒定通道原样保留
  function fLevelsAuto(ch, w, h) {
    var out = copyChannels(ch);
    var n = w * h;
    var chans = ['r', 'g', 'b'];
    for (var c = 0; c < 3; c++) {
      var key = chans[c];
      var arr = ch[key];
      var mn = 255, mx = 0;
      for (var i = 0; i < n; i++) {
        if (arr[i] < mn) mn = arr[i];
        if (arr[i] > mx) mx = arr[i];
      }
      if (mx <= mn) continue;
      var lut = new Uint8ClampedArray(256);
      for (var v = 0; v < 256; v++) lut[v] = clampD((v - mn) * 255 / (mx - mn));
      var dst = out[key];
      for (var j = 0; j < n; j++) dst[j] = lut[arr[j]];
    }
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
    { id: 'nightvision', name: '夜视' },
    // 第二批：参数化滤镜（网页版新增，params 供 UI 自动生成滑杆）
    { id: 'gaussianBlur', name: '高斯模糊', params: PARAM_DEFS.gaussianBlur },
    { id: 'motionBlur',   name: '动感模糊', params: PARAM_DEFS.motionBlur },
    { id: 'radialBlur',   name: '径向模糊', params: PARAM_DEFS.radialBlur },
    { id: 'surfaceBlur',  name: '表面模糊', params: PARAM_DEFS.surfaceBlur },
    { id: 'usmSharpen',   name: 'USM锐化', params: PARAM_DEFS.usmSharpen },
    { id: 'medianDenoise', name: '中值降噪', params: PARAM_DEFS.medianDenoise },
    { id: 'twirl',        name: '旋转扭曲', params: PARAM_DEFS.twirl },
    { id: 'wave',         name: '波浪', params: PARAM_DEFS.wave },
    { id: 'ripple',       name: '波纹', params: PARAM_DEFS.ripple },
    { id: 'spherize',     name: '球面化', params: PARAM_DEFS.spherize },
    { id: 'addNoise',     name: '加噪', params: PARAM_DEFS.addNoise },
    { id: 'wind',         name: '风吹', params: PARAM_DEFS.wind },
    { id: 'clouds',       name: '云彩', params: PARAM_DEFS.clouds },
    { id: 'lensFlare',    name: '镜头光晕', params: PARAM_DEFS.lensFlare },
    { id: 'gradientMap',  name: '渐变映射', params: PARAM_DEFS.gradientMap },
    { id: 'posterize',    name: '色调分离', params: PARAM_DEFS.posterize },
    { id: 'threshold',    name: '阈值', params: PARAM_DEFS.threshold },
    { id: 'invert',       name: '反相' },
    { id: 'levelsAuto',   name: '自动色阶' }
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
    nightvision: fNightVision,
    gaussianBlur: fGaussianBlur,
    motionBlur: fMotionBlur,
    radialBlur: fRadialBlur,
    surfaceBlur: fSurfaceBlur,
    usmSharpen: fUsmSharpen,
    medianDenoise: fMedianDenoise,
    twirl: fTwirl,
    wave: fWave,
    ripple: fRipple,
    spherize: fSpherize,
    addNoise: fAddNoise,
    wind: fWind,
    clouds: fClouds,
    lensFlare: fLensFlare,
    gradientMap: fGradientMap,
    posterize: fPosterize,
    threshold: fThreshold,
    invert: fInvert,
    levelsAuto: fLevelsAuto
  };

  // 在传入的 ImageData 上原地应用滤镜并返回它；未知 id 原样返回（与 Java 版一致）
  // 第三参 params 可选：仅第二批参数化滤镜使用，缺失/越界自动取默认/钳制
  function apply(imageData, id, params) {
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
    var out = fn(ch, w, h, resolveParams(id, params));
    for (var j = 0; j < n; j++) {
      data[j * 4] = out.r[j];
      data[j * 4 + 1] = out.g[j];
      data[j * 4 + 2] = out.b[j];
      // alpha（data[j*4+3]）保持不变，对应 Java 版保留原图 alpha
    }
    return imageData;
  }

  var root = (typeof window !== 'undefined') ? window : globalThis;
  root.MTFilters = {
    list: LIST,
    apply: apply,
    gradMaps: GRAD_MAPS.map(function (stops, i) { return { name: GRAD_MAP_NAMES[i], stops: stops }; })
  };
})();
