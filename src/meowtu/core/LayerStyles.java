package meowtu.core;

import java.awt.image.BufferedImage;
import java.util.*;

/**
 * 图层样式引擎，逐项译自 webapp/js/styles.js（其本身译自 PhotoCraft compose/effects）。
 * 效果共 9 项：bevel 斜面浮雕、stroke 描边、innerShadow 内阴影、innerGlow 内发光、
 * satin 光泽、colorOverlay 颜色叠加、gradientOverlay 渐变叠加、outerGlow 外发光、
 * dropShadow 投影。每层每类至多一条。未译（JS 也未做）：等高线（恒 Linear）、噪声、
 * 发光 Precise、斜面 Chisel/外斜面/浮雕/枕形、描边渐变/图案填充、图案叠加、多实例。
 *
 * 合成口径（engine.js compositeStack）：buildPaints 产出 ext/int 两组油漆；
 * ext 在层内容之下按数组序合成（投影→外发光→外侧描边），int 在层内容之上
 * （渐变→颜色→光泽→内发光→内阴影→内侧描边→斜面高光/阴影），画完恢复层自身 alpha。
 * 内部效果先除以形状覆盖度（relative_to_shape）再参与混合。
 * 形状 shape = 已生效像素 alpha(0..1) × 蒙版灰度（无蒙版取 1）。
 */
public final class LayerStyles {
    private LayerStyles() {}

    static final double EPS = 0.5 / 255.0;
    static double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    /* ================= 定义表（DEFS，译自 styles.js；UI 与默认值共用） ================= */
    public static final class ParamDef {
        public final String k, label, type; public final double min, max;
        public final Object def; public final String[][] opts;
        ParamDef(String k, String label, String type, double min, double max, Object def, String[][] opts) {
            this.k = k; this.label = label; this.type = type; this.min = min; this.max = max; this.def = def; this.opts = opts;
        }
    }
    public static final class EffectDef {
        public final String id, name; public final List<ParamDef> params;
        EffectDef(String id, String name, ParamDef... ps) { this.id = id; this.name = name; this.params = List.of(ps); }
    }
    private static ParamDef R(String k, String l, double mn, double mx, double d) { return new ParamDef(k, l, "range", mn, mx, d, null); }
    private static ParamDef C(String k, String l, String d) { return new ParamDef(k, l, "color", 0, 0, d, null); }
    private static ParamDef B(String k, String d) { return new ParamDef(k, "混合模式", "blend", 0, 0, d, null); }
    private static ParamDef O(String k, double d) { return R(k, "不透明度", 0, 100, d); }
    private static ParamDef SEL(String k, String l, String d, String[][] o) { return new ParamDef(k, l, "select", 0, 0, d, o); }
    private static ParamDef CHK(String k, String l, boolean d) { return new ParamDef(k, l, "check", 0, 0, d, null); }

    public static final List<EffectDef> DEFS = List.of(
        new EffectDef("bevel", "斜面和浮雕",
            R("depth", "深度 %", 0, 1000, 100), R("size", "大小 px", 0, 100, 5), R("soften", "软化 px", 0, 100, 0),
            R("angle", "角度 °", -180, 180, 120), R("altitude", "高度 °", 0, 90, 30),
            CHK("up", "方向上浮", true),
            C("highlightColor", "高光颜色", "#ffffff"), O("highlightOpacity", 75),
            C("shadowColor", "阴影颜色", "#000000"), O("shadowOpacity", 75)),
        new EffectDef("stroke", "描边",
            R("size", "大小 px", 0, 100, 1),
            SEL("position", "位置", "inside", new String[][]{{"outside", "外部"}, {"inside", "内部"}, {"center", "居中"}}),
            B("blend", "normal"), O("opacity", 100), C("color", "颜色", "#000000")),
        new EffectDef("innerShadow", "内阴影",
            B("blend", "multiply"), C("color", "颜色", "#000000"), O("opacity", 75),
            R("angle", "角度 °", -180, 180, 120), R("distance", "距离 px", 0, 100, 5),
            R("choke", "阻塞 %", 0, 100, 0), R("size", "大小 px", 0, 100, 5)),
        new EffectDef("innerGlow", "内发光",
            B("blend", "screen"), O("opacity", 75), C("color", "颜色", "#ffffbe"),
            SEL("source", "源", "edge", new String[][]{{"edge", "边缘"}, {"center", "中心"}}),
            R("choke", "阻塞 %", 0, 100, 0), R("size", "大小 px", 0, 100, 5), R("range", "范围 %", 1, 100, 50)),
        new EffectDef("satin", "光泽",
            B("blend", "multiply"), C("color", "颜色", "#000000"), O("opacity", 50),
            R("angle", "角度 °", -180, 180, 90), R("distance", "距离 px", 0, 100, 50), R("size", "大小 px", 0, 100, 80),
            CHK("invert", "反相", true)),
        new EffectDef("colorOverlay", "颜色叠加",
            B("blend", "normal"), C("color", "颜色", "#ff0000"), O("opacity", 100)),
        new EffectDef("gradientOverlay", "渐变叠加",
            B("blend", "normal"), O("opacity", 100), C("from", "起始色", "#000000"), C("to", "结束色", "#ffffff"),
            SEL("style", "样式", "linear", new String[][]{{"linear", "线性"}, {"radial", "径向"}, {"angle", "角度"}, {"reflected", "对称"}, {"diamond", "菱形"}}),
            R("angle", "角度 °", -180, 180, 90), R("scale", "缩放 %", 10, 150, 100),
            CHK("reverse", "反向", false)),
        new EffectDef("outerGlow", "外发光",
            B("blend", "screen"), O("opacity", 35), C("color", "颜色", "#ffffff"),
            R("spread", "扩展 %", 0, 100, 0), R("size", "大小 px", 0, 100, 7), R("range", "范围 %", 1, 100, 50)),
        new EffectDef("dropShadow", "投影",
            B("blend", "multiply"), C("color", "颜色", "#000000"), O("opacity", 75),
            R("angle", "角度 °", -180, 180, 120), R("distance", "距离 px", 0, 100, 5),
            R("spread", "扩展 %", 0, 100, 0), R("size", "大小 px", 0, 100, 5)));
    static final Map<String, EffectDef> DEF_BY_ID = new LinkedHashMap<>();
    static { for (EffectDef d : DEFS) DEF_BY_ID.put(d.id, d); }

    /* ================= 效果状态（字段与 JS 效果对象同构） ================= */
    public abstract static class Effect {
        public boolean on = true; // JS fresh() 产出 on=true
        Effect(String id) { for (ParamDef p : DEF_BY_ID.get(id).params) set(p.k, p.def); }
        public abstract void set(String k, Object v);
        public abstract Object get(String k);
        public abstract Effect copyFx();
        void copyBaseTo(Effect e) { e.on = on; }
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>(); m.put("on", on);
            for (ParamDef p : DEF_BY_ID.get(idOf()).params) m.put(p.k, get(p.k));
            return m;
        }
        abstract String idOf();
        void loadMap(Map<String, Object> m) {
            if (m == null) return;
            for (ParamDef p : DEF_BY_ID.get(idOf()).params)
                if (m.containsKey(p.k)) set(p.k, m.get(p.k));
            on = m.containsKey("on") ? truthy(m.get("on")) : false; // JS withDefaults: on=!!saved.on
        }
    }
    static double num(Object v, double d) { return v instanceof Number ? ((Number) v).doubleValue() : d; }
    static boolean truthy(Object v) { return v instanceof Boolean ? (Boolean) v : v != null && !"false".equals(v); }
    static String str(Object v, String d) { return v == null ? d : v.toString(); }

    public static final class Bevel extends Effect {
        public double depth, size, soften, angle, altitude, highlightOpacity, shadowOpacity;
        public boolean up; public String highlightColor, shadowColor;
        public Bevel() { super("bevel"); } String idOf() { return "bevel"; }
        public void set(String k, Object v) { switch (k) {
            case "depth": depth = num(v, depth); break; case "size": size = num(v, size); break;
            case "soften": soften = num(v, soften); break; case "angle": angle = num(v, angle); break;
            case "altitude": altitude = num(v, altitude); break; case "up": up = truthy(v); break;
            case "highlightColor": highlightColor = str(v, highlightColor); break;
            case "highlightOpacity": highlightOpacity = num(v, highlightOpacity); break;
            case "shadowColor": shadowColor = str(v, shadowColor); break;
            case "shadowOpacity": shadowOpacity = num(v, shadowOpacity); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "depth": return depth; case "size": return size; case "soften": return soften;
            case "angle": return angle; case "altitude": return altitude; case "up": return up;
            case "highlightColor": return highlightColor; case "highlightOpacity": return highlightOpacity;
            case "shadowColor": return shadowColor; case "shadowOpacity": return shadowOpacity; default: return null; } }
        public Bevel copyFx() { Bevel e = new Bevel(); copyBaseTo(e);
            e.depth = depth; e.size = size; e.soften = soften; e.angle = angle; e.altitude = altitude; e.up = up;
            e.highlightColor = highlightColor; e.highlightOpacity = highlightOpacity;
            e.shadowColor = shadowColor; e.shadowOpacity = shadowOpacity; return e; }
    }
    public static final class Stroke extends Effect {
        public double size, opacity; public String position, blend, color;
        public Stroke() { super("stroke"); } String idOf() { return "stroke"; }
        public void set(String k, Object v) { switch (k) {
            case "size": size = num(v, size); break; case "position": position = str(v, position); break;
            case "blend": blend = str(v, blend); break; case "opacity": opacity = num(v, opacity); break;
            case "color": color = str(v, color); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "size": return size; case "position": return position; case "blend": return blend;
            case "opacity": return opacity; case "color": return color; default: return null; } }
        public Stroke copyFx() { Stroke e = new Stroke(); copyBaseTo(e);
            e.size = size; e.position = position; e.blend = blend; e.opacity = opacity; e.color = color; return e; }
    }
    public static final class InnerShadow extends Effect {
        public String blend, color; public double opacity, angle, distance, choke, size;
        public InnerShadow() { super("innerShadow"); } String idOf() { return "innerShadow"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "color": color = str(v, color); break;
            case "opacity": opacity = num(v, opacity); break; case "angle": angle = num(v, angle); break;
            case "distance": distance = num(v, distance); break; case "choke": choke = num(v, choke); break;
            case "size": size = num(v, size); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "color": return color; case "opacity": return opacity;
            case "angle": return angle; case "distance": return distance; case "choke": return choke;
            case "size": return size; default: return null; } }
        public InnerShadow copyFx() { InnerShadow e = new InnerShadow(); copyBaseTo(e);
            e.blend = blend; e.color = color; e.opacity = opacity; e.angle = angle; e.distance = distance;
            e.choke = choke; e.size = size; return e; }
    }
    public static final class InnerGlow extends Effect {
        public String blend, color, source; public double opacity, choke, size, range;
        public InnerGlow() { super("innerGlow"); } String idOf() { return "innerGlow"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "opacity": opacity = num(v, opacity); break;
            case "color": color = str(v, color); break; case "source": source = str(v, source); break;
            case "choke": choke = num(v, choke); break; case "size": size = num(v, size); break;
            case "range": range = num(v, range); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "opacity": return opacity; case "color": return color;
            case "source": return source; case "choke": return choke; case "size": return size;
            case "range": return range; default: return null; } }
        public InnerGlow copyFx() { InnerGlow e = new InnerGlow(); copyBaseTo(e);
            e.blend = blend; e.opacity = opacity; e.color = color; e.source = source;
            e.choke = choke; e.size = size; e.range = range; return e; }
    }
    public static final class Satin extends Effect {
        public String blend, color; public double opacity, angle, distance, size; public boolean invert;
        public Satin() { super("satin"); } String idOf() { return "satin"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "color": color = str(v, color); break;
            case "opacity": opacity = num(v, opacity); break; case "angle": angle = num(v, angle); break;
            case "distance": distance = num(v, distance); break; case "size": size = num(v, size); break;
            case "invert": invert = truthy(v); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "color": return color; case "opacity": return opacity;
            case "angle": return angle; case "distance": return distance; case "size": return size;
            case "invert": return invert; default: return null; } }
        public Satin copyFx() { Satin e = new Satin(); copyBaseTo(e);
            e.blend = blend; e.color = color; e.opacity = opacity; e.angle = angle; e.distance = distance;
            e.size = size; e.invert = invert; return e; }
    }
    public static final class ColorOverlay extends Effect {
        public String blend, color; public double opacity;
        public ColorOverlay() { super("colorOverlay"); } String idOf() { return "colorOverlay"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "color": color = str(v, color); break;
            case "opacity": opacity = num(v, opacity); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "color": return color; case "opacity": return opacity; default: return null; } }
        public ColorOverlay copyFx() { ColorOverlay e = new ColorOverlay(); copyBaseTo(e);
            e.blend = blend; e.color = color; e.opacity = opacity; return e; }
    }
    public static final class GradientOverlay extends Effect {
        public String blend, from, to, style; public double opacity, angle, scale; public boolean reverse;
        public GradientOverlay() { super("gradientOverlay"); } String idOf() { return "gradientOverlay"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "opacity": opacity = num(v, opacity); break;
            case "from": from = str(v, from); break; case "to": to = str(v, to); break;
            case "style": style = str(v, style); break; case "angle": angle = num(v, angle); break;
            case "scale": scale = num(v, scale); break; case "reverse": reverse = truthy(v); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "opacity": return opacity; case "from": return from;
            case "to": return to; case "style": return style; case "angle": return angle;
            case "scale": return scale; case "reverse": return reverse; default: return null; } }
        public GradientOverlay copyFx() { GradientOverlay e = new GradientOverlay(); copyBaseTo(e);
            e.blend = blend; e.opacity = opacity; e.from = from; e.to = to; e.style = style;
            e.angle = angle; e.scale = scale; e.reverse = reverse; return e; }
    }
    public static final class OuterGlow extends Effect {
        public String blend, color; public double opacity, spread, size, range;
        public OuterGlow() { super("outerGlow"); } String idOf() { return "outerGlow"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "opacity": opacity = num(v, opacity); break;
            case "color": color = str(v, color); break; case "spread": spread = num(v, spread); break;
            case "size": size = num(v, size); break; case "range": range = num(v, range); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "opacity": return opacity; case "color": return color;
            case "spread": return spread; case "size": return size; case "range": return range; default: return null; } }
        public OuterGlow copyFx() { OuterGlow e = new OuterGlow(); copyBaseTo(e);
            e.blend = blend; e.opacity = opacity; e.color = color; e.spread = spread; e.size = size; e.range = range; return e; }
    }
    public static final class DropShadow extends Effect {
        public String blend, color; public double opacity, angle, distance, spread, size;
        public DropShadow() { super("dropShadow"); } String idOf() { return "dropShadow"; }
        public void set(String k, Object v) { switch (k) {
            case "blend": blend = str(v, blend); break; case "color": color = str(v, color); break;
            case "opacity": opacity = num(v, opacity); break; case "angle": angle = num(v, angle); break;
            case "distance": distance = num(v, distance); break; case "spread": spread = num(v, spread); break;
            case "size": size = num(v, size); break; default: break; } }
        public Object get(String k) { switch (k) {
            case "blend": return blend; case "color": return color; case "opacity": return opacity;
            case "angle": return angle; case "distance": return distance; case "spread": return spread;
            case "size": return size; default: return null; } }
        public DropShadow copyFx() { DropShadow e = new DropShadow(); copyBaseTo(e);
            e.blend = blend; e.color = color; e.opacity = opacity; e.angle = angle; e.distance = distance;
            e.spread = spread; e.size = size; return e; }
    }

    /** 整层样式状态：9 个效果对象，字段名与 JS style 对象的键同名。
     *  新建 = 各效果出厂参数但全部关闭（等价 JS 的 style=null 语义）；启用某项把其 on 置 true 即可。 */
    public static final class StyleState {
        public Bevel bevel = new Bevel();
        public Stroke stroke = new Stroke();
        public InnerShadow innerShadow = new InnerShadow();
        public InnerGlow innerGlow = new InnerGlow();
        public Satin satin = new Satin();
        public ColorOverlay colorOverlay = new ColorOverlay();
        public GradientOverlay gradientOverlay = new GradientOverlay();
        public OuterGlow outerGlow = new OuterGlow();
        public DropShadow dropShadow = new DropShadow();
        public StyleState() { reset(); }
        public Effect byId(String id) { switch (id) {
            case "bevel": return bevel; case "stroke": return stroke; case "innerShadow": return innerShadow;
            case "innerGlow": return innerGlow; case "satin": return satin; case "colorOverlay": return colorOverlay;
            case "gradientOverlay": return gradientOverlay; case "outerGlow": return outerGlow;
            case "dropShadow": return dropShadow; default: return null; } }
        public StyleState copy() { StyleState s = new StyleState();
            s.bevel = bevel.copyFx(); s.stroke = stroke.copyFx(); s.innerShadow = innerShadow.copyFx();
            s.innerGlow = innerGlow.copyFx(); s.satin = satin.copyFx(); s.colorOverlay = colorOverlay.copyFx();
            s.gradientOverlay = gradientOverlay.copyFx(); s.outerGlow = outerGlow.copyFx(); s.dropShadow = dropShadow.copyFx();
            return s; }
        /** 恢复出厂参数并全部关闭。 */
        public void reset() {
            bevel = new Bevel(); stroke = new Stroke(); innerShadow = new InnerShadow();
            innerGlow = new InnerGlow(); satin = new Satin(); colorOverlay = new ColorOverlay();
            gradientOverlay = new GradientOverlay(); outerGlow = new OuterGlow(); dropShadow = new DropShadow();
            for (EffectDef d : DEFS) byId(d.id).on = false;
        }
        public boolean isActive() { for (EffectDef d : DEFS) { Effect e = byId(d.id); if (e != null && e.on) return true; } return false; }
        public boolean isIdentity() { return !isActive(); }
        public Map<String, Object> toMap() { Map<String, Object> m = new LinkedHashMap<>();
            for (EffectDef d : DEFS) m.put(d.id, byId(d.id).toMap()); return m; }
        @SuppressWarnings("unchecked")
        public static StyleState fromMap(Map<String, Object> m) { StyleState s = new StyleState();
            if (m != null) for (EffectDef d : DEFS) {
                Object v = m.get(d.id);
                if (v instanceof Map) s.byId(d.id).loadMap((Map<String, Object>) v);
            } return s; }
    }
    public static boolean isActive(StyleState s) { return s != null && s.isActive(); }

    /* ================= 掩膜工具（译自 paint.rs / blur.rs / distance.rs） ================= */
    static float[] shifted(float[] m, int w, int h, int dx, int dy, float outside) {
        float[] out = new float[w * h];
        for (int y = 0; y < h; y++) { int sy = y - dy;
            for (int x = 0; x < w; x++) { int sx = x - dx;
                out[y * w + x] = (sx < 0 || sy < 0 || sx >= w || sy >= h) ? outside : m[sy * w + sx]; } }
        return out;
    }
    /** 阴影偏移：背向光源，取整到像素。返回 {dx, dy}。 */
    public static int[] offset(double angle, double distance) {
        double a = angle * Math.PI / 180;
        return new int[]{(int) Math.round(-Math.cos(a) * distance), (int) Math.round(Math.sin(a) * distance)};
    }
    /** 返回 {dilateRadius, tentWidth}。 */
    static double[] spreadSplit(double size, double spread) {
        return new double[]{Math.round(size * spread / 100), size * (1 - spread / 100)};
    }
    static final double CH_INF = 1e20;
    static final double[][] CH_FWD = {{-1, 0, 1}, {-1, -1, Math.sqrt(2)}, {0, -1, 1}, {1, -1, Math.sqrt(2)},
        {-1, -2, Math.sqrt(5)}, {1, -2, Math.sqrt(5)}, {-2, -1, Math.sqrt(5)}, {2, -1, Math.sqrt(5)}};
    static float[] chamferFrom(float[] seeds, int w, int h) {
        float[] d = seeds.clone();
        for (int pass = 0; pass < 2; pass++) {
            int sign = pass == 0 ? 1 : -1;
            for (int yy = 0; yy < h; yy++) for (int xx = 0; xx < w; xx++) {
                int x = sign > 0 ? xx : w - 1 - xx, y = sign > 0 ? yy : h - 1 - yy;
                int i = y * w + x; double best = d[i];
                for (int k = 0; k < 8; k++) {
                    int nx = x + (int) CH_FWD[k][0] * sign, ny = y + (int) CH_FWD[k][1] * sign;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    double c = d[ny * w + nx] + CH_FWD[k][2];
                    if (c < best) best = c;
                }
                d[i] = (float) best;
            }
        }
        return d;
    }
    public static float[] distOutside(float[] shape, int w, int h) {
        float[] seeds = new float[w * h];
        for (int i = 0; i < seeds.length; i++) seeds[i] = shape[i] > EPS ? (float) (1 - Math.min(shape[i], 1)) : (float) CH_INF;
        float[] d = chamferFrom(seeds, w, h);
        for (int i = 0; i < d.length; i++) d[i] = (float) (shape[i] > EPS ? -0.5 : d[i] - 0.5);
        return d;
    }
    public static float[] distInside(float[] shape, int w, int h) {
        float[] seeds = new float[w * h];
        for (int i = 0; i < seeds.length; i++) seeds[i] = shape[i] <= EPS ? 0 : (float) CH_INF;
        float[] d = chamferFrom(seeds, w, h);
        for (int i = 0; i < d.length; i++) d[i] = (float) (shape[i] <= EPS ? -0.5 : d[i] - 0.5);
        return d;
    }
    static float[] dilate(float[] m, int w, int h, double r) {
        if (!(r > 0)) return m.clone();
        float[] d = distOutside(m, w, h); float[] out = m.clone();
        for (int i = 0; i < out.length; i++)
            out[i] = (float) (d[i] < 0 ? Math.min(out[i] + r, 1) : Math.max(out[i], clamp01(r + 0.5 - d[i])));
        return out;
    }
    static double[] boxGeom(double bw) {
        if (Double.isNaN(bw)) bw = 1; bw = Math.min(Math.max(bw, 1), 512);
        double half = bw / 2; int r = Math.max(0, (int) Math.ceil(half - 0.5));
        double f = Math.min(Math.max(half - (r - 0.5), 0), 1);
        return new double[]{r, f, 1 / bw};
    }
    static void boxLine(double[] src, int x0, double[] dst, double bw) {
        double[] g = boxGeom(bw); int r = (int) g[0]; double f = g[1], norm = g[2]; int n = src.length;
        if (r == 0) { for (int k = 0; k < dst.length; k++) dst[k] = at(src, n, x0 + k); return; }
        double inner = 0;
        for (int i = x0 - (r - 1); i <= x0 + (r - 1); i++) inner += at(src, n, i);
        for (int k = 0; k < dst.length; k++) { int x = x0 + k;
            dst[k] = (inner + f * (at(src, n, x - r) + at(src, n, x + r))) * norm;
            inner += at(src, n, x + r) - at(src, n, x - r + 1); }
    }
    private static double at(double[] s, int n, int i) { return (i >= 0 && i < n) ? s[i] : 0; }
    static double[] tentLine(double[] src, double bw) {
        int r = (int) boxGeom(bw)[0];
        double[] mid = new double[src.length + 2 * r]; boxLine(src, -r, mid, bw);
        double[] out = new double[src.length]; boxLine(mid, r, out, bw);
        return out;
    }
    /** tent 模糊（两遍 box），原地修改并返回 m；size<=1 恒等。 */
    public static float[] tent(float[] m, int w, int h, double size) {
        if (!(size > 1) || m.length == 0) return m;
        double[] line = new double[Math.max(w, h)];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) line[x] = m[y * w + x];
            double[] o = tentLine(Arrays.copyOf(line, w), size);
            for (int x = 0; x < w; x++) m[y * w + x] = (float) o[x];
        }
        for (int x = 0; x < w; x++) {
            for (int y = 0; y < h; y++) line[y] = m[y * w + x];
            double[] o = tentLine(Arrays.copyOf(line, h), size);
            for (int y = 0; y < h; y++) m[y * w + x] = (float) o[y];
        }
        return m;
    }
    public static float[] sizeOneBlur(float[] m, int w, int h) {
        double[] t = {0.25, 0.5, 0.25}; float[] a = new float[m.length];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            a[y * w + x] = (float) (t[0] * gat(m, w, h, x - 1, y) + t[1] * gat(m, w, h, x, y) + t[2] * gat(m, w, h, x + 1, y));
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            m[y * w + x] = (float) (t[0] * gat(a, w, h, x, y - 1) + t[1] * gat(a, w, h, x, y) + t[2] * gat(a, w, h, x, y + 1));
        return m;
    }
    private static float gat(float[] m, int w, int h, int x, int y) {
        return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : m[y * w + x];
    }

    /* ================= 各效果覆盖图（译自 paint.rs / bevel.rs） ================= */
    static float[] shadowMap(float[] shape, int w, int h, double angle, double distance,
                             double chokeOrSpread, double size, boolean inner) {
        int[] o = offset(angle, distance); float[] src = shape.clone();
        if (inner) for (int i = 0; i < src.length; i++) src[i] = 1 - src[i];
        float[] m = shifted(src, w, h, o[0], o[1], inner ? 1 : 0);
        double[] ss = spreadSplit(size, chokeOrSpread);
        m = dilate(m, w, h, ss[0]);
        if (inner && size == 1 && chokeOrSpread == 0) sizeOneBlur(m, w, h); else tent(m, w, h, ss[1]);
        if (inner) for (int i = 0; i < m.length; i++) m[i] *= shape[i];
        return m;
    }
    static float[] glowMap(float[] shape, int w, int h, double chokeOrSpread, double size,
                           double rangePct, String source, boolean inner) {
        float[] src = shape.clone();
        if (inner) for (int i = 0; i < src.length; i++) src[i] = 1 - src[i];
        double[] ss = spreadSplit(size, chokeOrSpread); float[] m;
        if (inner && !"center".equals(source) && size == 1 && chokeOrSpread == 0) { m = src; sizeOneBlur(m, w, h); }
        else { m = dilate(src, w, h, ss[0]); tent(m, w, h, ss[1]); }
        double range = Math.min(Math.max(rangePct / 100, 0.01), 1);
        for (int i = 0; i < m.length; i++) m[i] = (float) Math.min(m[i] / range, 1);
        if (inner && "center".equals(source)) for (int i = 0; i < m.length; i++) m[i] = 1 - m[i];
        if (inner) for (int i = 0; i < m.length; i++) m[i] *= shape[i];
        return m;
    }
    static float[] satinMap(float[] shape, int w, int h, Satin s) {
        int[] o = offset(s.angle, Math.max(s.distance, 1));
        float[] a = shifted(shape, w, h, o[0], o[1], 0), b = shifted(shape, w, h, -o[0], -o[1], 0);
        if (s.size == 1) { sizeOneBlur(a, w, h); sizeOneBlur(b, w, h); }
        else { tent(a, w, h, s.size); tent(b, w, h, s.size); }
        float[] m = new float[w * h];
        for (int i = 0; i < m.length; i++) { double v = Math.abs(a[i] - b[i]); if (s.invert) v = 1 - v; m[i] = (float) (v * shape[i]); }
        return m;
    }
    /** 返回 {高光图, 阴影图}（Smooth 内斜面）。 */
    static float[][] bevelMaps(float[] shape, int w, int h, Bevel s) {
        double size = Math.max(s.size, 1); float[] hmap = shape.clone();
        tent(hmap, w, h, size); if (s.soften >= 1) tent(hmap, w, h, s.soften);
        double depth = (s.depth / 100) * size * (s.up ? 1 : -1);
        double a = s.angle * Math.PI / 180, e = s.altitude * Math.PI / 180;
        double[] lv = {Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e)};
        double se = Math.sin(e);
        float[] hi = new float[w * h], sh = new float[w * h];
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int i = y * w + x;
            double gx = (gat(hmap, w, h, x + 1, y) - gat(hmap, w, h, x - 1, y)) * 0.5 * depth;
            double gy = (gat(hmap, w, h, x, y + 1) - gat(hmap, w, h, x, y - 1)) * 0.5 * depth;
            double len = Math.sqrt(gx * gx + gy * gy + 1);
            double shade = (-gx * lv[0] - gy * lv[1] + lv[2]) / len;
            double k = shade - se;
            if (k > 0) hi[i] = (float) (clamp01(k / Math.max(1 - se, 1e-3)) * shape[i]);
            else sh[i] = (float) (clamp01(-k / Math.max(se, 1e-3)) * shape[i]);
        }
        return new float[][]{hi, sh};
    }
    static double[] strokeWidths(Stroke s) {
        return "outside".equals(s.position) ? new double[]{0, s.size}
             : "center".equals(s.position) ? new double[]{s.size / 2, s.size / 2} : new double[]{s.size, 0};
    }
    /** 返回 {inMap 或 null, outMap 或 null}。 */
    static float[][] strokeMaps(float[] shape, int w, int h, Stroke s) {
        double[] sw = strokeWidths(s); float[] inMap = null, outMap = null;
        if (sw[0] > 0) { float[] din = distInside(shape, w, h); inMap = new float[w * h];
            for (int i = 0; i < inMap.length; i++) inMap[i] = shape[i] > EPS ? (float) clamp01(sw[0] + 0.5 - din[i]) : 0; }
        if (sw[1] > 0) { float[] dout = distOutside(shape, w, h); outMap = new float[w * h];
            for (int i = 0; i < outMap.length; i++) outMap[i] = (float) clamp01(sw[1] + 0.5 - dout[i]); }
        return new float[][]{inMap, outMap};
    }

    /* ================= 渐变（paint.rs gradient_t / sample_gradient） ================= */
    public static double gradientT(String style, double angle, double scale, boolean reverse,
                                   int w, int h, double x, double y) {
        double cx = w / 2.0, cy = h / 2.0;
        double rad = angle * Math.PI / 180, sn = Math.sin(rad), cs = Math.cos(rad);
        double dx = x - cx, dy = y - cy;
        double along = dx * cs - dy * sn, across = dx * sn + dy * cs;
        double len = Math.max(1, Math.sqrt((cs * w) * (cs * w) + (sn * h) * (sn * h)));
        double chord = Math.max(1, Math.min(w / Math.max(Math.abs(cs), 1e-6), h / Math.max(Math.abs(sn), 1e-6)));
        double ch = chord * Math.max(scale, 1e-3), ln = len * Math.max(scale, 1e-3);
        double corner = 0.5 * (cs - sn); double t;
        if ("reflected".equals(style)) t = Math.abs((along - corner) / (ch / 2));
        else if ("radial".equals(style)) t = Math.sqrt(dx * dx + dy * dy) / (ln / 2);
        else if ("diamond".equals(style)) t = (Math.abs(along) + Math.abs(across)) / (ln / 2);
        else if ("angle".equals(style)) t = (((rad - Math.atan2(-dy, dx)) / (2 * Math.PI)) % 1 + 1) % 1;
        else t = (along - corner) / ch + 0.5;
        t = clamp01(t); return reverse ? 1 - t : t;
    }
    static double[] sampleStops(double[][] stopsPos, int[][] stopsRgb, double t) {
        int n = stopsPos.length;
        if (t <= stopsPos[0][0]) return toD(stopsRgb[0]);
        if (t >= stopsPos[n - 1][0]) return toD(stopsRgb[n - 1]);
        for (int j = 1; j < n; j++) if (t <= stopsPos[j][0]) {
            double p0 = stopsPos[j - 1][0], p1 = stopsPos[j][0];
            double k = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
            return new double[]{stopsRgb[j - 1][0] + (stopsRgb[j][0] - stopsRgb[j - 1][0]) * k,
                                stopsRgb[j - 1][1] + (stopsRgb[j][1] - stopsRgb[j - 1][1]) * k,
                                stopsRgb[j - 1][2] + (stopsRgb[j][2] - stopsRgb[j - 1][2]) * k};
        }
        return toD(stopsRgb[n - 1]);
    }
    private static double[] toD(int[] c) { return new double[]{c[0], c[1], c[2]}; }
    public static int[] hexRGB(String hex) {
        return new int[]{Integer.parseInt(hex.substring(1, 3), 16),
                         Integer.parseInt(hex.substring(3, 5), 16),
                         Integer.parseInt(hex.substring(5, 7), 16)};
    }

    /* ================= 油漆构建 ================= */
    public static final class Paint {
        public final int[] pixels; public final String mode; // ARGB，非预乘
        Paint(int[] pixels, String mode) { this.pixels = pixels; this.mode = mode; }
    }
    public static final class Paints {
        public final List<Paint> ext = new ArrayList<>();   // 层之下，数组序合成
        public final List<Paint> inner = new ArrayList<>(); // 层之上（JS 名 int，Java 关键字故改名）
    }
    static int[] solidPaint(int[] rgb, float[] map, double opacityPct) {
        int[] data = new int[map.length]; double k = opacityPct / 100;
        for (int i = 0; i < map.length; i++)
            data[i] = Img.argb((int) Math.round(clamp01(map[i]) * k * 255), rgb[0], rgb[1], rgb[2]);
        return data;
    }
    static float[] relative(float[] m, float[] shape) {
        float[] out = new float[m.length];
        for (int i = 0; i < m.length; i++) out[i] = shape[i] > EPS ? (float) Math.min(m[i] / shape[i], 1) : 0;
        return out;
    }
    /** 由形状构建两组油漆。knockOut 0..1：投影被形状挖去的比例（层混合非普通时传 1，普通传 0）。 */
    public static Paints buildPaints(float[] shape, int w, int h, StyleState style, double knockOut) {
        Paints paints = new Paints();
        if (style == null) return paints;
        DropShadow ds = style.dropShadow;
        if (ds.on) {
            float[] m = shadowMap(shape, w, h, ds.angle, ds.distance, ds.spread, ds.size, false);
            if (knockOut > 0) for (int i = 0; i < m.length; i++) m[i] *= 1 - shape[i] * knockOut;
            paints.ext.add(new Paint(solidPaint(hexRGB(ds.color), m, ds.opacity), ds.blend));
        }
        OuterGlow og = style.outerGlow;
        if (og.on) paints.ext.add(new Paint(solidPaint(hexRGB(og.color),
            glowMap(shape, w, h, og.spread, og.size, og.range, "edge", false), og.opacity), og.blend));
        Stroke stroke = style.stroke.on ? style.stroke : null;
        float[][] sm = stroke != null ? strokeMaps(shape, w, h, stroke) : null;
        if (sm != null && sm[1] != null)
            paints.ext.add(new Paint(solidPaint(hexRGB(stroke.color), sm[1], stroke.opacity), stroke.blend));
        GradientOverlay go = style.gradientOverlay;
        if (go.on) {
            double[][] pos = {{0}, {1}}; int[][] cols = {hexRGB(go.from), hexRGB(go.to)};
            int[] data = new int[w * h]; int op = (int) Math.round(255 * go.opacity / 100);
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int i = y * w + x;
                if (shape[i] <= EPS) continue;
                double[] c = sampleStops(pos, cols, gradientT(go.style, go.angle, go.scale / 100, go.reverse, w, h, x + 0.5, y + 0.5));
                data[i] = Img.argb(op, (int) Math.round(c[0]), (int) Math.round(c[1]), (int) Math.round(c[2]));
            }
            paints.inner.add(new Paint(data, go.blend));
        }
        ColorOverlay co = style.colorOverlay;
        if (co.on) {
            float[] full = new float[w * h];
            for (int i = 0; i < full.length; i++) full[i] = shape[i] > EPS ? 1 : 0;
            paints.inner.add(new Paint(solidPaint(hexRGB(co.color), relative(full, shape), co.opacity), co.blend));
        }
        Satin sa = style.satin;
        if (sa.on) paints.inner.add(new Paint(solidPaint(hexRGB(sa.color),
            relative(satinMap(shape, w, h, sa), shape), sa.opacity), sa.blend));
        InnerGlow ig = style.innerGlow;
        if (ig.on) paints.inner.add(new Paint(solidPaint(hexRGB(ig.color),
            relative(glowMap(shape, w, h, ig.choke, ig.size, ig.range, ig.source, true), shape), ig.opacity), ig.blend));
        InnerShadow ish = style.innerShadow;
        if (ish.on) paints.inner.add(new Paint(solidPaint(hexRGB(ish.color),
            relative(shadowMap(shape, w, h, ish.angle, ish.distance, ish.choke, ish.size, true), shape), ish.opacity), ish.blend));
        if (sm != null && sm[0] != null)
            paints.inner.add(new Paint(solidPaint(hexRGB(stroke.color), relative(sm[0], shape), stroke.opacity), stroke.blend));
        Bevel bv = style.bevel;
        if (bv.on) {
            float[][] bm = bevelMaps(shape, w, h, bv);
            paints.inner.add(new Paint(solidPaint(hexRGB(bv.highlightColor), relative(bm[0], shape), bv.highlightOpacity), "screen"));
            paints.inner.add(new Paint(solidPaint(hexRGB(bv.shadowColor), relative(bm[1], shape), bv.shadowOpacity), "multiply"));
        }
        return paints;
    }
    public static Paints buildPaints(float[] shape, int w, int h, StyleState style) {
        return buildPaints(shape, w, h, style, 0);
    }

    /* ================= 混合与合成（译自 engine.js blendCompositeInto / blendTriple） ================= */
    static double bBurn(double cb, double cs) { return cs <= 0 ? 0 : Math.max(0, 1 - (1 - cb) / cs); }
    static double bDodge(double cb, double cs) { return cs >= 1 ? 1 : Math.min(1, cb / (1 - cs)); }
    static double bSoftD(double cb) { return cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb); }
    public static double blendChannel(String mode, double cb, double cs) {
        switch (mode == null ? "normal" : mode) {
            case "darken": return Math.min(cb, cs);
            case "multiply": return cb * cs;
            case "colorBurn": return bBurn(cb, cs);
            case "linearBurn": return Math.max(0, cb + cs - 1);
            case "lighten": return Math.max(cb, cs);
            case "screen": return 1 - (1 - cb) * (1 - cs);
            case "colorDodge": return bDodge(cb, cs);
            case "linearDodge": return Math.min(1, cb + cs);
            case "overlay": return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
            case "softLight": return cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * (bSoftD(cb) - cb);
            case "hardLight": return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
            case "vividLight": return cs <= 0.5 ? bBurn(cb, 2 * cs) : bDodge(cb, 2 * (cs - 0.5));
            case "linearLight": return cs <= 0.5 ? Math.max(0, cb + 2 * cs - 1) : Math.min(1, cb + 2 * (cs - 0.5));
            case "pinLight": return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * (cs - 0.5));
            case "hardMix": { double v = cs <= 0.5 ? bBurn(cb, 2 * cs) : bDodge(cb, 2 * (cs - 0.5)); return v < 0.5 ? 0 : 1; }
            case "difference": return Math.abs(cb - cs);
            case "exclusion": return cb + cs - 2 * cb * cs;
            case "subtract": return Math.max(0, cb - cs);
            case "divide": return cs <= 0 ? 1 : Math.min(1, cb / cs);
            default: return cs; // normal / dissolve（溶解以 normal 近似，同 JS）
        }
    }
    static double lum3(double[] c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
    static double sat3(double[] c) { return Math.max(c[0], Math.max(c[1], c[2])) - Math.min(c[0], Math.min(c[1], c[2])); }
    static double[] clipColor(double[] c) {
        double l = lum3(c), mn = Math.min(c[0], Math.min(c[1], c[2])), mx = Math.max(c[0], Math.max(c[1], c[2]));
        double[] out = c.clone();
        if (mn < 0) for (int i = 0; i < 3; i++) out[i] = l + (out[i] - l) * l / (l - mn);
        if (mx > 1) for (int i = 0; i < 3; i++) out[i] = l + (out[i] - l) * (1 - l) / (mx - l);
        return out;
    }
    static double[] setLum(double[] c, double l) { double d = l - lum3(c); return clipColor(new double[]{c[0] + d, c[1] + d, c[2] + d}); }
    static double[] setSat(double[] c, double s) {
        Integer[] idx = {0, 1, 2}; Arrays.sort(idx, Comparator.comparingDouble(i -> c[i]));
        double[] out = {0, 0, 0}; double mn = c[idx[0]], md = c[idx[1]], mx = c[idx[2]];
        if (mx > mn) { out[idx[1]] = (md - mn) * s / (mx - mn); out[idx[2]] = s; }
        return out;
    }
    public static double[] blendTriple(String mode, double[] cb, double[] cs) {
        switch (mode == null ? "normal" : mode) {
            case "darkerColor": return (cs[0] + cs[1] + cs[2] < cb[0] + cb[1] + cb[2] ? cs : cb).clone();
            case "lighterColor": return (cs[0] + cs[1] + cs[2] > cb[0] + cb[1] + cb[2] ? cs : cb).clone();
            case "hue": return setLum(setSat(cs, sat3(cb)), lum3(cb));
            case "saturation": return setLum(setSat(cb, sat3(cs)), lum3(cb));
            case "color": return setLum(cs, lum3(cb));
            case "luminosity": return setLum(cb, lum3(cs));
            default: return new double[]{blendChannel(mode, cb[0], cs[0]), blendChannel(mode, cb[1], cs[1]), blendChannel(mode, cb[2], cs[2])};
        }
    }
    /** 非预乘 alpha 合成（W3C 口径，同 engine.js）：src 按 mode+opacity 叠到 acc，原地改 acc。
     *  mask 可为 null；非 null 时源有效 alpha 再乘 mask[i]（0..1）。 */
    public static void blendCompositeInto(int[] acc, int[] src, String mode, double opacity, float[] mask) {
        for (int i = 0; i < acc.length; i++) {
            double as = (src[i] >>> 24) / 255.0 * opacity * (mask != null ? mask[i] : 1);
            if (as <= 0) continue;
            double ab = (acc[i] >>> 24) / 255.0;
            double[] cb = {((acc[i] >> 16) & 0xFF) / 255.0, ((acc[i] >> 8) & 0xFF) / 255.0, (acc[i] & 0xFF) / 255.0};
            double[] cs = {((src[i] >> 16) & 0xFF) / 255.0, ((src[i] >> 8) & 0xFF) / 255.0, (src[i] & 0xFF) / 255.0};
            double[] B = blendTriple(mode, cb, cs);
            double ao = as + ab * (1 - as);
            int r = 0, g = 0, b = 0;
            int[] chv = new int[3];
            for (int ch = 0; ch < 3; ch++) {
                double co = as * (1 - ab) * cs[ch] + as * ab * B[ch] + (1 - as) * ab * cb[ch];
                chv[ch] = Img.clamp((int) Math.round((ao > 0 ? co / ao : 0) * 255), 0, 255);
            }
            r = chv[0]; g = chv[1]; b = chv[2];
            acc[i] = Img.argb(Img.clamp((int) Math.round(ao * 255), 0, 255), r, g, b);
        }
    }

    /* ================= 上层入口 ================= */
    /** 形状 = 层已生效像素 alpha × 蒙版灰度（mask 为 0..1 或 0..255 均按 >1 时除 255 归一；null=无蒙版）。 */
    public static float[] shapeOf(BufferedImage layerEffective, float[] mask) {
        int w = layerEffective.getWidth(), h = layerEffective.getHeight();
        int[] px = Img.pixels(layerEffective); float[] shape = new float[w * h];
        for (int i = 0; i < shape.length; i++) {
            double m = 1;
            if (mask != null) { m = mask[i]; if (m > 1) m /= 255.0; }
            shape[i] = (float) ((px[i] >>> 24) / 255.0 * m);
        }
        return shape;
    }
    /** 只做层内容之上的内部效果：返回新图，RGB 被 int 油漆改写，alpha 恢复为层自身 alpha。 */
    public static BufferedImage applyInternal(BufferedImage layerEffective, Paints paints) {
        int w = layerEffective.getWidth(), h = layerEffective.getHeight();
        int[] sd = Img.pixels(layerEffective);
        if (paints != null && !paints.inner.isEmpty()) {
            int[] keepA = new int[sd.length];
            for (int i = 0; i < sd.length; i++) keepA[i] = sd[i] >>> 24;
            for (Paint p : paints.inner) blendCompositeInto(sd, p.pixels, p.mode, 1, null);
            for (int i = 0; i < sd.length; i++) sd[i] = (keepA[i] << 24) | (sd[i] & 0xFFFFFF);
        }
        return Img.fromPixels(w, h, sd);
    }
    /**
     * 完整一层合成（engine.js compositeStack 的单层段）：ext 油漆以层不透明度合成到 backdrop 之下，
     * int 油漆改写层内容（恢复 alpha），最后层按自身 blend+opacity+mask 合成。原地改 backdropPx 并返回它。
     * knockOut 口径同 engine：层 blend 为 normal/dissolve 时 0，否则 1。
     */
    public static int[] compositeLayer(int[] backdropPx, BufferedImage layerEffective, float[] mask,
                                       StyleState style, String layerBlend, double layerOpacity) {
        int w = layerEffective.getWidth(), h = layerEffective.getHeight();
        int[] sd = Img.pixels(layerEffective);
        float[] maskF = null;
        if (mask != null) { maskF = new float[mask.length];
            for (int i = 0; i < mask.length; i++) { double m = mask[i]; maskF[i] = (float) (m > 1 ? m / 255.0 : m); } }
        if (isActive(style)) {
            float[] shape = shapeOf(layerEffective, maskF);
            double ko = ("normal".equals(layerBlend) || "dissolve".equals(layerBlend)) ? 0 : 1;
            Paints paints = buildPaints(shape, w, h, style, ko);
            for (Paint p : paints.ext) blendCompositeInto(backdropPx, p.pixels, p.mode, layerOpacity, null);
            if (!paints.inner.isEmpty()) {
                BufferedImage styled = applyInternal(layerEffective, paints);
                sd = Img.pixels(styled);
            }
        }
        blendCompositeInto(backdropPx, sd, layerBlend, layerOpacity, maskF);
        return backdropPx;
    }
    /* ---- JSON 模型（Map）入参的便捷重载，供工程文件/接入层直接用 ---- */
    private static float[] maskFloat(byte[] mask) {
        if (mask == null) return null;
        float[] f = new float[mask.length];
        for (int i = 0; i < mask.length; i++) f[i] = (mask[i] & 0xFF) / 255f;
        return f;
    }
    /** 内部样式（JSON 模型入参）：无生效样式时原样返回 rendered。mask 为灰度字节（null=无蒙版）。 */
    public static BufferedImage applyInternal(BufferedImage rendered, Map<String, Object> styleMap, byte[] mask) {
        StyleState s = StyleState.fromMap(styleMap);
        if (!isActive(s) || rendered == null) return rendered;
        int w = rendered.getWidth(), h = rendered.getHeight();
        Paints paints = buildPaints(shapeOf(rendered, maskFloat(mask)), w, h, s, 0);
        return applyInternal(rendered, paints);
    }
    /** 外部油漆合成图（JSON 模型入参）：ext 油漆依次合成到透明底的 ARGB 像素（w×h）；
     *  无外部油漆时返回 null。逐项 blend 对透明底的口径与 renderContribution 的 ext 段一致。 */
    public static int[] externalPaint(BufferedImage rendered, Map<String, Object> styleMap, byte[] mask, int w, int h) {
        StyleState s = StyleState.fromMap(styleMap);
        if (!isActive(s) || rendered == null) return null;
        Paints paints = buildPaints(shapeOf(rendered, maskFloat(mask)),
            rendered.getWidth(), rendered.getHeight(), s, 0);
        if (paints.ext.isEmpty()) return null;
        int[] acc = new int[w * h];
        for (Paint p : paints.ext) blendCompositeInto(acc, p.pixels, p.mode, 1, null);
        return acc;
    }
    /** 把一层（带样式）合成到透明底上，产出该层的合成贡献图（文档尺寸，超出文档的投影/发光被钳制——
     *  与 JS 一致：油漆与文档同尺寸，不外扩）。style 为 null/全关时逐像素等于原层。 */
    public static BufferedImage renderContribution(BufferedImage layerEffective, float[] mask, StyleState style) {
        int w = layerEffective.getWidth(), h = layerEffective.getHeight();
        int[] acc = new int[w * h];
        compositeLayer(acc, layerEffective, mask, style, "normal", 1);
        return Img.fromPixels(w, h, acc);
    }
}
