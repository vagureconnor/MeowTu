package meowtu;

import meowtu.core.AdjustParams;
import meowtu.core.AdvAdjust;
import meowtu.core.Blend;
import meowtu.core.Curves;
import meowtu.core.Img;
import meowtu.core.Lut;
import meowtu.core.LutEngine;
import meowtu.filters.Filters;
import meowtu.filters.FiltersX;

import java.awt.Graphics2D;
import java.awt.Point;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 编辑引擎（与网页版 engine.js 同构）：图层文档模型——layers 自下而上，每层持有自己的
 * 像素 + 调节参数/曲线/滤镜/高级调整/LUT/样式/蒙版状态，合成时逐层过管线再按 27 种混合模式叠加。
 * 管线顺序与网页版 runPipeline 一致：调节逐像素段 → 曲线 → 清晰度/锐化空间段 → 高级调整 → LUT → 滤镜。
 * 调整层无像素：把管线（不含滤镜段）作用于其下已合成结果再按不透明度 blend back（译自 PhotoCraft）。
 * 历史栈存完整文档快照：撤销/重做连图层结构与各层状态一起恢复。
 * 约定：BufferedImage 一经设定不再原地修改（所有算子都返回新图），故快照可共享像素引用；
 * 参数/曲线/文字/滤镜参数是可变状态，快照时深拷贝。
 * 旧单图 API（params()/setFilter()/commitImage() 等）保留为「活动层门面」，语义与旧版一致。
 */
public class Editor {
    public static final int HISTORY_MAX = 20;
    private static final int PREVIEW_MAX_SIDE = 1100;

    /** 一个图层（字段与网页版图层对象同构）。 */
    public static final class Layer {
        public String id;
        public String name;
        public String kind = "pixel";          // "pixel" | "adj"
        public BufferedImage canvas;           // kind=pixel 时的像素（文档尺寸）；adj 层为 null
        public boolean visible = true;
        public double opacity = 1.0;
        public String blendMode = "normal";
        public final AdjustParams params = new AdjustParams();
        public final Curves curves = new Curves();
        public String filter;                  // 当前滤镜 id（状态式：不烘焙、不叠加）
        public Map<String, Double> filterParams; // 带参数滤镜的参数（FiltersX）
        public double filterStrength = 1.0;    // 旧 18 滤镜的强度（状态的一部分）
        public AdvAdjust.State adj;            // 高级调整状态（null = 未启用）
        public Lut.State lut;                  // LUT 状态（null = 无）
        public Map<String, Object> style;      // 图层样式（styles.js 的 style 对象 JSON 模型，null = 无样式）
        public BufferedImage mask;             // 灰度蒙版（文档尺寸，null = 无蒙版）
        public boolean maskEnabled = true;

        public Layer copy() {
            Layer l = new Layer();
            l.id = id; l.name = name; l.kind = kind; l.canvas = canvas;
            l.visible = visible; l.opacity = opacity; l.blendMode = blendMode;
            l.params.setFrom(params);
            for (int ch = 0; ch < 4; ch++) {
                List<Point> pts = new ArrayList<>();
                for (Point p : curves.points(ch)) pts.add(new Point(p));
                l.curves.setPoints(ch, pts);
            }
            l.filter = filter;
            l.filterParams = filterParams == null ? null : new LinkedHashMap<>(filterParams);
            l.filterStrength = filterStrength;
            l.adj = adj == null ? null : adj.copy();
            l.lut = lut == null ? null : lut.copy();
            l.style = style == null ? null : deepCopyMap(style);
            l.mask = mask; l.maskEnabled = maskEnabled;
            return l;
        }

        /** 该层是否有任何待生效编辑（管线非恒等）。 */
        public boolean editsActive() {
            return !params.isIdentity() || !curves.isIdentity() || filter != null
                    || (adj != null && !adj.isIdentity()) || (lut != null && Lut.isActive(lut));
        }
    }

    static Map<String, Object> deepCopyMap(Map<String, Object> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : m.entrySet()) out.put(e.getKey(), deepCopyVal(e.getValue()));
        return out;
    }

    @SuppressWarnings("unchecked")
    static Object deepCopyVal(Object v) {
        if (v instanceof Map) return deepCopyMap((Map<String, Object>) v);
        if (v instanceof List) {
            List<Object> out = new ArrayList<>();
            for (Object o : (List<Object>) v) out.add(deepCopyVal(o));
            return out;
        }
        return v;
    }

    /** 完整文档快照。 */
    private static final class State {
        final List<Layer> layers;
        final int activeIdx;
        final List<TextObject> texts;
        State(List<Layer> layers, int activeIdx, List<TextObject> texts) {
            this.layers = layers; this.activeIdx = activeIdx; this.texts = texts;
        }
    }

    private final List<Layer> layers = new ArrayList<>();
    private int activeIdx = -1;
    private final List<TextObject> texts = new ArrayList<>();
    private int layerSeq = 0;
    private final Deque<State> undoStack = new ArrayDeque<>();
    private final Deque<State> redoStack = new ArrayDeque<>();
    private State lastSettled;

    // ---------- 文档/图层访问 ----------
    public boolean hasImage() { return !layers.isEmpty(); }
    public int layerCount() { return layers.size(); }
    public Layer layerAt(int i) { return layers.get(i); }
    public List<Layer> layers() { return layers; }
    public int activeIndex() { return activeIdx; }
    public Layer activeLayer() { return layers.isEmpty() ? null : layers.get(Math.max(0, Math.min(activeIdx, layers.size() - 1))); }
    public java.awt.Dimension getSize() {
        Layer b = bottomPixelLayer();
        return b == null ? new java.awt.Dimension(0, 0) : new java.awt.Dimension(b.canvas.getWidth(), b.canvas.getHeight());
    }

    private Layer bottomPixelLayer() {
        for (Layer l : layers) if (l.canvas != null) return l;
        return null;
    }

    public void setActiveLayer(int i) {
        if (i >= 0 && i < layers.size()) activeIdx = i;
    }

    // ---------- 载入 ----------
    /** 载入新图（打开/示例图）：单图层文档，清历史与全部状态。 */
    public void setFreshImage(BufferedImage img) {
        layers.clear();
        texts.clear();
        undoStack.clear();
        redoStack.clear();
        Layer l = newLayer("背景", "pixel");
        l.canvas = img;
        layers.add(l);
        activeIdx = 0;
        settle();
    }

    private Layer newLayer(String name, String kind) {
        Layer l = new Layer();
        l.id = "L" + (++layerSeq);
        l.name = name;
        l.kind = kind;
        return l;
    }

    // ---------- 图层结构操作（离散，均一步可撤销） ----------
    private void beginDiscrete() {
        if (!layers.isEmpty()) pushUndo(snapshotState());
        redoStack.clear();
    }

    private void endDiscrete() { settle(); }

    private void settle() { lastSettled = snapshotState(); lastSig = activeSig(); }

    /** 在活动层上方新建像素图层（给定像素，须为文档尺寸）。 */
    public Layer addLayer(BufferedImage img, String name) {
        if (layers.isEmpty()) return null;
        beginDiscrete();
        Layer l = newLayer(name == null ? "图层 " + (layers.size() + 1) : name, "pixel");
        l.canvas = img;
        layers.add(activeIdx + 1, l);
        activeIdx++;
        endDiscrete();
        return l;
    }

    /** 在活动层上方新建调整图层（无像素，管线作用于其下合成结果）。 */
    public Layer addAdjustmentLayer() {
        if (layers.isEmpty()) return null;
        beginDiscrete();
        Layer l = newLayer("调整图层 " + (layers.size() + 1), "adj");
        layers.add(activeIdx + 1, l);
        activeIdx++;
        endDiscrete();
        return l;
    }

    public Layer duplicateLayer(int i) {
        if (i < 0 || i >= layers.size()) return null;
        beginDiscrete();
        Layer c = layers.get(i).copy();
        c.id = "L" + (++layerSeq);
        c.name = layers.get(i).name + " 副本";
        layers.add(i + 1, c);
        activeIdx = i + 1;
        endDiscrete();
        return c;
    }

    public boolean deleteLayer(int i) {
        if (layers.size() <= 1 || i < 0 || i >= layers.size()) return false;
        beginDiscrete();
        layers.remove(i);
        if (activeIdx >= layers.size()) activeIdx = layers.size() - 1;
        endDiscrete();
        return true;
    }

    public boolean moveLayer(int from, int to) {
        if (from < 0 || from >= layers.size() || to < 0 || to >= layers.size() || from == to) return false;
        beginDiscrete();
        Layer l = layers.remove(from);
        layers.add(to, l);
        activeIdx = to;
        endDiscrete();
        return true;
    }

    /** 向下合并：把上层连同其管线/混合/蒙版烘焙进下层（所见即所得），结果为像素层。 */
    public boolean mergeDown(int i) {
        if (i <= 0 || i >= layers.size()) return false;
        Layer up = layers.get(i), down = layers.get(i - 1);
        if (down.kind.equals("adj")) return false;
        java.awt.Dimension d = getSize();
        List<Layer> pair = new ArrayList<>();
        pair.add(down); pair.add(up);
        BufferedImage merged = compositeStack(pair, d.width, d.height);
        beginDiscrete();
        Layer nl = newLayer(down.name, "pixel");
        nl.canvas = merged;
        nl.visible = down.visible;
        layers.remove(i);
        layers.set(i - 1, nl);
        activeIdx = i - 1;
        endDiscrete();
        return true;
    }

    /** 拼合全部图层为一层（所见即所得）。 */
    public boolean flatten() {
        if (layers.isEmpty()) return false;
        BufferedImage flat = bakeComposite();
        beginDiscrete();
        Layer nl = newLayer("背景", "pixel");
        nl.canvas = flat;
        layers.clear();
        layers.add(nl);
        activeIdx = 0;
        endDiscrete();
        return true;
    }

    // ---------- 活动层门面（旧单图 API） ----------
    public BufferedImage base() {
        Layer a = activeLayer();
        if (a != null && a.canvas != null) return a.canvas;
        Layer b = bottomPixelLayer();
        return b == null ? null : b.canvas;
    }

    public AdjustParams params() { Layer a = activeLayer(); return a == null ? null : a.params; }
    public Curves curves() { Layer a = activeLayer(); return a == null ? null : a.curves; }
    public List<TextObject> texts() { return texts; }
    public String activeFilter() { Layer a = activeLayer(); return a == null ? null : a.filter; }
    public double filterStrength() { Layer a = activeLayer(); return a == null ? 1.0 : a.filterStrength; }
    public boolean canUndo() { return !undoStack.isEmpty(); }
    public boolean canRedo() { return !redoStack.isEmpty(); }

    // ---------- 管线 ----------
    /** 单层管线（网页版 runPipeline 同序）。includeFilter=false 时跳过滤镜段（调整层口径）。恒返回新图或原图（恒等时）。 */
    public BufferedImage runLayerPipeline(Layer l, BufferedImage src, boolean includeFilter) {
        BufferedImage out = LutEngine.applyPixelStages(src, l.params);
        out = l.curves.apply(out);
        out = LutEngine.applySpatial(out, l.params);
        if (l.adj != null && !l.adj.isIdentity()) out = AdvAdjust.apply(out, l.adj);
        if (l.lut != null && Lut.isActive(l.lut)) out = Lut.apply(out, l.lut);
        if (includeFilter && l.filter != null) {
            if (FiltersX.byId(l.filter) != null) out = FiltersX.apply(l.filter, out, l.filterParams);
            else out = Filters.apply(l.filter, out, l.filterStrength);
        }
        return out;
    }

    /** 兼容旧 API：用活动层状态对任意源图跑完整管线。 */
    public BufferedImage renderPipeline(BufferedImage src) {
        Layer a = activeLayer();
        return a == null ? src : runLayerPipeline(a, src, true);
    }

    private static byte[] maskBytes(Layer l, int w, int h) {
        if (l.mask == null || !l.maskEnabled) return null;
        BufferedImage m = l.mask;
        if (m.getWidth() != w || m.getHeight() != h) m = Img.resize(m, w, h);
        int[] px = Img.pixels(m);
        byte[] out = new byte[px.length];
        for (int i = 0; i < px.length; i++) out[i] = (byte) ((px[i] >> 16) & 0xFF);
        return out;
    }

    /** 把一摞图层（自下而上）合成为一张图（不含文字）。样式在 StylesBridge 接入点处理。 */
    public BufferedImage compositeStack(List<Layer> stack, int w, int h) {
        int[] acc = new int[w * h];
        for (Layer l : stack) {
            if (!l.visible || l.opacity <= 0) continue;
            if (l.kind.equals("adj")) {
                if (!l.editsActive()) continue;
                BufferedImage backdrop = Img.fromPixels(w, h, acc.clone());
                BufferedImage adjusted = runLayerPipeline(l, backdrop, false);
                int[] ap = Img.pixels(adjusted);
                double k = l.opacity, u = 1 - k;
                for (int i = 0; i < acc.length; i++) {
                    int a = acc[i], b = ap[i];
                    int r = (int) Math.round(((a >> 16) & 0xFF) * u + ((b >> 16) & 0xFF) * k);
                    int g = (int) Math.round(((a >> 8) & 0xFF) * u + ((b >> 8) & 0xFF) * k);
                    int bl = (int) Math.round((a & 0xFF) * u + (b & 0xFF) * k);
                    acc[i] = (a & 0xFF000000) | (r << 16) | (g << 8) | bl;
                }
                continue;
            }
            if (l.canvas == null) continue;
            BufferedImage srcImg = l.canvas;
            if (srcImg.getWidth() != w || srcImg.getHeight() != h) srcImg = Img.resize(srcImg, w, h);
            BufferedImage rendered = runLayerPipeline(l, srcImg, true);
            rendered = StylesBridge.applyInternal(rendered, l);
            int[] sp = Img.pixels(rendered);
            int[] ext = StylesBridge.externalPaint(l, rendered, w, h);
            if (ext != null) Blend.compositeInto(acc, ext, "normal", l.opacity, null);
            Blend.compositeInto(acc, sp, l.blendMode, l.opacity, maskBytes(l, w, h));
        }
        return Img.fromPixels(w, h, acc);
    }

    /** 全分辨率拼合（不含文字）。 */
    public BufferedImage bakeComposite() {
        if (layers.isEmpty()) return null;
        java.awt.Dimension d = getSize();
        return compositeStack(layers, d.width, d.height);
    }

    /** 当前显示图：预览分辨率合成（每层先降采样再过管线，与网页版预览口径一致）。 */
    public BufferedImage renderView() {
        if (layers.isEmpty()) return null;
        java.awt.Dimension d = getSize();
        double s = Math.min(1.0, (double) PREVIEW_MAX_SIDE / Math.max(d.width, d.height));
        if (s >= 1.0) return bakeComposite();
        int pw = Math.max(1, (int) Math.round(d.width * s)), ph = Math.max(1, (int) Math.round(d.height * s));
        List<Layer> prev = new ArrayList<>();
        for (Layer l : layers) {
            Layer c = l.copy();
            if (c.canvas != null) c.canvas = Img.resize(l.canvas, pw, ph);
            if (c.mask != null) c.mask = Img.resize(l.mask, pw, ph);
            prev.add(c);
        }
        return compositeStack(prev, pw, ph);
    }

    /** 兼容旧 API：当前效果的预览分辨率版本。 */
    public BufferedImage renderPreview() { return renderView(); }

    /** 活动层「已生效」全分辨率图（抠图取输入用）；调整层返回 null。 */
    public BufferedImage renderActiveLayerCanvas() {
        Layer a = activeLayer();
        if (a == null || a.canvas == null) return null;
        return runLayerPipeline(a, a.canvas, true);
    }

    /** 当前完整效果：拼合 + 文字（所见即所得）。 */
    public BufferedImage bakeCurrent() {
        BufferedImage out = bakeComposite();
        if (out == null) return null;
        if (!texts.isEmpty()) {
            Graphics2D g = out.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            for (TextObject t : texts) t.render(g);
            g.dispose();
        }
        return out;
    }

    // ---------- 快照 / 检查点 ----------
    private State snapshotState() {
        List<Layer> ls = new ArrayList<>();
        for (Layer l : layers) ls.add(l.copy());
        List<TextObject> ts = new ArrayList<>();
        for (TextObject t : texts) ts.add(t.copy());
        return new State(ls, activeIdx, ts);
    }

    private void restoreState(State s) {
        layers.clear();
        for (Layer l : s.layers) layers.add(l.copy());
        activeIdx = Math.max(0, Math.min(s.activeIdx, layers.size() - 1));
        texts.clear();
        for (TextObject t : s.texts) texts.add(t.copy());
        lastSettled = snapshotState();
    }

    private void pushUndo(State s) {
        undoStack.push(s);
        while (undoStack.size() > HISTORY_MAX) undoStack.removeLast();
    }

    /** 活动层可实时调整字段的签名（参数/曲线/滤镜/LUT/可见性等），供检查点比较。 */
    private String activeSig() {
        Layer a = activeLayer();
        if (a == null) return "";
        StringBuilder sb = new StringBuilder();
        sb.append(activeIdx).append('|').append(layers.size()).append('|');
        AdjustParams p = a.params;
        double[] pv = {p.exposure, p.brightness, p.contrast, p.temperature, p.tint, p.saturation, p.vibrance,
                p.highlights, p.shadows, p.whites, p.blacks, p.clarity, p.sharpen};
        for (double v : pv) sb.append(v).append(',');
        sb.append('|');
        for (int ch = 0; ch < 4; ch++) for (Point pt : a.curves.points(ch)) sb.append(pt.x).append(':').append(pt.y).append(',');
        sb.append('|').append(a.filter).append('|').append(a.filterStrength).append('|').append(a.filterParams);
        sb.append('|').append(a.lut == null ? "" : a.lut.id + "@" + a.lut.strength + "@" + Objects.hashCode(a.lut.cube));
        sb.append('|').append(a.visible).append('|').append(a.opacity).append('|').append(a.blendMode);
        sb.append('|').append(adjSig(a.adj));
        sb.append('|').append(texts.size());
        for (TextObject t : texts) sb.append('|').append(t.text).append(',').append(t.x).append(',').append(t.y);
        return sb.toString();
    }

    /** 高级调整状态签名（集成时按 AdvAdjust.State 的字段实现，见 AdvAdjust.sig）。 */
    static String adjSig(AdvAdjust.State s) { return s == null ? "" : s.sig(); }

    private String lastSig;

    /**
     * 调节检查点：滑杆松手/曲线拖完时调用。活动层的常驻数值与上个安定状态不同才入栈——
     * 数值本身始终常驻不归零，Ctrl+Z 逐步退回。
     */
    public boolean checkpointAdjust() {
        if (layers.isEmpty() || lastSettled == null) return false;
        String sig = activeSig();
        if (sig.equals(lastSig)) return false;
        pushUndo(lastSettled);
        redoStack.clear();
        lastSettled = snapshotState();
        lastSig = sig;
        return true;
    }

    /** 重置活动层待生效调节：参数归零 + 曲线恒等（随后由调用方记检查点，可撤销回来）。 */
    public void resetAdjust() {
        Layer a = activeLayer();
        if (a == null) return;
        a.params.reset();
        a.curves.reset();
    }

    // ---------- 滤镜（状态式，与网页版同语义） ----------
    public boolean setFilter(String id, double strength) {
        Layer a = activeLayer();
        if (a == null || id == null) return false;
        double s = Double.isNaN(strength) ? 0.0 : Math.max(0.0, Math.min(1.0, strength));
        if (id.equals(a.filter) && s == a.filterStrength && a.filterParams == null) return true;
        pushUndo(snapshotState());
        redoStack.clear();
        a.filter = id;
        a.filterStrength = s;
        a.filterParams = null;
        settle();
        return true;
    }

    /** 设定带参数滤镜（FiltersX）：参数表整体替换，一步可撤销。 */
    public boolean setFilterParams(String id, Map<String, Double> params) {
        Layer a = activeLayer();
        if (a == null || id == null) return false;
        pushUndo(snapshotState());
        redoStack.clear();
        a.filter = id;
        a.filterParams = params == null ? null : new LinkedHashMap<>(params);
        settle();
        return true;
    }

    public boolean clearFilter() {
        Layer a = activeLayer();
        if (a == null || a.filter == null) return false;
        pushUndo(snapshotState());
        redoStack.clear();
        a.filter = null;
        a.filterParams = null;
        settle();
        return true;
    }

    /** 滤镜强度实时调整：只改数值、不入栈，松手时由 checkpointAdjust 记检查点。 */
    public void setFilterStrengthLive(double strength) {
        Layer a = activeLayer();
        if (a == null || a.filter == null) return;
        a.filterStrength = Double.isNaN(strength) ? 0.0 : Math.max(0.0, Math.min(1.0, strength));
    }

    // ---------- 高级调整 / LUT / 样式 / 蒙版（活动层，离散一步可撤销） ----------
    public void setAdj(AdvAdjust.State s) {
        Layer a = activeLayer();
        if (a == null) return;
        pushUndo(snapshotState());
        redoStack.clear();
        a.adj = s == null ? null : s.copy();
        settle();
    }

    public void setLut(Lut.State s) {
        Layer a = activeLayer();
        if (a == null) return;
        pushUndo(snapshotState());
        redoStack.clear();
        a.lut = s == null ? null : s.copy();
        settle();
    }

    public void setStyle(Map<String, Object> style) {
        Layer a = activeLayer();
        if (a == null || a.kind.equals("adj")) return;
        pushUndo(snapshotState());
        redoStack.clear();
        a.style = style == null ? null : deepCopyMap(style);
        settle();
    }

    public void setLayerMask(BufferedImage mask, boolean enabled) {
        Layer a = activeLayer();
        if (a == null || a.kind.equals("adj")) return;
        pushUndo(snapshotState());
        redoStack.clear();
        a.mask = mask;
        a.maskEnabled = enabled;
        settle();
    }

    /** 图层属性（可见/不透明度/混合模式）离散设定，一步可撤销。 */
    public void setLayerProps(int i, Boolean visible, Double opacity, String blendMode) {
        if (i < 0 || i >= layers.size()) return;
        pushUndo(snapshotState());
        redoStack.clear();
        Layer l = layers.get(i);
        if (visible != null) l.visible = visible;
        if (opacity != null) l.opacity = Math.max(0, Math.min(1, opacity));
        if (blendMode != null) l.blendMode = blendMode;
        settle();
    }

    // ---------- 离散操作 ----------
    /**
     * 通用提交：把新像素设为活动层像素并重置活动层待生效状态（旧状态整套入撤销栈）。
     * 单图层时与旧版 commitImage 语义完全一致。
     */
    public void commitImage(BufferedImage newBase) {
        Layer a = activeLayer();
        if (a == null) { setFreshImage(newBase); return; }
        pushUndo(snapshotState());
        redoStack.clear();
        if (a.kind.equals("adj")) { // 调整层无像素：落到其下最近的像素层
            a = bottomPixelLayer();
            if (a == null) return;
        }
        a.canvas = newBase;
        a.params.reset();
        a.curves.reset();
        a.filter = null;
        a.filterParams = null;
        a.filterStrength = 1.0;
        a.adj = null;
        a.lut = null;
        settle();
    }

    /** 把文字栅格化到活动层（连同活动层管线一并烘焙），随后清空文字列表。 */
    public boolean commitTexts() {
        Layer a = activeLayer();
        if (a == null || a.canvas == null || texts.isEmpty()) return false;
        BufferedImage baked = runLayerPipeline(a, a.canvas, true);
        Graphics2D g = baked.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        for (TextObject t : texts) t.render(g);
        g.dispose();
        commitImage(baked);   // 先提交（快照含文字，撤销可恢复文字对象）
        texts.clear();
        settle();
        return true;
    }

    /** 对全部像素层的像素与蒙版施加同一变换（几何操作用：旋转/翻转/改尺寸/裁剪）。 */
    public void transformAllLayers(java.util.function.Function<BufferedImage, BufferedImage> fn) {
        if (layers.isEmpty()) return;
        pushUndo(snapshotState());
        redoStack.clear();
        for (Layer l : layers) {
            if (l.canvas != null) l.canvas = fn.apply(l.canvas);
            if (l.mask != null) l.mask = fn.apply(l.mask);
        }
        settle();
    }

    /** 外部批量改动（如套用配方）前调用：把当前安定状态入撤销栈。改完后须调 settleAfterExternalChange()。 */
    public void pushHistorySnapshot() {
        if (!layers.isEmpty()) pushUndo(snapshotState());
        redoStack.clear();
    }

    /** 外部批量改动后调用：刷新安定状态基准。 */
    public void settleAfterExternalChange() { settle(); }

    /** 以完整文档状态替换当前文档（打开工程用，一步可撤销，标签语义由调用方负责）。 */
    public void replaceDocument(List<Layer> newLayers, int newActive, List<TextObject> newTexts) {
        if (!layers.isEmpty()) pushUndo(snapshotState());
        redoStack.clear();
        layers.clear();
        for (Layer l : newLayers) {
            if (l.id == null) l.id = "L" + (++layerSeq);
            else {
                try {
                    int n = Integer.parseInt(l.id.substring(1));
                    if (n > layerSeq) layerSeq = n;
                } catch (RuntimeException ignored) { }
            }
            layers.add(l);
        }
        activeIdx = Math.max(0, Math.min(newActive, layers.size() - 1));
        texts.clear();
        if (newTexts != null) for (TextObject t : newTexts) texts.add(t.copy());
        settle();
    }

    // ---------- 历史 ----------
    public boolean undo() {
        if (undoStack.isEmpty()) return false;
        redoStack.push(snapshotState());
        restoreState(undoStack.pop());
        lastSig = activeSig();
        return true;
    }

    public boolean redo() {
        if (redoStack.isEmpty()) return false;
        pushUndo(snapshotState());
        restoreState(redoStack.pop());
        lastSig = activeSig();
        return true;
    }

    /** 历史条目标签（供历史面板显示）：返回撤销栈深度与重做栈深度。 */
    public int undoDepth() { return undoStack.size(); }
    public int redoDepth() { return redoStack.size(); }
}
