package meowtu.grabcut;

import java.util.Arrays;

/**
 * s-t 图与最大流。求解方式与 Boykov-Kolmogorov 增广路最大流等价：
 * 这里用 Dinic 分层网络增广路求同一最大流/最小割。
 * 边全部存原始数组（正反边成对，编号互为 ^1），避免对象爆炸。
 */
final class Graph {

    private static final double EPS = 1e-10;

    private final int n;
    private final int[] head;
    private final int[] level;
    private final int[] iter;
    private final int[] queue;
    private int[] to;
    private int[] nxt;
    private double[] cap;
    private int ecnt;

    Graph(int n, int maxEdges) {
        this.n = n;
        head = new int[n];
        Arrays.fill(head, -1);
        level = new int[n];
        iter = new int[n];
        queue = new int[n];
        int m = Math.max(16, maxEdges);
        to = new int[m];
        nxt = new int[m];
        cap = new double[m];
    }

    private void ensure(int slots) {
        if (ecnt + slots <= to.length) return;
        int m = Math.max(to.length * 2, ecnt + slots);
        to = Arrays.copyOf(to, m);
        nxt = Arrays.copyOf(nxt, m);
        cap = Arrays.copyOf(cap, m);
    }

    // 加一条有向边（同时加 0 容量残量反边）
    void addEdge(int u, int v, double c) {
        if (c < 0) c = 0;
        ensure(2);
        to[ecnt] = v; cap[ecnt] = c; nxt[ecnt] = head[u]; head[u] = ecnt++;
        to[ecnt] = u; cap[ecnt] = 0; nxt[ecnt] = head[v]; head[v] = ecnt++;
    }

    // 无向平滑边：两个方向各一条，任一方向被割都计同一权重
    void addUndirected(int u, int v, double c) {
        addEdge(u, v, c);
        addEdge(v, u, c);
    }

    double maxFlow(int s, int t) {
        double flow = 0;
        while (bfs(s, t)) {
            System.arraycopy(head, 0, iter, 0, n);
            double f;
            while ((f = dfs(s, t, Double.POSITIVE_INFINITY)) > EPS) flow += f;
        }
        return flow;
    }

    private boolean bfs(int s, int t) {
        Arrays.fill(level, -1);
        int qh = 0, qt = 0;
        level[s] = 0;
        queue[qt++] = s;
        while (qh < qt) {
            int v = queue[qh++];
            for (int i = head[v]; i != -1; i = nxt[i]) {
                if (cap[i] > EPS && level[to[i]] < 0) {
                    level[to[i]] = level[v] + 1;
                    queue[qt++] = to[i];
                }
            }
        }
        return level[t] >= 0;
    }

    private double dfs(int v, int t, double f) {
        if (v == t) return f;
        double pushed = 0;
        while (iter[v] != -1 && pushed < f) {
            int i = iter[v];
            int u = to[i];
            if (cap[i] > EPS && level[u] == level[v] + 1) {
                double d = dfs(u, t, Math.min(f - pushed, cap[i]));
                if (d > EPS) {
                    cap[i] -= d;
                    cap[i ^ 1] += d;
                    pushed += d;
                    continue;
                }
            }
            iter[v] = nxt[i];
        }
        if (pushed <= EPS) level[v] = -1; // 该点本层已无出路，剪枝
        return pushed;
    }

    // 最大流后从源点沿残量边可达的点（前景侧）
    boolean[] reachableFrom(int s) {
        boolean[] vis = new boolean[n];
        int qh = 0, qt = 0;
        vis[s] = true;
        queue[qt++] = s;
        while (qh < qt) {
            int v = queue[qh++];
            for (int i = head[v]; i != -1; i = nxt[i]) {
                if (cap[i] > EPS && !vis[to[i]]) {
                    vis[to[i]] = true;
                    queue[qt++] = to[i];
                }
            }
        }
        return vis;
    }
}
