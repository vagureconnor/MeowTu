package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicMenuBarUI;
import java.awt.*;

/** 菜单栏委托：纯色深底（Metal 自带菜单栏会画浅色渐变，必须替换）。 */
public class FlatMenuBarUI extends BasicMenuBarUI {
    public static javax.swing.plaf.ComponentUI createUI(JComponent c) { return new FlatMenuBarUI(); }

    @Override public void paint(Graphics g, JComponent c) {
        g.setColor(FlatTheme.BG_PANEL);
        g.fillRect(0, 0, c.getWidth(), c.getHeight());
        g.setColor(FlatTheme.BORDER_SOFT);
        g.fillRect(0, c.getHeight() - 1, c.getWidth(), 1);
    }
}
