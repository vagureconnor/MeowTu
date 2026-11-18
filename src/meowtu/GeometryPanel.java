package meowtu;

import meowtu.core.Geometry;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;
import java.awt.geom.Point2D;
import java.awt.image.BufferedImage;
import java.util.List;

/** 几何面板：旋转/翻转/裁剪/透视/畸变扭曲，全部即时作用于当前图并入撤销栈。 */
public class GeometryPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final FlatWidgets.SliderRow angleRow, lensRow, waveRow, swirlRow;
    private final JComboBox<String> ratioBox = new JComboBox<>(new String[]{"自由", "1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16"});
    private final JCheckBox waveVertical = new JCheckBox("波纹竖直传播", false);

    public GeometryPanel(MainFrame frame) {
        super(new BorderLayout());
        this.frame = frame;
        setOpaque(false);
        JPanel body = new TrackPanel();
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setOpaque(false);
        body.setBorder(BorderFactory.createEmptyBorder(4, 8, 8, 8));

        body.add(FlatWidgets.section("旋转与翻转"));
        JPanel rotRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        rotRow.setOpaque(false);
        rotRow.add(btn("左旋 90°", () -> apply(Geometry.rotate90(frame.baseImage(), false), "左旋90°")));
        rotRow.add(btn("右旋 90°", () -> apply(Geometry.rotate90(frame.baseImage(), true), "右旋90°")));
        rotRow.add(btn("水平翻转", () -> apply(Geometry.flipH(frame.baseImage()), "水平翻转")));
        rotRow.add(btn("垂直翻转", () -> apply(Geometry.flipV(frame.baseImage()), "垂直翻转")));
        body.add(rotRow);
        angleRow = new FlatWidgets.SliderRow("角度", -180, 180, 0, 1);
        body.add(angleRow);
        body.add(leftRow(btn("应用任意角度旋转", () -> {
            if (angleRow.value() != 0) apply(Geometry.rotate(frame.baseImage(), angleRow.value()), "旋转");
        })));

        body.add(FlatWidgets.section("裁剪"));
        JPanel cropRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        cropRow.setOpaque(false);
        cropRow.add(new JLabel("比例"));
        cropRow.add(ratioBox);
        cropRow.add(btn("开始框选", () -> {
            frame.setTool(CanvasPanel.Tool.CROP);
            frame.canvas().setCropAspect(aspect());
            frame.setStatus("在画布上拖出裁剪框，再点「应用裁剪」");
        }));
        body.add(cropRow);
        ratioBox.addActionListener(e -> frame.canvas().setCropAspect(aspect()));
        JPanel cropBtns = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        cropBtns.setOpaque(false);
        cropBtns.add(btn("应用裁剪", () -> {
            Rectangle r = frame.canvas().getCropRect();
            if (r == null) { frame.setStatus("还没有裁剪框：先在画布上拖出选框"); return; }
            apply(Geometry.crop(frame.baseImage(), r), "裁剪");
            frame.canvas().clearCrop();
        }));
        cropBtns.add(btn("取消选框", () -> frame.canvas().clearCrop()));
        body.add(cropBtns);

        body.add(FlatWidgets.section("透视矫正"));
        JPanel perspRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        perspRow.setOpaque(false);
        perspRow.add(btn("点选四角", () -> {
            frame.canvas().clearPerspective();
            frame.setTool(CanvasPanel.Tool.PERSPECTIVE);
            frame.setStatus("依次点击要矫正区域的四角：左上、右上、右下、左下");
        }));
        perspRow.add(btn("执行矫正", () -> {
            List<Point> pts = frame.canvas().getPerspectivePoints();
            if (pts.size() != 4) { frame.setStatus("透视点不足 4 个（当前 " + pts.size() + " 个）"); return; }
            Point2D[] quad = new Point2D[4];
            for (int i = 0; i < 4; i++) quad[i] = new Point2D.Double(pts.get(i).x, pts.get(i).y);
            apply(Geometry.perspective(frame.baseImage(), quad), "透视矫正");
            frame.canvas().clearPerspective();
        }));
        perspRow.add(btn("清除点", () -> frame.canvas().clearPerspective()));
        body.add(perspRow);

        body.add(FlatWidgets.section("畸变与扭曲"));
        lensRow = new FlatWidgets.SliderRow("畸变", -100, 100, 0, 1);
        body.add(lensRow);
        body.add(leftRow(btn("应用畸变（正=桶形 负=枕形）", () -> {
            if (lensRow.value() != 0) apply(Geometry.lensDistort(frame.baseImage(), lensRow.value() / 100.0), "畸变");
        })));
        waveRow = new FlatWidgets.SliderRow("波浪", 0, 40, 12, 1);
        body.add(waveRow);
        JPanel waveOpt = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        waveOpt.setOpaque(false);
        waveVertical.setOpaque(false);
        waveOpt.add(waveVertical);
        waveOpt.add(btn("应用波浪", () -> {
            if (waveRow.value() != 0) apply(Geometry.wave(frame.baseImage(), waveRow.value(), 130, waveVertical.isSelected()), "波浪");
        }));
        body.add(waveOpt);
        swirlRow = new FlatWidgets.SliderRow("旋涡", -100, 100, 0, 1);
        body.add(swirlRow);
        body.add(leftRow(btn("应用旋涡", () -> {
            if (swirlRow.value() != 0) apply(Geometry.swirl(frame.baseImage(), swirlRow.value() / 100.0 * 2.6), "旋涡");
        })));

        JScrollPane sp = new JScrollPane(body);
        sp.setBorder(BorderFactory.createEmptyBorder());
        sp.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        sp.getVerticalScrollBar().setUnitIncrement(16);
        add(sp, BorderLayout.CENTER);
    }

    private double aspect() {
        String s = (String) ratioBox.getSelectedItem();
        if (s == null || s.equals("自由")) return 0;
        String[] parts = s.split(":");
        return Double.parseDouble(parts[0]) / Double.parseDouble(parts[1]);
    }

    private JButton btn(String text, Runnable r) {
        JButton b = new JButton(text);
        b.addActionListener(e -> { if (frame.hasImage()) r.run(); else frame.setStatus("先打开一张图片"); });
        return b;
    }

    private JPanel leftRow(JComponent c) {
        JPanel p = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        p.setOpaque(false);
        p.add(c);
        return p;
    }

    private void apply(BufferedImage img, String label) {
        if (img != null) frame.applyCommitted(img, label);
    }
}
