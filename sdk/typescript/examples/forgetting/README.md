# examples/forgetting

v0.4 FSRS decay 演示。

## 跑

```bash
npx tsx examples/forgetting/index.ts
```

不需要 API key（用 stub LLM + InMemoryStorage）。

## 演示什么

1. 写 10 条 episodic + 1 条 personal_semantic + 1 条 archival
2. 模拟「未来 100 天」跑 `runDecayScan(futureMs)`
3. 列出哪些条 cold，验证 archival 永远 protected
4. 默认 search 隐藏 cold；`includeCold: true` 可见

## 关键约束

- `archival_protected=true` 是 schema 字段，archival 永远不参与 decay scan
- `search()` 命中会刷新 `last_accessed` 并 `stability *= 1.3`（capped 365 天）
- `clearCold(memoryId)` 用户可以撤销 cold 标记（「这条还有用」）

## 配置

```ts
features: {
  decay: {
    enabled: true,            // 默认 false（v0.4 opt-in）
    coldThreshold: 0.1,       // R<此值进入 cold 候选
    coldDormancyDays: 7,      // 多少天不访问才能 cold
    scanIntervalMs: 24*3600*1000, // worker 周期跑 scan
  },
}
```
