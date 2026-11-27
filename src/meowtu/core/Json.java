package meowtu.core;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 够用的小 JSON 读写器（零依赖，要薄）。
 * 对象模型：Map&lt;String,Object&gt;(LinkedHashMap 保序) / List&lt;Object&gt; / Double / String / Boolean / null。
 * write 对 Double 做整数化输出（3.0 -&gt; "3"），与网页版 JSON.stringify 互通比对口径一致。
 */
public final class Json {

    // ---------- 解析 ----------
    private final String s;
    private int i;

    private Json(String s) { this.s = s; }


    public static Object parse(String text) {
        if (text == null) throw new IllegalArgumentException("JSON 解析失败 @0: 输入为 null");
        Json p = new Json(text);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i != p.s.length()) throw p.err("尾部有多余字符");
        return v;
    }

    private IllegalArgumentException err(String msg) {
        return new IllegalArgumentException("JSON 解析失败 @" + i + ": " + msg);
    }

    private void ws() {
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++; else break;
        }
    }

    private Object value() {
        if (i >= s.length()) throw err("意外结束");
        char c = s.charAt(i);
        switch (c) {
            case '{': return object();
            case '[': return array();
            case '"': return string();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default:
                if (c == '-' || (c >= '0' && c <= '9')) return number();
                throw err("意外字符 '" + c + "'");
        }
    }

    private void expect(String lit) {
        if (!s.startsWith(lit, i)) throw err("期望 " + lit);
        i += lit.length();
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++; ws();
        if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
        while (true) {
            ws();
            if (i >= s.length() || s.charAt(i) != '"') throw err("对象键须为字符串");
            String k = string();
            ws();
            if (i >= s.length() || s.charAt(i) != ':') throw err("期望 ':'");
            i++; ws();
            m.put(k, value());
            ws();
            if (i >= s.length()) throw err("对象未闭合");
            char c = s.charAt(i++);
            if (c == '}') return m;
            if (c != ',') throw err("期望 ',' 或 '}'");
        }
    }

    private List<Object> array() {
        List<Object> a = new ArrayList<>();
        i++; ws();
        if (i < s.length() && s.charAt(i) == ']') { i++; return a; }
        while (true) {
            ws();
            a.add(value());
            ws();
            if (i >= s.length()) throw err("数组未闭合");
            char c = s.charAt(i++);
            if (c == ']') return a;
            if (c != ',') throw err("期望 ',' 或 ']'");
        }
    }

    private String string() {
        StringBuilder sb = new StringBuilder();
        i++; // 跳过开引号
        while (true) {
            if (i >= s.length()) throw err("字符串未闭合");
            char c = s.charAt(i++);
            if (c == '"') return sb.toString();
            if (c == '\\') {
                if (i >= s.length()) throw err("转义未闭合");
                char e = s.charAt(i++);
                switch (e) {
                    case '"': sb.append('"'); break;
                    case '\\': sb.append('\\'); break;
                    case '/': sb.append('/'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'u': {
                        if (i + 4 > s.length()) throw err("\\u 转义不完整");
                        int cp;
                        try { cp = Integer.parseInt(s.substring(i, i + 4), 16); }
                        catch (NumberFormatException ex) { throw err("\\u 转义非法"); }
                        i += 4;
                        sb.append((char) cp); // 代理对由两个 unicode 转义自然拼成，与 JS 同
                        break;
                    }
                    default: throw err("非法转义 '\\" + e + "'");
                }
            } else if (c < 0x20) {
                throw err("字符串含未转义控制字符");
            } else {
                sb.append(c);
            }
        }
    }

    private Double number() {
        int start = i;
        if (i < s.length() && s.charAt(i) == '-') i++;
        while (i < s.length() && Character.isDigit(s.charAt(i))) i++;
        if (i < s.length() && s.charAt(i) == '.') { i++; while (i < s.length() && Character.isDigit(s.charAt(i))) i++; }
        if (i < s.length() && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
            i++;
            if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
            while (i < s.length() && Character.isDigit(s.charAt(i))) i++;
        }
        try { return Double.parseDouble(s.substring(start, i)); }
        catch (NumberFormatException ex) { i = start; throw err("数字非法"); }
    }

    // ---------- 写出 ----------
    public static String write(Object v) {
        StringBuilder sb = new StringBuilder();
        writeTo(v, sb);
        return sb.toString();
    }

    private static void writeTo(Object v, StringBuilder sb) {
        if (v == null) { sb.append("null"); return; }
        if (v instanceof String) { quote((String) v, sb); return; }
        if (v instanceof Boolean) { sb.append(v); return; }
        if (v instanceof Double || v instanceof Float) { sb.append(num(((Number) v).doubleValue())); return; }
        if (v instanceof Number) { sb.append(v); return; }
        if (v instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                quote(String.valueOf(e.getKey()), sb);
                sb.append(':');
                writeTo(e.getValue(), sb);
            }
            sb.append('}');
            return;
        }
        if (v instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object o : (Iterable<?>) v) {
                if (!first) sb.append(',');
                first = false;
                writeTo(o, sb);
            }
            sb.append(']');
            return;
        }
        throw new IllegalArgumentException("Json.write 不支持的类型: " + v.getClass());
    }

    /** 整数值输出整数形式；其余用 BigDecimal 去科学计数法，避免失真。 */
    private static String num(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalArgumentException("Json.write: 非有限数 " + d);
        if (d == Math.rint(d) && Math.abs(d) < 1e15) return Long.toString((long) d);
        return BigDecimal.valueOf(d).stripTrailingZeros().toPlainString();
    }

    private static void quote(String str, StringBuilder sb) {
        sb.append('"');
        for (int k = 0; k < str.length(); k++) {
            char c = str.charAt(k);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }
}
