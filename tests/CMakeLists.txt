# tests/CMakeLists.txt

# -------- 引入 GoogleTest (使用 FetchContent) --------
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.18.0      # 或最新稳定版
)
# 避免 Windows 运行时库冲突
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# -------- 启用 C++ 标准（测试代码需要） --------
# 注意：根项目设置的是 C，但我们可以为测试目标单独指定 C++ 标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -------- 添加测试可执行文件 --------
add_executable(NcmTests test_ncm_life_cycle.cpp test_get_playlist.cpp)

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

# -------- 让 CTest 自动发现所有测试用例 --------
include(GoogleTest)
gtest_discover_tests(NcmTests)