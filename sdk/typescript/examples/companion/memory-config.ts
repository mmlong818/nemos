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

/**
 * 整合状态所在的行键：租约、游标和 last_error 都按 (tenant, user, space) 存。
 *
 * 必须与 makeMem() 传给 Nemos 的一致。当前 makeMem() 两项都不传，因此这里写的是
 * SDK 的默认值。SDK 把它们放在私有 config 里、没有 getter，所以只能由应用侧
 * 显式声明——一旦哪天 makeMem() 开始传 tenantId 或 defaultScope 而这里没跟着改，
 * 读取整合状态会命中一个不存在的行：返回空状态、永远报「没有失败」。
 * 这种失败看不见，所以宁可把它摆在这个文件里被守卫测试盯住。
 */
export const COMPANION_MEMORY_SCOPE = { tenantId: "default", spaceId: "global" } as const;

/**
 * 内核的锚点上限（`DEFAULT_ANCHOR_CAP`）。
 *
 * 内核没有导出它，而 ReflectResult 的 anchorCount 是**裁剪前**的全量条数——
 * 想知道"本轮依据被裁过"只能拿它和这个数比。抄一个常量不理想，但比不告诉用户
 * "结论只依据了子集"要好。内核哪天导出了就改成读导出值。
 */
export const MEMORY_ANCHOR_CAP = 50;
