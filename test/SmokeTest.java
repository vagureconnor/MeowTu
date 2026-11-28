import meowtu.core.*;
import meowtu.ProjectIO;
import meowtu.filters.Filters;
import meowtu.grabcut.GrabCut;

import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.List;

/**
 * 无头冒烟测试：对合成测试图跑通调节/曲线/滤镜/几何/格式/直方图/GrabCut，
 * 断言输出尺寸与像素变化。运行：java -Djava.awt.headless=true -cp out:test SmokeTest
 */
public class SmokeTest {
    static int passed = 0;

    static void check(boolean cond, String name) {
        if (!cond) throw new AssertionError("失败：" + name);
        passed++;
        System.out.println("PASS " + name);
    }

    static BufferedImage testImage(int w, int h) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setPaint(new GradientPaint(0, 0, new Color(40, 90, 160), w, h, new Color(240, 200, 90)));
        g.fillRect(0, 0, w, h);
        g.setColor(new Color(220, 70, 60));
        g.fillOval(w / 5, h / 5, w / 3, h / 3);
        g.setColor(new Color(60, 200, 120));
        g.fillRect(w / 2, h / 2, w / 3, h / 4);
        g.dispose();
        return img;
    }

    /** 逐像素完全一致（尺寸 + 每个像素 ARGB 相同）。 */
    static boolean samePixels(BufferedImage a, BufferedImage b) {
        if (a == null || b == null) return a == b;
        if (a.getWidth() != b.getWidth() || a.getHeight() != b.getHeight()) return false;
        int w = a.getWidth(), h = a.getHeight();
        int[] pa = a.getRGB(0, 0, w, h, null, 0, w);
        int[] pb = b.getRGB(0, 0, w, h, null, 0, w);
        for (int i = 0; i < pa.length; i++) if (pa[i] != pb[i]) return false;
        return true;
    }

    static boolean changed(BufferedImage a, BufferedImage b) {
        if (a.getWidth() != b.getWidth() || a.getHeight() != b.getHeight()) return true;
        int diff = 0;
        for (int y = 0; y < a.getHeight(); y += 3)
            for (int x = 0; x < a.getWidth(); x += 3)
                if (a.getRGB(x, y) != b.getRGB(x, y)) diff++;
        return diff > 10;
    }

    public static void main(String[] args) throws Exception {
        BufferedImage img = testImage(120, 90);

        // 调节
        AdjustParams p = new AdjustParams();
        p.exposure = 0.6; p.contrast = 35; p.saturation = -20; p.temperature = 25;
        BufferedImage adj = LutEngine.apply(img, p);
        check(adj.getWidth() == 120 && changed(img, adj), "LUT 调节改变像素且尺寸不变");
        check(!changed(img, LutEngine.apply(img, new AdjustParams())), "空调节保持原图");

        // 曲线
        BufferedImage curved = Curves.preset("S曲线").apply(img);
        check(changed(img, curved), "S 曲线改变像素");
        check(!changed(img, new Curves().apply(img)), "线性曲线保持原图");

        // 滤镜：全部可运行且尺寸不变；代表性滤镜必须改变像素
        for (Filters.Def d : Filters.all()) {
            BufferedImage out = Filters.apply(d.id, img, 1.0);
            if (out.getWidth() != 120 || out.getHeight() != 90) throw new AssertionError("滤镜尺寸变了：" + d.id);
        }
        check(true, "18 个滤镜全部可运行且尺寸不变（共 " + Filters.all().size() + " 个）");
        for (String id : new String[]{"bw", "xray", "thermal", "sketch", "mosaic", "vintage"}) {
            check(changed(img, Filters.apply(id, img, 1.0)), "滤镜生效：" + id);
        }
        check(!changed(img, Filters.apply("vintage", img, 0.0)), "滤镜强度 0 时保持原图");

        // 几何
        check(Geometry.rotate90(img, true).getWidth() == 90, "旋转90°宽高互换");
        BufferedImage rot = Geometry.rotate(img, 30);
        check(rot.getWidth() > 120 && rot.getHeight() > 90, "任意角度旋转画布扩展");
        check(Geometry.crop(img, new Rectangle(10, 10, 50, 40)).getWidth() == 50, "裁剪尺寸正确");
        check(changed(img, Geometry.flipH(img)), "水平翻转改变像素");
        BufferedImage persp = Geometry.perspective(img, new java.awt.geom.Point2D[]{
                new java.awt.geom.Point2D.Double(10, 5), new java.awt.geom.Point2D.Double(110, 12),
                new java.awt.geom.Point2D.Double(105, 80), new java.awt.geom.Point2D.Double(15, 85)});
        check(persp.getWidth() > 50 && persp.getHeight() > 50, "透视矫正产出合理尺寸");
        check(Geometry.lensDistort(img, 0.7).getWidth() == 120, "畸变尺寸不变");
        check(changed(img, Geometry.wave(img, 6, 60, false)), "波浪改变像素");
        check(changed(img, Geometry.swirl(img, 1.2)), "旋涡改变像素");

        // 直方图
        Histogram hst = Histogram.compute(img);
        check(hst.total > 0 && hst.mean[Histogram.LUM] > 0, "直方图统计有效");

        // 格式往返
        File dir = new File("/tmp/meowtu-smoke");
        dir.mkdirs();
        Formats.save(new File(dir, "t.png"), img, "png", 1f, 100);
        check(Formats.load(new File(dir, "t.png")).getWidth() == 120, "PNG 往返");
        Formats.save(new File(dir, "t.jpg"), img, "jpg", 0.9f, 100);
        check(Formats.load(new File(dir, "t.jpg")).getWidth() == 120, "JPG 往返");
        Formats.save(new File(dir, "t.ppm"), img, "ppm", 1f, 100);
        check(Formats.load(new File(dir, "t.ppm")).getWidth() == 120, "PPM 手写编解码往返");
        Formats.save(new File(dir, "t.pgm"), img, "pgm", 1f, 100);
        check(Formats.load(new File(dir, "t.pgm")).getWidth() == 120, "PGM 手写编解码往返");
        Formats.save(new File(dir, "t.tiff"), img, "tiff", 1f, 100);
        check(Formats.load(new File(dir, "t.tiff")).getWidth() == 120, "TIFF 往返");
        Formats.save(new File(dir, "half.png"), img, "png", 1f, 50);
        check(Formats.load(new File(dir, "half.png")).getWidth() == 60, "导出缩放 50%");

        // GrabCut 小图
        BufferedImage gc = new BufferedImage(96, 96, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2 = gc.createGraphics();
        g2.setColor(new Color(200, 40, 40)); g2.fillRect(0, 0, 48, 96);
        g2.setColor(new Color(40, 40, 200)); g2.fillRect(48, 0, 48, 96);
        g2.setColor(Color.WHITE); g2.fillOval(28, 28, 40, 40);
        g2.dispose();
        long t0 = System.currentTimeMillis();
        int[] alpha = GrabCut.alpha(gc, new Rectangle(24, 24, 48, 48), List.of(), List.of(), 3);
        long ms = System.currentTimeMillis() - t0;
        check(alpha[48 * 96 + 48] > 200, "GrabCut 圆心为前景（" + ms + "ms）");
        check(alpha[2 * 96 + 2] < 55, "GrabCut 远角为背景");

        // ---- 编辑引擎新模型（数值常驻 + 检查点撤销，与网页版同语义） ----
        meowtu.Editor ed = new meowtu.Editor();
        BufferedImage eimg = testImage(120, 90);
        ed.setFreshImage(eimg);
        check(!ed.canUndo(), "引擎：载入后无历史");
        ed.params().brightness = 50;
        check(ed.base() == eimg && !ed.canUndo(), "引擎：拖滑杆不烘焙不入栈（数值常驻）");
        check(changed(eimg, ed.bakeCurrent()), "引擎：常驻参数实时体现在合成结果");
        check(ed.checkpointAdjust() && ed.canUndo(), "引擎：松手记检查点入撤销栈");
        check(!ed.checkpointAdjust(), "引擎：无变化时不重复记检查点");
        ed.params().brightness = -30;
        ed.checkpointAdjust();
        check(ed.undo() && ed.params().brightness == 50, "引擎：撤销恢复上一步参数值");
        check(ed.undo() && ed.params().isIdentity(), "引擎：再撤销回到零参数");
        check(ed.redo() && ed.params().brightness == 50, "引擎：重做恢复参数值");
        ed.curves().setPoints(Curves.RGB, List.of(new Point(0, 0), new Point(128, 180), new Point(255, 255)));
        ed.checkpointAdjust();
        check(ed.undo() && ed.curves().isIdentity(), "引擎：撤销恢复曲线为恒等");
        ed.params().contrast = 40;
        BufferedImage flipped = Geometry.flipH(ed.bakeCurrent());
        ed.commitImage(flipped);
        check(ed.params().isIdentity() && ed.base() == flipped, "引擎：离散操作提交后参数归零");
        check(ed.undo() && ed.params().contrast == 40 && ed.base() == eimg, "引擎：撤销离散操作连参数一起恢复");
        ed.texts().add(new meowtu.TextObject("喵", 5, 5));
        check(ed.commitTexts() && ed.texts().isEmpty(), "引擎：栅格化文字后列表清空");
        check(ed.undo() && ed.texts().size() == 1, "引擎：撤销后文字对象回来");

        // ---- 滤镜状态式（与网页版同语义：不烘焙、不叠加、可替换、可取消、可撤销） ----
        meowtu.Editor fe = new meowtu.Editor();
        BufferedImage fimg = testImage(120, 90);
        fe.setFreshImage(fimg);
        check(fe.activeFilter() == null, "滤镜：载入新图时无滤镜");
        check(fe.setFilter("bw", 1.0) && "bw".equals(fe.activeFilter()), "滤镜：设定当前滤镜");
        check(samePixels(fe.bakeCurrent(), Filters.apply("bw", fimg, 1.0)), "滤镜：合成结果等于单次应用");
        check(fe.setFilter("bw", 1.0), "滤镜：重复点同一滤镜被受理");
        check(samePixels(fe.bakeCurrent(), Filters.apply("bw", fimg, 1.0)), "滤镜：连点两次与一次像素一致（不叠加）");
        check(fe.undo() && fe.activeFilter() == null && !fe.canUndo(), "滤镜：连点不重复入栈（一次撤销即回到无滤镜）");
        check(fe.redo() && "bw".equals(fe.activeFilter()), "滤镜：重做恢复滤镜状态");
        check(fe.setFilter("xray", 1.0), "滤镜：点另一个滤镜直接替换");
        check(samePixels(fe.bakeCurrent(), Filters.apply("xray", fimg, 1.0)), "滤镜：切换后等于只应用后者");
        check(fe.undo() && "bw".equals(fe.activeFilter()), "滤镜：撤销退回上一个滤镜状态");
        check(samePixels(fe.bakeCurrent(), Filters.apply("bw", fimg, 1.0)), "滤镜：撤销后像素回到上一个滤镜");
        check(fe.redo() && "xray".equals(fe.activeFilter()), "滤镜：重做回到后一个滤镜");
        check(fe.clearFilter() && fe.activeFilter() == null, "滤镜：取消滤镜回到无滤镜");
        check(samePixels(fe.bakeCurrent(), fimg), "滤镜：取消后与原图逐像素一致");
        check(!fe.clearFilter(), "滤镜：无滤镜时取消无变化");
        check(fe.undo() && "xray".equals(fe.activeFilter()), "滤镜：取消也可撤销");
        // 强度是状态的一部分：半强度合成等于单次半强度应用，且进快照可撤销
        check(fe.setFilter("vintage", 0.5), "滤镜：带强度设定滤镜");
        check(samePixels(fe.bakeCurrent(), Filters.apply("vintage", fimg, 0.5)), "滤镜：半强度等于单次半强度应用");
        fe.setFilterStrengthLive(0.8);
        check(samePixels(fe.bakeCurrent(), Filters.apply("vintage", fimg, 0.8)), "滤镜：强度实时调整只改数值");
        check(fe.checkpointAdjust() && fe.undo() && fe.filterStrength() == 0.5, "滤镜：强度调整记检查点且可撤销");
        // 离散操作的全合成含滤镜恰好一次，提交后滤镜状态归零（已烘焙进新底图）
        BufferedImage flippedFiltered = Geometry.flipH(Filters.apply("vintage", fimg, 0.5));
        fe.commitImage(Geometry.flipH(fe.bakeCurrent()));
        check(fe.activeFilter() == null, "滤镜：离散操作提交后滤镜归零");
        check(samePixels(fe.base(), flippedFiltered), "滤镜：烘焙进新底图的滤镜恰好一次");
        check(fe.undo() && "vintage".equals(fe.activeFilter()) && fe.base() == fimg, "滤镜：撤销离散操作连滤镜状态一起恢复");
        fe.setFreshImage(testImage(60, 40));
        check(fe.activeFilter() == null && !fe.canUndo(), "滤镜：打开新图滤镜归零且清历史");


        // ---- 图层引擎（与网页版同构） ----
        {
            meowtu.Editor le = new meowtu.Editor();
            BufferedImage bottom = new BufferedImage(20, 20, BufferedImage.TYPE_INT_ARGB);
            Graphics2D bg2 = bottom.createGraphics(); bg2.setColor(new Color(200, 100, 50)); bg2.fillRect(0, 0, 20, 20); bg2.dispose();
            le.setFreshImage(bottom);
            BufferedImage top = new BufferedImage(20, 20, BufferedImage.TYPE_INT_ARGB);
            Graphics2D tg2 = top.createGraphics(); tg2.setColor(new Color(128, 128, 128)); tg2.fillRect(0, 0, 20, 20); tg2.dispose();
            meowtu.Editor.Layer tl = le.addLayer(top, "灰层");
            le.setLayerProps(1, null, null, "multiply");
            int mp = le.bakeComposite().getRGB(10, 10);
            check(Math.abs(((mp >> 16) & 0xFF) - 100) <= 1 && Math.abs(((mp >> 8) & 0xFF) - 50) <= 1 && Math.abs((mp & 0xFF) - 25) <= 1,
                    "图层：multiply 合成已知值 (200,100,50)x(128) -> (100,50,25)，实际 " + (((mp >> 16) & 0xFF) + "," + ((mp >> 8) & 0xFF) + "," + (mp & 0xFF)));
            le.setLayerProps(1, null, 0.5, "normal");
            int np = le.bakeComposite().getRGB(10, 10);
            check(Math.abs(((np >> 16) & 0xFF) - 164) <= 1 && Math.abs(((np >> 8) & 0xFF) - 114) <= 1,
                    "图层：normal 50% 不透明度混合 (164,114,89)，实际 " + (((np >> 16) & 0xFF) + "," + ((np >> 8) & 0xFF) + "," + (np & 0xFF)));
            check(le.undo() && le.layerAt(1).opacity == 1.0 && "multiply".equals(le.layerAt(1).blendMode), "图层：撤销恢复混合模式与不透明度");
            // 调整层作用于其下合成结果（整体压暗）
            BufferedImage beforeAdj = le.bakeComposite();
            le.addAdjustmentLayer();
            le.params().brightness = -35;
            BufferedImage afterAdj = le.bakeComposite();
            long sumB = 0, sumA = 0;
            for (int y = 0; y < 20; y += 2) for (int x = 0; x < 20; x += 2) {
                sumB += (beforeAdj.getRGB(x, y) >> 16) & 0xFF;
                sumA += (afterAdj.getRGB(x, y) >> 16) & 0xFF;
            }
            check(sumA < sumB, "图层：调整层 brightness-35 使其下合成变暗（" + sumB + "->" + sumA + "）");
            check(le.layerCount() == 3, "图层：调整层计入图层数");
            check(le.deleteLayer(2) && le.layerCount() == 2, "图层：删除调整层");
            // Blend 公式抽查（与网页 rig-layers 同源公式，子线已与 JS 逐值对拍）
            double[] mul = meowtu.core.Blend.blend("multiply", 0.2, 0.4, 0.6, 0.7, 0.3, 0.5);
            check(Math.abs(mul[0] - 0.14) < 1e-6 && Math.abs(mul[1] - 0.12) < 1e-6 && Math.abs(mul[2] - 0.30) < 1e-6, "混合：multiply 公式值");
            double[] scr = meowtu.core.Blend.blend("screen", 0.2, 0.4, 0.6, 0.7, 0.3, 0.5);
            check(Math.abs(scr[0] - 0.76) < 1e-6 && Math.abs(scr[1] - 0.58) < 1e-6 && Math.abs(scr[2] - 0.80) < 1e-6, "混合：screen 公式值");
            double[] ovl = meowtu.core.Blend.blend("overlay", 0.2, 0.4, 0.6, 0.7, 0.3, 0.5);
            check(Math.abs(ovl[0] - 0.28) < 1e-6 && Math.abs(ovl[1] - 0.24) < 1e-6 && Math.abs(ovl[2] - 0.60) < 1e-6, "混合：overlay 公式值");
            check(meowtu.core.Blend.MODES.length == 27, "混合：27 种模式齐备");
        }

        // ---- 新增 19 个带参数滤镜抽查 ----
        {
            BufferedImage one = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
            one.setRGB(0, 0, 0xFF000000 | (64 << 16) | (128 << 8) | 200);
            BufferedImage inv = meowtu.filters.FiltersX.apply("invert", one, null);
            int iv = inv.getRGB(0, 0);
            check(((iv >> 16) & 0xFF) == 191 && ((iv >> 8) & 0xFF) == 127 && (iv & 0xFF) == 55, "滤镜X：invert 已知值");
            BufferedImage post = meowtu.filters.FiltersX.apply("posterize", one, java.util.Map.of("levels", 4.0));
            int pv = post.getRGB(0, 0);
            check(((pv >> 16) & 0xFF) == 85 && ((pv >> 8) & 0xFF) == 170 && (pv & 0xFF) == 170, "滤镜X：posterize levels=4 已知值，实际 " + (((pv >> 16) & 0xFF) + "," + ((pv >> 8) & 0xFF) + "," + (pv & 0xFF)));
            check(meowtu.filters.FiltersX.all().size() == 19, "滤镜X：19 个齐备");
        }

        // ---- 高级调整：可选颜色 PhotoCraft 已知值 ----
        {
            meowtu.core.AdvAdjust.State st = new meowtu.core.AdvAdjust.State();
            st.selcolorOn = true; st.selcolorRange = 7; st.selcolorRel = false; st.selcolorA[7][0] = 50;
            BufferedImage gray = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
            gray.setRGB(0, 0, 0xFF404040);
            int sv = meowtu.core.AdvAdjust.apply(gray, st).getRGB(0, 0);
            check(((sv >> 16) & 0xFF) == 32 && ((sv >> 8) & 0xFF) == 64 && (sv & 0xFF) == 64,
                    "高级调整：可选颜色中性青+50(绝对) 灰64 -> (32,64,64)，实际 " + (((sv >> 16) & 0xFF) + "," + ((sv >> 8) & 0xFF) + "," + (sv & 0xFF)));
        }

        // ---- LUT：红蓝互换 cube + 强度中点 ----
        {
            String cube = "TITLE \"swap\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n"
                    + "0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n";
            meowtu.core.Lut.State ls = new meowtu.core.Lut.State();
            ls.id = "custom"; ls.cube = cube; ls.strength = 100;
            BufferedImage px1 = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
            px1.setRGB(0, 0, 0xFF000000 | (10 << 16) | (20 << 8) | 30);
            int full = meowtu.core.Lut.apply(px1, ls).getRGB(0, 0);
            check(Math.abs(((full >> 16) & 0xFF) - 30) <= 1 && Math.abs((full & 0xFF) - 10) <= 1, "LUT：红蓝互换全强度");
            ls.strength = 50;
            int half = meowtu.core.Lut.apply(px1, ls).getRGB(0, 0);
            check(Math.abs(((half >> 16) & 0xFF) - 20) <= 1 && Math.abs(((half >> 8) & 0xFF) - 20) <= 1 && Math.abs((half & 0xFF) - 20) <= 1, "LUT：强度 50 中点 (20,20,20)");
            check(meowtu.core.Lut.PRESETS.length == 8, "LUT：8 个内置预设齐备");
        }

        // ---- 一句话修图：与 nl/parse.js 原版对 10 句 ----
        {
            java.util.function.Function<String, meowtu.nl.NlParse.ParseResult> P = meowtu.nl.NlParse::parse;
            meowtu.nl.NlParse.ParseResult r1 = P.apply("让天空更蓝");
            check(r1.ops.size() == 1 && "sky".equals(r1.ops.get(0).region) && "skyBlue".equals(r1.ops.get(0).op) && r1.ops.get(0).delta == 18, "NL：让天空更蓝 -> sky/skyBlue/+18");
            meowtu.nl.NlParse.ParseResult r2 = P.apply("照片太暗了");
            check(r2.ops.stream().anyMatch(o -> "brightness".equals(o.op) && o.delta == 16), "NL：照片太暗了 -> brightness+16（抱怨句式）");
            check(P.apply("亮度加20").ops.stream().anyMatch(o -> "brightness".equals(o.op) && o.delta == 20), "NL：亮度加20 数值直达");
            check(P.apply("饱和度减十").ops.stream().anyMatch(o -> "saturation".equals(o.op) && o.delta == -10), "NL：饱和度减十 中文数字");
            check(P.apply("给照片加个青橙风格").ops.stream().anyMatch(o -> "temperature".equals(o.op) && o.delta == -6), "NL：青橙风格预设");
            meowtu.nl.NlParse.ParseResult r6 = P.apply("帮我瘦脸");
            check(r6.ops.isEmpty() && r6.unsupported.contains("瘦脸"), "NL：瘦脸 -> unsupported 如实报告");
            meowtu.nl.NlParse.ParseResult r7 = P.apply("对比度调到30");
            check(r7.ops.stream().anyMatch(o -> "contrast".equals(o.op) && o.absolute && o.delta == 30), "NL：对比度调到30 绝对值");
            check(P.apply("海水更蓝").ops.stream().anyMatch(o -> "skyBlue".equals(o.op)), "NL：海水更蓝 -> skyBlue（与 JS 同口径）");
            check(P.apply("让天空更蓝，人像亮一点，背景虚化").ops.size() == 3, "NL：三句分句解析");
            check(P.apply("月亮很亮").ops.stream().anyMatch(o -> "brightness".equals(o.op) && o.delta == 26), "NL：月亮很亮 -> brightness+26（JS 原版实际行为，忠实复刻）");
        }

        // ---- 工程文件：网页版样例导入对拍 + Java 往返 ----
        {
            java.io.File sample = new java.io.File("test/sample-web.meowtu");
            if (sample.exists()) {
                String json = java.nio.file.Files.readString(sample.toPath(), java.nio.charset.StandardCharsets.UTF_8);
                meowtu.Editor pe = new meowtu.Editor();
                ProjectIO.importProject(pe, json);
                check(pe.layerCount() == 3, "工程：网页样例 3 图层导入，实际 " + pe.layerCount());
                check("adj".equals(pe.layerAt(2).kind), "工程：顶层为调整层");
                check("multiply".equals(pe.layerAt(1).blendMode) && Math.abs(pe.layerAt(1).opacity - 0.6) < 1e-9, "工程：混合模式/不透明度还原");
                BufferedImage comp = pe.bakeComposite();
                int[][] want = {{136, 15, 20}, {40, 156, 38}, {20, 11, 164}, {144, 161, 42}};
                int[][] at = {{2, 2}, {25, 2}, {2, 20}, {25, 20}};
                boolean okPts = comp.getWidth() == 40 && comp.getHeight() == 30;
                StringBuilder ev = new StringBuilder();
                for (int i = 0; i < 4; i++) {
                    int v = comp.getRGB(at[i][0], at[i][1]);
                    int[] got = {(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF};
                    ev.append(java.util.Arrays.toString(got));
                    for (int c = 0; c < 3; c++) if (Math.abs(got[c] - want[i][c]) > 2) okPts = false;
                }
                check(okPts, "工程：Java 合成与网页基准 4 点对拍（容差±2）" + ev);
                // Java 自导出再导入：逐像素一致
                String mine = ProjectIO.exportProject(pe);
                meowtu.Editor pe2 = new meowtu.Editor();
                ProjectIO.importProject(pe2, mine);
                check(samePixels(pe.bakeComposite(), pe2.bakeComposite()), "工程：Java 导出->导入往返逐像素一致");
                java.nio.file.Files.writeString(new java.io.File("test/sample-java.meowtu").toPath(), mine, java.nio.charset.StandardCharsets.UTF_8);
                // 配方：导出再套到新文档
                String recipe = ProjectIO.exportRecipe(pe);
                meowtu.Editor re = new meowtu.Editor();
                re.setFreshImage(testImage(40, 30));
                check(ProjectIO.applyRecipe(re, recipe) >= 1, "配方：导出/套用往返");
            } else {
                check(false, "工程：缺少网页样例 test/sample-web.meowtu（用 cjrig/gen-sample.js 生成）");
            }
        }

        // ---- 图层样式（经 Editor 合成接入） ----
        {
            meowtu.Editor se = new meowtu.Editor();
            BufferedImage sq = new BufferedImage(40, 40, BufferedImage.TYPE_INT_ARGB);
            Graphics2D sg = sq.createGraphics(); sg.setColor(new Color(255, 0, 0)); sg.fillRect(10, 10, 20, 20); sg.dispose();
            se.setFreshImage(sq);
            BufferedImage noStyle = se.bakeComposite();
            java.util.Map<String, Object> shadow = new java.util.LinkedHashMap<>();
            shadow.put("on", true); shadow.put("blend", "multiply"); shadow.put("color", "#000000");
            shadow.put("opacity", 75.0); shadow.put("angle", 0.0); shadow.put("distance", 10.0);
            shadow.put("spread", 0.0); shadow.put("size", 0.0);
            java.util.Map<String, Object> style = new java.util.LinkedHashMap<>();
            style.put("dropShadow", shadow);
            se.setStyle(style);
            BufferedImage withStyle = se.bakeComposite();
            check(!samePixels(noStyle, withStyle), "样式：投影经合成生效（与无样式不同）");
            int center = withStyle.getRGB(20, 20);
            check(((center >> 16) & 0xFF) == 255 && (center >>> 24) == 255, "样式：方块本体保持红色不透明");
            boolean hasShadowPx = false;
            for (int y = 0; y < 40 && !hasShadowPx; y++) for (int x = 0; x < 40; x++) {
                int v = withStyle.getRGB(x, y);
                if ((v >>> 24) == 191 && ((v >> 16) & 0xFF) == 0 && ((v >> 8) & 0xFF) == 0 && (v & 0xFF) == 0) { hasShadowPx = true; break; }
            }
            check(hasShadowPx, "样式：存在 alpha=191 的黑色投影像素（75% 不透明度）");
            se.setStyle(null);
            check(samePixels(noStyle, se.bakeComposite()), "样式：清除样式后与无样式逐像素一致");
        }

        // ---- 自由变换（QuadTransform） ----
        {
            BufferedImage src = testImage(30, 20);
            meowtu.core.QuadTransform.WarpResult idt = meowtu.core.QuadTransform.warp(src,
                    new double[][]{{0, 0}, {30, 0}, {30, 20}, {0, 20}});
            check(idt != null && samePixels(src, idt.image), "变换：恒等四角逐像素一致");
            BufferedImage moved = meowtu.core.QuadTransform.warpToDocument(src,
                    new double[][]{{3, 2}, {33, 2}, {33, 22}, {3, 22}}, 30, 20);
            check(moved.getRGB(4, 3) == src.getRGB(1, 1) && (moved.getRGB(1, 1) >>> 24) == 0, "变换：整数平移精确");
        }

        System.out.println("SMOKE_ALL_PASS 共 " + passed + " 项");
    }
}
