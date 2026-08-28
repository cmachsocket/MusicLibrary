// test_china_ip_ranges_inline.cpp
//
// 验证 scripts/pull_ncm.js 的 inlineChinaIpRanges patch 在 bundle 里生效:
//
// 历史: NCM 4.40.x 的 util/index.js 在模块顶层执行 IIFE loadChinaIPRanges(),
//   试图通过 fs.readFileSync('../data/china_ip_ranges.txt') 读 CIDR 段表。
//   scripts/pull_ncm.js 把 fs/path stub 成空对象 (webpack 5 不 polyfill node 内置),
//   运行时 fs.readFileSync 是 undefined → 抛 "not a function" → catch 块打
//   "[ERROR] Failed to load china_ip_ranges.txt: not a function", 然后 fallback
//   到 116.x 段生成 IP。功能 OK 但日志噪, 且 116.x 段覆盖率很差。
//
// patch: pull_ncm.js 把 china_ip_ranges.txt 内容 (64KB / 4146 行 CIDR) inline 进
//   util/index.js 顶部, IIFE 改读内联常量, 跳过 fs.readFileSync。
//
// 测试策略: chinaIPRanges 是 webpack bundle 内部的模块 closure 私有 const,
//   不能直接 eval JS 读。 我们从 generateRandomChineseIP() 的产物反推:
//     - patch 前: 100% 是 116.x.x.x (硬编码 fallback 前缀)
//     - patch 后: 真实 CIDR 段内 (1.x, 14.x, 27.x, 39.x, 42.x, ..., 220.x), 116.x 仅占 ~1%

#include <gtest/gtest.h>
#include <regex>
#include <set>
#include <string>
extern "C" {
    #include "engine.h"
    #include "ncm_music_api.h"
}

// 简单 IPv4 校验: X.X.X.X, 每段 0-255
static bool is_valid_ipv4(const std::string &s)
{
    static const std::regex re(R"(^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$)");
    std::smatch m;
    if (!std::regex_match(s, m, re)) return false;
    for (int i = 1; i <= 4; i++) {
        int v = std::stoi(m[i].str());
        if (v < 0 || v > 255) return false;
    }
    return true;
}

// patch 没生效 (fallback 还在) 时, 50 次 generate_random_cnIp 全部是 116.x.x.x,
// 116.x 占 50/50 = 100%。 patch 生效后, 116.x 仅占中国段的 ~1%, 50 次里约 0.5 次。
// 阈值取 25 (50%) 既能 catch 完全 fallback, 又给概率波动留 buffer。
TEST(EngineTest, ChinaIpRangesInlined)
{
    ASSERT_EQ(init_engine(), 0);
    JSContext *ncmCtx = ncm_init(NULL);
    ASSERT_NE(ncmCtx, nullptr);

    std::set<std::string> unique_ips;
    int fallback_count = 0;       // 第一段 = 116 的 IP 数
    int prefix_count[256] = {0};  // 第一段分布直方图

    constexpr int N = 50;
    for (int i = 0; i < N; i++) {
        char *ip_c = generate_random_cnIp(ncmCtx);
        ASSERT_NE(ip_c, nullptr) << "iter " << i << ": generate_random_cnIp returned null";
        std::string ip(ip_c);
        free(ip_c);

        ASSERT_TRUE(is_valid_ipv4(ip))
            << "iter " << i << ": '" << ip << "' is not a valid IPv4 string";

        int first_octet = std::stoi(ip.substr(0, ip.find('.')));
        prefix_count[first_octet]++;
        unique_ips.insert(ip);

        if (first_octet == 116) fallback_count++;
    }

    // 核心断言: patch 没生效时 fallback_count == 50 (硬编码 116.25-94.X.X)
    //           patch 生效时 fallback_count <= 5 (按段加权后 ~1%)
    ASSERT_LT(fallback_count, N / 2)
        << "116.x 占 " << fallback_count << "/" << N
        << " (>=50%), 高度怀疑 inlineChinaIpRanges patch 没生效 (全部走 116.x fallback)";

    // 50 次里应该至少有 5 个独立 IP (patch 前 116.25-94.X.Y 的分布范围有限但 unique
    // 仍可能较多, 这里取宽松下界, 主要看 first-octet 多样性 — prefix_count > 1 的桶)
    ASSERT_GE(unique_ips.size(), 5u)
        << "unique IPs = " << unique_ips.size()
        << ", first-octet 多样性不足, patch 可能没生效";

    // 统计摘要到 stderr (ctest output 可见)
    int distinct_prefixes = 0;
    for (int i = 0; i < 256; i++) if (prefix_count[i] > 0) distinct_prefixes++;
    fprintf(stderr, "\n[ChinaIpRangesInlined] %d calls -> %zu unique IPs, "
                    "%d in 116.x fallback, %d distinct first-octets\n",
                    N, unique_ips.size(), fallback_count, distinct_prefixes);

    ncm_destroy();
    destroy_engine();
}

// Smoke test: 跟上面重叠但更直白 — 至少出现一次非 116.x IP 就说明 patch 生效。
// 跑得快 (100 次 IP 生成 < 1ms), 失败时立刻给 binary 信号 (patch 失效 vs 正常)。
TEST(EngineTest, GenerateRandomChineseIpNotFallback)
{
    ASSERT_EQ(init_engine(), 0);
    JSContext *ncmCtx = ncm_init(NULL);
    ASSERT_NE(ncmCtx, nullptr);

    bool saw_non_116 = false;
    for (int i = 0; i < 100; i++) {
        char *ip_c = generate_random_cnIp(ncmCtx);
        ASSERT_NE(ip_c, nullptr);
        std::string ip(ip_c);
        free(ip_c);
        ASSERT_TRUE(is_valid_ipv4(ip));
        if (ip.compare(0, 4, "116.") != 0) {
            saw_non_116 = true;
            break;
        }
    }
    EXPECT_TRUE(saw_non_116)
        << "100 次随机 IP 全部是 116.x.x.x, patch 完全没生效";

    ncm_destroy();
    destroy_engine();
}