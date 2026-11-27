package meowtu.core;

import meowtu.filters.FiltersX;

import java.awt.image.BufferedImage;

/**
 * 高级调整（8 段）+ 智能一键优化。逐项移植自 webapp/js/adjust.js（其算法译自
 * PhotoCraft Rust 源码，口径为 8-bit RGB）：色阶 levels_q/levels_gamma、通道混合器
 * ChannelMixer、黑白 black_white_gray、可选颜色 selective_color、照片滤镜
 * photo_filter_matrix + set_lum、渐变映射 gradient、阈值 threshold_white、
 * 色调分离 posterize。管线固定顺序：色阶 → 通道混合器 → 可选颜色 → 照片滤镜 →
 * 黑白 → 渐变映射 → 色调分离 → 阈值（同 adjust.js apply）。
 * 渐变映射色带与 FiltersX.GRAD_MAP_* 共用同一套数据（filters.js GRAD_MAPS）。
 */
public final class AdvAdjust {
    private AdvAdjust() {}

    /** 照片滤镜预置表（adjust.js PHOTO_FILTERS）：[名称, [r,g,b] 0..255]。 */
    public static final String[] PHOTO_FILTER_NAMES = {
        "暖化 (85)", "暖化 (LBA)", "暖化 (81)", "冷化 (80)", "冷化 (LBB)", "冷化 (82)",
        "红", "橙", "黄", "绿", "青", "蓝", "紫", "洋红", "棕褐", "深红", "深蓝", "深绿", "深黄", "水下"
    };
    public static final int[][] PHOTO_FILTER_RGB = {
        {236, 138, 0}, {250, 150, 0}, {235, 177, 19}, {0, 109, 255}, {0, 93, 255}, {0, 181, 255},
        {234, 26, 26}, {243, 132, 23}, {249, 227, 28}, {25, 201, 25}, {29, 203, 234}, {29, 53, 234},
        {155, 29, 234}, {227, 24, 227}, {172, 122, 51}, {255, 0, 0}, {0, 34, 205}, {0, 140, 0},
        {255, 213, 0}, {0, 194, 177}
    };
    /** 可选颜色 9 个范围名（adjust.js SEL_RANGES）。 */
    public static final String[] SEL_RANGES = {"红色", "黄色", "绿色", "青色", "蓝色", "洋红", "白色", "中性色", "黑色"};

    /** 调整状态：字段与 adjust.js 各 DEFS 的 make() 默认状态同构；段开关对应 web 的「键存在=启用」。 */
    public static class State {
        // 色阶 levels：{inBlack:0..255, gamma, inWhite:0..255}（输出范围恒等）
        public boolean levelsOn;
        public int levelsInBlack = 0;
        public double levelsGamma = 1;
        public int levelsInWhite = 255;
        // 通道混合器 mixer：{m: 3 行 × [红,绿,蓝,常数]（百分数）, mono}
        public boolean mixerOn;
        public double[][] mixerM = {{100, 0, 0, 0}, {0, 100, 0, 0}, {0, 0, 100, 0}};
        public boolean mixerMono;
        // 可选颜色 selcolor：{range, rel, a: 9 范围 × [青,洋红,黄,黑]（-100..100）}
        public boolean selcolorOn;
        public int selcolorRange = 0;
        public boolean selcolorRel = true;
        public double[][] selcolorA = new double[9][4];
        // 照片滤镜 photo：{preset, color:[r,g,b] 0..255, density:0..100, preserve}
        public boolean photoOn;
        public int photoPreset = 0;
        public int[] photoColor = PHOTO_FILTER_RGB[0].clone();
        public double photoDensity = 25;
        public boolean photoPreserve = true;
        // 黑白 bw：{w: [红,黄,绿,青,蓝,洋红] 权重}
        public boolean bwOn;
        public double[] bwW = {40, 60, 40, 60, 20, 80};
        // 渐变映射 gradmap：{map: 色带下标, amount:0..100}
        public boolean gradmapOn;
        public int gradmapMap = 0;
        public double gradmapAmount = 100;
        // 色调分离 posterize：{levels:2..255}
        public boolean posterizeOn;
        public int posterizeLevels = 4;
        // 阈值 threshold：{level:1..255}
        public boolean thresholdOn;
        public int thresholdLevel = 128;

        /** 全部字段的签名串（供编辑器检查点比较状态是否变化）。 */
        public String sig() {
            StringBuilder sb = new StringBuilder();
            sb.append(levelsOn).append(',').append(levelsInBlack).append(',').append(levelsGamma).append(',').append(levelsInWhite);
            sb.append('|').append(mixerOn).append(',').append(mixerMono);
            for (double[] r : mixerM) for (double v : r) sb.append(',').append(v);
            sb.append('|').append(selcolorOn).append(',').append(selcolorRange).append(',').append(selcolorRel);
            for (double[] r : selcolorA) for (double v : r) sb.append(',').append(v);
            sb.append('|').append(photoOn).append(',').append(photoPreset).append(',').append(photoDensity).append(',').append(photoPreserve);
            for (int v : photoColor) sb.append(',').append(v);
            sb.append('|').append(bwOn);
            for (double v : bwW) sb.append(',').append(v);
            sb.append('|').append(gradmapOn).append(',').append(gradmapMap).append(',').append(gradmapAmount);
            sb.append('|').append(posterizeOn).append(',').append(posterizeLevels);
            sb.append('|').append(thresholdOn).append(',').append(thresholdLevel);
            return sb.toString();
        }

        public State copy() {
            State s = new State();
            s.levelsOn = levelsOn; s.levelsInBlack = levelsInBlack; s.levelsGamma = levelsGamma; s.levelsInWhite = levelsInWhite;
            s.mixerOn = mixerOn; s.mixerMono = mixerMono;
            for (int i = 0; i < 3; i++) s.mixerM[i] = mixerM[i].clone();
            s.selcolorOn = selcolorOn; s.selcolorRange = selcolorRange; s.selcolorRel = selcolorRel;
            for (int i = 0; i < 9; i++) s.selcolorA[i] = selcolorA[i].clone();
            s.photoOn = photoOn; s.photoPreset = photoPreset; s.photoColor = photoColor.clone();
            s.photoDensity = photoDensity; s.photoPreserve = photoPreserve;
            s.bwOn = bwOn; s.bwW = bwW.clone();
            s.gradmapOn = gradmapOn; s.gradmapMap = gradmapMap; s.gradmapAmount = gradmapAmount;
            s.posterizeOn = posterizeOn; s.posterizeLevels = posterizeLevels;
            s.thresholdOn = thresholdOn; s.thresholdLevel = thresholdLevel;
            return s;
        }

        /** 全部段关闭即恒等（对应 web adjState 为 null / 无启用键）。 */
        public boolean isIdentity() {
            return !levelsOn && !mixerOn && !selcolorOn && !photoOn
                && !bwOn && !gradmapOn && !posterizeOn && !thresholdOn;
        }

        public void reset() {
            State d = new State();
            levelsOn = mixerOn = selcolorOn = photoOn = bwOn = gradmapOn = posterizeOn = thresholdOn = false;
            levelsInBlack = d.levelsInBlack; levelsGamma = d.levelsGamma; levelsInWhite = d.levelsInWhite;
            mixerM = d.mixerM; mixerMono = d.mixerMono;
            selcolorRange = d.selcolorRange; selcolorRel = d.selcolorRel; selcolorA = d.selcolorA;
            photoPreset = d.photoPreset; photoColor = d.photoColor; photoDensity = d.photoDensity; photoPreserve = d.photoPreserve;
            bwW = d.bwW;
            gradmapMap = d.gradmapMap; gradmapAmount = d.gradmapAmount;
            posterizeLevels = d.posterizeLevels;
            thresholdLevel = d.thresholdLevel;
        }
    }

    /** 按固定顺序逐像素应用已启用段；不修改原图，alpha 保持不变。s 为 null 或恒等时返回原图副本。 */
    public static BufferedImage apply(BufferedImage src, State s) {
        if (src == null) return null;
        if (s == null || s.isIdentity()) return Img.copy(src);
        int w = src.getWidth(), h = src.getHeight();
        int[] px = Img.pixels(src);

        // 预构建各段的查找表/矩阵（同 web 在 stages 构建期一次性算好）
        int[] levelsLut = s.levelsOn ? levelsLut(s.levelsInBlack, s.levelsGamma, s.levelsInWhite) : null;
        double[][] photoM = s.photoOn ? photoMatrix(s.photoColor, s.photoDensity) : null;
        int gradIdx = Math.max(0, Math.min(FiltersX.GRAD_MAP_RGB.length - 1, s.gradmapMap));
        double[][] gradStops = null;
        double gradAmt = 0;
        if (s.gradmapOn) {
            double[] pos = FiltersX.GRAD_MAP_POS[gradIdx];
            int[][] rgb = FiltersX.GRAD_MAP_RGB[gradIdx];
            gradStops = new double[pos.length][];
            for (int i = 0; i < pos.length; i++)
                gradStops[i] = new double[]{pos[i], rgb[i][0] / 255.0, rgb[i][1] / 255.0, rgb[i][2] / 255.0};
            gradAmt = Math.min(100, Math.max(0, s.gradmapAmount)) / 100;
        }
        int[] posterLut = s.posterizeOn ? posterizeLut(s.posterizeLevels) : null;
        int thrLv = s.thresholdOn ? Math.round(s.thresholdLevel) : 0;

        for (int i = 0; i < px.length; i++) {
            double[] c = {((px[i] >> 16) & 0xFF) / 255.0, ((px[i] >> 8) & 0xFF) / 255.0, (px[i] & 0xFF) / 255.0};
            if (levelsLut != null)
                c = new double[]{levelsLut[(int) Math.round(c[0] * 255)] / 255.0,
                                 levelsLut[(int) Math.round(c[1] * 255)] / 255.0,
                                 levelsLut[(int) Math.round(c[2] * 255)] / 255.0};
            if (s.mixerOn) {
                double r = mixRow(s.mixerM[0], c);
                c = s.mixerMono ? new double[]{r, r, r}
                                : new double[]{r, mixRow(s.mixerM[1], c), mixRow(s.mixerM[2], c)};
            }
            if (s.selcolorOn) c = selColor(c, s.selcolorRel, s.selcolorA);
            if (photoM != null) c = photoApply(c, photoM, s.photoPreserve);
            if (s.bwOn) {
                double g = clamp01(bwGray(c[0], c[1], c[2], s.bwW));
                c = new double[]{g, g, g};
            }
            if (gradStops != null) {
                double[] o = gradEval(gradStops, lum3(c));
                c = new double[]{c[0] + (o[0] - c[0]) * gradAmt, c[1] + (o[1] - c[1]) * gradAmt, c[2] + (o[2] - c[2]) * gradAmt};
            }
            if (posterLut != null)
                c = new double[]{posterLut[(int) Math.round(c[0] * 255)] / 255.0,
                                 posterLut[(int) Math.round(c[1] * 255)] / 255.0,
                                 posterLut[(int) Math.round(c[2] * 255)] / 255.0};
            if (s.thresholdOn) {
                double v = thresholdWhite((int) Math.round(c[0] * 255), (int) Math.round(c[1] * 255),
                                          (int) Math.round(c[2] * 255), thrLv) ? 1 : 0;
                c = new double[]{v, v, v};
            }
            px[i] = (px[i] & 0xFF000000)
                  | ((int) Math.round(clamp01(c[0]) * 255) << 16)
                  | ((int) Math.round(clamp01(c[1]) * 255) << 8)
                  | (int) Math.round(clamp01(c[2]) * 255);
        }
        return Img.fromPixels(w, h, px);
    }

    // ---------- 色阶（tone.rs levels_gamma / levels_q，quantum = 255） ----------

    private static double levelsGamma(double u, double g) {
        double c = 1 / g;
        if (g <= 1) return Math.pow(u, c);
        double a = Math.pow(2, g), q = 2.2; // LEVELS_TOE_POWER
        double u1 = Math.pow((1 - c / q) / (a * (1 - 1 / q)), 1 / (1 - c));
        if (u >= u1 || u1 <= 0) return Math.pow(u, c);
        double b = (a * u1 - Math.pow(u1, c)) / Math.pow(u1, q);
        if (!Double.isFinite(b)) return Math.pow(u, c);
        return a * u - b * Math.pow(u, q);
    }

    private static int[] levelsLut(int inBlack, double gammaIn, int inWhite) {
        double ib = inBlack / 255.0, iw = inWhite / 255.0, gamma = Math.max(0.01, gammaIn);
        double range = Math.max(1e-6, iw - ib), q = 255;
        int[] lut = new int[256];
        for (int k = 0; k < 256; k++) {
            double v = Math.round(k / 255.0 * q) / q;
            double u = Math.floor(clamp01((v - ib) / range) * q + 0.5 + 1e-3) / q;
            double t = Math.floor(levelsGamma(u, gamma) * q + 0.5) / q;
            lut[k] = (int) Math.round(t * 255);
        }
        return lut;
    }

    // ---------- 通道混合器 ----------

    private static double mixRow(double[] row, double[] c) {
        return clamp01((row[0] * c[0] + row[1] * c[1] + row[2] * c[2]) / 100 + row[3] / 100);
    }

    // ---------- 黑白（color.rs black_white_gray） ----------

    private static double bwGray(double r, double g, double b, double[] w) {
        double max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
        double mid = r + g + b - max - min;
        int primary = (r >= g && r >= b) ? 0 : (g >= b ? 2 : 4);
        int secondary = (b <= r && b <= g) ? 1 : (r <= g ? 3 : 5);
        return min + (mid - min) * w[secondary] / 100 + (max - mid) * w[primary] / 100;
    }

    // ---------- 可选颜色（color.rs selective_color_weights / selective_color） ----------

    private static double[] selWeights(double[] c) {
        double max = Math.max(c[0], Math.max(c[1], c[2])), min = Math.min(c[0], Math.min(c[1], c[2]));
        double mid = c[0] + c[1] + c[2] - max - min;
        double[] w = new double[9];
        // top(i) = c[i]>=max ? max-mid : 0；bottom(i) = c[i]<=min ? mid-min : 0
        w[0] = c[0] >= max ? max - mid : 0;
        w[1] = c[2] <= min ? mid - min : 0;
        w[2] = c[1] >= max ? max - mid : 0;
        w[3] = c[0] <= min ? mid - min : 0;
        w[4] = c[2] >= max ? max - mid : 0;
        w[5] = c[1] <= min ? mid - min : 0;
        w[6] = Math.max(0, (min - 0.5) * 2);
        w[7] = Math.min(1, Math.max(0, 1 - Math.abs(max - 0.5) - Math.abs(min - 0.5)));
        w[8] = Math.max(0, (0.5 - max) * 2);
        return w;
    }

    private static double[] selColor(double[] c, boolean relative, double[][] adj) {
        double[] w = selWeights(c);
        double[] delta = {0, 0, 0};
        for (int r = 0; r < 9; r++) {
            if (w[r] <= 0) continue;
            double[] a = adj[r];
            for (int i = 0; i < 3; i++) {
                double ink = 1 - c[i];
                double d = (a[i] + a[3]) / 100;
                if (relative) d = d * ink;
                else if (d > 0) d = d * Math.min(1, 2 * (1 - ink));
                else d = d * Math.min(1, 2 * ink);
                delta[i] += d * w[r];
            }
        }
        return new double[]{clamp01(c[0] - delta[0]), clamp01(c[1] - delta[1]), clamp01(c[2] - delta[2])};
    }

    // ---------- 照片滤镜（color.rs photo_filter_matrix；D50 矩阵与 blend::set_lum） ----------

    private static final double[] D50 = {0.96422, 1.0, 0.82521};
    private static final double[][] SRGB_TO_XYZ_D50 = {
        {0.436074, 0.385064, 0.143080}, {0.222504, 0.716878, 0.060618}, {0.013932, 0.097104, 0.714173}};
    private static final double[][] XYZ_D50_TO_SRGB = {
        {3.133856, -1.616867, -0.490615}, {-0.978768, 1.916142, 0.033454}, {0.071945, -0.228991, 1.405243}};

    private static double srgbToLinear(double v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    private static double linearToSrgb(double v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

    private static double[] mat3Mul(double[][] m, double[] c) {
        return new double[]{
            m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
            m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
            m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2]};
    }

    private static double[] clipColor(double[] c) {
        double l = lum3(c);
        double n = Math.min(c[0], Math.min(c[1], c[2])), x = Math.max(c[0], Math.max(c[1], c[2]));
        double[] out = c.clone();
        if (n < 0) for (int i = 0; i < 3; i++) out[i] = (l > 0 && l - n > 0) ? l + (out[i] - l) * l / (l - n) : l;
        if (x > 1) for (int i = 0; i < 3; i++) out[i] = (l < 1 && x - l > 0) ? l + (out[i] - l) * (1 - l) / (x - l) : l;
        return out;
    }

    private static double[] setLum(double[] c, double l) {
        double d = l - lum3(c);
        return clipColor(new double[]{c[0] + d, c[1] + d, c[2] + d});
    }

    /** color: [r,g,b] 0..255；density: 0..100。8-bit 路径不做 Y 归一（同 adjust.js）。 */
    private static double[][] photoMatrix(int[] color, double density) {
        double d = Math.min(1, Math.max(0, density / 100));
        double[] lin = {srgbToLinear(color[0] / 255.0), srgbToLinear(color[1] / 255.0), srgbToLinear(color[2] / 255.0)};
        double[] xyz = mat3Mul(SRGB_TO_XYZ_D50, lin);
        double[] s = new double[3];
        for (int i = 0; i < 3; i++) s[i] = 1 - d + d * xyz[i] / D50[i];
        double[][] m = new double[3][3];
        for (int r = 0; r < 3; r++) for (int cc = 0; cc < 3; cc++)
            m[r][cc] = XYZ_D50_TO_SRGB[r][0] * s[0] * SRGB_TO_XYZ_D50[0][cc]
                     + XYZ_D50_TO_SRGB[r][1] * s[1] * SRGB_TO_XYZ_D50[1][cc]
                     + XYZ_D50_TO_SRGB[r][2] * s[2] * SRGB_TO_XYZ_D50[2][cc];
        return m;
    }

    private static double[] photoApply(double[] c, double[][] m, boolean preserve) {
        double[] lin = {srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])};
        double[] f = mat3Mul(m, lin);
        for (int i = 0; i < 3; i++) f[i] = linearToSrgb(Math.max(0, f[i]));
        if (preserve) f = setLum(f, lum3(c));
        return new double[]{clamp01(f[0]), clamp01(f[1]), clamp01(f[2])};
    }

    // ---------- 渐变映射（color.rs gradient；W3C 明度驱动） ----------

    /** stops 每行 = [位置, r, g, b]（0..1）。 */
    private static double[] gradEval(double[][] stops, double t) {
        if (t <= stops[0][0]) return new double[]{stops[0][1], stops[0][2], stops[0][3]};
        for (int i = 0; i < stops.length - 1; i++) {
            if (t <= stops[i + 1][0]) {
                double k = stops[i + 1][0] > stops[i][0] ? (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]) : 0;
                return new double[]{
                    stops[i][1] + (stops[i + 1][1] - stops[i][1]) * k,
                    stops[i][2] + (stops[i + 1][2] - stops[i][2]) * k,
                    stops[i][3] + (stops[i + 1][3] - stops[i][3]) * k};
            }
        }
        double[] last = stops[stops.length - 1];
        return new double[]{last[1], last[2], last[3]};
    }

    // ---------- 阈值（channels.rs threshold_white，U8 口径） / 色调分离（tone.rs posterize，8-bit 口径） ----------

    private static boolean thresholdWhite(int r, int g, int b, int level) {
        return (30 * r + 59 * g + 11 * b) > 100 * level - 50;
    }

    private static int[] posterizeLut(int levels) {
        int n = Math.min(255, Math.max(2, Math.round(levels)));
        int[] lut = new int[256];
        for (int v = 0; v < 256; v++) {
            int bin = Math.min((int) Math.floor(v * (double) n / 256), n - 1);
            lut[v] = (int) Math.floor(bin * 255.0 / (n - 1));
        }
        return lut;
    }

    private static double clamp01(double v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    private static double lum3(double[] c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }

    // ================= 智能一键优化（adjust.js autoOptimize，自研策略） =================

    /**
     * 智能一键优化：移植 adjust.js autoOptimize。先按 engine.js getHistogram 的
     * 口径算直方图（步长 = max(1, floor(sqrt(w*h/1e6)))，跳过全透明像素，
     * 明度 = round(0.2126r + 0.7152g + 0.0722b)），再按其策略出增量：
     * 曝光把平均亮度拉向 0.46（log2 域，上限 ±1 EV）；对比度只在亮度跨度
     * （p99-p1）不足时加（上限 45）；跨度 <0.75 时补饱和（上限 20）；欠曝提
     * 阴影（上限 35）、高光不足提 highlights（上限 30）、过曝压 highlights
     * （上限 -35）；色温按三通道均值差估偏色（上限 ±25）。
     *
     * @return 与 {@link AdjustParams} 字段同序的 13 项增量数组
     *         [exposure, brightness, contrast, temperature, tint, saturation,
     *          vibrance, highlights, shadows, whites, blacks, clarity, sharpen]；
     *         autoOptimize 实际只产出 exposure/contrast/saturation/highlights/
     *         shadows/temperature 六项，其余恒 0。
     */
    public static double[] smartOptimize(BufferedImage src) {
        double[] out = new double[13];
        if (src == null) return out;
        int w = src.getWidth(), h = src.getHeight();
        int[] px = Img.pixels(src);
        int[] hr = new int[256], hg = new int[256], hb = new int[256], hl = new int[256];
        int step = Math.max(1, (int) Math.floor(Math.sqrt((double) w * h / 1000000)));
        for (int y = 0; y < h; y += step) for (int x = 0; x < w; x += step) {
            int p = px[y * w + x];
            if ((p >>> 24) == 0) continue;
            int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
            hr[r]++; hg[g]++; hb[b]++;
            hl[(int) Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
        }
        // 以下与 autoOptimize(hist) 逐行对应（hist.l/r/g/b 即上面的直方图）
        long total = 0, sum = 0;
        for (int i = 0; i < 256; i++) { total += hl[i]; sum += (long) hl[i] * i; }
        if (total == 0) return out;
        double mean = sum / (double) total / 255;
        double p1 = pct(hl, total, 0.01), p99 = pct(hl, total, 0.99), span = p99 - p1;
        double exposure = 0, contrast = 0, saturation = 0, shadows = 0, highlights = 0, temperature = 0;
        if (mean > 0.01) exposure = cap(Math.log(0.46 / mean) / Math.log(2), -1, 1);
        if (span < 0.98) contrast = cap((0.98 / Math.max(0.1, span) - 1) * 55, 0, 45);
        if (span < 0.75) saturation = cap((0.75 - span) * 40, 0, 20);
        if (mean < 0.3) shadows = cap((0.3 - mean) * 160, 0, 35);
        if (p99 < 0.9 && mean < 0.55) highlights = cap((0.9 - p99) * 120, 0, 30);
        if (mean > 0.62) highlights = -cap((mean - 0.62) * 150, 0, 35);
        long tr = 0, tg = 0, tb = 0, mr = 0, mg = 0, mb = 0;
        for (int i = 0; i < 256; i++) {
            tr += hr[i]; mr += (long) hr[i] * i;
            tg += hg[i]; mg += (long) hg[i] * i;
            tb += hb[i]; mb += (long) hb[i] * i;
        }
        if (tr != 0 && tb != 0) temperature = cap(((mb / (double) tb) - (mr / (double) tr)) / 255 * 180, -25, 25);
        out[0] = exposure;      // exposure
        out[2] = contrast;      // contrast
        out[3] = temperature;   // temperature
        out[5] = saturation;    // saturation
        out[7] = highlights;    // highlights
        out[8] = shadows;       // shadows
        return out;
    }

    private static double pct(int[] hist, long total, double p) {
        double need = total * p;
        long acc = 0;
        for (int k = 0; k < 256; k++) { acc += hist[k]; if (acc >= need) return k / 255.0; }
        return 1;
    }

    private static double cap(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

    // ---------- 与网页版 adj 状态 JSON 互转（工程文件/配方用；段键在场即启用，与 adjust.js 同构） ----------
    public static java.util.Map<String, Object> toMap(State s) {
        if (s == null || s.isIdentity()) return null;
        java.util.Map<String, Object> root = new java.util.LinkedHashMap<>();
        if (s.levelsOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("inBlack", (double) s.levelsInBlack); m.put("gamma", s.levelsGamma); m.put("inWhite", (double) s.levelsInWhite);
            root.put("levels", m);
        }
        if (s.mixerOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("m", matToList(s.mixerM)); m.put("mono", s.mixerMono ? 1.0 : 0.0);
            root.put("mixer", m);
        }
        if (s.selcolorOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("range", (double) s.selcolorRange); m.put("rel", s.selcolorRel ? 1.0 : 0.0); m.put("a", matToList(s.selcolorA));
            root.put("selcolor", m);
        }
        if (s.photoOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("preset", (double) s.photoPreset);
            java.util.List<Object> col = new java.util.ArrayList<>();
            for (int v : s.photoColor) col.add((double) v);
            m.put("color", col); m.put("density", s.photoDensity); m.put("preserve", s.photoPreserve ? 1.0 : 0.0);
            root.put("photo", m);
        }
        if (s.bwOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            java.util.List<Object> w = new java.util.ArrayList<>();
            for (double v : s.bwW) w.add(v);
            m.put("w", w);
            root.put("bw", m);
        }
        if (s.gradmapOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("map", (double) s.gradmapMap); m.put("amount", s.gradmapAmount);
            root.put("gradmap", m);
        }
        if (s.posterizeOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("levels", (double) s.posterizeLevels);
            root.put("posterize", m);
        }
        if (s.thresholdOn) {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("level", (double) s.thresholdLevel);
            root.put("threshold", m);
        }
        return root;
    }

    public static State fromMap(java.util.Map<String, Object> root) {
        if (root == null) return null;
        State s = new State();
        java.util.Map<?, ?> lv = sub(root, "levels");
        if (lv != null) { s.levelsOn = true; s.levelsInBlack = (int) num(lv.get("inBlack"), 0); s.levelsGamma = num(lv.get("gamma"), 1); s.levelsInWhite = (int) num(lv.get("inWhite"), 255); }
        java.util.Map<?, ?> mx = sub(root, "mixer");
        if (mx != null) { s.mixerOn = true; listToMat(mx.get("m"), s.mixerM); s.mixerMono = num(mx.get("mono"), 0) != 0; }
        java.util.Map<?, ?> sc = sub(root, "selcolor");
        if (sc != null) { s.selcolorOn = true; s.selcolorRange = (int) num(sc.get("range"), 0); s.selcolorRel = num(sc.get("rel"), 1) != 0; listToMat(sc.get("a"), s.selcolorA); }
        java.util.Map<?, ?> ph = sub(root, "photo");
        if (ph != null) {
            s.photoOn = true; s.photoPreset = (int) num(ph.get("preset"), 0); s.photoDensity = num(ph.get("density"), 25);
            s.photoPreserve = num(ph.get("preserve"), 1) != 0;
            Object col = ph.get("color");
            if (col instanceof java.util.List) {
                java.util.List<?> cl = (java.util.List<?>) col;
                for (int i = 0; i < Math.min(3, cl.size()); i++) s.photoColor[i] = (int) Math.round(num(cl.get(i), 0));
            }
        }
        java.util.Map<?, ?> bw = sub(root, "bw");
        if (bw != null) {
            s.bwOn = true;
            Object w = bw.get("w");
            if (w instanceof java.util.List) {
                java.util.List<?> wl = (java.util.List<?>) w;
                for (int i = 0; i < Math.min(6, wl.size()); i++) s.bwW[i] = num(wl.get(i), 0);
            }
        }
        java.util.Map<?, ?> gm = sub(root, "gradmap");
        if (gm != null) { s.gradmapOn = true; s.gradmapMap = (int) num(gm.get("map"), 0); s.gradmapAmount = num(gm.get("amount"), 100); }
        java.util.Map<?, ?> po = sub(root, "posterize");
        if (po != null) { s.posterizeOn = true; s.posterizeLevels = (int) num(po.get("levels"), 4); }
        java.util.Map<?, ?> th = sub(root, "threshold");
        if (th != null) { s.thresholdOn = true; s.thresholdLevel = (int) num(th.get("level"), 128); }
        return s.isIdentity() ? null : s;
    }

    private static java.util.Map<?, ?> sub(java.util.Map<String, Object> root, String k) {
        Object o = root.get(k);
        return o instanceof java.util.Map ? (java.util.Map<?, ?>) o : null;
    }

    private static double num(Object o, double def) { return o instanceof Number ? ((Number) o).doubleValue() : def; }

    private static java.util.List<Object> matToList(double[][] m) {
        java.util.List<Object> out = new java.util.ArrayList<>();
        for (double[] row : m) {
            java.util.List<Object> r = new java.util.ArrayList<>();
            for (double v : row) r.add(v);
            out.add(r);
        }
        return out;
    }

    private static void listToMat(Object o, double[][] m) {
        if (!(o instanceof java.util.List)) return;
        java.util.List<?> rows = (java.util.List<?>) o;
        for (int i = 0; i < Math.min(m.length, rows.size()); i++) {
            if (rows.get(i) instanceof java.util.List) {
                java.util.List<?> r = (java.util.List<?>) rows.get(i);
                for (int j = 0; j < Math.min(m[i].length, r.size()); j++) m[i][j] = num(r.get(j), 0);
            }
        }
    }
}
