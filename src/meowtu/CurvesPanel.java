package meowtu;

import meowtu.core.Curves;
import meowtu.flatui.FlatTheme;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.List;

/** 曲线面板：通道选择 + 预设 + 可拖动控制点的曲线编辑器。 */
public class CurvesPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final JComboBox<String> channelBox = new JComboBox<>(new String[]{"RGB 合成", "红 R", "绿 G", "蓝 B"});
    private final JComboBox<String> presetBox = new JComboBox<>(Curves.PRESET_NAMES);
    private final CurveEditor editor = new CurveEditor();
    private int channel = Curves.RGB;

    public CurvesPanel(MainFrame frame) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        JPanel top = new JPanel(new GridLayout(2, 2, 6, 6));
        top.setOpaque(false);
        top.add(new JLabel("通道"));
        top.add(channelBox);
        top.add(new JLabel("预设"));
        top.add(presetBox);
        add(top, BorderLayout.NORTH);

        editor.setPreferredSize(new Dimension(272, 272));
        add(editor, BorderLayout.CENTER);

        JPanel btns = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        btns.setOpaque(false);
        JButton reset = new JButton("重置");
        reset.addActionListener(e -> {
            frame.curves().reset();
            editor.repaint();
            frame.refreshView();
            frame.checkpoint();
        });
        btns.add(reset);
        JLabel hint = new JLabel("拖动即生效 · 双击加点 · 右键删点 · 松手记一步可撤销");
        hint.setForeground(FlatTheme.TEXT_FAINT);
        hint.setFont(hint.getFont().deriveFont(11f));
        btns.add(hint);
        add(btns, BorderLayout.SOUTH);

        channelBox.addActionListener(e -> { channel = channelBox.getSelectedIndex(); editor.repaint(); });
        presetBox.addActionListener(e -> {
            Curves p = Curves.preset((String) presetBox.getSelectedItem());
            for (int ch = 0; ch < 4; ch++) frame.curves().setPoints(ch, p.points(ch));
            editor.repaint();
            frame.refreshView();
            frame.checkpoint();
        });
    }

    /** 引擎状态变化（撤销/重做/重置）后重画曲线编辑器。 */
    public void refreshFromEngine() { editor.repaint(); }

    /** 曲线编辑区：坐标 (0,0) 左下为输入/输出原点，内部翻转 Y。 */
    private class CurveEditor extends JComponent {
    private static final long serialVersionUID = 1L;
        private Point dragPoint;
        private boolean moved;

        CurveEditor() {
            MouseAdapter ma = new MouseAdapter() {
                @Override public void mousePressed(MouseEvent e) { onPress(e); }
                @Override public void mouseDragged(MouseEvent e) { onDrag(e); }
                @Override public void mouseReleased(MouseEvent e) {
                    if (moved) { frame.refreshView(); frame.checkpoint(); }
                    moved = false; dragPoint = null;
                }
                @Override public void mouseClicked(MouseEvent e) {
                    if (e.getClickCount() == 2 && dragPoint == null) {
                        Point v = toValue(e.getPoint());
                        frame.curves().points(channel).add(v);
                        frame.curves().setPoints(channel, frame.curves().points(channel));
                        repaint();
                        frame.refreshView();
                        frame.checkpoint();
                    }
                }
            };
            addMouseListener(ma);
            addMouseMotionListener(ma);
        }

        private int editorSize() { return Math.min(getWidth(), getHeight()) - 16; }
        private int ox() { return 8; }
        private int oy() { return 8; }

        private Point toValue(Point p) {
            int s = editorSize();
            int vx = (int) Math.round((p.x - ox()) / (double) s * 255);
            int vy = 255 - (int) Math.round((p.y - oy()) / (double) s * 255);
            return new Point(clamp(vx), clamp(vy));
        }

        private Point toScreen(Point v) {
            int s = editorSize();
            return new Point(ox() + (int) Math.round(v.x / 255.0 * s), oy() + (int) Math.round((255 - v.y) / 255.0 * s));
        }

        private int clamp(int v) { return Math.max(0, Math.min(255, v)); }

        private void onPress(MouseEvent e) {
            List<Point> pts = frame.curves().points(channel);
            dragPoint = null;
            for (Point p : pts) {
                Point sp = toScreen(p);
                if (sp.distance(e.getPoint()) < 9) { dragPoint = p; break; }
            }
            if (e.isPopupTrigger() || e.getButton() == MouseEvent.BUTTON3) {
                if (dragPoint != null && pts.size() > 2 && dragPoint.x != 0 && dragPoint.x != 255) {
                    pts.remove(dragPoint);
                    dragPoint = null;
                    repaint();
                    frame.refreshView();
                    frame.checkpoint();
                }
                return;
            }
            moved = false;
        }

        private void onDrag(MouseEvent e) {
            if (dragPoint == null) return;
            Point v = toValue(e.getPoint());
            // 端点 x 固定，只改 y
            if (dragPoint.x == 0 || dragPoint.x == 255) {
                dragPoint.y = v.y;
            } else {
                dragPoint.x = v.x;
                dragPoint.y = v.y;
            }
            moved = true;
            frame.curves().setPoints(channel, frame.curves().points(channel));
            frame.refreshView();
            // setPoints 复制了点对象，重新定位拖动点
            for (Point p : frame.curves().points(channel)) {
                if (Math.abs(p.x - dragPoint.x) <= 1 && Math.abs(p.y - dragPoint.y) <= 1) { dragPoint = p; break; }
            }
            repaint();
        }

        @Override protected void paintComponent(Graphics g0) {
            Graphics2D g = (Graphics2D) g0;
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            int s = editorSize(), x0 = ox(), y0 = oy();
            g.setColor(FlatTheme.BG_DARK);
            g.fillRoundRect(x0, y0, s, s, 8, 8);
            g.setColor(FlatTheme.BORDER_SOFT);
            for (int i = 1; i < 4; i++) {
                int p = x0 + s * i / 4;
                g.drawLine(p, y0, p, y0 + s);
                int q = y0 + s * i / 4;
                g.drawLine(x0, q, x0 + s, q);
            }
            // 对角参考线
            g.setColor(FlatTheme.BG_PRESS);
            g.drawLine(x0, y0 + s, x0 + s, y0);
            // 曲线
            int[] lut = frame.curves().lut(channel);
            Color cc = switch (channel) {
                case Curves.R -> new Color(0xFF6B6B);
                case Curves.G -> new Color(0x51CF66);
                case Curves.B -> new Color(0x74C0FF);
                default -> FlatTheme.ACCENT;
            };
            g.setColor(cc);
            g.setStroke(new BasicStroke(1.8f));
            int prevX = x0, prevY = y0 + s - (int) Math.round(lut[0] / 255.0 * s);
            for (int v = 1; v < 256; v++) {
                int x = x0 + (int) Math.round(v / 255.0 * s);
                int y = y0 + s - (int) Math.round(lut[v] / 255.0 * s);
                g.drawLine(prevX, prevY, x, y);
                prevX = x; prevY = y;
            }
            // 控制点
            List<Point> pts = new ArrayList<>(frame.curves().points(channel));
            for (Point p : pts) {
                Point sp = toScreen(p);
                g.setColor(Color.WHITE);
                g.fillOval(sp.x - 4, sp.y - 4, 8, 8);
                g.setColor(cc);
                g.fillOval(sp.x - 3, sp.y - 3, 6, 6);
            }
        }
    }
}
