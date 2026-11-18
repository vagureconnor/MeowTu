#!/bin/sh
# 喵图 MeowTu 一键构建：编译全部源码并打成可双击运行的 meowtu.jar
set -e
cd "$(dirname "$0")"

# 找 JDK：优先 PATH 上的 javac，其次本机工具目录
if command -v javac >/dev/null 2>&1; then
  JAVAC=javac; JAR=jar
elif [ -x "$HOME/workspace/tools/jdk-17.0.21+9/bin/javac" ]; then
  JAVAC="$HOME/workspace/tools/jdk-17.0.21+9/bin/javac"
  JAR="$HOME/workspace/tools/jdk-17.0.21+9/bin/jar"
else
  echo "找不到 javac，请先安装 JDK 17" >&2; exit 1
fi

rm -rf out
mkdir -p out
find src -name '*.java' > sources.txt
"$JAVAC" -encoding UTF-8 -Xlint:all -d out @sources.txt
rm -f sources.txt

# LOGO 作为资源打进 JAR（窗口图标/顶栏用小图版，控制 JAR 体积；原图留在 assets/）
cp assets/meowtu-logo-embed.png out/meowtu-logo-final.png

printf 'Main-Class: meowtu.Main\n' > MANIFEST.tmp
"$JAR" cfm meowtu.jar MANIFEST.tmp -C out .
rm -f MANIFEST.tmp
# 同步一份到 web/ 供网页版加载
cp meowtu.jar web/meowtu.jar
echo "构建完成：meowtu.jar（已同步 web/meowtu.jar）"
