package meowtu;

import meowtu.flatui.FlatTheme;

import javax.swing.*;
import java.awt.*;

/**
 * 历史记录面板：列出当前点前后的步骤数，点击任意条目即连按撤销/重做到达该点
 * （与网页版历史面板同一交互口径；步骤深度来自 Editor 的历史栈）。
 */
public class HistoryPanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private final MainFrame frame;
    private final Editor editor;
    private final DefaultListModel<String> model = new DefaultListModel<>();
    private final JList<String> list = new JList<>(model);
    private boolean syncing;

    public HistoryPanel(MainFrame frame, Editor editor) {
        super(new BorderLayout(0, 6));
        this.frame = frame;
        this.editor = editor;
        setOpaque(false);
        setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        list.setBackground(FlatTheme.BG_PANEL);
        list.setForeground(FlatTheme.TEXT);
        list.setSelectionBackground(FlatTheme.ACCENT_SOFT);
        list.setFixedCellHeight(24);
        list.addListSelectionListener(e -> {
            if (syncing || e.getValueIsAdjusting()) return;
            int sel = list.getSelectedIndex();
            if (sel < 0) return;
            int undoDepth = editor.undoDepth();
            // 条目自上而下：最早 → 当前 → 可重做；sel 与当前点的距离决定按几下
            int delta = sel - undoDepth; // >0 需重做，<0 需撤销
            boolean moved = false;
            while (delta < 0) { if (!editor.undo()) break; delta++; moved = true; }
            while (delta > 0) { if (!editor.redo()) break; delta--; moved = true; }
            if (moved) frame.afterHistoryJump();
            else syncFromEngine();
        });
        add(new JScrollPane(list), BorderLayout.CENTER);
        JLabel hint = new JLabel("点击任意一步直接跳过去");
        hint.setForeground(FlatTheme.TEXT_FAINT);
        hint.setFont(hint.getFont().deriveFont(11f));
        add(hint, BorderLayout.SOUTH);
    }

    public void syncFromEngine() {
        syncing = true;
        try {
            model.clear();
            int u = editor.undoDepth(), r = editor.redoDepth();
            for (int i = 0; i < u; i++) model.addElement("步骤（可撤销 " + (u - i) + "）");
            model.addElement("▶ 当前状态");
            for (int i = 0; i < r; i++) model.addElement("步骤（可重做 " + (i + 1) + "）");
            if (u + r + 1 > 0) list.setSelectedIndex(u);
        } finally {
            syncing = false;
        }
    }
}
