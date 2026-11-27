package meowtu;

import meowtu.core.Img;
import meowtu.filters.Filters;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.util.HashMap;
import java.util.Map;

/**
 * 滤镜面板：缩略图列表 + 强度滑杆 + 「无滤镜」按钮。
 * 滤镜是状态式（与网页版同语义）：点选条目即设为当前滤镜，列表选中态就是当前滤镜高亮；
 * 重复点同一个不叠加，点另一个直接替换，点「无滤镜」取消；强度滑杆拖动实时改、松手记检查点。
 */
public class FiltersPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final DefaultListModel<Filters.Def> model = new DefaultListModel<>();
    private final JList<Filters.Def> list = new JList<>(model);
    private final FlatWidgets.SliderRow strength;
    private final JButton noneBtn = new JButton("无滤镜");
    private final Map<String, Icon> thumbs = new HashMap<>();
    private BufferedImage thumbSource;
    private boolean syncing;   // 程序回填选中态/滑杆时屏蔽监听器，避免反馈回路

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
        JScrollPane sp = new JScrollPane(list);
        sp.setBorder(BorderFactory.createEmptyBorder());
        add(sp, BorderLayout.CENTER);

        JPanel bottom = new JPanel(new BorderLayout(0, 4));
        bottom.setOpaque(false);
        strength = new FlatWidgets.SliderRow("强度", 0, 100, 100, 1);
        strength.slider.addChangeListener(e -> {
            if (syncing) return;
            frame.setFilterStrengthLive(strength.value() / 100.0);
            if (!strength.slider.getValueIsAdjusting()) frame.checkpoint();
        });
        list.addListSelectionListener(e -> {
            if (syncing || e.getValueIsAdjusting()) return;
            Filters.Def d = list.getSelectedValue();
            if (d != null) frame.setFilter(d.id, strength.value() / 100.0);
        });
        bottom.add(strength, BorderLayout.NORTH);
        noneBtn.addActionListener(e -> frame.clearFilter());
        JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        row.setOpaque(false);
        row.add(noneBtn);
        JLabel hint = new JLabel("点选即生效，可撤销");
        hint.setForeground(meowtu.flatui.FlatTheme.TEXT_FAINT);
        hint.setFont(hint.getFont().deriveFont(11f));
        row.add(hint);
        bottom.add(row, BorderLayout.SOUTH);
        add(bottom, BorderLayout.SOUTH);
    }

    /** 把引擎的当前滤镜状态回填到面板：列表选中态（高亮）+ 强度滑杆 + 「无滤镜」按钮态。撤销/重做/切换滤镜后调用。 */
    public void syncFromEngine() {
        syncing = true;
        try {
            String active = frame.activeFilter();
            if (active == null) {
                list.clearSelection();
            } else {
                for (int i = 0; i < model.getSize(); i++) {
                    if (model.getElementAt(i).id.equals(active)) {
                        list.setSelectedIndex(i);
                        list.ensureIndexIsVisible(i);
                        break;
                    }
                }
            }
            strength.setValueSilently(frame.filterStrength() * 100.0);
            noneBtn.putClientProperty("flat.primary", active == null ? Boolean.TRUE : null);
            noneBtn.setEnabled(frame.hasImage() && active != null);
        } finally {
            syncing = false;
        }
        list.repaint();
        noneBtn.repaint();
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
