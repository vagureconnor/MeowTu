package meowtu.core;

import java.awt.image.BufferedImage;

/**
 * 参数调节引擎：三段流水线。
 * 1) 逐通道 LUT：曝光、黑白场（blacks/whites 电平）、亮度、对比度、色温/色调增益；
 * 2) 逐像素：高光/阴影（按明度掩膜）、饱和度、自然饱和度；
 * 3) 空间项：清晰度（中调局部对比）、锐化（USM）。
 */
public final class LutEngine {
    private LutEngine() {}

    public static BufferedImage apply(BufferedImage src, AdjustParams p) {
        if (p == null || p.isIdentity()) return Img.copy(src);
        return applySpatial(applyPixelStages(src, p), p);
    }

    /** 是否含逐像素段参数（除清晰度/锐化外的全部参数）。 */
    private static boolean hasPixelStages(AdjustParams p) {
        return p.exposure != 0 || p.brightness != 0 || p.contrast != 0 || p.temperature != 0 || p.tint != 0
                || p.saturation != 0 || p.vibrance != 0 || p.highlights != 0 || p.shadows != 0
                || p.whites != 0 || p.blacks != 0;
    }

    /** 第一段：逐通道 LUT + 逐像素影调/色彩（不含清晰度/锐化）。无逐像素参数时返回拷贝。 */
    public static BufferedImage applyPixelStages(BufferedImage src, AdjustParams p) {
        if (p == null || !hasPixelStages(p)) return Img.copy(src);
        int w = src.getWidth(), h = src.getHeight();
        int[] px = Img.pixels(src);

        int[][] lut = buildChannelLuts(p);
        int[] lr = lut[0], lg = lut[1], lb = lut[2];

        double shAmt = p.shadows / 100.0 * 0.38;
        double hiAmt = p.highlights / 100.0 * 0.38;
        double satK = 1 + p.saturation / 100.0;
        double vibAmt = p.vibrance / 100.0;
        boolean tonal = shAmt != 0 || hiAmt != 0;
        boolean color = satK != 1 || vibAmt != 0;

        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            int a = c & 0xFF000000;
            int r = lr[(c >> 16) & 0xFF];
            int g = lg[(c >> 8) & 0xFF];
            int b = lb[c & 0xFF];
            if (tonal || color) {
                double lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
                if (tonal) {
                    double d = shAmt * (1 - lum) * (1 - lum) + hiAmt * lum * lum;
                    int add = (int) Math.round(d * 255);
                    r = Img.clamp(r + add, 0, 255);
                    g = Img.clamp(g + add, 0, 255);
                    b = Img.clamp(b + add, 0, 255);
                    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
                }
                if (color) {
                    double k = satK;
                    if (vibAmt != 0) {
                        int mx = Math.max(r, Math.max(g, b));
                        int mn = Math.min(r, Math.min(g, b));
                        double curSat = mx == 0 ? 0 : (double) (mx - mn) / mx;
                        k += vibAmt * (1 - curSat) * (vibAmt > 0 ? 1.0 : 0.6);
                    }
                    double L = lum * 255;
                    r = Img.clamp((int) Math.round(L + (r - L) * k), 0, 255);
                    g = Img.clamp((int) Math.round(L + (g - L) * k), 0, 255);
                    b = Img.clamp((int) Math.round(L + (b - L) * k), 0, 255);
                }
            }
            px[i] = a | (r << 16) | (g << 8) | b;
        }
        return Img.fromPixels(w, h, px);
    }

    /** 第二段：空间项（清晰度、锐化）。无空间项时原样返回入参（调用方保证入参为可独占的新图）。 */
    public static BufferedImage applySpatial(BufferedImage src, AdjustParams p) {
        if (p == null || (p.clarity == 0 && p.sharpen <= 0)) return src;
        BufferedImage out = src;
        if (p.clarity != 0) out = applyClarity(out, p.clarity);
        if (p.sharpen > 0) out = applySharpen(out, p.sharpen);
        return out;
    }

    /** 生成 R/G/B 三条 256 级 LUT（已含曝光、电平、亮度、对比度、色温色调）。 */
    static int[][] buildChannelLuts(AdjustParams p) {
        double ev = Math.pow(2.0, p.exposure);
        // 电平：blacks 正值抬高输入黑点（压黑），负值抬亮黑位；whites 对称处理白点
        double inBlack = Math.max(0, p.blacks) / 100.0 * 0.28 - Math.min(0, p.blacks) / 100.0 * 0.06;
        double inWhite = 1.0 - Math.max(0, p.whites) / 100.0 * 0.28 + Math.min(0, p.whites) / 100.0 * 0.06;
        double lift = Math.max(0, -p.blacks) / 100.0 * 0.12;
        double ceil = 1.0 - Math.max(0, -p.whites) / 100.0 * 0.12;
        double bri = p.brightness / 100.0 * 0.28;
        double con = p.contrast / 100.0;
        double conK = con >= 0 ? 1 + con * 1.6 : 1 + con * 0.85;
        double temp = p.temperature / 100.0;
        double tint = p.tint / 100.0;
        double[] gain = {
                (1 + temp * 0.28) * (1 + tint * 0.10),
                (1 - Math.abs(temp) * 0.05) * (1 - tint * 0.22),
                (1 - temp * 0.28) * (1 + tint * 0.10)
        };
        int[][] lut = new int[3][256];
        for (int ch = 0; ch < 3; ch++) {
            for (int v = 0; v < 256; v++) {
                double x = v / 255.0;
                x *= ev * gain[ch];
                x = (x - inBlack) / Math.max(0.05, inWhite - inBlack);
                x = x * (ceil - lift) + lift;
                x += bri;
                x = (x - 0.5) * conK + 0.5;
                lut[ch][v] = Img.clamp((int) Math.round(x * 255), 0, 255);
            }
        }
        return lut;
    }

    /** 清晰度：大半径模糊作低频，中调加权地加回高频。 */
    private static BufferedImage applyClarity(BufferedImage img, double clarity) {
        int radius = Math.max(4, Math.min(img.getWidth(), img.getHeight()) / 48);
        BufferedImage blur = Img.gaussianBlur(img, radius);
        int w = img.getWidth(), h = img.getHeight();
        int[] a = Img.pixels(img), b = Img.pixels(blur);
        double amt = clarity / 100.0 * 1.4;
        for (int i = 0; i < a.length; i++) {
            int ca = a[i], cb = b[i];
            double lum = (0.2126 * ((ca >> 16) & 0xFF) + 0.7152 * ((ca >> 8) & 0xFF) + 0.0722 * (ca & 0xFF)) / 255.0;
            double mask = 1 - Math.abs(lum - 0.5) * 1.6; // 中调最强，两端减弱
            if (mask < 0) mask = 0;
            double k = amt * mask;
            int r = Img.clamp((int) Math.round(((ca >> 16) & 0xFF) + (((ca >> 16) & 0xFF) - ((cb >> 16) & 0xFF)) * k), 0, 255);
            int g = Img.clamp((int) Math.round(((ca >> 8) & 0xFF) + (((ca >> 8) & 0xFF) - ((cb >> 8) & 0xFF)) * k), 0, 255);
            int bl = Img.clamp((int) Math.round((ca & 0xFF) + ((ca & 0xFF) - (cb & 0xFF)) * k), 0, 255);
            a[i] = (ca & 0xFF000000) | (r << 16) | (g << 8) | bl;
        }
        return Img.fromPixels(w, h, a);
    }

    /** 锐化：小半径 USM。 */
    private static BufferedImage applySharpen(BufferedImage img, double sharpen) {
        BufferedImage blur = Img.boxBlur(img, 1);
        int w = img.getWidth(), h = img.getHeight();
        int[] a = Img.pixels(img), b = Img.pixels(blur);
        double amt = sharpen / 100.0 * 1.6;
        for (int i = 0; i < a.length; i++) {
            int ca = a[i], cb = b[i];
            int r = Img.clamp((int) Math.round(((ca >> 16) & 0xFF) + (((ca >> 16) & 0xFF) - ((cb >> 16) & 0xFF)) * amt), 0, 255);
            int g = Img.clamp((int) Math.round(((ca >> 8) & 0xFF) + (((ca >> 8) & 0xFF) - ((cb >> 8) & 0xFF)) * amt), 0, 255);
            int bl = Img.clamp((int) Math.round((ca & 0xFF) + ((ca & 0xFF) - (cb & 0xFF)) * amt), 0, 255);
            a[i] = (ca & 0xFF000000) | (r << 16) | (g << 8) | bl;
        }
        return Img.fromPixels(w, h, a);
    }
}
