package meowtu.core;

import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;

/**
 * 手写 PPM/PGM 编解码：支持 P6/P5（二进制）与 P3/P2（ASCII），含注释行解析。
 */
public final class PpmCodec {
    private PpmCodec() {}

    public static boolean isPnm(byte[] head) {
        return head.length >= 2 && head[0] == 'P' && head[1] >= '2' && head[1] <= '6';
    }

    public static BufferedImage read(File f) throws IOException {
        try (InputStream in = new BufferedInputStream(new FileInputStream(f))) {
            return read(in);
        }
    }

    public static BufferedImage read(InputStream in) throws IOException {
        PushbackInputStream pin = new PushbackInputStream(in, 4096);
        String magic = nextToken(pin);
        boolean color = magic.equals("P6") || magic.equals("P3");
        boolean binary = magic.equals("P6") || magic.equals("P5");
        if (!color && !magic.equals("P5") && !magic.equals("P2")) throw new IOException("不是 PPM/PGM 文件：" + magic);
        int w = Integer.parseInt(nextToken(pin));
        int h = Integer.parseInt(nextToken(pin));
        int max = Integer.parseInt(nextToken(pin));
        if (w <= 0 || h <= 0 || max <= 0 || max > 65535) throw new IOException("PPM 头不合法");
        int[] px = new int[w * h];
        double scale = 255.0 / max;
        if (binary) {
            // 头部最后一个空白后即为二进制数据（nextToken 已消费单个分隔符）
            int bytesPer = max > 255 ? 2 : 1;
            int channels = color ? 3 : 1;
            byte[] buf = new byte[w * h * channels * bytesPer];
            int off = 0, n;
            byte[] raw = pin.readAllBytes();
            System.arraycopy(raw, 0, buf, 0, Math.min(buf.length, raw.length));
            off = Math.min(buf.length, raw.length);
            if (off < buf.length) throw new IOException("PPM 数据不完整");
            int idx = 0;
            for (int i = 0; i < px.length; i++) {
                int r, g, b;
                if (color) {
                    r = val(buf, idx, bytesPer); idx += bytesPer;
                    g = val(buf, idx, bytesPer); idx += bytesPer;
                    b = val(buf, idx, bytesPer); idx += bytesPer;
                } else {
                    r = g = b = val(buf, idx, bytesPer); idx += bytesPer;
                }
                px[i] = Img.argb(255, clampScale(r, scale), clampScale(g, scale), clampScale(b, scale));
            }
        } else {
            String all = new String(pin.readAllBytes(), StandardCharsets.US_ASCII);
            String[] toks = all.replaceAll("#[^\\n]*", " ").trim().split("\\s+");
            int channels = color ? 3 : 1;
            if (toks.length < w * h * channels) throw new IOException("PPM 数据不完整");
            int idx = 0;
            for (int i = 0; i < px.length; i++) {
                if (color) {
                    int r = Integer.parseInt(toks[idx++]);
                    int g = Integer.parseInt(toks[idx++]);
                    int b = Integer.parseInt(toks[idx++]);
                    px[i] = Img.argb(255, clampScale(r, scale), clampScale(g, scale), clampScale(b, scale));
                } else {
                    int v = Integer.parseInt(toks[idx++]);
                    int s = clampScale(v, scale);
                    px[i] = Img.argb(255, s, s, s);
                }
            }
        }
        return Img.fromPixels(w, h, px);
    }

    private static int val(byte[] buf, int idx, int bytesPer) {
        if (bytesPer == 1) return buf[idx] & 0xFF;
        return ((buf[idx] & 0xFF) << 8) | (buf[idx + 1] & 0xFF);
    }

    private static int clampScale(int v, double scale) {
        return Img.clamp((int) Math.round(v * scale), 0, 255);
    }

    /** 读取下一个以空白分隔的词，跳过 # 注释；消费词后恰好一个分隔符（二进制头需要）。 */
    private static String nextToken(PushbackInputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        // 跳过前导空白与注释
        while ((c = in.read()) != -1) {
            if (c == '#') { while ((c = in.read()) != -1 && c != '\n') { } continue; }
            if (!Character.isWhitespace(c)) break;
        }
        if (c == -1) throw new EOFException("PPM 头提前结束");
        while (c != -1 && !Character.isWhitespace(c)) {
            sb.append((char) c);
            c = in.read();
        }
        return sb.toString();
    }

    /** 写二进制 PPM（P6）。 */
    public static void writePpm(File f, BufferedImage img) throws IOException {
        int w = img.getWidth(), h = img.getHeight();
        int[] px = Img.pixels(img);
        try (OutputStream out = new BufferedOutputStream(new FileOutputStream(f))) {
            out.write(("P6\n" + w + " " + h + "\n255\n").getBytes(StandardCharsets.US_ASCII));
            byte[] row = new byte[w * 3];
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int c = px[y * w + x];
                    row[x * 3] = (byte) ((c >> 16) & 0xFF);
                    row[x * 3 + 1] = (byte) ((c >> 8) & 0xFF);
                    row[x * 3 + 2] = (byte) (c & 0xFF);
                }
                out.write(row);
            }
        }
    }

    /** 写二进制 PGM（P5，取明度）。 */
    public static void writePgm(File f, BufferedImage img) throws IOException {
        int w = img.getWidth(), h = img.getHeight();
        int[] px = Img.pixels(img);
        try (OutputStream out = new BufferedOutputStream(new FileOutputStream(f))) {
            out.write(("P5\n" + w + " " + h + "\n255\n").getBytes(StandardCharsets.US_ASCII));
            byte[] row = new byte[w];
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int c = px[y * w + x];
                    row[x] = (byte) Math.round(0.2126 * ((c >> 16) & 0xFF) + 0.7152 * ((c >> 8) & 0xFF) + 0.0722 * (c & 0xFF));
                }
                out.write(row);
            }
        }
    }
}
