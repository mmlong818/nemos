# Example: Doc Search

批量 ingest 几篇文档（带不同 scope），然后用关键词搜索定向到 `project:mnemos`。

## 运行

```bash
ANTHROPIC_API_KEY=sk-... npx tsx examples/doc-search/index.ts
```

## 重点

- `scope` 是 mnemos 的"分区"概念。`project:xxx` 让搜索可以聚焦到某个项目。
- 即使 LLM 没有 embedding 也能搜（自动降级为 FTS5）；若想要语义搜索，请配 `embedding: { provider: 'openai', apiKey }`。
