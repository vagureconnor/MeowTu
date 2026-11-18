package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicCheckBoxUI;
import java.awt.*;

/** 复选框委托：圆角方框图标，选中时蓝底白勾。 */
public class FlatCheckBoxUI extends BasicCheckBoxUI {

    private static final Icon ICON = new CheckIcon();

    @Override public Icon getDefaultIcon() { return ICON; }

    @Override public synchronized void paint(Graphics g, JComponent c) {
        AbstractButton b = (AbstractButton) c;
        b.setForeground(FlatTheme.TEXT);
        super.paint(g, c);
    }

    private static class CheckIcon implements Icon {
        @Override public int getIconWidth() { return 16; }
        @Override public int getIconHeight() { return 16; }

        @Override public void paintIcon(Component c, Graphics g, int x, int y) {
            AbstractButton b = (AbstractButton) c;
            ButtonModel m = b.getModel();
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            boolean selected = m.isSelected();
            if (selected) {
                g2.setColor(b.isEnabled() ? FlatTheme.ACCENT : FlatTheme.ACCENT_SOFT);
                g2.fillRoundRect(x, y, 15, 15, 5, 5);
                g2.setColor(Color.WHITE);
                g2.setStroke(new BasicStroke(2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                g2.drawLine(x + 4, y + 8, x + 7, y + 11);
                g2.drawLine(x + 7, y + 11, x + 12, y + 4);
            } else {
                g2.setColor(FlatTheme.BG_DARK);
                g2.fillRoundRect(x, y, 15, 15, 5, 5);
                g2.setColor(m.isRollover() ? FlatTheme.TEXT_DIM : FlatTheme.BORDER);
                g2.drawRoundRect(x, y, 15, 15, 5, 5);
            }
            g2.dispose();
        }
    }
}
