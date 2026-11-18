package meowtu.flatui;

import javax.swing.*;
import javax.swing.plaf.ColorUIResource;
import javax.swing.plaf.FontUIResource;
import java.awt.*;

/**
 * 喵图自写深色主题：颜色常量 + 一次性装配所有 Swing 委托类。
 * 观感对标现代深色编辑器：背景 #2B2B2B 系，强调蓝 #4A9EFF。
 */
public final class FlatTheme {
    public static final Color BG = new Color(0x2B2B2B);
    public static final Color BG_DARK = new Color(0x1E1E1E);
    public static final Color BG_PANEL = new Color(0x323232);
    public static final Color BG_RAISED = new Color(0x3C3C3C);
    public static final Color BG_HOVER = new Color(0x454545);
    public static final Color BG_PRESS = new Color(0x505050);
    public static final Color BORDER = new Color(0x4A4A4A);
    public static final Color BORDER_SOFT = new Color(0x3D3D3D);
    public static final Color TEXT = new Color(0xE8E8E8);
    public static final Color TEXT_DIM = new Color(0xA6A6A6);
    public static final Color TEXT_FAINT = new Color(0x7A7A7A);
    public static final Color ACCENT = new Color(0x4A9EFF);
    public static final Color ACCENT_DARK = new Color(0x2F6FD0);
    public static final Color ACCENT_SOFT = new Color(0x3A5A86);
    public static final Color CANVAS = new Color(0x232323);
    public static final Color CHECKER_A = new Color(0x3A3A3A);
    public static final Color CHECKER_B = new Color(0x2E2E2E);
    public static final Color DANGER = new Color(0xE5534B);
    public static final int ARC = 8;

    private FlatTheme() {}

    /** 在创建任何窗口前调用一次。 */
    public static void install() {
        Font font = new Font(Font.SANS_SERIF, Font.PLAIN, 13);
        FontUIResource fui = new FontUIResource(font);
        UIManager.put("Label.font", fui);
        UIManager.put("Button.font", fui);
        UIManager.put("ToggleButton.font", fui);
        UIManager.put("TextField.font", fui);
        UIManager.put("ComboBox.font", fui);
        UIManager.put("TabbedPane.font", fui);
        UIManager.put("CheckBox.font", fui);
        UIManager.put("Menu.font", fui);
        UIManager.put("MenuItem.font", fui);
        UIManager.put("ToolTip.font", fui);

        UIManager.put("Panel.background", new ColorUIResource(BG));
        UIManager.put("Label.foreground", new ColorUIResource(TEXT));
        UIManager.put("Label.disabledForeground", new ColorUIResource(TEXT_FAINT));

        UIManager.put("ButtonUI", "meowtu.flatui.FlatButtonUI");
        UIManager.put("ToggleButtonUI", "meowtu.flatui.FlatButtonUI");
        UIManager.put("SliderUI", "meowtu.flatui.FlatSliderUI");
        UIManager.put("ScrollBarUI", "meowtu.flatui.FlatScrollBarUI");
        UIManager.put("TabbedPaneUI", "meowtu.flatui.FlatTabbedPaneUI");
        UIManager.put("CheckBoxUI", "meowtu.flatui.FlatCheckBoxUI");
        UIManager.put("ComboBoxUI", "meowtu.flatui.FlatComboBoxUI");
        UIManager.put("TextFieldUI", "meowtu.flatui.FlatTextFieldUI");
        UIManager.put("PasswordFieldUI", "meowtu.flatui.FlatTextFieldUI");
        UIManager.put("ToolBarUI", "meowtu.flatui.FlatToolBarUI");
        UIManager.put("ScrollPaneUI", "meowtu.flatui.FlatScrollPaneUI");
        UIManager.put("SeparatorUI", "meowtu.flatui.FlatSeparatorUI");

        UIManager.put("TextField.background", new ColorUIResource(BG_DARK));
        UIManager.put("TextField.foreground", new ColorUIResource(TEXT));
        UIManager.put("TextField.caretForeground", new ColorUIResource(ACCENT));
        UIManager.put("TextField.selectionBackground", new ColorUIResource(ACCENT_SOFT));
        UIManager.put("TextField.border", FlatBorders.field());

        UIManager.put("ComboBox.background", new ColorUIResource(BG_RAISED));
        UIManager.put("ComboBox.foreground", new ColorUIResource(TEXT));
        UIManager.put("ComboBox.selectionBackground", new ColorUIResource(ACCENT_SOFT));
        UIManager.put("ComboBox.selectionForeground", new ColorUIResource(TEXT));

        UIManager.put("CheckBox.background", new ColorUIResource(BG));
        UIManager.put("CheckBox.foreground", new ColorUIResource(TEXT));

        UIManager.put("TabbedPane.background", new ColorUIResource(BG));
        UIManager.put("TabbedPane.foreground", new ColorUIResource(TEXT_DIM));

        UIManager.put("ScrollPane.background", new ColorUIResource(BG));
        UIManager.put("ScrollPane.border", BorderFactory.createEmptyBorder());
        UIManager.put("Viewport.background", new ColorUIResource(BG));

        UIManager.put("ToolBar.background", new ColorUIResource(BG));
        UIManager.put("ToolBar.border", BorderFactory.createEmptyBorder());

        UIManager.put("Slider.background", new ColorUIResource(BG));
        UIManager.put("Slider.foreground", new ColorUIResource(ACCENT));

        UIManager.put("MenuBar.background", new ColorUIResource(BG_PANEL));
        UIManager.put("Menu.background", new ColorUIResource(BG_PANEL));
        UIManager.put("Menu.foreground", new ColorUIResource(TEXT));
        UIManager.put("PopupMenu.background", new ColorUIResource(BG_PANEL));
        UIManager.put("PopupMenu.border", BorderFactory.createLineBorder(BORDER));
        UIManager.put("MenuItem.background", new ColorUIResource(BG_PANEL));
        UIManager.put("MenuItem.foreground", new ColorUIResource(TEXT));
        UIManager.put("MenuItem.selectionBackground", new ColorUIResource(ACCENT_SOFT));

        UIManager.put("OptionPane.background", new ColorUIResource(BG));
        UIManager.put("OptionPane.messageForeground", new ColorUIResource(TEXT));
        UIManager.put("FileChooser.background", new ColorUIResource(BG));

        UIManager.put("ToolTip.background", new ColorUIResource(BG_RAISED));
        UIManager.put("ToolTip.foreground", new ColorUIResource(TEXT));
        UIManager.put("ToolTip.border", BorderFactory.createLineBorder(BORDER));
    }

    /** 给窗口/对话框统一底色。 */
    public static void paintWindowBackground(JComponent c) {
        c.setBackground(BG);
        c.setForeground(TEXT);
    }
}
