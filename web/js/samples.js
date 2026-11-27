// MTSamples — 内置展示样片：全部程序绘制（Canvas2D），零外部图片。
// 三张样片按「能秀什么」设计：风景秀区域修图（天空/水面/绿植掩膜都有料），
// 人像的脸用真实肤色值（过 MTMasks 肤色规则），静物秀光影与调色。
// 绘制用确定性伪随机（同种子同图），山脊点列生成一次、湖面倒影翻转复用。
(function (g) {
  'use strict';
  const W = 960, H = 640;
  const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cv = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const lg = (x, x0, y0, x1, y1, stops) => {
    const gr = x.createLinearGradient(x0, y0, x1, y1);
    for (const [t, c] of stops) gr.addColorStop(t, c);
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
  };
  const ell = (x, cx, cy, rx, ry, fill) => { x.fillStyle = fill; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill(); };
  const poly = (x, pts, fill) => {
    x.fillStyle = fill; x.beginPath();
    pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py));
    x.closePath(); x.fill();
  };
  // 山脊：base 线之上按种子起伏的折线点列（返回点列，可翻转画倒影）
  const ridge = (rand, base, amp, step) => {
    const pts = [[0, H]];
    for (let px = 0; px <= W; px += step) pts.push([px, base - rand() * amp]);
    pts.push([W, H]);
    return pts;
  };
  const cloud = (x, cx, cy, s, a) => {
    for (const [dx, dy, r] of [[0, 0, 1], [-0.85, 0.16, 0.62], [0.85, 0.13, 0.68], [0.25, -0.32, 0.55]])
      ell(x, cx + dx * s, cy + dy * s, r * s, r * s * 0.52, 'rgba(255,255,255,' + a + ')');
  };

  /* ---------- ① 风景：天空 / 远山 / 湖面倒影 / 草地 ---------- */
  function landscape() {
    const c = cv(), x = c.getContext('2d'), rand = rng(20270119);
    lg(x, 0, 0, 0, H * 0.62, [[0, '#2e6bd2'], [0.55, '#79b5e8'], [0.85, '#cfeaff'], [1, '#ffe9c4']]);
    const sg = x.createRadialGradient(W * 0.78, H * 0.15, 4, W * 0.78, H * 0.15, H * 0.30);
    sg.addColorStop(0, 'rgba(255,246,200,.95)'); sg.addColorStop(0.25, 'rgba(255,240,190,.45)'); sg.addColorStop(1, 'rgba(255,240,190,0)');
    x.fillStyle = sg; x.fillRect(0, 0, W, H);
    ell(x, W * 0.78, H * 0.15, 30, 30, '#fff3b0');
    cloud(x, W * 0.24, H * 0.16, 62, 0.92); cloud(x, W * 0.55, H * 0.26, 42, 0.8); cloud(x, W * 0.88, H * 0.34, 36, 0.7);
    const far = ridge(rand, H * 0.60, H * 0.20, 90);   // 远山（蓝紫）
    const mid = ridge(rand, H * 0.62, H * 0.13, 70);   // 近山（蓝绿）
    poly(x, far, '#7189bd'); poly(x, mid, '#3f7355');
    // 湖面：0.60H–0.84H，先铺水色，再把两列山脊绕湖岸线翻转作倒影
    const lakeY = H * 0.60;
    x.save(); x.beginPath(); x.rect(0, lakeY, W, H * 0.24); x.clip();
    lg(x, 0, lakeY, 0, H * 0.84, [[0, '#a8d2f2'], [1, '#5f97c8']]);
    x.globalAlpha = 0.38;
    for (const [pts, col] of [[far, '#7189bd'], [mid, '#3f7355']])
      poly(x, pts.map(([px, py]) => [px, py > lakeY ? py : 2 * lakeY - py]), col);
    x.globalAlpha = 1;
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const ry = lakeY + 8 + rand() * H * 0.21, rx = rand() * W, rw = 26 + rand() * 90;
      x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx + rw, ry); x.stroke();
    }
    x.restore();
    x.fillStyle = '#69a84f'; x.fillRect(0, H * 0.84, W, H * 0.16);
    const grd = x.createLinearGradient(0, H * 0.84, 0, H);
    grd.addColorStop(0, 'rgba(255,255,220,.20)'); grd.addColorStop(1, 'rgba(20,60,20,.25)');
    x.fillStyle = grd; x.fillRect(0, H * 0.84, W, H * 0.16);
    for (const col of ['#ff8fb2', '#ffd94d', '#ffffff', '#ff7b72'])
      for (let i = 0; i < 16; i++) ell(x, rand() * W, H * 0.86 + rand() * H * 0.12, 3.2, 3.2, col);
    return c;
  }

  /* ---------- ② 人像：肤色人物 + 冷色影棚背景（肤色/虚化/抠图都好秀） ---------- */
  function portrait() {
    const c = cv(), x = c.getContext('2d');
    lg(x, 0, 0, 0, H, [[0, '#93bccd'], [0.7, '#527a8c'], [1, '#3c5a66']]);
    const rg = x.createRadialGradient(W / 2, H * 0.30, 10, W / 2, H * 0.30, H * 0.62);
    rg.addColorStop(0, 'rgba(255,255,255,.38)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(30,48,56,.35)'; x.fillRect(0, H * 0.82, W, H * 0.18);   // 地面带
    ell(x, W / 2, H * 0.86, W * 0.20, H * 0.035, 'rgba(20,35,42,.35)');          // 脚下软影
    const SKIN = '#edbe9b', SKIN_D = '#d6a480', HAIR = '#3a2a20', TOP = '#2b4a73';
    ell(x, W / 2, H * 0.40, W * 0.185, H * 0.30, HAIR);                          // 头发（后层）
    poly(x, [[W * 0.335, H], [W * 0.36, H * 0.60], [W * 0.44, H * 0.52], [W * 0.56, H * 0.52], [W * 0.64, H * 0.60], [W * 0.665, H]], TOP); // 上衣/肩
    poly(x, [[W * 0.465, H * 0.44], [W * 0.535, H * 0.44], [W * 0.525, H * 0.56], [W * 0.475, H * 0.56]], SKIN_D); // 脖子
    ell(x, W / 2, H * 0.315, W * 0.088, H * 0.125, SKIN);                       // 脸
    ell(x, W / 2 - W * 0.030, H * 0.285, W * 0.045, H * 0.055, 'rgba(255,235,210,.5)'); // 额头高光
    ell(x, W / 2 - W * 0.052, H * 0.375, W * 0.020, H * 0.020, 'rgba(240,150,130,.38)'); // 腮红
    ell(x, W / 2 + W * 0.052, H * 0.375, W * 0.020, H * 0.020, 'rgba(240,150,130,.38)');
    x.fillStyle = HAIR;                                                          // 刘海 + 两侧发梢
    x.beginPath(); x.ellipse(W / 2, H * 0.235, W * 0.092, H * 0.055, 0, Math.PI, 7); x.fill();
    x.fillRect(W * 0.408, H * 0.22, W * 0.020, H * 0.30); x.fillRect(W * 0.572, H * 0.22, W * 0.020, H * 0.30);
    x.strokeStyle = 'rgba(60,40,30,.85)'; x.lineWidth = 3.4; x.lineCap = 'round';
    for (const s of [-1, 1]) {                                                   // 眼睛 + 眉毛（极简线条）
      x.beginPath(); x.ellipse(W / 2 + s * W * 0.034, H * 0.325, W * 0.013, H * 0.0075, 0, 0.25, Math.PI - 0.25); x.stroke();
      x.beginPath(); x.moveTo(W / 2 + s * W * 0.050, H * 0.292); x.quadraticCurveTo(W / 2 + s * W * 0.033, H * 0.283, W / 2 + s * W * 0.017, H * 0.291); x.stroke();
    }
    x.strokeStyle = 'rgba(190,130,95,.7)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(W / 2 + 3, H * 0.335); x.lineTo(W / 2 - 2, H * 0.372); x.stroke();  // 鼻影
    ell(x, W / 2, H * 0.408, W * 0.021, H * 0.0095, '#c96f5e');                  // 嘴唇
    ell(x, W / 2 - W * 0.128, H * 0.60, W * 0.030, H * 0.115, SKIN);             // 两臂（肤色，增加肤色面积）
    ell(x, W / 2 + W * 0.128, H * 0.60, W * 0.030, H * 0.115, SKIN);
    ell(x, W / 2 - W * 0.128, H * 0.60, W * 0.031, H * 0.045, TOP);              // 袖口
    ell(x, W / 2 + W * 0.128, H * 0.60, W * 0.031, H * 0.045, TOP);
    return c;
  }

  /* ---------- ③ 静物：花瓶鲜花 + 水果 + 窗光 ---------- */
  function still() {
    const c = cv(), x = c.getContext('2d'), rand = rng(77031);
    lg(x, 0, 0, 0, H, [[0, '#d3c8b6'], [0.68, '#b3a58d'], [0.7, '#8a5a34'], [1, '#66401f']]); // 墙 + 桌面
    x.fillStyle = 'rgba(255,246,220,.92)'; x.fillRect(W * 0.055, H * 0.07, W * 0.27, H * 0.42);  // 窗
    x.strokeStyle = '#8d7c63'; x.lineWidth = 7; x.strokeRect(W * 0.055, H * 0.07, W * 0.27, H * 0.42);
    x.lineWidth = 4; x.beginPath();
    x.moveTo(W * 0.19, H * 0.07); x.lineTo(W * 0.19, H * 0.49); x.moveTo(W * 0.055, H * 0.28); x.lineTo(W * 0.325, H * 0.28); x.stroke();
    poly(x, [[W * 0.10, H * 0.49], [W * 0.325, H * 0.49], [W * 0.86, H], [W * 0.52, H]], 'rgba(255,250,225,.16)'); // 光束
    const shadow = (cx, cy, rx) => ell(x, cx, cy, rx, rx * 0.22, 'rgba(40,22,8,.30)');
    const vx = W * 0.60, vb = H * 0.86;                                            // 花瓶
    shadow(vx, vb + 8, W * 0.115);
    x.fillStyle = '#2e7f86';
    x.beginPath();
    x.moveTo(vx - W * 0.028, H * 0.47);
    x.bezierCurveTo(vx - W * 0.115, H * 0.60, vx - W * 0.105, H * 0.78, vx - W * 0.062, vb);
    x.lineTo(vx + W * 0.062, vb);
    x.bezierCurveTo(vx + W * 0.105, H * 0.78, vx + W * 0.115, H * 0.60, vx + W * 0.028, H * 0.47);
    x.closePath(); x.fill();
    ell(x, vx, H * 0.47, W * 0.030, H * 0.012, '#35919a');                        // 瓶口
    ell(x, vx - W * 0.045, H * 0.66, W * 0.016, H * 0.13, 'rgba(255,255,255,.30)'); // 瓶身高光
    const blooms = [[0.50, 0.30, '#e86a92'], [0.60, 0.22, '#d94f4f'], [0.70, 0.31, '#f2c14e'], [0.55, 0.155, '#f2c14e'], [0.665, 0.15, '#e86a92']];
    x.strokeStyle = '#3e7a3a'; x.lineWidth = 4.5;
    for (const [bx, by] of blooms) { x.beginPath(); x.moveTo(vx, H * 0.475); x.quadraticCurveTo(W * (bx + 0.60) / 2, H * (by + 0.47) / 2, W * bx, H * by); x.stroke(); }
    for (const [bx, by] of [[0.545, 0.36], [0.645, 0.335]])                      // 叶子
      ell(x, W * bx, H * by, W * 0.020, H * 0.010, '#4c8a44');
    for (const [bx, by, col] of blooms) {                                        // 花朵：6 瓣 + 花心
      for (let p = 0; p < 6; p++) {
        const a = p / 6 * Math.PI * 2;
        ell(x, W * bx + Math.cos(a) * W * 0.020, H * by + Math.sin(a) * H * 0.020, W * 0.0165, H * 0.0165, col);
      }
      ell(x, W * bx, H * by, W * 0.010, H * 0.010, '#fff3f0');
    }
    const fruit = (cx, cy, r, col, hi) => {                                      // 水果：圆身 + 高光 + 梗
      shadow(cx, cy + r * 0.92, r * 1.02);
      ell(x, cx, cy, r, r * 0.94, col);
      ell(x, cx - r * 0.34, cy - r * 0.36, r * 0.30, r * 0.20, 'rgba(255,255,255,.45)');
      x.strokeStyle = '#5a4020'; x.lineWidth = 4;
      x.beginPath(); x.moveTo(cx, cy - r * 0.90); x.quadraticCurveTo(cx + r * 0.10, cy - r * 1.18, cx + r * 0.26, cy - r * 1.22); x.stroke();
      if (hi) ell(x, cx + r * 0.22, cy - r * 1.02, r * 0.20, r * 0.10, '#5f9e4e');
    };
    fruit(W * 0.20, H * 0.80, 56, '#c93a30');
    fruit(W * 0.315, H * 0.825, 47, '#ee8f2c');
    fruit(W * 0.415, H * 0.795, 50, '#b7c95e', true);
    x.fillStyle = '#5d6d8c'; x.fillRect(W * 0.815, H * 0.755, W * 0.125, H * 0.030);  // 书堆
    x.fillStyle = '#96604a'; x.fillRect(W * 0.83, H * 0.79, W * 0.105, H * 0.028);
    for (let i = 0; i < 26; i++)                                                 // 桌面浮尘光点
      ell(x, rand() * W, rand() * H * 0.6, 1.6, 1.6, 'rgba(255,250,220,.35)');
    return c;
  }

  const PAINTERS = { landscape, portrait, still };
  g.MTSamples = {
    list: [
      { id: 'landscape', name: '风景' },
      { id: 'portrait', name: '人像' },
      { id: 'still', name: '静物' },
    ],
    make(id) { const p = PAINTERS[id]; return p ? p() : null; },
  };
})(window);
