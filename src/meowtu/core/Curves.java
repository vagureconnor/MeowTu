package meowtu.core;

import java.awt.*;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 曲线调色：4 条曲线（RGB 合成、R、G、B），每条为控制点样条（Catmull-Rom），
 * 生成 256 级 LUT 后合成应用：out = lut_单通道[ lut_RGB[v] ]。
 */
public class Curves {
    public static final int RGB = 0, R = 1, G = 2, B = 3;

    private final List<List<Point>> channels = new ArrayList<>();

    public Curves() {
        for (int i = 0; i < 4; i++) {
            List<Point> pts = new ArrayList<>();
            pts.add(new Point(0, 0));
            pts.add(new Point(255, 255));
            channels.add(pts);
        }
    }

    public List<Point> points(int ch) { return channels.get(ch); }

    public void setPoints(int ch, List<Point> pts) {
        List<Point> copy = new ArrayList<>();
        for (Point p : pts) copy.add(new Point(p));
        copy.sort(Comparator.comparingInt(p -> p.x));
        channels.set(ch, copy);
    }

    public void reset() {
        for (int i = 0; i < 4; i++) {
            channels.get(i).clear();
            channels.get(i).add(new Point(0, 0));
            channels.get(i).add(new Point(255, 255));
        }
    }

    public boolean isIdentity() {
        for (int ch = 0; ch < 4; ch++) {
            int[] lut = lut(ch);
            for (int v = 0; v < 256; v++) if (lut[v] != v) return false;
        }
        return true;
    }

    /** 单条曲线的 LUT。 */
    public int[] lut(int ch) {
        List<Point> pts = new ArrayList<>(channels.get(ch));
        pts.sort(Comparator.comparingInt(p -> p.x));
        if (pts.isEmpty() || pts.get(0).x > 0) pts.add(0, new Point(0, pts.isEmpty() ? 0 : pts.get(0).y));
        if (pts.get(pts.size() - 1).x < 255) pts.add(new Point(255, pts.get(pts.size() - 1).y));
        int[] lut = new int[256];
        for (int v = 0; v < 256; v++) lut[v] = (int) Math.round(evalSpline(pts, v));
        return lut;
    }

    /** Catmull-Rom 样条求值（x 为输入值 0..255）。 */
    private static double evalSpline(List<Point> pts, double x) {
        int n = pts.size();
        if (x <= pts.get(0).x) return pts.get(0).y;
        if (x >= pts.get(n - 1).x) return pts.get(n - 1).y;
        int i = 0;
        while (i < n - 2 && x > pts.get(i + 1).x) i++;
        Point p0 = pts.get(Math.max(0, i - 1)), p1 = pts.get(i), p2 = pts.get(i + 1), p3 = pts.get(Math.min(n - 1, i + 2));
        double t = (x - p1.x) / Math.max(1, p2.x - p1.x);
        double t2 = t * t, t3 = t2 * t;
        double y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t
                + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
                + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        return Img.clamp(y, 0, 255);
    }

    /** 合成 LUT：返回 [3][256]（先过 RGB 曲线，再过各自单通道曲线）。 */
    public int[][] combinedLuts() {
        int[] rgb = lut(RGB);
        int[][] out = new int[3][256];
        int[][] single = { lut(R), lut(G), lut(B) };
        for (int ch = 0; ch < 3; ch++)
            for (int v = 0; v < 256; v++) out[ch][v] = single[ch][rgb[v]];
        return out;
    }

    public BufferedImage apply(BufferedImage src) {
        if (isIdentity()) return Img.copy(src);
        int[][] luts = combinedLuts();
        int w = src.getWidth(), h = src.getHeight();
        int[] px = Img.pixels(src);
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            px[i] = (c & 0xFF000000)
                    | (luts[0][(c >> 16) & 0xFF] << 16)
                    | (luts[1][(c >> 8) & 0xFF] << 8)
                    | luts[2][c & 0xFF];
        }
        return Img.fromPixels(w, h, px);
    }

    /** 预设曲线（只改 RGB 合成通道，其余重置）。 */
    public static Curves preset(String name) {
        Curves c = new Curves();
        switch (name) {
            case "提亮" -> c.setPoints(RGB, List.of(new Point(0, 0), new Point(128, 160), new Point(255, 255)));
            case "压暗" -> c.setPoints(RGB, List.of(new Point(0, 0), new Point(128, 96), new Point(255, 255)));
            case "S曲线" -> c.setPoints(RGB, List.of(new Point(0, 0), new Point(64, 48), new Point(192, 208), new Point(255, 255)));
            case "强对比" -> c.setPoints(RGB, List.of(new Point(0, 0), new Point(64, 32), new Point(192, 224), new Point(255, 255)));
            case "褪色" -> c.setPoints(RGB, List.of(new Point(0, 32), new Point(128, 128), new Point(255, 232)));
            default -> { /* 线性 */ }
        }
        return c;
    }

    public static final String[] PRESET_NAMES = {"线性", "提亮", "压暗", "S曲线", "强对比", "褪色"};
}
