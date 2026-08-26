// NCM_API_VERSION 指定要拉取的版本
const NCM_API_VERSION = "4.40.1";
const TGZ_NAME = `neteasecloudmusicapienhanced-api-${NCM_API_VERSION}.tgz`;
const API_DIR = "NeteaseCloudMusicApi";
const PACKAGE_DIR = `${API_DIR}/package`;
const path = require("path");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const { execSync } = require("child_process");
const fs = require("fs");

// 1. 下载tgz包
console.log(`[pull_ncm] 下载 @neteasecloudmusicapienhanced/api@${NCM_API_VERSION} ...`);
execSync(`npm pack @neteasecloudmusicapienhanced/api@${NCM_API_VERSION}`, {
  stdio: "inherit",
  cwd: PROJECT_ROOT,
});
// 2. 解压到根目录NeteaseCloudMusicApi
const tgzPath = path.join(PROJECT_ROOT, TGZ_NAME);
const apiDirPath = path.join(PROJECT_ROOT, API_DIR);
const packageDirPath = path.join(PROJECT_ROOT, PACKAGE_DIR);
console.log(`[pull_ncm] 解压 ${tgzPath} 到 ${apiDirPath} ...`);
if (fs.existsSync(apiDirPath)) {
  fs.rmSync(apiDirPath, { recursive: true, force: true });
}
fs.mkdirSync(apiDirPath);
execSync(`tar -xzf ${tgzPath} -C ${apiDirPath}`);

// 3. 移动package子目录内容到NeteaseCloudMusicApi根目录
console.log(`[pull_ncm] 移动 package/* 到 ${apiDirPath}/ ...`);
if (fs.existsSync(packageDirPath)) {
  const files = fs.readdirSync(packageDirPath);
  for (const file of files) {
    const src = path.join(packageDirPath, file);
    const dest = path.join(apiDirPath, file);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.renameSync(src, dest);
  }
}

// 4. 清理tgz包
console.log(`[pull_ncm] 删除临时包 ${tgzPath} ...`);
fs.unlinkSync(tgzPath);

// 5. 删除 register_anonimous.js 中 path 和 fs 的 require
const regAnonFile = path.join(apiDirPath, "module", "register_anonimous.js");
console.log(`[pull_ncm] 处理 ${regAnonFile} ...`);
if (fs.existsSync(regAnonFile)) {
  let content = fs.readFileSync(regAnonFile, "utf8");
  // 删除 const path = require('path') 和 const fs = require('fs')
  content = content.replace(/^const\s+path\s*=\s*require\(['"]path['"]\).*$/gm, "");
  content = content.replace(/^const\s+fs\s*=\s*require\(['"]fs['"]\).*$/gm, "");
  fs.writeFileSync(regAnonFile, content);
  console.log("[pull_ncm] 已移除 register_anonimous.js 中 path 和 fs 的 require");
}

// 6. stub 掉所有 NCM 源文件里的 node 内置 crypto / zlib require
//    原因: NCM 4.40.x 在 util/crypto.js / util/client-sign.js / util/fileHelper.js
//    / util/ncbl.js / module/scrobble_v1.js 等多处无脑 require('crypto') / require('zlib'),
//    用于 aesEcbEncrypt / xeapiDecrypt / scrobble 等 Node-only 函数
//    (AES-GCM / X25519 / RSA / gzip 解压)。
//    webpack 5 默认不 polyfill node 内置,编 NCM bundle 会失败。
//
//    这些函数只用于 NCM 的高级 / 实验性端点 (xeapi / ncbl / scrobble),
//    不影响主线接口 (/song/url /login /likelist 等)。
//    直接 stub 成空对象,运行时调用这些函数会抛 TypeError,
//    业务侧不会触发 (我们不走这些高级端点)。
function stubNodeBuiltinRequires(dir) {
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
    }
  }
  walk(dir);
  let stubbed = 0;
  for (const file of files) {
    let content = fs.readFileSync(file, "utf8");
    const before = content;
    content = content.replace(
      /^const\s+crypto\s*=\s*require\(['"]crypto['"]\)\s*$/gm,
      "const crypto = {} // stubbed by pull_ncm.js (node crypto unsupported in webpack bundle)",
    );
    content = content.replace(
      /^const\s+zlib\s*=\s*require\(['"]zlib['"]\)\s*$/gm,
      "const zlib = {} // stubbed by pull_ncm.js (node zlib unsupported in webpack bundle)",
    );
    if (content !== before) {
      fs.writeFileSync(file, content);
      stubbed++;
    }
  }
  console.log(`[pull_ncm] 已 stub ${stubbed} 个文件中的 node crypto / zlib require`);
}
stubNodeBuiltinRequires(apiDirPath);

// 6.5 移除 webpack bundle 无法 resolve 的 npm 依赖 require
//     (dotenv / jsdom / @neteasecloudmusicapienhanced/unblockmusic-utils)
//
//     原因: NCM 4.40.x 的 song_url_match.js / register_checktoken_v2.js 等在顶层
//     require 这些包, webpack 5 不装, resolve 失败直接报错。
//     这两个端点业务侧不走 (我们只调 /song/url 老接口), 删 require 让调用时 throw 即可。
function removeUnresolvableRequires(dir, packages) {
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
    }
  }
  walk(dir);
  let patched = 0;
  for (const file of files) {
    let content = fs.readFileSync(file, "utf8");
    const before = content;
    for (const pkg of packages) {
      // 1) require('<pkg>').config() → 整行 (或接续 .config() 那行) 干掉
      //    处理缩进: 用之前的空格作为缩进, 后接注释
      content = content.replace(
        new RegExp(
          `^([ \\t]*)require\\(['"]${pkg.replace(/[\\/]/g, "\\$&")}['"]\\)\\.config\\(\\)`,
          "gm",
        ),
        `$1// ${pkg}.config() removed by pull_ncm.js (unavailable in webpack bundle)`,
      );
      // 2) 单行 const xxx = require('<pkg>')
      content = content.replace(
        new RegExp(
          `^([ \\t]*)const\\s+\\w+\\s*=\\s*require\\(['"]${pkg.replace(/[\\/]/g, "\\$&")}['"]\\)`,
          "gm",
        ),
        `$1// removed by pull_ncm.js (${pkg} unavailable in webpack bundle)\n$1const ${pkg
          .replace(/[^a-zA-Z0-9]/g, "_")
          .replace(/^_+|_+$/g, "") || "stub"} = {}`,
      );
      // 3) 多行 const { X, Y } = require('<pkg>'): 跨多行, 起点是 const { 行, 终点是 } = require('<pkg>')
      //    走 \s 匹配换行. 加 ^ + m flag 保证只在行首开始. 中间不能跨 require (避免吃掉中间代码).
      content = content.replace(
        new RegExp(
          `^[ \\t]*const\\s*\\{(?:(?!require\\()[\\s\\S])*?\\}\\s*=\\s*require\\(['"]${pkg
            .replace(/[\\/]/g, "\\$&")
            }['"]\\)\\s*$`,
          "gm",
        ),
        `// const { ... } = require('${pkg}') removed by pull_ncm.js (unavailable in webpack bundle)`,
      );
    }
    if (content !== before) {
      fs.writeFileSync(file, content);
      patched++;
    }
  }
  console.log(`[pull_ncm] 已移除 ${patched} 个文件中的不可 resolve require (dotenv/jsdom/unblockmusic-utils)`);
}
removeUnresolvableRequires(apiDirPath, [
  "dotenv",
  "jsdom",
  "@neteasecloudmusicapienhanced/unblockmusic-utils",
  // 2026-08-26 补充: NCM 4.40.x util/request.js 顶层 require 了一堆 node 内置
  //   webpack 5 默认报 'Cannot find module "fs"' (webpackMissingModule) 让 bundle 编不出。
  //   这里加进去也 stub 掉: fs/os/path/http/https/tunnel/url/stream/util/net/tls/dns/http2/
  //   child_process/assert/events/querystring。Buffer/crypto/zlib 走 banner polyfill (js_to_header
  //   注入的 globalThis.Buffer + crypto.getRandomValues),但 webpack 这里也要 fallback:false
  //   让 require 不报 webpackMissingModule。
  "fs",
  "os",
  "path",
  "http",
  "https",
  "tunnel",
  "url",
  "stream",
  "util",
  "net",
  "tls",
  "dns",
  "http2",
  "child_process",
  "assert",
  "events",
  "querystring",
  "buffer", // webpack fallback:false 留个 stub, banner polyfill 的 globalThis.Buffer 会覆盖
]);

// 7. 移除 song_url_v1.js 顶层的 unblockmusic-utils + dotenv require
//    原因: NCM 4.40.x 的 song_url_v1.js 顶层无条件 require 这两个包 (即使业务不传
//    unblock=true 也会触发 webpack resolve, 而我们的 MusicLibrary 不装这些包)。
//
//    - @neteasecloudmusicapienhanced/unblockmusic-utils: 只在 query.unblock === 'true'
//      分支里调 matchID(...), 我们项目不走 unblock, 函数体不进入 → 删 require 无副作用
//    - dotenv: 纯顶层 require().config() 副作用读 .env, webpack 环境读不到, 无副作用
//
//    业务侧走的是 /song/url (老的 song_url.js, 不走 v1), 完全不受影响。
// (移除 song_url_v1.js 专项处理: 已包含在通用 removeUnresolvableRequires 里)

// 6. stub 掉 util/crypto.js 里的 node 内置 crypto / zlib
//    原因: NCM 4.40.x 的 util/crypto.js 无脑 require('crypto') / require('zlib')
//    用于 aesEcbEncrypt / xeapiDecrypt 等 Node-only 函数 (AES-GCM / X25519 / RSA)。
//    webpack 5 默认不 polyfill node 内置,编 NCM bundle 会失败。
//
//    这些函数只用于 NCM 的 Web 端点加密 (/xeapi/*),
//    不影响主线接口 (/song/url /login /likelist 等)。
//    直接 stub 成空对象,运行时调用这些函数会抛 TypeError,
//    业务侧不会触发 (我们不走 xeapi)。
const cryptoFile = path.join(apiDirPath, "util", "crypto.js");
if (fs.existsSync(cryptoFile)) {
  let content = fs.readFileSync(cryptoFile, "utf8");
  // 替换 require('crypto') 和 require('zlib') 为空 stub
  content = content.replace(
    /^const\s+crypto\s*=\s*require\(['"]crypto['"]\)\s*$/gm,
    "const crypto = {} // stubbed by pull_ncm.js (node crypto unsupported in webpack bundle)",
  );
  content = content.replace(
    /^const\s+zlib\s*=\s*require\(['"]zlib['"]\)\s*$/gm,
    "const zlib = {} // stubbed by pull_ncm.js (node zlib unsupported in webpack bundle)",
  );
  fs.writeFileSync(cryptoFile, content);
  console.log("[pull_ncm] 已 stub util/crypto.js 中的 node crypto / zlib require");
}

console.log("[pull_ncm] 完成！");
