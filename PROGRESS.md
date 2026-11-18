# 喵图 MeowTu 构建进度

## 阶段 1：CheerpJ 试跑件 ✅（本地部分）
- 查得 CheerpJ 当前官方用法：加载器 `https://cjrtnc.leaningtech.com/5.0/loader.js`，`cheerpjInit({version:17})` 后 `cheerpjRunJar("/app/xxx.jar")`（/app 映射站点根目录）。
- spike/HelloSwing.java（窗口+按钮+标签）打成 spike/hello.jar；xvfb 下运行日志输出 `SPIKE_WINDOW_SHOWN`，JAR 本身验证无误。
- web/spike.html 为试跑页，web/hello.jar 已备；web/index.html 为正式版页面（加载 meowtu.jar）。
- ⏳ 待主代理在真实浏览器打开 spike.html / index.html 实测。
- 踩坑：本机 javac 默认编码 US-ASCII，所有编译必须带 `-encoding UTF-8`（build.sh 已写死）。

## 阶段 2：工程骨架 ✅
- src/ 包结构、build.sh、README.md、.gitignore 已建。
- 首次推送：见下方推送记录。

## 推送记录
- （待填）

## 遗留问题
- GitHub 连接器的快照推送只接受 UTF-8 文本文件，二进制（meowtu.jar、LOGO PNG）需另想办法（create_or_update_file 或 git 通道），处理中。
