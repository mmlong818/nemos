// memory-config.ts — 陪伴 App 依赖的「记忆系统能力基线」单一来源。
//
// 记忆系统(Nemos)是本体、陪伴只是其上的一个应用。这里集中声明 App 依赖 SDK 的
// 哪些能力，所有入口（server / index / chat-cli）都引这里，避免某个入口在演进中
// 悄悄关掉核心能力——尤其 MOE 领域路由。守卫测试 (tests/v06) 钉住此处。

import type { NemosConfig } from "../../src/index.js";

/**
 * 陪伴 App 依赖的记忆能力。改这里 = 改 App 对记忆系统的契约，会被守卫测试拦下。
 *
 * - reflect / invalidation：「从不踩雷」——离线整合 + 矛盾自动失效。
 * - domains：MOE 核心能力——记忆按领域分桶，检索只把匹配领域的记忆升顶、无关领域
 *   降权（四级激活，软隔离不剔除）。领域桶由 reflect 离线演化产生；centroid 路由
 *   走向量质心、零额外 LLM 延迟，冷启动（无桶/无向量）优雅回退全局检索。
 */
export const COMPANION_MEMORY_FEATURES: NonNullable<NemosConfig["features"]> = {
  doubleCheck: false,
  reflect: { enabled: true, autoTriggerThreshold: 8 },
  invalidation: { enabled: true },
  domains: { enabled: true, router: { provider: "centroid" } },
};
