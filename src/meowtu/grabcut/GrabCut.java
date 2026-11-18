package meowtu.grabcut;

import java.awt.Point;
import java.awt.Rectangle;
import java.awt.image.BufferedImage;
import java.util.List;

/**
 * GrabCut 分割（按经典结构）：双 GMM 颜色模型 + 网格图 s-t 最小割迭代，
 * 末尾用引导滤波细化边缘并做小半径羽化。
 */
public final class GrabCut {

    // 掩码取值：确定背景 / 确定前景 / 可能背景 / 可能前景
    private static final int BGD = 0, FGD = 1, PR_BGD = 2, PR_FGD = 3;
    private static final double GAMMA = 50.0;
    private static final double LAMBDA = 9 * GAMMA; // 硬约束与图边界权重
    private static final int MARK_R = 2; // 画笔硬约束半径

    private GrabCut() {}

    public static int[] alpha(BufferedImage img, Rectangle rect,
                              List<Point> fgMarks, List<Point> bgMarks, int iterations) {
        int w = img.getWidth(), h = img.getHeight(), n = w * h;
        if (n == 0) return new int[0];

        // 读颜色到平面数组
        double[] cr = new double[n], cg = new double[n], cb = new double[n];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = img.getRGB(x, y), i = y * w + x;
                cr[i] = (rgb >> 16) & 0xFF;
                cg[i] = (rgb >> 8) & 0xFF;
                cb[i] = rgb & 0xFF;
            }
        }

        // 初始掩码：矩形外确定背景，矩形内可能前景
        int[] mask = new int[n];
        Rectangle rc = clampRect(rect, w, h);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                boolean inside = x >= rc.x && x < rc.x + rc.width
                                && y >= rc.y && y < rc.y + rc.height;
                mask[y * w + x] = inside ? PR_FGD : BGD;
            }
        }
        applyMarks(mask, w, h, bgMarks, BGD);
        applyMarks(mask, w, h, fgMarks, FGD);

        double beta = calcBeta(cr, cg, cb, w, h);

        Gmm bgGmm = new Gmm(), fgGmm = new Gmm();
        int[] comp = new int[n];
        initGMMs(cr, cg, cb, mask, comp, bgGmm, fgGmm);

        int iters = Math.max(1, iterations);
        for (int it = 0; it < iters; it++) {
            assignGMMs(cr, cg, cb, mask, comp, bgGmm, fgGmm);
            learnGMMs(cr, cg, cb, mask, comp, bgGmm, fgGmm);
            Graph graph = constructGraph(cr, cg, cb, mask, bgGmm, fgGmm, beta, w, h);
            runMaxFlow(graph, n, n + 1);
            boolean[] reach = graph.reachableFrom(n);
            for (int i = 0; i < n; i++) {
                if (mask[i] == PR_BGD || mask[i] == PR_FGD) {
                    mask[i] = reach[i] ? PR_FGD : PR_BGD;
                }
            }
        }

        // 二值结果 → 引导滤波细化 → 小半径羽化 → 回填硬约束
        int[] bin = new int[n];
        for (int i = 0; i < n; i++) bin[i] = isFg(mask[i]) ? 255 : 0;
        int[] refined = GuidedFilter.filter(img, bin, 6, 0.01);
        int[] out = feather(refined, w, h, 1);
        for (int i = 0; i < n; i++) {
            if (mask[i] == BGD) out[i] = 0;
            else if (mask[i] == FGD) out[i] = 255;
        }
        return out;
    }

    private static boolean isFg(int m) { return m == FGD || m == PR_FGD; }

    private static Rectangle clampRect(Rectangle rect, int w, int h) {
        if (rect == null) return new Rectangle(0, 0, w, h);
        int x0 = Math.max(0, Math.min(w - 1, rect.x));
        int y0 = Math.max(0, Math.min(h - 1, rect.y));
        int x1 = Math.max(x0 + 1, Math.min(w, rect.x + Math.max(1, rect.width)));
        int y1 = Math.max(y0 + 1, Math.min(h, rect.y + Math.max(1, rect.height)));
        return new Rectangle(x0, y0, x1 - x0, y1 - y0);
    }

    // 画笔点及其半径邻域设为硬约束
    private static void applyMarks(int[] mask, int w, int h, List<Point> marks, int val) {
        if (marks == null) return;
        for (Point p : marks) {
            if (p == null) continue;
            for (int dy = -MARK_R; dy <= MARK_R; dy++) {
                for (int dx = -MARK_R; dx <= MARK_R; dx++) {
                    if (dx * dx + dy * dy > MARK_R * MARK_R) continue;
                    int x = p.x + dx, y = p.y + dy;
                    if (x >= 0 && x < w && y >= 0 && y < h) mask[y * w + x] = val;
                }
            }
        }
    }

    // beta = 1 / (2 * 邻居色差平方均值)
    private static double calcBeta(double[] cr, double[] cg, double[] cb, int w, int h) {
        double sum = 0;
        long cnt = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                if (x > 0) { sum += dist2(cr, cg, cb, i, i - 1); cnt++; }
                if (y > 0) { sum += dist2(cr, cg, cb, i, i - w); cnt++; }
            }
        }
        if (cnt == 0 || sum <= 0) return 0;
        return 1.0 / (2.0 * (sum / cnt));
    }

    private static double dist2(double[] cr, double[] cg, double[] cb, int i, int j) {
        double dr = cr[i] - cr[j], dg = cg[i] - cg[j], db = cb[i] - cb[j];
        return dr * dr + dg * dg + db * db;
    }

    // initGMMs：按初始掩码收集前/背景样本，各做 k-means 初始化并 learn
    private static void initGMMs(double[] cr, double[] cg, double[] cb, int[] mask,
                                 int[] comp, Gmm bgGmm, Gmm fgGmm) {
        int n = mask.length;
        int bgCnt = 0, fgCnt = 0;
        for (int m : mask) { if (isFg(m)) fgCnt++; else bgCnt++; }
        int[] bgMembers = new int[bgCnt], fgMembers = new int[fgCnt];
        int bi = 0, fi = 0;
        for (int i = 0; i < n; i++) {
            if (isFg(mask[i])) fgMembers[fi++] = i; else bgMembers[bi++] = i;
        }
        bgGmm.initKMeans(cr, cg, cb, bgMembers, comp);
        fgGmm.initKMeans(cr, cg, cb, fgMembers, comp);
    }

    // assignGMMs：每个像素按当前类别归到密度最大的分量
    private static void assignGMMs(double[] cr, double[] cg, double[] cb, int[] mask,
                                   int[] comp, Gmm bgGmm, Gmm fgGmm) {
        for (int i = 0; i < mask.length; i++) {
            comp[i] = isFg(mask[i]) ? fgGmm.assign(cr[i], cg[i], cb[i])
                                    : bgGmm.assign(cr[i], cg[i], cb[i]);
        }
    }

    // learnGMMs：按掩码与分量归属重新统计两个 GMM
    private static void learnGMMs(double[] cr, double[] cg, double[] cb, int[] mask,
                                  int[] comp, Gmm bgGmm, Gmm fgGmm) {
        bgGmm.beginLearning();
        fgGmm.beginLearning();
        for (int i = 0; i < mask.length; i++) {
            if (isFg(mask[i])) fgGmm.addSample(comp[i], cr[i], cg[i], cb[i]);
            else bgGmm.addSample(comp[i], cr[i], cg[i], cb[i]);
        }
        bgGmm.endLearning();
        fgGmm.endLearning();
    }

    // 建图：源侧=前景；数据项=-ln Pr，硬约束用 LAMBDA；平滑项 gamma*exp(-beta*色差²)
    private static Graph constructGraph(double[] cr, double[] cg, double[] cb, int[] mask,
                                        Gmm bgGmm, Gmm fgGmm, double beta, int w, int h) {
        int n = w * h, s = n, t = n + 1;
        Graph graph = new Graph(n + 2, 12 * n + 16);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                if (mask[i] == BGD) {
                    graph.addEdge(i, t, LAMBDA);
                } else if (mask[i] == FGD) {
                    graph.addEdge(s, i, LAMBDA);
                } else {
                    graph.addEdge(s, i, bgGmm.dataCost(cr[i], cg[i], cb[i]));
                    graph.addEdge(i, t, fgGmm.dataCost(cr[i], cg[i], cb[i]));
                }
                if (x > 0) {
                    double v = GAMMA * Math.exp(-beta * dist2(cr, cg, cb, i, i - 1));
                    graph.addUndirected(i, i - 1, v);
                }
                if (y > 0) {
                    double v = GAMMA * Math.exp(-beta * dist2(cr, cg, cb, i, i - w));
                    graph.addUndirected(i, i - w, v);
                }
            }
        }
        return graph;
    }

    // 最大流在放大栈的线程里跑，避免深递归增广路爆栈
    private static void runMaxFlow(Graph graph, int s, int t) {
        final Throwable[] err = new Throwable[1];
        Thread th = new Thread(null, () -> {
            try {
                graph.maxFlow(s, t);
            } catch (Throwable e) {
                err[0] = e;
            }
        }, "grabcut-maxflow", 256L * 1024 * 1024);
        th.start();
        try {
            th.join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("GrabCut 最大流被中断", e);
        }
        if (err[0] != null) throw new RuntimeException("GrabCut 最大流失败", err[0]);
    }

    // 小半径盒式模糊羽化（水平+垂直两趟滑动窗口）
    private static int[] feather(int[] src, int w, int h, int r) {
        int[] tmp = new int[w * h];
        int[] out = new int[w * h];
        for (int y = 0; y < h; y++) {
            int row = y * w, sum = 0;
            for (int x = -r; x <= r; x++) sum += src[row + clampX(x, w)];
            for (int x = 0; x < w; x++) {
                tmp[row + x] = sum / (2 * r + 1);
                sum += src[row + clampX(x + r + 1, w)] - src[row + clampX(x - r, w)];
            }
        }
        for (int x = 0; x < w; x++) {
            int sum = 0;
            for (int y = -r; y <= r; y++) sum += tmp[clampX(y, h) * w + x];
            for (int y = 0; y < h; y++) {
                out[y * w + x] = Math.max(0, Math.min(255, sum / (2 * r + 1)));
                sum += tmp[clampX(y + r + 1, h) * w + x] - tmp[clampX(y - r, h) * w + x];
            }
        }
        return out;
    }

    private static int clampX(int v, int max) {
        return v < 0 ? 0 : (v >= max ? max - 1 : v);
    }
}
