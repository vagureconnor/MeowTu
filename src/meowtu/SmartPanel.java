package meowtu;

import meowtu.core.Img;
import meowtu.core.Lut;
import meowtu.flatui.FlatTheme;
import meowtu.flatui.FlatWidgets;
import meowtu.nl.NlEdit;
import meowtu.nl.NlParse;

import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * 智能页：一句话修图（规则解析，离线）+ LUT 电影调色墙。
 * 一句话修图执行口径：纯全图指令走常驻参数（非破坏、可撤销）；
 * 带区域/虚化/换背景的指令把活动层当前效果烘焙后执行（一步可撤销），与网页版 nledit 口径一致。
 * LUT 墙：8 个内置预设缩略图（当前拼合图的实时预览），点选即设为活动层 LUT 状态；
 * 另可导入 .cube 文件，强度滑杆实时调整。
 */
public class SmartPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final Editor editor;
    private final JTextField input = new JTextField();
    private final JTextArea explain = new JTextArea(4, 20);
    private final JPanel wall = new JPanel(new GridLayout(0, 2, 6, 6));
    private final FlatWidgets.SliderRow lutStrength;
    private NlParse.ParseResult lastParsed;
    private boolean syncing;

    public SmartPanel(MainFrame frame, Editor editor) {
        super(new BorderLayout(0, 8));
        this.frame = frame;
        this.editor = editor;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        JPanel top = new JPanel(new BorderLayout(0, 6));
        top.setOpaque(false);
        JLabel title = new JLabel("一句话修图（离线规则解析）");
        title.setForeground(FlatTheme.TEXT);
        top.add(title, BorderLayout.NORTH);
        JPanel inputRow = new JPanel(new BorderLayout(6, 0));
        inputRow.setOpaque(false);
        input.setToolTipText("例如：让天空更蓝，人像亮一点，背景虚化");
        JButton parseBtn = new JButton("解析");
        parseBtn.addActionListener(e -> doParse());
        input.addActionListener(e -> doParse());
        inputRow.add(input, BorderLayout.CENTER);
        inputRow.add(parseBtn, BorderLayout.EAST);
        top.add(inputRow, BorderLayout.CENTER);
        explain.setEditable(false);
        explain.setLineWrap(true);
        explain.setWrapStyleWord(true);
        explain.setText("输入一句话，点「解析」看我理解成了什么，再点「执行」。听不懂的会如实提示。");
        JButton execBtn = new JButton("执行");
        execBtn.addActionListener(e -> doExecute());
        JPanel south = new JPanel(new BorderLayout(0, 4));
        south.setOpaque(false);
        south.add(new JScrollPane(explain), BorderLayout.CENTER);
        south.add(execBtn, BorderLayout.SOUTH);
        top.add(south, BorderLayout.SOUTH);
        add(top, BorderLayout.NORTH);

        JPanel lutBox = new JPanel(new BorderLayout(0, 6));
        lutBox.setOpaque(false);
        lutBox.setBorder(BorderFactory.createTitledBorder("LUT 电影调色墙"));
        wall.setOpaque(false);
        lutBox.add(new JScrollPane(wall), BorderLayout.CENTER);
        lutStrength = new FlatWidgets.SliderRow("LUT 强度", 0, 100, 100, 1);
        lutStrength.slider.addChangeListener(e -> {
            if (syncing) return;
            Editor.Layer a = editor.activeLayer();
            if (a == null || a.lut == null) return;
            a.lut.strength = lutStrength.value();
            frame.refreshView();
            if (!lutStrength.slider.getValueIsAdjusting()) frame.checkpoint();
        });
        JPanel lutBottom = new JPanel(new BorderLayout(0, 4));
        lutBottom.setOpaque(false);
        lutBottom.add(lutStrength, BorderLayout.NORTH);
        JPanel lutBtns = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        lutBtns.setOpaque(false);
        JButton noneBtn = new JButton("无 LUT");
        noneBtn.addActionListener(e -> { editor.setLut(null); frame.afterLayerChange(); });
        JButton cubeBtn = new JButton("导入 .cube…");
        cubeBtn.addActionListener(e -> importCube());
        lutBtns.add(noneBtn);
        lutBtns.add(cubeBtn);
        lutBottom.add(lutBtns, BorderLayout.SOUTH);
        lutBox.add(lutBottom, BorderLayout.SOUTH);
        add(lutBox, BorderLayout.CENTER);
    }

    private void doParse() {
        String text = input.getText().trim();
        if (text.isEmpty()) return;
        lastParsed = NlParse.parse(text);
        StringBuilder sb = new StringBuilder(lastParsed.describe());
        if (!lastParsed.unsupported.isEmpty())
            sb.append("\n暂不支持：").append(String.join("、", lastParsed.unsupported)).append("（已跳过，其余照常执行）");
        if (!lastParsed.unknown.isEmpty() && lastParsed.ops.isEmpty())
            sb.append("\n没听懂这句，换个说法试试（例如：让天空更蓝 / 照片太暗了 / 亮度加20）");
        explain.setText(sb.toString());
    }

    private void doExecute() {
        if (!editor.hasImage()) { frame.setStatus("先打开一张图片"); return; }
        if (lastParsed == null) doParse();
        if (lastParsed == null || (lastParsed.ops.isEmpty() && lastParsed.unsupported.isEmpty())) {
            frame.setStatus("没有可执行的指令");
            return;
        }
        NlEdit.Plan plan = NlEdit.plan(lastParsed);
        boolean regional = !plan.jobs.isEmpty();
        if (!regional) {
            // 纯全图：走常驻参数 + 滤镜状态，非破坏
            for (NlParse.Op op : plan.resets) {
                if ("all".equals(op.region)) { editor.resetAdjust(); editor.clearFilter(); }
            }
            NlEdit.applyDelta(editor.params(), lastParsed);
            for (java.util.Map.Entry<String, Double> e : plan.absolutes.entrySet())
                setParamAbs(editor.params(), e.getKey(), e.getValue());
            if (plan.filter != null) {
                if (plan.filter.params != null && !plan.filter.params.isEmpty()) editor.setFilterParams(plan.filter.id, plan.filter.params);
                else editor.setFilter(plan.filter.id, 1.0);
            }
            frame.refreshView();
            frame.checkpoint();
            frame.setStatus("一句话修图已执行（参数可继续微调，可撤销）");
        } else {
            // 带区域效果：烘焙活动层当前效果后执行（一步可撤销）
            BufferedImage src = editor.renderActiveLayerCanvas();
            if (src == null) { frame.setStatus("活动层是调整层，区域修图请先选中像素图层"); return; }
            BufferedImage out = NlEdit.apply(src, lastParsed);
            editor.commitImage(out);
            frame.afterLayerChange();
            frame.setStatus("一句话修图已执行（区域效果已烘焙到活动层，可撤销）");
        }
    }

    private static void setParamAbs(meowtu.core.AdjustParams p, String key, double v) {
        switch (key) {
            case "exposure" -> p.exposure = v;
            case "brightness" -> p.brightness = v;
            case "contrast" -> p.contrast = v;
            case "temperature" -> p.temperature = v;
            case "tint" -> p.tint = v;
            case "saturation" -> p.saturation = v;
            case "vibrance" -> p.vibrance = v;
            case "highlights" -> p.highlights = v;
            case "shadows" -> p.shadows = v;
            case "whites" -> p.whites = v;
            case "blacks" -> p.blacks = v;
            case "clarity" -> p.clarity = v;
            case "sharpen" -> p.sharpen = v;
            default -> { }
        }
    }

    private void importCube() {
        if (!editor.hasImage()) { frame.setStatus("先打开一张图片"); return; }
        JFileChooser fc = new JFileChooser();
        fc.setFileFilter(new javax.swing.filechooser.FileNameExtensionFilter("LUT 文件", "cube"));
        if (fc.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File f = fc.getSelectedFile();
        try {
            String text = java.nio.file.Files.readString(f.toPath(), java.nio.charset.StandardCharsets.UTF_8);
            Lut.parseCube(text); // 先校验，坏文件直接报错不动状态
            Lut.State st = new Lut.State();
            st.id = "custom";
            st.cube = text;
            st.name = f.getName();
            st.strength = lutStrength.value();
            editor.setLut(st);
            frame.afterLayerChange();
            frame.setStatus("已导入 LUT：" + f.getName());
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "导入失败：" + ex.getMessage(), "喵图", JOptionPane.ERROR_MESSAGE);
        }
    }

    /** 引擎状态变化后重建调色墙缩略图并回填强度。 */
    public void refreshWall() {
        wall.removeAll();
        BufferedImage flat = editor.hasImage() ? editor.bakeCurrent() : null;
        if (flat != null) {
            BufferedImage small = Img.downscale(flat, 160);
            for (String[] preset : Lut.PRESETS) {
                BufferedImage t = Lut.apply(small, new Lut.State(preset[0], 100));
                JButton b = new JButton(preset[1], new ImageIcon(t));
                b.setVerticalTextPosition(SwingConstants.BOTTOM);
                b.setHorizontalTextPosition(SwingConstants.CENTER);
                b.setFont(b.getFont().deriveFont(11f));
                String id = preset[0];
                b.addActionListener(e -> {
                    Lut.State st = new Lut.State(id, lutStrength.value());
                    editor.setLut(st);
                    frame.afterLayerChange();
                    frame.setStatus("LUT：" + preset[1]);
                });
                wall.add(b);
            }
        }
        wall.revalidate();
        wall.repaint();
        Editor.Layer a = editor.activeLayer();
        syncing = true;
        try { lutStrength.setValueSilently(a != null && a.lut != null ? a.lut.strength : 100); }
        finally { syncing = false; }
    }
}
