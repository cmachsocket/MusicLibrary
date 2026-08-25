#!/usr/bin/env node
// build-android.js
// 用 Android NDK 预编译 MusicLibrary 的 native 库,产出 *.so 给 Flutter plugin 嵌入。
//
// 跨平台 (Linux/macOS/Windows runners 都跑):Node.js 不依赖 bash shell,
// 在 Windows runner 上 Git for Windows 提供 cmake / curl / unzip 等系统命令。
//
// 默认 ABI: arm64-v8a。
// 输出目录: build/android/dist/<abi>/{lib*.so}
//
// 用法:
//   node scripts/build-android.js                       # 默认 arm64-v8a
//   node scripts/build-android.js arm64-v8a x86_64      # 多 ABI
//   node scripts/build-android.js --all                 # 全部 4 ABI
//
// 跟 NeteaseCloudMusic_PythonSDK/src/dart/android 的预编译嵌入流程配套:
// build 出来的 .so 直接 copy 到 src/dart/android/src/main/jniLibs/<abi>/ 下,
// AGP 自动打包进 APK。
//
// ⚠️ libcurl: 走 Android NDK 官方 prefab 包 (com.android.ndk.thirdparty:curl),
// 第一次 build 时自动从 maven.google.com 下载并解包到 scripts/android-prefab/。
// 运行时:plugin 那边 (Gradle) 也依赖同样的 prefab curl 包,
// 编译期 .so 用 prefab/libcurl.so 链接占位,运行时 APK 里 prefab 提供真版。
//
// ⚠️ kugou: 2026-08-25 改为 ON。主 CMakeLists 里 kugou_music_api 是无条件 add_library,
//   "关掉" 只能从 host app 側不 dlopen,节省不了 APK 体积 (都进 jniLibs)。
//   所以 build 总是全编 (engine + ncm + kugou),consumer 要不要用是 dart 代码的责任。
//
// 依赖:Node.js 18+、cmake 3.21+、curl、unzip、Android NDK r25+(本仓库用 r29)。

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const SUPPORTED_ABIS = ["arm64-v8a", "x86_64", "armeabi-v7a", "x86"];

let abis;
if (args.length === 0) {
  abis = ["arm64-v8a"];
} else if (args[0] === "--all") {
  abis = SUPPORTED_ABIS.slice();
} else {
  const unknown = args.filter((a) => !SUPPORTED_ABIS.includes(a));
  if (unknown.length > 0) {
    console.error(`❌ 未知 ABI: ${unknown.join(", ")};支持: ${SUPPORTED_ABIS.join(", ")}`);
    process.exit(1);
  }
  abis = args;
}

// ---------- 前置检查 ----------
const ANDROID_NDK_HOME = process.env.ANDROID_NDK_HOME;
if (!ANDROID_NDK_HOME) {
  console.error(
    "❌ ANDROID_NDK_HOME 未设置。例: export ANDROID_NDK_HOME=/opt/android-sdk/ndk/29.0.14206865",
  );
  process.exit(1);
}

const toolchainFile = path.join(ANDROID_NDK_HOME, "build", "cmake", "android.toolchain.cmake");
if (!fs.existsSync(toolchainFile)) {
  console.error(`❌ 找不到 NDK toolchain: ${toolchainFile}`);
  process.exit(1);
}

for (const cmd of ["cmake", "ninja", "curl", "unzip"]) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
  } catch {
    console.error(`❌ 缺少 ${cmd}。请先安装。`);
    process.exit(1);
  }
}

// ---------- 准备 prefab curl ----------
console.log("[0/3] 准备 Android NDK prefab curl 包...");
execSync(`node "${path.join(PROJECT_ROOT, "scripts", "android-prefab", "fetch.js")}"`, {
  stdio: "inherit",
  cwd: PROJECT_ROOT,
});

const PREFAB_ROOT = path.join(PROJECT_ROOT, "scripts", "android-prefab", "prefab");
const CURL_INCLUDE_DIR = path.join(PREFAB_ROOT, "modules", "curl", "include");
if (!fs.existsSync(path.join(CURL_INCLUDE_DIR, "curl", "curl.h"))) {
  console.error(`❌ prefab curl headers 没准备好: ${CURL_INCLUDE_DIR}`);
  process.exit(1);
}

// ---------- 准备 dist 输出目录 ----------
const DIST = path.join(PROJECT_ROOT, "build", "android", "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// ---------- 主循环:每个 ABI 一次 build ----------
for (const abi of abis) {
  console.log();
  console.log("============================================================");
  console.log(`[build-android] ABI: ${abi}`);
  console.log("============================================================");

  const curlLib = path.join(PREFAB_ROOT, "modules", "curl", "libs", `android.${abi}`, "libcurl.so");
  if (!fs.existsSync(curlLib)) {
    console.error(`❌ 找不到 prefab libcurl.so for ${abi}: ${curlLib}`);
    console.error(`   (支持的 ABI: ${SUPPORTED_ABIS.join(", ")})`);
    process.exit(1);
  }

  const buildDir = path.join(PROJECT_ROOT, "build", "android", abi);

  console.log("[1/3] cmake configure (用 scripts/CMakeLists.txt 作为 root)...");
  execSync(
    [
      "cmake",
      `-S "${path.join(PROJECT_ROOT, "scripts")}"`,
      `-B "${buildDir}"`,
      "-G Ninja",
      `-DCMAKE_TOOLCHAIN_FILE="${path.join(ANDROID_NDK_HOME, "build", "cmake", "android.toolchain.cmake")}"`,
      `-DANDROID_ABI=${abi}`,
      "-DANDROID_PLATFORM=android-23",
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=ON",
      `-DCURL_INCLUDE_DIR="${CURL_INCLUDE_DIR}"`,
      `-DCURL_LIB="${curlLib}"`,
    ].join(" "),
    { stdio: "inherit", cwd: PROJECT_ROOT },
  );

  console.log("[2/3] cmake build (ncm_music_api + engine + kugou_music_api)...");
  execSync(
    `cmake --build "${buildDir}" --target ncm_music_api engine kugou_music_api -j $(nproc 2>/dev/null || echo 4)`,
    { stdio: "inherit", cwd: PROJECT_ROOT },
  );

  // collect .so
  const abiDist = path.join(DIST, abi);
  fs.mkdirSync(abiDist, { recursive: true });
  console.log(`[3/3] collect .so -> ${abiDist}`);

  // 主输出目录 (engine / ncm_music_api / kugou_music_api)
  const mainLibDir = path.join(buildDir, "Release", "lib");
  copyAllSoFiles(mainLibDir, abiDist);
  // quickjs 子项目的 libqjs.so (在 musiclibrary_build/quickjs/ 下,不在 Release/lib)
  const quickjsLibDir = path.join(buildDir, "musiclibrary_build");
  copyAllSoFiles(quickjsLibDir, abiDist, /* maxDepth */ 3);

  // 同时塞 prefab libcurl.so,让 plugin 直接 copy 整套 (覆盖 apk libs/<abi>/)
  fs.copyFileSync(curlLib, path.join(abiDist, "libcurl.so"));
  console.log(`  ${abi}/libcurl.so`);
}

// ---------- 完成 ----------
console.log();
console.log("============================================================");
console.log("[build-android] 全部完成");
console.log(`输出目录: ${DIST}`);
console.log("树状结构:");
listFilesRecursive(DIST);
console.log();
console.log("下一步: 把这些 .so copy 到 NeteaseCloudMusic_PythonSDK 的 plugin jniLibs:");
console.log(`  cp -v ${DIST}/arm64-v8a/*.so \\`);
console.log(
  `    ${path.resolve(PROJECT_ROOT, "..", "NeteaseCloudMusic_PythonSDK", "src", "dart", "android", "src", "main", "jniLibs", "arm64-v8a")}/`,
);

/**
 * 递归收集 srcDir 下 (限制 maxDepth 层) 所有 .so,copy 到 dstDir。
 * 用 cp/copy 命令 (Windows 上是 cmd 的 copy)。
 */
function copyAllSoFiles(srcDir, dstDir, maxDepth = 1) {
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(srcDir, e.name);
    if (e.isDirectory() && maxDepth > 1) {
      copyAllSoFiles(full, dstDir, maxDepth - 1);
    } else if (e.isFile() && e.name.endsWith(".so")) {
      fs.copyFileSync(full, path.join(dstDir, e.name));
      console.log(`  ${path.relative(DIST, path.join(dstDir, e.name))}`);
    }
  }
}

function listFilesRecursive(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listFilesRecursive(full);
    } else if (e.isFile()) {
      console.log(`  ${path.relative(DIST, full)}`);
    }
  }
}