# 喵图 MeowTu · 构建进度

> 纯 Java（JDK 17）图像编辑工具，零第三方依赖；网页端用 CheerpJ 运行同一个 JAR。
> 仓库：https://github.com/vagureconnor/MeowTu

## 阶段状态（全部完成 ✅，更新于 2026-11-18）

1. ✅ **CheerpJ 试跑件**：`web/index.html`（正式页）与 `web/spike.html` 用官方加载器
   `https://cjrtnc.leaningtech.com/5.0/loader.js` + `cheerpjInit({version:17})` + `cheerpjRunJar("/app/meowtu.jar")`；
   `web/hello.jar` 为最小 Swing 验证程序，xvfb 下启动并显示窗口验证通过（日志 SPIKE_WINDOW_SHOWN）。
   ⏳ 浏览器实测（CheerpJ 在真实浏览器加载 JAR、文件打开/保存）待主代理验。
2. ✅ **工程骨架**：`src/` 五包结构、`build.sh` 一键构建（javac -encoding UTF-8 + 打 JAR，Main-Class: meowtu.Main，自动同步 web/meowtu.jar）、`README.md`、`.gitignore`。
3. ✅ **flatui 美化库**（`meowtu.flatui`，12 个类）：深色主题 #2B2B2B 系 + 强调蓝 #4A9EFF；圆角按钮、细滑杆（蓝填充轨道+白圆钮）、细滚动条、标签页（选中蓝下划线）、菜单栏（自写 UI 替换 Metal 浅色渐变）、下拉框、复选框、输入框、工具栏、分隔线、矢量图标（FlatIcons 程序化绘制）、SliderRow 等复合控件。
4. ✅ **主程序与核心编辑**：PhotoCraft 式布局（顶栏 LOGO/打开/保存/导出/示例图/撤销/重做/对比模式；左窄工具栏；中央画布棋盘格透明底+缩放适配/滚轮缩放；右侧七标签页；底部状态栏）。LUT 参数引擎 13 项（曝光/亮度/对比度/色温/色调/饱和度/自然饱和度/高光/阴影/白色/黑色/清晰度/锐化），拖动降采样实时预览、松手全图应用；撤销/重做快照栈上限 20；打开/保存 PNG/JPG/BMP/GIF/TIFF + 手写 PPM/PGM 编解码；导出缩放+JPEG 质量选项。
5. ✅ **几何/滤镜/曲线/直方图/文字/对比**：旋转 90°/任意角度、翻转、裁剪（自由+1:1/4:3/3:2/16:9）、四角透视矫正、桶形/枕形畸变、波浪、旋涡；18 个滤镜（复古/老照片/黑白/褪色/日系/青橙/油画 Kuwahara/素描/彩铅/浮雕/马赛克/水彩/梦幻柔光/光晕/X光/红外/热力/夜视）各带强度滑杆；曲线编辑器（RGB 合成+单通道、样条插值、拖点/双击加点/右键删点/5 预设）；直方图（RGB+明度、均值/中位数/标准差）；文字多对象（系统字体/字号/颜色/粗斜体/描边/画布拖动/栅格化导出）；前后对比三模式（左右分屏/滑块擦除/长按看原图）。
6. ✅ **GrabCut 抠图**（`meowtu.grabcut`，663 行）：按 OpenCV 原结构翻译——GMM 5 分量、gamma=50、lambda=9×gamma、图割最大流（Dinic 等价实现）、矩形框选+前景/背景画笔修补、迭代 3 次；大图降采样算蒙版；引导滤波细化 alpha + 羽化；导出透明 PNG 或换背景色。
7. ✅ **收尾自检**：见下方测试证据。

## 测试证据

- 全量编译 `-Xlint:all`：**0 警告**；总代码 **5345 行**（src+test）。
- headless 冒烟测试 `test/SmokeTest.java`：**29 项断言全 PASS**（恒等/曝光/色温 LUT、恒等曲线、18 滤镜逐个、旋转/翻转/裁剪/畸变/波浪、PNG/JPG/BMP/GIF/TIFF/PPM/PGM 往返、直方图统计、GrabCut 小图抠图）。
- GrabCut 子模块自测：96×96 合成图前景/背景像素全对（74ms）；480×480 三次迭代 720ms。
- UI 截图验收（Xvfb + Robot 截屏）：深色主题、菜单栏、工具栏、滑杆行、标签页均按设计渲染；示例图加载、状态栏正常。验收中修掉 4 个真 bug：①Swing 委托类缺 createUI 工厂导致主题整体失效；②Metal 菜单栏自带浅色渐变（已自写 FlatMenuBarUI）；③长提示行撑宽滚动面板致滑杆行错位（已拆短行+视口宽度跟踪面板 TrackPanel）；④曲线样条端点处理使恒等曲线改像素（已用反射端点修正）。

## 推送记录

- 2026-11-18 首次推送：commit `b5b7583078bcdabb255a998a03f138e1c4f5a5ed`（45 个文本文件），读回验证一致。
- 2026-11-18 最终推送：全部源码（含 flatui 修复、TrackPanel、FlatMenuBarUI、SmokeTest、本文件），提交号见仓库 main 最新记录。

## 遗留问题

- ✅ **二进制文件已补齐**（2026-11-18 17:31，主代理）：经 Git Data API（凭据走保险库替身注入，全程无审批卡）一次提交 `4b06169544f3` 推入 meowtu.jar、web/meowtu.jar、web/hello.jar、assets 两张 LOGO 与 web LOGO，blob SHA 与本地逐个核对一致、已读回验证。
- ⏳ **浏览器实测待主代理**：CheerpJ 在真实浏览器打开 `web/index.html`/`web/spike.html` 是否顺利加载 JAR、文件打开/保存对话框是否可用（沙盒无头验证 ≠ 浏览器结论）。
- 已知取舍：JAR 内含 1.46MB 的 LOGO 资源（运行时顶栏/关于页显示用）；抠图大图蒙版上限边长 720；CheerpJ 若整包加载 JAR 失败，备选把 JAR 放 R2 并用 Pages Function 支持 Range 转发。
