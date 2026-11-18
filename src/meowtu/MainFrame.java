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
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * 主窗口：顶栏（LOGO+文件/历史/对比）｜左工具栏｜中央画布｜右侧标签页面板｜底状态栏。
 * 持有当前图、原图、撤销/重做栈、文字对象与各编辑会话（调节/曲线/滤镜预览）。
 */
public class MainFrame extends JFrame {
    private static final long serialVersionUID = 1L;
    public static final int TAB_ADJUST = 0, TAB_CURVES = 1, TAB_FILTERS = 2, TAB_GEOMETRY = 3,
            TAB_HISTOGRAM = 4, TAB_TEXT = 5, TAB_CUTOUT = 6;

    private final CanvasPanel canvas = new CanvasPanel();
    private final JTabbedPane tabs = new JTabbedPane(JTabbedPane.TOP, JTabbedPane.SCROLL_TAB_LAYOUT);
    private final JLabel statusLabel = new JLabel("就绪");
    private final JLabel infoLabel = new JLabel("");
    private final JButton undoBtn = new JButton("撤销", FlatIcons.undo(16));
    private final JButton redoBtn = new JButton("重做", FlatIcons.redo(16));

    private BufferedImage baseImage;
    private BufferedImage originalImage;
    private String fileName = "";
    private final Deque<BufferedImage> undoStack = new ArrayDeque<>();
    private final Deque<BufferedImage> redoStack = new ArrayDeque<>();
    private static final int HISTORY_MAX = 20;

    private final List<TextObject> textObjects = new ArrayList<>();
    private final Curves curves = new Curves();

    // 编辑会话（预览基于会话开始时的图，提交时全图应用）
    private BufferedImage adjustBase, adjustPreviewSrc;
    private BufferedImage curvesBase, curvesPreviewSrc;
    private BufferedImage filterPreviewSrc;

    private AdjustPanel adjustPanel;
    private CurvesPanel curvesPanel;
    private FiltersPanel filtersPanel;
    private HistogramPanel histogramPanel;
    private TextPanel textPanel;
    private final JToggleButton[] toolButtons = new JToggleButton[5];

    public MainFrame() {
        super("喵图 MeowTu");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(1320, 840);
        setMinimumSize(new Dimension(980, 620));
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
        canvas.setTextObjects(textObjects);
        updateHistoryButtons();
    }

    private void loadWindowIcon() {
        try (InputStream in = getClass().getResourceAsStream("/meowtu-logo-final.png")) {
            if (in != null) setIconImage(ImageIO.read(in));
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
        JPanel root = new JPanel(new BorderLayout());
        root.setBackground(FlatTheme.BG);
        root.add(buildTopBar(), BorderLayout.NORTH);
        root.add(buildToolBar(), BorderLayout.WEST);
        canvas.setBorder(BorderFactory.createEmptyBorder());
        root.add(canvas, BorderLayout.CENTER);
        root.add(buildRightPanel(), BorderLayout.EAST);
        root.add(buildStatusBar(), BorderLayout.SOUTH);
        setContentPane(root);
    }

    private JPanel buildTopBar() {
        JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 6));
        bar.setBackground(FlatTheme.BG_PANEL);
        try (InputStream in = getClass().getResourceAsStream("/meowtu-logo-final.png")) {
            if (in != null) {
                java.awt.image.BufferedImage logo = ImageIO.read(in);
                int h = 30;
                int w = Math.max(1, (int) Math.round(h * (double) logo.getWidth() / logo.getHeight()));
                ImageIcon icon = new ImageIcon(logo.getScaledInstance(w, h, Image.SCALE_SMOOTH));
                bar.add(new JLabel(icon));
            }
        } catch (Exception ignored) { }
        JLabel title = new JLabel("喵图 MeowTu");
        title.setFont(title.getFont().deriveFont(Font.BOLD, 15f));
        title.setForeground(FlatTheme.TEXT);
        bar.add(title);
        bar.add(sep());
        bar.add(topBtn("打开", FlatIcons.open(16), e -> openFile()));
        bar.add(topBtn("保存", FlatIcons.save(16), e -> saveFile()));
        bar.add(topBtn("导出", FlatIcons.exportIcon(16), e -> exportFile()));
        bar.add(topBtn("示例图", FlatIcons.image(16), e -> makeSampleImage()));
        bar.add(sep());
        undoBtn.setIcon(FlatIcons.undo(16));
        undoBtn.addActionListener(e -> undo());
        redoBtn.addActionListener(e -> redo());
        bar.add(undoBtn);
        bar.add(redoBtn);
        bar.add(sep());
        JLabel cmpLab = new JLabel("对比");
        cmpLab.setForeground(FlatTheme.TEXT_DIM);
        bar.add(cmpLab);
        JComboBox<String> cmp = new JComboBox<>(new String[]{"不对比", "左右分屏", "滑块擦除", "长按原图"});
        cmp.addActionListener(e -> {
            CanvasPanel.Compare mode = switch (cmp.getSelectedIndex()) {
                case 1 -> CanvasPanel.Compare.SPLIT;
                case 2 -> CanvasPanel.Compare.SLIDE;
                case 3 -> CanvasPanel.Compare.HOLD;
                default -> CanvasPanel.Compare.OFF;
            };
            canvas.setCompare(mode);
            if (mode == CanvasPanel.Compare.HOLD) setStatus("在画布上按住鼠标即可查看原图");
        });
        bar.add(cmp);
        JButton fit = new JButton("适配窗口");
        fit.addActionListener(e -> canvas.fitZoom());
        bar.add(fit);
        return bar;
    }

    private JButton topBtn(String text, Icon icon, java.awt.event.ActionListener l) {
        JButton b = new JButton(text, icon);
        b.addActionListener(l);
        return b;
    }

    private JSeparator sep() {
        JSeparator s = new JSeparator(SwingConstants.VERTICAL);
        s.setPreferredSize(new Dimension(5, 22));
        return s;
    }

    private JPanel buildToolBar() {
        JPanel bar = new JPanel();
        bar.setLayout(new BoxLayout(bar, BoxLayout.Y_AXIS));
        bar.setBackground(FlatTheme.BG);
        bar.setBorder(BorderFactory.createEmptyBorder(6, 4, 6, 4));
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
            bar.add(Box.createVerticalStrut(4));
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
        tabs.addTab("调节", adjustPanel);
        tabs.addTab("曲线", curvesPanel);
        tabs.addTab("滤镜", filtersPanel);
        tabs.addTab("几何", new GeometryPanel(this));
        tabs.addTab("直方图", histogramPanel);
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
    public boolean hasImage() { return baseImage != null; }
    public BufferedImage baseImage() { return baseImage; }
    public CanvasPanel canvas() { return canvas; }
    public Curves curves() { return curves; }
    public List<TextObject> textObjects() { return textObjects; }

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

    /** 通用提交：把结果图设为当前图并入撤销栈。 */
    public void applyCommitted(BufferedImage img, String label) {
        commitImage(img);
        setStatus(label + " 已应用");
    }

    public void clearPreview() {
        adjustBase = null; curvesBase = null;
        if (baseImage != null) canvas.setImage(baseImage);
    }

    // 调节会话
    public void previewAdjust(AdjustParams p) {
        if (baseImage == null) return;
        if (adjustBase == null) {
            adjustBase = baseImage;
            adjustPreviewSrc = Img.downscale(baseImage, 1100);
        }
        canvas.setImage(LutEngine.apply(adjustPreviewSrc, p));
    }

    public boolean commitAdjust(AdjustParams p) {
        if (baseImage == null) return false;
        if (adjustBase == null) adjustBase = baseImage;
        BufferedImage src = adjustBase;
        adjustBase = null; adjustPreviewSrc = null;
        if (p.isIdentity()) { canvas.setImage(baseImage); return false; }
        commitImage(LutEngine.apply(src, p));
        setStatus("调节已应用");
        return true;
    }

    // 曲线会话
    public void previewCurves() {
        if (baseImage == null) return;
        if (curvesBase == null) {
            curvesBase = baseImage;
            curvesPreviewSrc = Img.downscale(baseImage, 1100);
        }
        canvas.setImage(curves.apply(curvesPreviewSrc));
    }

    public void commitCurves() {
        if (baseImage == null) return;
        if (curvesBase == null) curvesBase = baseImage;
        BufferedImage src = curvesBase;
        curvesBase = null; curvesPreviewSrc = null;
        if (curves.isIdentity()) { canvas.setImage(baseImage); return; }
        BufferedImage img = curves.apply(src);
        curves.reset();
        curvesPanel.repaint();
        commitImage(img);
        setStatus("曲线已应用");
    }

    // 滤镜会话
    public void previewFilter(String id, double strength) {
        if (baseImage == null) return;
        if (filterPreviewSrc == null) filterPreviewSrc = Img.downscale(baseImage, 1100);
        canvas.setImage(Filters.apply(id, filterPreviewSrc, strength));
    }

    public void commitFilter(String id, double strength) {
        if (baseImage == null) return;
        commitImage(Filters.apply(id, baseImage, strength));
        setStatus("滤镜已应用");
    }

    /** 把文字对象画到当前图上并提交（对象列表随之清空）。 */
    public void rasterizeTexts() {
        if (baseImage == null || textObjects.isEmpty()) { setStatus("没有可栅格化的文字"); return; }
        BufferedImage comp = composite();
        textObjects.clear();
        textPanel.refreshList();
        commitImage(comp);
        setStatus("文字已栅格化到图像");
    }

    /** 当前图 + 文字对象的合成图（不改状态），保存/导出用。 */
    public BufferedImage composite() {
        if (baseImage == null) return null;
        if (textObjects.isEmpty()) return baseImage;
        BufferedImage comp = Img.copy(baseImage);
        Graphics2D g = comp.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        for (TextObject t : textObjects) t.render(g);
        g.dispose();
        return comp;
    }

    // ---------- 历史 ----------
    private void commitImage(BufferedImage img) {
        if (baseImage != null) {
            undoStack.push(baseImage);
            while (undoStack.size() > HISTORY_MAX) undoStack.removeLast();
        }
        redoStack.clear();
        baseImage = img;
        afterImageChange(false);
    }

    public void undo() {
        if (undoStack.isEmpty()) return;
        redoStack.push(baseImage);
        baseImage = undoStack.pop();
        afterImageChange(false);
        setStatus("已撤销");
    }

    public void redo() {
        if (redoStack.isEmpty()) return;
        undoStack.push(baseImage);
        baseImage = redoStack.pop();
        afterImageChange(false);
        setStatus("已重做");
    }

    private void updateHistoryButtons() {
        undoBtn.setEnabled(!undoStack.isEmpty());
        redoBtn.setEnabled(!redoStack.isEmpty());
    }

    private void afterImageChange(boolean fit) {
        adjustBase = null; curvesBase = null; filterPreviewSrc = null;
        canvas.setOverlayImage(null);
        canvas.setImage(baseImage);
        canvas.setOriginal(originalImage);
        if (fit) canvas.fitZoom();
        histogramPanel.refresh(baseImage);
        filtersPanel.refreshThumbs(false);
        updateHistoryButtons();
        updateInfo();
    }

    private void updateInfo() {
        if (baseImage == null) { infoLabel.setText(""); return; }
        infoLabel.setText(String.format("%s · %d×%d · 缩放 %.0f%%",
                fileName, baseImage.getWidth(), baseImage.getHeight(), canvas.getZoom() * 100));
    }

    // ---------- 文件操作 ----------
    private void openFile() {
        JFileChooser fc = new JFileChooser();
        fc.setFileFilter(new FileNameExtensionFilter("图片文件", "png", "jpg", "jpeg", "bmp", "gif", "tiff", "tif", "ppm", "pgm"));
        if (fc.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File f = fc.getSelectedFile();
        try {
            BufferedImage img = Formats.load(f);
            baseImage = img;
            originalImage = img;
            fileName = f.getName();
            undoStack.clear(); redoStack.clear();
            textObjects.clear();
            textPanel.refreshList();
            canvas.clearCrop();
            canvas.clearCutout();
            canvas.clearPerspective();
            curves.reset();
            afterImageChange(true);
            setStatus("已打开 " + f.getName());
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "打开失败：" + ex.getMessage(), "喵图", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void saveFile() {
        if (baseImage == null) { setStatus("先打开一张图片"); return; }
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
        if (baseImage == null) { setStatus("先打开一张图片"); return; }
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
        baseImage = img;
        originalImage = img;
        fileName = "示例图.png";
        undoStack.clear(); redoStack.clear();
        textObjects.clear();
        textPanel.refreshList();
        afterImageChange(true);
        setStatus("示例图已生成，可以开始试用各功能");
    }
}
