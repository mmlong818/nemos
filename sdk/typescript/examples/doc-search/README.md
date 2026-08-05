# Example: Doc Search

适用版本：`0.7.5-alpha.17`；复核：2026-08-06。

批量 ingest 几篇文档（带不同 scope），然后用关键词搜索定向到 `project:nemos`。

## 运行

```bash
ANTHROPIC_API_KEY=<your-key> npx tsx examples/doc-search/index.ts
```

## 重点

- `scope` 是 Nemos 的"分区"概念。`project:xxx` 让搜索可以聚焦到某个项目。
- 即使 LLM 没有 embedding 也能搜（自动降级为 FTS5）；若想要语义搜索，请配 `embedding: { provider: 'openai', apiKey }`。
