package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicButtonUI;
import java.awt.*;
import java.awt.geom.RoundRectangle2D;

/**
 * 圆角按钮委托：支持普通/主按钮（clientProperty "flat.primary"）/
 * 工具条切换按钮（"flat.toggle" 由 JToggleButton 自动识别）/纯图标按钮。
 */
public class FlatButtonUI extends BasicButtonUI {

    @Override public void installUI(JComponent c) {
        super.installUI(c);
        AbstractButton b = (AbstractButton) c;
        b.setOpaque(false);
        b.setBorderPainted(false);
        b.setFocusPainted(false);
        b.setRolloverEnabled(true);
        b.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        if (b.getBorder() == null || b.getBorder() instanceof javax.swing.plaf.UIResource) {
            b.setBorder(BorderFactory.createEmptyBorder(5, 12, 5, 12));
        }
        b.setForeground(FlatTheme.TEXT);
    }

    @Override public void paint(Graphics g, JComponent c) {
        AbstractButton b = (AbstractButton) c;
        ButtonModel m = b.getModel();
        int w = c.getWidth(), h = c.getHeight();
        boolean primary = Boolean.TRUE.equals(b.getClientProperty("flat.primary"));
        boolean danger = Boolean.TRUE.equals(b.getClientProperty("flat.danger"));
        boolean selected = b instanceof JToggleButton && ((JToggleButton) b).isSelected();

        Color bg;
        if (!b.isEnabled()) bg = FlatTheme.BG_PANEL;
        else if (m.isPressed() || selected) bg = primary ? FlatTheme.ACCENT_DARK : FlatTheme.BG_PRESS;
        else if (primary) bg = FlatTheme.ACCENT;
        else if (danger) bg = FlatTheme.DANGER;
        else if (m.isRollover()) bg = FlatTheme.BG_HOVER;
        else bg = FlatTheme.BG_RAISED;

        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int arc = FlatTheme.ARC;
        RoundRectangle2D rr = new RoundRectangle2D.Float(0.5f, 0.5f, w - 1f, h - 1f, arc, arc);
        if (primary || danger || selected || m.isRollover() || Boolean.TRUE.equals(b.getClientProperty("flat.filled"))) {
            g2.setColor(bg); g2.fill(rr);
        } else {
            g2.setColor(FlatTheme.BG_RAISED); g2.fill(rr);
            g2.setColor(FlatTheme.BORDER_SOFT); g2.draw(rr);
        }
        if (selected) { // 切换选中时再描一圈强调边
            g2.setColor(FlatTheme.ACCENT);
            g2.draw(new RoundRectangle2D.Float(0.5f, 0.5f, w - 1f, h - 1f, arc, arc));
        }
        if (b.hasFocus() && b.isFocusPainted()) {
            g2.setColor(FlatTheme.ACCENT);
            g2.setStroke(new BasicStroke(1.4f));
            g2.draw(new RoundRectangle2D.Float(1.5f, 1.5f, w - 3f, h - 3f, arc, arc));
        }
        g2.dispose();

        // 图标 + 文字（居中排布）
        String text = b.getText();
        Icon icon = b.getIcon();
        if (m.isPressed()) { /* 按下不位移，保持稳定 */ }
        FontMetrics fm = c.getFontMetrics(c.getFont());
        int gap = (icon != null && text != null && !text.isEmpty()) ? b.getIconTextGap() : 0;
        int tw = (text == null) ? 0 : fm.stringWidth(text);
        int iw = (icon == null) ? 0 : icon.getIconWidth();
        int total = iw + (iw > 0 && tw > 0 ? gap : 0) + tw;
        int x = (w - total) / 2;
        int y = h / 2;
        Color fg = !b.isEnabled() ? FlatTheme.TEXT_FAINT
                : (primary || danger) ? Color.WHITE : FlatTheme.TEXT;
        if (icon != null) {
            Icon ic = !b.isEnabled() && b.getDisabledIcon() != null ? b.getDisabledIcon() : icon;
            ic.paintIcon(c, g, x, y - ic.getIconHeight() / 2);
            x += iw + gap;
        }
        if (text != null && !text.isEmpty()) {
            g.setColor(fg);
            g.setFont(c.getFont());
            g.drawString(text, x, y + fm.getAscent() / 2 - 1);
        }
    }
}
