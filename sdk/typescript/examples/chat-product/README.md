# Example: Chat Product

模拟一个聊天产品的 Nemos 集成。每条用户消息会被 `ingest`，AI 回复前用 `getRelevantContext` 取相关记忆拼进 prompt。

## 运行

```bash
cd sdk/typescript
npm install
ANTHROPIC_API_KEY=sk-... npx tsx examples/chat-product/index.ts
```

也可用 OpenAI（改 index.ts 里的 `llm`）。

## 期望输出

```
[Turn 1] User: 我是一名前端工程师，主要写 React + TypeScript。
[ingest] archival=1, derived=2

[Turn 2] User: 我习惯每天早上 6 点起床先写 1 小时代码再上班。
[mem ctx]
## Relevant memory context
### 关于用户 (personal_semantic)
- 我是一名前端工程师...
[ingest] archival=1, derived=2

[Turn 3] User: 今天我想聊聊性能优化，从哪里开始？
[mem ctx]
## Relevant memory context
### 关于用户 (personal_semantic)
- 我是一名前端工程师...
- 我习惯早上 6 点起床...
[ingest] archival=1, derived=1

[stats] {"archival":3,"episodic":1,"semantic":0,"personal_semantic":4,"procedural":0}
```

第 3 轮 prompt 自动带上了"前端工程师"+"早上 6 点写代码"两条之前沉淀的偏好——这就是 Nemos 在做的事。
