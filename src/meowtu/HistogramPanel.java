package meowtu;

import meowtu.core.Histogram;
import meowtu.flatui.FlatTheme;

import javax.swing.*;
import java.awt.*;

/** 直方图面板：RGB 叠加 + 明度，可勾选通道，附统计值。 */
public class HistogramPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private Histogram hist;
    private final JCheckBox cbR = new JCheckBox("红", true);
    private final JCheckBox cbG = new JCheckBox("绿", true);
    private final JCheckBox cbB = new JCheckBox("蓝", true);
    private final JCheckBox cbL = new JCheckBox("明度", true);
    private final JLabel stats = new JLabel("—");
    private final HistView view = new HistView();

    public HistogramPanel() {
        super(new BorderLayout(0, 6));
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        JPanel toggles = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 0));
        toggles.setOpaque(false);
        for (JCheckBox cb : new JCheckBox[]{cbR, cbG, cbB, cbL}) {
            cb.setOpaque(false);
            cb.addActionListener(e -> view.repaint());
            toggles.add(cb);
        }
        add(toggles, BorderLayout.NORTH);
        view.setPreferredSize(new Dimension(280, 170));
        add(view, BorderLayout.CENTER);
        stats.setForeground(FlatTheme.TEXT_DIM);
        stats.setFont(stats.getFont().deriveFont(12f));
        add(stats, BorderLayout.SOUTH);
    }

    public void refresh(java.awt.image.BufferedImage img) {
        if (img == null) { hist = null; stats.setText("—"); view.repaint(); return; }
        hist = Histogram.compute(img);
        stats.setText(String.format("<html>明度 均值 %.0f · 中位数 %.0f · 标准差 %.0f<br>R %.0f　G %.0f　B %.0f（通道均值）</html>",
                hist.mean[Histogram.LUM], hist.median[Histogram.LUM], hist.std[Histogram.LUM],
                hist.mean[Histogram.R], hist.mean[Histogram.G], hist.mean[Histogram.B]));
        view.repaint();
    }

    private class HistView extends JComponent {
    private static final long serialVersionUID = 1L;
        @Override protected void paintComponent(Graphics g0) {
            Graphics2D g = (Graphics2D) g0;
            g.setColor(FlatTheme.BG_DARK);
            g.fillRoundRect(0, 0, getWidth(), getHeight(), 8, 8);
            if (hist == null) {
                g.setColor(FlatTheme.TEXT_FAINT);
                g.drawString("无图像", 12, 24);
                return;
            }
            int w = getWidth() - 16, h = getHeight() - 24;
            int x0 = 8, y0 = 8;
            // 以对数尺度绘制，避免峰值压扁
            drawChannel(g, Histogram.LUM, new Color(200, 200, 200, 110), x0, y0, w, h, cbL.isSelected());
            drawChannel(g, Histogram.R, new Color(255, 90, 90, 120), x0, y0, w, h, cbR.isSelected());
            drawChannel(g, Histogram.G, new Color(90, 230, 120, 120), x0, y0, w, h, cbG.isSelected());
            drawChannel(g, Histogram.B, new Color(90, 140, 255, 120), x0, y0, w, h, cbB.isSelected());
            g.setColor(FlatTheme.BORDER_SOFT);
            g.drawLine(x0, y0 + h, x0 + w, y0 + h);
        }

        private void drawChannel(Graphics2D g, int ch, Color color, int x0, int y0, int w, int h, boolean on) {
            if (!on) return;
            double maxLog = Math.log(hist.maxCount(ch) + 1);
            g.setColor(color);
            for (int v = 0; v < 256; v++) {
                int bh = (int) (Math.log(hist.count[ch][v] + 1) / maxLog * h);
                int x = x0 + v * w / 256;
                g.fillRect(x, y0 + h - bh, Math.max(1, w / 256), bh);
            }
        }
    }
}
