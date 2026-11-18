package meowtu.core;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.Locale;

/** 图像文件读写：ImageIO 格式 + 手写 PPM/PGM；导出支持缩放与 JPEG 质量。 */
public final class Formats {
    private Formats() {}

    public static final String[] SAVE_FORMATS = {"png", "jpg", "bmp", "gif", "tiff", "ppm", "pgm"};

    public static String extension(File f) {
        String n = f.getName();
        int i = n.lastIndexOf('.');
        return i < 0 ? "" : n.substring(i + 1).toLowerCase(Locale.ROOT);
    }

    /** 打开图片：先嗅探 PNM 魔数，其余交给 ImageIO；结果统一为 ARGB 拷贝。 */
    public static BufferedImage load(File f) throws IOException {
        byte[] head = new byte[16];
        try (FileInputStream in = new FileInputStream(f)) {
            int n = in.read(head);
            if (n >= 2 && PpmCodec.isPnm(head)) return PpmCodec.read(f);
        }
        BufferedImage img = ImageIO.read(f);
        if (img == null) throw new IOException("无法识别的图片格式：" + f.getName());
        return Img.copy(img);
    }

    /**
     * 保存/导出。
     * @param format png/jpg/bmp/gif/tiff/ppm/pgm
     * @param quality JPEG 质量 0..1（仅 jpg 用，其余忽略）
     * @param scalePercent 导出缩放百分比 1..400
     */
    public static void save(File f, BufferedImage img, String format, float quality, int scalePercent) throws IOException {
        BufferedImage out = img;
        if (scalePercent != 100) {
            int w = Math.max(1, img.getWidth() * scalePercent / 100);
            int h = Math.max(1, img.getHeight() * scalePercent / 100);
            out = Img.resize(img, w, h);
        }
        switch (format.toLowerCase(Locale.ROOT)) {
            case "ppm" -> PpmCodec.writePpm(f, out);
            case "pgm" -> PpmCodec.writePgm(f, out);
            case "jpg", "jpeg" -> writeJpeg(f, flattenForJpeg(out), quality);
            case "png", "bmp", "gif", "tiff" -> {
                BufferedImage toWrite = format.equals("bmp") || format.equals("gif") ? flattenOnWhite(out) : out;
                if (!ImageIO.write(toWrite, format, f)) throw new IOException("当前环境不支持写出 " + format);
            }
            default -> throw new IOException("不支持的格式：" + format);
        }
    }

    /** JPEG 无 alpha：透明处合成白底。 */
    private static BufferedImage flattenForJpeg(BufferedImage img) {
        return flattenOnWhite(img);
    }

    private static BufferedImage flattenOnWhite(BufferedImage img) {
        BufferedImage out = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = out.createGraphics();
        g.setColor(java.awt.Color.WHITE);
        g.fillRect(0, 0, out.getWidth(), out.getHeight());
        g.drawImage(img, 0, 0, null);
        g.dispose();
        return out;
    }

    private static void writeJpeg(File f, BufferedImage img, float quality) throws IOException {
        Iterator<ImageWriter> it = ImageIO.getImageWritersByFormatName("jpg");
        if (!it.hasNext()) throw new IOException("无 JPEG 写出器");
        ImageWriter writer = it.next();
        try (ImageOutputStream ios = ImageIO.createImageOutputStream(f)) {
            writer.setOutput(ios);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(Math.max(0.05f, Math.min(1f, quality)));
            writer.write(null, new IIOImage(img, null, null), param);
        } finally {
            writer.dispose();
        }
    }

    /** 文件选择器用的扩展名过滤描述。 */
    public static boolean isImageFile(File f) {
        String e = extension(f);
        return switch (e) {
            case "png", "jpg", "jpeg", "bmp", "gif", "tiff", "tif", "ppm", "pgm", "webp" -> true;
            default -> false;
        };
    }
}
