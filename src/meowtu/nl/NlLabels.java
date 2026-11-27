package meowtu.nl;

import java.util.Map;
import java.util.Set;

/** nledit.js 的标签表（PARAM_LABEL / OP_LABEL / REGION_LABEL）与 op 分类集合，NlParse.describe 与 NlEdit.plan 共用。 */
final class NlLabels {
    private NlLabels() {}

    static final Map<String, String> PARAM_LABEL = Map.ofEntries(
            Map.entry("exposure", "曝光"), Map.entry("brightness", "亮度"), Map.entry("contrast", "对比度"),
            Map.entry("temperature", "色温"), Map.entry("tint", "色调"), Map.entry("saturation", "饱和度"),
            Map.entry("vibrance", "自然饱和度"), Map.entry("highlights", "高光"), Map.entry("shadows", "阴影"),
            Map.entry("whites", "白色色阶"), Map.entry("blacks", "黑色色阶"), Map.entry("clarity", "清晰度"),
            Map.entry("sharpen", "锐化"));
    static final Map<String, String> OP_LABEL = Map.ofEntries(
            Map.entry("dehaze", "去雾"), Map.entry("soften", "柔化"), Map.entry("bw", "黑白"),
            Map.entry("denoise", "降噪"), Map.entry("grain", "颗粒感"), Map.entry("blur", "虚化"),
            Map.entry("skinSmooth", "磨皮"), Map.entry("skyBlue", "加蓝"), Map.entry("hueGreen", "加绿"),
            Map.entry("skinWhiten", "美白"), Map.entry("vignette", "暗角"));
    static final Map<String, String> REGION_LABEL = Map.ofEntries(
            Map.entry("global", "全图"), Map.entry("sky", "天空"), Map.entry("water", "水面"),
            Map.entry("greenery", "绿植"), Map.entry("portrait", "人像"), Map.entry("foreground", "主体"),
            Map.entry("background", "背景"), Map.entry("food", "全图"), Map.entry("night", "全图"));
    /** JS FILTER_OPS 的键集。 */
    static final Set<String> FILTER_OPS = Set.of("bw", "denoise", "grain", "blur", "skinSmooth");
    /** JS CUSTOM 的键集。 */
    static final Set<String> CUSTOM_OPS = Set.of("skyBlue", "hueGreen", "skinWhiten", "vignette");
}
