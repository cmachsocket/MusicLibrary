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
// ⚠️ libcurl: 走 vvb2060/curl-android (io.github.vvb2060.ndk:curl, Maven Central),
// 第一次 build 时自动从 repo1.maven.org 下载并解包到 scripts/android-prefab/。
// 静态链接进 libengine.so (libcurl_static.a + BoringSSL/nghttp2/ngtcp2 整套),
// APK 不再需要 libcurl.so / libssl.so / libcrypto.so。
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
const CURL_INCLUDE_DIR = path.join(PREFAB_ROOT, "modules", "curl_static", "include");
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

  // NDK sysroot 里 libc++_static.a 的目录名 (Android NDK 约定):
  //   arm64-v8a        → aarch64-linux-android
  //   armeabi-v7a      → arm-linux-androideabi
  //   x86              → i686-linux-android
  //   x86_64           → x86_64-linux-android
  // 静态链 BoringSSL 时需要 (libssl 内部用了 std::sort / operator delete 等 C++ 符号),
  // engine 是 C-only target,toolchain 不会自动追加;build-android.js 显式传路径给 CMake。
  const NDK_SYSROOT = path.join(ANDROID_NDK_HOME, "toolchains", "llvm", "prebuilt", "linux-x86_64", "sysroot");
  const NDK_TRIPLE_DIR = {
    "arm64-v8a": "aarch64-linux-android",
    "armeabi-v7a": "arm-linux-androideabi",
    "x86": "i686-linux-android",
    "x86_64": "x86_64-linux-android",
  }[abi];
  if (!NDK_TRIPLE_DIR) {
    console.error(`❌ 未知 ABI: ${abi} (libc++_static.a 路径映射缺失)`);
    process.exit(1);
  }
  const cxxStaticLib = path.join(NDK_SYSROOT, "usr", "lib", NDK_TRIPLE_DIR, "libc++_static.a");
  if (!fs.existsSync(cxxStaticLib)) {
    console.error(`❌ 找不到 NDK libc++_static.a: ${cxxStaticLib}`);
    process.exit(1);
  }
  // BoringSSL 的 operator delete(void*, size_t) 由 src/c/android-stubs/cxx_stubs.c 提供。
  // 为什么不从 libc.a 抽 new.o:x86_64 libc.a 里的 libc_init_common.o / sse2-memmove-slm.o
  // 等是 non-PIC (用了 R_X86_64_PC32 + 绝对符号 __x86_shared_cache_size),group 循环解析
  // 会把它们也拉进来触发 PIC 重定位错误。直接 stub 最简单。

  // 静态链接 vvb2060/curl-android：顺序必须是 curl → nghttp2/3 → ngtcp2 → boringssl
  const staticLibSpecs = [
    ["curl_static", "libcurl_static.a"],
    ["nghttp2_static", "libnghttp2_static.a"],
    ["nghttp3_static", "libnghttp3_static.a"],
    ["ngtcp2_static", "libngtcp2_static.a"],
    ["ngtcp2_crypto_static", "libngtcp2_crypto_static.a"],
    ["ssl_static", "libssl_static.a"],
    ["crypto_static", "libcrypto_static.a"],
  ];
  const staticLibs = [];
  for (const [module, fileName] of staticLibSpecs) {
    const libPath = path.join(PREFAB_ROOT, "modules", module, "libs", `android.${abi}`, fileName);
    if (!fs.existsSync(libPath)) {
      console.error(`❌ 找不到 prefab ${fileName} for ${abi}: ${libPath}`);
      console.error(`   (支持的 ABI: ${SUPPORTED_ABIS.join(", ")})`);
      process.exit(1);
    }
    staticLibs.push(libPath);
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
      `-DCURL_STATIC_LIBS="${staticLibs.join(";")}"`,
      `-DCXX_STATIC_LIB="${cxxStaticLib}"`,
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

  // 2026-08-25 迁移 vvb2060/curl-android 后，curl/BoringSSL 已静态链接进 libengine.so，
  // 不需要再单独拷贝 libcurl.so / libssl.so / libcrypto.so。
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