package meowtu.filters;

import meowtu.core.Img;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 网页版新增的 19 个带参数滤镜（旧 Java {@link Filters} 里没有的那批）。
 * 逐项移植自 webapp/js/filters.js 第二批参数化滤镜：参数元数据（key/范围/默认值）
 * 与像素公式均与 filters.js 一致（其范围/默认值对齐 PhotoCraft filters specs）。
 * 例外同 filters.js 注释：动感 distance 下限保留 0（=恒等）；中值半径上限 2。
 * 全部滤镜不修改原图，返回 TYPE_INT_ARGB 新图，alpha 保持原图不变（同 web 契约）。
 */
public final class FiltersX {
    private FiltersX() {}

    /** 滤镜定义：pKeys/pDef/pMin/pMax 为同序的参数表（无参数滤镜为空数组）。 */
    public static final class Def {
        public final String id, name;
        public final String[] pKeys;
        public final double[] pDef, pMin, pMax;

        public Def(String id, String name, String[] pKeys, double[] pDef, double[] pMin, double[] pMax) {
            this.id = id; this.name = name;
            this.pKeys = pKeys; this.pDef = pDef; this.pMin = pMin; this.pMax = pMax;
        }

        @Override public String toString() { return id + "(" + name + ")"; }
    }

    private static Def def(String id, String name, Object[][] ps) {
        String[] k = new String[ps.length];
        double[] d = new double[ps.length], mn = new double[ps.length], mx = new double[ps.length];
        for (int i = 0; i < ps.length; i++) {
            k[i] = (String) ps[i][0];
            mn[i] = ((Number) ps[i][1]).doubleValue();
            mx[i] = ((Number) ps[i][2]).doubleValue();
            d[i] = ((Number) ps[i][3]).doubleValue();
        }
        return new Def(id, name, k, d, mn, mx);
    }

    // 参数表与 filters.js PARAM_DEFS 同序同值：{key, min, max, def}
    private static final List<Def> ALL = List.of(
        def("gaussianBlur", "高斯模糊", new Object[][]{{"radius", 0.1, 1000, 1}}),
        def("motionBlur", "动感模糊", new Object[][]{{"distance", 0, 2000, 10}, {"angle", -360, 360, 0}}),
        def("radialBlur", "径向模糊", new Object[][]{{"amount", 1, 100, 10}}),
        def("surfaceBlur", "表面模糊", new Object[][]{{"radius", 1, 100, 5}, {"threshold", 2, 255, 15}}),
        def("usmSharpen", "USM锐化", new Object[][]{{"amount", 1, 500, 50}, {"radius", 0.1, 1000, 1}, {"threshold", 0, 255, 0}}),
        def("medianDenoise", "中值降噪", new Object[][]{{"radius", 1, 2, 1}}),
        def("twirl", "旋转扭曲", new Object[][]{{"angle", -999, 999, 50}}),
        def("wave", "波浪", new Object[][]{{"amplitude", 0, 50, 10}, {"wavelength", 8, 400, 80}}),
        def("ripple", "波纹", new Object[][]{{"amount", 0, 50, 12}}),
        def("spherize", "球面化", new Object[][]{{"amount", -100, 100, 100}}),
        def("addNoise", "加噪", new Object[][]{{"amount", 0.1, 400, 12.5}, {"monochrome", 0, 1, 1}}),
        def("wind", "风吹", new Object[][]{{"direction", 0, 1, 0}, {"strength", 1, 100, 40}}),
        def("clouds", "云彩", new Object[][]{{"scale", 4, 200, 60}, {"contrast", 0, 100, 50}}),
        def("lensFlare", "镜头光晕", new Object[][]{{"brightness", 0, 200, 100}, {"posX", 0, 100, 50}, {"posY", 0, 100, 50}}),
        def("gradientMap", "渐变映射", new Object[][]{{"map", 0, 3, 0}}),
        def("posterize", "色调分离", new Object[][]{{"levels", 2, 255, 4}}),
        def("threshold", "阈值", new Object[][]{{"level", 1, 255, 128}}),
        def("invert", "反相", new Object[][]{}),
        def("levelsAuto", "自动色阶", new Object[][]{})
    );

    public static List<Def> all() { return new ArrayList<>(ALL); }

    /** 按 id 查定义；无此滤镜返回 null。 */
    public static Def byId(String id) {
        if (id == null) return null;
        for (Def d : all()) if (d.id.equals(id)) return d;
        return null;
    }

    /** 渐变映射色带（filters.js GRAD_MAPS，与 AdvAdjust 的渐变映射共用同一套数据）。 */
    public static final String[] GRAD_MAP_NAMES = {"黑金", "青橙", "蓝紫", "红粉"};
    public static final double[][] GRAD_MAP_POS = {
        {0, 0.45, 0.75, 1}, {0, 0.4, 0.72, 1}, {0, 0.42, 0.74, 1}, {0, 0.4, 0.72, 1}
    };
    public static final int[][][] GRAD_MAP_RGB = {
        {{12, 10, 8}, {92, 65, 28}, {212, 168, 84}, {255, 240, 200}},
        {{4, 32, 40}, {16, 110, 122}, {232, 116, 44}, {255, 226, 188}},
        {{6, 8, 38}, {38, 52, 148}, {128, 84, 196}, {238, 226, 255}},
        {{26, 4, 10}, {122, 22, 38}, {232, 96, 92}, {255, 232, 220}}
    };

    /** 应用滤镜；params 缺项（或非有限数）用 Def 默认值，越界钳制。未知 id 返回原图副本。 */
    public static BufferedImage apply(String id, BufferedImage src, Map<String, Double> params) {
        if (src == null) return null;
        Def def = null;
        for (Def d : ALL) if (d.id.equals(id)) { def = d; break; }
        if (def == null) return Img.copy(src);
        int w = src.getWidth(), h = src.getHeight();
        int[] px = Img.pixels(src);
        Ch ch = new Ch(w * h);
        for (int i = 0; i < px.length; i++) {
            ch.r[i] = (px[i] >> 16) & 0xFF; ch.g[i] = (px[i] >> 8) & 0xFF; ch.b[i] = px[i] & 0xFF;
        }
        double[] p = resolve(def, params);
        Ch out;
        switch (id) {
            case "gaussianBlur":  out = blurChannels(ch, w, h, p[0]); break;
            case "motionBlur":    out = fMotionBlur(ch, w, h, p); break;
            case "radialBlur":    out = fRadialBlur(ch, w, h, p); break;
            case "surfaceBlur":   out = fSurfaceBlur(ch, w, h, p); break;
            case "usmSharpen":    out = fUsmSharpen(ch, w, h, p); break;
            case "medianDenoise": out = fMedianDenoise(ch, w, h, p); break;
            case "twirl":         out = fTwirl(ch, w, h, p); break;
            case "wave":          out = fWave(ch, w, h, p); break;
            case "ripple":        out = fRipple(ch, w, h, p); break;
            case "spherize":      out = fSpherize(ch, w, h, p); break;
            case "addNoise":      out = fAddNoise(ch, w, h, p); break;
            case "wind":          out = fWind(ch, w, h, p); break;
            case "clouds":        out = fClouds(ch, w, h, p); break;
            case "lensFlare":     out = fLensFlare(ch, w, h, p); break;
            case "gradientMap":   out = fGradientMap(ch, w, h, p); break;
            case "posterize":     out = fPosterize(ch, w, h, p); break;
            case "threshold":     out = fThreshold(ch, w, h, p); break;
            case "invert":        out = fInvert(ch); break;
            case "levelsAuto":    out = fLevelsAuto(ch); break;
            default:              return Img.copy(src);
        }
        int[] opx = new int[px.length];
        for (int i = 0; i < px.length; i++)
            opx[i] = (px[i] & 0xFF000000) | (out.r[i] << 16) | (out.g[i] << 8) | out.b[i];
        return Img.fromPixels(w, h, opx);
    }

    /** 合并参数：传入值优先（须为有限数），缺失取 def，最后钳制到 [min,max]（同 web resolveParams）。 */
    private static double[] resolve(Def def, Map<String, Double> params) {
        double[] p = new double[def.pKeys.length];
        for (int i = 0; i < p.length; i++) {
            Double v = params == null ? null : params.get(def.pKeys[i]);
            double x = (v != null && Double.isFinite(v)) ? v : def.pDef[i];
            p[i] = Math.max(def.pMin[i], Math.min(def.pMax[i], x));
        }
        return p;
    }

    // ================= 通用小工具（对应 filters.js 同名函数） =================

    private static final class Ch {
        final int[] r, g, b;
        Ch(int n) { r = new int[n]; g = new int[n]; b = new int[n]; }
        Ch copy() { Ch c = new Ch(r.length); System.arraycopy(r, 0, c.r, 0, r.length);
                    System.arraycopy(g, 0, c.g, 0, g.length); System.arraycopy(b, 0, c.b, 0, b.length); return c; }
    }

    /** filters.js clampD：四舍五入并钳制到 0..255。 */
    private static int clampD(double v) { return v < 0 ? 0 : (v > 255 ? 255 : (int) (v + 0.5)); }
    /** filters.js lum：整数除法明度。 */
    private static int lum(int r, int g, int b) { return (r * 299 + g * 587 + b * 114) / 1000; }
    private static int clampIdx(int i, int size) { return i < 0 ? 0 : (i >= size ? size - 1 : i); }

    /** filters.js noise：32 位整数哈希（Java int 溢出语义与 JS imul/|0 一致）。 */
    private static double noise(int x, int y, int seed) {
        int n = x * 374761393 + y * 668265263 + seed * 974711;
        n = (n ^ (n >> 13)) * 1274126177;
        n = n ^ (n >> 16);
        return ((n & 0xFFFF) / 32767.5) - 1.0;
    }

    // ---- 可分离高斯模糊（三遍 box blur 近似，同 filters.js gaussianBlur/blurChannels） ----

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

    private static void gaussianBlur(float[] ch, int w, int h, double sigma) {
        if (sigma < 0.4 || ch.length == 0) return;
        float[] tmp = new float[ch.length];
        int n = 3;
        int wl = (int) Math.floor(Math.sqrt(12 * sigma * sigma / n + 1));
        if (wl % 2 == 0) wl -= 1;
        if (wl < 1) wl = 1;
        int wu = wl + 2;
        double mIdeal = (12 * sigma * sigma - n * wl * wl - 4.0 * n * wl - 3.0 * n) / (-4.0 * wl - 4);
        int m = (int) Math.round(mIdeal);
        m = Math.max(0, Math.min(n, m));
        for (int i = 0; i < n; i++) {
            int size = (i < m) ? wl : wu;
            int r = (size - 1) / 2;
            if (r <= 0) continue;
            boxBlurH(ch, tmp, w, h, r);
            boxBlurV(tmp, ch, w, h, r);
        }
    }

    private static Ch blurChannels(Ch ch, int w, int h, double sigma) {
        int n = w * h;
        float[] fr = new float[n], fg = new float[n], fb = new float[n];
        for (int i = 0; i < n; i++) { fr[i] = ch.r[i]; fg[i] = ch.g[i]; fb[i] = ch.b[i]; }
        gaussianBlur(fr, w, h, sigma);
        gaussianBlur(fg, w, h, sigma);
        gaussianBlur(fb, w, h, sigma);
        Ch out = new Ch(n);
        for (int j = 0; j < n; j++) { out.r[j] = clampD(fr[j]); out.g[j] = clampD(fg[j]); out.b[j] = clampD(fb[j]); }
        return out;
    }

    // ---- 双线性采样 + 几何变形（同 filters.js sampleCh/warpChannels） ----

    private static double sampleCh(int[] arr, int w, int h, double fx, double fy) {
        if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
        if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
        int x0 = (int) Math.floor(fx), y0 = (int) Math.floor(fy);
        int x1 = (x0 + 1 < w) ? x0 + 1 : w - 1;
        int y1 = (y0 + 1 < h) ? y0 + 1 : h - 1;
        double tx = fx - x0, ty = fy - y0;
        double top = arr[y0 * w + x0] + (arr[y0 * w + x1] - arr[y0 * w + x0]) * tx;
        double bot = arr[y1 * w + x0] + (arr[y1 * w + x1] - arr[y1 * w + x0]) * tx;
        return top + (bot - top) * ty;
    }

    private interface WarpFn { void map(int x, int y, double[] sp); }

    private static Ch warpChannels(Ch ch, int w, int h, WarpFn fn) {
        Ch out = new Ch(w * h);
        double[] sp = new double[2];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            fn.map(x, y, sp);
            out.r[i] = clampD(sampleCh(ch.r, w, h, sp[0], sp[1]));
            out.g[i] = clampD(sampleCh(ch.g, w, h, sp[0], sp[1]));
            out.b[i] = clampD(sampleCh(ch.b, w, h, sp[0], sp[1]));
        }
        return out;
    }

    // ================= 模糊家族 =================

    /** 动感模糊：沿 angle 方向在 [-distance/2, +distance/2] 上等距采样求均值（距离>48 时等距抽样，同 web）。 */
    private static Ch fMotionBlur(Ch ch, int w, int h, double[] p) {
        int dist = (int) Math.round(p[0]);
        if (dist <= 0) return ch.copy();
        Ch out = new Ch(w * h);
        double rad = p[1] * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
        int steps = Math.min(dist, 48);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double sr = 0, sg = 0, sb = 0;
            for (int t = 0; t <= steps; t++) {
                double f = (t / (double) steps - 0.5) * dist;
                sr += sampleCh(ch.r, w, h, x + dx * f, y + dy * f);
                sg += sampleCh(ch.g, w, h, x + dx * f, y + dy * f);
                sb += sampleCh(ch.b, w, h, x + dx * f, y + dy * f);
            }
            int cnt = steps + 1;
            out.r[i] = clampD(sr / cnt); out.g[i] = clampD(sg / cnt); out.b[i] = clampD(sb / cnt);
        }
        return out;
    }

    /** 径向模糊（旋转式）：绕中心在 [-amount/2, +amount/2] 度弧线上 12 点采样求均值。 */
    private static Ch fRadialBlur(Ch ch, int w, int h, double[] p) {
        Ch out = new Ch(w * h);
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        int K = 12;
        double total = p[0] * Math.PI / 180;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double px = x - cx, py = y - cy, sr = 0, sg = 0, sb = 0;
            for (int k = 0; k < K; k++) {
                double ang = total * (k / (double) (K - 1) - 0.5);
                double cs = Math.cos(ang), sn = Math.sin(ang);
                sr += sampleCh(ch.r, w, h, cx + px * cs - py * sn, cy + px * sn + py * cs);
                sg += sampleCh(ch.g, w, h, cx + px * cs - py * sn, cy + px * sn + py * cs);
                sb += sampleCh(ch.b, w, h, cx + px * cs - py * sn, cy + px * sn + py * cs);
            }
            out.r[i] = clampD(sr / K); out.g[i] = clampD(sg / K); out.b[i] = clampD(sb / K);
        }
        return out;
    }

    /** 表面模糊（保边）：可分离双边近似——先横后纵各一遍一维双边，权重由明度差决定（三通道共用）。 */
    private static Ch fSurfaceBlur(Ch ch, int w, int h, double[] p) {
        int n = w * h;
        int r = Math.max(1, (int) Math.round(p[0]));
        double T = Math.max(1, p[1]);
        double[] sR = new double[n], sG = new double[n], sB = new double[n], lumA = new double[n];
        for (int i = 0; i < n; i++) {
            sR[i] = ch.r[i]; sG[i] = ch.g[i]; sB[i] = ch.b[i];
            lumA[i] = (ch.r[i] * 299 + ch.g[i] * 587 + ch.b[i] * 114) / 1000.0;
        }
        double[] tR = new double[n], tG = new double[n], tB = new double[n], tL = new double[n];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double c = lumA[i], ws = 0, sr = 0, sg = 0, sb = 0;
            for (int dx = -r; dx <= r; dx++) {
                int j = y * w + clampIdx(x + dx, w);
                double d = Math.abs(lumA[j] - c);
                if (d >= T) continue;
                double wt = 1 - d / T;
                ws += wt; sr += sR[j] * wt; sg += sG[j] * wt; sb += sB[j] * wt;
            }
            tR[i] = sr / ws; tG[i] = sg / ws; tB[i] = sb / ws;
            tL[i] = (tR[i] * 299 + tG[i] * 587 + tB[i] * 114) / 1000.0;
        }
        Ch out = new Ch(n);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double c2 = tL[i], ws = 0, sr = 0, sg = 0, sb = 0;
            for (int dy = -r; dy <= r; dy++) {
                int j = clampIdx(y + dy, h) * w + x;
                double d = Math.abs(tL[j] - c2);
                if (d >= T) continue;
                double wt = 1 - d / T;
                ws += wt; sr += tR[j] * wt; sg += tG[j] * wt; sb += tB[j] * wt;
            }
            out.r[i] = clampD(sr / ws); out.g[i] = clampD(sg / ws); out.b[i] = clampD(sb / ws);
        }
        return out;
    }

    // ================= 锐化 / 降噪 =================

    /** USM 锐化：out = 原图 + (原图 - 高斯模糊) × amount%，|差值| <= threshold 的像素不动。 */
    private static Ch fUsmSharpen(Ch ch, int w, int h, double[] p) {
        Ch bl = blurChannels(ch, w, h, p[1]);
        double k = p[0] / 100, th = p[2];
        Ch out = ch.copy();
        int[][] src = {ch.r, ch.g, ch.b}, bch = {bl.r, bl.g, bl.b}, dst = {out.r, out.g, out.b};
        for (int c = 0; c < 3; c++) for (int i = 0; i < src[c].length; i++) {
            int diff = src[c][i] - bch[c][i];
            if (Math.abs(diff) > th) dst[c][i] = clampD(src[c][i] + diff * k);
        }
        return out;
    }

    /** 单通道真中值（窗口坐标钳制，结果与 web 的直方图滑动中值等值：取排序后 (area-1)/2 位）。 */
    private static int[] medianChannel(int[] src, int w, int h, int r) {
        int[] out = new int[w * h];
        int k = 2 * r + 1, area = k * k, medIdx = (area - 1) >> 1;
        int[] win = new int[area];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int t = 0;
            for (int dy = -r; dy <= r; dy++) {
                int rb = clampIdx(y + dy, h) * w;
                for (int dx = -r; dx <= r; dx++) win[t++] = src[rb + clampIdx(x + dx, w)];
            }
            Arrays.sort(win);
            out[y * w + x] = win[medIdx];
        }
        return out;
    }

    /** 中值降噪：逐通道真中值（半径 1=3×3，2=5×5）。 */
    private static Ch fMedianDenoise(Ch ch, int w, int h, double[] p) {
        int r = Math.max(1, Math.min(2, (int) Math.round(p[0])));
        Ch out = new Ch(w * h);
        System.arraycopy(medianChannel(ch.r, w, h, r), 0, out.r, 0, w * h);
        System.arraycopy(medianChannel(ch.g, w, h, r), 0, out.g, 0, w * h);
        System.arraycopy(medianChannel(ch.b, w, h, r), 0, out.b, 0, w * h);
        return out;
    }

    // ================= 扭曲 =================

    /** 旋转扭曲：绕中心按半径衰减旋转，中心转角最大、边缘（min(w,h)/2）为零。 */
    private static Ch fTwirl(Ch ch, int w, int h, double[] p) {
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double R = Math.max(1, Math.min(w, h) / 2.0);
        double maxAng = p[0] * Math.PI / 180;
        return warpChannels(ch, w, h, (x, y, sp) -> {
            double dx = x - cx, dy = y - cy;
            double r = Math.sqrt(dx * dx + dy * dy);
            if (r == 0 || r >= R) { sp[0] = x; sp[1] = y; return; }
            double t = 1 - r / R, a = maxAng * t * t;
            double cs = Math.cos(a), sn = Math.sin(a);
            sp[0] = cx + dx * cs + dy * sn;
            sp[1] = cy - dx * sn + dy * cs;
        });
    }

    /** 波浪：x、y 分别被对方坐标的正弦推移。 */
    private static Ch fWave(Ch ch, int w, int h, double[] p) {
        double amp = p[0], kk = 2 * Math.PI / Math.max(4, p[1]);
        return warpChannels(ch, w, h, (x, y, sp) -> {
            sp[0] = x + amp * Math.sin(y * kk);
            sp[1] = y + amp * Math.sin(x * kk);
        });
    }

    /** 波纹：沿径向的正弦位移（波长固定为 min(w,h)/6）。 */
    private static Ch fRipple(Ch ch, int w, int h, double[] p) {
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double wl = Math.max(8, Math.min(w, h) / 6.0), amp = p[0], kk = 2 * Math.PI / wl;
        return warpChannels(ch, w, h, (x, y, sp) -> {
            double dx = x - cx, dy = y - cy;
            double r = Math.sqrt(dx * dx + dy * dy);
            if (r == 0) { sp[0] = x; sp[1] = y; return; }
            double s = (r + amp * Math.sin(r * kk)) / r;
            sp[0] = cx + dx * s;
            sp[1] = cy + dy * s;
        });
    }

    /** 球面化：径向幂映射 rho' = rho^(1+amount/100)（指数钳制 0.15..3，同 web）。 */
    private static Ch fSpherize(Ch ch, int w, int h, double[] p) {
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double R = Math.max(1, Math.min(w, h) / 2.0);
        double expo = Math.max(0.15, Math.min(3, 1 + p[0] / 100));
        return warpChannels(ch, w, h, (x, y, sp) -> {
            double dx = x - cx, dy = y - cy;
            double r = Math.sqrt(dx * dx + dy * dy);
            if (r == 0 || r >= R) { sp[0] = x; sp[1] = y; return; }
            double s = Math.pow(r / R, expo) * R / r;
            sp[0] = cx + dx * s;
            sp[1] = cy + dy * s;
        });
    }

    // ================= 风格化 / 渲染 =================

    /** 加噪：确定性哈希噪声；单色时三通道同值（种子同 web：单色 77，彩色 71/72/73）。 */
    private static Ch fAddNoise(Ch ch, int w, int h, double[] p) {
        Ch out = ch.copy();
        double amp = p[0] * 1.28; // 0..100 → ±128
        boolean mono = p[1] >= 0.5;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            if (mono) {
                double nz = noise(x, y, 77) * amp;
                out.r[i] = clampD(ch.r[i] + nz); out.g[i] = clampD(ch.g[i] + nz); out.b[i] = clampD(ch.b[i] + nz);
            } else {
                out.r[i] = clampD(ch.r[i] + noise(x, y, 71) * amp);
                out.g[i] = clampD(ch.g[i] + noise(x, y, 72) * amp);
                out.b[i] = clampD(ch.b[i] + noise(x, y, 73) * amp);
            }
        }
        return out;
    }

    /** 风吹：沿水平方向的确定性长短拖影（窗口均值）；direction 0=向右 1=向左。 */
    private static Ch fWind(Ch ch, int w, int h, double[] p) {
        Ch out = ch.copy();
        int L = Math.max(1, (int) Math.round(p[1]));
        boolean toRight = p[0] < 0.5;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double t = (noise(x, y, 55) + 1) / 2; // 0..1
            int len = 1 + (int) Math.floor(t * L);
            int sr = 0, sg = 0, sb = 0;
            for (int s = 0; s < len; s++) {
                int j = y * w + clampIdx(toRight ? x - s : x + s, w);
                sr += ch.r[j]; sg += ch.g[j]; sb += ch.b[j];
            }
            out.r[i] = clampD(sr / (double) len); out.g[i] = clampD(sg / (double) len); out.b[i] = clampD(sb / (double) len);
        }
        return out;
    }

    /** 值噪声格点哈希（fBm 用），返回 0..1（同 web hash01：无符号 32 位 / 4294967295）。 */
    private static double hash01(int ix, int iy, int seed) {
        int n = ix * 374761393 + iy * 668265263 + seed * 974711;
        n = (n ^ (n >> 13)) * 1274126177;
        n = n ^ (n >> 16);
        return (n & 0xFFFFFFFFL) / 4294967295.0;
    }

    private static double valueNoise(double fx, double fy, int seed) {
        int ix = (int) Math.floor(fx), iy = (int) Math.floor(fy);
        double tx = fx - ix, ty = fy - iy;
        double sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        double v00 = hash01(ix, iy, seed), v10 = hash01(ix + 1, iy, seed);
        double v01 = hash01(ix, iy + 1, seed), v11 = hash01(ix + 1, iy + 1, seed);
        double top = v00 + (v10 - v00) * sx, bot = v01 + (v11 - v01) * sx;
        return top + (bot - top) * sy;
    }

    /** 云彩：5 倍频程 fBm 程序化生成（与输入无关），天蓝→白色渐变，固定种子可复现。 */
    private static Ch fClouds(Ch ch, int w, int h, double[] p) {
        Ch out = new Ch(w * h);
        double cell = Math.max(4, p[0]);
        double con = 1 + (p[1] / 100) * 2; // 0..100 → 1..3 倍展开
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double fx = x / cell, fy = y / cell;
            double v = 0, a = 0.5, f = 1, tot = 0;
            for (int o = 0; o < 5; o++) {
                v += a * valueNoise(fx * f, fy * f, 91 + o * 7);
                tot += a; a *= 0.5; f *= 2;
            }
            v /= tot;
            double t = Math.max(0, Math.min(1, 0.5 + (v - 0.5) * con));
            out.r[i] = clampD(70 + (255 - 70) * t);
            out.g[i] = clampD(130 + (255 - 130) * t);
            out.b[i] = clampD(200 + (255 - 200) * t);
        }
        return out;
    }

    /** 镜头光晕：主辉光（高斯衰减，暖色）+ 光环 + 沿光轴的 4 个幽灵光斑，全部加色叠加。 */
    private static Ch fLensFlare(Ch ch, int w, int h, double[] p) {
        Ch out = ch.copy();
        double fx = (p[1] / 100) * (w - 1), fy = (p[2] / 100) * (h - 1);
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double maxD = Math.max(1, Math.sqrt(w * w + h * h) / 2);
        double bright = p[0] / 100, glowR = maxD * 0.55;
        // [t, 半径(×maxD), 强度, 色调r,g,b]，同 web ghosts 表
        double[][] ghosts = {
            {0.32, 0.050, 0.20, 0.65, 0.80, 1.00},
            {0.68, 0.028, 0.26, 1.00, 0.85, 0.60},
            {1.15, 0.085, 0.15, 0.70, 0.95, 0.85},
            {1.55, 0.042, 0.20, 0.95, 0.70, 0.90}
        };
        double[][] gPos = new double[ghosts.length][3];
        for (int gi = 0; gi < ghosts.length; gi++) {
            gPos[gi][0] = cx + (cx - fx) * ghosts[gi][0];
            gPos[gi][1] = cy + (cy - fy) * ghosts[gi][0];
            gPos[gi][2] = ghosts[gi][1] * maxD;
        }
        double ringR = maxD * 0.38, ringW = maxD * 0.02 + 1;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int i = y * w + x;
            double ddx = x - fx, ddy = y - fy;
            double d = Math.sqrt(ddx * ddx + ddy * ddy);
            double glow = Math.exp(-(d * d) / (glowR * glowR) * 3) * bright;
            double rd = (d - ringR) / ringW;
            double ring = Math.exp(-rd * rd) * 0.35 * bright;
            double ar = glow * 255 + ring * 170, ag = glow * 235 + ring * 165, ab = glow * 200 + ring * 175;
            for (int g2 = 0; g2 < ghosts.length; g2++) {
                double gx = x - gPos[g2][0], gy = y - gPos[g2][1], gr = gPos[g2][2];
                double gd = Math.sqrt(gx * gx + gy * gy);
                if (gd < gr) {
                    double gf = 1 - gd / gr, ga = gf * gf * ghosts[g2][2] * bright;
                    ar += ga * 255 * ghosts[g2][3]; ag += ga * 255 * ghosts[g2][4]; ab += ga * 255 * ghosts[g2][5];
                }
            }
            out.r[i] = clampD(ch.r[i] + ar); out.g[i] = clampD(ch.g[i] + ag); out.b[i] = clampD(ch.b[i] + ab);
        }
        return out;
    }

    /** 渐变映射 LUT：色带控制点线性插值成 256 级（同 web buildGradLut）。 */
    public static int[] buildGradLut(int mapIdx) {
        int idx = Math.max(0, Math.min(GRAD_MAP_RGB.length - 1, mapIdx));
        double[] pos = GRAD_MAP_POS[idx];
        int[][] rgb = GRAD_MAP_RGB[idx];
        int[] lut = new int[256 * 3];
        for (int v = 0; v < 256; v++) {
            double t = v / 255.0;
            int seg = 0;
            while (seg < pos.length - 2 && t > pos[seg + 1]) seg++;
            double f = (pos[seg + 1] > pos[seg]) ? (t - pos[seg]) / (pos[seg + 1] - pos[seg]) : 0;
            for (int c = 0; c < 3; c++)
                lut[v * 3 + c] = clampD(rgb[seg][c] + (rgb[seg + 1][c] - rgb[seg][c]) * f);
        }
        return lut;
    }

    /** 渐变映射：按明度（lum 整数口径）查所选色带 LUT。 */
    private static Ch fGradientMap(Ch ch, int w, int h, double[] p) {
        int[] lut = buildGradLut((int) Math.round(p[0]));
        Ch out = ch.copy();
        for (int i = 0; i < w * h; i++) {
            int l = lum(ch.r[i], ch.g[i], ch.b[i]);
            out.r[i] = lut[l * 3]; out.g[i] = lut[l * 3 + 1]; out.b[i] = lut[l * 3 + 2];
        }
        return out;
    }

    // ================= 色调类 =================

    /** filters.js posterize 标量：step = 255/(levels-1)，量化后 clampD。 */
    private static int posterizeVal(int v, int levels) {
        double step = 255.0 / (levels - 1);
        return clampD(Math.round(v / step) * step);
    }

    /** 色调分离：逐通道量化到 levels 个等级。 */
    private static Ch fPosterize(Ch ch, int w, int h, double[] p) {
        int lv = Math.max(2, (int) Math.round(p[0]));
        Ch out = ch.copy();
        for (int i = 0; i < w * h; i++) {
            out.r[i] = posterizeVal(ch.r[i], lv);
            out.g[i] = posterizeVal(ch.g[i], lv);
            out.b[i] = posterizeVal(ch.b[i], lv);
        }
        return out;
    }

    /** 阈值：明度（lum 整数口径） >= level 输出纯白，否则纯黑。 */
    private static Ch fThreshold(Ch ch, int w, int h, double[] p) {
        double lv = p[0];
        Ch out = ch.copy();
        for (int i = 0; i < w * h; i++) {
            int v = (lum(ch.r[i], ch.g[i], ch.b[i]) >= lv) ? 255 : 0;
            out.r[i] = v; out.g[i] = v; out.b[i] = v;
        }
        return out;
    }

    /** 反相：255 - v。 */
    private static Ch fInvert(Ch ch) {
        Ch out = ch.copy();
        for (int i = 0; i < ch.r.length; i++) {
            out.r[i] = 255 - ch.r[i]; out.g[i] = 255 - ch.g[i]; out.b[i] = 255 - ch.b[i];
        }
        return out;
    }

    /** 自动色阶：逐通道按实际 min/max 线性拉伸到 0..255；恒定通道原样保留。 */
    private static Ch fLevelsAuto(Ch ch) {
        Ch out = ch.copy();
        int[][] src = {ch.r, ch.g, ch.b}, dst = {out.r, out.g, out.b};
        for (int c = 0; c < 3; c++) {
            int mn = 255, mx = 0;
            for (int v : src[c]) { if (v < mn) mn = v; if (v > mx) mx = v; }
            if (mx <= mn) continue;
            int[] lut = new int[256];
            for (int v = 0; v < 256; v++) lut[v] = clampD((v - mn) * 255.0 / (mx - mn));
            for (int j = 0; j < src[c].length; j++) dst[c][j] = lut[src[c][j]];
        }
        return out;
    }
}
