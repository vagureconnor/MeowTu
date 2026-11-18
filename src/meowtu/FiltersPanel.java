package meowtu;

import meowtu.core.Img;
import meowtu.filters.Filters;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.util.HashMap;
import java.util.Map;

/** 滤镜面板：缩略图列表 + 强度滑杆，选中预览、点应用提交。 */
public class FiltersPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final DefaultListModel<Filters.Def> model = new DefaultListModel<>();
    private final JList<Filters.Def> list = new JList<>(model);
    private final FlatWidgets.SliderRow strength;
    private final Map<String, Icon> thumbs = new HashMap<>();
    private BufferedImage thumbSource;

    public FiltersPanel(MainFrame frame) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        for (Filters.Def d : Filters.all()) model.addElement(d);
        list.setCellRenderer(new ThumbRenderer());
        list.setBackground(meowtu.flatui.FlatTheme.BG_PANEL);
        list.setForeground(meowtu.flatui.FlatTheme.TEXT);
        list.setSelectionBackground(meowtu.flatui.FlatTheme.ACCENT_SOFT);
        list.setSelectionForeground(meowtu.flatui.FlatTheme.TEXT);
        list.setFixedCellHeight(62);
        list.addListSelectionListener(e -> { if (!e.getValueIsAdjusting()) preview(); });
        list.addMouseListener(new java.awt.event.MouseAdapter() {
            @Override public void mouseClicked(java.awt.event.MouseEvent e) {
                if (e.getClickCount() == 2) applyCurrent();
            }
        });
        JScrollPane sp = new JScrollPane(list);
        sp.setBorder(BorderFactory.createEmptyBorder());
        add(sp, BorderLayout.CENTER);

        JPanel bottom = new JPanel(new BorderLayout(0, 4));
        bottom.setOpaque(false);
        strength = new FlatWidgets.SliderRow("强度", 0, 100, 100, 1);
        strength.slider.addChangeListener(e -> preview());
        bottom.add(strength, BorderLayout.NORTH);
        JButton apply = new JButton("应用滤镜");
        apply.putClientProperty("flat.primary", Boolean.TRUE);
        apply.addActionListener(e -> applyCurrent());
        JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        row.setOpaque(false);
        row.add(apply);
        JLabel hint = new JLabel("双击条目直接应用");
        hint.setForeground(meowtu.flatui.FlatTheme.TEXT_FAINT);
        hint.setFont(hint.getFont().deriveFont(11f));
        row.add(hint);
        bottom.add(row, BorderLayout.SOUTH);
        add(bottom, BorderLayout.SOUTH);
    }

    private void preview() {
        Filters.Def d = list.getSelectedValue();
        if (d == null || !frame.hasImage()) return;
        frame.previewFilter(d.id, strength.value() / 100.0);
    }

    private void applyCurrent() {
        Filters.Def d = list.getSelectedValue();
        if (d == null || !frame.hasImage()) return;
        frame.commitFilter(d.id, strength.value() / 100.0);
        refreshThumbs(true);
    }

    /** 图像变化后重建缩略图（源图引用变化才重建）。 */
    public void refreshThumbs(boolean force) {
        BufferedImage base = frame.baseImage();
        if (base == null) { thumbs.clear(); list.repaint(); return; }
        if (!force && base == thumbSource) return;
        thumbSource = base;
        thumbs.clear();
        BufferedImage small = Img.downscale(base, 144);
        for (Filters.Def d : Filters.all()) {
            BufferedImage t = Filters.apply(d.id, small, 1.0);
            thumbs.put(d.id, new ImageIcon(t));
        }
        list.repaint();
    }

    private class ThumbRenderer extends DefaultListCellRenderer {
    private static final long serialVersionUID = 1L;
        @Override public Component getListCellRendererComponent(JList<?> l, Object value, int index,
                                                                 boolean selected, boolean focus) {
            Filters.Def d = (Filters.Def) value;
            JLabel lab = (JLabel) super.getListCellRendererComponent(l, "  " + d.name, index, selected, focus);
            lab.setIcon(thumbs.get(d.id));
            lab.setIconTextGap(10);
            lab.setBorder(BorderFactory.createEmptyBorder(4, 6, 4, 6));
            return lab;
        }
    }
}
