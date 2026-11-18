import javax.swing.*;
import java.awt.*;

// CheerpJ 试跑件：最小 Swing 窗口，验证 JAR 与浏览器运行环境
public class HelloSwing {
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame f = new JFrame("喵图 MeowTu · CheerpJ 试跑");
            f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
            JLabel label = new JLabel("等待点击", SwingConstants.CENTER);
            JButton btn = new JButton("点我验证");
            btn.addActionListener(e -> label.setText("按钮可点，Swing 运行正常 ✔"));
            f.setLayout(new BorderLayout());
            f.add(label, BorderLayout.CENTER);
            f.add(btn, BorderLayout.SOUTH);
            f.setSize(420, 240);
            f.setLocationRelativeTo(null);
            f.setVisible(true);
            System.out.println("SPIKE_WINDOW_SHOWN");
        });
    }
}
