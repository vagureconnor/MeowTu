package meowtu.core;

/** 全部调节参数。除 exposure 为 EV 值外，其余均为 -100..100（sharpen 为 0..100）。 */
public class AdjustParams {
    public double exposure;    // -3..3 EV
    public double brightness;  // -100..100
    public double contrast;    // -100..100
    public double temperature; // -100..100（正=暖）
    public double tint;        // -100..100（正=洋红，负=绿）
    public double saturation;  // -100..100
    public double vibrance;    // -100..100 自然饱和度
    public double highlights;  // -100..100
    public double shadows;     // -100..100
    public double whites;      // -100..100
    public double blacks;      // -100..100
    public double clarity;     // -100..100
    public double sharpen;     // 0..100

    public void reset() {
        exposure = brightness = contrast = temperature = tint = 0;
        saturation = vibrance = highlights = shadows = whites = blacks = 0;
        clarity = sharpen = 0;
    }

    public boolean isIdentity() {
        return exposure == 0 && brightness == 0 && contrast == 0 && temperature == 0 && tint == 0
                && saturation == 0 && vibrance == 0 && highlights == 0 && shadows == 0
                && whites == 0 && blacks == 0 && clarity == 0 && sharpen == 0;
    }

    /** 把另一个参数对象的全部字段拷入本对象（保持本对象引用不变，供状态恢复用）。 */
    public void setFrom(AdjustParams o) {
        exposure = o.exposure; brightness = o.brightness; contrast = o.contrast;
        temperature = o.temperature; tint = o.tint; saturation = o.saturation;
        vibrance = o.vibrance; highlights = o.highlights; shadows = o.shadows;
        whites = o.whites; blacks = o.blacks; clarity = o.clarity; sharpen = o.sharpen;
    }

    public AdjustParams copy() {
        AdjustParams p = new AdjustParams();
        p.exposure = exposure; p.brightness = brightness; p.contrast = contrast;
        p.temperature = temperature; p.tint = tint; p.saturation = saturation;
        p.vibrance = vibrance; p.highlights = highlights; p.shadows = shadows;
        p.whites = whites; p.blacks = blacks; p.clarity = clarity; p.sharpen = sharpen;
        return p;
    }
}
