package meowtu.core;

import java.awt.*;
import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;

/** 图像基础工具：拷贝、像素数组互转、缩放、盒式模糊。内部统一用 ARGB。 */
public final class Img {
    private Img() {}

    /** 深拷贝为 TYPE_INT_ARGB。 */
    public static BufferedImage copy(BufferedImage src) {
        if (src == null) return null;
        BufferedImage dst = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = dst.createGraphics();
        g.drawImage(src, 0, 0, null);
        g.dispose();
        return dst;
    }

    /** 若已是可直读的 INT_ARGB 直接返回其数据数组，否则拷贝后返回新图数据。 */
    public static int[] pixels(BufferedImage img) {
        return img.getRGB(0, 0, img.getWidth(), img.getHeight(), null, 0, img.getWidth());
    }

    public static BufferedImage fromPixels(int w, int h, int[] px) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        img.setRGB(0, 0, w, h, px, 0, w);
        return img;
    }

    /** 等比缩放：最长边不超过 maxSide（已更小则返回拷贝）。 */
    public static BufferedImage downscale(BufferedImage src, int maxSide) {
        int w = src.getWidth(), h = src.getHeight();
        int m = Math.max(w, h);
        if (m <= maxSide) return copy(src);
        double s = (double) maxSide / m;
        return resize(src, Math.max(1, (int) Math.round(w * s)), Math.max(1, (int) Math.round(h * s)));
    }

    /** 指定尺寸缩放（双线性）。 */
    public static BufferedImage resize(BufferedImage src, int w, int h) {
        BufferedImage dst = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = dst.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, w, h, null);
        g.dispose();
        return dst;
    }

    /** 可分离盒式模糊（滑动窗口，O(1)/像素），radius 为半径像素。 */
    public static BufferedImage boxBlur(BufferedImage src, int radius) {
        if (radius <= 0) return copy(src);
        int w = src.getWidth(), h = src.getHeight();
        int[] in = pixels(src);
        int[] tmp = new int[in.length];
        int[] out = new int[in.length];
        blurPass(in, tmp, w, h, radius, true);
        blurPass(tmp, out, w, h, radius, false);
        return fromPixels(w, h, out);
    }

    private static void blurPass(int[] in, int[] out, int w, int h, int r, boolean horizontal) {
        int span = 2 * r + 1;
        if (horizontal) {
            for (int y = 0; y < h; y++) {
                long sa = 0, sr = 0, sg = 0, sb = 0;
                int row = y * w;
                for (int i = -r; i <= r; i++) {
                    int p = in[row + clamp(i, 0, w - 1)];
                    sa += p >>> 24; sr += (p >> 16) & 0xFF; sg += (p >> 8) & 0xFF; sb += p & 0xFF;
                }
                for (int x = 0; x < w; x++) {
                    out[row + x] = argb(sa / span, sr / span, sg / span, sb / span);
                    int sub = in[row + clamp(x - r, 0, w - 1)];
                    int add = in[row + clamp(x + r + 1, 0, w - 1)];
                    sa += (add >>> 24) - (sub >>> 24);
                    sr += ((add >> 16) & 0xFF) - ((sub >> 16) & 0xFF);
                    sg += ((add >> 8) & 0xFF) - ((sub >> 8) & 0xFF);
                    sb += (add & 0xFF) - (sub & 0xFF);
                }
            }
        } else {
            for (int x = 0; x < w; x++) {
                long sa = 0, sr = 0, sg = 0, sb = 0;
                for (int i = -r; i <= r; i++) {
                    int p = in[clamp(i, 0, h - 1) * w + x];
                    sa += p >>> 24; sr += (p >> 16) & 0xFF; sg += (p >> 8) & 0xFF; sb += p & 0xFF;
                }
                for (int y = 0; y < h; y++) {
                    out[y * w + x] = argb(sa / span, sr / span, sg / span, sb / span);
                    int sub = in[clamp(y - r, 0, h - 1) * w + x];
                    int add = in[clamp(y + r + 1, 0, h - 1) * w + x];
                    sa += (add >>> 24) - (sub >>> 24);
                    sr += ((add >> 16) & 0xFF) - ((sub >> 16) & 0xFF);
                    sg += ((add >> 8) & 0xFF) - ((sub >> 8) & 0xFF);
                    sb += (add & 0xFF) - (sub & 0xFF);
                }
            }
        }
    }

    /** 近似高斯模糊：三次盒式叠加。 */
    public static BufferedImage gaussianBlur(BufferedImage src, int radius) {
        if (radius <= 0) return copy(src);
        BufferedImage img = src;
        for (int i = 0; i < 3; i++) img = boxBlur(img, Math.max(1, radius / 2));
        return img;
    }

    public static int clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
    public static double clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
    public static int argb(long a, long r, long g, long b) {
        return ((int) a << 24) | ((int) r << 16) | ((int) g << 8) | (int) b;
    }
    public static int argb(int a, int r, int g, int b) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    /** 是否可直接拿到底层 int 数组（TYPE_INT_ARGB 且单数据块）。 */
    public static boolean isDirect(BufferedImage img) {
        return img.getType() == BufferedImage.TYPE_INT_ARGB
                && img.getRaster().getDataBuffer() instanceof DataBufferInt
                && ((DataBufferInt) img.getRaster().getDataBuffer()).getNumBanks() == 1;
    }
}
