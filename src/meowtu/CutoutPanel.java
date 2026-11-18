package meowtu;

import meowtu.core.Formats;
import meowtu.core.Img;
import meowtu.grabcut.GrabCut;

import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 抠图面板：矩形框选主体 → GrabCut 图割 →（可选）前景/背景画笔修补后重算 →
 * 透明预览/换背景预览 → 应用为当前图或导出透明 PNG。
 */
public class CutoutPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final JLabel status = new JLabel("先点「框选主体」，在画布上拖出矩形");
    private BufferedImage resultImage;   // 带 alpha 的抠图结果（原图尺寸）
    private Color bgColor;               // null=透明预览

    public CutoutPanel(MainFrame frame) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        JPanel body = new JPanel();
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setOpaque(false);

        status.setForeground(meowtu.flatui.FlatTheme.TEXT_DIM);
        status.setFont(status.getFont().deriveFont(12f));
        body.add(status);
        body.add(Box.createVerticalStrut(6));

        ButtonGroup group = new ButtonGroup();
        JPanel tools = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        tools.setOpaque(false);
        JToggleButton rectBtn = toolBtn("框选主体", group, () -> frame.setTool(CanvasPanel.Tool.CUTOUT_RECT));
        JToggleButton fgBtn = toolBtn("补前景笔", group, () -> frame.setTool(CanvasPanel.Tool.CUTOUT_FG));
        JToggleButton bgBtn = toolBtn("补背景笔", group, () -> frame.setTool(CanvasPanel.Tool.CUTOUT_BG));
        rectBtn.setSelected(true);
        tools.add(rectBtn); tools.add(fgBtn); tools.add(bgBtn);
        body.add(tools);
        body.add(leftRow(btn("清除框与画笔", () -> { frame.canvas().clearCutout(); resultImage = null; })));

        JButton run = new JButton("执行抠图");
        run.putClientProperty("flat.primary", Boolean.TRUE);
        run.addActionListener(e -> runCutout());
        body.add(leftRow(run));
        JLabel tip = new JLabel("框不准或边缘有误时，用画笔在错处涂抹后再次执行");
        tip.setForeground(meowtu.flatui.FlatTheme.TEXT_FAINT);
        tip.setFont(tip.getFont().deriveFont(11f));
        body.add(tip);
        body.add(Box.createVerticalStrut(8));

        body.add(meowtu.flatui.FlatWidgets.section("预览背景"));
        JPanel bgRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        bgRow.setOpaque(false);
        bgRow.add(btn("透明", () -> { bgColor = null; showPreview(); }));
        bgRow.add(btn("白色", () -> { bgColor = Color.WHITE; showPreview(); }));
        bgRow.add(btn("黑色", () -> { bgColor = Color.BLACK; showPreview(); }));
        bgRow.add(btn("蓝色", () -> { bgColor = new Color(0x4A9EFF); showPreview(); }));
        bgRow.add(btn("自选…", () -> {
            Color c = JColorChooser.showDialog(this, "选择背景色", Color.WHITE);
            if (c != null) { bgColor = c; showPreview(); }
        }));
        body.add(bgRow);
        body.add(Box.createVerticalStrut(8));

        JPanel acts = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        acts.setOpaque(false);
        JButton apply = new JButton("应用为当前图");
        apply.addActionListener(e -> {
            if (resultImage == null) { frame.setStatus("还没有抠图结果"); return; }
            frame.canvas().setOverlayImage(null);
            frame.applyCommitted(Img.copy(resultImage), "抠图");
        });
        JButton export = new JButton("导出透明 PNG");
        export.addActionListener(e -> exportPng());
        acts.add(apply); acts.add(export);
        body.add(acts);

        add(body, BorderLayout.NORTH);
    }

    private JToggleButton toolBtn(String text, ButtonGroup g, Runnable r) {
        JToggleButton b = new JToggleButton(text);
        g.add(b);
        b.addActionListener(e -> { if (frame.hasImage()) r.run(); });
        return b;
    }

    private JButton btn(String text, Runnable r) {
        JButton b = new JButton(text);
        b.addActionListener(e -> r.run());
        return b;
    }

    private JPanel leftRow(JComponent c) {
        JPanel p = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        p.setOpaque(false);
        p.add(c);
        return p;
    }

    /** 执行 GrabCut：降采样算蒙版 → 放大 alpha → 合成结果。 */
    private void runCutout() {
        if (!frame.hasImage()) { frame.setStatus("先打开一张图片"); return; }
        Rectangle rect = frame.canvas().getCutoutRect();
        if (rect == null) { frame.setStatus("还没有框选：先在画布上拖出主体矩形"); return; }
        BufferedImage base = frame.baseImage();
        status.setText("抠图计算中…（大图会先缩小计算）");
        frame.setStatus("抠图计算中…");
        new SwingWorker<BufferedImage, Void>() {
            @Override protected BufferedImage doInBackground() {
                BufferedImage small = Img.downscale(base, 460);
                double fx = (double) small.getWidth() / base.getWidth();
                double fy = (double) small.getHeight() / base.getHeight();
                Rectangle sr = new Rectangle(
                        (int) (rect.x * fx), (int) (rect.y * fy),
                        Math.max(2, (int) (rect.width * fx)), Math.max(2, (int) (rect.height * fy)));
                List<Point> fg = scalePoints(frame.canvas().getFgStrokes(), fx, fy);
                List<Point> bg = scalePoints(frame.canvas().getBgStrokes(), fx, fy);
                int[] alphaSmall = GrabCut.alpha(small, sr, fg, bg, 3);
                // alpha 放大到原图尺寸
                BufferedImage aImg = new BufferedImage(small.getWidth(), small.getHeight(), BufferedImage.TYPE_INT_ARGB);
                int[] ap = new int[alphaSmall.length];
                for (int i = 0; i < ap.length; i++) ap[i] = (alphaSmall[i] << 24) | 0xFFFFFF;
                aImg.setRGB(0, 0, small.getWidth(), small.getHeight(), ap, 0, small.getWidth());
                BufferedImage aFull = Img.resize(aImg, base.getWidth(), base.getHeight());
                int[] basePx = Img.pixels(base);
                int[] alphaPx = Img.pixels(aFull);
                for (int i = 0; i < basePx.length; i++) {
                    int a = alphaPx[i] >>> 24;
                    basePx[i] = (a << 24) | (basePx[i] & 0xFFFFFF);
                }
                return Img.fromPixels(base.getWidth(), base.getHeight(), basePx);
            }

            @Override protected void done() {
                try {
                    resultImage = get();
                    status.setText("抠图完成：可换背景预览、应用或导出");
                    frame.setStatus("抠图完成");
                    showPreview();
                } catch (Exception ex) {
                    status.setText("抠图失败：" + ex.getCause());
                    frame.setStatus("抠图失败");
                }
            }
        }.execute();
    }

    private List<Point> scalePoints(List<List<Point>> strokes, double fx, double fy) {
        List<Point> out = new ArrayList<>();
        for (List<Point> stroke : strokes) {
            // 采样：每隔几个点取一个即可代表笔画
            for (int i = 0; i < stroke.size(); i += 2) {
                Point p = stroke.get(i);
                out.add(new Point((int) (p.x * fx), (int) (p.y * fy)));
            }
        }
        return out;
    }

    private void showPreview() {
        if (resultImage == null) return;
        if (bgColor == null) {
            frame.canvas().setOverlayImage(resultImage);
        } else {
            BufferedImage comp = new BufferedImage(resultImage.getWidth(), resultImage.getHeight(), BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = comp.createGraphics();
            g.setColor(bgColor);
            g.fillRect(0, 0, comp.getWidth(), comp.getHeight());
            g.drawImage(resultImage, 0, 0, null);
            g.dispose();
            frame.canvas().setOverlayImage(comp);
        }
    }

    private void exportPng() {
        if (resultImage == null) { frame.setStatus("还没有抠图结果"); return; }
        JFileChooser fc = new JFileChooser();
        fc.setSelectedFile(new File("meowtu-cutout.png"));
        if (fc.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
            try {
                Formats.save(fc.getSelectedFile(), resultImage, "png", 1f, 100);
                frame.setStatus("已导出透明 PNG：" + fc.getSelectedFile().getName());
            } catch (Exception ex) {
                frame.setStatus("导出失败：" + ex.getMessage());
            }
        }
    }
}
