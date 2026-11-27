package meowtu;

import meowtu.core.AdjustParams;
import meowtu.core.AdvAdjust;
import meowtu.core.Curves;
import meowtu.core.Img;
import meowtu.core.Json;
import meowtu.core.Lut;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Point;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 工程文件（.meowtu）与修图配方（.meowtu-recipe）：与网页版 engine.js 的
 * exportProject/importProject/exportRecipe/applyRecipe 同一 JSON 格式、同一字段构成——
 * 网页版存的工程 Java 能开、反之亦然。图层像素/蒙版以 PNG dataURL 内嵌（无损）。
 * 格式本体自研（与网页版一致）：{format:"meowtu-project", version:1, docW, docH, activeIdx, texts, layers[], preview}。
 */
public final class ProjectIO {
    private ProjectIO() {}

    public static final String PROJECT_FORMAT = "meowtu-project";
    public static final String RECIPE_FORMAT = "meowtu-recipe";
    public static final int VERSION = 1;

    private static final String[] PARAM_KEYS = {"exposure", "brightness", "contrast", "temperature", "tint",
            "saturation", "vibrance", "highlights", "shadows", "whites", "blacks", "clarity", "sharpen"};
    private static final String[] CURVE_KEYS = {"rgb", "r", "g", "b"};

    // ---------- 导出 ----------
    public static String exportProject(Editor ed) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("format", PROJECT_FORMAT);
        root.put("version", (double) VERSION);
        java.awt.Dimension d = ed.getSize();
        root.put("docW", (double) d.width);
        root.put("docH", (double) d.height);
        root.put("activeIdx", (double) ed.activeIndex());
        root.put("texts", textsToJson(ed.texts()));
        List<Object> ls = new ArrayList<>();
        for (Editor.Layer l : ed.layers()) ls.add(layerToJson(l, true));
        root.put("layers", ls);
        BufferedImage flat = ed.bakeCurrent();
        if (flat != null) root.put("preview", pngDataUrl(Img.downscale(flat, 320)));
        return Json.write(root);
    }

    public static String exportRecipe(Editor ed) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("format", RECIPE_FORMAT);
        root.put("version", (double) VERSION);
        List<Object> ls = new ArrayList<>();
        for (Editor.Layer l : ed.layers()) ls.add(layerToJson(l, false));
        root.put("layers", ls);
        return Json.write(root);
    }

    private static Map<String, Object> layerToJson(Editor.Layer l, boolean withPixels) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", l.id);
        m.put("name", l.name);
        m.put("kind", l.kind);
        m.put("visible", l.visible);
        m.put("opacity", l.opacity);
        m.put("blendMode", l.blendMode);
        m.put("maskEnabled", l.maskEnabled);
        m.put("params", paramsToJson(l.params));
        m.put("curves", curvesToJson(l.curves));
        m.put("filter", l.filter);
        m.put("filterParams", doublesToJson(l.filterParams));
        m.put("adj", l.adj == null ? null : AdvAdjust.toMap(l.adj));
        m.put("style", l.style);
        m.put("lut", lutToJson(l.lut));
        if (withPixels) {
            m.put("image", l.canvas == null ? null : pngDataUrl(l.canvas));
            m.put("mask", l.mask == null ? null : pngDataUrl(l.mask));
        }
        return m;
    }

    // ---------- 导入 ----------
    /** 读入工程并替换编辑器文档（一步可撤销）。格式不对抛中文 IllegalArgumentException 且不动文档。 */
    public static void importProject(Editor ed, String json) {
        Object parsed = Json.parse(json);
        if (!(parsed instanceof Map)) throw new IllegalArgumentException("工程文件已损坏，无法打开");
        @SuppressWarnings("unchecked") Map<String, Object> root = (Map<String, Object>) parsed;
        if (!PROJECT_FORMAT.equals(root.get("format"))) throw new IllegalArgumentException("这不是喵图工程文件");
        if (num(root.get("version"), -1) != VERSION) throw new IllegalArgumentException("工程文件版本不受支持");
        Object lo = root.get("layers");
        if (!(lo instanceof List) || ((List<?>) lo).isEmpty() || num(root.get("docW"), 0) <= 0 || num(root.get("docH"), 0) <= 0)
            throw new IllegalArgumentException("工程文件已损坏，无法打开");
        List<Editor.Layer> layers = new ArrayList<>();
        for (Object o : (List<?>) lo) {
            if (!(o instanceof Map)) throw new IllegalArgumentException("工程文件已损坏，无法打开");
            @SuppressWarnings("unchecked") Map<String, Object> lm = (Map<String, Object>) o;
            layers.add(layerFromJson(lm, true));
        }
        List<TextObject> texts = textsFromJson(root.get("texts"));
        int active = (int) num(root.get("activeIdx"), layers.size() - 1);
        ed.replaceDocument(layers, active, texts);
    }

    /** 套用配方：按层序套到当前文档前 min(配方层数, 文档层数) 层，返回实际套用数。 */
    public static int applyRecipe(Editor ed, String json) {
        Object parsed = Json.parse(json);
        if (!(parsed instanceof Map)) throw new IllegalArgumentException("配方文件已损坏，无法打开");
        @SuppressWarnings("unchecked") Map<String, Object> root = (Map<String, Object>) parsed;
        if (!RECIPE_FORMAT.equals(root.get("format"))) throw new IllegalArgumentException("这不是喵图配方文件");
        if (num(root.get("version"), -1) != VERSION) throw new IllegalArgumentException("配方文件版本不受支持");
        Object lo = root.get("layers");
        if (!(lo instanceof List) || ((List<?>) lo).isEmpty()) throw new IllegalArgumentException("配方文件已损坏，无法打开");
        int n = Math.min(((List<?>) lo).size(), ed.layerCount());
        List<Editor.Layer> states = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            @SuppressWarnings("unchecked") Map<String, Object> lm = (Map<String, Object>) ((List<?>) lo).get(i);
            states.add(layerFromJson(lm, false));
        }
        for (int i = 0; i < n; i++) {
            Editor.Layer src = states.get(i), dst = ed.layerAt(i);
            dst.visible = src.visible;
            dst.opacity = src.opacity;
            dst.blendMode = src.blendMode;
            dst.params.setFrom(src.params);
            for (int ch = 0; ch < 4; ch++) dst.curves.setPoints(ch, src.curves.points(ch));
            dst.filter = src.filter;
            dst.filterParams = src.filterParams;
            dst.adj = src.adj;
            dst.lut = src.lut;
            if (!dst.kind.equals("adj")) dst.style = src.style;
        }
        return n;
    }

    private static Editor.Layer layerFromJson(Map<String, Object> lm, boolean withPixels) {
        String kind = str(lm.get("kind"), "pixel");
        if (!kind.equals("pixel") && !kind.equals("adj")) throw new IllegalArgumentException("工程文件已损坏，无法打开");
        Editor.Layer l = new Editor.Layer();
        l.id = str(lm.get("id"), null);
        l.name = str(lm.get("name"), "图层");
        l.kind = kind;
        l.visible = lm.get("visible") == null || Boolean.TRUE.equals(lm.get("visible"));
        l.opacity = num(lm.get("opacity"), 1);
        l.blendMode = str(lm.get("blendMode"), "normal");
        l.maskEnabled = lm.get("maskEnabled") == null || Boolean.TRUE.equals(lm.get("maskEnabled"));
        if (!(lm.get("params") instanceof Map) || !(lm.get("curves") instanceof Map))
            throw new IllegalArgumentException("工程文件已损坏，无法打开");
        paramsFromJson(l.params, castMap(lm.get("params")));
        curvesFromJson(l.curves, castMap(lm.get("curves")));
        l.filter = str(lm.get("filter"), null);
        l.filterParams = doublesFromJson(lm.get("filterParams"));
        Object adj = lm.get("adj");
        l.adj = adj instanceof Map ? AdvAdjust.fromMap(castMap(adj)) : null;
        Object style = lm.get("style");
        l.style = style instanceof Map ? Editor.deepCopyMap(castMap(style)) : null;
        l.lut = lutFromJson(lm.get("lut"));
        if (withPixels) {
            if (kind.equals("pixel")) {
                if (!(lm.get("image") instanceof String)) throw new IllegalArgumentException("工程文件已损坏，无法打开");
                l.canvas = fromDataUrl((String) lm.get("image"));
            }
            if (lm.get("mask") instanceof String) l.mask = fromDataUrl((String) lm.get("mask"));
        }
        return l;
    }

    // ---------- 字段互转 ----------
    static Map<String, Object> paramsToJson(AdjustParams p) {
        double[] v = {p.exposure, p.brightness, p.contrast, p.temperature, p.tint, p.saturation, p.vibrance,
                p.highlights, p.shadows, p.whites, p.blacks, p.clarity, p.sharpen};
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < PARAM_KEYS.length; i++) m.put(PARAM_KEYS[i], v[i]);
        return m;
    }

    static void paramsFromJson(AdjustParams p, Map<String, Object> m) {
        double[] v = new double[PARAM_KEYS.length];
        for (int i = 0; i < PARAM_KEYS.length; i++) v[i] = num(m.get(PARAM_KEYS[i]), 0);
        p.exposure = v[0]; p.brightness = v[1]; p.contrast = v[2]; p.temperature = v[3]; p.tint = v[4];
        p.saturation = v[5]; p.vibrance = v[6]; p.highlights = v[7]; p.shadows = v[8]; p.whites = v[9];
        p.blacks = v[10]; p.clarity = v[11]; p.sharpen = v[12];
    }

    static Map<String, Object> curvesToJson(Curves c) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int ch = 0; ch < 4; ch++) {
            List<Object> pts = new ArrayList<>();
            for (Point pt : c.points(ch)) {
                List<Object> pair = new ArrayList<>();
                pair.add((double) pt.x);
                pair.add((double) pt.y);
                pts.add(pair);
            }
            m.put(CURVE_KEYS[ch], pts);
        }
        return m;
    }

    static void curvesFromJson(Curves c, Map<String, Object> m) {
        for (int ch = 0; ch < 4; ch++) {
            Object o = m.get(CURVE_KEYS[ch]);
            if (!(o instanceof List)) continue;
            List<Point> pts = new ArrayList<>();
            for (Object po : (List<?>) o) {
                if (po instanceof List && ((List<?>) po).size() >= 2) {
                    List<?> pair = (List<?>) po;
                    pts.add(new Point((int) Math.round(num(pair.get(0), 0)), (int) Math.round(num(pair.get(1), 0))));
                } else if (po instanceof Map) { // 容忍 {x,y} 形式
                    Map<?, ?> pm = (Map<?, ?>) po;
                    pts.add(new Point((int) Math.round(num(pm.get("x"), 0)), (int) Math.round(num(pm.get("y"), 0))));
                }
            }
            if (pts.size() >= 2) c.setPoints(ch, pts);
        }
    }

    static Map<String, Object> doublesToJson(Map<String, Double> in) {
        if (in == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        for (Map.Entry<String, Double> e : in.entrySet()) m.put(e.getKey(), e.getValue());
        return m;
    }

    static Map<String, Double> doublesFromJson(Object o) {
        if (!(o instanceof Map)) return null;
        Map<String, Double> m = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
            if (e.getKey() instanceof String && e.getValue() instanceof Number)
                m.put((String) e.getKey(), ((Number) e.getValue()).doubleValue());
        }
        return m;
    }

    static Map<String, Object> lutToJson(Lut.State s) {
        if (s == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.id);
        m.put("strength", s.strength);
        if (s.cube != null) m.put("cube", s.cube);
        if (s.name != null) m.put("name", s.name);
        return m;
    }

    static Lut.State lutFromJson(Object o) {
        if (!(o instanceof Map)) return null;
        Map<?, ?> m = (Map<?, ?>) o;
        Lut.State s = new Lut.State();
        s.id = str(m.get("id"), null);
        s.strength = num(m.get("strength"), 100);
        s.cube = str(m.get("cube"), null);
        s.name = str(m.get("name"), null);
        return s.id == null ? null : s;
    }

    static List<Object> textsToJson(List<TextObject> texts) {
        List<Object> out = new ArrayList<>();
        for (TextObject t : texts) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("text", t.text);
            m.put("x", t.x);
            m.put("y", t.y);
            m.put("size", (double) t.size);
            m.put("bold", t.bold);
            m.put("italic", t.italic);
            m.put("font", t.fontName);
            m.put("color", String.format("#%02x%02x%02x", t.color.getRed(), t.color.getGreen(), t.color.getBlue()));
            m.put("outline", t.outline);
            out.add(m);
        }
        return out;
    }

    static List<TextObject> textsFromJson(Object o) {
        List<TextObject> out = new ArrayList<>();
        if (!(o instanceof List)) return out;
        for (Object e : (List<?>) o) {
            if (!(e instanceof Map)) continue;
            Map<?, ?> m = (Map<?, ?>) e;
            TextObject t = new TextObject(str(m.get("text"), ""), num(m.get("x"), 0), num(m.get("y"), 0));
            t.size = (int) Math.round(num(m.get("size"), 48));
            t.bold = Boolean.TRUE.equals(m.get("bold"));
            t.italic = Boolean.TRUE.equals(m.get("italic"));
            t.fontName = str(m.get("font"), t.fontName);
            String col = str(m.get("color"), null);
            if (col != null) {
                try { t.color = Color.decode(col); } catch (RuntimeException ignored) { }
            }
            t.outline = m.get("outline") == null || Boolean.TRUE.equals(m.get("outline"));
            out.add(t);
        }
        return out;
    }

    // ---------- PNG dataURL ----------
    static String pngDataUrl(BufferedImage img) {
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            ImageIO.write(img, "png", bos);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(bos.toByteArray());
        } catch (java.io.IOException e) {
            throw new RuntimeException("PNG 编码失败", e);
        }
    }

    static BufferedImage fromDataUrl(String s) {
        try {
            int comma = s.indexOf(',');
            String b64 = comma >= 0 ? s.substring(comma + 1) : s;
            byte[] bytes = Base64.getDecoder().decode(b64);
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img == null) throw new IllegalArgumentException("工程文件已损坏，无法打开");
            return Img.copy(img);
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("工程文件已损坏，无法打开");
        }
    }

    // ---------- 小工具 ----------
    @SuppressWarnings("unchecked")
    static Map<String, Object> castMap(Object o) { return (Map<String, Object>) o; }

    static double num(Object o, double def) { return o instanceof Number ? ((Number) o).doubleValue() : def; }
    static String str(Object o, String def) { return o instanceof String ? (String) o : def; }
}
