package meowtu.grabcut;

/**
 * 高斯混合模型：RGB 三维，每类 5 个分量。
 * 提供采样累积（learn 两步中的统计）与单点概率/代价计算。
 */
public final class Gmm {

    public static final int K = 5;
    private static final int DIM = 3;
    private static final double LOG_2PI3 = 1.5 * Math.log(2 * Math.PI);
    // 协方差对角正则量，防止样本少时奇异
    private static final double REG = 1.0;
    // 行列式下限，低于它继续加对角量钳制
    private static final double MIN_DET = 1.0;

    final double[] pi = new double[K];
    final double[][] mean = new double[K][DIM];
    final double[][][] cov = new double[K][DIM][DIM];
    private final double[][][] inv = new double[K][DIM][DIM];
    private final double[] logCoef = new double[K]; // ln(pi) - 0.5*ln((2pi)^3 * det)

    // learn 累积量
    private final int[] cnt = new int[K];
    private final double[][] sum = new double[K][DIM];
    private final double[][][] sq = new double[K][DIM][DIM];

    public Gmm() {
        resetDefault();
    }

    // 空模型兜底：均匀权重、零均值、大方差
    private void resetDefault() {
        for (int k = 0; k < K; k++) {
            pi[k] = 1.0 / K;
            for (int d = 0; d < DIM; d++) {
                mean[k][d] = 0;
                for (int e = 0; e < DIM; e++) cov[k][d][e] = (d == e) ? 100.0 : 0;
            }
            updateComponent(k);
        }
    }

    // 由当前 cov 计算行列式、逆矩阵与归一化系数（含正则与钳制）
    private void updateComponent(int k) {
        double[][] c = cov[k];
        c[0][0] += REG; c[1][1] += REG; c[2][2] += REG;
        double det = det3(c);
        int guard = 0;
        while ((det < MIN_DET || !Double.isFinite(det)) && guard++ < 20) {
            c[0][0] += 10.0; c[1][1] += 10.0; c[2][2] += 10.0;
            det = det3(c);
        }
        if (!Double.isFinite(det) || det <= 0) det = MIN_DET;
        double[][] iv = inv[k];
        iv[0][0] = (c[1][1] * c[2][2] - c[1][2] * c[2][1]) / det;
        iv[0][1] = (c[0][2] * c[2][1] - c[0][1] * c[2][2]) / det;
        iv[0][2] = (c[0][1] * c[1][2] - c[0][2] * c[1][1]) / det;
        iv[1][0] = iv[0][1];
        iv[1][1] = (c[0][0] * c[2][2] - c[0][2] * c[2][0]) / det;
        iv[1][2] = (c[0][2] * c[1][0] - c[0][0] * c[1][2]) / det;
        iv[2][0] = iv[0][2];
        iv[2][1] = iv[1][2];
        iv[2][2] = (c[0][0] * c[1][1] - c[0][1] * c[1][0]) / det;
        logCoef[k] = (pi[k] > 0) ? Math.log(pi[k]) - LOG_2PI3 - 0.5 * Math.log(det)
                                 : Double.NEGATIVE_INFINITY;
    }

    private static double det3(double[][] c) {
        return c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1])
             - c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0])
             + c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0]);
    }

    // 单分量对数密度 ln(pi_k * N(x))
    private double logDensity(int k, double r, double g, double b) {
        if (pi[k] <= 0) return Double.NEGATIVE_INFINITY;
        double dr = r - mean[k][0], dg = g - mean[k][1], db = b - mean[k][2];
        double[][] iv = inv[k];
        double m = dr * (iv[0][0] * dr + iv[0][1] * dg + iv[0][2] * db)
                 + dg * (iv[1][0] * dr + iv[1][1] * dg + iv[1][2] * db)
                 + db * (iv[2][0] * dr + iv[2][1] * dg + iv[2][2] * db);
        return logCoef[k] - 0.5 * m;
    }

    // assign 步：返回密度最大的分量编号
    public int assign(double r, double g, double b) {
        int best = 0;
        double bestVal = Double.NEGATIVE_INFINITY;
        for (int k = 0; k < K; k++) {
            double v = logDensity(k, r, g, b);
            if (v > bestVal) { bestVal = v; best = k; }
        }
        return best;
    }

    // 数据项代价 -ln Pr(颜色|本模型)，用 log-sum-exp 稳定计算并钳制上限
    public double dataCost(double r, double g, double b) {
        double max = Double.NEGATIVE_INFINITY;
        double[] ld = new double[K];
        for (int k = 0; k < K; k++) {
            ld[k] = logDensity(k, r, g, b);
            if (ld[k] > max) max = ld[k];
        }
        if (max == Double.NEGATIVE_INFINITY) return 1.0e4;
        double s = 0;
        for (int k = 0; k < K; k++) {
            if (ld[k] != Double.NEGATIVE_INFINITY) s += Math.exp(ld[k] - max);
        }
        double cost = -(max + Math.log(s));
        if (cost < 0) cost = 0;
        return Math.min(cost, 1.0e4);
    }

    // learn 步之一：清零累积量
    public void beginLearning() {
        for (int k = 0; k < K; k++) {
            cnt[k] = 0;
            for (int d = 0; d < DIM; d++) {
                sum[k][d] = 0;
                for (int e = 0; e < DIM; e++) sq[k][d][e] = 0;
            }
        }
    }

    // learn 步之二：把一个样本累积到指定分量
    public void addSample(int k, double r, double g, double b) {
        cnt[k]++;
        double[] v = {r, g, b};
        for (int d = 0; d < DIM; d++) {
            sum[k][d] += v[d];
            for (int e = 0; e < DIM; e++) sq[k][d][e] += v[d] * v[e];
        }
    }

    // learn 步之三：由累积量解出 pi、均值、协方差
    public void endLearning() {
        int total = 0;
        for (int k = 0; k < K; k++) total += cnt[k];
        if (total == 0) { resetDefault(); return; }
        for (int k = 0; k < K; k++) {
            if (cnt[k] == 0) {
                pi[k] = 0;
                updateComponent(k);
                continue;
            }
            pi[k] = (double) cnt[k] / total;
            for (int d = 0; d < DIM; d++) mean[k][d] = sum[k][d] / cnt[k];
            for (int d = 0; d < DIM; d++) {
                for (int e = 0; e < DIM; e++) {
                    cov[k][d][e] = sq[k][d][e] / cnt[k] - mean[k][d] * mean[k][e];
                }
            }
            updateComponent(k);
        }
    }

    /**
     * initGMMs 用的初始化：对样本做简化 k-means（等距取初始中心，迭代到稳定），
     * 再以聚类结果走一遍 learn。members 为像素下标，comp 为全局分量数组（回填）。
     */
    public void initKMeans(double[] cr, double[] cg, double[] cb, int[] members, int[] comp) {
        int m = members.length;
        if (m == 0) { resetDefault(); return; }
        double[][] center = new double[K][DIM];
        for (int k = 0; k < K; k++) {
            int idx = members[Math.min(m - 1, (int) ((k + 0.5) * m / K))];
            center[k][0] = cr[idx]; center[k][1] = cg[idx]; center[k][2] = cb[idx];
        }
        int[] cluster = new int[m];
        int[] ccnt = new int[K];
        double[][] csum = new double[K][DIM];
        for (int iter = 0; iter < 20; iter++) {
            boolean changed = false;
            for (int j = 0; j < m; j++) {
                int idx = members[j];
                int best = 0;
                double bd = Double.MAX_VALUE;
                for (int k = 0; k < K; k++) {
                    double d0 = cr[idx] - center[k][0];
                    double d1 = cg[idx] - center[k][1];
                    double d2 = cb[idx] - center[k][2];
                    double dist = d0 * d0 + d1 * d1 + d2 * d2;
                    if (dist < bd) { bd = dist; best = k; }
                }
                if (cluster[j] != best) changed = true;
                cluster[j] = best;
            }
            for (int k = 0; k < K; k++) { ccnt[k] = 0; csum[k][0] = csum[k][1] = csum[k][2] = 0; }
            for (int j = 0; j < m; j++) {
                int idx = members[j], k = cluster[j];
                ccnt[k]++;
                csum[k][0] += cr[idx]; csum[k][1] += cg[idx]; csum[k][2] += cb[idx];
            }
            for (int k = 0; k < K; k++) {
                if (ccnt[k] > 0) {
                    center[k][0] = csum[k][0] / ccnt[k];
                    center[k][1] = csum[k][1] / ccnt[k];
                    center[k][2] = csum[k][2] / ccnt[k];
                }
            }
            if (!changed) break;
        }
        beginLearning();
        for (int j = 0; j < m; j++) {
            int idx = members[j];
            comp[idx] = cluster[j];
            addSample(cluster[j], cr[idx], cg[idx], cb[idx]);
        }
        endLearning();
    }
}
