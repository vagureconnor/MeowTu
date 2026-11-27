package meowtu;

import meowtu.core.AdjustParams;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;

/** 调节面板：13 个参数滑杆。数值常驻即效果（引擎持有参数、实时合成），松手记一个撤销检查点。 */
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
        reset.addActionListener(e -> frame.resetAllAdjustments());
        JPanel btnRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 4));
        btnRow.setOpaque(false);
        btnRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        btnRow.add(reset);
        body.add(btnRow);
        JLabel hint = new JLabel("拖动即生效 · 数值常驻可调回 · 松手记一步可撤销 · 双击名称重置单项");
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
        writeParams();
        frame.refreshView();
        // 松手（或数值框回车、双击重置）记一个检查点，Ctrl+Z 可逐步退回；数值本身不归零
        if (!src.slider.getValueIsAdjusting()) frame.checkpoint();
    }

    /** 把 13 个滑杆的当前值写进引擎的常驻参数对象。 */
    private void writeParams() {
        AdjustParams p = frame.adjustParams();
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
    }

    /** 把引擎参数回填到滑杆（撤销/重做/重置后调用；回填期间不触发写回）。 */
    public void syncFromParams(AdjustParams p) {
        syncing = true;
        exposure.setValueSilently(p.exposure);
        brightness.setValueSilently(p.brightness);
        contrast.setValueSilently(p.contrast);
        temperature.setValueSilently(p.temperature);
        tint.setValueSilently(p.tint);
        saturation.setValueSilently(p.saturation);
        vibrance.setValueSilently(p.vibrance);
        highlights.setValueSilently(p.highlights);
        shadows.setValueSilently(p.shadows);
        whites.setValueSilently(p.whites);
        blacks.setValueSilently(p.blacks);
        clarity.setValueSilently(p.clarity);
        sharpen.setValueSilently(p.sharpen);
        syncing = false;
    }
}
