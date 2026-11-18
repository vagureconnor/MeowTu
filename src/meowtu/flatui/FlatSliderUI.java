package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicSliderUI;
import java.awt.*;
import java.awt.geom.RoundRectangle2D;

/** 细滑杆委托：4px 圆角轨道（已填充段为强调蓝）+ 14px 圆形拇指。 */
public class FlatSliderUI extends BasicSliderUI {
    public static javax.swing.plaf.ComponentUI createUI(JComponent c) { return new FlatSliderUI((JSlider) c); }

    public FlatSliderUI(JSlider s) { super(s); }

    @Override protected Dimension getThumbSize() { return new Dimension(14, 14); }

    @Override public void paintTrack(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int cy = trackRect.y + trackRect.height / 2;
        int th = 4;
        // 底轨
        g2.setColor(FlatTheme.BG_DARK);
        g2.fill(new RoundRectangle2D.Float(trackRect.x, cy - th / 2f, trackRect.width, th, th, th));
        // 已填充段
        int fillW;
        if (slider.getOrientation() == JSlider.HORIZONTAL) {
            fillW = thumbRect.x + thumbRect.width / 2 - trackRect.x;
        } else {
            fillW = trackRect.height - (thumbRect.y + thumbRect.height / 2 - trackRect.y);
            // 竖直滑杆极少用，简单处理：整段底色
            fillW = 0;
        }
        if (fillW > 0) {
            g2.setColor(slider.isEnabled() ? FlatTheme.ACCENT : FlatTheme.ACCENT_SOFT);
            g2.fill(new RoundRectangle2D.Float(trackRect.x, cy - th / 2f, fillW, th, th, th));
        }
        g2.dispose();
    }

    @Override public void paintThumb(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int x = thumbRect.x, y = thumbRect.y, w = thumbRect.width, h = thumbRect.height;
        g2.setColor(slider.isEnabled() ? Color.WHITE : FlatTheme.TEXT_DIM);
        g2.fillOval(x, y, w, h);
        g2.setColor(FlatTheme.BORDER);
        g2.drawOval(x, y, w - 1, h - 1);
        if (slider.hasFocus()) {
            g2.setColor(FlatTheme.ACCENT);
            g2.setStroke(new BasicStroke(1.4f));
            g2.drawOval(x - 2, y - 2, w + 3, h + 3);
        }
        g2.dispose();
    }

    @Override public void paintTicks(Graphics g) { /* 不画刻度，保持干净 */ }
    @Override public void paintLabels(Graphics g) { /* 不画标签 */ }
    @Override public void paintFocus(Graphics g) { /* 焦点环已在拇指上绘制 */ }
}
