# tests/CMakeLists.txt

# -------- 引入 GoogleTest (使用 FetchContent) --------
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.18.0      # 或最新稳定版
)
# 避免 Windows 运行时库冲突
set(VCPKG_APPLOCAL_DEPS OFF CACHE BOOL "" FORCE)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# -------- 启用 C++ 标准（测试代码需要） --------
# 注意：根项目设置的是 C，但我们可以为测试目标单独指定 C++ 标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -------- 添加测试可执行文件 --------
add_executable(NcmTests test_ncm_life_cycle.cpp test_get_playlist.cpp)
# -------- Windows x86: 修复 0xc000007b (STATUS_INVALID_IMAGE_FORMAT) --------
# 根因：x86 (Win32) 是交叉编译（Hostx64/x86/cl.exe）。
# vcpkg 的 applocal.ps1 会把 x64 的 MSVC runtime 复制到 32 位 NcmTests.exe 旁，
# 导致 gtest_discover_tests 运行时加载 x64 DLL 崩溃。
# 修复：禁用 vcpkg 自动 applocal，手动复制正确架构的 x86 MSVC CRT。
if(WIN32)
    set_target_properties(NcmTests PROPERTIES VCPKG_APPLOCAL_DEPS OFF)

    if(MSVC AND CMAKE_SIZEOF_VOID_P EQUAL 4)
        # 编译器: .../VC/Tools/MSVC/<ver>/bin/Hostx64/x86/cl.exe
        # CRT:    .../VC/Redist/MSVC/<ver>/x86/Microsoft.VC143.CRT
        get_filename_component(_d1 "${CMAKE_CXX_COMPILER}" DIRECTORY)
        get_filename_component(_d2 "${_d1}" DIRECTORY)
        get_filename_component(_d3 "${_d2}" DIRECTORY)
        get_filename_component(_ver_dir "${_d3}" DIRECTORY)
        get_filename_component(_ver "${_ver_dir}" NAME)
        get_filename_component(_msvc_dir "${_ver_dir}" DIRECTORY)
        get_filename_component(_tools_dir "${_msvc_dir}" DIRECTORY)
        get_filename_component(_vc_dir "${_tools_dir}" DIRECTORY)
        set(_crt_dir "${_vc_dir}/Redist/MSVC/${_ver}/x86/Microsoft.VC143.CRT")
        if(EXISTS "${_crt_dir}")
            add_custom_command(TARGET NcmTests POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_crt_dir}/msvcp140.dll"
                    $<TARGET_FILE_DIR:NcmTests>
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_crt_dir}/vcruntime140.dll"
                    $<TARGET_FILE_DIR:NcmTests>
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${_crt_dir}/vcruntime140_1.dll"
                    $<TARGET_FILE_DIR:NcmTests>
                COMMENT "Copying correct x86 MSVC CRT next to NcmTests.exe"
            )
        endif()
    endif()
endif()

# -------- 链接依赖 --------
# 根据你的需要，选择链接以下一个或多个库
target_link_libraries(NcmTests
  PRIVATE
    # 主项目库（根据实际测试内容选择）
    engine                 # 如果测试 engine 的接口
    kugou_music_api      # 如果测试 KuGou 接口
    ncm_music_api        # 如果测试 NCM 接口
    # 或者静态库版本
    # kugou_music_api_static
    # ncm_music_api_static

    gtest_main             # GoogleTest 提供的 main 函数
)

# 如果测试代码中需要 include 路径（通常已经通过目标传递），
# 但有时可能需要显式添加（比如测试框架本身不需要）
# target_include_directories(NcmTests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src/include)

# -------- Windows: 复制依赖 DLL 到测试可执行文件目录 --------
# NcmTests.exe 输出到 .../Release/bin，而它链接的 engine/kugou/ncm DLL 输出到
# .../Release/lib。Windows 运行时按 DLL 搜索顺序查找 exe 同目录，找不到就报
# 0xc0000135 (STATUS_DLL_NOT_FOUND)。vcpkg applocal.ps1 只复制 vcpkg 依赖，
# 不复制本项目 DLL，所以必须显式复制。
if(WIN32)
    add_custom_command(TARGET NcmTests POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:engine>
            $<TARGET_FILE_DIR:NcmTests>
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:kugou_music_api>
            $<TARGET_FILE_DIR:NcmTests>
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:ncm_music_api>
            $<TARGET_FILE_DIR:NcmTests>
        COMMENT "Copying project DLLs next to NcmTests.exe"
    )
endif()


# -------- 让 CTest 自动发现所有测试用例 --------
include(GoogleTest)
gtest_discover_tests(NcmTests DISCOVERY_MODE PRE_TEST)