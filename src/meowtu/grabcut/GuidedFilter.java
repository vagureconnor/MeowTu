package meowtu.grabcut;

import java.awt.image.BufferedImage;

/**
 * 经典引导滤波：引导图取灰度，盒滤波用积分图实现，每像素 O(1)。
 * 计算在 0..1 归一化域进行：q = meanA * I + meanB。
 */
public final class GuidedFilter {

    private GuidedFilter() {}

    public static int[] filter(BufferedImage guide, int[] p, int radius, double eps) {
        int w = guide.getWidth(), h = guide.getHeight(), n = w * h;
        int r = Math.max(1, radius);
        double[] imgI = new double[n];
        double[] imgP = new double[n];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = guide.getRGB(x, y);
                double gray = 0.299 * ((rgb >> 16) & 0xFF)
                            + 0.587 * ((rgb >> 8) & 0xFF)
                            + 0.114 * (rgb & 0xFF);
                int i = y * w + x;
                imgI[i] = gray / 255.0;
                int pv = (p != null && i < p.length) ? p[i] : 0;
                imgP[i] = Math.max(0, Math.min(255, pv)) / 255.0;
            }
        }
        double[] meanI = boxFilter(imgI, w, h, r);
        double[] meanP = boxFilter(imgP, w, h, r);
        double[] ip = new double[n];
        double[] ii = new double[n];
        for (int i = 0; i < n; i++) {
            ip[i] = imgI[i] * imgP[i];
            ii[i] = imgI[i] * imgI[i];
        }
        double[] meanIp = boxFilter(ip, w, h, r);
        double[] meanII = boxFilter(ii, w, h, r);
        double[] a = new double[n];
        double[] b = new double[n];
        for (int i = 0; i < n; i++) {
            double covIp = meanIp[i] - meanI[i] * meanP[i];
            double varI = meanII[i] - meanI[i] * meanI[i];
            a[i] = covIp / (varI + eps);
            b[i] = meanP[i] - a[i] * meanI[i];
        }
        double[] meanA = boxFilter(a, w, h, r);
        double[] meanB = boxFilter(b, w, h, r);
        int[] out = new int[n];
        for (int i = 0; i < n; i++) {
            double q = meanA[i] * imgI[i] + meanB[i];
            if (q < 0) q = 0;
            if (q > 1) q = 1;
            out[i] = (int) Math.round(q * 255.0);
        }
        return out;
    }

    // 积分图盒滤波，窗口在边界处收缩并按实际面积归一化
    static double[] boxFilter(double[] src, int w, int h, int r) {
        int sw = w + 1;
        double[] integ = new double[sw * (h + 1)];
        for (int y = 0; y < h; y++) {
            double rowSum = 0;
            int srcRow = y * w;
            int cur = (y + 1) * sw;
            int up = y * sw;
            for (int x = 0; x < w; x++) {
                rowSum += src[srcRow + x];
                integ[cur + x + 1] = integ[up + x + 1] + rowSum;
            }
        }
        double[] out = new double[w * h];
        for (int y = 0; y < h; y++) {
            int y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
            for (int x = 0; x < w; x++) {
                int x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
                double s = integ[(y1 + 1) * sw + x1 + 1] - integ[y0 * sw + x1 + 1]
                         - integ[(y1 + 1) * sw + x0] + integ[y0 * sw + x0];
                out[y * w + x] = s / ((x1 - x0 + 1) * (double) (y1 - y0 + 1));
            }
        }
        return out;
    }
}
