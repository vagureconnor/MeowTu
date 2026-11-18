package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicSeparatorUI;
import java.awt.*;

/** 分隔线委托：1px 软色线。 */
public class FlatSeparatorUI extends BasicSeparatorUI {
    @Override public void paint(Graphics g, JComponent c) {
        g.setColor(FlatTheme.BORDER_SOFT);
        if (((JSeparator) c).getOrientation() == JSeparator.VERTICAL) {
            g.fillRect(c.getWidth() / 2, 2, 1, c.getHeight() - 4);
        } else {
            g.fillRect(2, c.getHeight() / 2, c.getWidth() - 4, 1);
        }
    }

    @Override public Dimension getPreferredSize(JComponent c) {
        if (((JSeparator) c).getOrientation() == JSeparator.VERTICAL) return new Dimension(5, 0);
        return new Dimension(0, 5);
    }
}
