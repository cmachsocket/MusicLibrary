#!/usr/bin/env node
// build.js — MusicLibrary 一站式构建脚本
//
// 完整流程:
//   1. pull_ncm.js          拉取/解压 NCM 源码 + 应用所有 stub (fs/path/crypto/zlib) + inline china_ip_ranges.txt
//   2. generate_module      扫 NCM/KuGou module 目录, 生成 src/js/{ncm,kugou}/modulesDefinitions.js
//                           + src/include/*.h + src/c/{ncm,kugou}/extension.c + src/def/*.def
//   3. webpack              跑 ncm.webpack.config.js (+ kugou.webpack.config.js), 输出 bundle/js/*.js
//   4. js_to_header.js      把 bundle/js/*.js 转成 bundle/c/*.c 字符串数组 (给 quickjs C runtime 用)
//   5. cmake + make         在 <build-dir>/linux/x64/linux-x64-gcc 配 & 编出 libengine.so / libncm_music_api.so
//                           / libkugou_music_api.so / NcmTests (+ host_smoke_test)
//
// 默认 build dir: build/linux/x64/linux-x64-gcc (跟 README/CI 一致, MUSICLIBRARY_BUILD_TESTS=ON)
//
// 用法:
//   node scripts/build.js                                    完整跑 (pull + generate + bundle + cmake + make + test)
//   node scripts/build.js --skip-pull                        跳过 step 1 (复用 NeteaseCloudMusicApi/)
//   node scripts/build.js --skip-bundle                      跳过 step 2-4 (不重打 NCM bundle)
//   node scripts/build.js --skip-cmake                       跳过 step 5 (复用现有 build/ 配置)
//   node scripts/build.js --skip-test                        不跑 ctest,只到 make
//   node scripts/build.js --no-tests                         cmake 配置时不开 MUSICLIBRARY_BUILD_TESTS
//   node scripts/build.js --clean                            make clean 后重新 make
//   node scripts/build.js --configure-only                   只跑 cmake, 不跑 make/test
//   node scripts/build.js --jobs=8                           make -j8 并行
//
// 退出码: 任一步骤失败立即退出, 退出码 = 1 + 失败步骤序号 (1=pull, 2=generate, 3=bundle, 4=js_to_header, 5=cmake/make)

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
process.chdir(PROJECT_ROOT);

const args = process.argv.slice(2);

// --help / -h: 打印用法后退出
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    `Usage: node scripts/build.js [options]

Options:
  --skip-pull              跳过 step 1 (复用现有 NeteaseCloudMusicApi/)
  --skip-bundle            跳过 step 2-4 (不重打 NCM/KuGou bundle)
  --skip-cmake             跳过 step 5 (不跑 cmake/make/test)
  --skip-test              跑到 make, 不跑 ctest
  --no-tests               cmake 配置时不开 MUSICLIBRARY_BUILD_TESTS (默认 ON)
  --no-kugou               cmake 配置时不开 MUSICLIBRARY_BUILD_KUGOU (默认 ON)
  --clean                  make clean 后重新 make
  --reconfigure            强制重配 cmake (即使 build-dir 已存在)
  --configure-only         只配 cmake, 不 make/test
  --build-dir=<path>       自定义 cmake build 目录 (默认 build/linux/x64/linux-x64-gcc)
  --config=<type>          CMAKE_BUILD_TYPE (默认 Release)
  --jobs=<n>               make -j<n> 并行度 (默认 4 或 $JOBS)

Examples:
  node scripts/build.js                          # 完整构建
  node scripts/build.js --skip-pull              # 复用已 pull 的 NCM 源码
  node scripts/build.js --skip-bundle --skip-test  # 只跑 cmake + make (增量编译)
  node scripts/build.js --skip-bundle --skip-cmake --jobs=8  # 只跑 ctest, 8 并行
  node scripts/build.js --clean                  # clean + 完整重 build
`
  );
  process.exit(0);
}

const flags = new Set(args.filter((a) => a.startsWith("--")));
const flagValue = (name, def) => {
  const prefix = "--" + name + "=";
  const m = args.find((a) => a.startsWith(prefix));
  return m ? m.slice(prefix.length) : def;
};

// ---- 配置 ----
const BUILD_DIR = path.join(
  PROJECT_ROOT,
  flagValue("build-dir", "build/linux/x64/linux-x64-gcc")
);
const CMAKE_BUILD_TYPE = flagValue("config", "Release");
const JOBS = flagValue("jobs", process.env.JOBS || "4");
const BUILD_TESTS =
  flags.has("--no-tests") === false && flags.has("--configure-only") === false
    ? "ON"
    : "OFF";

// ---- 工具 ----
function step(label, fn) {
  console.log("\n\x1b[36m══════════════════════════════════════════\x1b[0m");
  console.log("\x1b[36m  STEP: " + label + "\x1b[0m");
  console.log("\x1b[36m══════════════════════════════════════════\x1b[0m");
  fn();
}

function run(cmd, opts = {}) {
  console.log("\x1b[33m$\x1b[0m " + cmd);
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
  } catch (e) {
    console.error(`\x1b[31mFAILED: ${cmd}\x1b[0m`);
    throw e;
  }
}

// ---- 步骤 1: pull_ncm.js ----
function step1_pull() {
  run("node scripts/pull_ncm.js");
}

// ---- 步骤 2: generate_module ----
function step2_generate_module() {
  // scripts/generate_module/{ncm,kugou}.js 各自生成对应 API 的 module definition
  //   (src/js/{ncm,kugou}/modulesDefinitions.js + src/include/*_music_api.h
  //    + src/c/{ncm,kugou}/extension.c + src/def/*.def)
  // pull_ncm.js 已经下载了 NeteaseCloudMusicApi/, KuGou 是 vendored.
  // 注意: scripts/generate_module_funs.js 是 kugou+ncm 合并版, 但里头 kugou 部分用了
  //   ProcessEnv (无 Kugou 前缀), 跟 src/c/kugou/main.c 不匹配, 跑会坏 kugou build。
  //   所以这里走 per-API 路径, 跟 webpack config 一致。
  if (!fs.existsSync(path.join(PROJECT_ROOT, "NeteaseCloudMusicApi"))) {
    throw new Error(
      "NeteaseCloudMusicApi/ 不存在, 必须先跑 step 1 (--skip-pull 会被忽略)"
    );
  }
  if (!fs.existsSync(path.join(PROJECT_ROOT, "KuGouMusicApi"))) {
    throw new Error(
      "KuGouMusicApi/ 不存在, 必须先跑 step 1 (--skip-pull 会被忽略)"
    );
  }
  run("node scripts/generate_module/ncm.js");
  run("node scripts/generate_module/kugou.js");
}

// ---- 步骤 3 + 4: webpack + js_to_header ----
function step3_webpack() {
  // ncm.webpack.config.js / kugou.webpack.config.js 各自跑一次 webpack
  //   output: bundle/js/ncm_music_api_bundle.js (+ kugou 的)
  //   done hook 自动调用 js_to_header.js -> bundle/c/*.c
  run("npx webpack --config scripts/ncm.webpack.config.js");
  run("npx webpack --config scripts/kugou.webpack.config.js");
}

function step4_js_to_header() {
  // ncm.webpack.config.js 已经在 done hook 里调 js_to_header() 自动跑
  // 这里额外手动跑一次, 兜底 (万一个 hook 改了)
  run("node scripts/js_to_header.js");
}

// ---- 步骤 5: cmake + make + ctest ----
function step5_cmake_make_test(doMake, doTest) {
  if (flags.has("--clean")) {
    run(`rm -rf "${BUILD_DIR}"`);
  }

  // cmake configure
  if (!fs.existsSync(BUILD_DIR) || flags.has("--reconfigure")) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    const kugouOpt = flags.has("--no-kugou") ? "OFF" : "ON";
    run(
      `cmake -S "${PROJECT_ROOT}" -B "${BUILD_DIR}" ` +
        `-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE} ` +
        `-DMUSICLIBRARY_BUILD_TESTS=${BUILD_TESTS} ` +
        `-DMUSICLIBRARY_BUILD_ENGINE=ON ` +
        `-DMUSICLIBRARY_BUILD_NCM=ON ` +
        `-DMUSICLIBRARY_BUILD_KUGOU=${kugouOpt}`
    );
  } else {
    console.log(
      `\x1b[33m(skip cmake configure: ${BUILD_DIR} 已存在, 用 --reconfigure 强制重配)\x1b[0m`
    );
  }

  if (!doMake && !doTest) return;

  // make
  if (flags.has("--clean")) {
    run(`cmake --build "${BUILD_DIR}" --target clean`);
  }
  run(`cmake --build "${BUILD_DIR}" --parallel ${JOBS}`);

  if (!doTest) return;

  // ctest (只在 NcmTests 已 build 时跑)
  // binary 路径是 ${BUILD_DIR}/${CONFIG}/bin/NcmTests (CMAKE_RUNTIME_OUTPUT_DIRECTORY 设了 $<CONFIG>)
  const testBin = path.join(BUILD_DIR, CMAKE_BUILD_TYPE, "bin", "NcmTests");
  if (!fs.existsSync(testBin)) {
    console.log(
      `\x1b[33m(skip ctest: ${testBin} 不存在, BUILD_TESTS=${BUILD_TESTS})\x1b[0m`
    );
    return;
  }
  run(`ctest --test-dir "${BUILD_DIR}" --output-on-failure`);
}

// ---- 入口 ----
async function main() {
  console.log("\x1b[35mMusicLibrary build\x1b[0m");
  console.log(`  PROJECT_ROOT = ${PROJECT_ROOT}`);
  console.log(`  BUILD_DIR    = ${BUILD_DIR}`);
  console.log(`  CONFIG       = ${CMAKE_BUILD_TYPE}`);
  console.log(`  JOBS         = ${JOBS}`);
  console.log(`  BUILD_TESTS  = ${BUILD_TESTS}`);
  console.log(
    `  BUILD_KUGOU  = ${flags.has("--no-kugou") ? "OFF" : "ON"}`
  );
  console.log(`  flags        = ${[...flags].join(", ") || "(none)"}`);

  const skipPull = flags.has("--skip-pull");
  const skipBundle = flags.has("--skip-bundle");
  const skipCmake = flags.has("--skip-cmake");
  const skipTest = flags.has("--skip-test");
  const configureOnly = flags.has("--configure-only");

  // 计算实际要跑的步骤总数 (用于 X/Y 标号)
  const steps = [];
  if (!skipPull) steps.push([1, "pull_ncm.js (NCM 4.40.1 + stubs + inline china_ip_ranges)", step1_pull]);
  if (!skipBundle) {
    steps.push([2, "generate_module (scan NCM/KuGou module dir -> C/JS definitions)", step2_generate_module]);
    steps.push([3, "webpack (ncm + kugou bundle -> bundle/js/*.js)", step3_webpack]);
    steps.push([4, "js_to_header (bundle/js/*.js -> bundle/c/*.c)", step4_js_to_header]);
  }
  if (!skipCmake) {
    steps.push([5, `cmake + make${skipTest ? "" : " + ctest"} (${BUILD_DIR})`, () =>
      step5_cmake_make_test(/*doMake*/ !configureOnly, /*doTest*/ !skipTest)
    ]);
  }
  const total = steps.length;
  for (const [n, label, fn] of steps) {
    step(`${n}/${total}: ${label}`, fn);
  }

  console.log("\n\x1b[32m✔ build complete\x1b[0m");
}

main().catch((e) => {
  console.error("\n\x1b[31m✘ build failed\x1b[0m");
  process.exit(1);
});