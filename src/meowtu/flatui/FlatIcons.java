package meowtu.flatui;

import javax.swing.*;
import java.awt.*;

/**
 * 矢量小图标：全部用 Graphics2D 现画，线宽随尺寸缩放，颜色默认取组件前景。
 * 图标画布为 24x24 逻辑坐标，绘制时缩放到实际尺寸。
 */
public final class FlatIcons {
    private FlatIcons() {}

    @FunctionalInterface
    public interface Drawer { void draw(Graphics2D g); }

    public static Icon of(int size, Drawer d) { return new VectorIcon(size, d); }

    private static class VectorIcon implements Icon {
        private final int size;
        private final Drawer drawer;
        VectorIcon(int size, Drawer d) { this.size = size; this.drawer = d; }
        @Override public int getIconWidth() { return size; }
        @Override public int getIconHeight() { return size; }
        @Override public void paintIcon(Component c, Graphics g, int x, int y) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.translate(x, y);
            g2.scale(size / 24.0, size / 24.0);
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setStroke(new BasicStroke(1.7f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            Color col = c == null ? FlatTheme.TEXT : c.getForeground();
            g2.setColor(col == null ? FlatTheme.TEXT : col);
            drawer.draw(g2);
            g2.dispose();
        }
    }

    private static void strokeRect(Graphics2D g, int x, int y, int w, int h) { g.drawRect(x, y, w, h); }

    public static Icon open(int s) { return of(s, g -> {
        g.drawPolyline(new int[]{3, 3, 21, 21}, new int[]{8, 20, 20, 8}, 4);
        g.drawLine(3, 8, 9, 8); g.drawLine(9, 8, 11, 4); g.drawLine(11, 4, 17, 4); g.drawLine(17, 4, 19, 8); g.drawLine(19, 8, 21, 8);
    });}

    public static Icon save(int s) { return of(s, g -> {
        strokeRect(g, 4, 4, 16, 16);
        g.drawRect(8, 4, 8, 5);
        g.drawRect(8, 14, 8, 6);
    });}

    public static Icon exportIcon(int s) { return of(s, g -> {
        g.drawLine(12, 4, 12, 15);
        g.drawPolyline(new int[]{7, 12, 17}, new int[]{10, 15, 10}, 3);
        g.drawLine(4, 20, 20, 20);
    });}

    public static Icon undo(int s) { return of(s, g -> {
        g.drawArc(6, 6, 13, 13, 100, 260);
        g.drawPolyline(new int[]{11, 5, 5}, new int[]{3, 8, 14}, 3);
    });}

    public static Icon redo(int s) { return of(s, g -> {
        g.drawArc(5, 6, 13, 13, -170, 260);
        g.drawPolyline(new int[]{13, 19, 19}, new int[]{3, 8, 14}, 3);
    });}

    public static Icon crop(int s) { return of(s, g -> {
        g.drawLine(6, 2, 6, 18); g.drawLine(6, 18, 22, 18);
        g.drawLine(2, 6, 18, 6); g.drawLine(18, 6, 18, 22);
    });}

    public static Icon rotate(int s) { return of(s, g -> {
        g.drawArc(4, 4, 15, 15, 40, 280);
        g.drawPolyline(new int[]{14, 20, 20}, new int[]{2, 5, 11}, 3);
    });}

    public static Icon flip(int s) { return of(s, g -> {
        g.drawLine(12, 3, 12, 21);
        g.drawPolygon(new int[]{4, 10, 10}, new int[]{8, 5, 11}, 3);
        g.drawPolygon(new int[]{20, 14, 14}, new int[]{16, 13, 19}, 3);
    });}

    public static Icon text(int s) { return of(s, g -> {
        g.drawLine(5, 5, 19, 5);
        g.drawLine(12, 5, 12, 19);
        g.drawLine(8, 19, 16, 19);
    });}

    public static Icon wand(int s) { return of(s, g -> {
        g.drawLine(5, 19, 16, 8);
        g.drawLine(16, 3, 17, 6); g.drawLine(20, 6, 17, 7); g.drawLine(19, 10, 17, 8);
        g.drawLine(6, 4, 7, 7); g.drawLine(10, 12, 13, 13);
    });}

    public static Icon brush(int s) { return of(s, g -> {
        g.drawLine(14, 4, 19, 9);
        g.drawLine(19, 9, 10, 18);
        g.drawLine(10, 18, 5, 20); g.drawLine(5, 20, 6, 15); g.drawLine(6, 15, 10, 18);
    });}

    public static Icon eraser(int s) { return of(s, g -> {
        g.drawPolygon(new int[]{7, 15, 20, 20, 10, 5}, new int[]{15, 6, 11, 17, 17, 12}, 6);
        g.drawLine(4, 20, 20, 20);
    });}

    public static Icon move(int s) { return of(s, g -> {
        g.drawLine(12, 3, 12, 21); g.drawLine(3, 12, 21, 12);
        g.drawPolyline(new int[]{8, 12, 16}, new int[]{7, 3, 7}, 3);
        g.drawPolyline(new int[]{8, 12, 16}, new int[]{17, 21, 17}, 3);
        g.drawPolyline(new int[]{7, 3, 7}, new int[]{8, 12, 16}, 3);
        g.drawPolyline(new int[]{17, 21, 17}, new int[]{8, 12, 16}, 3);
    });}

    public static Icon rect(int s) { return of(s, g -> {
        g.setStroke(new BasicStroke(1.7f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 1f, new float[]{4, 3}, 0));
        strokeRect(g, 4, 6, 16, 12);
    });}

    public static Icon compare(int s) { return of(s, g -> {
        strokeRect(g, 3, 5, 18, 14);
        g.drawLine(12, 5, 12, 19);
    });}

    public static Icon sliders(int s) { return of(s, g -> {
        g.drawLine(4, 7, 20, 7); g.drawLine(4, 12, 20, 12); g.drawLine(4, 17, 20, 17);
        g.fillOval(8, 5, 4, 4); g.fillOval(14, 10, 4, 4); g.fillOval(6, 15, 4, 4);
    });}

    public static Icon curve(int s) { return of(s, g -> {
        g.drawLine(4, 4, 4, 20); g.drawLine(4, 20, 20, 20);
        g.drawPolyline(new int[]{4, 10, 15, 20}, new int[]{20, 18, 8, 5}, 4);
        g.fillOval(8, 16, 4, 4); g.fillOval(13, 6, 4, 4);
    });}

    public static Icon histogram(int s) { return of(s, g -> {
        g.drawLine(4, 20, 20, 20);
        g.fillRect(6, 12, 3, 8); g.fillRect(11, 7, 3, 13); g.fillRect(16, 10, 3, 10);
    });}

    public static Icon image(int s) { return of(s, g -> {
        strokeRect(g, 3, 5, 18, 14);
        g.fillOval(8, 8, 3, 3);
        g.drawPolyline(new int[]{3, 9, 14, 21}, new int[]{17, 11, 15, 10}, 4);
    });}

    public static Icon plus(int s) { return of(s, g -> {
        g.drawLine(12, 5, 12, 19); g.drawLine(5, 12, 19, 12);
    });}

    public static Icon minus(int s) { return of(s, g -> g.drawLine(5, 12, 19, 12)); }

    public static Icon check(int s) { return of(s, g -> {
        g.setStroke(new BasicStroke(2.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.drawPolyline(new int[]{4, 10, 20}, new int[]{13, 18, 6}, 3);
    });}
}
