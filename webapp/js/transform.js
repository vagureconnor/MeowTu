'use strict';
/* ================================================================
   喵图 MeowTu —— 自由变换变形（MTTransform）
   逐项翻译自 PhotoCraft crates/algo/src/transform.rs（Free Transform）：
   - 变换由源矩形四角落点（quad）描述，缩放/旋转/斜切是仿射特例，
     透视/扭曲用完整单应（Homography.square_to_quad / rect_to_quad）。
   - 变形 = 逆映射 + 预乘 alpha 采样；PhotoCraft 默认双三次（Keys a=-0.75），
     本实现按任务口径用双线性（其 Interp::Bilinear 分支同式：钳制取样=边缘拉伸）。
   - 轮廓抗锯齿 = 源项目的覆盖度因子：cu/cv 按足迹（逆雅可比）算每像素被
     源矩形覆盖的比例，乘进预乘结果。
   - 地平线处理 = front_side：源跨地平线时只画正面一侧，避免镜像绕回。
   偏差：输出边界不加源项目的 ±1px 滤波支撑圈；大缩小不做源项目的预缩小
   （双线性口径下源项目本身也不预滤波，见 transform.rs 注释）。
   ================================================================ */
(function () {
  // ---- 单应矩阵（行主序 9 元，[x',y',w'] = H·[x,y,1]） ----
  function mul(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    return r;
  }
  function applyH(m, x, y) {
    var w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  }
  /** 伴随矩阵求逆（transform.rs Homography::inverse 同式），奇异返回 null。 */
  function inverseH(m) {
    var c = [
      m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
    ];
    var det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
    if (Math.abs(det) < 1e-12) return null;
    return c.map(function (v) { return v / det; });
  }
  /** 单位正方形 → quad（角序 (0,0),(1,0),(1,1),(0,1)），square_to_quad 同式。 */
  function squareToQuad(q) {
    var x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1],
        x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    var sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
      return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
    }
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    var den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    var g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
            y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  }
  /** 矩形 r=[x0,y0,x1,y1] → quad（角序 左上,右上,右下,左下）的单应；退化返回 null。 */
  function rectToQuad(r, quad) {
    var w = r[2] - r[0], h = r[3] - r[1];
    if (!(w > 0) || !(h > 0)) return null;
    var q = quad.map(function (p) { return Array.isArray(p) ? p : [p.x, p.y]; });
    var sq = squareToQuad(q);
    if (!sq) return null;
    return mul(sq, [1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1]);
  }
  /** front_side：源矩形四角的正向 w 多数所在侧（同号取该侧，平局看中心）。 */
  function frontSide(m, W, H) {
    var cs = [[0, 0], [W, 0], [W, H], [0, H]].map(function (p) { return m[6] * p[0] + m[7] * p[1] + m[8]; });
    var ahead = cs.filter(function (w) { return w > 0; }).length;
    if (ahead >= 3) return 1;
    if (ahead <= 1) return -1;
    return (m[6] * W / 2 + m[7] * H / 2 + m[8]) >= 0 ? 1 : -1;
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** 把 src 的内容按 quad（源矩形四角在目标空间的落点，{x,y} 或 [x,y]）变形。
   *  返回 {canvas, offX, offY}：canvas 为变形结果的外接矩形，off 为其左上在目标空间的坐标；
   *  退化/超限返回 null。 */
  function warp(src, quad) {
    if (!src || !src.width || !quad || quad.length !== 4 || typeof document === 'undefined') return null;
    var W = src.width, H = src.height;
    var Hm = rectToQuad([0, 0, W, H], quad);
    if (!Hm) return null;
    var corners = [[0, 0], [W, 0], [W, H], [0, H]].map(function (p) { return applyH(Hm, p[0], p[1]); });
    for (var ci = 0; ci < 4; ci++) if (!isFinite(corners[ci][0]) || !isFinite(corners[ci][1])) return null;
    var bx0 = Math.floor(Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]));
    var by0 = Math.floor(Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]));
    var bx1 = Math.ceil(Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0]));
    var by1 = Math.ceil(Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1]));
    var ow = bx1 - bx0, oh = by1 - by0;
    if (ow < 1 || oh < 1 || ow > 12000 || oh > 12000 || ow * oh > 100000000) return null;
    var inv = inverseH(Hm);
    if (!inv) return null;
    // 正向 w 在源矩形（外扩 1px）上同号 → 无需逐像素剔除；跨地平线 → 只画 front 侧
    var fw = [[-1, -1], [W + 1, -1], [W + 1, H + 1], [-1, H + 1]]
      .map(function (p) { return Hm[6] * p[0] + Hm[7] * p[1] + Hm[8]; });
    var oneSide = fw.every(function (w) { return w > 0; }) || fw.every(function (w) { return w < 0; });
    var front = oneSide ? 0 : frontSide(Hm, W, H);
    // 足迹：目标中心处一个目标像素在源空间的跨度（源项目按 tile 中心算，此处整图一次）
    var mc = applyH(inv, (bx0 + bx1) / 2, (by0 + by1) / 2);
    var mx = applyH(inv, (bx0 + bx1) / 2 + 1, (by0 + by1) / 2);
    var my = applyH(inv, (bx0 + bx1) / 2, (by0 + by1) / 2 + 1);
    function extent(e) { return (isFinite(e) && e > 1e-12) ? e : 1; }
    var footU = extent(Math.abs(mx[0] - mc[0]) + Math.abs(my[0] - mc[0]));
    var footV = extent(Math.abs(mx[1] - mc[1]) + Math.abs(my[1] - mc[1]));

    var sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    var out = makeCanvas(ow, oh);
    var octx = out.getContext('2d');
    var img = octx.createImageData(ow, oh);
    var dd = img.data;
    function tap(x, y, ch) { // 坐标钳制取样（边缘拉伸，源项目 clamped 同口径）
      var cx = x < 0 ? 0 : (x >= W ? W - 1 : x);
      var cy = y < 0 ? 0 : (y >= H ? H - 1 : y);
      return sd[(cy * W + cx) * 4 + ch];
    }
    for (var y = 0; y < oh; y++) {
      for (var x = 0; x < ow; x++) {
        var px = bx0 + x + 0.5, py = by0 + y + 0.5;
        var iw = inv[6] * px + inv[7] * py + inv[8];
        if (!iw || (front && front * iw <= 0)) continue;
        var u = (inv[0] * px + inv[1] * py + inv[2]) / iw - 0.5;
        var v = (inv[3] * px + inv[4] * py + inv[5]) / iw - 0.5;
        if (u < -1.5 || v < -1.5 || u > W - 0.5 || v > H - 0.5) continue;
        var x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        var a0 = 0, a1 = 0, a2 = 0, a3 = 0;
        for (var dy = 0; dy <= 1; dy++) {
          for (var dx = 0; dx <= 1; dx++) {
            var wgt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
            if (!wgt) continue;
            var al = tap(x0 + dx, y0 + dy, 3) / 255 * wgt; // 预乘采样
            a0 += tap(x0 + dx, y0 + dy, 0) * al;
            a1 += tap(x0 + dx, y0 + dy, 1) * al;
            a2 += tap(x0 + dx, y0 + dy, 2) * al;
            a3 += al;
          }
        }
        // 覆盖度：源矩形轮廓的抗锯齿（源项目 cu*cv 同式）
        var uc = u + 0.5, vc = v + 0.5;
        var cu = Math.min(Math.max(Math.min(uc, W - uc) / footU + 0.5, 0), 1);
        var cv = Math.min(Math.max(Math.min(vc, H - vc) / footV + 0.5, 0), 1);
        a3 *= cu * cv;
        if (a3 <= 0) continue;
        var di = (y * ow + x) * 4, k = cu * cv;
        dd[di] = Math.round(Math.min(255, Math.max(0, a0 * k / a3)));
        dd[di + 1] = Math.round(Math.min(255, Math.max(0, a1 * k / a3)));
        dd[di + 2] = Math.round(Math.min(255, Math.max(0, a2 * k / a3)));
        dd[di + 3] = Math.round(Math.min(1, a3) * 255);
      }
    }
    octx.putImageData(img, 0, 0);
    return { canvas: out, offX: bx0, offY: by0 };
  }

  var api = { warp: warp, rectToQuad: rectToQuad, applyH: applyH, inverseH: inverseH };
  if (typeof window !== 'undefined') window.MTTransform = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
