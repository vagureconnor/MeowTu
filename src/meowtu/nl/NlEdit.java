package meowtu.nl;

import meowtu.core.AdjustParams;
import meowtu.core.Img;
import meowtu.core.LutEngine;
import meowtu.core.Masks;
import meowtu.filters.Filters;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * 一句话修图「执行层」：移植 webapp/js/nledit.js（MTNLEdit）。
 * 对应关系：JS plan() ↔ {@link #plan}；JS apply() 的画布烘焙 ↔ {@link #apply}（桌面版无图层状态，
 * 全图参数增量另由 {@link #applyDelta} 并入调用方的 AdjustParams）；JS regionMask/applyJob 同名同义；
 * JS CUSTOM 自定义像素 op 逐式移植；JS BACKGROUNDS 背景库只移植纯色/渐变/虚化原图三类
 * （scene 类：蓝天白云/晚霞/绿地 未做——任务限定三种）。
 * 近似偏差（JS 引擎滤镜在桌面端无同名实现）：denoise 的 medianDenoise 以盒式模糊近似、
 * skinSmooth 的 surfaceBlur 以高斯模糊近似；其余（bw 走 Filters、blur 走 Img.gaussianBlur）为真实现。
 */
public final class NlEdit {
    private NlEdit() {}

    private static double clamp(double v, double a, double b) { return v < a ? a : v > b ? b : v; }
    private static int clamp255(double v) { return v < 0 ? 0 : v > 255 ? 255 : (int) Math.round(v); }
    private static double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    // JS MASK_OF：region → Masks 掩膜名（background 特殊处理，见 regionMask）
    private static final Map<String, String> MASK_OF = Map.of(
            "sky", "sky", "water", "water", "greenery", "greenery", "portrait", "skin", "foreground", "skin");

    /** 对应 JS FILTER_OPS 产出的 {id, params}。 */
    public static final class FilterSpec {
        public final String id;
        public final Map<String, Double> params;
        FilterSpec(String id, Map<String, Double> params) { this.id = id; this.params = params; }
    }

    /** 对应 JS jobs[] 的一项：一个区域的参数/滤镜/自定义 op 集合。 */
    public static final class Job {
        public final String region;
        public final AdjustParams params = new AdjustParams();
        public final List<FilterSpec> filters = new ArrayList<>();
        public final List<NlParse.Op> custom = new ArrayList<>();
        Job(String region) { this.region = region; }
        public boolean isEmpty() { return params.isIdentity() && filters.isEmpty() && custom.isEmpty(); }
    }

    /** 对应 JS plan() 的返回 P。 */
    public static final class Plan {
        public final AdjustParams params = new AdjustParams();          // 全图增量
        public final Map<String, Double> absolutes = new LinkedHashMap<>(); // 全图绝对值（按参数名）
        public FilterSpec filter;                                        // 全图首个滤镜
        public final List<Job> jobs = new ArrayList<>();
        public final List<NlParse.Op> resets = new ArrayList<>();
        public final List<String> lines = new ArrayList<>();
        public int count;
    }

    // AdjustParams 按名读写（对应 JS 以参数名为键的对象操作）
    private static void addTo(AdjustParams p, String key, double v) {
        switch (key) {
            case "exposure": p.exposure += v; break;
            case "brightness": p.brightness += v; break;
            case "contrast": p.contrast += v; break;
            case "temperature": p.temperature += v; break;
            case "tint": p.tint += v; break;
            case "saturation": p.saturation += v; break;
            case "vibrance": p.vibrance += v; break;
            case "highlights": p.highlights += v; break;
            case "shadows": p.shadows += v; break;
            case "whites": p.whites += v; break;
            case "blacks": p.blacks += v; break;
            case "clarity": p.clarity += v; break;
            case "sharpen": p.sharpen += v; break;
            default: break;
        }
    }

    private static void setTo(AdjustParams p, String key, double v) {
        AdjustParams d = new AdjustParams();
        addTo(d, key, v);
        // 用「先归零该字段再加」实现赋值：借 addTo 无法赋值，故直接 switch
        switch (key) {
            case "exposure": p.exposure = d.exposure; break;
            case "brightness": p.brightness = d.brightness; break;
            case "contrast": p.contrast = d.contrast; break;
            case "temperature": p.temperature = d.temperature; break;
            case "tint": p.tint = d.tint; break;
            case "saturation": p.saturation = d.saturation; break;
            case "vibrance": p.vibrance = d.vibrance; break;
            case "highlights": p.highlights = d.highlights; break;
            case "shadows": p.shadows = d.shadows; break;
            case "whites": p.whites = d.whites; break;
            case "blacks": p.blacks = d.blacks; break;
            case "clarity": p.clarity = d.clarity; break;
            case "sharpen": p.sharpen = d.sharpen; break;
            default: break;
        }
    }

    // JS COMPOSITE：复合 op → 引擎参数换算（去雾≈对比+饱和+清晰，柔化≈负清晰）
    private static Map<String, Double> composite(String op, double d) {
        Map<String, Double> m = new LinkedHashMap<>();
        if (op.equals("dehaze")) { m.put("contrast", .6 * d); m.put("saturation", .35 * d); m.put("clarity", .5 * d); }
        else if (op.equals("soften")) { m.put("clarity", -.8 * d); }
        return m;
    }

    // JS FILTER_OPS：滤镜类 op → 滤镜规格（参数由 delta 推）
    private static FilterSpec filterFor(String op, double d) {
        Map<String, Double> p = new LinkedHashMap<>();
        switch (op) {
            case "bw": return new FilterSpec("bw", p);
            case "denoise": p.put("radius", d >= 25 ? 2.0 : 1.0); return new FilterSpec("medianDenoise", p);
            case "grain":
                p.put("amount", clamp(Math.round(d * 1.2), 4, 120)); p.put("monochrome", 1.0);
                return new FilterSpec("addNoise", p);
            case "blur": p.put("radius", clamp(1 + d * .12, 1, 12)); return new FilterSpec("gaussianBlur", p);
            case "skinSmooth":
                p.put("radius", clamp(Math.round(2 + d * .1), 2, 12)); p.put("threshold", 18.0);
                return new FilterSpec("surfaceBlur", p);
            default: return null;
        }
    }

    /** JS plan()：把解析结果分成 全图状态 / 区域烘焙 / 恢复 三类，并生成人话解读 lines。 */
    public static Plan plan(NlParse.ParseResult parsed) {
        Plan P = new Plan();
        Map<String, Job> byRegion = new LinkedHashMap<>();
        for (NlParse.Op o : parsed.ops) {
            String rl = NlLabels.REGION_LABEL.getOrDefault(o.region, "全图");
            if (o.reset) {
                P.resets.add(o);
                P.lines.add(o.op.equals("all") ? "恢复全部调节"
                        : (rl.equals("全图") ? "" : rl) + NlLabels.PARAM_LABEL.getOrDefault(o.op, o.op) + "恢复默认");
                P.count++;
                continue;
            }
            boolean regional = MASK_OF.containsKey(o.region) || o.region.equals("background");
            Map<String, Double> deltas = new LinkedHashMap<>();
            if (NlLabels.PARAM_LABEL.containsKey(o.op))
                deltas.put(o.op, o.op.equals("exposure") ? o.delta * .1 : (double) o.delta); // 曝光：解析单位 → EV
            else if (o.op.equals("dehaze") || o.op.equals("soften"))
                deltas.putAll(composite(o.op, o.delta));
            if (!deltas.isEmpty()) {
                if (regional) {
                    Job j = jobFor(P, byRegion, o.region);
                    deltas.forEach((k, v) -> addTo(j.params, k, v));
                } else if (o.absolute && NlLabels.PARAM_LABEL.containsKey(o.op)) {
                    P.absolutes.put(o.op, deltas.get(o.op));
                } else {
                    deltas.forEach((k, v) -> addTo(P.params, k, v));
                }
                String label = NlLabels.OP_LABEL.getOrDefault(o.op, NlLabels.PARAM_LABEL.get(o.op));
                P.lines.add(rl + label + " " + (o.delta > 0 ? "+" : "") + o.delta);
                P.count++;
                continue;
            }
            if (NlLabels.FILTER_OPS.contains(o.op)) {
                FilterSpec f = filterFor(o.op, o.delta);
                if (!regional && P.filter == null) P.filter = f;
                else jobFor(P, byRegion, regional ? o.region : "global").filters.add(f);
                P.lines.add(rl + NlLabels.OP_LABEL.get(o.op) + (o.op.equals("bw") ? "" : " +" + o.delta));
                P.count++;
                continue;
            }
            if (NlLabels.CUSTOM_OPS.contains(o.op)) {
                jobFor(P, byRegion, regional ? o.region : "global").custom.add(o);
                P.lines.add(rl + NlLabels.OP_LABEL.get(o.op) + " +" + o.delta);
                P.count++;
                continue;
            }
            P.lines.add(rl + o.op + "（暂无法执行）");
        }
        return P;
    }

    private static Job jobFor(Plan P, Map<String, Job> byRegion, String region) {
        Job j = byRegion.get(region);
        if (j == null) { j = new Job(region); byRegion.put(region, j); P.jobs.add(j); }
        return j;
    }

    /** 把 plan 的全图部分并入目标参数（增量叠加、绝对值覆盖、reset 清零），对应 JS apply() 的状态合并段。 */
    public static void applyDelta(AdjustParams target, NlParse.ParseResult parsed) {
        Plan P = plan(parsed);
        for (NlParse.Op r : P.resets) {
            if (r.op.equals("all")) target.reset();
            else if (NlLabels.PARAM_LABEL.containsKey(r.op)) setTo(target, r.op, 0);
        }
        AdjustParams d = P.params;
        target.exposure += d.exposure; target.brightness += d.brightness; target.contrast += d.contrast;
        target.temperature += d.temperature; target.tint += d.tint; target.saturation += d.saturation;
        target.vibrance += d.vibrance; target.highlights += d.highlights; target.shadows += d.shadows;
        target.whites += d.whites; target.blacks += d.blacks; target.clarity += d.clarity; target.sharpen += d.sharpen;
        P.absolutes.forEach((k, v) -> setTo(target, k, v));
    }

    // ---------- JS CUSTOM：自定义像素 op 逐式移植（入参为 ARGB 像素数组） ----------
    private static void customSkyBlue(int[] px, double d) {
        for (int i = 0; i < px.length; i++) {
            int r = (px[i] >> 16) & 0xFF, g = (px[i] >> 8) & 0xFF, b = px[i] & 0xFF;
            double w = clamp01((b - (r + g) / 2.0 + 40) / 80);
            if (w == 0) continue;
            px[i] = (px[i] & 0xFF000000) | (clamp255(r - d * .18 * w) << 16)
                    | (clamp255(g - d * .06 * w) << 8) | clamp255(b + d * 1.4 * w);
        }
    }

    private static void customHueGreen(int[] px, double d) {
        for (int i = 0; i < px.length; i++) {
            int r = (px[i] >> 16) & 0xFF, g = (px[i] >> 8) & 0xFF, b = px[i] & 0xFF;
            double w = clamp01((g - Math.max(r, b) + 30) / 70.0);
            if (w == 0) continue;
            px[i] = (px[i] & 0xFF000000) | (clamp255(r - d * .1 * w) << 16)
                    | (clamp255(g + d * 1.1 * w) << 8) | clamp255(b - d * .1 * w);
        }
    }

    private static void customSkinWhiten(int[] px, double d) {
        double f = 1 + d / 100 * .45, s = 1 - d / 100 * .2;
        for (int i = 0; i < px.length; i++) {
            int r = (px[i] >> 16) & 0xFF, g = (px[i] >> 8) & 0xFF, b = px[i] & 0xFF;
            double y = .299 * r + .587 * g + .114 * b;
            px[i] = (px[i] & 0xFF000000) | (clamp255((y + (r - y) * s) * f) << 16)
                    | (clamp255((y + (g - y) * s) * f) << 8) | clamp255((y + (b - y) * s) * f);
        }
    }

    private static void customVignette(int[] px, int w, int h, double d) {
        double cx = w / 2.0, cy = h / 2.0, max = Math.hypot(cx, cy);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            double t = Math.hypot(x - cx, y - cy) / max, s = clamp01((t - .4) / .6);
            if (s == 0) continue;
            int i = y * w + x;
            double f = 1 - d / 100 * .55 * s * s;
            int r = (px[i] >> 16) & 0xFF, g = (px[i] >> 8) & 0xFF, b = px[i] & 0xFF;
            px[i] = (px[i] & 0xFF000000) | (clamp255(r * f) << 16) | (clamp255(g * f) << 8) | clamp255(b * f);
        }
    }

    private static void applyCustom(int[] px, int w, int h, String op, double d) {
        switch (op) {
            case "skyBlue": customSkyBlue(px, d); break;
            case "hueGreen": customHueGreen(px, d); break;
            case "skinWhiten": customSkinWhiten(px, d); break;
            case "vignette": customVignette(px, w, h, d); break;
            default: break;
        }
    }

    // ---------- 滤镜规格落地（桌面端实现，偏差见类注释） ----------
    private static BufferedImage applyFilter(BufferedImage img, FilterSpec f) {
        int w = img.getWidth(), h = img.getHeight();
        switch (f.id) {
            case "bw": return Filters.apply("bw", img, 1.0);
            case "gaussianBlur": return Img.gaussianBlur(img, Math.max(1, (int) Math.round(f.params.get("radius"))));
            case "medianDenoise": return Img.boxBlur(img, Math.max(1, (int) Math.round(f.params.get("radius"))));
            case "surfaceBlur": return Img.gaussianBlur(img, Math.max(1, (int) Math.round(f.params.get("radius"))));
            case "addNoise": {
                int[] px = Img.pixels(img);
                double amt = f.params.get("amount");
                Random rnd = new Random(0x5EEDL); // 固定种子，结果可复现（JS 为 Math.random，此处刻意不同）
                for (int i = 0; i < px.length; i++) {
                    int n = (int) Math.round((rnd.nextDouble() * 2 - 1) * amt); // monochrome=1：三通道同噪
                    int r = (px[i] >> 16) & 0xFF, g = (px[i] >> 8) & 0xFF, b = px[i] & 0xFF;
                    px[i] = (px[i] & 0xFF000000) | (clamp255(r + n) << 16) | (clamp255(g + n) << 8) | clamp255(b + n);
                }
                return Img.fromPixels(w, h, px);
            }
            default: return img;
        }
    }

    // ---------- JS regionMask：区域掩膜（自研口径），返回 0..1 float；无掩膜概念的区域返回 null ----------
    public static float[] regionMask(int[] argb, String region, int w, int h) {
        int rad = Math.max(1, (int) Math.round(Math.min(w, h) * .03));
        if (region.equals("background")) {
            // 主体 = 肤色区域；几乎没有肤色时兜底取中央椭圆（JS 自研假设：主体在中央）
            byte[] skin = Masks.skin(argb, w, h);
            long sum = 0;
            for (byte b : skin) sum += b & 0xFF;
            byte[] subj = skin;
            if (sum / (double) skin.length / 255.0 <= .02) {
                subj = new byte[w * h];
                double cx = w / 2.0, cy = h / 2.0, rx = w * .32, ry = h * .38;
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                    double dx = (x - cx) / rx, dy = (y - cy) / ry;
                    if (dx * dx + dy * dy <= 1) subj[y * w + x] = (byte) 255;
                }
            }
            return Masks.toFloat(Masks.feather(Masks.invert(subj), w, h, rad));
        }
        String name = MASK_OF.get(region);
        return name == null ? null : Masks.toFloat(Masks.byName(name, argb, w, h, rad));
    }

    // JS applyJob：调整一份 → 按掩膜混合回原图（global 区域整幅返回调整结果）
    private static BufferedImage applyJob(BufferedImage base, Job job) {
        BufferedImage adj = base;
        if (!job.params.isIdentity()) adj = LutEngine.apply(adj, job.params);
        for (FilterSpec f : job.filters) adj = applyFilter(adj, f);
        if (!job.custom.isEmpty()) {
            int[] px = Img.pixels(adj);
            for (NlParse.Op c : job.custom) applyCustom(px, base.getWidth(), base.getHeight(), c.op, c.delta);
            adj = Img.fromPixels(base.getWidth(), base.getHeight(), px);
        }
        if (job.region.equals("global")) return adj;
        float[] mask = regionMask(Img.pixels(base), job.region, base.getWidth(), base.getHeight());
        if (mask == null) return adj;
        int[] bd = Img.pixels(base), ad = Img.pixels(adj), out = new int[bd.length];
        for (int i = 0; i < mask.length; i++) {
            double m = mask[i];
            int a = (int) Math.round((bd[i] >>> 24) + ((ad[i] >>> 24) - (bd[i] >>> 24)) * m);
            int r = (int) Math.round(((bd[i] >> 16) & 0xFF) + (((ad[i] >> 16) & 0xFF) - ((bd[i] >> 16) & 0xFF)) * m);
            int g = (int) Math.round(((bd[i] >> 8) & 0xFF) + (((ad[i] >> 8) & 0xFF) - ((bd[i] >> 8) & 0xFF)) * m);
            int b = (int) Math.round((bd[i] & 0xFF) + ((ad[i] & 0xFF) - (bd[i] & 0xFF)) * m);
            out[i] = (Img.clamp(a, 0, 255) << 24) | (Img.clamp(r, 0, 255) << 16)
                    | (Img.clamp(g, 0, 255) << 8) | Img.clamp(b, 0, 255);
        }
        return Img.fromPixels(base.getWidth(), base.getHeight(), out);
    }

    /**
     * JS apply() 的桌面版：把解析结果整体作用到一张图（全图参数/滤镜直接作用，区域任务烘焙混合）。
     * resets 在无状态的一次性调用里无对象可清（目标参数的清零走 applyDelta），故此处忽略并在 lines 外不计。
     */
    public static BufferedImage apply(BufferedImage src, NlParse.ParseResult parsed) {
        Plan P = plan(parsed);
        if (P.count == 0) return Img.copy(src);
        AdjustParams eff = P.params.copy();
        P.absolutes.forEach((k, v) -> setTo(eff, k, v));
        BufferedImage img = src;
        if (!eff.isIdentity()) img = LutEngine.apply(img, eff);
        if (P.filter != null) img = applyFilter(img, P.filter);
        for (Job j : P.jobs) if (!j.isEmpty()) img = applyJob(img, j);
        return img;
    }

    // ---------- 一键换背景：只做纯色 / 渐变 / 虚化原图三类（JS BACKGROUNDS 的同类条目） ----------
    public static final class Bg {
        public final String id, name, type;   // type: color / grad / blur
        public final Color color;             // color 类
        public final Color top, bottom;       // grad 类（JS stops 均为两段，纵向）
        Bg(String id, String name, String type, Color color, Color top, Color bottom) {
            this.id = id; this.name = name; this.type = type; this.color = color; this.top = top; this.bottom = bottom;
        }
    }

    private static Color hex(String s) { return Color.decode(s); }

    public static final List<Bg> BACKGROUNDS = List.of(
            new Bg("white", "纯白", "color", hex("#ffffff"), null, null),
            new Bg("black", "纯黑", "color", hex("#101014"), null, null),
            new Bg("red", "中国红", "color", hex("#d93a2b"), null, null),
            new Bg("blue", "晴空蓝", "color", hex("#2b6de8"), null, null),
            new Bg("green", "草地绿", "color", hex("#3fae5a"), null, null),
            new Bg("yellow", "柠檬黄", "color", hex("#f5c542"), null, null),
            new Bg("pink", "樱花粉", "color", hex("#f2a7c3"), null, null),
            new Bg("gray", "高级灰", "color", hex("#9aa0a6"), null, null),
            new Bg("gradDawn", "晨曦", "grad", null, hex("#ffe3b3"), hex("#ff9d7e")),
            new Bg("gradSky", "晴空", "grad", null, hex("#7ec8ff"), hex("#eaf8ff")),
            new Bg("gradMint", "薄荷", "grad", null, hex("#c9ffe2"), hex("#4fb98f")),
            new Bg("gradDusk", "紫夜", "grad", null, hex("#2e2560"), hex("#b06ab3")),
            new Bg("blur", "虚化原图", "blur", null, null, null));
    // JS 的 scene 类背景（蓝天白云/晚霞/绿地，程序绘制场景）未移植：任务限定纯色/渐变/虚化原图三种。

    /** JS renderBackground：blur 类需传入已虚化的原图（与 JS 的 blurCanvas 同口径）；缺省兜底 #dfe6ea。 */
    public static BufferedImage renderBackground(Bg bg, int w, int h, BufferedImage blurCanvas) {
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        if (bg.type.equals("blur") && blurCanvas != null) {
            return Img.resize(blurCanvas, w, h);
        }
        int[] px = new int[w * h];
        if (bg.type.equals("grad")) {
            for (int y = 0; y < h; y++) {
                double t = h <= 1 ? 0 : (double) y / (h - 1);
                int rgb = lerp(bg.top, bg.bottom, t);
                for (int x = 0; x < w; x++) px[y * w + x] = rgb;
            }
        } else {
            int rgb = 0xFF000000 | (bg.type.equals("color") ? bg.color.getRGB() & 0xFFFFFF : 0xDFE6EA);
            java.util.Arrays.fill(px, rgb);
        }
        out.setRGB(0, 0, w, h, px, 0, w);
        return out;
    }

    private static int lerp(Color a, Color b, double t) {
        int r = (int) Math.round(a.getRed() + (b.getRed() - a.getRed()) * t);
        int g = (int) Math.round(a.getGreen() + (b.getGreen() - a.getGreen()) * t);
        int bl = (int) Math.round(a.getBlue() + (b.getBlue() - a.getBlue()) * t);
        return 0xFF000000 | (r << 16) | (g << 8) | bl;
    }

    /** 虚化原图背景的便捷生成：高斯模糊一份原图（供 renderBackground 的 blur 类使用）。 */
    public static BufferedImage blurredCopy(BufferedImage src, int radius) {
        return Img.gaussianBlur(src, Math.max(1, radius));
    }

    /** 把带 alpha 的主体合成到背景上（over 合成）。 */
    public static BufferedImage compositeOver(BufferedImage fg, BufferedImage bg) {
        int w = bg.getWidth(), h = bg.getHeight();
        BufferedImage f = Img.resize(fg, w, h);
        int[] fp = Img.pixels(f), bp = Img.pixels(bg), out = new int[fp.length];
        for (int i = 0; i < fp.length; i++) {
            double a = (fp[i] >>> 24) / 255.0;
            int r = (int) Math.round(((fp[i] >> 16) & 0xFF) * a + ((bp[i] >> 16) & 0xFF) * (1 - a));
            int g = (int) Math.round(((fp[i] >> 8) & 0xFF) * a + ((bp[i] >> 8) & 0xFF) * (1 - a));
            int b = (int) Math.round((fp[i] & 0xFF) * a + (bp[i] & 0xFF) * (1 - a));
            out[i] = 0xFF000000 | (r << 16) | (g << 8) | b;
        }
        return Img.fromPixels(w, h, out);
    }

    /** JS softenAlpha：主体边缘柔化，alpha 当掩膜走 Masks 羽化（半径 1）。 */
    public static BufferedImage softenAlpha(BufferedImage canvas) {
        int w = canvas.getWidth(), h = canvas.getHeight();
        int[] px = Img.pixels(canvas);
        byte[] soft = Masks.feather(Masks.fromAlpha(px, w, h), w, h, 1);
        for (int i = 0; i < soft.length; i++) px[i] = ((soft[i] & 0xFF) << 24) | (px[i] & 0x00FFFFFF);
        return Img.fromPixels(w, h, px);
    }
}
