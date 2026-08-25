# scripts/CMakeLists.txt
#
# Android NDK 适配 wrapper —— 在 MusicLibrary 主项目之外,提供:
#   - curl headers (prefab/modules/curl/include/)  NDK 兼容版
#   - libcurl.so (prefab/modules/curl/libs/android.<abi>/)  链接占位 + 运行时
#
# 设计目的:MusicLibrary 主 CMakeLists 不直接处理 Android (避免污染其他平台)。
# 本脚本仅在 build-android.sh 里被 invoke。
#
# 重要:不能用 host /usr/include 里的 curl headers,会被 NDK clang 误用,
# 导致 quickjs/cutils.h #include <unistd.h> 走到 host unistd.h。

cmake_minimum_required(VERSION 3.21)
project(MusicLibraryAndroidWrapper LANGUAGES C)

set(MUSICLIBRARY_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." CACHE PATH "")

# 1. prefab curl headers (必须是 NDK 兼容版,不是 host 版)
#    2026-08-25 迁移 vvb2060/curl-android 后,include 在 curl_static 模块下。
if(NOT CURL_INCLUDE_DIR)
    message(FATAL_ERROR "CURL_INCLUDE_DIR 没传,build-android.js 会自动配置")
endif()
if(NOT EXISTS "${CURL_INCLUDE_DIR}/curl/curl.h")
    message(FATAL_ERROR "prefab curl headers 不在 ${CURL_INCLUDE_DIR},跑 scripts/android-prefab/fetch.js")
endif()

# 2. prefab curl 静态库列表 (curl_static + nghttp2/3 + ngtcp2 + boringssl)
#    链接顺序由 build-android.js 按依赖顺序传入:被依赖的库靠后。
if(NOT CURL_STATIC_LIBS)
    message(FATAL_ERROR "CURL_STATIC_LIBS 没传,build-android.js 会自动配置")
endif()

# 2.5 NDK 自带的 libc++_static.a 绝对路径
#     静态链 BoringSSL (libssl/libcrypto 内部用了 std::sort / operator delete 等 STL 符号),
#     engine 是 C-only target,toolchain 不会自动追加 libc++_static.a;
#     由 build-android.js 根据 ABI + ANDROID_NDK_HOME 拼好路径传进来。
if(NOT CXX_STATIC_LIB)
    message(FATAL_ERROR "CXX_STATIC_LIB 没传 (NDK libc++_static.a 路径),build-android.js 会自动配置")
endif()
if(NOT EXISTS "${CXX_STATIC_LIB}")
    message(FATAL_ERROR "找不到 NDK libc++_static.a: ${CXX_STATIC_LIB}")
endif()

# 3. 引入 MusicLibrary 主项目
# 注意:主 CMakeLists 里 kugou_music_api / ncm_music_api / engine 都是无条件 add_library,
# 这里是文档性质 (不起实际开关作用)。保留是为了跟 desktop / host build 的变量名一致。
# 2026-08-25: 改为 "ON" 表达 "包不包是 consumer 的事,build 总是全编" 的语义。
set(MUSICLIBRARY_BUILD_ENGINE ON CACHE BOOL "" FORCE)
set(MUSICLIBRARY_BUILD_KUGOU  ON CACHE BOOL "" FORCE)
set(MUSICLIBRARY_BUILD_NCM    ON CACHE BOOL "" FORCE)

add_subdirectory(${MUSICLIBRARY_ROOT} ${CMAKE_BINARY_DIR}/musiclibrary_build)

# 3.5 给 engine 加 Android-only stub,提供 _ZdlPvm (operator delete(void*, size_t))
#     (见 src/c/android-stubs/cxx_stubs.c)。这样 libssl_static.a UND 的 C++ 符号
#     由 stub 满足,链接器不会去 libc.a 里找 new.o —— 而 libc.a 整体拉进 link 会
#     在 x86_64 触发 libc_init_common.o 等 non-PIC 重定位错误。
target_sources(engine PRIVATE "${MUSICLIBRARY_ROOT}/src/c/android-stubs/cxx_stubs.c")

# 4. 给 engine 的 http.c 单独加 prefab curl include 路径 (不污染其他 .c)
#    http.c 是唯一 #include "curl/curl.h" 的文件。
target_compile_options(engine PRIVATE "-I${CURL_INCLUDE_DIR}")

# 静态链接 curl_static 及其全部依赖。
# engine 是 SHARED,curl/BoringSSL 会被打进 libengine.so,
# APK 不再需要 libcurl.so / libssl.so / libcrypto.so。
#
# ⚠️ libssl_static.a / libcrypto_static.a (BoringSSL) 内部用了 C++ (std::sort),
# 但 engine 是 C-only target —— NDK toolchain 默认不会自动拉 libc++_static.a 进来,
# 导致链接报 undefined symbol `std::__ndk1::__sort`。手动追加 libc++_static.a 满足。
#
# ⚠️ operator delete(void*, size_t)  (_ZdlPvm / _ZdlPvj 32-bit) 由 src/c/android-stubs/cxx_stubs.c 提供。
#    为什么不用 libc.a 里的 new.o:x86_64 的 libc_init_common.o / sse2-*.o 等是 non-PIC
#    (用了 R_X86_64_PC32 + 绝对符号 __x86_shared_cache_size),group 循环解析会把它们
#    也拉进来,触发 PIC 重定位错误。stub 一个 malloc/free 等价版本最简单。
#
# ⚠️ --start-group / --end-group: libssl / libcrypto / nghttp2 / ngtcp2 / libc++ 互相之间
#    有循环引用,group 让链接器在组内循环解析直到收敛,免得排错链接顺序。
target_link_libraries(engine PRIVATE
    -Wl,--start-group
    ${CURL_STATIC_LIBS}
    ${CXX_STATIC_LIB}
    -Wl,--end-group
    z
)

# engine_config 只需保证头文件可用;curl 符号已经静态编进 engine。
target_include_directories(engine_config INTERFACE "${CURL_INCLUDE_DIR}")

# 5. Android 15+ 16KB page size 对齐
if(ANDROID)
    target_link_options(engine          PRIVATE "-Wl,-z,max-page-size=16384")
    target_link_options(ncm_music_api  PRIVATE "-Wl,-z,max-page-size=16384")
endif()