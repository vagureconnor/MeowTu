package meowtu;

import meowtu.core.AdvAdjust;
import meowtu.flatui.FlatTheme;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.List;

/**
 * 高级调整面板（8 段，与网页版 adjust.js 同参数同范围）：色阶/通道混合器/可选颜色/
 * 照片滤镜/黑白/渐变映射/色调分离/阈值。每段一个启用开关 + 数据驱动滑杆；
 * 编辑直接作用于活动层的高级调整状态（实时预览），松手记检查点（可撤销）。
 * 顶部另有「智能一键优化」（adjust.js autoOptimize 的策略：直方图百分位 + 通道均值色偏）。
 */
public class AdvPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final Editor editor;
    private AdvAdjust.State view = new AdvAdjust.State();
    private boolean syncing;
    private final List<Runnable> refreshers = new ArrayList<>();

    private interface Get { double get(AdvAdjust.State s); }
    private interface Set { void set(AdvAdjust.State s, double v); }

    public AdvPanel(MainFrame frame, Editor editor) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        this.editor = editor;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        JPanel body = new JPanel();
        body.setOpaque(false);
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));

        JButton smart = new JButton("智能一键优化");
        smart.addActionListener(e -> smartOptimize());
        body.add(smart);
        body.add(Box.createVerticalStrut(6));

        body.add(section("色阶", () -> view.levelsOn, v -> view.levelsOn = v, new Object[][]{
                row("黑场", 0, 253, 1, s -> s.levelsInBlack, (s, v) -> s.levelsInBlack = Math.min((int) v, s.levelsInWhite - 2)),
                row("灰场", 0.1, 9.99, 0.01, s -> s.levelsGamma, (s, v) -> s.levelsGamma = v),
                row("白场", 2, 255, 1, s -> s.levelsInWhite, (s, v) -> s.levelsInWhite = Math.max((int) v, s.levelsInBlack + 2)),
        }));
        // 通道混合器：3 行 ×（红/绿/蓝/常数）
        List<Object[]> mixerRows = new ArrayList<>();
        String[] rn = {"红", "绿", "蓝"}, cn = {"红", "绿", "蓝", "常数"};
        for (int r = 0; r < 3; r++) for (int c = 0; c < 4; c++) {
            final int rr = r, cc = c;
            mixerRows.add(row(rn[r] + "·" + cn[c], -200, 200, 1, s -> s.mixerM[rr][cc], (s, v) -> s.mixerM[rr][cc] = Math.round(v)));
        }
        JPanel mixerSec = section("通道混合器", () -> view.mixerOn, v -> view.mixerOn = v, mixerRows.toArray(new Object[0][]));
        JCheckBox mono = new JCheckBox("单色");
        mono.setOpaque(false);
        mono.addActionListener(e -> { install(); view.mixerMono = mono.isSelected(); if (view.mixerMono) view.mixerM[0] = new double[]{40, 40, 20, 0}; commitNow(); });
        refreshers.add(() -> mono.setSelected(view.mixerMono));
        mixerSec.add(mono);
        body.add(mixerSec);
        // 可选颜色
        JPanel selSec = section("可选颜色", () -> view.selcolorOn, v -> view.selcolorOn = v, new Object[][]{
                row("青", -100, 100, 1, s -> s.selcolorA[s.selcolorRange][0], (s, v) -> s.selcolorA[s.selcolorRange][0] = Math.round(v)),
                row("洋红", -100, 100, 1, s -> s.selcolorA[s.selcolorRange][1], (s, v) -> s.selcolorA[s.selcolorRange][1] = Math.round(v)),
                row("黄", -100, 100, 1, s -> s.selcolorA[s.selcolorRange][2], (s, v) -> s.selcolorA[s.selcolorRange][2] = Math.round(v)),
                row("黑", -100, 100, 1, s -> s.selcolorA[s.selcolorRange][3], (s, v) -> s.selcolorA[s.selcolorRange][3] = Math.round(v)),
        });
        JComboBox<String> rangeBox = new JComboBox<>(AdvAdjust.SEL_RANGES);
        rangeBox.addActionListener(e -> { view.selcolorRange = rangeBox.getSelectedIndex(); refreshRows(); });
        refreshers.add(() -> rangeBox.setSelectedIndex(Math.max(0, Math.min(8, view.selcolorRange))));
        JCheckBox rel = new JCheckBox("相对");
        rel.setOpaque(false);
        rel.addActionListener(e -> { install(); view.selcolorRel = rel.isSelected(); commitNow(); });
        refreshers.add(() -> rel.setSelected(view.selcolorRel));
        JPanel selCtrl = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        selCtrl.setOpaque(false);
        selCtrl.add(new JLabel("颜色范围"));
        selCtrl.add(rangeBox);
        selCtrl.add(rel);
        selSec.add(selCtrl);
        body.add(selSec);
        // 照片滤镜
        JPanel photoSec = section("照片滤镜", () -> view.photoOn, v -> view.photoOn = v, new Object[][]{
                row("浓度", 0, 100, 1, s -> s.photoDensity, (s, v) -> s.photoDensity = v),
        });
        JComboBox<String> presetBox = new JComboBox<>(AdvAdjust.PHOTO_FILTER_NAMES);
        presetBox.addActionListener(e -> {
            if (syncing) return;
            int i = presetBox.getSelectedIndex();
            if (i < 0) return;
            install();
            view.photoPreset = i;
            view.photoColor = AdvAdjust.PHOTO_FILTER_RGB[i].clone();
            commitNow();
        });
        refreshers.add(() -> { if (view.photoPreset >= 0 && view.photoPreset < presetBox.getItemCount()) presetBox.setSelectedIndex(view.photoPreset); });
        JCheckBox preserve = new JCheckBox("保留明度");
        preserve.setOpaque(false);
        preserve.addActionListener(e -> { install(); view.photoPreserve = preserve.isSelected(); commitNow(); });
        refreshers.add(() -> preserve.setSelected(view.photoPreserve));
        JPanel photoCtrl = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        photoCtrl.setOpaque(false);
        photoCtrl.add(new JLabel("滤镜"));
        photoCtrl.add(presetBox);
        photoCtrl.add(preserve);
        photoSec.add(photoCtrl);
        body.add(photoSec);
        // 黑白
        String[] bwNames = {"红", "黄", "绿", "青", "蓝", "洋红"};
        List<Object[]> bwRows = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            final int ii = i;
            bwRows.add(row(bwNames[i], -200, 300, 1, s -> s.bwW[ii], (s, v) -> s.bwW[ii] = Math.round(v)));
        }
        body.add(section("黑白", () -> view.bwOn, v -> view.bwOn = v, bwRows.toArray(new Object[0][])));
        // 渐变映射
        JPanel gradSec = section("渐变映射", () -> view.gradmapOn, v -> view.gradmapOn = v, new Object[][]{
                row("强度", 0, 100, 1, s -> s.gradmapAmount, (s, v) -> s.gradmapAmount = v),
        });
        JComboBox<String> mapBox = new JComboBox<>(meowtu.filters.FiltersX.GRAD_MAP_NAMES);
        mapBox.addActionListener(e -> { if (syncing) return; install(); view.gradmapMap = mapBox.getSelectedIndex(); commitNow(); });
        refreshers.add(() -> mapBox.setSelectedIndex(Math.max(0, Math.min(3, view.gradmapMap))));
        JPanel gradCtrl = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        gradCtrl.setOpaque(false);
        gradCtrl.add(new JLabel("色带"));
        gradCtrl.add(mapBox);
        gradSec.add(gradCtrl);
        body.add(gradSec);
        body.add(section("色调分离", () -> view.posterizeOn, v -> view.posterizeOn = v, new Object[][]{
                row("色阶数", 2, 255, 1, s -> s.posterizeLevels, (s, v) -> s.posterizeLevels = (int) Math.round(v)),
        }));
        body.add(section("阈值", () -> view.thresholdOn, v -> view.thresholdOn = v, new Object[][]{
                row("阈值", 1, 255, 1, s -> s.thresholdLevel, (s, v) -> s.thresholdLevel = (int) Math.round(v)),
        }));

        add(new JScrollPane(body), BorderLayout.CENTER);
    }

    private Object[] row(String name, double min, double max, double step, Get g, Set s) {
        return new Object[]{name, min, max, step, g, s};
    }

    private final List<FlatWidgets.SliderRow> allRows = new ArrayList<>();

    private JPanel section(String title, java.util.function.BooleanSupplier onGet,
                           java.util.function.Consumer<Boolean> onSet, Object[][] rows) {
        JPanel sec = new JPanel();
        sec.setOpaque(false);
        sec.setLayout(new BoxLayout(sec, BoxLayout.Y_AXIS));
        sec.setBorder(BorderFactory.createTitledBorder(title));
        JCheckBox on = new JCheckBox("启用");
        on.setOpaque(false);
        on.addActionListener(e -> { install(); onSet.accept(on.isSelected()); commitNow(); });
        refreshers.add(() -> on.setSelected(onGet.getAsBoolean()));
        sec.add(on);
        for (Object[] r : rows) {
            String name = (String) r[0];
            double min = (Double) r[1], max = (Double) r[2], step = (Double) r[3];
            Get g = (Get) r[4];
            Set st = (Set) r[5];
            double scale = step;
            FlatWidgets.SliderRow row = new FlatWidgets.SliderRow(name,
                    (int) Math.round(min / scale), (int) Math.round(max / scale),
                    (int) Math.round(g.get(view) / scale), scale);
            row.slider.addChangeListener(e -> {
                if (syncing) return;
                install();
                st.set(view, row.value());
                frame.refreshView();
                if (!row.slider.getValueIsAdjusting()) frame.checkpoint();
            });
            refreshers.add(() -> row.setValueSilently(g.get(view)));
            allRows.add(row);
            sec.add(row);
        }
        return sec;
    }

    private void refreshRows() {
        syncing = true;
        try { for (Runnable r : refreshers) r.run(); } finally { syncing = false; }
    }

    /** 把面板的工作状态装到活动层（首次编辑时）。装上后 view 与层状态是同一对象，编辑即实时预览。 */
    private void install() {
        Editor.Layer a = editor.activeLayer();
        if (a == null) return;
        if (a.adj == null) a.adj = view;
        else if (a.adj != view) view = a.adj;
    }

    private void commitNow() {
        frame.refreshView();
        frame.checkpoint();
    }

    private void smartOptimize() {
        if (!editor.hasImage()) { frame.setStatus("先打开一张图片"); return; }
        java.awt.image.BufferedImage cur = editor.bakeCurrent();
        if (cur == null) return;
        double[] d = AdvAdjust.smartOptimize(cur);
        meowtu.core.AdjustParams p = editor.params();
        p.exposure += d[0]; p.contrast += d[2]; p.temperature += d[3]; p.saturation += d[5];
        p.highlights += d[7]; p.shadows += d[8];
        frame.refreshView();
        frame.checkpoint();
        frame.setStatus("已智能一键优化（可撤销）");
    }

    /** 引擎状态变化（切换图层/撤销/打开工程）后回填面板。 */
    public void syncFromEngine() {
        Editor.Layer a = editor.activeLayer();
        view = (a != null && a.adj != null) ? a.adj : new AdvAdjust.State();
        refreshRows();
    }
}
