# @nemos/sdk

[English](README.en.md)

嵌入式 TypeScript 长期记忆引擎。默认数据存储为本机 SQLite，适合直接集成到 AI 助理、Agent、知识工具和其他需要跨会话记忆的应用中。

## 安装

```powershell
npm install
npm run build
```

本地接入：

```powershell
npm install <仓库路径>\sdk\typescript
```

## 初始化

```typescript
import { Nemos } from "@nemos/sdk";

const nemos = new Nemos({
  storage: { type: "sqlite", path: "./nemos.db" },
  llm: { provider: "zhipu", apiKey: process.env.ZHIPU_API_KEY! },
  embedding: { provider: "zhipu", apiKey: process.env.ZHIPU_API_KEY! },
});

const user = nemos.forUser("user-001");
```

`storage` 也可使用 `{ type: "memory" }` 进行临时运行。Embedding 可省略；LLM 还支持 `anthropic`、`openai` 和自定义 Provider。

## 写入与召回

```typescript
await user.ingest("我现在住在福州。", {
  scenario: "chat",
  contentDate: "2026-07-25",
});

const packet = await user.recall("我现在住在哪里？", {
  maxResults: 8,
  maxTokens: 1200,
});

if (packet.reliable) {
  for (const item of packet.items) {
    console.log(item.memory.content);
    console.log(item.reasons);
  }
}
```

`recall()` 返回结构化 `MemoryPacket`。`search()` 提供兼容的数组视图；`getRelevantContext()` 生成提示词上下文；`explainRecall()` 返回召回轨迹。

## 显式结构化事实

```typescript
const fact = await user.write({
  layer: "personal_semantic",
  content: "用户目前住在福州",
  source: {
    authoritative: false,
    origin: "user-statement",
    chain_depth: 1,
  },
  subject: "user:self",
  predicate: "residence.current",
  object: "福州",
  trustTier: 1,
  utteranceMode: "literal",
  validFrom: "2026-07-25",
});

await user.correct(fact.id, {
  content: "更正：我现在住在上海",
  object: "上海",
});
```

事实使用 `claim_key` 收敛。新值不会覆盖历史记录，而是通过有效时间和信念状态成为当前版本。每条记录还会保存 `salience`、`evidence_coverage` 和 `evidence_count`，用于解释长期保留与召回准入。

## 后台写入

```typescript
const handle = await user.ingest(largeText, {
  mode: "background",
  scenario: "doc-research",
});

const status = await user.getIngestStatus(handle.id);
```

原始 archival 会先同步写入；抽取、规范化、关联和提交共享同一套持久化生命周期。

## 场景

内置场景包括：

- `chat`
- `diary`
- `meeting`
- `doc-research`
- `coding`
- `voice-transcript`

场景会影响抽取重点、允许的记忆层、时间处理和敏感性，但不会放宽不可变来源和用户隔离约束。

## 数据操作

```typescript
await user.invalidate(memoryId, "用户确认该事实已失效");
await user.resolveDispute(claimKey, winnerMemoryId);
await user.forget(memoryId);

const json = await user.export("json-ld");
const markdown = await user.export("markdown");
```

## 关闭

```typescript
await nemos.close();
```

关闭会等待正在执行的后台任务完成，再释放 SQLite 连接。

## 许可证

PolyForm Noncommercial 1.0.0。