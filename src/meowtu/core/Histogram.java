package meowtu.core;

import java.awt.image.BufferedImage;

/** 直方图统计：R/G/B/明度四通道计数与均值/中位数/标准差。 */
public class Histogram {
    public static final int R = 0, G = 1, B = 2, LUM = 3;
    public final int[][] count = new int[4][256];
    public final double[] mean = new double[4];
    public final double[] median = new double[4];
    public final double[] std = new double[4];
    public long total;

    public static Histogram compute(BufferedImage img) {
        Histogram hst = new Histogram();
        int w = img.getWidth(), h = img.getHeight();
        int step = Math.max(1, (int) Math.sqrt((double) w * h / 1_000_000));
        int[] px = Img.pixels(img);
        long n = 0;
        for (int y = 0; y < h; y += step) {
            for (int x = 0; x < w; x += step) {
                int c = px[y * w + x];
                if ((c >>> 24) == 0) continue;
                int r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
                int lum = (int) Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
                hst.count[R][r]++; hst.count[G][g]++; hst.count[B][b]++; hst.count[LUM][lum]++;
                n++;
            }
        }
        hst.total = n;
        if (n == 0) return hst;
        for (int ch = 0; ch < 4; ch++) {
            double sum = 0;
            for (int v = 0; v < 256; v++) sum += (double) v * hst.count[ch][v];
            hst.mean[ch] = sum / n;
            double var = 0;
            for (int v = 0; v < 256; v++) var += (v - hst.mean[ch]) * (v - hst.mean[ch]) * hst.count[ch][v];
            hst.std[ch] = Math.sqrt(var / n);
            long acc = 0;
            for (int v = 0; v < 256; v++) {
                acc += hst.count[ch][v];
                if (acc >= n / 2) { hst.median[ch] = v; break; }
            }
        }
        return hst;
    }

    public int maxCount(int ch) {
        int m = 1;
        for (int v = 0; v < 256; v++) m = Math.max(m, count[ch][v]);
        return m;
    }
}
