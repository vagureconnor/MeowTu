package meowtu;

import java.awt.*;
import java.awt.font.FontRenderContext;
import java.awt.geom.Rectangle2D;

/** 画布上的一个文字对象：以图像坐标定位，可拖动，导出时栅格化。 */
public class TextObject {
    public String text;
    public String fontName;
    public int size;
    public boolean bold;
    public boolean italic;
    public Color color;
    public boolean outline;
    public double x, y; // 左上角（图像坐标）

    public TextObject(String text, double x, double y) {
        this.text = text;
        this.fontName = Font.SANS_SERIF;
        this.size = 48;
        this.bold = false;
        this.italic = false;
        this.color = Color.WHITE;
        this.outline = true;
        this.x = x; this.y = y;
    }

    /** 深拷贝（状态快照用）。 */
    public TextObject copy() {
        TextObject t = new TextObject(text, x, y);
        t.fontName = fontName;
        t.size = size;
        t.bold = bold;
        t.italic = italic;
        t.color = color;
        t.outline = outline;
        return t;
    }

    public Font font() {
        int style = (bold ? Font.BOLD : 0) | (italic ? Font.ITALIC : 0);
        return new Font(fontName, style, size);
    }

    /** 在给定 Graphics 上测得的包围盒（图像坐标）。 */
    public Rectangle2D bounds(Graphics2D g) {
        FontRenderContext frc = g.getFontRenderContext();
        Rectangle2D r = font().getStringBounds(text == null || text.isEmpty() ? " " : text, frc);
        return new Rectangle2D.Double(x, y, r.getWidth(), r.getHeight());
    }

    public void render(Graphics2D g) {
        if (text == null || text.isEmpty()) return;
        Font f = font();
        g.setFont(f);
        FontMetrics fm = g.getFontMetrics(f);
        float bx = (float) x, by = (float) (y + fm.getAscent());
        if (outline) {
            g.setColor(new Color(0, 0, 0, 160));
            float d = Math.max(1f, size / 18f);
            g.drawString(text, bx - d, by);
            g.drawString(text, bx + d, by);
            g.drawString(text, bx, by - d);
            g.drawString(text, bx, by + d);
        }
        g.setColor(color);
        g.drawString(text, bx, by);
    }
}
