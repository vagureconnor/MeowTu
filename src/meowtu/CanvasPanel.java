package meowtu;

import meowtu.flatui.FlatTheme;

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.awt.geom.Point2D;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

/**
 * 中央画布：棋盘格 + 图像显示（适配/缩放/平移）、三种前后对比、
 * 以及裁剪框、抠图框与画笔、透视四角点、文字拖动等交互的统一入口。
 */
public class CanvasPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    public enum Tool { BROWSE, CROP, TEXT, CUTOUT_RECT, CUTOUT_FG, CUTOUT_BG, PERSPECTIVE }
    public enum Compare { OFF, SPLIT, SLIDE, HOLD }

    public interface Listener {
        void onInteractionEnd();
        void onZoomChanged();
        void onPerspectivePointsChanged();
    }

    private BufferedImage image;        // 当前显示图（可为预览图）
    private BufferedImage original;     // 对比用原图
    private BufferedImage overlayImage; // 抠图结果等覆盖显示（优先于 image）
    private int coordW = -1, coordH = -1; // 交互坐标系尺寸（底图尺寸）；显示图可为降采样预览，选框/文字坐标始终以底图为准
    private Compare compare = Compare.OFF;
    private Tool tool = Tool.BROWSE;
    private double zoom = 1.0;          // 相对适配倍率
    private double panX, panY;
    private boolean holdingOriginal;

    private Rectangle cropRect;                    // 图像坐标
    private double cropAspect = 0;                 // 0=自由，>0 为宽高比
    private Rectangle cutoutRect;                  // 图像坐标
    private final List<List<Point>> fgStrokes = new ArrayList<>();
    private final List<List<Point>> bgStrokes = new ArrayList<>();
    private final List<Point> perspectivePoints = new ArrayList<>();
    private List<TextObject> textObjects = new ArrayList<>();

    private Point dragStart;
    private double dragPanX, dragPanY;
    private Rectangle dragRect;
    private List<Point> currentStroke;
    private TextObject dragText;
    private double textOffX, textOffY;
    private double slidePos = 0.5;      // 滑块对比位置（0..1 相对图像宽）
    private boolean draggingSlide;
    private Listener listener;

    public CanvasPanel() {
        setBackground(FlatTheme.CANVAS);
        setFocusable(true);
        MouseAdapter ma = new MouseAdapter() {
            @Override public void mousePressed(MouseEvent e) { onPress(e); }
            @Override public void mouseReleased(MouseEvent e) { onRelease(e); }
            @Override public void mouseDragged(MouseEvent e) { onDrag(e); }
            @Override public void mouseWheelMoved(MouseWheelEvent e) { onWheel(e); }
        };
        addMouseListener(ma);
        addMouseMotionListener(ma);
        addMouseWheelListener(ma);
    }

    // ---------- 外部接口 ----------
    public void setListener(Listener l) { this.listener = l; }
    /** 设置交互坐标系尺寸（底图宽高）。显示图被拉伸到该尺寸的画布框内绘制，坐标换算与之对齐。 */
    public void setCoordSize(int w, int h) { this.coordW = w; this.coordH = h; repaint(); }
    private int coordWidth() { BufferedImage img = shown(); return coordW > 0 ? coordW : (img == null ? 0 : img.getWidth()); }
    private int coordHeight() { BufferedImage img = shown(); return coordH > 0 ? coordH : (img == null ? 0 : img.getHeight()); }
    public void setImage(BufferedImage img) { this.image = img; repaint(); }
    public BufferedImage getImage() { return image; }
    public void setOriginal(BufferedImage img) { this.original = img; repaint(); }
    public void setOverlayImage(BufferedImage img) { this.overlayImage = img; repaint(); }
    public void setCompare(Compare c) { this.compare = c; repaint(); }
    public Compare getCompare() { return compare; }
    public void setTool(Tool t) {
        this.tool = t;
        setCursor(t == Tool.BROWSE ? Cursor.getDefaultCursor() : Cursor.getPredefinedCursor(Cursor.CROSSHAIR_CURSOR));
        repaint();
    }
    public Tool getTool() { return tool; }
    public void setTextObjects(List<TextObject> list) { this.textObjects = list; repaint(); }
    public Rectangle getCropRect() { return cropRect; }
    public void setCropAspect(double a) { this.cropAspect = a; }
    public void clearCrop() { cropRect = null; dragRect = null; repaint(); }
    public Rectangle getCutoutRect() { return cutoutRect; }
    public void clearCutout() { cutoutRect = null; fgStrokes.clear(); bgStrokes.clear(); repaint(); }
    public List<List<Point>> getFgStrokes() { return fgStrokes; }
    public List<List<Point>> getBgStrokes() { return bgStrokes; }
    public List<Point> getPerspectivePoints() { return perspectivePoints; }
    public void clearPerspective() { perspectivePoints.clear(); repaint(); }
    public double getZoom() { return zoom; }

    public void fitZoom() {
        zoom = 1.0; panX = panY = 0;
        repaint();
        if (listener != null) listener.onZoomChanged();
    }

    // ---------- 坐标变换 ----------
    private BufferedImage shown() { return overlayImage != null ? overlayImage : image; }

    private double fitScale() {
        BufferedImage img = shown();
        if (img == null) return 1;
        double s = Math.min((getWidth() - 48.0) / coordWidth(), (getHeight() - 48.0) / coordHeight());
        return Math.min(s, 8);
    }

    public double scale() { return fitScale() * zoom; }

    private Point2D origin() {
        BufferedImage img = shown();
        if (img == null) return new Point2D.Double(0, 0);
        double s = scale();
        double w = coordWidth() * s, h = coordHeight() * s;
        return new Point2D.Double((getWidth() - w) / 2 + panX, (getHeight() - h) / 2 + panY);
    }

    /** 屏幕坐标 -> 图像坐标（浮点）。 */
    public Point2D toImage(Point p) {
        Point2D o = origin();
        double s = scale();
        return new Point2D.Double((p.x - o.getX()) / s, (p.y - o.getY()) / s);
    }

    public Point toScreen(double ix, double iy) {
        Point2D o = origin();
        double s = scale();
        return new Point((int) Math.round(o.getX() + ix * s), (int) Math.round(o.getY() + iy * s));
    }

    // ---------- 交互 ----------
    private void onWheel(MouseWheelEvent e) {
        if (shown() == null) return;
        double old = zoom;
        zoom = Math.max(0.1, Math.min(32, zoom * (e.getWheelRotation() < 0 ? 1.12 : 1 / 1.12)));
        if (zoom != old) {
            repaint();
            if (listener != null) listener.onZoomChanged();
        }
    }

    private void onPress(MouseEvent e) {
        requestFocusInWindow();
        dragStart = e.getPoint();
        dragPanX = panX; dragPanY = panY;
        BufferedImage img = shown();
        if (img == null) return;
        Point2D ip = toImage(e.getPoint());
        if (compare == Compare.HOLD) { holdingOriginal = true; repaint(); return; }
        if (compare == Compare.SLIDE && Math.abs(slideScreenX() - e.getX()) < 10) { draggingSlide = true; return; }
        switch (tool) {
            case CROP, CUTOUT_RECT -> dragRect = new Rectangle(clampi(ip.getX(), coordWidth()), clampi(ip.getY(), coordHeight()), 0, 0);
            case CUTOUT_FG, CUTOUT_BG -> {
                currentStroke = new ArrayList<>();
                currentStroke.add(new Point(clampi(ip.getX(), coordWidth()), clampi(ip.getY(), coordHeight())));
                (tool == Tool.CUTOUT_FG ? fgStrokes : bgStrokes).add(currentStroke);
            }
            case PERSPECTIVE -> {
                if (perspectivePoints.size() < 4) {
                    perspectivePoints.add(new Point(clampi(ip.getX(), coordWidth()), clampi(ip.getY(), coordHeight())));
                    if (listener != null) listener.onPerspectivePointsChanged();
                }
            }
            case TEXT -> {
                Graphics2D g = (Graphics2D) getGraphics();
                for (int i = textObjects.size() - 1; i >= 0; i--) {
                    TextObject t = textObjects.get(i);
                    if (t.bounds(g).contains(ip)) {
                        dragText = t;
                        textOffX = ip.getX() - t.x; textOffY = ip.getY() - t.y;
                        break;
                    }
                }
                if (g != null) g.dispose();
            }
            default -> { }
        }
        repaint();
    }

    private void onDrag(MouseEvent e) {
        if (dragStart == null) return;
        BufferedImage img = shown();
        if (img == null) return;
        Point2D ip = toImage(e.getPoint());
        if (draggingSlide) {
            Point2D o = origin();
            slidePos = clamp01((e.getX() - o.getX()) / (coordWidth() * scale()));
            repaint(); return;
        }
        switch (tool) {
            case BROWSE -> { panX = dragPanX + e.getX() - dragStart.x; panY = dragPanY + e.getY() - dragStart.y; }
            case CROP, CUTOUT_RECT -> {
                if (dragRect != null) {
                    int x0 = dragRect.x, y0 = dragRect.y;
                    int x1 = clampi(ip.getX(), coordWidth()), y1 = clampi(ip.getY(), coordHeight());
                    if (tool == Tool.CROP && cropAspect > 0) {
                        int w = Math.abs(x1 - x0);
                        int hh = (int) Math.round(w / cropAspect);
                        y1 = y0 + (y1 >= y0 ? hh : -hh);
                    }
                    dragRect = rectFrom(x0, y0, x1, y1);
                }
            }
            case CUTOUT_FG, CUTOUT_BG -> {
                if (currentStroke != null) currentStroke.add(new Point(clampi(ip.getX(), coordWidth()), clampi(ip.getY(), coordHeight())));
            }
            case TEXT -> {
                if (dragText != null) { dragText.x = ip.getX() - textOffX; dragText.y = ip.getY() - textOffY; }
            }
            default -> { }
        }
        repaint();
    }

    private void onRelease(MouseEvent e) {
        if (holdingOriginal) { holdingOriginal = false; repaint(); }
        if (dragRect != null) {
            if (dragRect.width >= 4 && dragRect.height >= 4) {
                if (tool == Tool.CROP) cropRect = dragRect;
                else if (tool == Tool.CUTOUT_RECT) cutoutRect = dragRect;
            }
            dragRect = null;
        }
        currentStroke = null;
        dragText = null;
        draggingSlide = false;
        dragStart = null;
        repaint();
        if (listener != null) listener.onInteractionEnd();
    }

    private int clampi(double v, int max) {
        return Math.max(0, Math.min(max - 1, (int) Math.round(v)));
    }

    private static Rectangle rectFrom(int x0, int y0, int x1, int y1) {
        return new Rectangle(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }

    private static double clamp01(double v) { return Math.max(0, Math.min(1, v)); }

    private int slideScreenX() {
        BufferedImage img = shown();
        if (img == null) return 0;
        Point2D o = origin();
        return (int) (o.getX() + coordWidth() * scale() * slidePos);
    }

    // ---------- 绘制 ----------
    @Override protected void paintComponent(Graphics g0) {
        super.paintComponent(g0);
        Graphics2D g = (Graphics2D) g0;
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        BufferedImage img = shown();
        if (img == null) {
            g.setColor(FlatTheme.TEXT_FAINT);
            g.setFont(getFont().deriveFont(15f));
            String s = "打开一张图片开始编辑，或点顶栏「示例图」生成测试图";
            FontMetrics fm = g.getFontMetrics();
            g.drawString(s, (getWidth() - fm.stringWidth(s)) / 2, getHeight() / 2);
            return;
        }
        Point2D o = origin();
        double s = scale();
        int ix = (int) Math.round(o.getX()), iy = (int) Math.round(o.getY());
        int iw = (int) Math.round(coordWidth() * s), ih = (int) Math.round(coordHeight() * s);

        // 棋盘格
        int cell = 10;
        for (int y = iy; y < iy + ih; y += cell) {
            for (int x = ix; x < ix + iw; x += cell) {
                boolean dark = (((x - ix) / cell) + ((y - iy) / cell)) % 2 == 0;
                g.setColor(dark ? FlatTheme.CHECKER_A : FlatTheme.CHECKER_B);
                g.fillRect(x, y, Math.min(cell, ix + iw - x), Math.min(cell, iy + ih - y));
            }
        }
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                s < 1 ? RenderingHints.VALUE_INTERPOLATION_BILINEAR : RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);

        BufferedImage cur = img;
        BufferedImage orig = original;
        int cw = coordWidth(), chh = coordHeight();
        boolean origFits = orig != null && orig.getWidth() == cw && orig.getHeight() == chh;
        boolean useOrig = holdingOriginal && compare == Compare.HOLD && origFits;
        if (useOrig) {
            g.drawImage(orig, ix, iy, iw, ih, null);
        } else if (compare == Compare.SPLIT && origFits) {
            int half = iw / 2;
            g.drawImage(orig, ix, iy, ix + half, iy + ih, 0, 0, orig.getWidth() / 2, orig.getHeight(), null);
            g.drawImage(cur, ix + half, iy, ix + iw, iy + ih, cur.getWidth() / 2, 0, cur.getWidth(), cur.getHeight(), null);
            g.setColor(FlatTheme.ACCENT);
            g.fillRect(ix + half - 1, iy, 2, ih);
            tag(g, "原图", ix + 6, iy + 6);
            tag(g, "当前", ix + iw - 6 - 28, iy + 6);
        } else if (compare == Compare.SLIDE && origFits) {
            g.drawImage(cur, ix, iy, iw, ih, null);
            int sx = slideScreenX();
            int ow = (int) ((sx - ix) / s);
            if (ow > 0) {
                int srcW = Math.min((int) Math.round(ow * (double) orig.getWidth() / cw), orig.getWidth());
                g.drawImage(orig, ix, iy, sx, iy + ih, 0, 0, srcW, orig.getHeight(), null);
            }
            g.setColor(FlatTheme.ACCENT);
            g.fillRect(sx - 1, iy, 2, ih);
            g.fillOval(sx - 9, iy + ih / 2 - 9, 18, 18);
            g.setColor(Color.WHITE);
            g.drawString("◂▸", sx - 8, iy + ih / 2 + 4);
            tag(g, "原图", ix + 6, iy + 6);
        } else {
            g.drawImage(cur, ix, iy, iw, ih, null);
        }

        // 文字对象
        if (overlayImage == null) {
            Graphics2D tg = (Graphics2D) g.create();
            tg.translate(ix, iy);
            tg.scale(s, s);
            tg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            for (TextObject t : textObjects) t.render(tg);
            tg.dispose();
        }

        // 选框与画笔
        drawSelection(g, cropRect, FlatTheme.ACCENT, "裁剪");
        drawSelection(g, dragRect != null && tool == Tool.CROP ? dragRect : null, FlatTheme.ACCENT, null);
        drawSelection(g, cutoutRect, new Color(0x7BD88A), "抠图范围");
        drawSelection(g, dragRect != null && tool == Tool.CUTOUT_RECT ? dragRect : null, new Color(0x7BD88A), null);
        drawStrokes(g, fgStrokes, new Color(0x51CF66));
        drawStrokes(g, bgStrokes, new Color(0xFF6B6B));
        // 透视点
        g.setColor(FlatTheme.ACCENT);
        for (int i = 0; i < perspectivePoints.size(); i++) {
            Point sp = toScreen(perspectivePoints.get(i).x, perspectivePoints.get(i).y);
            g.fillOval(sp.x - 6, sp.y - 6, 12, 12);
            g.setColor(Color.WHITE);
            g.drawString(Integer.toString(i + 1), sp.x - 3, sp.y + 4);
            g.setColor(FlatTheme.ACCENT);
            if (i > 0) {
                Point prev = toScreen(perspectivePoints.get(i - 1).x, perspectivePoints.get(i - 1).y);
                g.drawLine(prev.x, prev.y, sp.x, sp.y);
            }
        }
        // 边框
        g.setColor(FlatTheme.BORDER);
        g.drawRect(ix, iy, iw, ih);
    }

    private void tag(Graphics2D g, String text, int x, int y) {
        FontMetrics fm = g.getFontMetrics();
        g.setColor(new Color(0, 0, 0, 150));
        g.fillRoundRect(x - 3, y - 2, fm.stringWidth(text) + 8, fm.getHeight() + 4, 6, 6);
        g.setColor(Color.WHITE);
        g.drawString(text, x + 1, y + fm.getAscent());
    }

    private void drawSelection(Graphics2D g, Rectangle r, Color color, String label) {
        if (r == null) return;
        Point a = toScreen(r.x, r.y), b = toScreen(r.x + r.width, r.y + r.height);
        g.setColor(color);
        g.setStroke(new BasicStroke(1.6f));
        g.drawRect(a.x, a.y, b.x - a.x, b.y - a.y);
        // 三分线
        g.setStroke(new BasicStroke(0.7f));
        for (int i = 1; i <= 2; i++) {
            int gx = a.x + (b.x - a.x) * i / 3, gy = a.y + (b.y - a.y) * i / 3;
            g.drawLine(gx, a.y, gx, b.y);
            g.drawLine(a.x, gy, b.x, gy);
        }
        if (label != null) tag(g, label, a.x + 4, a.y + 4);
    }

    private void drawStrokes(Graphics2D g, List<List<Point>> strokes, Color color) {
        g.setColor(color);
        g.setStroke(new BasicStroke(3f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (List<Point> stroke : strokes) {
            for (int i = 1; i < stroke.size(); i++) {
                Point a = toScreen(stroke.get(i - 1).x, stroke.get(i - 1).y);
                Point b = toScreen(stroke.get(i).x, stroke.get(i).y);
                g.drawLine(a.x, a.y, b.x, b.y);
            }
        }
    }
}
