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

## 浏览器实测（2026-11-18 晚，主代理，真实浏览器）

- 测试站：GitHub Pages（gh-pages 分支）https://vagureconnor.github.io/MeowTu/
- 踩到两个真坑并已修复：①CheerpJ 的 /app 是网站根目录，子路径部署须带子目录名（测试页已处理；正式站 Cloudflare 在根目录，无此问题）；②必须调用 cheerpjCreateDisplay 创建显示区，否则 JAR 能启动但窗口不渲染——web/index.html 与 spike.html 已补上并推送（main 提交 1b06d4e）。
- 试跑件实测通过：Swing 窗口出现（标题「喵图 MeowTu · CheerpJ 试跑」），点按钮后标签变为「按钮可点，Swing 运行正常 ✔」。
- 正式版实测通过：主窗口完整渲染（菜单/工具栏/左侧栏/画布/右侧调节面板 13 个滑杆/状态栏）；点「示例图」画布出图（960×640）；点「复古」滤镜画面立即变色且稳定。无报错弹窗。
- 打开/保存走 CheerpJ 虚拟文件系统（页面已有提示），未做真人文件选择器全流程实测。
- 剩：Cloudflare Pages 正式部署（meowtu.pages.dev）需 Chong 在 Cloudflare 控制台把 GitHub 仓库接上（或给 API 令牌），Meow 无 Cloudflare 账号权限。

## 上线与收尾（2026-11-18 18:16–18:33）

- Chong 指出顶栏 LOGO 纵向拉伸：原图 1195×969 被强行缩成 30×30。已改 MainFrame 按原图比例缩放（高 30、宽等比），网页页眉图同步改等比；重打 JAR（1602458 字节），冒烟 29 项仍全过，Xvfb 截图与线上像素实测均确认宽>高（页眉 39×32、应用内约 33×29）。
- Chong 要求网页版极简：index.html 只留 LOGO，删标题/副标题/提示行，线上已核实。
- Cloudflare：Chong 将账户级 API 令牌存入保险库（custom.cloudflare，账号级 verify=active）。Meow 以 wrangler（替身令牌经出口换真值）建项目 meowtu 并部署两次，生产地址 https://meowtu.pages.dev ，真实浏览器实测主应用完整打开。
- GitHub main 至 676d885（极简页），gh-pages 测试站同步。
- 2026-11-18 19:00 轮（瘦身+布局+Safari+合并）：JAR 内嵌 LOGO 换 256px 小图，JAR 1.6MB→212KB；网页删整个页眉横栏，应用全屏，LOGO 只在应用顶栏内 + favicon；favicon 改方形留白版（防 Safari 标签页拉伸）；站点加 COOP/COEP 跨源隔离头（web/_headers），CheerpJ 走快速通道，Chrome 冷启动 ~60s→~30s；页面加 cj3.wasm 与 JAR 的 preload 预加载；曲线、直方图两个标签页取消，以分区形式并入「调节」页同一滚动列（AdjustPanel.addSection），右侧剩 5 个标签：调节/滤镜/几何/文字/抠图，本地截图核验合并渲染正常。main 提交至 90f338b，Cloudflare 部署 088218ab。
- 2026-11-18 19:19 更正轮：19:01 汇报的「顶栏已去掉」是错的——去掉的只是网页页眉，软件内 buildTopBar 顶栏仍在已部署的 JAR 里（解压查 class 确认）。已真删：buildTopBar/topBtn/sep 全部删除，LOGO 移到左栏顶部（按比例缩到宽 44），打开/保存/导出/示例图/撤销/重做/对比/适配竖排进左栏，对比下拉框改循环按钮；顺手修了合并后错位的 TAB 常量（点裁剪会跳错页的 bug）；favicon 改名 meowtu-logo-v2.png 防 Safari 缓存旧图；线上响应头已实测 COOP/COEP 齐全。main 提交 4e871de，待线上复测后报数。
- 2026-11-18 19:40 线上复测（无顶栏版）：三项全过——应用内无横向顶栏、LOGO 在左栏顶部、左栏「示例图」出图正常。另发现加载不稳定：首个标签页在 "Graphics system is initializing" 卡了约 16 分钟（含一次重载），换新标签页后 2 分钟内加载成功；与 19:01 那次卡 10 分钟同类现象，原因未定（对照站无 COOP/COEP 也能 30 秒开，头不是必需项）。已如实告知 Chong：卡住别干等，关标签重开。
- 2026-11-18 22:35–23:37 卡死根因轮：本地 Puppeteer 冷加载 rig 复现并抓到控制台实错——"Network error for /meowtu.jar: HTTP server does not support the 'Range' header. CheerpJ cannot run."。curl 对照实测：Cloudflare Pages 对 meowtu.jar 的 Range 请求 5/5 返回 200 全量、无 Content-Range；GitHub Pages 返回标准 206——这就是测试站稳、正式站时好时坏的原因（赶上边缘缓存状态好时偶能开）。修复：runJar 改走 /app/dl/meowtu.jar，同域加 web/_worker.js（Pages 高级模式；注：functions/ 目录部署被 wrangler 静默忽略，实测 "No Functions"，故改 _worker.js）只接管该路径、自己实现 206 分段，curl 实测 Content-Range 正确、206 到位。另按 CheerpJ 官方指南生成 preloadResources（cjGetRuntimeResources 抓取，25 组资源含两个 NotoSansCJK 字体包）写入 web/preload-resources.js 并接入 cheerpjInit；撤掉原 JAR 的 link preload（会全量拉取且被浏览器警告未使用）。修复后限速 VM 冷加载 4 连成（截图 rig 两轮 + 抓清单一轮 + 预加载验证一轮），控制台 0 报错，示例图点击出图正常；本 VM 慢在 CPU（WASM 编译+软件渲染），预加载的网络收益在此环境测不出量级，真实浏览器以 Chong 体感为准。Safari 本体仍待 Chong 自测。
