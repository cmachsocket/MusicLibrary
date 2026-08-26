#include <gtest/gtest.h>
extern "C" {
    #include "engine.h"
    #include "ncm_music_api.h"
}


TEST(EngineTest, LifeCycle)
{
    ASSERT_EQ(init_engine(), 0);
    JSContext *ncmCtx = ncm_init(NULL);
    ASSERT_NE(ncmCtx, nullptr);
    NCMAPI *ncmApi = create_ncm_api();
    ASSERT_NE(ncmApi, nullptr); 
    ASSERT_EQ(ncm_destroy(),0);
    ASSERT_EQ(destroy_engine(),0);
}