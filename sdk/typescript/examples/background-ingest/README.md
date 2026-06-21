# examples/background-ingest

演示 v0.3 后台 ingest 队列：archival 同步写入，derived 异步抽取。

## 跑法

```bash
cd sdk/typescript
npm install
ANTHROPIC_API_KEY=sk-... npx tsx examples/background-ingest/index.ts
```

## 预期输出

```
📥 ingest(background=true)，立刻返回 handle...
  ✓ ~30ms 返回；handle.id=iq_...；archival.id=arch_...；status=queued

🔎 archival 已可读（同步写入）：
  archival 总数: 1
  最新 archival.content 长度: 380 字符

⏳ 等待 worker 完成 derived 抽取...
  ✓ status=completed; derivedCount=6

📊 最终统计：
  total=7（archival + 6 derived）
  ...
```

## 关键点

- **archival sync**：即便 background 模式，原文也立刻入库。Worker 失败/进程崩溃不会让用户丢失原文。
- **handle 模式**：`ingest({ background: true })` 返回 `IngestHandle`，不是 `IngestResult`。朋友通过 `mem.waitForIngest(id)` 或 `userMem.getIngestStatus(id)` 拿后续状态。
- **Serverless 友好**：每请求 spawn 新进程时，传 `worker: { manualWorker: true }`，然后在请求结尾调一次 `mem.runWorkerTick()`。
- **崩溃恢复**：Worker 启动时把 `status='analyzing'` 的任务重置为 `'queued'`，避免任务卡死。
