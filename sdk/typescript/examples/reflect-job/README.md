# examples/reflect-job

v0.4 reflect consolidation 演示。

## 跑

```bash
npx tsx examples/reflect-job/index.ts
```

不需要 API key（用 stub LLM 模拟 reflect 输出）。

## 演示什么

1. 写 20 条 episodic
2. 手动 `userMem.runReflect()` 触发整合
3. LLM 输出 1 条 personal_semantic，带 `consolidated_from` 引用源 episodic id

## 关键约束

- `consolidated_from` 必须引用真实的 episodic id（reflect.ts 会过滤掉 LLM 编造的 id）
- 输出走 `persistDerivedList` → `authoritative=false` 是硬约束
- archival 永远不被读 / 不被修改（reflect 只看 derived）
- 跨 user namespace 永不互相 reflect（tenantId + userId 硬约束）

## 配置

```ts
features: {
  reflect: {
    enabled: true,                  // 默认 false（v0.4 opt-in）
    autoTriggerThreshold: 20,       // 累积 N 条新 episodic 自动触发
    includePersonalSemantic: true,  // 是否把现有 personal_semantic 当 anchor
  },
}
```

## 真 LLM 成本估算

每次 reflect ≈ 3000 input + 1500 output token ≈ Claude Sonnet $0.02。
单 user 每周 1 次 ≈ $1/月（按朋友 LLM provider 计费）。
