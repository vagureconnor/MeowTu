package meowtu.core;

import java.awt.geom.Point2D;
import java.awt.image.BufferedImage;

/**
 * 四角自由变换，逐项译自 webapp/js/transform.js（其本身译自 PhotoCraft transform.rs）：
 * 变换由源矩形四角落点 quad 描述（角序 左上,右上,右下,左下），缩放/旋转/斜切是仿射特例，
 * 透视用完整单应。变形 = 逆映射 + 预乘 alpha 双线性采样（取样坐标钳制 = 边缘拉伸）；
 * 轮廓抗锯齿 = 覆盖度因子 cu/cv（按目标中心处足迹，即逆雅可比跨度计算）；
 * 跨地平线时只画 front_side 一侧。偏差同 JS：输出外接矩形不加 ±1px 滤波支撑圈，
 * 大缩小不预缩小。输出尺寸上限：单边 12000、总像素 1e8，超限/退化返回 null。
 */
public final class QuadTransform {
    private QuadTransform() {}

    public static final class WarpResult {
        public final BufferedImage image; public final int offX, offY;
        WarpResult(BufferedImage image, int offX, int offY) { this.image = image; this.offX = offX; this.offY = offY; }
    }

    /* ---- 单应矩阵（行主序 9 元） ---- */
    public static double[] mul(double[] a, double[] b) {
        double[] r = new double[9];
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++)
            r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
        return r;
    }
    public static double[] applyH(double[] m, double x, double y) {
        double w = m[6] * x + m[7] * y + m[8];
        return new double[]{(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w};
    }
    /** 伴随矩阵求逆，奇异返回 null。 */
    public static double[] inverseH(double[] m) {
        double[] c = {
            m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
            m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
            m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]};
        double det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
        if (Math.abs(det) < 1e-12) return null;
        for (int i = 0; i < 9; i++) c[i] /= det;
        return c;
    }
    /** 单位正方形 → quad，退化返回 null。 */
    public static double[] squareToQuad(double[][] q) {
        double x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1],
               x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
        double sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
        if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12)
            return new double[]{x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1};
        double dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
        double den = dx1 * dy2 - dx2 * dy1;
        if (Math.abs(den) < 1e-12) return null;
        double g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
        return new double[]{x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
                            y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1};
    }
    /** 矩形 r={x0,y0,x1,y1} → quad 的单应，退化返回 null。 */
    public static double[] rectToQuad(double[] r, double[][] quad) {
        double w = r[2] - r[0], h = r[3] - r[1];
        if (!(w > 0) || !(h > 0)) return null;
        double[] sq = squareToQuad(quad);
        if (sq == null) return null;
        return mul(sq, new double[]{1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1});
    }
    static int frontSide(double[] m, double W, double H) {
        double[][] cs = {{0, 0}, {W, 0}, {W, H}, {0, H}};
        int ahead = 0;
        for (double[] p : cs) if (m[6] * p[0] + m[7] * p[1] + m[8] > 0) ahead++;
        if (ahead >= 3) return 1;
        if (ahead <= 1) return -1;
        return (m[6] * W / 2 + m[7] * H / 2 + m[8]) >= 0 ? 1 : -1;
    }

    public static WarpResult warp(BufferedImage src, Point2D[] quad) {
        if (quad == null || quad.length != 4) return null;
        double[][] q = new double[4][2];
        for (int i = 0; i < 4; i++) { q[i][0] = quad[i].getX(); q[i][1] = quad[i].getY(); }
        return warp(src, q);
    }
    /** 把 src 按 quad（源矩形四角在目标空间的落点，{x,y}×4）变形。
     *  返回外接矩形图 + 其左上在目标空间的坐标；退化/超限返回 null。 */
    public static WarpResult warp(BufferedImage src, double[][] quad) {
        if (src == null || src.getWidth() < 1 || quad == null || quad.length != 4) return null;
        int W = src.getWidth(), H = src.getHeight();
        double[] hm = rectToQuad(new double[]{0, 0, W, H}, quad);
        if (hm == null) return null;
        double[][] corners = new double[4][];
        double[][] srcCorners = {{0, 0}, {W, 0}, {W, H}, {0, H}};
        for (int i = 0; i < 4; i++) {
            corners[i] = applyH(hm, srcCorners[i][0], srcCorners[i][1]);
            if (!Double.isFinite(corners[i][0]) || !Double.isFinite(corners[i][1])) return null;
        }
        int bx0 = (int) Math.floor(Math.min(Math.min(corners[0][0], corners[1][0]), Math.min(corners[2][0], corners[3][0])));
        int by0 = (int) Math.floor(Math.min(Math.min(corners[0][1], corners[1][1]), Math.min(corners[2][1], corners[3][1])));
        int bx1 = (int) Math.ceil(Math.max(Math.max(corners[0][0], corners[1][0]), Math.max(corners[2][0], corners[3][0])));
        int by1 = (int) Math.ceil(Math.max(Math.max(corners[0][1], corners[1][1]), Math.max(corners[2][1], corners[3][1])));
        int ow = bx1 - bx0, oh = by1 - by0;
        if (ow < 1 || oh < 1 || ow > 12000 || oh > 12000 || (double) ow * oh > 100_000_000) return null;
        double[] inv = inverseH(hm);
        if (inv == null) return null;
        double[][] fwP = {{-1, -1}, {W + 1, -1}, {W + 1, H + 1}, {-1, H + 1}};
        boolean pos = true, neg = true;
        for (double[] p : fwP) { double wv = hm[6] * p[0] + hm[7] * p[1] + hm[8]; if (!(wv > 0)) pos = false; if (!(wv < 0)) neg = false; }
        boolean oneSide = pos || neg;
        int front = oneSide ? 0 : frontSide(hm, W, H);
        double cx = (bx0 + bx1) / 2.0, cy = (by0 + by1) / 2.0;
        double[] mc = applyH(inv, cx, cy), mx = applyH(inv, cx + 1, cy), my = applyH(inv, cx, cy + 1);
        double footU = extent(Math.abs(mx[0] - mc[0]) + Math.abs(my[0] - mc[0]));
        double footV = extent(Math.abs(mx[1] - mc[1]) + Math.abs(my[1] - mc[1]));

        int[] sd = Img.pixels(src);
        int[] dd = new int[ow * oh];
        for (int y = 0; y < oh; y++) for (int x = 0; x < ow; x++) {
            double px = bx0 + x + 0.5, py = by0 + y + 0.5;
            double iw = inv[6] * px + inv[7] * py + inv[8];
            if (iw == 0 || (front != 0 && front * iw <= 0)) continue;
            double u = (inv[0] * px + inv[1] * py + inv[2]) / iw - 0.5;
            double v = (inv[3] * px + inv[4] * py + inv[5]) / iw - 0.5;
            if (u < -1.5 || v < -1.5 || u > W - 0.5 || v > H - 0.5) continue;
            int x0 = (int) Math.floor(u), y0 = (int) Math.floor(v);
            double fx = u - x0, fy = v - y0;
            double a0 = 0, a1 = 0, a2 = 0, a3 = 0;
            for (int dy = 0; dy <= 1; dy++) for (int dx = 0; dx <= 1; dx++) {
                double wgt = (dx == 1 ? fx : 1 - fx) * (dy == 1 ? fy : 1 - fy);
                if (wgt == 0) continue;
                int c = tap(sd, W, H, x0 + dx, y0 + dy);
                double al = (c >>> 24) / 255.0 * wgt; // 预乘采样
                a0 += ((c >> 16) & 0xFF) * al; a1 += ((c >> 8) & 0xFF) * al; a2 += (c & 0xFF) * al; a3 += al;
            }
            double uc = u + 0.5, vc = v + 0.5;
            double cu = Math.min(Math.max(Math.min(uc, W - uc) / footU + 0.5, 0), 1);
            double cv = Math.min(Math.max(Math.min(vc, H - vc) / footV + 0.5, 0), 1);
            a3 *= cu * cv;
            if (a3 <= 0) continue;
            double k = cu * cv; int di = y * ow + x;
            dd[di] = Img.argb(
                Img.clamp((int) Math.round(Math.min(1, a3) * 255), 0, 255),
                Img.clamp((int) Math.round(Math.min(255, Math.max(0, a0 * k / a3))), 0, 255),
                Img.clamp((int) Math.round(Math.min(255, Math.max(0, a1 * k / a3))), 0, 255),
                Img.clamp((int) Math.round(Math.min(255, Math.max(0, a2 * k / a3))), 0, 255));
        }
        return new WarpResult(Img.fromPixels(ow, oh, dd), bx0, by0);
    }
    private static double extent(double e) { return (Double.isFinite(e) && e > 1e-12) ? e : 1; }
    private static int tap(int[] sd, int W, int H, int x, int y) { // 坐标钳制取样（边缘拉伸）
        int cx = x < 0 ? 0 : (x >= W ? W - 1 : x);
        int cy = y < 0 ? 0 : (y >= H ? H - 1 : y);
        return sd[cy * W + cx];
    }
    /** 变形后贴回文档尺寸（超出裁掉，范围外透明）——engine.js transformLayer 的口径。退化返回 null。 */
    public static BufferedImage warpToDocument(BufferedImage src, double[][] quad, int docW, int docH) {
        WarpResult r = warp(src, quad);
        if (r == null) return null;
        int[] out = new int[docW * docH];
        int[] sp = Img.pixels(r.image);
        int iw = r.image.getWidth(), ih = r.image.getHeight();
        for (int y = 0; y < ih; y++) { int dy = r.offY + y; if (dy < 0 || dy >= docH) continue;
            for (int x = 0; x < iw; x++) { int dx = r.offX + x; if (dx < 0 || dx >= docW) continue;
                out[dy * docW + dx] = sp[y * iw + x]; } }
        return Img.fromPixels(docW, docH, out);
    }
    public static BufferedImage warpToDocument(BufferedImage src, Point2D[] quad, int docW, int docH) {
        if (quad == null || quad.length != 4) return null;
        double[][] q = new double[4][2];
        for (int i = 0; i < 4; i++) { q[i][0] = quad[i].getX(); q[i][1] = quad[i].getY(); }
        return warpToDocument(src, q, docW, docH);
    }
}
