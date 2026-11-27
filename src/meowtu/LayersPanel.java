package meowtu;

import meowtu.core.Blend;
import meowtu.flatui.FlatTheme;
import meowtu.flatui.FlatWidgets;

import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;

/**
 * 图层面板：图层列表（自上而下 = 顶层到顶层，与网页版面板同序显示、内部自下而上存储）、
 * 可见开关、不透明度、混合模式（27 种，与网页版同 id），以及新建/调整层/复制/删除/
 * 上移/下移/向下合并/拼合。所有结构操作一步可撤销（Editor 负责入栈）。
 */
public class LayersPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final Editor editor;
    private final DefaultListModel<String> model = new DefaultListModel<>();
    private final JList<String> list = new JList<>(model);
    private final FlatWidgets.SliderRow opacity;
    private final JComboBox<String> blendBox = new JComboBox<>(Blend.MODES);
    private boolean syncing;

    public LayersPanel(MainFrame frame, Editor editor) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        this.editor = editor;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        list.setBackground(FlatTheme.BG_PANEL);
        list.setForeground(FlatTheme.TEXT);
        list.setSelectionBackground(FlatTheme.ACCENT_SOFT);
        list.setFixedCellHeight(30);
        list.setCellRenderer(new DefaultListCellRenderer() {
            @Override public Component getListCellRendererComponent(JList<?> l, Object v, int i, boolean s, boolean f) {
                JLabel lab = (JLabel) super.getListCellRendererComponent(l, v, i, s, f);
                int layerIdx = editor.layerCount() - 1 - i;
                if (layerIdx >= 0 && layerIdx < editor.layerCount()) {
                    Editor.Layer layer = editor.layerAt(layerIdx);
                    lab.setText(layer.name + (layer.kind.equals("adj") ? "（调整）" : "") + (layer.visible ? "" : "（隐藏）"));
                    if (!layer.visible) lab.setForeground(FlatTheme.TEXT_FAINT);
                }
                return lab;
            }
        });
        list.addListSelectionListener(e -> {
            if (syncing || e.getValueIsAdjusting()) return;
            int sel = list.getSelectedIndex();
            if (sel < 0) return;
            editor.setActiveLayer(editor.layerCount() - 1 - sel);
            frame.onActiveLayerChanged();
        });
        add(new JScrollPane(list), BorderLayout.CENTER);

        JPanel bottom = new JPanel();
        bottom.setOpaque(false);
        bottom.setLayout(new BoxLayout(bottom, BoxLayout.Y_AXIS));
        opacity = new FlatWidgets.SliderRow("不透明度", 0, 100, 100, 1);
        opacity.slider.addChangeListener(e -> {
            if (syncing) return;
            Editor.Layer a = editor.activeLayer();
            if (a == null) return;
            // 拖动实时改数值（不入栈），松手记一步
            a.opacity = opacity.value() / 100.0;
            frame.refreshView();
            if (!opacity.slider.getValueIsAdjusting()) frame.checkpointLayerProps();
        });
        bottom.add(opacity);
        JPanel blendRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        blendRow.setOpaque(false);
        blendRow.add(new JLabel("混合模式"));
        blendBox.addActionListener(e -> {
            if (syncing) return;
            Editor.Layer a = editor.activeLayer();
            if (a == null) return;
            editor.setLayerProps(editor.activeIndex(), null, null, (String) blendBox.getSelectedItem());
            frame.afterLayerChange();
        });
        blendRow.add(blendBox);
        bottom.add(blendRow);
        JPanel btns = new JPanel(new GridLayout(2, 4, 4, 4));
        btns.setOpaque(false);
        btns.add(smallBtn("新建层", () -> {
            BufferedImage base = editor.base();
            if (base == null) return;
            BufferedImage blank = new BufferedImage(base.getWidth(), base.getHeight(), BufferedImage.TYPE_INT_ARGB);
            editor.addLayer(blank, null);
            frame.afterLayerChange();
        }));
        btns.add(smallBtn("调整层", () -> { editor.addAdjustmentLayer(); frame.afterLayerChange(); }));
        btns.add(smallBtn("复制层", () -> { editor.duplicateLayer(editor.activeIndex()); frame.afterLayerChange(); }));
        btns.add(smallBtn("删除层", () -> { if (editor.deleteLayer(editor.activeIndex())) frame.afterLayerChange(); }));
        btns.add(smallBtn("上移", () -> { int i = editor.activeIndex(); if (editor.moveLayer(i, i + 1)) frame.afterLayerChange(); }));
        btns.add(smallBtn("下移", () -> { int i = editor.activeIndex(); if (editor.moveLayer(i, i - 1)) frame.afterLayerChange(); }));
        btns.add(smallBtn("向下合并", () -> { if (editor.mergeDown(editor.activeIndex())) frame.afterLayerChange(); else frame.setStatus("无法向下合并（下层是调整层或已是最底层）"); }));
        btns.add(smallBtn("拼合", () -> { if (editor.flatten()) frame.afterLayerChange(); }));
        bottom.add(btns);
        add(bottom, BorderLayout.SOUTH);
    }

    private JButton smallBtn(String text, Runnable r) {
        JButton b = new JButton(text);
        b.setFont(b.getFont().deriveFont(11f));
        b.addActionListener(e -> r.run());
        return b;
    }

    /** 引擎状态变化后回填列表与活动层属性控件。 */
    public void syncFromEngine() {
        syncing = true;
        try {
            model.clear();
            for (int i = editor.layerCount() - 1; i >= 0; i--) model.addElement(editor.layerAt(i).name);
            if (editor.layerCount() > 0) list.setSelectedIndex(editor.layerCount() - 1 - editor.activeIndex());
            Editor.Layer a = editor.activeLayer();
            if (a != null) {
                opacity.setValueSilently(a.opacity * 100.0);
                blendBox.setSelectedItem(a.blendMode);
                blendBox.setEnabled(!a.kind.equals("adj"));
            }
        } finally {
            syncing = false;
        }
        list.repaint();
    }
}
