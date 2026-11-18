package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicScrollPaneUI;
import java.awt.*;

/** 滚动面板委托：保证底色一致。 */
public class FlatScrollPaneUI extends BasicScrollPaneUI {
    @Override public void paint(Graphics g, JComponent c) {
        g.setColor(FlatTheme.BG);
        g.fillRect(0, 0, c.getWidth(), c.getHeight());
        super.paint(g, c);
    }
}
