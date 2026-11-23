/*
 * 喵图 MeowTu 网页版抠图模块 —— OpenCV GrabCut 的 JS 移植。
 *
 * 移植来源（Java 版，src/meowtu/grabcut/，本身即按 OpenCV GrabCut 经典结构翻译）：
 *   - GrabCut.java     → 主流程 grabCutAlpha()：双 GMM + 网格图 s-t 最小割迭代，
 *                        末尾引导滤波细化 + 半径 1 羽化 + 硬约束回填
 *   - Gmm.java         → class Gmm：RGB 三维高斯混合，K=5 分量，k-means 初始化
 *   - Graph.java       → class Graph：Dinic 分层网络增广路最大流。
 *                        Java 版注释即写明「与 Boykov-Kolmogorov 增广路最大流等价，
 *                        用 Dinic 求同一最大流/最小割」，本文件照用 Dinic，
 *                        边存储同为原始数组、正反边成对（编号互为 ^1）
 *   - GuidedFilter.java→ guidedFilter()：灰度引导、积分图盒滤波
 *   - CutoutPanel.java → cut() 入口的降采样策略：先缩小算 alpha、再放大回原尺寸
 *                        （Java 面板降到最长边 460，本网页版按既定取舍用 480）
 *
 * 对外契约：
 *   MTGrabCut.cut(imageData, rect) -> ImageData
 *   rect = {x, y, w, h} 为原图坐标的前景框；返回新 ImageData，
 *   前景保留原 RGB，背景 alpha=0，边缘带引导滤波细化后的软 alpha。
 *
 * 纯原生 JS，零第三方库。
 */
(function () {
  'use strict';

  // ===== 常量（与 Java 版 GrabCut.java 一一对应） =====
  var BGD = 0, FGD = 1, PR_BGD = 2, PR_FGD = 3; // 掩码取值
  var GAMMA = 50.0;
  var LAMBDA = 9 * GAMMA; // 硬约束与图边界权重 = 450
  var ITERATIONS = 3;     // CutoutPanel 调用 GrabCut.alpha 时传的迭代次数
  var MAX_SIDE = 480;     // 内部计算图最长边上限（Java 面板版为 460，见文件头）

  function isFg(m) { return m === FGD || m === PR_FGD; }

  // =====================================================================
  // Gmm —— 移植自 Gmm.java
  // RGB 三维高斯混合，K=5；协方差对角正则 REG=1，行列式下限 MIN_DET=1。
  // =====================================================================
  var GMM_K = 5;
  var LOG_2PI3 = 1.5 * Math.log(2 * Math.PI);
  var GMM_REG = 1.0;
  var GMM_MIN_DET = 1.0;

  function Gmm() {
    // 用一维数组平铺 [k][d] / [k][d][e]，下标 k*3+d、k*9+d*3+e
    this.pi = new Float64Array(GMM_K);
    this.mean = new Float64Array(GMM_K * 3);
    this.cov = new Float64Array(GMM_K * 9);
    this.inv = new Float64Array(GMM_K * 9);
    this.logCoef = new Float64Array(GMM_K); // ln(pi) - 0.5*ln((2pi)^3 * det)
    this.cnt = new Int32Array(GMM_K);
    this.sum = new Float64Array(GMM_K * 3);
    this.sq = new Float64Array(GMM_K * 9);
    this.resetDefault();
  }

  // 空模型兜底：均匀权重、零均值、大方差
  Gmm.prototype.resetDefault = function () {
    for (var k = 0; k < GMM_K; k++) {
      this.pi[k] = 1.0 / GMM_K;
      for (var d = 0; d < 3; d++) {
        this.mean[k * 3 + d] = 0;
        for (var e = 0; e < 3; e++) this.cov[k * 9 + d * 3 + e] = (d === e) ? 100.0 : 0;
      }
      this.updateComponent(k);
    }
  };

  function det3(c, o) {
    return c[o] * (c[o + 4] * c[o + 8] - c[o + 5] * c[o + 7])
         - c[o + 1] * (c[o + 3] * c[o + 8] - c[o + 5] * c[o + 6])
         + c[o + 2] * (c[o + 3] * c[o + 7] - c[o + 4] * c[o + 6]);
  }

  // 由当前 cov 计算行列式、逆矩阵与归一化系数（含正则与钳制）；与 Java 版一样会就地给 cov 加正则
  Gmm.prototype.updateComponent = function (k) {
    var c = this.cov, o = k * 9;
    c[o] += GMM_REG; c[o + 4] += GMM_REG; c[o + 8] += GMM_REG;
    var det = det3(c, o);
    var guard = 0;
    while ((det < GMM_MIN_DET || !isFinite(det)) && guard++ < 20) {
      c[o] += 10.0; c[o + 4] += 10.0; c[o + 8] += 10.0;
      det = det3(c, o);
    }
    if (!isFinite(det) || det <= 0) det = GMM_MIN_DET;
    var iv = this.inv;
    iv[o]     = (c[o + 4] * c[o + 8] - c[o + 5] * c[o + 7]) / det;
    iv[o + 1] = (c[o + 2] * c[o + 7] - c[o + 1] * c[o + 8]) / det;
    iv[o + 2] = (c[o + 1] * c[o + 5] - c[o + 2] * c[o + 4]) / det;
    iv[o + 3] = iv[o + 1];
    iv[o + 4] = (c[o] * c[o + 8] - c[o + 2] * c[o + 6]) / det;
    iv[o + 5] = (c[o + 2] * c[o + 3] - c[o] * c[o + 7]) / det;
    iv[o + 6] = iv[o + 2];
    iv[o + 7] = iv[o + 5];
    iv[o + 8] = (c[o] * c[o + 4] - c[o + 1] * c[o + 3]) / det;
    this.logCoef[k] = (this.pi[k] > 0)
      ? Math.log(this.pi[k]) - LOG_2PI3 - 0.5 * Math.log(det)
      : -Infinity;
  };

  // 单分量对数密度 ln(pi_k * N(x))
  Gmm.prototype.logDensity = function (k, r, g, b) {
    if (this.pi[k] <= 0) return -Infinity;
    var mo = k * 3, io = k * 9;
    var dr = r - this.mean[mo], dg = g - this.mean[mo + 1], db = b - this.mean[mo + 2];
    var iv = this.inv;
    var m = dr * (iv[io] * dr + iv[io + 1] * dg + iv[io + 2] * db)
          + dg * (iv[io + 3] * dr + iv[io + 4] * dg + iv[io + 5] * db)
          + db * (iv[io + 6] * dr + iv[io + 7] * dg + iv[io + 8] * db);
    return this.logCoef[k] - 0.5 * m;
  };

  // assign 步：返回密度最大的分量编号
  Gmm.prototype.assign = function (r, g, b) {
    var best = 0, bestVal = -Infinity;
    for (var k = 0; k < GMM_K; k++) {
      var v = this.logDensity(k, r, g, b);
      if (v > bestVal) { bestVal = v; best = k; }
    }
    return best;
  };

  // 数据项代价 -ln Pr(颜色|本模型)，log-sum-exp 稳定计算并钳制到 [0, 1e4]
  Gmm.prototype.dataCost = function (r, g, b) {
    var ld = new Float64Array(GMM_K);
    var max = -Infinity;
    for (var k = 0; k < GMM_K; k++) {
      ld[k] = this.logDensity(k, r, g, b);
      if (ld[k] > max) max = ld[k];
    }
    if (max === -Infinity) return 1.0e4;
    var s = 0;
    for (var k2 = 0; k2 < GMM_K; k2++) {
      if (ld[k2] !== -Infinity) s += Math.exp(ld[k2] - max);
    }
    var cost = -(max + Math.log(s));
    if (cost < 0) cost = 0;
    return Math.min(cost, 1.0e4);
  };

  Gmm.prototype.beginLearning = function () {
    this.cnt.fill(0);
    this.sum.fill(0);
    this.sq.fill(0);
  };

  Gmm.prototype.addSample = function (k, r, g, b) {
    this.cnt[k]++;
    var v0 = r, v1 = g, v2 = b;
    var so = k * 3, qo = k * 9;
    this.sum[so] += v0; this.sum[so + 1] += v1; this.sum[so + 2] += v2;
    this.sq[qo] += v0 * v0;     this.sq[qo + 1] += v0 * v1; this.sq[qo + 2] += v0 * v2;
    this.sq[qo + 3] += v1 * v0; this.sq[qo + 4] += v1 * v1; this.sq[qo + 5] += v1 * v2;
    this.sq[qo + 6] += v2 * v0; this.sq[qo + 7] += v2 * v1; this.sq[qo + 8] += v2 * v2;
  };

  Gmm.prototype.endLearning = function () {
    var total = 0, k, d, e;
    for (k = 0; k < GMM_K; k++) total += this.cnt[k];
    if (total === 0) { this.resetDefault(); return; }
    for (k = 0; k < GMM_K; k++) {
      if (this.cnt[k] === 0) {
        this.pi[k] = 0;
        this.updateComponent(k);
        continue;
      }
      this.pi[k] = this.cnt[k] / total;
      var mo = k * 3, qo = k * 9;
      for (d = 0; d < 3; d++) this.mean[mo + d] = this.sum[mo + d] / this.cnt[k];
      for (d = 0; d < 3; d++) {
        for (e = 0; e < 3; e++) {
          this.cov[qo + d * 3 + e] = this.sq[qo + d * 3 + e] / this.cnt[k]
            - this.mean[mo + d] * this.mean[mo + e];
        }
      }
      this.updateComponent(k);
    }
  };

  /*
   * initGMMs 用的初始化：对样本做简化 k-means（等距取初始中心，迭代到稳定），
   * 再以聚类结果走一遍 learn。members 为像素下标数组，comp 为全局分量数组（回填）。
   */
  Gmm.prototype.initKMeans = function (cr, cg, cb, members, comp) {
    var m = members.length;
    if (m === 0) { this.resetDefault(); return; }
    var center = new Float64Array(GMM_K * 3);
    for (var k = 0; k < GMM_K; k++) {
      var idx = members[Math.min(m - 1, Math.floor((k + 0.5) * m / GMM_K))];
      center[k * 3] = cr[idx]; center[k * 3 + 1] = cg[idx]; center[k * 3 + 2] = cb[idx];
    }
    var cluster = new Int32Array(m);
    var ccnt = new Int32Array(GMM_K);
    var csum = new Float64Array(GMM_K * 3);
    for (var iter = 0; iter < 20; iter++) {
      var changed = false;
      for (var j = 0; j < m; j++) {
        var p = members[j];
        var best = 0, bd = Infinity;
        for (var k2 = 0; k2 < GMM_K; k2++) {
          var d0 = cr[p] - center[k2 * 3];
          var d1 = cg[p] - center[k2 * 3 + 1];
          var d2 = cb[p] - center[k2 * 3 + 2];
          var dist = d0 * d0 + d1 * d1 + d2 * d2;
          if (dist < bd) { bd = dist; best = k2; }
        }
        if (cluster[j] !== best) changed = true;
        cluster[j] = best;
      }
      ccnt.fill(0); csum.fill(0);
      for (var j2 = 0; j2 < m; j2++) {
        var p2 = members[j2], kk = cluster[j2];
        ccnt[kk]++;
        csum[kk * 3] += cr[p2]; csum[kk * 3 + 1] += cg[p2]; csum[kk * 3 + 2] += cb[p2];
      }
      for (var k3 = 0; k3 < GMM_K; k3++) {
        if (ccnt[k3] > 0) {
          center[k3 * 3] = csum[k3 * 3] / ccnt[k3];
          center[k3 * 3 + 1] = csum[k3 * 3 + 1] / ccnt[k3];
          center[k3 * 3 + 2] = csum[k3 * 3 + 2] / ccnt[k3];
        }
      }
      if (!changed) break;
    }
    this.beginLearning();
    for (var j3 = 0; j3 < m; j3++) {
      var p3 = members[j3];
      comp[p3] = cluster[j3];
      this.addSample(cluster[j3], cr[p3], cg[p3], cb[p3]);
    }
    this.endLearning();
  };

  // =====================================================================
  // Graph —— 移植自 Graph.java：Dinic 最大流（与 Java 版同算法、同存储方式）。
  // 边存原始类型数组，正反边成对（编号互为 ^1）；DFS 递归与 Java 版一致
  // （Java 版为此开了大栈线程；分层图层数有限，JS 默认调用栈可承受）。
  // =====================================================================
  var EPS = 1e-10;

  function Graph(n, maxEdges) {
    this.n = n;
    this.head = new Int32Array(n).fill(-1);
    this.level = new Int32Array(n);
    this.iter = new Int32Array(n);
    this.queue = new Int32Array(n);
    var m = Math.max(16, maxEdges);
    this.to = new Int32Array(m);
    this.nxt = new Int32Array(m);
    this.cap = new Float64Array(m);
    this.ecnt = 0;
  }

  Graph.prototype.ensure = function (slots) {
    if (this.ecnt + slots <= this.to.length) return;
    var m = Math.max(this.to.length * 2, this.ecnt + slots);
    var to = new Int32Array(m); to.set(this.to); this.to = to;
    var nxt = new Int32Array(m); nxt.set(this.nxt); this.nxt = nxt;
    var cap = new Float64Array(m); cap.set(this.cap); this.cap = cap;
  };

  // 加一条有向边（同时加 0 容量残量反边）
  Graph.prototype.addEdge = function (u, v, c) {
    if (c < 0) c = 0;
    this.ensure(2);
    var e = this.ecnt;
    this.to[e] = v; this.cap[e] = c; this.nxt[e] = this.head[u]; this.head[u] = e; e++;
    this.to[e] = u; this.cap[e] = 0; this.nxt[e] = this.head[v]; this.head[v] = e; e++;
    this.ecnt = e;
  };

  // 无向平滑边：两个方向各一条，任一方向被割都计同一权重
  Graph.prototype.addUndirected = function (u, v, c) {
    this.addEdge(u, v, c);
    this.addEdge(v, u, c);
  };

  Graph.prototype.maxFlow = function (s, t) {
    var flow = 0;
    while (this.bfs(s, t)) {
      this.iter.set(this.head);
      var f;
      while ((f = this.dfs(s, t, Infinity)) > EPS) flow += f;
    }
    return flow;
  };

  Graph.prototype.bfs = function (s, t) {
    this.level.fill(-1);
    var qh = 0, qt = 0;
    this.level[s] = 0;
    this.queue[qt++] = s;
    while (qh < qt) {
      var v = this.queue[qh++];
      for (var i = this.head[v]; i !== -1; i = this.nxt[i]) {
        if (this.cap[i] > EPS && this.level[this.to[i]] < 0) {
          this.level[this.to[i]] = this.level[v] + 1;
          this.queue[qt++] = this.to[i];
        }
      }
    }
    return this.level[t] >= 0;
  };

  Graph.prototype.dfs = function (v, t, f) {
    if (v === t) return f;
    var pushed = 0;
    while (this.iter[v] !== -1 && pushed < f) {
      var i = this.iter[v];
      var u = this.to[i];
      if (this.cap[i] > EPS && this.level[u] === this.level[v] + 1) {
        var d = this.dfs(u, t, Math.min(f - pushed, this.cap[i]));
        if (d > EPS) {
          this.cap[i] -= d;
          this.cap[i ^ 1] += d;
          pushed += d;
          continue;
        }
      }
      this.iter[v] = this.nxt[i];
    }
    if (pushed <= EPS) this.level[v] = -1; // 该点本层已无出路，剪枝
    return pushed;
  };

  // 最大流后从源点沿残量边可达的点（前景侧）
  Graph.prototype.reachableFrom = function (s) {
    var vis = new Uint8Array(this.n);
    var qh = 0, qt = 0;
    vis[s] = 1;
    this.queue[qt++] = s;
    while (qh < qt) {
      var v = this.queue[qh++];
      for (var i = this.head[v]; i !== -1; i = this.nxt[i]) {
        if (this.cap[i] > EPS && !vis[this.to[i]]) {
          vis[this.to[i]] = 1;
          this.queue[qt++] = this.to[i];
        }
      }
    }
    return vis;
  };

  // =====================================================================
  // GuidedFilter —— 移植自 GuidedFilter.java
  // 引导图取灰度，盒滤波用积分图实现；0..1 归一化域：q = meanA * I + meanB。
  // =====================================================================

  // 积分图盒滤波，窗口在边界处收缩并按实际面积归一化
  function boxFilter(src, w, h, r) {
    var sw = w + 1;
    var integ = new Float64Array(sw * (h + 1));
    for (var y = 0; y < h; y++) {
      var rowSum = 0;
      var srcRow = y * w, cur = (y + 1) * sw, up = y * sw;
      for (var x = 0; x < w; x++) {
        rowSum += src[srcRow + x];
        integ[cur + x + 1] = integ[up + x + 1] + rowSum;
      }
    }
    var out = new Float64Array(w * h);
    for (var y2 = 0; y2 < h; y2++) {
      var y0 = Math.max(0, y2 - r), y1 = Math.min(h - 1, y2 + r);
      for (var x2 = 0; x2 < w; x2++) {
        var x0 = Math.max(0, x2 - r), x1 = Math.min(w - 1, x2 + r);
        var s = integ[(y1 + 1) * sw + x1 + 1] - integ[y0 * sw + x1 + 1]
              - integ[(y1 + 1) * sw + x0] + integ[y0 * sw + x0];
        out[y2 * w + x2] = s / ((x1 - x0 + 1) * (y1 - y0 + 1));
      }
    }
    return out;
  }

  // guideRgb: Float64Array 形式的三通道原图（0..255）；p: 0..255 的待细化 alpha
  function guidedFilter(cr, cg, cb, p, w, h, radius, eps) {
    var n = w * h;
    var r = Math.max(1, radius);
    var imgI = new Float64Array(n);
    var imgP = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var gray = 0.299 * cr[i] + 0.587 * cg[i] + 0.114 * cb[i];
      imgI[i] = gray / 255.0;
      var pv = p[i];
      imgP[i] = Math.max(0, Math.min(255, pv)) / 255.0;
    }
    var meanI = boxFilter(imgI, w, h, r);
    var meanP = boxFilter(imgP, w, h, r);
    var ip = new Float64Array(n);
    var ii = new Float64Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      ip[i2] = imgI[i2] * imgP[i2];
      ii[i2] = imgI[i2] * imgI[i2];
    }
    var meanIp = boxFilter(ip, w, h, r);
    var meanII = boxFilter(ii, w, h, r);
    var a = new Float64Array(n);
    var b = new Float64Array(n);
    for (var i3 = 0; i3 < n; i3++) {
      var covIp = meanIp[i3] - meanI[i3] * meanP[i3];
      var varI = meanII[i3] - meanI[i3] * meanI[i3];
      a[i3] = covIp / (varI + eps);
      b[i3] = meanP[i3] - a[i3] * meanI[i3];
    }
    var meanA = boxFilter(a, w, h, r);
    var meanB = boxFilter(b, w, h, r);
    var out = new Float64Array(n);
    for (var i4 = 0; i4 < n; i4++) {
      var q = meanA[i4] * imgI[i4] + meanB[i4];
      if (q < 0) q = 0;
      if (q > 1) q = 1;
      out[i4] = Math.round(q * 255.0);
    }
    return out;
  }

  // =====================================================================
  // feather —— 移植自 GrabCut.java 的小半径盒式模糊羽化（两趟滑动窗口）
  // Java 版为整数运算（截断除法），这里对正数用 Math.floor 等价实现。
  // =====================================================================
  function clampIdx(v, max) { return v < 0 ? 0 : (v >= max ? max - 1 : v); }

  function feather(src, w, h, r) {
    var tmp = new Float64Array(w * h);
    var out = new Float64Array(w * h);
    var x, y, sum;
    for (y = 0; y < h; y++) {
      var row = y * w;
      sum = 0;
      for (x = -r; x <= r; x++) sum += src[row + clampIdx(x, w)];
      for (x = 0; x < w; x++) {
        tmp[row + x] = Math.floor(sum / (2 * r + 1));
        sum += src[row + clampIdx(x + r + 1, w)] - src[row + clampIdx(x - r, w)];
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (y = -r; y <= r; y++) sum += tmp[clampIdx(y, h) * w + x];
      for (y = 0; y < h; y++) {
        var v = Math.floor(sum / (2 * r + 1));
        out[y * w + x] = Math.max(0, Math.min(255, v));
        sum += tmp[clampIdx(y + r + 1, h) * w + x] - tmp[clampIdx(y - r, h) * w + x];
      }
    }
    return out;
  }

  // =====================================================================
  // GrabCut 主流程 —— 移植自 GrabCut.alpha()
  // cr/cg/cb: Float64Array 颜色平面（0..255）；rect: {x,y,w,h} 计算图坐标；
  // 返回 Float64Array alpha（0..255）。本契约无画笔，硬约束只有矩形外 BGD。
  // =====================================================================
  function clampRect(rect, w, h) {
    if (!rect) return { x: 0, y: 0, w: w, h: h };
    var x0 = Math.max(0, Math.min(w - 1, rect.x));
    var y0 = Math.max(0, Math.min(h - 1, rect.y));
    var x1 = Math.max(x0 + 1, Math.min(w, rect.x + Math.max(1, rect.w)));
    var y1 = Math.max(y0 + 1, Math.min(h, rect.y + Math.max(1, rect.h)));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function dist2(cr, cg, cb, i, j) {
    var dr = cr[i] - cr[j], dg = cg[i] - cg[j], db = cb[i] - cb[j];
    return dr * dr + dg * dg + db * db;
  }

  // beta = 1 / (2 * 邻居色差平方均值)，邻居取左与上（与 Java 版一致）
  function calcBeta(cr, cg, cb, w, h) {
    var sum = 0, cnt = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (x > 0) { sum += dist2(cr, cg, cb, i, i - 1); cnt++; }
        if (y > 0) { sum += dist2(cr, cg, cb, i, i - w); cnt++; }
      }
    }
    if (cnt === 0 || sum <= 0) return 0;
    return 1.0 / (2.0 * (sum / cnt));
  }

  function grabCutAlpha(cr, cg, cb, w, h, rect, iterations) {
    var n = w * h;
    if (n === 0) return new Float64Array(0);

    // 初始掩码：矩形外确定背景，矩形内可能前景
    var mask = new Uint8Array(n);
    var rc = clampRect(rect, w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var inside = x >= rc.x && x < rc.x + rc.w && y >= rc.y && y < rc.y + rc.h;
        mask[y * w + x] = inside ? PR_FGD : BGD;
      }
    }

    var beta = calcBeta(cr, cg, cb, w, h);

    // initGMMs：按初始掩码收集前/背景样本，各做 k-means 初始化并 learn
    var bgGmm = new Gmm(), fgGmm = new Gmm();
    var comp = new Int32Array(n);
    var bgCnt = 0, fgCnt = 0, i;
    for (i = 0; i < n; i++) { if (isFg(mask[i])) fgCnt++; else bgCnt++; }
    var bgMembers = new Int32Array(bgCnt), fgMembers = new Int32Array(fgCnt);
    var bi = 0, fi = 0;
    for (i = 0; i < n; i++) {
      if (isFg(mask[i])) fgMembers[fi++] = i; else bgMembers[bi++] = i;
    }
    bgGmm.initKMeans(cr, cg, cb, bgMembers, comp);
    fgGmm.initKMeans(cr, cg, cb, fgMembers, comp);

    var iters = Math.max(1, iterations);
    for (var it = 0; it < iters; it++) {
      // assignGMMs
      for (i = 0; i < n; i++) {
        comp[i] = isFg(mask[i]) ? fgGmm.assign(cr[i], cg[i], cb[i])
                                : bgGmm.assign(cr[i], cg[i], cb[i]);
      }
      // learnGMMs
      bgGmm.beginLearning();
      fgGmm.beginLearning();
      for (i = 0; i < n; i++) {
        if (isFg(mask[i])) fgGmm.addSample(comp[i], cr[i], cg[i], cb[i]);
        else bgGmm.addSample(comp[i], cr[i], cg[i], cb[i]);
      }
      bgGmm.endLearning();
      fgGmm.endLearning();
      // constructGraph：源侧=前景；数据项=-ln Pr，硬约束 LAMBDA；
      // 平滑项 gamma*exp(-beta*色差²)，只连左、上邻居（与 Java 版一致）
      var s = n, t = n + 1;
      var graph = new Graph(n + 2, 12 * n + 16);
      for (var yy = 0; yy < h; yy++) {
        for (var xx = 0; xx < w; xx++) {
          var p = yy * w + xx;
          if (mask[p] === BGD) {
            graph.addEdge(p, t, LAMBDA);
          } else if (mask[p] === FGD) {
            graph.addEdge(s, p, LAMBDA);
          } else {
            graph.addEdge(s, p, bgGmm.dataCost(cr[p], cg[p], cb[p]));
            graph.addEdge(p, t, fgGmm.dataCost(cr[p], cg[p], cb[p]));
          }
          if (xx > 0) {
            graph.addUndirected(p, p - 1, GAMMA * Math.exp(-beta * dist2(cr, cg, cb, p, p - 1)));
          }
          if (yy > 0) {
            graph.addUndirected(p, p - w, GAMMA * Math.exp(-beta * dist2(cr, cg, cb, p, p - w)));
          }
        }
      }
      graph.maxFlow(s, t);
      var reach = graph.reachableFrom(s);
      for (i = 0; i < n; i++) {
        if (mask[i] === PR_BGD || mask[i] === PR_FGD) {
          mask[i] = reach[i] ? PR_FGD : PR_BGD;
        }
      }
    }

    // 二值结果 → 引导滤波细化 → 小半径羽化 → 回填硬约束
    var bin = new Float64Array(n);
    for (i = 0; i < n; i++) bin[i] = isFg(mask[i]) ? 255 : 0;
    var refined = guidedFilter(cr, cg, cb, bin, w, h, 6, 0.01);
    var out = feather(refined, w, h, 1);
    for (i = 0; i < n; i++) {
      if (mask[i] === BGD) out[i] = 0;
      else if (mask[i] === FGD) out[i] = 255;
    }
    return out;
  }

  // =====================================================================
  // 降采样 / 放大（对应 CutoutPanel 的 Img.downscale / Img.resize 步骤）
  // 降采样用盒式面积平均；alpha 放大回原尺寸用双线性插值。
  // =====================================================================
  function downscaleBox(data, W, H, sw, sh) {
    var cr = new Float64Array(sw * sh);
    var cg = new Float64Array(sw * sh);
    var cb = new Float64Array(sw * sh);
    for (var y = 0; y < sh; y++) {
      var y0 = Math.floor(y * H / sh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / sh));
      for (var x = 0; x < sw; x++) {
        var x0 = Math.floor(x * W / sw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / sw));
        var sr = 0, sg = 0, sb = 0, cnt = 0;
        for (var yy = y0; yy < y1; yy++) {
          var rowBase = yy * W;
          for (var xx = x0; xx < x1; xx++) {
            var o = (rowBase + xx) * 4;
            sr += data[o]; sg += data[o + 1]; sb += data[o + 2];
            cnt++;
          }
        }
        var idx = y * sw + x;
        cr[idx] = sr / cnt; cg[idx] = sg / cnt; cb[idx] = sb / cnt;
      }
    }
    return { cr: cr, cg: cg, cb: cb };
  }

  function upscaleBilinear(alpha, sw, sh, W, H) {
    var out = new Float64Array(W * H);
    for (var y = 0; y < H; y++) {
      var fy = (y + 0.5) * sh / H - 0.5;
      var y0 = Math.floor(fy);
      var wy = fy - y0;
      var ya = Math.max(0, Math.min(sh - 1, y0));
      var yb = Math.max(0, Math.min(sh - 1, y0 + 1));
      for (var x = 0; x < W; x++) {
        var fx = (x + 0.5) * sw / W - 0.5;
        var x0 = Math.floor(fx);
        var wx = fx - x0;
        var xa = Math.max(0, Math.min(sw - 1, x0));
        var xb = Math.max(0, Math.min(sw - 1, x0 + 1));
        var v00 = alpha[ya * sw + xa], v01 = alpha[ya * sw + xb];
        var v10 = alpha[yb * sw + xa], v11 = alpha[yb * sw + xb];
        out[y * W + x] = (v00 * (1 - wx) + v01 * wx) * (1 - wy)
                       + (v10 * (1 - wx) + v11 * wx) * wy;
      }
    }
    return out;
  }

  function makeImageData(w, h, data) {
    if (typeof ImageData !== 'undefined') {
      var img = new ImageData(w, h);
      img.data.set(data);
      return img;
    }
    // 非浏览器环境（如 Node 自测）退化为同形状的普通对象
    return { width: w, height: h, data: data };
  }

  // =====================================================================
  // 对外入口：MTGrabCut.cut(imageData, rect)
  // =====================================================================
  function cut(imageData, rect) {
    var W = imageData.width, H = imageData.height;
    var data = imageData.data;
    var scale = Math.min(1, MAX_SIDE / Math.max(W, H));
    var sw = Math.max(1, Math.round(W * scale));
    var sh = Math.max(1, Math.round(H * scale));

    var small = downscaleBox(data, W, H, sw, sh);

    // rect 映射到计算图坐标（对应 CutoutPanel 的缩放方式，w/h 至少 2）
    var fx = sw / W, fy = sh / H;
    var sr = rect ? {
      x: Math.floor(rect.x * fx),
      y: Math.floor(rect.y * fy),
      w: Math.max(2, Math.floor(rect.w * fx)),
      h: Math.max(2, Math.floor(rect.h * fy))
    } : null;

    var alphaSmall = grabCutAlpha(small.cr, small.cg, small.cb, sw, sh, sr, ITERATIONS);
    var alphaFull = (sw === W && sh === H)
      ? alphaSmall
      : upscaleBilinear(alphaSmall, sw, sh, W, H);

    var outData = new Uint8ClampedArray(data.length);
    for (var i = 0, p = 0; i < W * H; i++, p += 4) {
      outData[p] = data[p];
      outData[p + 1] = data[p + 1];
      outData[p + 2] = data[p + 2];
      var a = Math.round(alphaFull[i]);
      outData[p + 3] = a < 0 ? 0 : (a > 255 ? 255 : a);
    }
    return makeImageData(W, H, outData);
  }

  var api = { cut: cut };
  var root = (typeof window !== 'undefined') ? window : globalThis;
  root.MTGrabCut = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
