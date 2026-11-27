package meowtu.nl;

import meowtu.core.Json;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 一句话修图 · 解析器：逐逻辑移植 nl/parse.js（词库驱动，纯规则）。
 * webapp/js/nl.js 是 parse.js 的内嵌生成版，解析逻辑与 parse.js 逐字同源，无差异可取舍。
 * 词库 nl/lexicon.json 的同包副本 src/meowtu/nl/lexicon.json，用 Json 解析；
 * 加载顺序：classpath /meowtu/nl/lexicon.json → 文件 src/meowtu/nl/lexicon.json → nl/lexicon.json。
 */
public final class NlParse {
    private NlParse() {}

    /** 一条操作：对应 JS 的 {region, op, delta} / {region, op, reset:true} / {…, absolute:true}。 */
    public static final class Op {
        public String region, op;
        public Integer delta;           // reset 时为 null（对应 JS 无 delta 字段）
        public boolean reset, absolute;

        public Op(String region, String op, Integer delta) { this.region = region; this.op = op; this.delta = delta; }

        Op copy() { Op o = new Op(region, op, delta); o.reset = reset; o.absolute = absolute; return o; }

        public Map<String, Object> toJsonMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("region", region); m.put("op", op);
            if (delta != null) m.put("delta", delta.doubleValue());
            if (reset) m.put("reset", Boolean.TRUE);
            if (absolute) m.put("absolute", Boolean.TRUE);
            return m;
        }

        @Override public String toString() { return Json.write(toJsonMap()); }
    }

    /** 对应 JS parseInstruction 的返回 {ops, unsupported, unknown}。 */
    public static final class ParseResult {
        public final List<Op> ops = new ArrayList<>();
        public final List<String> unsupported = new ArrayList<>();
        public final List<String> unknown = new ArrayList<>();

        /**
         * 对应网页版「我理解为：…」的解读文本：逐条口径取自 webapp/js/nledit.js 的 plan() lines 生成
         * （区域名+操作名+带符号增量；reset 为「…恢复默认/恢复全部调节」；无法执行的标注「（暂无法执行）」）。
         */
        public String describe() {
            List<String> lines = new ArrayList<>();
            for (Op o : ops) {
                String rl = NlLabels.REGION_LABEL.getOrDefault(o.region, "全图");
                if (o.reset) {
                    lines.add(o.op.equals("all") ? "恢复全部调节"
                            : (rl.equals("全图") ? "" : rl) + NlLabels.PARAM_LABEL.getOrDefault(o.op, o.op) + "恢复默认");
                    continue;
                }
                if (NlLabels.PARAM_LABEL.containsKey(o.op) || o.op.equals("dehaze") || o.op.equals("soften")) {
                    String label = NlLabels.OP_LABEL.getOrDefault(o.op, NlLabels.PARAM_LABEL.get(o.op));
                    lines.add(rl + label + " " + (o.delta != null && o.delta > 0 ? "+" : "") + o.delta);
                } else if (NlLabels.FILTER_OPS.contains(o.op)) {
                    lines.add(rl + NlLabels.OP_LABEL.get(o.op) + (o.op.equals("bw") ? "" : " +" + o.delta));
                } else if (NlLabels.CUSTOM_OPS.contains(o.op)) {
                    lines.add(rl + NlLabels.OP_LABEL.get(o.op) + " +" + o.delta);
                } else {
                    lines.add(rl + o.op + "（暂无法执行）");
                }
            }
            if (lines.isEmpty()) {
                if (!unsupported.isEmpty()) return "这些暂时还做不到：" + String.join("、", unsupported);
                return "没太听懂，换个说法试试";
            }
            String tail = unsupported.isEmpty() ? "" : "；另外这些暂时做不到：" + String.join("、", unsupported);
            return "我理解为：" + String.join("；", lines) + tail;
        }
    }

    // ---------- 词库（对应 JS 的 LEX 与 flatWords 预处理） ----------
    private static final class Group {
        List<String> words = List.of();
        String id, op, region;
        double base, mult;
        int dir;
        List<Op> ops = List.of();
    }

    private static final class Word { final String w; final Group g; Word(String w, Group g) { this.w = w; this.g = g; } }

    private static final Map<String, Object> LEX = loadLex();
    private static final List<String> NOUNS = strList(LEX.get("nouns"));
    private static final List<String> UNSUPPORTED = strList(LEX.get("unsupported"));
    private static final List<Word> REGION_WORDS = flatWords(groups("regions"));
    private static final List<Word> ATTR_WORDS = flatWords(groups("attrs"));
    private static final List<Word> DEGREE_WORDS = flatWords(groups("degrees"));
    private static final List<Word> COMPLAINT_WORDS = flatWords(groups("complaints"));
    private static final List<Word> STYLE_WORDS = flatWords(groups("styles"));
    private static final List<Map.Entry<String, String>> PARAM_ENTRIES = paramEntries();

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadLex() {
        try {
            InputStream in = NlParse.class.getResourceAsStream("/meowtu/nl/lexicon.json");
            if (in != null) {
                try (in) { return (Map<String, Object>) Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
            }
            for (String p : new String[]{"src/meowtu/nl/lexicon.json", "nl/lexicon.json"}) {
                Path f = Path.of(p);
                if (Files.exists(f)) return (Map<String, Object>) Json.parse(Files.readString(f, StandardCharsets.UTF_8));
            }
            throw new IllegalStateException("找不到 lexicon.json（classpath 与兜底路径均无）");
        } catch (java.io.IOException e) {
            throw new IllegalStateException("读取 lexicon.json 失败", e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<String> strList(Object v) {
        List<String> out = new ArrayList<>();
        for (Object o : (List<Object>) v) out.add((String) o);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Group> groups(String key) {
        List<Group> out = new ArrayList<>();
        for (Object o : (List<Object>) LEX.get(key)) {
            Map<String, Object> m = (Map<String, Object>) o;
            Group g = new Group();
            g.words = m.containsKey("words") ? strList(m.get("words")) : List.of();
            g.id = (String) m.get("id");
            g.op = (String) m.get("op");
            g.region = (String) m.get("region");
            if (m.get("base") instanceof Number) g.base = ((Number) m.get("base")).doubleValue();
            if (m.get("mult") instanceof Number) g.mult = ((Number) m.get("mult")).doubleValue();
            if (m.get("dir") instanceof Number) g.dir = ((Number) m.get("dir")).intValue();
            if (m.get("ops") instanceof List) {
                List<Op> ops = new ArrayList<>();
                for (Object oo : (List<Object>) m.get("ops")) {
                    Map<String, Object> om = (Map<String, Object>) oo;
                    ops.add(new Op(null, (String) om.get("op"), ((Number) om.get("delta")).intValue()));
                }
                g.ops = ops;
            }
            out.add(g);
        }
        return out;
    }

    // JS flatWords：所有词按长度降序（长词优先），稳定排序与 JS Array.sort 一致
    private static List<Word> flatWords(List<Group> groups) {
        List<Word> out = new ArrayList<>();
        for (Group g : groups) for (String w : g.words) out.add(new Word(w, g));
        out.sort((a, b) -> Integer.compare(b.w.length(), a.w.length()));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map.Entry<String, String>> paramEntries() {
        List<Map.Entry<String, String>> out = new ArrayList<>();
        for (Map.Entry<String, Object> e : ((Map<String, Object>) LEX.get("paramNames")).entrySet())
            out.add(Map.entry(e.getKey(), (String) e.getValue()));
        out.sort((a, b) -> Integer.compare(b.getKey().length(), a.getKey().length()));
        return out;
    }

    // ---------- JS cnToNum ----------
    private static final Map<String, Integer> CN_NUM = Map.of(
            "一", 1, "二", 2, "两", 2, "三", 3, "四", 4, "五", 5, "六", 6, "七", 7, "八", 8, "九", 9);
    private static final Pattern CN_TEN = Pattern.compile("^([一二两三四五六七八九])?十([一二两三四五六七八九])?$");

    private static Integer cnToNum(String s) {
        if (s.matches("\\d+")) return Integer.parseInt(s);
        if (s.equals("十")) return 10;
        if (s.equals("百")) return 100;
        Matcher m = CN_TEN.matcher(s);
        if (m.matches()) return (m.group(1) != null ? CN_NUM.get(m.group(1)) : 1) * 10
                + (m.group(2) != null ? CN_NUM.get(m.group(2)) : 0);
        return CN_NUM.get(s);
    }

    // ---------- JS findRegion / findDegree / findAttrs ----------
    private static String findRegion(String clause) {
        for (Word wd : REGION_WORDS) if (clause.contains(wd.w)) return wd.g.id;
        return "global";
    }

    private static double findDegree(String clause) {
        for (Word wd : DEGREE_WORDS) if (clause.contains(wd.w)) return wd.g.mult;
        return 1.0;
    }

    private static List<Group> findAttrs(String clause) {
        List<int[]> posTmp = new ArrayList<>(); // 与 hits 并行存位置，避免额外类
        List<Group> hits = new ArrayList<>();
        boolean[] used = new boolean[clause.length()];
        Set<Group> seen = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
        for (Word wd : ATTR_WORDS) {
            if (seen.contains(wd.g)) continue;
            int i = clause.indexOf(wd.w);
            if (i < 0) continue;
            boolean overlap = false;
            for (int k = i; k < i + wd.w.length(); k++) if (used[k]) { overlap = true; break; }
            if (overlap) continue;
            for (int k = i; k < i + wd.w.length(); k++) used[k] = true;
            seen.add(wd.g);
            posTmp.add(new int[]{i});
            hits.add(wd.g);
        }
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < hits.size(); i++) order.add(i);
        order.sort((a, b) -> Integer.compare(posTmp.get(a)[0], posTmp.get(b)[0]));
        List<Group> out = new ArrayList<>();
        for (int i : order) out.add(hits.get(i));
        return out;
    }

    private static final Map<String, String> ATTR_REGION = Map.of(
            "skyBlue", "sky", "hueGreen", "greenery", "skinWhiten", "portrait", "skinSmooth", "portrait");

    // ---------- JS parseClause ----------
    private static final Pattern RESET_RE = Pattern.compile("取消|去掉|恢复|还原|清除");
    private static final Pattern NEGATE_RE = Pattern.compile("不要|别太|别");

    private static void parseClause(String rawClause, ParseResult result) {
        String clause = rawClause;
        for (String n : NOUNS) clause = clause.replace(n, "＊");
        for (String u : UNSUPPORTED) if (clause.contains(u)) result.unsupported.add(u);
        if (RESET_RE.matcher(clause).find()) {
            List<Group> attrs = findAttrs(clause);
            if (!attrs.isEmpty()) {
                for (Group g : attrs) {
                    Op o = new Op(findRegion(clause), g.op, null);
                    o.reset = true;
                    result.ops.add(o);
                }
            } else {
                Op o = new Op("global", "all", null);
                o.reset = true;
                result.ops.add(o);
            }
            return;
        }
        for (Word wd : COMPLAINT_WORDS) {
            if (clause.contains(wd.w)) {
                for (Op o : wd.g.ops) {
                    String r = wd.g.region != null ? wd.g.region : findRegion(clause);
                    if (o.op.equals("blur") && r.equals("global")) r = "background";
                    result.ops.add(new Op(r, o.op, o.delta));
                }
                return;
            }
        }
        boolean styled = false;
        for (Word wd : STYLE_WORDS) {
            if (clause.contains(wd.w)) {
                for (Op o : wd.g.ops)
                    result.ops.add(new Op(wd.g.region != null ? wd.g.region : findRegion(clause), o.op, o.delta));
                styled = true;
                break;
            }
        }
        String region = findRegion(clause);
        double mult = findDegree(clause);
        boolean negate = NEGATE_RE.matcher(clause).find();
        boolean produced = styled;
        Set<String> numericOps = new java.util.HashSet<>();
        for (Map.Entry<String, String> e : PARAM_ENTRIES) {
            String name = e.getKey(), op = e.getValue();
            Pattern re = Pattern.compile(Pattern.quote(name)
                    + "\\s*(加|减|增加|提高|降低|调到|设为|设置为|到)?\\s*(\\d+|[一二两三四五六七八九十百]+)");
            Matcher m = re.matcher(clause);
            if (m.find()) {
                Integer v = cnToNum(m.group(2));
                if (v != null) {
                    String verb = m.group(1) == null ? "" : m.group(1);
                    boolean neg = verb.contains("减") || verb.contains("降低");
                    Op o = new Op(region, op, neg ? -v : v);
                    o.absolute = verb.contains("调到") || verb.contains("设为") || verb.contains("到");
                    result.ops.add(o);
                    numericOps.add(op);
                    produced = true;
                }
            } else if (clause.contains(name)) {
                String seg = clause.substring(clause.indexOf(name) + name.length());
                if (seg.contains("高") || seg.contains("大") || seg.contains("多")) {
                    result.ops.add(new Op(region, op, (int) Math.round(10 * mult)));
                    produced = true;
                } else if (seg.contains("低") || seg.contains("小") || seg.contains("少")) {
                    result.ops.add(new Op(region, op, (int) Math.round(-10 * mult)));
                    produced = true;
                }
            }
        }
        for (Group g : findAttrs(clause)) {
            if (numericOps.contains(g.op)) continue;
            String r = ATTR_REGION.getOrDefault(g.op, region);
            if (g.op.equals("blur") && r.equals("global")) r = "background";
            int delta = (int) Math.round(g.base * g.dir * mult);
            if (negate) delta = (int) Math.round(-delta * 0.7);
            result.ops.add(new Op(r, g.op, delta));
            produced = true;
        }
        if ((region.equals("sky") || region.equals("water")) && clause.contains("蓝")
                && result.ops.stream().noneMatch(o -> o.op.equals("skyBlue"))) {
            result.ops.add(new Op(region, "skyBlue", (int) Math.round(18 * mult)));
            produced = true;
        }
        if (region.equals("greenery") && clause.contains("绿")
                && result.ops.stream().noneMatch(o -> o.op.equals("hueGreen"))) {
            result.ops.add(new Op(region, "hueGreen", (int) Math.round(16 * mult)));
            produced = true;
        }
        if (!produced) result.unknown.add(rawClause);
    }

    // ---------- JS parseInstruction ----------
    public static ParseResult parseInstruction(String text) {
        ParseResult result = new ParseResult();
        for (String c : String.valueOf(text).split("[，,、；;。]|还有|并且|然后|而且")) {
            String t = c.strip();
            if (!t.isEmpty()) parseClause(t, result);
        }
        Map<String, Op> merged = new LinkedHashMap<>();
        List<Op> out = new ArrayList<>();
        for (Op o : result.ops) {
            if (o.reset || o.absolute) { out.add(o); continue; }
            String k = o.region + "|" + o.op;
            Op prev = merged.get(k);
            if (prev != null) prev.delta += o.delta;
            else { Op cp = o.copy(); merged.put(k, cp); out.add(cp); }
        }
        for (Op o : out)
            if (o.delta != null && !o.op.equals("bw")) o.delta = Math.max(-60, Math.min(60, o.delta));
        result.ops.clear();
        result.ops.addAll(out);
        return result;
    }

    /** parseInstruction 的短名。 */
    public static ParseResult parse(String text) { return parseInstruction(text); }
}
