cmake_minimum_required(VERSION 3.21)
project(MusicLibrary VERSION 1.0.0 LANGUAGES C CXX)

# ========== 子库构建开关 ==========
# 默认全开,保持原有 Windows / Linux 桌面构建行为不变。
# 嵌入式平台(如 Android NDK)只引入需要的部分,在父 CMakeLists 里 set 成 OFF 即可。
option(MUSICLIBRARY_BUILD_ENGINE "Build engine shared library" ON)
option(MUSICLIBRARY_BUILD_KUGOU "Build kugou_music_api shared library" ON)
option(MUSICLIBRARY_BUILD_NCM   "Build ncm_music_api shared library"   ON)

if(WIN32)
    if(MSVC)
        set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} /STACK:8388608")
        set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} /STACK:8388608")
    else()
        set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--stack,8388608")
        set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,--stack,8388608")
    endif()
endif()

# ========== VCPKG 集成 ==========
if(DEFINED ENV{VCPKG_ROOT} OR EXISTS("$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"))
    include($ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake)
elseif(EXISTS("${CMAKE_CURRENT_SOURCE_DIR}/vcpkg/scripts/buildsystems/vcpkg.cmake"))
    include(${CMAKE_CURRENT_SOURCE_DIR}/vcpkg/scripts/buildsystems/vcpkg.cmake)
endif()

# ========== 编译选项 ==========
if(CMAKE_C_STANDARD)
    set(CMAKE_C_STANDARD 11)
    set(CMAKE_C_STANDARD_REQUIRED ON)
endif()

# ========== QuickJS ==========
# set(QJS_BUILD_LIBC ON)
# set(BUILD_SHARED_LIBS ON)
add_subdirectory(quickjs)

# 为静态库添加 -fPIC 选项
set_target_properties(qjs qjs-libc PROPERTIES POSITION_INDEPENDENT_CODE ON)

# 抑制 QuickJS 的类型转换警告
if(MSVC)
    target_compile_options(qjs PRIVATE /wd4242 /wd4244 /wd4267)
    target_compile_options(qjs-libc PRIVATE /wd4242 /wd4244 /wd4267)
    target_compile_options(qjsc PRIVATE /wd4242 /wd4244 /wd4267)
else()
    target_compile_options(qjs PRIVATE -Wno-shorten-64-to-32)
    target_compile_options(qjs-libc PRIVATE -Wno-shorten-64-to-32)
    target_compile_options(qjsc PRIVATE -Wno-shorten-64-to-32)
endif()

# 文件输出目录绑定
set(CMAKE_INCLUDE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>/include) # 头文件输出目录
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>/lib)

# 从 KuGouMusicApi/package.json 中自动读取版本
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/KuGouMusicApi/package.json" KUGOU_PKG_JSON)
string(REGEX MATCH "\"version\"[ \t]*:[ \t]*\"([0-9]+)\.([0-9]+)\.([0-9]+)\"" _ ${KUGOU_PKG_JSON})
set(KUGOU_JS_VERSION_MAJOR ${CMAKE_MATCH_1})
set(KUGOU_JS_VERSION_MINOR ${CMAKE_MATCH_2})
set(KUGOU_JS_VERSION_PATCH ${CMAKE_MATCH_3})
set(KUGOU_JS_VERSION "${KUGOU_JS_VERSION_MAJOR}.${KUGOU_JS_VERSION_MINOR}.${KUGOU_JS_VERSION_PATCH}")

# 从 NeteaseCloudMusicApi/package.json 中自动读取版本
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/NeteaseCloudMusicApi/package.json" NCM_PKG_JSON)
string(REGEX MATCH "\"version\"[ \t]*:[ \t]*\"([0-9]+)\.([0-9]+)\.([0-9]+)\"" _ ${NCM_PKG_JSON})
set(NCM_JS_VERSION_MAJOR ${CMAKE_MATCH_1})
set(NCM_JS_VERSION_MINOR ${CMAKE_MATCH_2})
set(NCM_JS_VERSION_PATCH ${CMAKE_MATCH_3})
set(NCM_JS_VERSION "${NCM_JS_VERSION_MAJOR}.${NCM_JS_VERSION_MINOR}.${NCM_JS_VERSION_PATCH}")

set(ENGINE_LIB_SOURCES
    ${CMAKE_SOURCE_DIR}/src/c/engine.c
    ${CMAKE_SOURCE_DIR}/src/c/http.c
    ${CMAKE_SOURCE_DIR}/src/c/tinycthread.c
)

# ========== INTERFACE 库 - 存放公共配置 ==========
add_library(engine_config INTERFACE)
target_include_directories(engine_config INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/quickjs>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src/include>
    # $<INSTALL_INTERFACE:include>
)
target_link_libraries(engine_config INTERFACE qjs qjs-libc)

# ========== 平台相关依赖 ==========
if(UNIX AND NOT ANDROID)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(CURL REQUIRED libcurl)
#    pkg_check_modules(LIBUV REQUIRED libuv)
    target_include_directories(engine_config INTERFACE ${CURL_INCLUDE_DIRS} ${LIBUV_INCLUDE_DIRS})
    target_link_libraries(engine_config INTERFACE ${CURL_LIBRARIES})
#    target_link_libraries(engine_config INTERFACE ${LIBUV_LIBRARIES})
#    # 确保 libuv 链接目录被添加
#    if(LIBUV_LIBRARY_DIRS)
#        target_link_directories(engine_config INTERFACE ${LIBUV_LIBRARY_DIRS})
#    endif()
elseif(WIN32)
    find_package(CURL CONFIG REQUIRED)
    target_link_libraries(engine_config INTERFACE CURL::libcurl)
endif()

set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>/lib)

# ========== ENGINE SHARED 库 ==========
if(MUSICLIBRARY_BUILD_ENGINE)
    add_library(engine SHARED ${ENGINE_LIB_SOURCES})
    target_link_libraries(engine PUBLIC engine_config)
    set_target_properties(engine PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}
    )
    if(WIN32)
        # 设置 Windows 平台特有的属性
        set_target_properties(engine PROPERTIES
            LINK_FLAGS "/DEF:${CMAKE_SOURCE_DIR}/src/def/engine.def"
        )
        target_compile_definitions(engine PUBLIC KUGOU_MUSIC_API_EXPORTS)
    endif()
endif()


# ========== 公共源文件 ==========
# file(GLOB BUNDLE_C_FILES "${CMAKE_SOURCE_DIR}/bundle/c/*.c")

set(KUGOU_LIB_SOURCES
    ${CMAKE_SOURCE_DIR}/src/c/kugou/main.c
    ${CMAKE_SOURCE_DIR}/src/c/kugou/extension.c
    ${CMAKE_SOURCE_DIR}/bundle/c/kugou_music_api_bundle.c
)

if(MUSICLIBRARY_BUILD_KUGOU)
    # ========== KouGou STATIC 库 ==========
    add_library(kugou_music_api_static STATIC EXCLUDE_FROM_ALL ${KUGOU_LIB_SOURCES})
    target_link_libraries(kugou_music_api_static PUBLIC engine)
    target_include_directories(kugou_music_api_static PUBLIC
        ${CMAKE_SOURCE_DIR}/src/include
    )

    # ========== KouGou SHARED 库 ==========
    add_library(kugou_music_api SHARED ${KUGOU_LIB_SOURCES})
    target_link_libraries(kugou_music_api PUBLIC engine)
    set_target_properties(kugou_music_api PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}
    )
    target_include_directories(kugou_music_api PUBLIC
        ${CMAKE_SOURCE_DIR}/src/include
    )


    if(WIN32)
        # 设置 Windows 平台特有的属性
        set_target_properties(kugou_music_api PROPERTIES
            LINK_FLAGS "/DEF:${CMAKE_SOURCE_DIR}/src/def/kugou_music_api.def"
        )
        target_compile_definitions(kugou_music_api PUBLIC KUGOU_MUSIC_API_EXPORTS)
    endif()
endif()

# ========== python 库 ==========
# find_package(Python3 REQUIRED COMPONENTS Development)
# set(Python3_INCLUDE_DIRS "D:/program/pyenv/pyenv-win/versions/3.11.9/include")
# set(Python3_LIBRARIES "D:/program/pyenv/pyenv-win/versions/3.11.9/libs/python311.lib")
# include_directories(${Python3_INCLUDE_DIRS} src/include)
# add_library(kugou_music_api_python MODULE
#     ${CMAKE_SOURCE_DIR}/bindings/python/kugou_music_api_wrap.c
#     ${KUGOU_LIB_SOURCES}
#     # 其他源文件
# )
# target_link_libraries(kugou_music_api_python PUBLIC engine)
# target_link_libraries(kugou_music_api_python PUBLIC engine ${Python3_LIBRARIES})
# target_compile_definitions(kugou_music_api_python PRIVATE KUGOU_SWIG_EXPORT)

# set_target_properties(kugou_music_api_python PROPERTIES
#     OUTPUT_NAME "_kugou_music_api_python"
#     PREFIX ""  # Windows 下无前缀
#     SUFFIX ".pyd"  # Windows 下生成 .pyd，Linux 下可用 .so
# )


set(NCM_LIB_SOURCES
    ${CMAKE_SOURCE_DIR}/src/c/ncm/main.c
    ${CMAKE_SOURCE_DIR}/src/c/ncm/extension.c
    ${CMAKE_SOURCE_DIR}/bundle/c/ncm_music_api_bundle.c
)

if(MUSICLIBRARY_BUILD_NCM)
    # ========== NCM STATIC 库 ==========
    add_library(ncm_music_api_static STATIC EXCLUDE_FROM_ALL ${NCM_LIB_SOURCES})
    target_link_libraries(ncm_music_api_static PUBLIC engine)
    target_include_directories(ncm_music_api_static PUBLIC
        ${CMAKE_SOURCE_DIR}/src/include
    )

    # ========== NCM SHARED 库 ==========
    add_library(ncm_music_api SHARED ${NCM_LIB_SOURCES})
    target_link_libraries(ncm_music_api PUBLIC engine)
    set_target_properties(ncm_music_api PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}
    )
    target_include_directories(ncm_music_api PUBLIC
        ${CMAKE_SOURCE_DIR}/src/include
    )


    if(WIN32)
        # 设置 Windows 平台特有的属性
        set_target_properties(ncm_music_api PROPERTIES
            LINK_FLAGS "/DEF:${CMAKE_SOURCE_DIR}/src/def/ncm_music_api.def"
        )
        target_compile_definitions(ncm_music_api PUBLIC KUGOU_MUSIC_API_EXPORTS)
    endif()
endif()

# ========== Tests ==========
# 只在显式打开 BUILD_TESTING 时才 build (默认 OFF,避免污染 release build)
option(MUSICLIBRARY_BUILD_TESTS "Build host tests (console)" OFF)
mark_as_advanced(MUSICLIBRARY_BUILD_TESTS)

if(MUSICLIBRARY_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()