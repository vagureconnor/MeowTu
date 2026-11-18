package meowtu;

import meowtu.flatui.FlatTheme;

import javax.swing.*;
import java.awt.*;

/** 文字面板：新建/选中文字对象，改字体、字号、颜色、粗斜体、描边，可栅格化。 */
public class TextPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final JTextField content = new JTextField("双击编辑文字");
    private final JComboBox<String> fontBox;
    private final JSpinner sizeSpinner = new JSpinner(new SpinnerNumberModel(48, 8, 400, 2));
    private final JCheckBox boldBox = new JCheckBox("粗体");
    private final JCheckBox italicBox = new JCheckBox("斜体");
    private final JCheckBox outlineBox = new JCheckBox("描边", true);
    private final JButton colorBtn = new JButton("颜色");
    private Color currentColor = Color.WHITE;
    private final DefaultListModel<TextObject> model = new DefaultListModel<>();
    private final JList<TextObject> list = new JList<>(model);
    private boolean syncing;

    public TextPanel(MainFrame frame) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        String[] fonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames();
        fontBox = new JComboBox<>(fonts);
        fontBox.setSelectedItem(Font.SANS_SERIF);

        JPanel form = new JPanel(new GridBagLayout());
        form.setOpaque(false);
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(3, 2, 3, 2);
        c.fill = GridBagConstraints.HORIZONTAL;
        c.gridx = 0; c.gridy = 0; form.add(new JLabel("内容"), c);
        c.gridx = 1; c.weightx = 1; form.add(content, c);
        c.gridx = 0; c.gridy = 1; c.weightx = 0; form.add(new JLabel("字体"), c);
        c.gridx = 1; c.weightx = 1; form.add(fontBox, c);
        c.gridx = 0; c.gridy = 2; c.weightx = 0; form.add(new JLabel("字号"), c);
        c.gridx = 1; form.add(sizeSpinner, c);
        c.gridx = 0; c.gridy = 3; form.add(new JLabel("样式"), c);
        JPanel styleRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        styleRow.setOpaque(false);
        for (JCheckBox cb : new JCheckBox[]{boldBox, italicBox, outlineBox}) { cb.setOpaque(false); styleRow.add(cb); }
        styleRow.add(colorBtn);
        c.gridx = 1; form.add(styleRow, c);
        add(form, BorderLayout.NORTH);

        list.setCellRenderer((l, value, index, selected, focus) -> {
            JLabel lab = new JLabel(value.text == null || value.text.isEmpty() ? "（空文字）" : value.text);
            lab.setOpaque(true);
            lab.setBackground(selected ? FlatTheme.ACCENT_SOFT : FlatTheme.BG_PANEL);
            lab.setForeground(FlatTheme.TEXT);
            lab.setBorder(BorderFactory.createEmptyBorder(4, 8, 4, 8));
            return lab;
        });
        list.setBackground(FlatTheme.BG_PANEL);
        list.addListSelectionListener(e -> { if (!e.getValueIsAdjusting()) loadFromSelection(); });
        JScrollPane sp = new JScrollPane(list);
        sp.setBorder(BorderFactory.createEmptyBorder());
        add(sp, BorderLayout.CENTER);

        JPanel btns = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        btns.setOpaque(false);
        JButton add = new JButton("添加文字");
        add.putClientProperty("flat.primary", Boolean.TRUE);
        add.addActionListener(e -> addText());
        JButton del = new JButton("删除选中");
        del.addActionListener(e -> deleteSelected());
        JButton bake = new JButton("栅格化到图像");
        bake.addActionListener(e -> frame.rasterizeTexts());
        btns.add(add); btns.add(del); btns.add(bake);
        add(btns, BorderLayout.SOUTH);

        colorBtn.addActionListener(e -> {
            Color col = JColorChooser.showDialog(this, "选择文字颜色", currentColor);
            if (col != null) { currentColor = col; pushToSelected(); }
        });
        content.addActionListener(e -> pushToSelected());
        content.getDocument().addDocumentListener(new javax.swing.event.DocumentListener() {
            public void insertUpdate(javax.swing.event.DocumentEvent e) { pushToSelected(); }
            public void removeUpdate(javax.swing.event.DocumentEvent e) { pushToSelected(); }
            public void changedUpdate(javax.swing.event.DocumentEvent e) { pushToSelected(); }
        });
        fontBox.addActionListener(e -> pushToSelected());
        sizeSpinner.addChangeListener(e -> pushToSelected());
        boldBox.addActionListener(e -> pushToSelected());
        italicBox.addActionListener(e -> pushToSelected());
        outlineBox.addActionListener(e -> pushToSelected());
    }

    private void addText() {
        if (!frame.hasImage()) { frame.setStatus("先打开一张图片"); return; }
        java.awt.image.BufferedImage img = frame.baseImage();
        TextObject t = new TextObject(content.getText(), img.getWidth() * 0.08, img.getHeight() * 0.08);
        pushFields(t);
        frame.textObjects().add(t);
        refreshList();
        list.setSelectedValue(t, true);
        frame.setTool(CanvasPanel.Tool.TEXT);
        frame.canvas().repaint();
        frame.setStatus("文字已添加：在画布上拖动可移动位置");
    }

    private void pushFields(TextObject t) {
        t.fontName = (String) fontBox.getSelectedItem();
        t.size = (Integer) sizeSpinner.getValue();
        t.bold = boldBox.isSelected();
        t.italic = italicBox.isSelected();
        t.outline = outlineBox.isSelected();
        t.color = currentColor;
    }

    private void pushToSelected() {
        if (syncing) return;
        TextObject t = list.getSelectedValue();
        if (t == null) return;
        t.text = content.getText();
        pushFields(t);
        frame.canvas().repaint();
    }

    private void loadFromSelection() {
        TextObject t = list.getSelectedValue();
        if (t == null) return;
        syncing = true;
        content.setText(t.text);
        fontBox.setSelectedItem(t.fontName);
        sizeSpinner.setValue(t.size);
        boldBox.setSelected(t.bold);
        italicBox.setSelected(t.italic);
        outlineBox.setSelected(t.outline);
        currentColor = t.color;
        syncing = false;
    }

    private void deleteSelected() {
        TextObject t = list.getSelectedValue();
        if (t == null) return;
        frame.textObjects().remove(t);
        refreshList();
        frame.canvas().repaint();
    }

    public void refreshList() {
        model.clear();
        for (TextObject t : frame.textObjects()) model.addElement(t);
    }

    public TextObject selected() { return list.getSelectedValue(); }
}
