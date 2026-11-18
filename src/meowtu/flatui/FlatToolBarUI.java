package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicToolBarUI;
import java.awt.*;

/** 工具栏委托：无拖拽把手，底色与主题一致。 */
public class FlatToolBarUI extends BasicToolBarUI {
    public static javax.swing.plaf.ComponentUI createUI(JComponent c) { return new FlatToolBarUI(); }
    @Override protected void paintDragWindow(Graphics g) { /* 不画拖拽窗 */ }

    @Override public void paint(Graphics g, JComponent c) {
        g.setColor(FlatTheme.BG);
        g.fillRect(0, 0, c.getWidth(), c.getHeight());
    }
}
