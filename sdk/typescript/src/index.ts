// index.ts — 小丑鱼应用的共享运行时入口
//
// 记忆内核不再由本仓库维护：正本在 nemos-memory，按 tag 作为 @nemos/sdk 依赖引入。
// 此前两边各存一份拷贝，结果漂移了两周（本仓库领先候选晋升、来源身份继承等实现，
// 而发布仓库停在旧快照）。这里把 barrel 作为唯一接缝：
// examples/companion 与 tests 继续 import "../../src/index.js"，无需感知记忆内核
// 究竟来自本地目录还是外部依赖。
//
// Agent 运行时留在本仓库：它是应用侧基础设施（模型循环、工具调度、审批、
// 凭证代理），与记忆内核无依赖关系——记忆内核在不含 agent/ 的情况下独立编译通过。

export * from "@nemos/sdk";

// v0.7：可审计 Agent 运行时（模型循环、工具调度、取消与上下文接力）
export * from "./agent/index.js";
