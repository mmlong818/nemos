# examples/multi-perspective

对比 v0.2 `doubleCheck` 与 v0.3 `multi-perspective` 在同一份内容上的产出差异。

## 跑法

```bash
cd sdk/typescript
npm install
ANTHROPIC_API_KEY=sk-... npx tsx examples/multi-perspective/index.ts
```

## 5 个内置视角

| Perspective | 关注什么 | 倾向层 |
|---|---|---|
| `fact` | 客观事实、数据、对比、引用 | semantic / reference |
| `emotion` | 情绪、关系、态度 | episodic（高 arousal）/ personal_semantic |
| `method` | 方法论、流程、模式、how-to | procedural |
| `decision` | 决定、承诺、行动项、转折 | episodic（高 surprise）/ personal_semantic |
| `temporal` | 时间线、事件序列 | episodic（带 event_at） |

## 配置

```ts
new Mnemos({
  features: {
    perspectives: ['fact', 'method', 'decision'], // 默认推荐组合
  }
});
```

- 不传 = 走 v0.2 `doubleCheck` 路径（向后兼容）
- 与 `doubleCheck: true` 互斥，同时启用会抛错
- chunking 触发时自动关（多段已构成跨语境冗余）

## confidence 推导（客户端规则，不依赖 LLM 自填）

- `perspectives.length >= 2` → `high`
- `perspectives.length == 1` → `medium`
- `perspectives_conflict == true` → `conflict`
- 兜底 → `low`
