package meowtu;

import meowtu.core.*;
import meowtu.filters.Filters;
import meowtu.flatui.FlatIcons;
import meowtu.flatui.FlatTheme;
import meowtu.flatui.FlatWidgets;

import javax.imageio.ImageIO;
import javax.swing.*;
import javax.swing.filechooser.FileNameExtensionFilter;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.InputStream;
import java.util.List;

/**
 * 主窗口：左工具栏（LOGO+文件/历史/对比快捷操作）｜中央画布｜右侧标签页面板｜底状态栏。
 * 编辑状态（底图/常驻调节参数/曲线/文字/完整状态历史）由 Editor 持有，本类负责布局与 UI 同步。
 */
public class MainFrame extends JFrame {
    private static final long serialVersionUID = 1L;
    public static final int TAB_ADJUST = 0, TAB_FILTERS = 1, TAB_GEOMETRY = 2,
            TAB_TEXT = 3, TAB_CUTOUT = 4;
    private static final String[] COMPARE_NAMES = {"不对比", "左右分屏", "滑块擦除", "长按原图"};
    private int compareIndex = 0;
    private JButton compareBtn;

    private final CanvasPanel canvas = new CanvasPanel();
    private final JTabbedPane tabs = new JTabbedPane(JTabbedPane.TOP, JTabbedPane.SCROLL_TAB_LAYOUT);
    private final JLabel statusLabel = new JLabel("就绪");
    private final JLabel infoLabel = new JLabel("");
    private final JButton undoBtn = new JButton("撤销", FlatIcons.undo(16));
    private final JButton redoBtn = new JButton("重做", FlatIcons.redo(16));

    private final Editor editor = new Editor();
    private BufferedImage originalImage;
    private String fileName = "";

    private AdjustPanel adjustPanel;
    private CurvesPanel curvesPanel;
    private FiltersPanel filtersPanel;
    private HistogramPanel histogramPanel;
    private TextPanel textPanel;
    private final JToggleButton[] toolButtons = new JToggleButton[5];

    // 响应式布局：窄/竖窗口（手机竖屏）时左栏变顶部横条、右面板移到底部
    private JPanel rootPanel, toolbarPanel, rightWrap, statusBarPanel;
    private boolean portrait;
    private boolean layoutReady;

    public MainFrame() {
        super("喵图 MeowTu");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        Dimension screen = Toolkit.getDefaultToolkit().getScreenSize();
        portrait = screen.width <= 760 || screen.width < screen.height;
        if (portrait) {
            setSize(Math.max(320, screen.width), Math.max(480, screen.height));
            setMinimumSize(new Dimension(300, 420));
        } else {
            setSize(1320, 840);
            setMinimumSize(new Dimension(980, 620));
        }
        setLocationRelativeTo(null);
        loadWindowIcon();
        buildMenu();
        buildLayout();
        canvas.setListener(new CanvasPanel.Listener() {
            @Override public void onInteractionEnd() { updateInfo(); }
            @Override public void onZoomChanged() { updateInfo(); }
            @Override public void onPerspectivePointsChanged() {
                setStatus("已点选 " + canvas.getPerspectivePoints().size() + " / 4 个透视点");
            }
        });
        canvas.setTextObjects(editor.texts());
        updateHistoryButtons();
    }

    private void loadWindowIcon() {
        try (InputStream in = getClass().getResourceAsStream("/meowtu-logo-final.png")) {
            if (in == null) return;
            BufferedImage img = ImageIO.read(in);
            if (img == null) return;
            // 原图非正方形，直接设图标会被系统在方形图标位挤压：先居中贴到正方形透明画布
            int side = Math.max(img.getWidth(), img.getHeight());
            if (side != img.getWidth() || side != img.getHeight()) {
                BufferedImage sq = new BufferedImage(side, side, BufferedImage.TYPE_INT_ARGB);
                Graphics2D g = sq.createGraphics();
                g.drawImage(img, (side - img.getWidth()) / 2, (side - img.getHeight()) / 2, null);
                g.dispose();
                img = sq;
            }
            setIconImage(img);
        } catch (Exception ignored) { /* 无图标不影响使用 */ }
    }

    // ---------- 布局 ----------
    private void buildMenu() {
        JMenuBar bar = new JMenuBar();
        JMenu file = new JMenu("文件");
        file.add(item("打开…", "ctrl O", e -> openFile()));
        file.add(item("保存", "ctrl S", e -> saveFile()));
        file.add(item("导出…", null, e -> exportFile()));
        file.addSeparator();
        file.add(item("退出", null, e -> dispose()));
        JMenu edit = new JMenu("编辑");
        edit.add(item("撤销", "ctrl Z", e -> undo()));
        edit.add(item("重做", "ctrl Y", e -> redo()));
        JMenu help = new JMenu("帮助");
        help.add(item("关于喵图", null, e -> showAbout()));
        bar.add(file); bar.add(edit); bar.add(help);
        setJMenuBar(bar);
    }

    private JMenuItem item(String text, String accel, java.awt.event.ActionListener l) {
        JMenuItem mi = new JMenuItem(text);
        if (accel != null) mi.setAccelerator(KeyStroke.getKeyStroke(accel));
        mi.addActionListener(l);
        return mi;
    }

    private void buildLayout() {
        rootPanel = new JPanel(new BorderLayout());
        rootPanel.setBackground(FlatTheme.BG);
        canvas.setBorder(BorderFactory.createEmptyBorder());
        rightWrap = buildRightPanel();
        statusBarPanel = buildStatusBar();
        applyLayout();
        setContentPane(rootPanel);
        layoutReady = true;
        // 窗口尺寸跨过阈值时自动切换布局（手机旋转、浏览器窗口缩放）
        addComponentListener(new java.awt.event.ComponentAdapter() {
            @Override public void componentResized(java.awt.event.ComponentEvent e) {
                if (!layoutReady) return;
                boolean want = getWidth() <= 760 || getWidth() < getHeight();
                if (want != portrait) { portrait = want; applyLayout(); }
            }
        });
    }

    /** 按当前横/竖模式装配根布局：横=左栏+右面板；竖=顶部横条（可横滑）+底部面板。 */
    private void applyLayout() {
        toolbarPanel = buildToolBar(portrait);
        rootPanel.removeAll();
        if (portrait) {
            tabs.setPreferredSize(new Dimension(0, 288));
            rootPanel.add(toolbarPanel, BorderLayout.NORTH);
            rootPanel.add(canvas, BorderLayout.CENTER);
            JPanel bottom = new JPanel(new BorderLayout());
            bottom.setBackground(FlatTheme.BG);
            bottom.add(rightWrap, BorderLayout.CENTER);
            bottom.add(statusBarPanel, BorderLayout.SOUTH);
            rootPanel.add(bottom, BorderLayout.SOUTH);
        } else {
            tabs.setPreferredSize(new Dimension(304, 0));
            rootPanel.add(toolbarPanel, BorderLayout.WEST);
            rootPanel.add(canvas, BorderLayout.CENTER);
            rootPanel.add(rightWrap, BorderLayout.EAST);
            rootPanel.add(statusBarPanel, BorderLayout.SOUTH);
        }
        updateHistoryButtons();
        setTool(canvas.getTool());
        if (compareBtn != null)
            compareBtn.setToolTipText("对比模式：" + COMPARE_NAMES[compareIndex] + "（点一下切换）");
        rootPanel.revalidate();
        rootPanel.repaint();
    }

    /** 对比模式循环切换（原顶栏下拉框改为左栏按钮，点一下换一种）。 */
    private void cycleCompare() {
        compareIndex = (compareIndex + 1) % COMPARE_NAMES.length;
        CanvasPanel.Compare mode = switch (compareIndex) {
            case 1 -> CanvasPanel.Compare.SPLIT;
            case 2 -> CanvasPanel.Compare.SLIDE;
            case 3 -> CanvasPanel.Compare.HOLD;
            default -> CanvasPanel.Compare.OFF;
        };
        canvas.setCompare(mode);
        compareBtn.setText("对比");
        compareBtn.setToolTipText("对比模式：" + COMPARE_NAMES[compareIndex] + "（点一下切换）");
        if (mode == CanvasPanel.Compare.HOLD) setStatus("在画布上按住鼠标即可查看原图");
    }

    private JPanel buildToolBar(boolean horizontal) {
        JPanel bar = new JPanel();
        // 竖屏：两行网格，所有按钮一屏可见、不用横滑；横屏/桌面：竖排左栏
        bar.setLayout(horizontal ? new GridLayout(2, 0, 4, 4)
                : new BoxLayout(bar, BoxLayout.Y_AXIS));
        bar.setBackground(FlatTheme.BG);
        bar.setBorder(horizontal ? BorderFactory.createEmptyBorder(4, 4, 4, 4)
                : BorderFactory.createEmptyBorder(6, 4, 6, 4));
        // LOGO 放在左栏顶部（按原图比例缩放，不单独占横栏）
        try (InputStream in = getClass().getResourceAsStream("/meowtu-logo-final.png")) {
            if (in != null) {
                java.awt.image.BufferedImage logo = ImageIO.read(in);
                int w = 44;
                int h = Math.max(1, (int) Math.round(w * (double) logo.getHeight() / logo.getWidth()));
                JLabel logoLab = new JLabel(new ImageIcon(logo.getScaledInstance(w, h, Image.SCALE_SMOOTH)));
                if (horizontal) {
                    logoLab.setHorizontalAlignment(SwingConstants.CENTER);
                    logoLab.setBorder(BorderFactory.createEmptyBorder());
                } else {
                    logoLab.setAlignmentX(Component.CENTER_ALIGNMENT);
                    logoLab.setBorder(BorderFactory.createEmptyBorder(2, 0, 4, 0));
                }
                bar.add(logoLab);
            }
        } catch (Exception ignored) { }
        JButton openBtn = FlatWidgets.commandButton("打开", FlatIcons.open(16), "打开图片");
        openBtn.addActionListener(e -> openFile());
        bar.add(openBtn);
        JButton saveBtn = FlatWidgets.commandButton("保存", FlatIcons.save(16), "保存当前图片");
        saveBtn.addActionListener(e -> saveFile());
        bar.add(saveBtn);
        JButton exportBtn = FlatWidgets.commandButton("导出", FlatIcons.exportIcon(16), "导出为其它格式");
        exportBtn.addActionListener(e -> exportFile());
        bar.add(exportBtn);
        JButton sampleBtn = FlatWidgets.commandButton("示例图", FlatIcons.image(16), "生成一张测试图");
        sampleBtn.addActionListener(e -> makeSampleImage());
        bar.add(sampleBtn);
        undoBtn.setIcon(FlatIcons.undo(16));
        undoBtn.setVerticalTextPosition(SwingConstants.BOTTOM);
        undoBtn.setHorizontalTextPosition(SwingConstants.CENTER);
        undoBtn.setFont(undoBtn.getFont().deriveFont(10.5f));
        undoBtn.addActionListener(e -> undo());
        redoBtn.setIcon(FlatIcons.redo(16));
        redoBtn.setVerticalTextPosition(SwingConstants.BOTTOM);
        redoBtn.setHorizontalTextPosition(SwingConstants.CENTER);
        redoBtn.setFont(redoBtn.getFont().deriveFont(10.5f));
        redoBtn.addActionListener(e -> redo());
        bar.add(undoBtn);
        bar.add(redoBtn);
        compareBtn = FlatWidgets.commandButton("对比", FlatIcons.image(16), "对比模式：不对比（点一下切换）");
        compareBtn.addActionListener(e -> cycleCompare());
        bar.add(compareBtn);
        JButton fitBtn = FlatWidgets.commandButton("适配", FlatIcons.rect(16), "把图片缩放到窗口大小");
        fitBtn.addActionListener(e -> canvas.fitZoom());
        bar.add(fitBtn);
        if (horizontal) {
            // 网格模式不放间隔件（会占格子），按钮之间靠网格间隙分隔
        } else {
            bar.add(Box.createVerticalStrut(6));
            bar.add(new JSeparator(SwingConstants.HORIZONTAL));
            bar.add(Box.createVerticalStrut(6));
        }
        ButtonGroup group = new ButtonGroup();
        CanvasPanel.Tool[] tools = {CanvasPanel.Tool.BROWSE, CanvasPanel.Tool.CROP, CanvasPanel.Tool.TEXT,
                CanvasPanel.Tool.CUTOUT_RECT, CanvasPanel.Tool.PERSPECTIVE};
        String[] names = {"浏览", "裁剪", "文字", "抠图", "透视"};
        Icon[] icons = {FlatIcons.move(20), FlatIcons.crop(20), FlatIcons.text(20), FlatIcons.wand(20), FlatIcons.rect(20)};
        String[] tips = {"浏览/平移/缩放（滚轮）", "裁剪：拖出选框后到几何页应用", "文字：添加后拖动定位", "抠图：框选主体后到抠图页执行", "透视：点选四角后到几何页矫正"};
        for (int i = 0; i < tools.length; i++) {
            JToggleButton b = FlatWidgets.toolButton(names[i], icons[i], tips[i]);
            group.add(b);
            CanvasPanel.Tool t = tools[i];
            b.addActionListener(e -> setTool(t));
            toolButtons[i] = b;
            bar.add(b);
            if (!horizontal) bar.add(Box.createVerticalStrut(4));
        }
        toolButtons[0].setSelected(true);
        return bar;
    }

    private JPanel buildRightPanel() {
        adjustPanel = new AdjustPanel(this);
        curvesPanel = new CurvesPanel(this);
        filtersPanel = new FiltersPanel(this);
        histogramPanel = new HistogramPanel();
        textPanel = new TextPanel(this);
        adjustPanel.addSection("曲线", curvesPanel);
        adjustPanel.addSection("直方图", histogramPanel);
        tabs.addTab("调节", adjustPanel);
        tabs.addTab("滤镜", filtersPanel);
        tabs.addTab("几何", new GeometryPanel(this));
        tabs.addTab("文字", textPanel);
        tabs.addTab("抠图", new CutoutPanel(this));
        tabs.setPreferredSize(new Dimension(304, 0));
        tabs.addChangeListener(e -> clearPreview());
        JPanel wrap = new JPanel(new BorderLayout());
        wrap.setBackground(FlatTheme.BG);
        wrap.add(tabs, BorderLayout.CENTER);
        return wrap;
    }

    private JPanel buildStatusBar() {
        JPanel bar = new JPanel(new BorderLayout());
        bar.setBackground(FlatTheme.BG_PANEL);
        bar.setBorder(BorderFactory.createEmptyBorder(4, 10, 4, 10));
        statusLabel.setForeground(FlatTheme.TEXT_DIM);
        infoLabel.setForeground(FlatTheme.TEXT_FAINT);
        bar.add(statusLabel, BorderLayout.WEST);
        bar.add(infoLabel, BorderLayout.EAST);
        return bar;
    }

    private void showAbout() {
        JOptionPane.showMessageDialog(this,
                "喵图 MeowTu\n纯 Java 图像编辑工具（JDK 17，零第三方库）\n网页版由 CheerpJ 在浏览器中运行同一个 JAR。",
                "关于喵图", JOptionPane.INFORMATION_MESSAGE);
    }

    // ---------- 供面板调用的接口 ----------
    public boolean hasImage() { return editor.hasImage(); }
    public BufferedImage baseImage() { return editor.base(); }
    public CanvasPanel canvas() { return canvas; }
    public Curves curves() { return editor.curves(); }
    public List<TextObject> textObjects() { return editor.texts(); }
    public AdjustParams adjustParams() { return editor.params(); }
    /** 当前完整效果（底图+调节+曲线+文字）的全分辨率合成，离散操作以此为输入。 */
    public BufferedImage bakeCurrent() { return editor.bakeCurrent(); }

    public void setStatus(String s) { statusLabel.setText(s); }

    public void setTool(CanvasPanel.Tool t) {
        canvas.setTool(t);
        CanvasPanel.Tool[] tools = {CanvasPanel.Tool.BROWSE, CanvasPanel.Tool.CROP, CanvasPanel.Tool.TEXT,
                CanvasPanel.Tool.CUTOUT_RECT, CanvasPanel.Tool.PERSPECTIVE};
        for (int i = 0; i < tools.length; i++) {
            CanvasPanel.Tool want = tools[i];
            boolean sel = want == t || (want == CanvasPanel.Tool.CUTOUT_RECT
                    && (t == CanvasPanel.Tool.CUTOUT_FG || t == CanvasPanel.Tool.CUTOUT_BG));
            toolButtons[i].setSelected(sel);
        }
        switch (t) {
            case CROP, PERSPECTIVE -> tabs.setSelectedIndex(TAB_GEOMETRY);
            case TEXT -> tabs.setSelectedIndex(TAB_TEXT);
            case CUTOUT_RECT, CUTOUT_FG, CUTOUT_BG -> tabs.setSelectedIndex(TAB_CUTOUT);
            default -> { }
        }
    }

    /** 通用提交：把结果图设为当前图并入撤销栈（待生效的调节/曲线/文字已包含在结果里，随之归零）。 */
    public void applyCommitted(BufferedImage img, String label) {
        editor.commitImage(img);
        afterStateChange(false);
        setStatus(label + " 已应用");
    }

    /** 重新显示当前状态（标签页切换时调用：回到常驻状态的合成显示，滤镜是状态不会被切页清掉）。 */
    public void clearPreview() {
        refreshView();
    }

    public String activeFilter() { return editor.activeFilter(); }
    public double filterStrength() { return editor.filterStrength(); }

    /**
     * 设定当前滤镜（状态式，与网页版同语义）：点选即生效，管线合成时应用恰好一次；
     * 重复点同一个不叠加、不重复入栈；点另一个直接替换。状态变化可撤销。
     */
    public void setFilter(String id, double strength) {
        if (!editor.hasImage()) return;
        if (!editor.setFilter(id, strength)) return;
        syncUIFromEngine();
        setStatus("滤镜：" + filterName(id) + "（再点不变，点其他滤镜替换）");
    }

    /** 取消滤镜，回到无滤镜状态（可撤销）。 */
    public void clearFilter() {
        if (!editor.hasImage()) return;
        if (!editor.clearFilter()) return;
        syncUIFromEngine();
        setStatus("已取消滤镜");
    }

    /** 滤镜强度拖动中：只改数值实时预览，不动历史栈；松手由 checkpoint() 记检查点。 */
    public void setFilterStrengthLive(double strength) {
        if (!editor.hasImage() || editor.activeFilter() == null) return;
        editor.setFilterStrengthLive(strength);
        refreshView();
    }

    private static String filterName(String id) {
        for (Filters.Def d : Filters.all()) if (d.id.equals(id)) return d.name;
        return id;
    }

    /** 把文字对象连同当前调节/曲线一起烘焙进底图并提交（对象列表随之清空）。 */
    public void rasterizeTexts() {
        if (!editor.hasImage() || editor.texts().isEmpty()) { setStatus("没有可栅格化的文字"); return; }
        editor.commitTexts();
        afterStateChange(false);
        setStatus("文字已栅格化到图像");
    }

    /** 当前完整效果的合成图（底图+调节+曲线+文字），保存/导出用。 */
    public BufferedImage composite() {
        return editor.bakeCurrent();
    }

    // ---------- 历史与视图同步 ----------
    public void undo() {
        if (!editor.undo()) return;
        afterStateChange(false);
        setStatus("已撤销");
    }

    public void redo() {
        if (!editor.redo()) return;
        afterStateChange(false);
        setStatus("已重做");
    }

    private void updateHistoryButtons() {
        undoBtn.setEnabled(editor.canUndo());
        redoBtn.setEnabled(editor.canRedo());
    }

    /** 按引擎当前状态重画画布（管线合成图）+ 直方图 + 历史按钮 + 信息栏。滑杆/曲线拖动时高频调用。 */
    public void refreshView() {
        if (!editor.hasImage()) {
            canvas.setImage(null);
            updateHistoryButtons();
            updateInfo();
            return;
        }
        BufferedImage view = editor.renderView();
        canvas.setImage(view);
        canvas.setCoordSize(editor.base().getWidth(), editor.base().getHeight());
        canvas.setOriginal(originalImage);
        histogramPanel.refresh(view);
        updateHistoryButtons();
        updateInfo();
    }

    /** 引擎状态被离散操作/撤销/重做/载入改变后：同步全部 UI（滑杆、曲线、文字列表、滤镜缩略图）。 */
    private void afterStateChange(boolean fit) {
        canvas.setOverlayImage(null);
        syncUIFromEngine();
        filtersPanel.refreshThumbs(false);
        if (fit) canvas.fitZoom();
    }

    /** 把引擎里的参数/曲线/文字/滤镜回填到各面板——撤销后滑杆数值、曲线点、文字、当前滤镜能原样回来靠这里。 */
    private void syncUIFromEngine() {
        adjustPanel.syncFromParams(editor.params());
        curvesPanel.refreshFromEngine();
        textPanel.refreshList();
        filtersPanel.syncFromEngine();
        refreshView();
    }

    /** 调节检查点（滑杆松手/曲线拖完/重置时调用）：把上个安定状态记入撤销栈。 */
    public void checkpoint() {
        if (editor.checkpointAdjust()) updateHistoryButtons();
    }

    /** 重置全部待生效调节（参数+曲线归零）；重置本身记检查点，可撤销回来。 */
    public void resetAllAdjustments() {
        if (!editor.hasImage()) return;
        editor.resetAdjust();
        syncUIFromEngine();
        checkpoint();
        setStatus("已重置全部调节（可撤销恢复）");
    }

    private void updateInfo() {
        if (!editor.hasImage()) { infoLabel.setText(""); return; }
        infoLabel.setText(String.format("%s · %d×%d · 缩放 %.0f%%",
                fileName, editor.base().getWidth(), editor.base().getHeight(), canvas.getZoom() * 100));
    }

    // ---------- 文件操作 ----------
    private void openFile() {
        JFileChooser fc = new JFileChooser();
        fc.setFileFilter(new FileNameExtensionFilter("图片文件", "png", "jpg", "jpeg", "bmp", "gif", "tiff", "tif", "ppm", "pgm"));
        if (fc.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File f = fc.getSelectedFile();
        try {
            BufferedImage img = Formats.load(f);
            editor.setFreshImage(img);
            originalImage = img;
            fileName = f.getName();
            canvas.clearCrop();
            canvas.clearCutout();
            canvas.clearPerspective();
            afterStateChange(true);
            setStatus("已打开 " + f.getName());
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "打开失败：" + ex.getMessage(), "喵图", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void saveFile() {
        if (!editor.hasImage()) { setStatus("先打开一张图片"); return; }
        JFileChooser fc = new JFileChooser();
        fc.setSelectedFile(new File(fileName.isEmpty() ? "meowtu.png" : fileName));
        if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File f = fc.getSelectedFile();
        String fmt = Formats.extension(f);
        if (!List.of(Formats.SAVE_FORMATS).contains(fmt)) {
            fmt = "png";
            f = new File(f.getParentFile(), f.getName() + ".png");
        }
        try {
            Formats.save(f, composite(), fmt, 0.92f, 100);
            fileName = f.getName();
            updateInfo();
            setStatus("已保存 " + f.getName());
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "保存失败：" + ex.getMessage(), "喵图", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void exportFile() {
        if (!editor.hasImage()) { setStatus("先打开一张图片"); return; }
        JPanel p = new JPanel(new GridLayout(3, 2, 6, 6));
        JComboBox<String> fmtBox = new JComboBox<>(Formats.SAVE_FORMATS);
        JSlider q = new JSlider(10, 100, 92);
        JSpinner scale = new JSpinner(new SpinnerNumberModel(100, 5, 400, 5));
        p.add(new JLabel("格式")); p.add(fmtBox);
        p.add(new JLabel("JPEG 质量")); p.add(q);
        p.add(new JLabel("缩放 %")); p.add(scale);
        if (JOptionPane.showConfirmDialog(this, p, "导出选项", JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) return;
        JFileChooser fc = new JFileChooser();
        String fmt = (String) fmtBox.getSelectedItem();
        fc.setSelectedFile(new File("meowtu-export." + fmt));
        if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
        try {
            Formats.save(fc.getSelectedFile(), composite(), fmt, q.getValue() / 100f, (Integer) scale.getValue());
            setStatus("已导出 " + fc.getSelectedFile().getName());
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "导出失败：" + ex.getMessage(), "喵图", JOptionPane.ERROR_MESSAGE);
        }
    }

    /** 生成一张色彩丰富的示例图，方便无图时体验全部功能。 */
    private void makeSampleImage() {
        int w = 960, h = 640;
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        GradientPaint sky = new GradientPaint(0, 0, new Color(0x7EC8E3), 0, h * 2 / 3, new Color(0xF7E8C3));
        g.setPaint(sky);
        g.fillRect(0, 0, w, h);
        g.setColor(new Color(0xFFD93D));
        g.fillOval(w - 220, 60, 110, 110);
        g.setColor(new Color(0x5B8C5A));
        g.fillPolygon(new int[]{0, 260, 520}, new int[]{430, 210, 430}, 3);
        g.setColor(new Color(0x49744A));
        g.fillPolygon(new int[]{300, 560, 820}, new int[]{440, 240, 440}, 3);
        g.setColor(new Color(0x77B255));
        g.fillRect(0, 430, w, h - 430);
        g.setColor(new Color(0xE5534B));
        g.fillOval(120, 460, 90, 90);
        g.setColor(new Color(0x4A9EFF));
        g.fillOval(240, 480, 60, 60);
        g.setColor(new Color(255, 255, 255, 200));
        g.fillOval(80, 90, 150, 44);
        g.fillOval(150, 70, 110, 40);
        g.dispose();
        editor.setFreshImage(img);
        originalImage = img;
        fileName = "示例图.png";
        afterStateChange(true);
        setStatus("示例图已生成，可以开始试用各功能");
    }
}
