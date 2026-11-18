package meowtu;

import meowtu.core.AdjustParams;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;

/** 调节面板：13 个参数滑杆，拖动实时预览，松手自动应用（并入撤销栈）。 */
public class AdjustPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private JPanel body;
    private final FlatWidgets.SliderRow exposure, brightness, contrast, temperature, tint;
    private final FlatWidgets.SliderRow saturation, vibrance, highlights, shadows, whites, blacks;
    private final FlatWidgets.SliderRow clarity, sharpen;
    private boolean syncing;

    public AdjustPanel(MainFrame frame) {
        super(new BorderLayout());
        this.frame = frame;
        setOpaque(false);
        body = new TrackPanel();
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setOpaque(false);

        exposure = row(body, "曝光", -30, 30, 0.1);
        brightness = row(body, "亮度", -100, 100, 1);
        contrast = row(body, "对比度", -100, 100, 1);
        temperature = row(body, "色温", -100, 100, 1);
        tint = row(body, "色调", -100, 100, 1);
        body.add(FlatWidgets.section("颜色"));
        saturation = row(body, "饱和度", -100, 100, 1);
        vibrance = row(body, "自然饱和", -100, 100, 1);
        body.add(FlatWidgets.section("影调"));
        highlights = row(body, "高光", -100, 100, 1);
        shadows = row(body, "阴影", -100, 100, 1);
        whites = row(body, "白色", -100, 100, 1);
        blacks = row(body, "黑色", -100, 100, 1);
        body.add(FlatWidgets.section("细节"));
        clarity = row(body, "清晰度", -100, 100, 1);
        sharpen = row(body, "锐化", 0, 100, 1);

        JButton reset = new JButton("重置全部");
        reset.addActionListener(e -> { resetRows(); frame.clearPreview(); });
        JPanel btnRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 4));
        btnRow.setOpaque(false);
        btnRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        btnRow.add(reset);
        body.add(btnRow);
        JLabel hint = new JLabel("拖动预览 · 松手应用 · 双击名称重置单项");
        hint.setAlignmentX(Component.LEFT_ALIGNMENT);
        hint.setForeground(meowtu.flatui.FlatTheme.TEXT_FAINT);
        hint.setFont(hint.getFont().deriveFont(11f));
        hint.setBorder(BorderFactory.createEmptyBorder(0, 4, 4, 0));
        body.add(hint);

        JScrollPane sp = new JScrollPane(body);
        sp.setBorder(BorderFactory.createEmptyBorder());
        sp.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        sp.getVerticalScrollBar().setUnitIncrement(16);
        add(sp, BorderLayout.CENTER);
    }

    /** 把其它面板以「分区」形式并入调节页（曲线、直方图），共用同一条滚动列。 */
    public void addSection(String title, JComponent comp) {
        body.add(FlatWidgets.section(title));
        comp.setAlignmentX(Component.LEFT_ALIGNMENT);
        Dimension pref = comp.getPreferredSize();
        comp.setMaximumSize(new Dimension(Integer.MAX_VALUE, pref.height + 48));
        body.add(comp);
    }

    private FlatWidgets.SliderRow row(JPanel body, String name, int min, int max, double scale) {
        FlatWidgets.SliderRow r = new FlatWidgets.SliderRow(name, min, max, 0, scale);
        r.setAlignmentX(Component.LEFT_ALIGNMENT);
        r.setMaximumSize(new Dimension(Integer.MAX_VALUE, 30));
        r.slider.addChangeListener(e -> onChange(r));
        body.add(r);
        return r;
    }

    private void onChange(FlatWidgets.SliderRow src) {
        if (syncing || !frame.hasImage()) return;
        AdjustParams p = collect();
        if (src.slider.getValueIsAdjusting()) {
            frame.previewAdjust(p);
        } else {
            boolean committed = frame.commitAdjust(p);
            if (committed) resetRows();
        }
    }

    private AdjustParams collect() {
        AdjustParams p = new AdjustParams();
        p.exposure = exposure.value();
        p.brightness = brightness.value();
        p.contrast = contrast.value();
        p.temperature = temperature.value();
        p.tint = tint.value();
        p.saturation = saturation.value();
        p.vibrance = vibrance.value();
        p.highlights = highlights.value();
        p.shadows = shadows.value();
        p.whites = whites.value();
        p.blacks = blacks.value();
        p.clarity = clarity.value();
        p.sharpen = sharpen.value();
        return p;
    }

    public void resetRows() {
        syncing = true;
        for (FlatWidgets.SliderRow r : new FlatWidgets.SliderRow[]{exposure, brightness, contrast, temperature, tint,
                saturation, vibrance, highlights, shadows, whites, blacks, clarity, sharpen}) {
            r.setValueSilently(0);
        }
        syncing = false;
    }
}
