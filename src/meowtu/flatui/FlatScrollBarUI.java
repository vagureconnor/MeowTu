package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicScrollBarUI;
import java.awt.*;
import java.awt.geom.RoundRectangle2D;

/** 细滚动条委托：宽 10px，圆角滑块，无箭头按钮。 */
public class FlatScrollBarUI extends BasicScrollBarUI {
    public static javax.swing.plaf.ComponentUI createUI(JComponent c) { return new FlatScrollBarUI(); }

    @Override protected void configureScrollBarColors() {
        thumbColor = FlatTheme.BG_PRESS;
        thumbHighlightColor = FlatTheme.BG_HOVER;
        trackColor = FlatTheme.BG;
    }

    @Override public Dimension getPreferredSize(JComponent c) {
        return scrollbar.getOrientation() == JScrollBar.VERTICAL
                ? new Dimension(10, 48) : new Dimension(48, 10);
    }

    @Override protected JButton createDecreaseButton(int orientation) { return zeroButton(); }
    @Override protected JButton createIncreaseButton(int orientation) { return zeroButton(); }

    private JButton zeroButton() {
        JButton b = new JButton();
        b.setPreferredSize(new Dimension(0, 0));
        b.setMinimumSize(new Dimension(0, 0));
        b.setMaximumSize(new Dimension(0, 0));
        return b;
    }

    @Override protected void paintTrack(Graphics g, JComponent c, Rectangle r) {
        g.setColor(FlatTheme.BG);
        g.fillRect(r.x, r.y, r.width, r.height);
    }

    @Override protected void paintThumb(Graphics g, JComponent c, Rectangle r) {
        if (r.isEmpty() || !scrollbar.isEnabled()) return;
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        boolean dragging = isDragging;
        boolean hover = isThumbRollover();
        g2.setColor(dragging ? FlatTheme.TEXT_FAINT : hover ? FlatTheme.BG_PRESS : FlatTheme.BG_HOVER);
        int inset = 2;
        g2.fill(new RoundRectangle2D.Float(r.x + inset, r.y + inset, r.width - inset * 2, r.height - inset * 2, 6, 6));
        g2.dispose();
    }
}
