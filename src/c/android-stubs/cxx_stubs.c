// cxx_stubs.c
//
// Android 上 stub 掉 BoringSSL 静态链接需要的 C++ 运行期符号,避免拉整个 libc.a 进 link。
//
// 背景:
//   - engine.c / http.c 是纯 C,engine target 是 C-only target,toolchain 不自动追加
//     libc++_static.a / libc.a。
//   - 静态链 libssl_static.a (BoringSSL) 时,它内部用了:
//       * std::__ndk1::__sort          (C++ sort)            ← libc++_static.a 提供
//       * operator delete(void*, size_t)  (_ZdlPvm / _ZdlPvj) ← bionic libc.a::new.o 提供
//   - scripts/CMakeLists.txt 在 --start-group 里手动追加 libc++_static.a,解决 std::sort。
//   - operator delete 不能从 libc.a 拿:x86_64 的 libc_init_common.o / sse2-*.o 等是 non-PIC
//     (用了 R_X86_64_PC32 + 绝对符号 __x86_shared_cache_size),group 循环解析会把它们
//     也拉进来,触发 PIC 重定位错误。
//
// 解法:本文件直接定义 operator delete 的 size_t-overload,所有 ABI 都覆盖:
//   - 64-bit ABIs (arm64-v8a / x86_64) size_t 是 unsigned long,符号 _ZdlPvm
//   - 32-bit ABIs (armeabi-v7a / x86)      size_t 是 unsigned int, 符号 _ZdlPvj
// 用 C 直接写两个符号,malloc/free 实现 (跟 bionic libc.a::new.o 等价)。
//
// nm 检查 libssl/libcrypto/libcurl/libnghttp2/libngtcp2/libngtcp2_crypto 整个 .a 里
// 的 C++ UND 集合,只有 libssl 引用 _ZdlPvm / _ZdlPvj,所以这里只 stub 这一个符号的两个 ABI。
//
// ⚠️ 这个文件只在 Android build 链路里被 engine target 编译 (见 scripts/CMakeLists.txt)。
//   不参与 host/Linux/Windows build。

#include <stdlib.h>

#if defined(__LP64__)
// 64-bit Android: size_t == unsigned long
void _ZdlPvm(void* p, unsigned long n) {
    (void)n;
    free(p);
}
#else
// 32-bit Android: size_t == unsigned int
void _ZdlPvj(void* p, unsigned int n) {
    (void)n;
    free(p);
}
#endif
