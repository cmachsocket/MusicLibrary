#!/usr/bin/env node
// fetch.js
// 下载并解包 Android NDK 官方 prefab 包,提供 build/runtime 需要的 .so 和 headers。
//
// 当前依赖的 prefab 包:
//   - com.android.ndk.thirdparty:curl:7.85.0-beta-1
//       headers: scripts/android-prefab/prefab/modules/curl/include/curl/
//       libs:    scripts/android-prefab/prefab/modules/curl/libs/android.<abi>/libcurl.so
//   - com.android.ndk.thirdparty:openssl:1.1.1l-beta-1
//       libs:    scripts/android-prefab/prefab/modules/openssl/libs/android.<abi>/libssl.so + libcrypto.so
//
// 用途:
//   - libcurl.so 编译期需要 curl/curl.h 头 (用 prefab headers, NDK 兼容)
//   - libcurl.so 运行时依赖 libssl.so / libcrypto.so (必须跟 libcurl.so 一起进 APK)
//   - 三个 .so 都被 build-android.js 当作 prefab 产物,跟 MusicLibrary 的 .so 一起
//     塞进 plugin 的 jniLibs/<abi>/。
//
// 跨平台 (Linux/macOS/Windows runners 都跑):用 unzip + curl 系统命令
// (Git for Windows 自带),跟项目其它 JS 脚本 (pull_ncm.js 等) 风格一致。

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);

// ===== 配置:prefab 包列表 =====
const PACKAGES = [
  {
    name: "curl",
    version: "7.85.0-beta-1",
    markerLib: "libcurl.so",
    // extractOnly = 只解 prefab/ 子目录;headers 后续会被 build-android.js 用到
    extractOnly: "prefab/*",
  },
  {
    name: "openssl",
    version: "1.1.1l-beta-1",
    markerLib: "libssl.so",
    // 解 prefab/ (跟 curl 同结构)
    extractOnly: "prefab/*",
  },
];

const PREFAB_DIR = path.join(ROOT, "prefab");

/**
 * 下载并解包单个 prefab 包 (.aar)
 * @returns {boolean} true = 新下载;false = 已缓存,跳过
 */
function fetchOne(pkg) {
  const marker = path.join(
    PREFAB_DIR,
    "modules",
    pkg.name,
    "libs",
    "android.arm64-v8a",
    pkg.markerLib,
  );
  if (fs.existsSync(marker)) {
    return false; // 已缓存
  }

  const aarName = `${pkg.name}-${pkg.version}.aar`;
  const url = `https://dl.google.com/android/maven2/com/android/ndk/thirdparty/${pkg.name}/${pkg.version}/${aarName}`;
  const cache = path.join(ROOT, aarName);

  console.log(`[prefab:${pkg.name}] downloading ${url}`);
  execSync(`curl -fsSL -o "${cache}" "${url}"`, { stdio: "inherit" });

  console.log(`[prefab:${pkg.name}] extracting ${pkg.extractOnly}...`);
  execSync(`unzip -qo "${cache}" "${pkg.extractOnly}" -d "${ROOT}"`, {
    stdio: "inherit",
  });
  fs.unlinkSync(cache);
  return true;
}

let anyNewDownload = false;
for (const pkg of PACKAGES) {
  if (fetchOne(pkg)) anyNewDownload = true;
}

if (!anyNewDownload) {
  console.log(`[prefab] all packages already cached at ${PREFAB_DIR}, skip`);
  process.exit(0);
}

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