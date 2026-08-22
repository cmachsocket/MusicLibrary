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
    if (result) {
        fprintf(stderr, "[%s] result preview: %.200s\n", name, result);
        free(result);
    }
    fflush(stderr);
    ncm_destroy();
    destroy_engine();
}

// 假设:大 JSON (>300首歌) 触发 quickjs GC bug → SEGV
// 验证三组:track/all (大), tracks (分页 100首), detail (元信息)
TEST(EngineTest, PlaylistRoutes)
{
    // 用同一个 playlist id,对比三种接口
    const char *pid = "{\"id\":\"2678293444\"}";

    // 1. /playlist/track/all — 大 JSON,预期崩
    run_route("TRACK_ALL", "/playlist/track/all", pid);

    // 2. /playlist/tracks — 分页,只取 100 首,预期不崩
    run_route("TRACKS_PAGE", "/playlist/tracks",
              "{\"id\":\"2678293444\",\"limit\":\"100\",\"offset\":\"0\"}");

    // 3. /playlist/detail — 元信息,不取歌单内容,预期不崩
    run_route("DETAIL", "/playlist/detail", pid);
}