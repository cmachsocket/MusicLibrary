#include <gtest/gtest.h>
extern "C" {
    #include "engine.h"
    #include "ncm_music_api.h"
}

static void run_route(const char *name, const char *route, const char *params)
{
    fprintf(stderr, "\n=== %s: %s ===\n", name, route);
    fflush(stderr);
    init_engine();
    JSContext *ncmCtx = ncm_init(NULL);
    NCMAPI *ncmApi = create_ncm_api();
    ASSERT_NE(ncmApi, nullptr);
    char *result = nullptr;
    if (strcmp(route, "/playlist/tracks") == 0) {
        result = ncmApi->playlist_tracks(ncmCtx, "", params, NULL);
    } else if (strcmp(route, "/playlist/detail") == 0) {
        result = ncmApi->playlist_detail(ncmCtx, "", params, NULL);
    } else if (strcmp(route, "/playlist/track/all") == 0) {
        result = ncmApi->playlist_track_all(ncmCtx, "", params, NULL);
    }
    fprintf(stderr, "[%s] result ptr=%p, len=%zu\n", name,
            (void*)result, result ? strlen(result) : 0);
    ASSERT_NE(result, nullptr) << name << ": result is null";
    const size_t result_len = strlen(result);
    ASSERT_GT(result_len, 0u) << name << ": result is empty string";
    // NCM 错误响应都是 { "status": 502, "body": {"code":502, "msg":"..."} } (Anonymous token register 失败 / 网络限流)
    // 真响应 status 是 200 (网易云 API 成功码)
    ASSERT_EQ(strstr(result, "\"status\":502"), nullptr)
        << name << ": NCM returned status:502 — anonymous token register failed or net throttled";
    fprintf(stderr, "[%s] result preview: %.200s\n", name, result);
    free(result);
    fflush(stderr);
    ncm_destroy();
    destroy_engine();
}

// 假设:大 JSON (>300首歌) 触发 quickjs GC bug → SEGV
// 验证两组:track/all (大), detail (元信息)
// /playlist/tracks 不测 — 那个接口是 op=add/del/update 操作歌单用, 不是查询
TEST(EngineTest, PlaylistRoutes)
{
    // 用同一个 playlist id,对比三种接口
    const char *pid = "{\"id\":\"2678293444\"}";

    // 1. /playlist/track/all — 大 JSON (>300首), 验 quickjs GC
    //    业务侧 PlayerController 用这个接口拉整张歌单的所有歌曲
    run_route("TRACK_ALL", "/playlist/track/all", pid);

    // 2. /playlist/detail — 元信息 (track count / creator / cover 等)
    run_route("DETAIL", "/playlist/detail", pid);
}