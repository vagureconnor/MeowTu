package meowtu;

import meowtu.flatui.FlatTheme;

import javax.swing.*;

/** 喵图 MeowTu 入口：装配自写深色主题后打开主窗口。 */
public class Main {
    public static void main(String[] args) {
        System.setProperty("swing.aatext", "true");
        FlatTheme.install();
        SwingUtilities.invokeLater(() -> new MainFrame().setVisible(true));
    }
}
