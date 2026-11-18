package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicTabbedPaneUI;
import java.awt.*;

/** 扁平标签页委托：无边框，选中页底部 2px 强调蓝线 + 文字提亮。 */
public class FlatTabbedPaneUI extends BasicTabbedPaneUI {

    @Override protected void installDefaults() {
        super.installDefaults();
        tabAreaInsets = new Insets(4, 6, 0, 6);
        tabInsets = new Insets(6, 12, 7, 12);
        selectedTabPadInsets = new Insets(0, 0, 0, 0);
        contentBorderInsets = new Insets(0, 0, 0, 0);
        tabRunOverlay = 0;
        lightHighlight = FlatTheme.BG;
        shadow = FlatTheme.BG;
        darkShadow = FlatTheme.BG;
        focus = FlatTheme.ACCENT;
    }

    @Override protected int calculateTabWidth(int tabPlacement, int tabIndex, FontMetrics metrics) {
        return super.calculateTabWidth(tabPlacement, tabIndex, metrics) + 6;
    }

    @Override protected void paintTabBackground(Graphics g, int tabPlacement, int tabIndex,
                                                int x, int y, int w, int h, boolean isSelected) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        if (isSelected) {
            g2.setColor(FlatTheme.BG_PANEL);
            g2.fillRoundRect(x, y, w, h + 8, 8, 8);
            g2.setColor(FlatTheme.ACCENT);
            g2.fillRect(x + 8, y + h - 2, w - 16, 2);
        } else if (getRolloverTab() == tabIndex) {
            g2.setColor(FlatTheme.BG_RAISED);
            g2.fillRoundRect(x, y, w, h + 8, 8, 8);
        }
        g2.dispose();
    }

    @Override protected void paintTabBorder(Graphics g, int tabPlacement, int tabIndex,
                                            int x, int y, int w, int h, boolean isSelected) { /* 无边 */ }

    @Override protected void paintContentBorder(Graphics g, int tabPlacement, int selectedIndex) {
        int w = tabPane.getWidth(), h = tabPane.getHeight();
        Insets insets = tabPane.getInsets();
        int x = insets.left, y = insets.top;
        int tabAreaH = calculateTabAreaHeight(tabPlacement, runCount, maxTabHeight);
        g.setColor(FlatTheme.BORDER_SOFT);
        g.fillRect(x, y + tabAreaH, w - insets.left - insets.right, 1);
    }

    @Override protected void paintText(Graphics g, int tabPlacement, Font font, FontMetrics metrics,
                                       int tabIndex, String title, Rectangle textRect, boolean isSelected) {
        g.setFont(font);
        g.setColor(!tabPane.isEnabledAt(tabIndex) ? FlatTheme.TEXT_FAINT
                : isSelected ? FlatTheme.TEXT : FlatTheme.TEXT_DIM);
        int x = textRect.x + (textRect.width - metrics.stringWidth(title)) / 2;
        int y = textRect.y + (textRect.height + metrics.getAscent()) / 2 - 2;
        g.drawString(title, x, y);
    }

    @Override protected void paintIcon(Graphics g, int tabPlacement, int tabIndex, Icon icon,
                                       Rectangle iconRect, boolean isSelected) {
        if (icon != null) icon.paintIcon(tabPane, g, iconRect.x, iconRect.y);
    }

    @Override protected void paintFocusIndicator(Graphics g, int tabPlacement, Rectangle[] rects,
                                                 int tabIndex, Rectangle iconRect, Rectangle textRect,
                                                 boolean isSelected) { /* 不画虚线焦点框 */ }
}
