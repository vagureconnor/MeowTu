package meowtu;

import javax.swing.*;
import java.awt.*;

/** 宽度跟随视口的滚动内容面板：防止长行把内容撑出右边界。 */
public class TrackPanel extends JPanel implements Scrollable {
    private static final long serialVersionUID = 1L;

    @Override public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
    @Override public int getScrollableUnitIncrement(Rectangle visibleRect, int orientation, int direction) { return 16; }
    @Override public int getScrollableBlockIncrement(Rectangle visibleRect, int orientation, int direction) { return 64; }
    @Override public boolean getScrollableTracksViewportWidth() { return true; }
    @Override public boolean getScrollableTracksViewportHeight() { return false; }
}
