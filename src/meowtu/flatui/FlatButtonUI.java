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
    public static javax.swing.plaf.ComponentUI createUI(JComponent c) { return new FlatButtonUI(); }

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

        // 图标 + 文字排布：支持图标在上（工具栏）与图标在左（普通按钮）
        String text = b.getText();
        Icon icon = b.getIcon();
        FontMetrics fm = c.getFontMetrics(c.getFont());
        boolean hasText = text != null && !text.isEmpty();
        int gap = (icon != null && hasText) ? b.getIconTextGap() : 0;
        int tw = hasText ? fm.stringWidth(text) : 0;
        int iw = (icon == null) ? 0 : icon.getIconWidth();
        int ih = (icon == null) ? 0 : icon.getIconHeight();
        Color fg = !b.isEnabled() ? FlatTheme.TEXT_FAINT
                : (primary || danger) ? Color.WHITE : FlatTheme.TEXT;
        Icon ic = icon;
        if (!b.isEnabled() && b.getDisabledIcon() != null) ic = b.getDisabledIcon();
        if (icon != null && hasText && b.getVerticalTextPosition() == SwingConstants.BOTTOM) {
            int totalH = ih + gap + fm.getHeight();
            int y0 = (h - totalH) / 2;
            ic.paintIcon(c, g, (w - iw) / 2, y0);
            g.setColor(fg);
            g.setFont(c.getFont());
            g.drawString(text, (w - tw) / 2, y0 + ih + gap + fm.getAscent());
        } else {
            int total = iw + (iw > 0 && tw > 0 ? gap : 0) + tw;
            int x = (w - total) / 2;
            int y = h / 2;
            if (icon != null) {
                ic.paintIcon(c, g, x, y - ih / 2);
                x += iw + gap;
            }
            if (hasText) {
                g.setColor(fg);
                g.setFont(c.getFont());
                g.drawString(text, x, y + fm.getAscent() / 2 - 1);
            }
        }
    }
}
