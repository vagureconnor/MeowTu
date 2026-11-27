package meowtu;

import java.awt.image.BufferedImage;

/**
 * 图层样式接入点：把 Editor.Layer.style（styles.js 的 style 对象 JSON 模型）交给
 * meowtu.core.LayerStyles 生成内部/外部油漆并接入合成。样式关闭或未接入时恒等。
 * 内部油漆（颜色叠加/内阴影/内发光/斜面/内描边）直接改在已生效像素上（保持层 alpha）；
 * 外部油漆（投影/外发光/外描边）作为一张 ARGB 图先于该层合成到累积结果上。
 */
final class StylesBridge {
    private StylesBridge() {}

    /** 内部样式：返回处理后的已生效像素（无样式时原样返回）。 */
    static BufferedImage applyInternal(BufferedImage rendered, Editor.Layer l) {
        if (l.style == null || rendered == null) return rendered;
        try {
            return meowtu.core.LayerStyles.applyInternal(rendered, l.style, maskOf(l, rendered));
        } catch (Throwable t) {
            return rendered; // 样式异常不影响合成（与网页版 try/catch 口径一致）
        }
    }

    /** 外部样式油漆（ARGB 打包像素，文档尺寸）；无外部样式时返回 null。 */
    static int[] externalPaint(Editor.Layer l, BufferedImage rendered, int w, int h) {
        if (l.style == null || rendered == null) return null;
        try {
            return meowtu.core.LayerStyles.externalPaint(rendered, l.style, maskOf(l, rendered), w, h);
        } catch (Throwable t) {
            return null;
        }
    }

    private static byte[] maskOf(Editor.Layer l, BufferedImage rendered) {
        if (l.mask == null || !l.maskEnabled) return null;
        BufferedImage m = l.mask;
        if (m.getWidth() != rendered.getWidth() || m.getHeight() != rendered.getHeight())
            m = meowtu.core.Img.resize(m, rendered.getWidth(), rendered.getHeight());
        int[] px = meowtu.core.Img.pixels(m);
        byte[] out = new byte[px.length];
        for (int i = 0; i < px.length; i++) out[i] = (byte) ((px[i] >> 16) & 0xFF);
        return out;
    }
}
