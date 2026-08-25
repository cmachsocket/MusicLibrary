#!/usr/bin/env node
// fetch.js
// 下载并解包 Android NDK 官方 prefab curl 包,提供:
//   - prefab/modules/curl/include/  (NDK 兼容的 curl headers)
//   - prefab/modules/curl/libs/android.<abi>/libcurl.so (运行时链接)
//
// 用途:MusicLibrary Android build 用 prefab headers 编译,plugin 用 prefab .so 链接运行时。
// 复用 AGP prefab 的同一个包 (com.android.ndk.thirdparty:curl:7.85.0-beta-1),
// 保证 APK 里 dlsym 行为跟 AGP prefab 一致。
//
// 跨平台 (Linux/macOS/Windows runners 都跑):用 unzip + curl 系统命令(Git for Windows 自带),
// 跟项目其它 JS 脚本 (pull_ncm.js 等) 风格一致。
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);
const CURL_VERSION = "7.85.0-beta-1";
const AAR_NAME = `curl-${CURL_VERSION}.aar`;
const AAR_URL = `https://dl.google.com/android/maven2/com/android/ndk/thirdparty/curl/${CURL_VERSION}/${AAR_NAME}`;
const CACHE_FILE = path.join(ROOT, AAR_NAME);
const PREFAB_DIR = path.join(ROOT, "prefab");
const MARKER = path.join(PREFAB_DIR, "modules", "curl", "libs", "android.arm64-v8a", "libcurl.so");

if (fs.existsSync(MARKER)) {
  console.log(`[prefab] already cached at ${PREFAB_DIR}, skip download`);
  process.exit(0);
}

console.log(`[prefab] downloading ${AAR_URL}`);
execSync(`curl -fsSL -o "${CACHE_FILE}" "${AAR_URL}"`, { stdio: "inherit" });

console.log("[prefab] extracting...");
// 只解 prefab/ 子目录;AndroidManifest.xml 和 META-INF/ 是 aar 包的签名,没用。
execSync(`unzip -qo "${CACHE_FILE}" "prefab/*" -d "${ROOT}"`, { stdio: "inherit" });
fs.unlinkSync(CACHE_FILE);

console.log("[prefab] done, structure:");
function list(dir, prefix = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, e.name);
    if (e.isDirectory()) {
      list(path.join(dir, e.name), rel);
    } else {
      console.log(`  ${rel}`);
    }
  }
}
if (fs.existsSync(PREFAB_DIR)) list(PREFAB_DIR);