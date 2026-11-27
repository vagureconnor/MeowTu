package meowtu;

import meowtu.core.AdjustParams;
import meowtu.core.Curves;
import meowtu.core.Img;
import meowtu.core.LutEngine;

import java.awt.Graphics2D;
import java.awt.Point;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * 编辑引擎（与网页版 engine.js 同构）：持有底图 + 常驻的调节参数/曲线/文字，
 * 显示与导出都由「底图 → 调节 → 曲线 → 文字」管线实时合成——数值即效果，永不烘焙归零，
 * 用户随时可以把滑杆拖回微调。历史栈存的是完整状态快照：撤销/重做连参数、曲线、文字一起恢复。
 * 约定：BufferedImage 一经设定不再原地修改（所有算子都返回新图），故快照可共享底图引用；
 * 参数/曲线/文字是可变状态，快照时深拷贝。
 */
public class Editor {
    public static final int HISTORY_MAX = 20;
    private static final int PREVIEW_MAX_SIDE = 1100;

    private BufferedImage base;
    private BufferedImage previewSrc;
    private final AdjustParams params = new AdjustParams();
    private final Curves curves = new Curves();
    private final List<TextObject> texts = new ArrayList<>();
    private final Deque<State> undoStack = new ArrayDeque<>();
    private final Deque<State> redoStack = new ArrayDeque<>();
    private State lastSettled;   // 上一个「已安定」状态快照（调节检查点用）

    /** 完整状态快照：底图（共享引用）+ 参数/曲线/文字（深拷贝）。 */
    private static final class State {
        final BufferedImage base;
        final AdjustParams params;
        final List<List<Point>> curvePts;
        final List<TextObject> texts;

        State(BufferedImage base, AdjustParams params, List<List<Point>> curvePts, List<TextObject> texts) {
            this.base = base;
            this.params = params;
            this.curvePts = curvePts;
            this.texts = texts;
        }
    }

    // ---------- 状态访问 ----------
    public boolean hasImage() { return base != null; }
    public BufferedImage base() { return base; }
    public AdjustParams params() { return params; }
    public Curves curves() { return curves; }
    public List<TextObject> texts() { return texts; }
    public boolean canUndo() { return !undoStack.isEmpty(); }
    public boolean canRedo() { return !redoStack.isEmpty(); }

    // ---------- 载入 ----------
    /** 载入新图（打开/示例图）：清历史、清全部待生效状态。 */
    public void setFreshImage(BufferedImage img) {
        base = img;
        undoStack.clear();
        redoStack.clear();
        params.reset();
        curves.reset();
        texts.clear();
        refreshPreviewSrc();
        lastSettled = snapshotState();
    }

    // ---------- 合成 ----------
    private void refreshPreviewSrc() {
        previewSrc = base == null ? null : Img.downscale(base, PREVIEW_MAX_SIDE);
    }

    /** 管线合成（不含文字）：调节逐像素段 → 曲线 → 调节空间段，与网页版 runPipeline 同序。恒返回新图。 */
    public BufferedImage renderPipeline(BufferedImage src) {
        BufferedImage out = LutEngine.applyPixelStages(src, params);
        out = curves.apply(out);
        out = LutEngine.applySpatial(out, params);
        return out;
    }

    /** 当前显示图：无待生效调节/曲线时直接用底图，否则用降采样预览的管线结果。 */
    public BufferedImage renderView() {
        if (base == null) return null;
        if (params.isIdentity() && curves.isIdentity()) return base;
        return renderPipeline(previewSrc);
    }

    /** 当前效果的预览分辨率版本（滤镜预览的输入）。 */
    public BufferedImage renderPreview() {
        if (base == null) return null;
        return renderPipeline(previewSrc);
    }

    /** 当前完整效果的全分辨率合成：底图 + 调节 + 曲线 + 文字（所见即所得）。 */
    public BufferedImage bakeCurrent() {
        if (base == null) return null;
        BufferedImage out = renderPipeline(base);
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
        List<List<Point>> cp = new ArrayList<>();
        for (int ch = 0; ch < 4; ch++) {
            List<Point> l = new ArrayList<>();
            for (Point p : curves.points(ch)) l.add(new Point(p));
            cp.add(l);
        }
        List<TextObject> ts = new ArrayList<>();
        for (TextObject t : texts) ts.add(t.copy());
        return new State(base, params.copy(), cp, ts);
    }

    private void restoreState(State s) {
        base = s.base;
        params.setFrom(s.params);
        for (int ch = 0; ch < 4; ch++) curves.setPoints(ch, s.curvePts.get(ch));
        texts.clear();
        for (TextObject t : s.texts) texts.add(t.copy());
        refreshPreviewSrc();
        lastSettled = snapshotState();
    }

    private void pushUndo(State s) {
        undoStack.push(s);
        while (undoStack.size() > HISTORY_MAX) undoStack.removeLast();
    }

    /**
     * 调节检查点：滑杆松手/曲线拖完/重置时调用。若调节或曲线与上个安定状态不同，
     * 把安定状态存入撤销栈——Ctrl+Z 能逐步退回调节，数值本身始终常驻不归零。
     */
    public boolean checkpointAdjust() {
        if (base == null || lastSettled == null) return false;
        if (paramsEqual(params, lastSettled.params) && curvesEqual(lastSettled)) return false;
        pushUndo(lastSettled);
        redoStack.clear();
        lastSettled = snapshotState();
        return true;
    }

    private static boolean paramsEqual(AdjustParams a, AdjustParams b) {
        return a.exposure == b.exposure && a.brightness == b.brightness && a.contrast == b.contrast
                && a.temperature == b.temperature && a.tint == b.tint && a.saturation == b.saturation
                && a.vibrance == b.vibrance && a.highlights == b.highlights && a.shadows == b.shadows
                && a.whites == b.whites && a.blacks == b.blacks && a.clarity == b.clarity && a.sharpen == b.sharpen;
    }

    private boolean curvesEqual(State s) {
        for (int ch = 0; ch < 4; ch++) {
            List<Point> a = curves.points(ch), b = s.curvePts.get(ch);
            if (a.size() != b.size()) return false;
            for (int i = 0; i < a.size(); i++) {
                if (a.get(i).x != b.get(i).x || a.get(i).y != b.get(i).y) return false;
            }
        }
        return true;
    }

    /** 重置全部待生效调节：参数归零 + 曲线恢复恒等（随后由调用方记检查点，可撤销回来）。 */
    public void resetAdjust() {
        params.reset();
        curves.reset();
    }

    // ---------- 离散操作 ----------
    /**
     * 通用提交：旧状态整套入撤销栈、清重做栈、换新底图。待生效的调节/曲线/文字
     * 已包含在新底图里（调用方应以 bakeCurrent() 的结果为操作输入），随本次提交一并归零。
     */
    public void commitImage(BufferedImage newBase) {
        if (base != null) pushUndo(snapshotState());
        redoStack.clear();
        base = newBase;
        params.reset();
        curves.reset();
        texts.clear();
        refreshPreviewSrc();
        lastSettled = snapshotState();
    }

    /** 把当前效果（含文字）全分辨率烘焙进底图并提交，随后清空文字列表。 */
    public boolean commitTexts() {
        if (base == null || texts.isEmpty()) return false;
        commitImage(bakeCurrent());
        return true;
    }

    // ---------- 历史 ----------
    public boolean undo() {
        if (undoStack.isEmpty()) return false;
        redoStack.push(snapshotState());
        restoreState(undoStack.pop());
        return true;
    }

    public boolean redo() {
        if (redoStack.isEmpty()) return false;
        pushUndo(snapshotState());
        restoreState(redoStack.pop());
        return true;
    }
}
