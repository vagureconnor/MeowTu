package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicComboBoxUI;
import javax.swing.plaf.basic.BasicComboPopup;
import javax.swing.plaf.basic.ComboPopup;
import java.awt.*;
import java.awt.geom.RoundRectangle2D;

/** 下拉框委托：圆角深底 + 小箭头，弹出列表同步深色。 */
public class FlatComboBoxUI extends BasicComboBoxUI {
    public static javax.swing.plaf.ComponentUI createUI(JComponent c) { return new FlatComboBoxUI(); }

    @Override public void installUI(JComponent c) {
        super.installUI(c);
        comboBox.setOpaque(false);
        comboBox.setBorder(BorderFactory.createEmptyBorder(3, 8, 3, 4));
        comboBox.setForeground(FlatTheme.TEXT);
        comboBox.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
    }

    @Override public void paint(Graphics g, JComponent c) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int w = c.getWidth(), h = c.getHeight();
        RoundRectangle2D rr = new RoundRectangle2D.Float(0.5f, 0.5f, w - 1f, h - 1f, FlatTheme.ARC, FlatTheme.ARC);
        g2.setColor(FlatTheme.BG_RAISED);
        g2.fill(rr);
        g2.setColor(comboBox.hasFocus() ? FlatTheme.ACCENT : FlatTheme.BORDER_SOFT);
        g2.draw(rr);
        g2.dispose();
        paintCurrentValueBackground(g, new Rectangle(0, 0, w, h), false);
        paintCurrentValue(g, new Rectangle(0, 0, w, h), false);
    }

    @Override protected JButton createArrowButton() {
        JButton b = new JButton() {
            @Override public void paint(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2.setColor(FlatTheme.TEXT_DIM);
                int cx = getWidth() / 2, cy = getHeight() / 2;
                Polygon p = new Polygon(new int[]{cx - 4, cx + 4, cx}, new int[]{cy - 2, cy - 2, cy + 3}, 3);
                g2.fill(p);
                g2.dispose();
            }
        };
        b.setBorder(BorderFactory.createEmptyBorder());
        b.setContentAreaFilled(false);
        b.setFocusPainted(false);
        b.setPreferredSize(new Dimension(20, 20));
        return b;
    }

    @Override protected ComboPopup createPopup() {
        BasicComboPopup pop = (BasicComboPopup) super.createPopup();
        pop.getList().setBackground(FlatTheme.BG_PANEL);
        pop.getList().setForeground(FlatTheme.TEXT);
        pop.getList().setSelectionBackground(FlatTheme.ACCENT_SOFT);
        pop.getList().setSelectionForeground(FlatTheme.TEXT);
        pop.setBorder(BorderFactory.createLineBorder(FlatTheme.BORDER));
        return pop;
    }
}
