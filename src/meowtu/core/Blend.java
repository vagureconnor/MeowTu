package meowtu.core;

/**
 * Photoshop 27 种混合模式（纯像素公式，零第三方库）。
 * 逐公式移植自网页版 webapp/js/engine.js 的 BLEND_MODE_LIST / blendChannel /
 * blendTriple / blendCompositeInto（数值口径：通道 0..1 浮点、非预乘）。
 * 可分离模式逐通道；非分离模式（hue/saturation/color/luminosity）用 W3C
 * Compositing and Blending 的 Lum/Sat/SetLum/SetSat/ClipColor 辅助函数；
 * darkerColor/lighterColor 按三通道总和比较（Photoshop 口径）。
 * subtract 取 clamp(Cb-Cs)；divide 取 Cb/Cs 钳制（Cs=0 时为 1）。
 */
public final class Blend {
    private Blend() {}

    /** 与 web 的 BLEND_MODE_LIST 同序同 id。 */
    public static final String[] MODES = {
        "normal", "dissolve", "darken", "multiply", "colorBurn", "linearBurn", "darkerColor",
        "lighten", "screen", "colorDodge", "linearDodge", "lighterColor",
        "overlay", "softLight", "hardLight", "vividLight", "linearLight", "pinLight", "hardMix",
        "difference", "exclusion", "subtract", "divide",
        "hue", "saturation", "color", "luminosity"
    };

    /**
     * 混合色（web blendTriple/blend 语义）：输入输出均为 0..1 非预乘，
     * 返回混合后的源色 [r,g,b]（不做 alpha 合成）。
     * dissolve：Photoshop 中是按 alpha 随机抖动，web 实现以 normal 近似
     * （设计允许），此处同口径——blendChannel 的 default 分支直接返回 Cs。
     */
    public static double[] blend(String mode, double br, double bg, double bb,
                                 double sr, double sg, double sb) {
        double[] cb = {br, bg, bb}, cs = {sr, sg, sb};
        switch (mode == null ? "normal" : mode) {
            case "darkerColor": {
                double sbm = cb[0] + cb[1] + cb[2], ssm = cs[0] + cs[1] + cs[2];
                return (ssm < sbm ? cs : cb).clone();
            }
            case "lighterColor": {
                double sbm = cb[0] + cb[1] + cb[2], ssm = cs[0] + cs[1] + cs[2];
                return (ssm > sbm ? cs : cb).clone();
            }
            case "hue":        return setLum(setSat(cs, sat3(cb)), lum3(cb));
            case "saturation": return setLum(setSat(cb, sat3(cs)), lum3(cb));
            case "color":      return setLum(cs, lum3(cb));
            case "luminosity": return setLum(cb, lum3(cs));
            default:
                return new double[]{
                    blendChannel(mode, cb[0], cs[0]),
                    blendChannel(mode, cb[1], cs[1]),
                    blendChannel(mode, cb[2], cs[2])};
        }
    }

    /**
     * 把 src 像素层按混合模式 + 不透明度合成到 dst（原地修改），ARGB 打包数组
     * （与 {@link Img} 的像素格式一致）。逐像素公式同 web blendCompositeInto：
     *   αs = 源alpha × opacity（× 蒙版灰度，mask 非 null 时逐像素 0..255 无符号），
     *   αo = αs + αb(1-αs)，
     *   Co = [αs(1-αb)Cs + αs·αb·B(Cb,Cs) + (1-αs)αb·Cb] / αo。
     * mask 长度应与像素数一致；为 null 时不调制。
     */
    public static void compositeInto(int[] dst, int[] src, String mode, double opacity, byte[] mask) {
        int n = Math.min(dst.length, src.length);
        for (int i = 0; i < n; i++) {
            double as = (src[i] >>> 24) / 255.0 * opacity * (mask != null ? (mask[i] & 0xFF) / 255.0 : 1.0);
            if (as <= 0) continue;
            double ab = (dst[i] >>> 24) / 255.0;
            double[] cb = {((dst[i] >> 16) & 0xFF) / 255.0, ((dst[i] >> 8) & 0xFF) / 255.0, (dst[i] & 0xFF) / 255.0};
            double[] cs = {((src[i] >> 16) & 0xFF) / 255.0, ((src[i] >> 8) & 0xFF) / 255.0, (src[i] & 0xFF) / 255.0};
            double[] b = blend(mode, cb[0], cb[1], cb[2], cs[0], cs[1], cs[2]);
            double ao = as + ab * (1 - as);
            int a = clamp255(Math.round(ao * 255));
            int r = 0, g = 0, bl = 0;
            if (ao > 0) {
                r = clamp255(Math.round((as * (1 - ab) * cs[0] + as * ab * b[0] + (1 - as) * ab * cb[0]) / ao * 255));
                g = clamp255(Math.round((as * (1 - ab) * cs[1] + as * ab * b[1] + (1 - as) * ab * cb[1]) / ao * 255));
                bl = clamp255(Math.round((as * (1 - ab) * cs[2] + as * ab * b[2] + (1 - as) * ab * cb[2]) / ao * 255));
            }
            dst[i] = (a << 24) | (r << 16) | (g << 8) | bl;
        }
    }

    // ---------- web blendChannel 及辅助（逐行对应） ----------

    private static double bBurn(double cb, double cs) { return cs <= 0 ? 0 : Math.max(0, 1 - (1 - cb) / cs); }
    private static double bDodge(double cb, double cs) { return cs >= 1 ? 1 : Math.min(1, cb / (1 - cs)); }
    private static double bSoftD(double cb) { return cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb); }

    /** 可分离模式的单通道混合函数 B(cb, cs)，输入输出均为 0..1。 */
    private static double blendChannel(String mode, double cb, double cs) {
        if (mode == null) return cs;
        switch (mode) {
            case "darken":      return Math.min(cb, cs);
            case "multiply":    return cb * cs;
            case "colorBurn":   return bBurn(cb, cs);
            case "linearBurn":  return Math.max(0, cb + cs - 1);
            case "lighten":     return Math.max(cb, cs);
            case "screen":      return 1 - (1 - cb) * (1 - cs);
            case "colorDodge":  return bDodge(cb, cs);
            case "linearDodge": return Math.min(1, cb + cs);
            case "overlay":     return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
            case "softLight":
                if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
                return cb + (2 * cs - 1) * (bSoftD(cb) - cb);
            case "hardLight":   return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
            case "vividLight":  return cs <= 0.5 ? bBurn(cb, 2 * cs) : bDodge(cb, 2 * (cs - 0.5));
            case "linearLight": return cs <= 0.5 ? Math.max(0, cb + 2 * cs - 1) : Math.min(1, cb + 2 * (cs - 0.5));
            case "pinLight":    return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * (cs - 0.5));
            case "hardMix": {
                double v = cs <= 0.5 ? bBurn(cb, 2 * cs) : bDodge(cb, 2 * (cs - 0.5));
                return v < 0.5 ? 0 : 1;
            }
            case "difference":  return Math.abs(cb - cs);
            case "exclusion":   return cb + cs - 2 * cb * cs;
            case "subtract":    return Math.max(0, cb - cs);
            case "divide":      return cs <= 0 ? 1 : Math.min(1, cb / cs);
            default:            return cs; // normal / dissolve
        }
    }

    private static double lum3(double[] c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
    private static double sat3(double[] c) {
        return Math.max(c[0], Math.max(c[1], c[2])) - Math.min(c[0], Math.min(c[1], c[2]));
    }

    private static double[] clipColor(double[] c) {
        double l = lum3(c);
        double mn = Math.min(c[0], Math.min(c[1], c[2])), mx = Math.max(c[0], Math.max(c[1], c[2]));
        double[] out = c.clone();
        if (mn < 0) for (int i = 0; i < 3; i++) out[i] = l + (out[i] - l) * l / (l - mn);
        if (mx > 1) for (int i = 0; i < 3; i++) out[i] = l + (out[i] - l) * (1 - l) / (mx - l);
        return out;
    }

    private static double[] setLum(double[] c, double l) {
        double d = l - lum3(c);
        return clipColor(new double[]{c[0] + d, c[1] + d, c[2] + d});
    }

    private static double[] setSat(double[] c, double s) {
        int[] idx = {0, 1, 2};
        // 按通道值升序排序下标（web: [0,1,2].sort(by c[a]-c[b])，稳定排序）
        for (int i = 1; i < 3; i++) {
            int v = idx[i], j = i - 1;
            while (j >= 0 && c[idx[j]] > c[v]) { idx[j + 1] = idx[j]; j--; }
            idx[j + 1] = v;
        }
        double[] out = {0, 0, 0};
        double mn = c[idx[0]], md = c[idx[1]], mx = c[idx[2]];
        if (mx > mn) { out[idx[1]] = (md - mn) * s / (mx - mn); out[idx[2]] = s; }
        return out;
    }

    private static int clamp255(long v) { return v < 0 ? 0 : (v > 255 ? 255 : (int) v); }
}
