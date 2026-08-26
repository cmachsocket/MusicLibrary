const path = require("path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");
const js_to_header = require("./js_to_header");
const generate_module_funs = require("./generate_module/ncm");

generate_module_funs();

module.exports = {
  mode: "production",
  entry: path.resolve(__dirname, "../src/js/ncm/index.js"), // 入口文件
  output: {
    path: path.resolve(__dirname, "../bundle/js"),
    filename: "ncm_music_api_bundle.js",
    library: "NeteaseCloudMusicApiApi", // 导出为全局变量
    libraryTarget: "umd", // 支持多种模块规范
    globalObject: "globalThis",
  },
  resolve: {
    alias: {
      // 劫持 axios
      axios: path.resolve(__dirname, "../src/js/axios_bridge.js"),
      "@NeteaseCloudMusicApi": path.resolve(
        __dirname,
        "../NeteaseCloudMusicApi"
      ),
    },
    modules: [
      path.resolve(__dirname, "../src/js/ncm"),
      path.resolve(__dirname, "../NeteaseCloudMusicApi"),
      "node_modules",
    ],
    // NCM 4.40.x 的 util/request.js 顶层 require('fs')/'os'/'path'/'http'/'https'/'tunnel'/
    //   'url'/'stream'/'util'/'buffer'。 webpack 5 target=[]时 不自动 fallback 这些内置模块,
    //   会产生 webpackMissingModule 'Cannot find module "fs"' (在 quickjs runtime 才发)。
    //   'crypto'/'zlib'/'buffer' 走 banner polyfill (js_to_header 里 Buffer + BannerPlugin 里的 crypto.getRandomValues),
    //   但 webpack 这里也要设 fallback:false 让 require 不报错。
    fallback: {
      fs: false,
      os: false,
      path: false,
      http: false,
      https: false,
      tunnel: false,
      url: false,
      stream: false,
      util: false,
      buffer: false,
      crypto: false,
      zlib: false,
      net: false,
      tls: false,
      dns: false,
      http2: false,
      child_process: false,
      assert: false,
      events: false,
      querystring: false,
    },
  },
  optimization: {
    minimize: false, // 先关闭压缩，方便调试。后续可以开启。
    minimizer: [
      new TerserPlugin({
        extractComments: false, // 不将注释提取到单独的文件中
        terserOptions: {
          format: {
            comments: false, // 从输出中删除所有注释
          },
        },
      }),
    ],
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: `
'undefined' != typeof globalThis &&
  (void 0 === globalThis.window && (globalThis.window = globalThis),
  'object' !== typeof globalThis.process && (globalThis.process = {}),
  'object' !== typeof globalThis.process.env && (globalThis.process.env = {}),
  (typeof global === 'undefined' ? (typeof window !== 'undefined' ? window : globalThis).global = globalThis : void 0),
  void 0 === globalThis.process.env.ANONYMOUS_TOKEN && (globalThis.process.env.ANONYMOUS_TOKEN = ''),
  void 0 === globalThis.process.env.cnIp && (globalThis.process.env.cnIp = ''),
  void 0 === globalThis.crypto && (globalThis.crypto = {
    getRandomValues: function (arr) {
      for (var i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }
  }));\n
// Buffer polyfill for quickjs runtime
//   NCM 4.40.x util/crypto.js / util/request.js / util/ncbl.js / util/apicache.js
//   顶层依赖 Node Buffer global。 webpack 5 不 polyfill Buffer,
//   在浏览器 / quickjs 环境跑会 ReferenceError。 这里给 quickjs runtime 补个
//   最小够用的 Buffer 实现: 覆盖 NCM 4.40.x 实际用到的 Buffer.from / Buffer.alloc
//   / Buffer.concat / Buffer.isBuffer / new Buffer(n) / .toString('hex'|'base64'|'utf8')
//   / .subarray / 下标访问 / .length
console.log('[SHIM] console.info shim injected');
var _qjsConsole = globalThis.console || (globalThis.console = {});
'function' !== typeof _qjsConsole.log && (_qjsConsole.log = function () {});
'function' !== typeof _qjsConsole.info && (_qjsConsole.info = _qjsConsole.log);
'function' !== typeof _qjsConsole.warn && (_qjsConsole.warn = _qjsConsole.log);
'function' !== typeof _qjsConsole.error && (_qjsConsole.error = _qjsConsole.log);
'function' !== typeof _qjsConsole.debug && (_qjsConsole.debug = _qjsConsole.log);
console.log('[SHIM] console.info =', typeof console.info);
// quickjs runtime console 只有 console.log / console.warn / console.error,
//   NCM 4.40.x util/logger.js 用 console.info (跟 console.log 等价), 需要 shim。
void 0 === globalThis.Buffer && (function () {
  function _fromHex(s) {
    var len = s.length / 2 | 0;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      out[i] = parseInt(s.substr(i * 2, 2), 16);
    }
    return out;
  }
  function _fromBase64(s) {
    // quickjs 自带 atob 不一定支持, 手动实现
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    s = String(s).replace(/[^A-Za-z0-9+\/=]/g, '');
    var len = s.length;
    var padLen = (s[s.length - 1] === '=' ? (s[s.length - 2] === '=' ? 2 : 1) : 0);
    var outLen = (len * 3 / 4) - padLen | 0;
    var out = new Uint8Array(outLen);
    var p = 0;
    for (var i = 0; i < len; i += 4) {
      var c1 = chars.indexOf(s.charAt(i));
      var c2 = chars.indexOf(s.charAt(i + 1));
      var c3 = chars.indexOf(s.charAt(i + 2));
      var c4 = chars.indexOf(s.charAt(i + 3));
      var b1 = (c1 << 2) | (c2 >> 4);
      var b2 = ((c2 & 15) << 4) | (isNaN(c3) ? 0 : (c3 >> 2));
      var b3 = ((c3 & 3) << 6) | (isNaN(c4) ? 0 : c4);
      out[p++] = b1;
      if (i + 2 < len && p < outLen) out[p++] = b2;
      if (i + 3 < len && p < outLen) out[p++] = b3;
    }
    return out;
  }
  function _toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      s += h.length === 1 ? '0' + h : h;
    }
    return s;
  }
  function _toBase64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    var i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      var b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
      out += chars[b1 >> 2] + chars[((b1 & 3) << 4) | (b2 >> 4)] + chars[((b2 & 15) << 2) | (b3 >> 6)] + chars[b3 & 63];
    }
    if (i < bytes.length) {
      var b1 = bytes[i];
      out += chars[b1 >> 2];
      if (i + 1 < bytes.length) {
        var b2 = bytes[i + 1];
        out += chars[((b1 & 3) << 4) | (b2 >> 4)] + chars[(b2 & 15) << 2] + '=';
      } else {
        out += chars[(b1 & 3) << 4] + '==';
      }
    }
    return out;
  }
  function _fromUtf8(s) {
    var bytes = [], i = 0;
    for (; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | c >> 6, 0x80 | c & 0x3f);
      else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | c >> 12, 0x80 | (c >> 6) & 0x3f, 0x80 | c & 0x3f);
      else { i++; var c2 = s.charCodeAt(i); c = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff)); bytes.push(0xf0 | c >> 18, 0x80 | (c >> 12) & 0x3f, 0x80 | (c >> 6) & 0x3f, 0x80 | c & 0x3f); }
    }
    return new Uint8Array(bytes);
  }
  function _toUtf8(bytes) {
    var s = '', i = 0;
    for (; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 0x80) s += String.fromCharCode(b);
      else if (b < 0xc0) s += String.fromCharCode((b >> 6) | 0xc0, (b & 0x3f) | 0x80);
      else if (b < 0xe0) s += String.fromCharCode(((b >> 12) & 0xf) | 0xe0, ((b >> 6) & 0x3f) | 0x80, (b & 0x3f) | 0x80);
      else if (b < 0xf0) s += String.fromCharCode(((b >> 18) & 0x7) | 0xf0, ((b >> 12) & 0x3f) | 0x80, ((b >> 6) & 0x3f) | 0x80, (b & 0x3f) | 0x80);
      else { var c = ((b & 0x3) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f); s += String.fromCharCode(0xd800 + ((c >> 10) & 0x3ff), 0xdc00 + (c & 0x3ff)); }
    }
    return s;
  }
  function Buffer(arg, encodingOrOffset, length) {
    if (arguments.length === 0) return new Uint8Array(0);
    if (typeof arg === 'number') return new Uint8Array(arg);
    if (typeof arg === 'string') {
      var enc = encodingOrOffset || 'utf8';
      if (enc === 'hex') return _fromHex(arg);
      if (enc === 'base64') return _fromBase64(arg);
      return _fromUtf8(arg);
    }
    if (arg instanceof ArrayBuffer || ArrayBuffer.isView(arg)) {
      return new Uint8Array(arg.buffer || arg, arg.byteOffset || 0, arg.byteLength || arg.length);
    }
    return new Uint8Array(arg);
  }
  Buffer.from = function (arg, encodingOrOffset, length) {
    return new Buffer(arg, encodingOrOffset, length);
  };
  Buffer.alloc = function (n, fill, encoding) {
    var out = new Uint8Array(n);
    if (fill !== undefined) {
      if (typeof fill === 'number') out.fill(fill);
      else if (typeof fill === 'string') {
        var enc = encoding || 'utf8';
        var fb = Buffer.from(fill, enc);
        for (var i = 0; i < n; i++) out[i] = fb[i % fb.length];
      }
    }
    return out;
  };
  Buffer.concat = function (list, totalLength) {
    if (list.length === 0) return Buffer.alloc(0);
    if (totalLength === undefined) {
      totalLength = 0;
      for (var i = 0; i < list.length; i++) totalLength += list[i].length;
    }
    var out = Buffer.alloc(totalLength);
    var offset = 0;
    for (var i = 0; i < list.length; i++) {
      out.set(list[i], offset);
      offset += list[i].length;
    }
    return out;
  };
  Buffer.isBuffer = function (b) { return b && b instanceof Uint8Array; };
  // 给 Uint8Array 加 toString('hex'|'base64'|'utf8') 覆盖 Buffer 用法
  if (!Uint8Array.prototype.__polyfilled) {
    Uint8Array.prototype.toString = function (encoding) {
      if (encoding === 'hex') return _toHex(this);
      if (encoding === 'base64') return _toBase64(this);
      return _toUtf8(this);
    };
    Uint8Array.prototype.subarray = function (start, end) {
      return Uint8Array.prototype.slice.call(this, start, end);
    };
    Uint8Array.prototype.__polyfilled = true;
  }
  globalThis.Buffer = Buffer;
})();
`,
      raw: true,
      entryOnly: true,
    }),
    new webpack.IgnorePlugin({
      resourceRegExp: /^path$|^fs$/  // NeteaseCloudMusicApi\module\register_anonimous.js 中多余导入
    }),
    {
      apply: (compiler) => {
        compiler.hooks.done.tap("BuildCompleteCallback", (stats) => {
          if (stats.hasErrors()) {
            console.error(
              "Build completed with errors. Skipping js_to_header."
            );
          } else {
            js_to_header();
          }
        });
      },
    },
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: "babel-loader", // 使用 babel
          options: {
            presets: [
              [
                "@babel/preset-env",
                {
                  targets: { ie: "11" },
                  useBuiltIns: false,
                  forceAllTransforms: true,
                },
              ],
            ],
            plugins: [],
          },
        },
      },
    ],
  },
  target: ["web", "es6"], // 兼容浏览器和 ES6
  // webpack 5 在 web target 下默认不全 fallback node 内置,
  // NCM 4.40.x 的 request.js 顶层 require('fs')/'os'/'path'/'http'/'https'/'tunnel'/'url'/'crypto'/'zlib'/
  //   'stream'/'util'/'buffer' 都会 tree-shake 成 require 调用, runtime 会 'Cannot find module'
  // webpack 5 的 'node' 配置只接 __dirname/__filename/global (三个), 不能列其他;
  //   process/Buffer 走 BannerPlugin mock 提供 globalThis.process / globalThis.Buffer
  // resolve.fallback 处理 'fs'/'http'/'os'/'path' 等 node 内置 require — webpack 给空 stub {}
  //   (而不是 webpackMissingModule 报错), runtime 调这些内置的属性得到 undefined, NCM 调不到时抛 TypeError,
  //   但 webpack bundle 能编出。
  // 注: Buffer/crypto/zlib 走 banner polyfill / quickjs runtime mbedTLS 提供, 这里 fallback 设 false
  //   让 webpack 把 require 当空模块处理 (banner 注入的 Buffer 全局覆盖空 stub)。
};
