package meowtu.core;

import java.awt.*;
import java.awt.geom.Point2D;
import java.awt.image.BufferedImage;

/** 几何变换：全部基于双线性采样的逆映射实现，输出 ARGB，越界为透明。 */
public final class Geometry {
    private Geometry() {}

    @FunctionalInterface
    public interface Mapper { void map(double dx, double dy, double[] out); }

    /** 通用逆映射重采样。 */
    public static BufferedImage remap(BufferedImage src, int w2, int h2, Mapper m) {
        int w = src.getWidth(), h = src.getHeight();
        int[] sp = Img.pixels(src);
        int[] dp = new int[w2 * h2];
        double[] s = new double[2];
        for (int y = 0; y < h2; y++) {
            for (int x = 0; x < w2; x++) {
                m.map(x, y, s);
                dp[y * w2 + x] = sample(sp, w, h, s[0], s[1]);
            }
        }
        return Img.fromPixels(w2, h2, dp);
    }

    /** 双线性采样；完全越界返回透明，边缘部分按 alpha 加权。 */
    public static int sample(int[] px, int w, int h, double sx, double sy) {
        int x0 = (int) Math.floor(sx), y0 = (int) Math.floor(sy);
        double fx = sx - x0, fy = sy - y0;
        double a = 0, r = 0, g = 0, b = 0, wsum = 0;
        for (int dy = 0; dy <= 1; dy++) {
            for (int dx = 0; dx <= 1; dx++) {
                int x = x0 + dx, y = y0 + dy;
                if (x < 0 || y < 0 || x >= w || y >= h) continue;
                double wt = (dx == 0 ? 1 - fx : fx) * (dy == 0 ? 1 - fy : fy);
                int c = px[y * w + x];
                double al = c >>> 24;
                a += al * wt; r += ((c >> 16) & 0xFF) * al * wt; g += ((c >> 8) & 0xFF) * al * wt; b += (c & 0xFF) * al * wt;
                wsum += al * wt;
            }
        }
        if (a < 0.5) return 0;
        double denom = Math.max(1e-6, wsum);
        return Img.argb(Img.clamp((int) Math.round(a), 0, 255),
                Img.clamp((int) Math.round(r / denom), 0, 255),
                Img.clamp((int) Math.round(g / denom), 0, 255),
                Img.clamp((int) Math.round(b / denom), 0, 255));
    }

    public static BufferedImage rotate90(BufferedImage src, boolean clockwise) {
        int w = src.getWidth(), h = src.getHeight();
        return remap(src, h, w, (dx, dy, out) -> {
            if (clockwise) { out[0] = dy; out[1] = h - 1 - dx; }
            else { out[0] = w - 1 - dy; out[1] = dx; }
        });
    }

    /** 任意角度旋转（度，顺时针为正），画布自动扩展，背景透明。 */
    public static BufferedImage rotate(BufferedImage src, double degrees) {
        double rad = Math.toRadians(degrees);
        double cos = Math.cos(rad), sin = Math.sin(rad);
        int w = src.getWidth(), h = src.getHeight();
        int w2 = (int) Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
        int h2 = (int) Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double cx2 = (w2 - 1) / 2.0, cy2 = (h2 - 1) / 2.0;
        return remap(src, w2, h2, (dx, dy, out) -> {
            double x = dx - cx2, y = dy - cy2;
            out[0] = cx + x * cos + y * sin;
            out[1] = cy - x * sin + y * cos;
        });
    }

    public static BufferedImage flipH(BufferedImage src) {
        int w = src.getWidth(), h = src.getHeight();
        int[] sp = Img.pixels(src), dp = new int[sp.length];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) dp[y * w + x] = sp[y * w + (w - 1 - x)];
        return Img.fromPixels(w, h, dp);
    }

    public static BufferedImage flipV(BufferedImage src) {
        int w = src.getWidth(), h = src.getHeight();
        int[] sp = Img.pixels(src), dp = new int[sp.length];
        for (int y = 0; y < h; y++)
            System.arraycopy(sp, (h - 1 - y) * w, dp, y * w, w);
        return Img.fromPixels(w, h, dp);
    }

    public static BufferedImage crop(BufferedImage src, Rectangle r) {
        Rectangle b = r.intersection(new Rectangle(0, 0, src.getWidth(), src.getHeight()));
        if (b.width <= 0 || b.height <= 0) return Img.copy(src);
        int[] sp = Img.pixels(src), dp = new int[b.width * b.height];
        for (int y = 0; y < b.height; y++)
            System.arraycopy(sp, (b.y + y) * src.getWidth() + b.x, dp, y * b.width, b.width);
        return Img.fromPixels(b.width, b.height, dp);
    }

    /**
     * 透视矫正：quad 为源图上四角（顺序：左上、右上、右下、左下），
     * 输出为包围该四边形的正视图，尺寸取对边较大者。
     */
    public static BufferedImage perspective(BufferedImage src, Point2D[] quad) {
        double wTop = quad[0].distance(quad[1]), wBot = quad[3].distance(quad[2]);
        double hLeft = quad[0].distance(quad[3]), hRight = quad[1].distance(quad[2]);
        int w2 = Math.max(8, (int) Math.round(Math.max(wTop, wBot)));
        int h2 = Math.max(8, (int) Math.round(Math.max(hLeft, hRight)));
        Point2D[] dst = { new Point2D.Double(0, 0), new Point2D.Double(w2 - 1, 0),
                new Point2D.Double(w2 - 1, h2 - 1), new Point2D.Double(0, h2 - 1) };
        double[][] H = homography(dst, quad); // 目标 -> 源
        return remap(src, w2, h2, (dx, dy, out) -> {
            double den = H[2][0] * dx + H[2][1] * dy + H[2][2];
            out[0] = (H[0][0] * dx + H[0][1] * dy + H[0][2]) / den;
            out[1] = (H[1][0] * dx + H[1][1] * dy + H[1][2]) / den;
        });
    }

    /** 求把 from 四点映射到 to 四点的 3x3 单应矩阵（高斯消元解 8 元线性方程组）。 */
    static double[][] homography(Point2D[] from, Point2D[] to) {
        double[][] A = new double[8][9];
        for (int i = 0; i < 4; i++) {
            double x = from[i].getX(), y = from[i].getY();
            double u = to[i].getX(), v = to[i].getY();
            int r = i * 2;
            A[r] = new double[]{x, y, 1, 0, 0, 0, -u * x, -u * y, u};
            A[r + 1] = new double[]{0, 0, 0, x, y, 1, -v * x, -v * y, v};
        }
        for (int col = 0; col < 8; col++) {
            int piv = col;
            for (int r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
            double[] tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
            double d = A[col][col];
            for (int j = col; j < 9; j++) A[col][j] /= d;
            for (int r = 0; r < 8; r++) {
                if (r == col) continue;
                double f = A[r][col];
                if (f != 0) for (int j = col; j < 9; j++) A[r][j] -= f * A[col][j];
            }
        }
        return new double[][]{
                {A[0][8], A[1][8], A[2][8]},
                {A[3][8], A[4][8], A[5][8]},
                {A[6][8], A[7][8], 1}};
    }

    /** 镜头畸变：k>0 桶形，k<0 枕形，k 范围约 -1..1。 */
    public static BufferedImage lensDistort(BufferedImage src, double k) {
        int w = src.getWidth(), h = src.getHeight();
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double scale = Math.min(cx, cy);
        return remap(src, w, h, (dx, dy, out) -> {
            double nx = (dx - cx) / scale, ny = (dy - cy) / scale;
            double r2 = nx * nx + ny * ny;
            double f = 1 + k * 0.42 * r2;
            out[0] = cx + (dx - cx) / f;
            out[1] = cy + (dy - cy) / f;
        });
    }

    /** 波浪扭曲：amp 振幅(px)，period 波长(px)，vertical=true 时波纹沿竖直方向传播。 */
    public static BufferedImage wave(BufferedImage src, double amp, double period, boolean vertical) {
        return remap(src, src.getWidth(), src.getHeight(), (dx, dy, out) -> {
            if (vertical) { out[0] = dx + amp * Math.sin(2 * Math.PI * dy / period); out[1] = dy; }
            else { out[0] = dx; out[1] = dy + amp * Math.sin(2 * Math.PI * dx / period); }
        });
    }

    /** 旋涡扭曲：strength 为中心最大旋转角（弧度，正=顺时针）。 */
    public static BufferedImage swirl(BufferedImage src, double strength) {
        int w = src.getWidth(), h = src.getHeight();
        double cx = (w - 1) / 2.0, cy = (h - 1) / 2.0;
        double radius = Math.min(cx, cy);
        return remap(src, w, h, (dx, dy, out) -> {
            double x = dx - cx, y = dy - cy;
            double r = Math.sqrt(x * x + y * y);
            if (r >= radius || r < 0.001) { out[0] = dx; out[1] = dy; return; }
            double t = 1 - r / radius;
            double ang = strength * t * t;
            double cos = Math.cos(ang), sin = Math.sin(ang);
            out[0] = cx + x * cos + y * sin;
            out[1] = cy - x * sin + y * cos;
        });
    }
}
