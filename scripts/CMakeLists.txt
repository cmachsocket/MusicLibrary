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
if(NOT CURL_INCLUDE_DIR)
    message(FATAL_ERROR "CURL_INCLUDE_DIR 没传,build-android.sh 会自动配置")
endif()
if(NOT EXISTS "${CURL_INCLUDE_DIR}/curl/curl.h")
    message(FATAL_ERROR "prefab curl headers 不在 ${CURL_INCLUDE_DIR},跑 scripts/android-prefab/fetch.sh")
endif()

# 2. prefab libcurl.so (链接占位,运行时 dlsym 也是同一个 .so)
if(NOT CURL_LIB)
    message(FATAL_ERROR "CURL_LIB 没传,build-android.sh 会自动配置")
endif()

# 3. 引入 MusicLibrary 主项目
# 注意:主 CMakeLists 里 kugou_music_api / ncm_music_api / engine 都是无条件 add_library,
# 这里是文档性质 (不起实际开关作用)。保留是为了跟 desktop / host build 的变量名一致。
# 2026-08-25: 改为 "ON" 表达 "包不包是 consumer 的事,build 总是全编" 的语义。
set(MUSICLIBRARY_BUILD_ENGINE ON CACHE BOOL "" FORCE)
set(MUSICLIBRARY_BUILD_KUGOU  ON CACHE BOOL "" FORCE)
set(MUSICLIBRARY_BUILD_NCM    ON CACHE BOOL "" FORCE)

add_subdirectory(${MUSICLIBRARY_ROOT} ${CMAKE_BINARY_DIR}/musiclibrary_build)

# 4. 给 engine 的 http.c 单独加 prefab curl include 路径 (不污染其他 .c)
#    http.c 是唯一 #include "curl/curl.h" 的文件。
#    直接 PRIVATE compile flag 加 -I 是最准的 (PRIVATE 不会被消费者继承)。
target_compile_options(engine PRIVATE "-I${CURL_INCLUDE_DIR}")

# 链接 prefab libcurl.so (编译期占位,运行时 dlopen)
target_link_libraries(engine PRIVATE "${CURL_LIB}")

# INTERFACE 传递 (给 ncm_music_api 等 dependents 继承,虽然在 Android 上没显式用)
target_link_libraries(engine_config INTERFACE "${CURL_LIB}")
target_include_directories(engine_config INTERFACE "${CURL_INCLUDE_DIR}")

# 5. Android 15+ 16KB page size 对齐
if(ANDROID)
    target_link_options(engine          PRIVATE "-Wl,-z,max-page-size=16384")
    target_link_options(ncm_music_api  PRIVATE "-Wl,-z,max-page-size=16384")
endif()