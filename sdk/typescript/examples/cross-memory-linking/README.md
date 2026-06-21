# examples/cross-memory-linking

演示 v0.3 跨 memory 自动连接 + spreading activation 检索。

## 跑法

```bash
cd sdk/typescript
npm install
ANTHROPIC_API_KEY=sk-... npx tsx examples/cross-memory-linking/index.ts
```

## 工作流

1. **写入**：`ingest({ background: true })` 把任务入队
2. **Worker 异步跑**：
   - 多视角 derived 抽取
   - entity 抽取（每条 memory 抽 ≤10 个 entity）
   - cross-memory match：找含相同 entity 的旧 memory
   - 双向写 `related: [...]` 字段
3. **检索**：
   - 默认 search：仅 vector / FTS 命中
   - `spreadingActivation: true`：沿 `related` 拓展 2 跳，每跳取 top-5

## 配置开关

```ts
features: {
  autoLinking: false,   // 关掉自动 entity + linking
  crossScopeLink: false, // 禁跨 scope 连接（默认开）
}
```

## 硬约束

- **跨 user namespace 永不连接**：即便手动 set 也不会被 spreading 拓展到
- **archival 也参与 entity 抽取**：archival 本身常含最完整 entity 信息
- **entities ≤ 10 / memory**：避免单条爆炸

## v0.4+ 候选改进

- entity 别名表（"张三" / "Zhang San" / "@zhangsan" 合并）
- vector + entity 混合 linking
- dead-letter queue + manual retry
