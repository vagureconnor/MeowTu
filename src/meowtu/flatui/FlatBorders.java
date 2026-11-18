package meowtu.flatui;

import javax.swing.border.AbstractBorder;
import java.awt.*;
import java.awt.geom.RoundRectangle2D;

/** 圆角边框集合：输入框、面板、卡片。 */
public final class FlatBorders {
    private FlatBorders() {}

    public static class Round extends AbstractBorder {
        private static final long serialVersionUID = 1L;
        private final int arc;
        private final Color line;
        private final Color fill;
        private final Insets insets;

        public Round(int arc, Color line, Color fill, Insets insets) {
            this.arc = arc; this.line = line; this.fill = fill; this.insets = insets;
        }

        @Override public Insets getBorderInsets(Component c) { return new Insets(insets.top, insets.left, insets.bottom, insets.right); }

        @Override public void paintBorder(Component c, Graphics g, int x, int y, int w, int h) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            RoundRectangle2D rr = new RoundRectangle2D.Float(x + 0.5f, y + 0.5f, w - 1f, h - 1f, arc, arc);
            if (fill != null) { g2.setColor(fill); g2.fill(rr); }
            if (line != null) {
                g2.setColor(c.hasFocus() ? FlatTheme.ACCENT : line);
                g2.draw(rr);
            }
            g2.dispose();
        }
    }

    /** 输入框边框：深色填充 + 细边，聚焦时描蓝。 */
    public static Round field() {
        return new Round(FlatTheme.ARC, FlatTheme.BORDER, null, new Insets(4, 8, 4, 8));
    }

    /** 卡片边框：面板底色 + 软边。 */
    public static Round card() {
        return new Round(10, FlatTheme.BORDER_SOFT, FlatTheme.BG_PANEL, new Insets(8, 10, 8, 10));
    }

    /** 无填充圆角边。 */
    public static Round line(int arc) {
        return new Round(arc, FlatTheme.BORDER, null, new Insets(4, 8, 4, 8));
    }
}
