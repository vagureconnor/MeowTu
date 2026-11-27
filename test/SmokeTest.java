import meowtu.core.*;
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

        System.out.println("SMOKE_ALL_PASS 共 " + passed + " 项");
    }
}
