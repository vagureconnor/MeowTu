package meowtu.core;

import java.awt.image.BufferedImage;
import java.util.HashMap;
import java.util.Map;

/**
 * 3D LUT 电影调色（逐项移植 webapp/js/lut.js，其采样口径译自 PhotoCraft lut3d_sample 三线性分支）：
 * 内置预设不用外部文件——「预设 → 变换算子表」运行时采样生成 17³ 表并缓存；
 * .cube 按行业通用文本格式解析（DOMAIN 仅支持 0..1，数据行须恰好 n³ 行、red 变化最快）。
 * LUT 状态与网页版同构：{id, strength(0..100 百分比), cube?, name?}。
 */
public final class Lut {
    private Lut() {}

    public static final int SIZE = 17;

    /** LUT 状态（与网页版 lut state 同构）。 */
    public static final class State {
        public String id;        // 预设 id 或 "custom"
        public double strength = 100; // 0..100
        public String cube;      // id=custom 时的 .cube 文本
        public String name;

        public State() {}
        public State(String id, double strength) { this.id = id; this.strength = strength; }
        public State copy() { State s = new State(); s.id = id; s.strength = strength; s.cube = cube; s.name = name; return s; }
        public boolean sameAs(State o) {
            if (o == null) return false;
            return java.util.Objects.equals(id, o.id) && strength == o.strength
                    && java.util.Objects.equals(cube, o.cube) && java.util.Objects.equals(name, o.name);
        }
    }

    /** 一张 LUT 表：size³ 个 RGB 三元组（red 变化最快），分量 0..1。 */
    public static final class Table {
        public final int size;
        public final float[] data;
        public String title = "";
        Table(int size, float[] data) { this.size = size; this.data = data; }
    }

    // ---------- 算子表解释器（与 lut.js OPS 一一对应） ----------
    private interface Op { double[] run(double[] c, Object p); }

    private static double c01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    private static double lum(double r, double g, double b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
    private static double[] d3(double a, double b, double c) { return new double[]{a, b, c}; }
    private static double[] d6(double a, double b, double c, double d, double e, double f) { return new double[]{a, b, c, d, e, f}; }

    private static final Map<String, Op> OPS = new HashMap<>();
    static {
        OPS.put("gain", (c, p) -> { double[] q = (double[]) p; return d3(c[0] * q[0], c[1] * q[1], c[2] * q[2]); });
        OPS.put("lift", (c, p) -> { double[] q = (double[]) p; return d3(c[0] + q[0], c[1] + q[1], c[2] + q[2]); });
        OPS.put("gamma", (c, p) -> { double e = 1.0 / (Double) p; return d3(Math.pow(c[0], e), Math.pow(c[1], e), Math.pow(c[2], e)); });
        OPS.put("contrast", (c, p) -> { double q = (Double) p; return d3((c[0] - .5) * q + .5, (c[1] - .5) * q + .5, (c[2] - .5) * q + .5); });
        OPS.put("sat", (c, p) -> { double q = (Double) p, l = lum(c[0], c[1], c[2]); return d3(l + (c[0] - l) * q, l + (c[1] - l) * q, l + (c[2] - l) * q); });
        OPS.put("gray", (c, p) -> { double q = (Double) p, l = lum(c[0], c[1], c[2]); return d3(c[0] + (l - c[0]) * q, c[1] + (l - c[1]) * q, c[2] + (l - c[2]) * q); });
        OPS.put("split", (c, p) -> {
            Object[] q = (Object[]) p; double[] s = (double[]) q[0], h = (double[]) q[1]; double a = (Double) q[2];
            double l = lum(c[0], c[1], c[2]);
            return d3(c[0] + (s[0] * (1 - l) + h[0] * l) * a, c[1] + (s[1] * (1 - l) + h[1] * l) * a, c[2] + (s[2] * (1 - l) + h[2] * l) * a);
        });
        OPS.put("fade", (c, p) -> { double[] q = (double[]) p; return d3(q[0] + c[0] * (q[3] - q[0]), q[1] + c[1] * (q[4] - q[1]), q[2] + c[2] * (q[5] - q[2])); });
    }

    private static Object[] op(String name, Object param) { return new Object[]{name, param}; }
    private static Object[] splitOp(double[] s, double[] h, double a) { return new Object[]{"split", new Object[]{s, h, a}}; }

    // ---------- 内置预设（数据驱动：预设名 → 算子表，与 lut.js PRESETS 逐项一致） ----------
    private static final Object[][][] PRESET_OPS = {
        { splitOp(d3(-0.03, 0.05, 0.10), d3(0.11, 0.04, -0.07), 0.9), op("sat", 1.18), op("contrast", 1.08) },                                     // tealOrange 青橙
        { op("fade", d6(0.03, 0.045, 0.03, 1, 0.98, 0.95)), op("gain", d3(0.98, 1.03, 0.97)), op("sat", 0.88), op("contrast", 0.96) },              // fuji 富士
        { op("fade", d6(0.07, 0.06, 0.05, 0.97, 0.96, 0.94)), op("gain", d3(1.04, 1.0, 0.92)), op("sat", 0.85), op("contrast", 1.05), op("gamma", 0.96) }, // film 胶片
        { op("gray", 0.82), splitOp(d3(-0.01, 0, 0.02), d3(0.15, 0.08, -0.05), 0.85), op("contrast", 1.12), op("sat", 1.06) },                     // blackGold 黑金
        { op("fade", d6(0.05, 0.045, 0.03, 1, 0.99, 0.97)), op("gain", d3(1.03, 1.0, 0.94)), op("sat", 0.92), op("contrast", 0.92), op("gamma", 1.06) }, // cream 奶油
        { op("fade", d6(0.10, 0.10, 0.09, 1, 1, 1)), op("gain", d3(0.99, 1.02, 1.03)), op("sat", 0.82), op("contrast", 0.94) },                    // japanese 日系清新
        { splitOp(d3(0.07, -0.03, 0.11), d3(-0.05, 0.07, 0.11), 1.0), op("sat", 1.30), op("contrast", 1.15) },                                      // cyber 赛博
        { op("gray", 1.0), op("contrast", 1.18), op("fade", d6(0.02, 0.02, 0.02, 0.99, 0.99, 0.99)), op("gamma", 1.03) },                          // bwFilm 黑白电影
    };
    public static final String[][] PRESETS = {
        {"tealOrange", "青橙"}, {"fuji", "富士"}, {"film", "胶片"}, {"blackGold", "黑金"},
        {"cream", "奶油"}, {"japanese", "日系清新"}, {"cyber", "赛博"}, {"bwFilm", "黑白电影"},
    };

    private static double[] applyOps(Object[][] ops, double r, double g, double b) {
        double[] c = {r, g, b};
        for (Object[] o : ops) {
            c = OPS.get((String) o[0]).run(c, o[1]);
            c = d3(c01(c[0]), c01(c[1]), c01(c[2]));
        }
        return c;
    }

    /** 由算子表采样生成 n³ 表（red 最快）。 */
    public static Table generate(int n, Object[][] ops) {
        float[] data = new float[n * n * n * 3];
        int m = n - 1, i = 0;
        for (int b = 0; b < n; b++) for (int g = 0; g < n; g++) for (int r = 0; r < n; r++) {
            double[] c = applyOps(ops, (double) r / m, (double) g / m, (double) b / m);
            data[i++] = (float) c01(c[0]); data[i++] = (float) c01(c[1]); data[i++] = (float) c01(c[2]);
        }
        return new Table(n, data);
    }

    private static final Map<String, Table> presetCache = new HashMap<>();
    private static final Map<String, Table> cubeCache = new HashMap<>();

    /** 状态 → 表；无效状态返回 null（与 lut.js resolve 同义）。 */
    public static Table resolve(State st) {
        if (st == null || st.id == null) return null;
        if ("custom".equals(st.id)) {
            if (st.cube == null || st.cube.isEmpty()) return null;
            if (!cubeCache.containsKey(st.cube)) {
                Table t = null;
                try { t = parseCube(st.cube); } catch (RuntimeException e) { /* 坏文件缓存 null */ }
                cubeCache.put(st.cube, t);
            }
            return cubeCache.get(st.cube);
        }
        for (int i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i][0].equals(st.id)) {
                return presetCache.computeIfAbsent(st.id, k -> generate(SIZE, PRESET_OPS[finalIdx(k)]));
            }
        }
        return null;
    }

    private static int finalIdx(String id) {
        for (int i = 0; i < PRESETS.length; i++) if (PRESETS[i][0].equals(id)) return i;
        return -1;
    }

    public static boolean isActive(State st) {
        return st != null && st.id != null && st.strength > 0 && resolve(st) != null;
    }

    // ---------- 三线性采样（译自 PhotoCraft lut3d_sample 的 trilinear 分支，与 lut.js sample 一致） ----------
    public static double[] sample(Table t, double r, double g, double b) {
        int n = t.size;
        if (n < 2 || t.data.length < n * n * n * 3) return new double[]{r, g, b};
        int m = n - 1;
        double pr = c01(r) * m, pg = c01(g) * m, pb = c01(b) * m;
        int[] i0 = {Math.min((int) Math.floor(pr), n - 2), Math.min((int) Math.floor(pg), n - 2), Math.min((int) Math.floor(pb), n - 2)};
        double fr = pr - i0[0], fg = pg - i0[1], fb = pb - i0[2];
        // at(dr,dg,db) 索引 ((i0b+db)*n + i0g+dg)*n + i0r+dr
        double[] a000 = at(t, i0, 0, 0, 0), a100 = at(t, i0, 1, 0, 0), a010 = at(t, i0, 0, 1, 0), a110 = at(t, i0, 1, 1, 0);
        double[] a001 = at(t, i0, 0, 0, 1), a101 = at(t, i0, 1, 0, 1), a011 = at(t, i0, 0, 1, 1), a111 = at(t, i0, 1, 1, 1);
        double[] c00 = lerp3(a000, a100, fr), c10 = lerp3(a010, a110, fr), c01v = lerp3(a001, a101, fr), c11 = lerp3(a011, a111, fr);
        return lerp3(lerp3(c00, c10, fg), lerp3(c01v, c11, fg), fb);
    }

    private static double[] at(Table t, int[] i0, int dr, int dg, int db) {
        int idx = (((i0[2] + db) * t.size + i0[1] + dg) * t.size + i0[0] + dr) * 3;
        return new double[]{t.data[idx], t.data[idx + 1], t.data[idx + 2]};
    }

    private static double[] lerp3(double[] a, double[] b, double t) {
        return d3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    }

    /** 把 LUT 状态应用到图（返回新图）：out = 原值 + (采样值 − 原值) × 强度/100。alpha 不动。 */
    public static BufferedImage apply(BufferedImage src, State st) {
        Table t = resolve(st);
        if (t == null) return Img.copy(src);
        double k = Math.min(1, st.strength / 100.0);
        if (k <= 0) return Img.copy(src);
        int w = src.getWidth(), h = src.getHeight();
        int[] px = Img.pixels(src);
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            int r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
            double[] s = sample(t, r / 255.0, g / 255.0, b / 255.0);
            r = (int) Math.round(r + (s[0] * 255 - r) * k);
            g = (int) Math.round(g + (s[1] * 255 - g) * k);
            b = (int) Math.round(b + (s[2] * 255 - b) * k);
            px[i] = (c & 0xFF000000) | (Img.clamp(r, 0, 255) << 16) | (Img.clamp(g, 0, 255) << 8) | Img.clamp(b, 0, 255);
        }
        return Img.fromPixels(w, h, px);
    }

    // ---------- .cube 解析 / 写出（与 lut.js parseCube/writeCube 同口径） ----------
    public static Table parseCube(String text) {
        if (text == null || text.trim().isEmpty()) throw new IllegalArgumentException("LUT 文件无效：文件是空的");
        int size = 0;
        String title = "";
        java.util.List<String> rows = new java.util.ArrayList<>();
        for (String raw : text.split("\\r\\n|\\r|\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.charAt(0) == '#') continue;
            int sp = -1;
            for (int i = 0; i < line.length(); i++) if (Character.isWhitespace(line.charAt(i))) { sp = i; break; }
            String head = (sp < 0 ? line : line.substring(0, sp)).toUpperCase(java.util.Locale.ROOT);
            String rest = sp < 0 ? "" : line.substring(sp).trim();
            switch (head) {
                case "TITLE": title = rest.replaceAll("^\"|\"$", ""); continue;
                case "LUT_3D_SIZE":
                    try { size = Integer.parseInt(rest); } catch (NumberFormatException e) { size = -1; }
                    if (!(size >= 2 && size <= 256)) throw new IllegalArgumentException("LUT 文件无效：LUT_3D_SIZE 应为 2..256");
                    continue;
                case "LUT_1D_SIZE": throw new IllegalArgumentException("LUT 文件无效：只支持 3D LUT（文件里是 1D）");
                case "LUT_1D_INPUT_RANGE": case "LUT_3D_INPUT_RANGE": continue;
                case "DOMAIN_MIN": case "DOMAIN_MAX": {
                    String[] parts = rest.split("\\s+");
                    double want = head.equals("DOMAIN_MIN") ? 0 : 1;
                    if (parts.length != 3) throw new IllegalArgumentException("LUT 文件无效：只支持 DOMAIN 范围 0..1");
                    for (String ps : parts) {
                        double v;
                        try { v = Double.parseDouble(ps); } catch (NumberFormatException e) { v = Double.NaN; }
                        if (v != want) throw new IllegalArgumentException("LUT 文件无效：只支持 DOMAIN 范围 0..1");
                    }
                    continue;
                }
                default:
                    if (head.matches("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")) { rows.add(line); continue; }
                    throw new IllegalArgumentException("LUT 文件无效：看不懂的一行：" + line.substring(0, Math.min(40, line.length())));
            }
        }
        if (size == 0) throw new IllegalArgumentException("LUT 文件无效：缺少 LUT_3D_SIZE");
        int need = size * size * size;
        if (rows.size() != need) throw new IllegalArgumentException("LUT 文件无效：数据行数不对：应为 " + need + " 行，实际 " + rows.size() + " 行");
        float[] data = new float[need * 3];
        for (int i = 0; i < need; i++) {
            String[] parts = rows.get(i).split("\\s+");
            if (parts.length != 3) throw new IllegalArgumentException("LUT 文件无效：第 " + (i + 1) + " 行数据不是三个数");
            for (int c = 0; c < 3; c++) {
                double v;
                try { v = Double.parseDouble(parts[c]); } catch (NumberFormatException e) { v = Double.NaN; }
                if (!Double.isFinite(v)) throw new IllegalArgumentException("LUT 文件无效：第 " + (i + 1) + " 行有非数字");
                data[i * 3 + c] = (float) c01(v);
            }
        }
        Table t = new Table(size, data);
        t.title = title;
        return t;
    }

    public static String writeCube(Table t, String title) {
        StringBuilder sb = new StringBuilder();
        sb.append("TITLE \"").append(title == null || title.isEmpty() ? "MeowTu LUT" : title).append("\"\n");
        sb.append("LUT_3D_SIZE ").append(t.size).append("\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n");
        for (int i = 0; i < t.data.length; i += 3) {
            sb.append(fmt(t.data[i])).append(' ').append(fmt(t.data[i + 1])).append(' ').append(fmt(t.data[i + 2])).append('\n');
        }
        return sb.toString();
    }

    private static String fmt(float v) {
        double d = Math.round(v * 1e6) / 1e6;
        return d == Math.floor(d) ? String.valueOf((long) d) : String.valueOf(d);
    }
}
