package meowtu.core;

/**
 * 区域掩膜：逐行移植 webapp/js/masks.js（MTMasks）。
 * 对应关系：JS 的 Float32Array(0..1) 掩膜 ↔ 本类 byte[](0..255，读时 &amp;0xFF)；
 * JS make(img,name,opt) ↔ sky/water/greenery/skin(argb,w,h[,feather])；
 * JS feather/invert/multiply/add/fromAlpha 同名同义（在本类里均走 byte 口径，羽化内部用 float 计算后量化）。
 * 规则表、HSL/YCbCr 计算、位置权重与 JS 逐式对应。
 */
public final class Masks {
    private Masks() {}

    private static double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    private static double ramp(double v, double a, double b) { return clamp01((v - a) / (b - a)); }
    private static double hueDist(double h, double c) { double d = Math.abs(h - c) % 360; return d > 180 ? 360 - d : d; }
    // JS posW：亲和度 s 在 0.4..0.6 间快速过渡，偏向侧平台 1、另一侧 0.1
    private static double posW(double t, boolean top) { double s = top ? 1 - t : t; return 0.1 + 0.9 * ramp(s - 0.4, 0, 0.2); }

    // JS RULES 表：pos 为位置偏向（top/bot/null），score 见各方法内注释
    private interface Score { double apply(double h, double s, double l, int r, int g, int b, double y, double cb, double cr); }

    private static final Score SKY = (h, s, l, r, g, b, y, cb, cr) ->
            ramp(70 - hueDist(h, 215), 0, 35) * ramp(s, 0.08, 0.25) * ramp(l, 0.22, 0.42);
    private static final Score WATER = (h, s, l, r, g, b, y, cb, cr) ->
            ramp(65 - hueDist(h, 200), 0, 32) * ramp(s, 0.10, 0.28) * ramp(l, 0.15, 0.32);
    private static final Score GREENERY = (h, s, l, r, g, b, y, cb, cr) ->
            ramp(62 - hueDist(h, 115), 0, 30) * ramp(s, 0.18, 0.38) * ramp(l, 0.10, 0.22) * ramp(0.92 - l, 0, 0.12);
    private static final Score SKIN = (h, s, l, r, gg, b, y, cb, cr) ->
            ramp(cb, 72, 82) * ramp(132 - cb, 0, 10) * ramp(cr, 128, 138) * ramp(178 - cr, 0, 10)
                    * ((r > 95 && gg > 40 && b > 20 && r > gg && r > b && r - gg > 15) ? 1 : 0);

    // JS make()：单遍扫描，逐像素算 HSL + YCbCr 后打分乘位置权重，最后羽化
    private static byte[] make(int[] argb, int w, int h, String pos, Score score, int featherRad) {
        float[] m = new float[w * h];
        for (int yy = 0; yy < h; yy++) {
            double pw = pos == null ? 1 : posW((double) yy / h, pos.equals("top"));
            int row = yy * w;
            for (int x = 0; x < w; x++) {
                int c = argb[row + x];
                int r = (c >> 16) & 0xFF, gg = (c >> 8) & 0xFF, b = c & 0xFF;
                int mx = Math.max(r, Math.max(gg, b)), mn = Math.min(r, Math.min(gg, b)), d = mx - mn;
                double l = (mx + mn) / 510.0;
                double hue = 0;
                double s = d != 0 ? (l > 0.5 ? d / (510.0 - mx - mn) : d / (double) (mx + mn)) : 0;
                if (d != 0) {
                    // JS % 是截断余数（可为负），Java % 对 double 同语义
                    hue = mx == r ? 60 * (((gg - b) / (double) d) % 6)
                            : mx == gg ? 60 * ((b - r) / (double) d + 2)
                            : 60 * ((r - gg) / (double) d + 4);
                    if (hue < 0) hue += 360;
                }
                double yv = 0.299 * r + 0.587 * gg + 0.114 * b;
                m[row + x] = (float) (score.apply(hue, s, l, r, gg, b, yv,
                        128 - 0.168 * r - 0.331 * gg + 0.5 * b,
                        128 + 0.5 * r - 0.419 * gg - 0.081 * b) * pw);
            }
        }
        return toBytes(featherF(m, w, h, featherRad));
    }

    public static byte[] sky(int[] argb, int w, int h) { return sky(argb, w, h, 0); }
    public static byte[] sky(int[] argb, int w, int h, int feather) { return make(argb, w, h, "top", SKY, feather); }
    public static byte[] water(int[] argb, int w, int h) { return water(argb, w, h, 0); }
    public static byte[] water(int[] argb, int w, int h, int feather) { return make(argb, w, h, "bot", WATER, feather); }
    public static byte[] greenery(int[] argb, int w, int h) { return greenery(argb, w, h, 0); }
    public static byte[] greenery(int[] argb, int w, int h, int feather) { return make(argb, w, h, null, GREENERY, feather); }
    public static byte[] skin(int[] argb, int w, int h) { return skin(argb, w, h, 0); }
    public static byte[] skin(int[] argb, int w, int h, int feather) { return make(argb, w, h, null, SKIN, feather); }

    /** 按名取掩膜（对应 JS api[name]），未知名字返回 null。 */
    public static byte[] byName(String name, int[] argb, int w, int h, int feather) {
        switch (name) {
            case "sky": return sky(argb, w, h, feather);
            case "water": return water(argb, w, h, feather);
            case "greenery": return greenery(argb, w, h, feather);
            case "skin": return skin(argb, w, h, feather);
            default: return null;
        }
    }

    // JS feather：可分离 box blur，滑动窗口 O(n)，半径 <1 原样返回
    private static float[] featherF(float[] m, int w, int h, int rad) {
        if (rad < 1) return m;
        float[] tmp = new float[m.length], out = new float[m.length];
        int win = 2 * rad + 1;
        for (int y = 0; y < h; y++) {
            int row = y * w;
            double acc = 0;
            for (int x = -rad; x <= rad; x++) acc += m[row + Math.min(w - 1, Math.max(0, x))];
            for (int x = 0; x < w; x++) {
                tmp[row + x] = (float) (acc / win);
                acc += m[row + Math.min(w - 1, x + rad + 1)] - m[row + Math.max(0, x - rad)];
            }
        }
        for (int x = 0; x < w; x++) {
            double acc = 0;
            for (int y = -rad; y <= rad; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (int y = 0; y < h; y++) {
                out[y * w + x] = (float) (acc / win);
                acc += tmp[Math.min(h - 1, y + rad + 1) * w + x] - tmp[Math.max(0, y - rad) * w + x];
            }
        }
        return out;
    }

    public static byte[] feather(byte[] m, int w, int h, int rad) {
        if (rad < 1) return m;
        return toBytes(featherF(toFloat(m), w, h, rad));
    }

    // JS zip 系列：invert/multiply/add，逐元素
    public static byte[] invert(byte[] a) {
        byte[] o = new byte[a.length];
        for (int i = 0; i < a.length; i++) o[i] = (byte) (255 - (a[i] & 0xFF));
        return o;
    }

    public static byte[] multiply(byte[] a, byte[] b) {
        byte[] o = new byte[a.length];
        for (int i = 0; i < a.length; i++) o[i] = (byte) Math.round((a[i] & 0xFF) * (b[i] & 0xFF) / 255.0);
        return o;
    }

    public static byte[] add(byte[] a, byte[] b) {
        byte[] o = new byte[a.length];
        for (int i = 0; i < a.length; i++) o[i] = (byte) Math.min(255, (a[i] & 0xFF) + (b[i] & 0xFF));
        return o;
    }

    // JS fromAlpha：取 alpha 通道为掩膜，可羽化
    public static byte[] fromAlpha(int[] argb, int w, int h) { return fromAlpha(argb, w, h, 0); }
    public static byte[] fromAlpha(int[] argb, int w, int h, int feather) {
        float[] m = new float[w * h];
        for (int i = 0; i < w * h; i++) m[i] = (argb[i] >>> 24) / 255f;
        return toBytes(featherF(m, w, h, feather));
    }

    // byte(0..255) ↔ float(0..1) 互转（供 NlEdit 混合用）
    public static float[] toFloat(byte[] m) {
        float[] f = new float[m.length];
        for (int i = 0; i < m.length; i++) f[i] = (m[i] & 0xFF) / 255f;
        return f;
    }

    public static byte[] toBytes(float[] m) {
        byte[] b = new byte[m.length];
        for (int i = 0; i < m.length; i++) b[i] = (byte) Math.round(clamp01(m[i]) * 255);
        return b;
    }
}
