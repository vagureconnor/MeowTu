package meowtu.filters;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

/**
 * 喵图滤镜集合：纯 JDK 实现（仅 java.awt.image / java.util），零第三方依赖。
 * 全部滤镜不修改原图，返回 TYPE_INT_ARGB 新图；strength 为 0..1，0 时与原图一致。
 */
public final class Filters {

    /** 滤镜定义：id 为调用标识，name 为中文显示名。 */
    public static final class Def {
        public final String id;
        public final String name;

        public Def(String id, String name) {
            this.id = id;
            this.name = name;
        }

        @Override
        public String toString() {
            return id + "(" + name + ")";
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Def)) return false;
            Def d = (Def) o;
            return id.equals(d.id) && name.equals(d.name);
        }

        @Override
        public int hashCode() {
            return id.hashCode() * 31 + name.hashCode();
        }
    }

    // 固定顺序的 18 个滤镜
    private static final List<Def> ALL = List.of(
            new Def("vintage", "复古"),
            new Def("oldphoto", "老照片"),
            new Def("bw", "黑白"),
            new Def("faded", "褪色"),
            new Def("japanese", "日系"),
            new Def("tealorange", "青橙"),
            new Def("oilpaint", "油画"),
            new Def("sketch", "素描"),
            new Def("colorpencil", "彩铅"),
            new Def("emboss", "浮雕"),
            new Def("mosaic", "马赛克"),
            new Def("watercolor", "水彩"),
            new Def("softglow", "梦幻柔光"),
            new Def("halo", "光晕"),
            new Def("xray", "X光"),
            new Def("infrared", "红外"),
            new Def("thermal", "热力"),
            new Def("nightvision", "夜视")
    );

    private Filters() {
    }

    /** 返回全部滤镜定义（顺序固定，返回副本可放心修改）。 */
    public static List<Def> all() {
        return new ArrayList<>(ALL);
    }

    /**
     * 应用滤镜。
     *
     * @param id       滤镜 id，未知 id 返回原图副本
     * @param src      源图，不会被修改
     * @param strength 强度 0..1（越界自动钳制），0 时与原图一致
     * @return 新图（TYPE_INT_ARGB）
     */
    public static BufferedImage apply(String id, BufferedImage src, double strength) {
        if (src == null) return null;
        int w = src.getWidth();
        int h = src.getHeight();
        int[] px = src.getRGB(0, 0, w, h, null, 0, w);
        double s = Double.isNaN(strength) ? 0.0 : Math.max(0.0, Math.min(1.0, strength));
        if (id == null || s <= 0.0) {
            return toImage(px, w, h);
        }
        int[] full;
        switch (id) {
            case "vintage":     full = vintage(px, w, h); break;
            case "oldphoto":    full = oldPhoto(px, w, h); break;
            case "bw":          full = blackWhite(px, w, h); break;
            case "faded":       full = faded(px, w, h); break;
            case "japanese":    full = japanese(px, w, h); break;
            case "tealorange":  full = tealOrange(px, w, h); break;
            case "oilpaint":    full = oilPaint(px, w, h); break;
            case "sketch":      full = sketch(px, w, h); break;
            case "colorpencil": full = colorPencil(px, w, h); break;
            case "emboss":      full = emboss(px, w, h); break;
            case "mosaic":      full = mosaic(px, w, h, s); break;
            case "watercolor":  full = watercolor(px, w, h); break;
            case "softglow":    full = softGlow(px, w, h); break;
            case "halo":        full = halo(px, w, h); break;
            case "xray":        full = xray(px, w, h); break;
            case "infrared":    full = infrared(px, w, h); break;
            case "thermal":     full = thermal(px, w, h); break;
            case "nightvision": full = nightVision(px, w, h); break;
            default:            return toImage(px, w, h);
        }
        // 全强度结果与原图按 strength 混合，保证 0 时原样、过渡平滑
        int[] out = (s >= 1.0) ? full : blend(px, full, s);
        return toImage(out, w, h);
    }

    // ================= 通用小工具 =================

    private static BufferedImage toImage(int[] px, int w, int h) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        img.setRGB(0, 0, w, h, px, 0, w);
        return img;
    }

    private static int clamp255(int v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    /** double 值四舍五入并钳制到 0..255。 */
    private static int clampD(double v) {
        return v < 0 ? 0 : (v > 255 ? 255 : (int) (v + 0.5));
    }

    private static int mix(int a, int b, double t) {
        return clampD(a + (b - a) * t);
    }

    private static int pack(int alpha, int r, int g, int b) {
        return (alpha << 24) | (r << 16) | (g << 8) | b;
    }

    /** 明度（0..255）。 */
    private static int lum(int r, int g, int b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    private static int[] lumArray(int[] px) {
        int[] lum = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            lum[i] = lum((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
        }
        return lum;
    }

    /** 按强度 t 把 full 混合到 orig 上（alpha 取原图）。 */
    private static int[] blend(int[] orig, int[] full, double t) {
        int[] out = new int[orig.length];
        double u = 1.0 - t;
        for (int i = 0; i < orig.length; i++) {
            int o = orig[i], f = full[i];
            int r = clampD(((o >> 16) & 0xFF) * u + ((f >> 16) & 0xFF) * t);
            int g = clampD(((o >> 8) & 0xFF) * u + ((f >> 8) & 0xFF) * t);
            int b = clampD((o & 0xFF) * u + (f & 0xFF) * t);
            out[i] = (o & 0xFF000000) | (r << 16) | (g << 8) | b;
        }
        return out;
    }

    /** 饱和度调整：以明度为锚缩放各通道（f=1 不变，0 为灰度）。 */
    private static int sat(int c, int lum, double f) {
        return clampD(lum + (c - lum) * f);
    }

    /** 归一化径向距离平方：中心 0，角落约 2。 */
    private static double dist2(int x, int y, int w, int h) {
        double nx = (w <= 1) ? 0 : (x - (w - 1) / 2.0) / ((w - 1) / 2.0);
        double ny = (h <= 1) ? 0 : (y - (h - 1) / 2.0) / ((h - 1) / 2.0);
        return nx * nx + ny * ny;
    }

    /** 暗角：amount 越大四角越暗（0..1）。 */
    private static void applyVignette(int[] px, int w, int h, double amount) {
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                double d2 = dist2(x, y, w, h);
                double t = (d2 - 0.35) / 1.3;
                t = t < 0 ? 0 : (t > 1 ? 1 : t);
                t = t * t * (3 - 2 * t); // smoothstep
                if (t <= 0) continue;
                double f = 1.0 - amount * t;
                int i = y * w + x;
                int p = px[i];
                int r = clampD(((p >> 16) & 0xFF) * f);
                int g = clampD(((p >> 8) & 0xFF) * f);
                int b = clampD((p & 0xFF) * f);
                px[i] = (p & 0xFF000000) | (r << 16) | (g << 8) | b;
            }
        }
    }

    /** 确定性伪随机噪声，范围约 [-1, 1]，同坐标结果稳定。 */
    private static double noise(int x, int y, int seed) {
        int n = x * 374761393 + y * 668265263 + seed * 974711;
        n = (n ^ (n >> 13)) * 1274126177;
        n = n ^ (n >> 16);
        return ((n & 0xFFFF) / 32767.5) - 1.0;
    }

    // ================= 可分离高斯模糊（盒式模糊三遍近似，O(n)，与半径无关） =================

    private static int clampIdx(int i, int size) {
        return i < 0 ? 0 : (i >= size ? size - 1 : i);
    }

    private static void boxBlurH(float[] src, float[] dst, int w, int h, int r) {
        int diam = 2 * r + 1;
        for (int y = 0; y < h; y++) {
            int base = y * w;
            float sum = 0;
            for (int i = -r; i <= r; i++) sum += src[base + clampIdx(i, w)];
            for (int x = 0; x < w; x++) {
                dst[base + x] = sum / diam;
                sum += src[base + clampIdx(x + r + 1, w)] - src[base + clampIdx(x - r, w)];
            }
        }
    }

    private static void boxBlurV(float[] src, float[] dst, int w, int h, int r) {
        int diam = 2 * r + 1;
        for (int x = 0; x < w; x++) {
            float sum = 0;
            for (int i = -r; i <= r; i++) sum += src[clampIdx(i, h) * w + x];
            for (int y = 0; y < h; y++) {
                dst[y * w + x] = sum / diam;
                sum += src[clampIdx(y + r + 1, h) * w + x] - src[clampIdx(y - r, h) * w + x];
            }
        }
    }

    /** 单通道高斯模糊（原地），sigma 为标准差。 */
    private static void gaussianBlur(float[] ch, int w, int h, double sigma) {
        if (sigma < 0.4 || ch.length == 0) return;
        float[] tmp = new float[ch.length];
        int n = 3;
        double wl = Math.floor(Math.sqrt(12 * sigma * sigma / n + 1));
        if (((int) wl) % 2 == 0) wl -= 1;
        if (wl < 1) wl = 1;
        double wu = wl + 2;
        double mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
        int m = (int) Math.round(mIdeal);
        m = Math.max(0, Math.min(n, m));
        for (int i = 0; i < n; i++) {
            int size = (i < m) ? (int) wl : (int) wu;
            int r = (size - 1) / 2;
            if (r <= 0) continue;
            boxBlurH(ch, tmp, w, h, r);
            boxBlurV(tmp, ch, w, h, r);
        }
    }

    /** 整图高斯模糊，返回新像素数组（alpha 保留）。 */
    private static int[] blurImage(int[] px, int w, int h, double sigma) {
        int n = w * h;
        float[] fr = new float[n];
        float[] fg = new float[n];
        float[] fb = new float[n];
        for (int i = 0; i < n; i++) {
            int p = px[i];
            fr[i] = (p >> 16) & 0xFF;
            fg[i] = (p >> 8) & 0xFF;
            fb[i] = p & 0xFF;
        }
        gaussianBlur(fr, w, h, sigma);
        gaussianBlur(fg, w, h, sigma);
        gaussianBlur(fb, w, h, sigma);
        int[] out = new int[n];
        for (int i = 0; i < n; i++) {
            out[i] = (px[i] & 0xFF000000)
                    | (clampD(fr[i]) << 16) | (clampD(fg[i]) << 8) | clampD(fb[i]);
        }
        return out;
    }

    // ================= 色调类滤镜（全强度版本） =================

    /** 棕褐色调（sepia 矩阵）。 */
    private static void sepia(int[] rgb, double t) {
        int r = rgb[0], g = rgb[1], b = rgb[2];
        int sr = clamp255((int) (0.393 * r + 0.769 * g + 0.189 * b));
        int sg = clamp255((int) (0.349 * r + 0.686 * g + 0.168 * b));
        int sb = clamp255((int) (0.272 * r + 0.534 * g + 0.131 * b));
        rgb[0] = mix(r, sr, t);
        rgb[1] = mix(g, sg, t);
        rgb[2] = mix(b, sb, t);
    }

    // 复古：棕褐色调 + 轻微褪色 + 暗角
    private static int[] vintage(int[] px, int w, int h) {
        int[] out = new int[px.length];
        int[] c = new int[3];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            c[0] = (p >> 16) & 0xFF;
            c[1] = (p >> 8) & 0xFF;
            c[2] = p & 0xFF;
            sepia(c, 0.62);
            // 轻微褪色：略压对比、抬黑位
            for (int k = 0; k < 3; k++) c[k] = clampD(c[k] * 0.93 + 9);
            out[i] = pack(p >>> 24, c[0], c[1], c[2]);
        }
        applyVignette(out, w, h, 0.38);
        return out;
    }

    // 老照片：强 sepia + 褪色 + 噪点 + 更重暗角
    private static int[] oldPhoto(int[] px, int w, int h) {
        int[] out = new int[px.length];
        int[] c = new int[3];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                int p = px[i];
                c[0] = (p >> 16) & 0xFF;
                c[1] = (p >> 8) & 0xFF;
                c[2] = p & 0xFF;
                sepia(c, 0.9);
                double nz = noise(x, y, 7) * 13;
                for (int k = 0; k < 3; k++) c[k] = clampD(c[k] * 0.82 + 16 + nz);
                out[i] = pack(p >>> 24, c[0], c[1], c[2]);
            }
        }
        applyVignette(out, w, h, 0.6);
        return out;
    }

    // 黑白：明度灰度 + 略提对比
    private static int[] blackWhite(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int v = lum((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
            v = clampD((v - 128) * 1.18 + 128);
            out[i] = pack(p >>> 24, v, v, v);
        }
        return out;
    }

    // 褪色：降对比、抬黑位、降饱和
    private static int[] faded(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            int l = lum(r, g, b);
            r = sat(r, l, 0.62);
            g = sat(g, l, 0.62);
            b = sat(b, l, 0.62);
            // 输出范围压缩到约 [28, 226]
            r = clampD(28 + r * 0.78);
            g = clampD(28 + g * 0.78);
            b = clampD(30 + b * 0.78);
            out[i] = pack(p >>> 24, r, g, b);
        }
        return out;
    }

    // 日系：提亮、降对比、偏青蓝、柔和
    private static int[] japanese(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            int l = lum(r, g, b);
            r = sat(r, l, 0.82);
            g = sat(g, l, 0.82);
            b = sat(b, l, 0.82);
            double t = l / 255.0;
            r = clampD((r - 128) * 0.84 + 128 + 15 - 4);
            g = clampD((g - 128) * 0.84 + 128 + 15 + 3);
            b = clampD((b - 128) * 0.84 + 128 + 15 + 12 + (1 - t) * 8); // 阴影再添青蓝
            out[i] = pack(p >>> 24, r, g, b);
        }
        return out;
    }

    // 青橙：阴影偏青、高光偏橙（分色调）+ 饱和提升
    private static int[] tealOrange(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            int l = lum(r, g, b);
            r = sat(r, l, 1.24);
            g = sat(g, l, 1.24);
            b = sat(b, l, 1.24);
            double t = l / 255.0;
            double sw = (1 - t) * (1 - t); // 阴影权重
            double hw = t * t;            // 高光权重
            r = clampD((r - 128) * 1.05 + 128 - 9 * sw + 15 * hw);
            g = clampD((g - 128) * 1.05 + 128 + 6 * sw + 4 * hw);
            b = clampD((b - 128) * 1.05 + 128 + 17 * sw - 13 * hw);
            out[i] = pack(p >>> 24, r, g, b);
        }
        return out;
    }

    // ================= 空间类滤镜 =================

    private static long rectSum(long[] integral, int iw, int x0, int y0, int x1, int y1) {
        return integral[y1 * iw + x1] - integral[y0 * iw + x1]
                - integral[y1 * iw + x0] + integral[y0 * iw + x0];
    }

    // 油画：Kuwahara 滤波（4 子区取方差最小者均值），积分图加速，分条处理省内存
    private static int[] oilPaint(int[] px, int w, int h) {
        int n = w * h;
        int[] out = new int[n];
        int r = Math.max(3, Math.min(5, Math.min(w, h) / 250)); // 半径随图尺寸 3~5
        int strip = 256;
        int maxRows = Math.min(h, strip + 2 * r);
        int iw = w + 1;
        long[] sR = new long[iw * (maxRows + 1)];
        long[] sG = new long[iw * (maxRows + 1)];
        long[] sB = new long[iw * (maxRows + 1)];
        long[] sQ = new long[iw * (maxRows + 1)]; // 明度平方和，用于方差
        for (int y0 = 0; y0 < h; y0 += strip) {
            int y1 = Math.min(h, y0 + strip);
            int ry0 = Math.max(0, y0 - r);
            int ry1 = Math.min(h, y1 + r);
            int rows = ry1 - ry0;
            // 建本条（含光晕行）的积分图
            for (int yy = 0; yy < rows; yy++) {
                int srcBase = (ry0 + yy) * w;
                int iBase = (yy + 1) * iw;
                int iUp = yy * iw;
                long runR = 0, runG = 0, runB = 0, runQ = 0;
                for (int xx = 0; xx < w; xx++) {
                    int p = px[srcBase + xx];
                    int cr = (p >> 16) & 0xFF, cg = (p >> 8) & 0xFF, cb = p & 0xFF;
                    int l = lum(cr, cg, cb);
                    runR += cr;
                    runG += cg;
                    runB += cb;
                    runQ += (long) l * l;
                    sR[iBase + xx + 1] = sR[iUp + xx + 1] + runR;
                    sG[iBase + xx + 1] = sG[iUp + xx + 1] + runG;
                    sB[iBase + xx + 1] = sB[iUp + xx + 1] + runB;
                    sQ[iBase + xx + 1] = sQ[iUp + xx + 1] + runQ;
                }
            }
            // 逐像素选方差最小的子区
            for (int y = y0; y < y1; y++) {
                for (int x = 0; x < w; x++) {
                    double bestVar = Double.MAX_VALUE;
                    int br = 0, bg = 0, bb = 0;
                    for (int q = 0; q < 4; q++) {
                        int qx0, qx1, qy0, qy1;
                        if (q == 0)      { qx0 = x - r; qx1 = x + 1;     qy0 = y - r; qy1 = y + 1; }
                        else if (q == 1) { qx0 = x;     qx1 = x + r + 1; qy0 = y - r; qy1 = y + 1; }
                        else if (q == 2) { qx0 = x - r; qx1 = x + 1;     qy0 = y;     qy1 = y + r + 1; }
                        else             { qx0 = x;     qx1 = x + r + 1; qy0 = y;     qy1 = y + r + 1; }
                        qx0 = Math.max(0, qx0);
                        qx1 = Math.min(w, qx1);
                        qy0 = Math.max(0, qy0);
                        qy1 = Math.min(h, qy1);
                        int iy0 = qy0 - ry0, iy1 = qy1 - ry0;
                        long sumR = rectSum(sR, iw, qx0, iy0, qx1, iy1);
                        long sumG = rectSum(sG, iw, qx0, iy0, qx1, iy1);
                        long sumB = rectSum(sB, iw, qx0, iy0, qx1, iy1);
                        long sumQ = rectSum(sQ, iw, qx0, iy0, qx1, iy1);
                        double cnt = (double) (qx1 - qx0) * (qy1 - qy0);
                        double meanL = (0.299 * sumR + 0.587 * sumG + 0.114 * sumB) / cnt;
                        double var = sumQ / cnt - meanL * meanL;
                        if (var < bestVar) {
                            bestVar = var;
                            br = (int) (sumR / cnt + 0.5);
                            bg = (int) (sumG / cnt + 0.5);
                            bb = (int) (sumB / cnt + 0.5);
                        }
                    }
                    int idx = y * w + x;
                    out[idx] = (px[idx] & 0xFF000000) | (br << 16) | (bg << 8) | bb;
                }
            }
        }
        return out;
    }

    /** 素描灰度值数组：灰度反相模糊后颜色减淡。 */
    private static float[] sketchGray(int[] px, int w, int h) {
        int n = w * h;
        float[] gray = new float[n];
        float[] inv = new float[n];
        for (int i = 0; i < n; i++) {
            int p = px[i];
            float g = lum((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
            gray[i] = g;
            inv[i] = 255f - g;
        }
        double sigma = Math.max(2.5, Math.min(9.0, Math.min(w, h) / 110.0));
        gaussianBlur(inv, w, h, sigma);
        float[] out = new float[n];
        for (int i = 0; i < n; i++) {
            double denom = 255.0 - inv[i];
            double v = (denom <= 0.5) ? 255.0 : gray[i] * 255.0 / denom;
            out[i] = (float) Math.min(255.0, v);
        }
        return out;
    }

    // 素描：铅笔线条（颜色减淡）
    private static int[] sketch(int[] px, int w, int h) {
        float[] s = sketchGray(px, w, h);
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int v = clampD(s[i]);
            out[i] = pack(px[i] >>> 24, v, v, v);
        }
        return out;
    }

    // 彩铅：素描与原色混合并增饱和
    private static int[] colorPencil(int[] px, int w, int h) {
        float[] s = sketchGray(px, w, h);
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            int sv = clampD(s[i]);
            r = clampD(r * 0.55 + sv * 0.45);
            g = clampD(g * 0.55 + sv * 0.45);
            b = clampD(b * 0.55 + sv * 0.45);
            int l = lum(r, g, b);
            r = sat(r, l, 1.35);
            g = sat(g, l, 1.35);
            b = sat(b, l, 1.35);
            out[i] = pack(p >>> 24, clampD(r * 1.03), clampD(g * 1.03), clampD(b * 1.03));
        }
        return out;
    }

    private static int lumAt(int[] lum, int w, int h, int x, int y) {
        return lum[clampIdx(y, h) * w + clampIdx(x, w)];
    }

    // 浮雕：3x3 浮雕卷积核，灰度输出
    private static int[] emboss(int[] px, int w, int h) {
        int[] lum = lumArray(px);
        int[] out = new int[px.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int v = -2 * lumAt(lum, w, h, x - 1, y - 1) - lumAt(lum, w, h, x, y - 1)
                        - lumAt(lum, w, h, x - 1, y)
                        + lumAt(lum, w, h, x, y)
                        + lumAt(lum, w, h, x + 1, y)
                        + lumAt(lum, w, h, x, y + 1) + 2 * lumAt(lum, w, h, x + 1, y + 1)
                        + 128;
                int i = y * w + x;
                int vv = clamp255(v);
                out[i] = pack(px[i] >>> 24, vv, vv, vv);
            }
        }
        return out;
    }

    // 马赛克：方块均值，块大小随强度 4~24px
    private static int[] mosaic(int[] px, int w, int h, double s) {
        int block = Math.max(2, (int) Math.round(4 + s * 20));
        int[] out = new int[px.length];
        for (int by = 0; by < h; by += block) {
            int y1 = Math.min(h, by + block);
            for (int bx = 0; bx < w; bx += block) {
                int x1 = Math.min(w, bx + block);
                long sr = 0, sg = 0, sb = 0;
                int cnt = 0;
                for (int y = by; y < y1; y++) {
                    for (int x = bx; x < x1; x++) {
                        int p = px[y * w + x];
                        sr += (p >> 16) & 0xFF;
                        sg += (p >> 8) & 0xFF;
                        sb += p & 0xFF;
                        cnt++;
                    }
                }
                int ar = (int) (sr / cnt), ag = (int) (sg / cnt), ab = (int) (sb / cnt);
                for (int y = by; y < y1; y++) {
                    for (int x = bx; x < x1; x++) {
                        int i = y * w + x;
                        out[i] = (px[i] & 0xFF000000) | (ar << 16) | (ag << 8) | ab;
                    }
                }
            }
        }
        return out;
    }

    // 水彩：多次小半径平滑 + 色阶量化 + 边缘加深 + 饱和提升
    private static int[] watercolor(int[] px, int w, int h) {
        int[] sm = blurImage(blurImage(px, w, h, 1.6), w, h, 1.6);
        int[] lum = lumArray(px);
        int[] out = new int[px.length];
        int levels = 14;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                int p = sm[i];
                int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                // 色阶量化（部分混合，保留柔和感）
                r = clampD(mix(r, posterize(r, levels), 0.55));
                g = clampD(mix(g, posterize(g, levels), 0.55));
                b = clampD(mix(b, posterize(b, levels), 0.55));
                int l = lum(r, g, b);
                r = sat(r, l, 1.3);
                g = sat(g, l, 1.3);
                b = sat(b, l, 1.3);
                // Sobel 边缘加深
                int gx = -lumAt(lum, w, h, x - 1, y - 1) - 2 * lumAt(lum, w, h, x - 1, y)
                        - lumAt(lum, w, h, x - 1, y + 1)
                        + lumAt(lum, w, h, x + 1, y - 1) + 2 * lumAt(lum, w, h, x + 1, y)
                        + lumAt(lum, w, h, x + 1, y + 1);
                int gy = -lumAt(lum, w, h, x - 1, y - 1) - 2 * lumAt(lum, w, h, x, y - 1)
                        - lumAt(lum, w, h, x + 1, y - 1)
                        + lumAt(lum, w, h, x - 1, y + 1) + 2 * lumAt(lum, w, h, x, y + 1)
                        + lumAt(lum, w, h, x + 1, y + 1);
                double e = Math.min(1.0, (Math.abs(gx) + Math.abs(gy)) / 765.0);
                double f = 1.0 - 0.45 * e;
                out[i] = pack(px[i] >>> 24, clampD(r * f), clampD(g * f), clampD(b * f));
            }
        }
        return out;
    }

    private static int posterize(int v, int levels) {
        double step = 255.0 / (levels - 1);
        return clampD(Math.round(v / step) * step);
    }

    // ================= 光效与伪彩类滤镜 =================

    // 梦幻柔光：模糊提亮后滤色（screen）混合
    private static int[] softGlow(int[] px, int w, int h) {
        double sigma = Math.max(3.0, Math.min(10.0, Math.min(w, h) / 90.0));
        int[] bl = blurImage(px, w, h, sigma);
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i], q = bl[i];
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            int gr = clampD(((q >> 16) & 0xFF) * 1.28 + 10);
            int gg = clampD(((q >> 8) & 0xFF) * 1.28 + 10);
            int gb = clampD((q & 0xFF) * 1.28 + 10);
            // screen 混合后与原图 3:1 混合，避免过曝
            int sr = 255 - (255 - r) * (255 - gr) / 255;
            int sg = 255 - (255 - g) * (255 - gg) / 255;
            int sb = 255 - (255 - b) * (255 - gb) / 255;
            out[i] = pack(p >>> 24, mix(r, sr, 0.75), mix(g, sg, 0.75), mix(b, sb, 0.75));
        }
        return out;
    }

    // 光晕：强模糊加色混合，中心更亮
    private static int[] halo(int[] px, int w, int h) {
        double sigma = Math.max(8.0, Math.min(26.0, Math.min(w, h) / 45.0));
        int[] bl = blurImage(px, w, h, sigma);
        int[] out = new int[px.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                int p = px[i], q = bl[i];
                double cf = 1.0 + 0.22 * Math.max(0.0, 1.0 - dist2(x, y, w, h) / 1.2);
                int r = clampD(((p >> 16) & 0xFF) + ((q >> 16) & 0xFF) * 0.55);
                int g = clampD(((p >> 8) & 0xFF) + ((q >> 8) & 0xFF) * 0.55);
                int b = clampD((p & 0xFF) + (q & 0xFF) * 0.55);
                out[i] = pack(p >>> 24, clampD(r * cf), clampD(g * cf), clampD(b * cf));
            }
        }
        return out;
    }

    // X光：反相 + 偏蓝青 + 提对比
    private static int[] xray(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = 255 - ((p >> 16) & 0xFF);
            int g = 255 - ((p >> 8) & 0xFF);
            int b = 255 - (p & 0xFF);
            r = clampD((r - 128) * 1.3 + 128);
            g = clampD((g - 128) * 1.3 + 128);
            b = clampD((b - 128) * 1.3 + 128);
            out[i] = pack(p >>> 24, clampD(r * 0.70), clampD(g * 0.92), clampD(b * 1.05));
        }
        return out;
    }

    // 红外：通道重排近似（植被发红发白、天空变暗）
    private static int[] infrared(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            int nr = g;
            int ng = clampD(b * 0.6 + r * 0.4);
            int nb = r;
            // 植被（绿色占优）额外提红提亮，近似红外胶片效果
            double veg = Math.max(0.0, Math.min(1.0, (g - Math.max(r, b)) / 96.0));
            nr = clampD(nr + veg * 55);
            ng = clampD(ng + veg * 22);
            nb = clampD(nb - veg * 12);
            nr = clampD((nr - 128) * 1.08 + 128);
            ng = clampD((ng - 128) * 1.08 + 128);
            nb = clampD((nb - 128) * 1.08 + 128);
            int l = lum(nr, ng, nb);
            out[i] = pack(p >>> 24, sat(nr, l, 1.15), sat(ng, l, 1.15), sat(nb, l, 1.15));
        }
        return out;
    }

    // 热力伪彩色映射表：黑→紫→红→橙→黄→白
    private static final double[] THERMAL_POS = {0.0, 0.16, 0.32, 0.48, 0.63, 0.78, 0.90, 1.0};
    private static final int[][] THERMAL_RGB = {
            {0, 0, 0}, {40, 0, 90}, {120, 0, 160}, {215, 25, 45},
            {255, 110, 0}, {255, 185, 10}, {255, 245, 90}, {255, 255, 255}
    };

    // 热力：按明度映射伪彩色
    private static int[] thermal(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            double t = lum((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF) / 255.0;
            int seg = 0;
            while (seg < THERMAL_POS.length - 2 && t > THERMAL_POS[seg + 1]) seg++;
            double f = (t - THERMAL_POS[seg]) / (THERMAL_POS[seg + 1] - THERMAL_POS[seg]);
            int r = clampD(THERMAL_RGB[seg][0] + (THERMAL_RGB[seg + 1][0] - THERMAL_RGB[seg][0]) * f);
            int g = clampD(THERMAL_RGB[seg][1] + (THERMAL_RGB[seg + 1][1] - THERMAL_RGB[seg][1]) * f);
            int b = clampD(THERMAL_RGB[seg][2] + (THERMAL_RGB[seg + 1][2] - THERMAL_RGB[seg][2]) * f);
            out[i] = pack(p >>> 24, r, g, b);
        }
        return out;
    }

    // 夜视：绿色单色 + 提亮暗部 + 噪点 + 暗角
    private static int[] nightVision(int[] px, int w, int h) {
        int[] out = new int[px.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                int p = px[i];
                int l = lum((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
                double gl = Math.pow(l / 255.0, 0.62); // gamma 提亮暗部
                int v = clampD(gl * 255 * 1.12 + noise(x, y, 21) * 9);
                out[i] = pack(p >>> 24, clampD(v * 0.22), v, clampD(v * 0.28));
            }
        }
        applyVignette(out, w, h, 0.55);
        return out;
    }
}
