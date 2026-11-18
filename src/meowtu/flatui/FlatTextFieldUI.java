package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.basic.BasicTextFieldUI;
import java.awt.*;

/** 输入框委托：底色交给边框绘制（FlatBorders.field 带填充感），此处仅定色板。 */
public class FlatTextFieldUI extends BasicTextFieldUI {

    @Override protected void installDefaults() {
        super.installDefaults();
        JTextField f = (JTextField) getComponent();
        f.setBackground(FlatTheme.BG_DARK);
        f.setForeground(FlatTheme.TEXT);
        f.setCaretColor(FlatTheme.ACCENT);
        f.setSelectionColor(FlatTheme.ACCENT_SOFT);
        f.setSelectedTextColor(FlatTheme.TEXT);
        f.setDisabledTextColor(FlatTheme.TEXT_FAINT);
        if (f.getBorder() == null || f.getBorder() instanceof javax.swing.plaf.UIResource) {
            f.setBorder(FlatBorders.field());
        }
        f.setOpaque(true);
    }

    @Override protected void paintBackground(Graphics g) {
        JTextField f = (JTextField) getComponent();
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.setColor(f.isEnabled() ? FlatTheme.BG_DARK : FlatTheme.BG_PANEL);
        g2.fillRoundRect(0, 0, f.getWidth(), f.getHeight(), FlatTheme.ARC, FlatTheme.ARC);
        g2.dispose();
    }
}
