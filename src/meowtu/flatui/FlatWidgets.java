package meowtu.flatui;

import javax.swing.*;
import java.awt.*;

/** 常用小组件：分组标题、带数值标签的滑杆行、左侧工具按钮。 */
public final class FlatWidgets {
    private FlatWidgets() {}

    /** 面板分组小标题。 */
    public static JLabel section(String text) {
        JLabel l = new JLabel(text);
        l.setAlignmentX(Component.LEFT_ALIGNMENT);
        l.setForeground(FlatTheme.TEXT_DIM);
        l.setFont(l.getFont().deriveFont(Font.BOLD, 12f));
        l.setBorder(BorderFactory.createEmptyBorder(8, 2, 4, 2));
        return l;
    }

    /** 左侧工具栏按钮：图标在上、文字在下，可切换。 */
    public static JToggleButton toolButton(String text, Icon icon, String tip) {
        JToggleButton b = new JToggleButton(text, icon);
        b.setVerticalTextPosition(SwingConstants.BOTTOM);
        b.setHorizontalTextPosition(SwingConstants.CENTER);
        b.setFont(b.getFont().deriveFont(10.5f));
        b.setToolTipText(tip);
        b.setBorder(BorderFactory.createEmptyBorder(6, 2, 5, 2));
        b.setPreferredSize(new Dimension(56, 52));
        b.setMaximumSize(new Dimension(72, 56));
        b.setMinimumSize(new Dimension(48, 48));
        b.setForeground(FlatTheme.TEXT_DIM);
        return b;
    }

    /** 普通命令型工具按钮（非切换）。 */
    public static JButton commandButton(String text, Icon icon, String tip) {
        JButton b = new JButton(text, icon);
        b.setVerticalTextPosition(SwingConstants.BOTTOM);
        b.setHorizontalTextPosition(SwingConstants.CENTER);
        b.setFont(b.getFont().deriveFont(10.5f));
        b.setToolTipText(tip);
        b.setBorder(BorderFactory.createEmptyBorder(6, 2, 5, 2));
        b.setPreferredSize(new Dimension(56, 52));
        b.setMaximumSize(new Dimension(72, 56));
        b.setMinimumSize(new Dimension(48, 48));
        b.setForeground(FlatTheme.TEXT_DIM);
        return b;
    }

    /**
     * 一行参数控件：名称 + 滑杆 + 数值框。
     * 数值框可直接输入；内部用整数刻度，外部通过 scale 换算显示值。
     */
    public static class SliderRow extends JPanel {
        private static final long serialVersionUID = 1L;
        public final JSlider slider;
        public final JTextField valueBox;
        private final double scale;
        private boolean syncing;

        public SliderRow(String name, int min, int max, int def, double scale) {
            super(new BorderLayout(6, 0));
            setAlignmentX(Component.LEFT_ALIGNMENT);
            this.scale = scale;
            setOpaque(false);
            setBorder(BorderFactory.createEmptyBorder(2, 2, 2, 2));
            JLabel lab = new JLabel(name);
            lab.setForeground(FlatTheme.TEXT);
            lab.setPreferredSize(new Dimension(64, 20));
            slider = new JSlider(min, max, def);
            slider.setOpaque(false);
            slider.setPreferredSize(new Dimension(90, 22));
            valueBox = new JTextField(format(def), 4);
            valueBox.setHorizontalAlignment(SwingConstants.CENTER);
            valueBox.setPreferredSize(new Dimension(46, 22));
            add(lab, BorderLayout.WEST);
            add(slider, BorderLayout.CENTER);
            add(valueBox, BorderLayout.EAST);
            slider.addChangeListener(e -> {
                if (!syncing) { syncing = true; valueBox.setText(format(slider.getValue())); syncing = false; }
            });
            valueBox.addActionListener(e -> {
                try {
                    double v = Double.parseDouble(valueBox.getText().trim());
                    int iv = (int) Math.round(v / scale);
                    iv = Math.max(min, Math.min(max, iv));
                    slider.setValue(iv);
                } catch (NumberFormatException ex) {
                    valueBox.setText(format(slider.getValue()));
                }
            });
            // 双击名称重置
            lab.addMouseListener(new java.awt.event.MouseAdapter() {
                @Override public void mouseClicked(java.awt.event.MouseEvent e) {
                    if (e.getClickCount() == 2) slider.setValue(def);
                }
            });
            lab.setToolTipText("双击重置");
        }

        private String format(int iv) {
            double v = iv * scale;
            if (scale >= 1) return Integer.toString((int) v);
            return (v == Math.floor(v)) ? Integer.toString((int) v) : String.format("%.1f", v);
        }

        /** 实际参数值（刻度 × scale）。 */
        public double value() { return slider.getValue() * scale; }

        public void setValueSilently(double v) {
            syncing = true;
            slider.setValue((int) Math.round(v / scale));
            valueBox.setText(format(slider.getValue()));
            syncing = false;
        }
    }
}
