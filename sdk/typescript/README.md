# @nemos/sdk

> **嵌入式 TypeScript 记忆系统 SDK** —— 给你的 AI 产品加上一套结构化、可持久化、可移植的记忆基础设施。5 行代码接入。

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## 30 秒理解

**nemos 是什么**：开源的"AI 应用记忆系统"协议 + 实现。把 LLM 应用沉淀下来的零散对话/笔记/观察，分解到 5 个语义层（事件 / 知识 / 关于用户 / 习惯 / 不可变原文），打上来源/情绪/意外度元数据，供后续 AI 调用按需取用。

**nemos 不是什么**：
- 不是另一个向量数据库（vector DB 是它的一个组件，不是它的全部）
- 不是 chat memory window 替代品（它的目标是**跨 session、跨 agent 的长期记忆**）
- 不是端到端的对话系统（你的 AI 应用是它的客户，它是基础设施）

**为什么用它**：
- ✅ **5 行接入**：装个包，配 storage + LLM key，调 `ingest()` 和 `getRelevantContext()` 就能用
- ✅ **嵌入式部署**：SQLite 单文件，零运维，你的产品自己拥有数据
- ✅ **设计原则可信**：12 条 founding principles（[RFC 0001](../../rfcs/0001-nemos-design-principles.md)）守住「AI 是仆人不是代理」「不可变原始层」「默认衰减 + 显式保留」等硬底线
- ✅ **数据可移植**：JSON-LD + Markdown 双轨导出，永远不被锁定
- ✅ **可审计**：每条记忆都带 source / chain_depth / authoritative，能追溯是用户直说还是 AI 推断

---

## 5 分钟 Quickstart

### 1. 安装

```bash
npm install @nemos/sdk better-sqlite3
npm install @anthropic-ai/sdk   # 或 npm install openai
```

### 2. 初始化

```typescript
import { Nemos } from '@nemos/sdk';

const mem = new Nemos({
  storage: { type: 'sqlite', path: './nemos.db' },
  llm: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
});
```

### 3. 使用

```typescript
// 每个用户拿一个 namespace 隔离的 UserMemory
const userMem = mem.forUser('user-abc');

// 沉淀：用户的任何输入
await userMem.ingest('我今晚和老板谈了项目X，他希望Q4交付');

// 取用：AI 回复前搜相关记忆
const ctx = await userMem.getRelevantContext('项目X');
// → 直接拼到 LLM prompt 里
```

完。这就是基础使用——这段代码在 `examples/coding-agent/` 实测过。

---

## Scenarios（v0.2）

v0.2 加了**场景感知**：同一份内容，按 scenario 调整层级偏好、抽取重点、时间感知与隐私行为。

```typescript
// 内置 profile（string 引用）
await userMem.ingest(diaryText,   { scenario: 'diary' });        // 自动 sensitive + hide
await userMem.ingest(meetingNote, { scenario: 'meeting' });      // 抓决定 / 行动项 / event_at
await userMem.ingest(researchPdf, { scenario: 'doc-research' }); // 零 personal_semantic（作者≠用户）

// 自定义 object
await userMem.ingest(symptomLog, {
  scenario: {
    name: 'health-tracker',
    promptAddendum: '症状/用药/睡眠归 episodic 带时间，规律/触发因素归 procedural',
    privacy: { sensitive: true },
    temporal: { extractEventDate: true },
  },
});
```

### 6 个内置 profile

| Name | Emphasis | Exclude | Privacy | 用途 |
|---|---|---|---|---|
| `default` | 无加权 | — | — | 未声明（= v0.1 行为，向后兼容） |
| `chat` | episodic 1.5, personal_semantic 1.3 | — | — | 聊天对话片段 |
| `doc-research` | semantic 1.5, procedural 1.4 | **personal_semantic** | — | 研报 / 技术文档（第三方"我"不是用户） |
| `coding` | procedural 1.5, semantic 1.3 | — | — | 代码 review / 项目笔记 |
| `diary` | episodic 2.0, personal_semantic 1.5 | — | **sensitive + hideFromSearch** | 个人日记 / 情感记录 |
| `meeting` | episodic 1.5, procedural 1.3 | — | — | 会议纪要 / 多人讨论 |
| `voice-transcript` | episodic 1.4 | — | — | 语音转写 |

详见 `examples/scenario-profiles/`。

### ScenarioProfile 完整字段

```typescript
type ScenarioProfile = {
  name?: string;
  emphasis?: { layers?: Partial<Record<DerivedLayer, number>>; signals?: string[] };
  exclude?:  { layers?: DerivedLayer[] };           // hard filter
  promptAddendum?: string;                          // 拼到 SYSTEM_PROMPT 末尾
  temporal?: { extractEventDate?: boolean };
  privacy?:  { sensitive?: boolean; hideFromSearch?: boolean };
  chunking?: { maxChars?: number; overlap?: number };  // 默认 8000 / 200
};
```

⚠️ 自定义 `promptAddendum` 不能松绑硬约束（archival 不可改、derived 必 authoritative=false、personal_semantic 拒 authoritative=true）。SDK 在客户端兜底。

---

## Temporal Awareness（v0.2）

区分两个时间字段：

| 字段 | 含义 | 来源 |
|---|---|---|
| `created_at` | 记忆**落地**到 nemos 的时间 | SDK 强制写入 |
| `event_at` | 内容里**事件实际发生**的时间 | LLM 抽取 / `contentDate` 覆盖 |

```typescript
// 让 LLM 抽：内置 chat/diary/meeting/doc-research 都已启用
await userMem.ingest('上周三和小李聊了产品方向', { scenario: 'chat' });
// → derived.event_at ≈ "2026-05-28" （以 ingest 时刻为 anchor 推断）

// 显式覆盖：内容产生时间已知
await userMem.ingest(legacyNote, { contentDate: '2024-03-15' });
// → archival.event_at = "2024-03-15"
```

`event_at` 接受 ISO 8601 day（`2026-05-30`）、month（`2026-05`）或 full datetime；非 ISO 格式被 SDK 丢弃。SQLite 加了 `idx_event_at_<layer>` 索引，未来可做时间窗口查询。

---

## Long Content（v0.2）

>10k 字内容自动 chunking：

```
content (e.g. 50k 字研报)
   │
   ▼
chunkContent(maxChars=8000, overlap=200)
   │
   ├─→ chunk 1 ─→ analyzeOnce(prof) ─→ derived[]
   ├─→ chunk 2 ─→ analyzeOnce(prof) ─→ derived[]
   └─→ chunk N ─→ analyzeOnce(prof) ─→ derived[]
                       │
                       ▼
                 merge + dedupe (layer + content)
                       │
                       ▼
                  IngestResult
```

**关键决策（RFC 0002 决议 C）**：chunking 触发时自动关 `doubleCheck`。多段已经是「跨视角冗余」，再叠双 pass 性价比低。

**Archival 永远存完整原文**——不切。chunking 只影响 LLM 输入路径。

切分策略：markdown 章节（`## / ###`）→ 段落（`\n\n`）→ 句子（中英文标点）三级 fallback。段间 `overlap` 字符头连续，确保语义不切断。

---

## Sensitive Content（v0.2）

```typescript
// 写入：profile.privacy.sensitive=true → 所有 derived 标 sensitive
await userMem.ingest(diaryText, { scenario: 'diary' });

// 默认 search：sensitive 隐藏
const r1 = await userMem.search('焦虑');           // → [] （即使有匹配）

// 显式调出
const r2 = await userMem.search('焦虑', { includeSensitive: true });

// listByLayer 不受过滤（用户主动列出）
const all = await userMem.listByLayer('episodic'); // → 包含 sensitive

// archival 始终可见（用户主权 —— 原文层）
const arch = await userMem.listByLayer('archival'); // → 包含
```

设计权衡（RFC 0002 决议 2）：archival 是原文层，用户对自己写下的东西有完全主权，永远可见；derived 是 AI 推断层，敏感时默认隐藏避免意外暴露。

---

## Background Ingestion (v0.3)

长内容 + 多视角抽取 5-30s 才返回 → 朋友的 AI 产品 hot-path 等不起。v0.3 把 ingest 拆成两段：

- **archival 同步写入**（< 50ms）— 用户原文 0 损失保证
- **derived / entity / linking 异步**走 worker —— 不阻塞 hot-path

```ts
// 默认仍走同步路径（v0.2 行为）
const result = await userMem.ingest(content);
// result.derived 已就绪

// 后台模式：立即返回 handle
const handle = await userMem.ingest(content, { background: true });
// handle.archival 已落地；handle.status='queued'

// 查状态
const info = await userMem.getIngestStatus(handle.id);
// info.status: 'queued' | 'analyzing' | 'completed' | 'failed'

// 等待完成（可选）
const done = await mem.waitForIngest(handle.id, 30000);

// 列出未完成
const pending = await userMem.listPendingIngests();
```

### Worker 配置

```ts
new Nemos({
  ...,
  worker: {
    enabled: true,            // 默认 true；false 等价 manualWorker
    pollIntervalMs: 1000,     // 轮询间隔；测试可改 50
    manualWorker: false,      // serverless 设 true，自己调 runWorkerTick()
    maxAttempts: 3,           // 重试次数（backoff 1s/4s/16s）
  },
});

// Serverless：每请求 spawn 新进程
await mem.runWorkerTick(); // 阻塞跑一个 queued 任务

// 进程退出前
mem.stopWorker();  // 或直接 mem.close()
```

### 崩溃恢复

进程死掉时若有 `status='analyzing'` 的任务，下次 Nemos 启动时自动重置为 `'queued'`，靠 `attempts` 字段防无限重试。

---

## Multi-Perspective Extraction (v0.3)

v0.2 的"同 prompt 双 pass + check"对单一 prompt 的盲区无能为力。v0.3 改成多个特化视角并行抽 + merge：

```ts
new Nemos({
  ...,
  features: {
    perspectives: ['fact', 'method', 'decision'],
    // 与 doubleCheck=true 互斥；同时启用 throw
  },
});
```

| Perspective | 关注什么 | 倾向层 |
|---|---|---|
| `fact` | 客观事实、数据、对比、引用、概念定义 | semantic / reference 类 |
| `emotion` | 情绪信号、关系互动、态度倾向 | episodic / personal_semantic |
| `method` | 方法论、流程、模式、how-to、配置 | procedural |
| `decision` | 决定、承诺、行动项、转折点 | episodic / personal_semantic |
| `temporal` | 时间线、事件序列（含 event_at 抽取） | episodic |

### 输出字段

```ts
memory.source.perspectives = ['fact', 'decision']; // 哪些视角看到
memory.source.perspectives_conflict = false;        // 视角间冲突？
memory.source.confidence = 'high' | 'medium' | 'low' | 'conflict';
```

### Confidence 推导（客户端规则）

- `perspectives.length >= 2` → `high`
- `perspectives.length == 1` → `medium`
- `perspectives_conflict == true` → `conflict`
- 兜底 → `low`

> 不信 LLM 自填的 confidence；用客户端规则更可预测、可审计。

### 与 doubleCheck / chunking 的关系

- 不传 `perspectives` = v0.2 `doubleCheck` 路径（向后兼容）
- chunking 触发时自动关 `perspectives`（多段已构成跨语境冗余）
- `doubleCheck: true` + `perspectives: [...]` 同传 → throw

---

## Cross-Memory Linking (v0.3)

第 100 条提到的"项目 X"和第 7 条的"项目 X"是同一个，但 SDK v0.1/v0.2 不知道。v0.3 加上：

- **Entity 抽取**：每条 memory 写入后由 worker 抽 ≤ 10 个 entity（人 / 项目 / 概念 / 工具）
- **String match**：用 FTS5 找含相同 entity 的旧 memory
- **双向 link**：top-5 双向写入 `related: [id1, id2, ...]`
- **Spreading activation 检索**：沿 `related` 拓展 N=2 跳

```ts
// 默认开启
new Nemos({
  features: {
    autoLinking: true,        // 默认；false 关掉
    crossScopeLink: true,     // 默认；false 禁跨 scope
  },
});

// search 时启用
const results = await userMem.search('X 项目', {
  topK: 20,
  spreadingActivation: true,
});
```

### 硬约束

- **跨 user namespace 永不连接**（即便手动 set 也不会被 spreading 拓展）
- entity 字段：`memory.entities: string[]`（≤ 10）
- 同 content 在进程内 cache，避免 LLM 重抽

### v0.4 候选改进

- entity 别名表（"张三" / "Zhang San" / "@zhangsan" 合并）
- vector + entity 混合 linking
- dead-letter queue + manual retry

---

## Sensitivity Defaults (v0.4)

v0.2 加了 `sensitive` 字段；v0.4 让默认行为完整生效，并加 LLM 检测引导。

- 所有非 `diary` profile 的 system prompt 自动拼上 `SENSITIVITY_GUIDANCE`：
  「内容触及健康 / 财务 / 亲密关系（配偶/伴侣/家人）/ 情绪危机 / 身份认同 → 标 sensitive=true」
- `SearchOptions.includeSensitive` 默认 `false`（与 v0.3 一致；v0.4 写文档让朋友看见）
- 新增 `SearchOptions.sensitiveOnly` —— 用户主动只看自己的敏感记录

```ts
// 默认 search 隐藏 sensitive
const r1 = await u.search('健康话题');                       // 默认 [] 或不含 sensitive
const r2 = await u.search('健康话题', { includeSensitive: true });
const r3 = await u.search('', { sensitiveOnly: true });       // 仅 sensitive 集合
```

> archival 永远可见（用户主权，RFC 0001 原则 4）。sensitive 仅作用于 derived。

为什么 diary 不重复拼 guidance？diary profile 自带 `privacy.sensitive=true` 强制全标，再叠加 guidance 是冗余 noise。

朋友首次集成 v0.4 时若 `search()` 返回空 + 没传 `includeSensitive`，SDK 会通过 logger 给出一次提示「可能命中默认隐藏行为」。

---

## Output Formats (v0.4)

`getRelevantContext` 加 `format` 字段。三种形态：

| format | 调 LLM | 用途 |
|---|---|---|
| `flat`（默认） | 否 | v0.3 行为：层分组 + `_conf:_` / `_ai-inferred_` 后缀 |
| `tiered` | 否 | H2 中文标签 + `(high confidence)` 行内 |
| `narrative` | 是 | 调 1 次 LLM 把记忆合成自然段（无 bullet / 无标题） |

```ts
// flat：默认，v0.3 兼容
await u.getRelevantContext(q);

// tiered：可读性更高，适合人工审查 / 半结构化 prompt
await u.getRelevantContext(q, { format: 'tiered' });

// narrative：直接喂给下游 agent 的"用户简介"段
await u.getRelevantContext(q, { format: 'narrative' });
```

narrative 路径需要 LLM provider 可用（与 ingest 共用 `config.llm`）。失败时降级 tiered + warn，不抛错。

---

## FSRS Decay (v0.4)

让常用记忆自然强化，罕用记忆自然降级，**archival 永久豁免**。

### 公式（简化版 FSRS）

```
R = exp(-Δt / S)
Δt = (now - last_accessed) days
S  = stability （天，capped 365）
```

| 事件 | 操作 |
|---|---|
| `search()` 命中 | `last_accessed = now`, `access_count++`, `S *= 1.3`（capped） |
| Worker 周期 scan（24h 1 次） | 算 R；R<threshold 且 access_count=0 且 dormancy 满 → 标 cold |
| 标 cold 后 | 默认从 search 隐藏；`includeCold:true` 可见；`clearCold(id)` 撤销 |
| archival 永远 | 不参与 scan / 永远 protected=true |

### 配置

```ts
new Nemos({
  features: {
    decay: {
      enabled: true,           // 默认 false（v0.4 opt-in；v0.5 改 true）
      coldThreshold: 0.1,      // R<此值进入 cold 候选
      coldDormancyDays: 7,     // 多少天不访问才能 cold
      scanIntervalMs: 24*3600*1000,
      stabilityCapDays: 365,
    },
  },
});
```

### 何时 cold

- R<0.1（远超过遗忘曲线）
- access_count == 0（一次都没被取出过）
- 距 `last_accessed` ≥ `coldDormancyDays`
- 不是 archival（archival_protected）

### 如何保护重要记忆

- 高频访问的记忆 search 命中时自动 reinforce，无需手动操作
- 临时不想看的可手动 forget；想保护的可设计上层 UI 让用户 `clearCold(id)`
- v0.5 计划加 `protected` flag（用户显式锁定）

### Migration

v0.3 → v0.4 自动加列 `difficulty / retrievability / last_decay_at / archival_protected / cold / cold_at / consolidated_from_json / consolidated_at`。所有 archival 自动 `archival_protected=1`（一次性 backfill，幂等）。

---

## Reflect Consolidation (v0.4)

模拟人脑睡眠期的记忆整合：周期性把多条 episodic 提炼为 semantic / personal_semantic。

### 触发

| 触发 | 时机 |
|---|---|
| 累积 ≥ `autoTriggerThreshold` 条新 episodic | 下一次 `ingest()` 完成时自动入队 |
| `userMem.runReflect()` 显式调用 | 立即跑 |
| 外部 cron 调 `mem.runWorkerTick()` | 由朋友自己调度 |

### 输出

每条 reflect derived 必带：

- `layer`: `semantic` 或 `personal_semantic`
- `source.origin`: `"reflect-consolidation"`
- `source.authoritative`: `false`（硬约束）
- `consolidated_from`: 引用的源 episodic id 列表（必须是真实 id，编造的会被丢弃）
- `consolidated_at`: ISO 8601

### 配置

```ts
new Nemos({
  features: {
    reflect: {
      enabled: true,                 // 默认 false（v0.4 opt-in）
      autoTriggerThreshold: 20,      // 累积 N 条新 episodic 触发
      includePersonalSemantic: true, // 是否带 personal_semantic 作 anchor
    },
  },
});
```

### 约束

- **archival 永不被读 / 永不被修改**（reflect 只产新 derived，不改已有 archival）
- **跨 user namespace 永不互相 reflect**（tenantId + userId 硬约束）
- **`consolidated_from` 必须引用本次输入集合内的真实 episodic id** — 防 LLM 编造
- **derived authoritative=false 强制** —— 走 `persistDerivedList` 守门

### 成本估算

每次 ~3000 input + ~1500 output token ≈ Claude Sonnet $0.02。
单 user 每周 1 次 ≈ $1/月（按朋友 LLM provider 计费）。

---

## 完整 API

### `new Nemos(config)`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `storage` | `{type:'sqlite',path}` \| `{type:'memory'}` | ✓ | — | SQLite 文件路径；`memory` 仅测试用 |
| `llm` | LLMConfig | ✓ | — | 见下 |
| `embedding` | EmbeddingConfig | | `{provider:'none'}` | 配了走语义搜索；不配走 FTS5 |
| `defaultScope` | string | | `'global'` | scope 默认值 |
| `tenantId` | string | | `'default'` | spec day-1 多租户字段 |
| `features.doubleCheck` | bool | | `true` | 双 pass + 校验抗 LLM 非确定性（与 `perspectives` 互斥） |
| `features.autoIngest` | bool | | `true` | `ingest()` 自动跑 analyzer |
| `features.perspectives` | `Perspective[]` | | `undefined` | v0.3 多视角抽取；非空数组启用 |
| `features.autoLinking` | bool | | `true` | v0.3 worker 自动抽 entity + 双向 link |
| `features.crossScopeLink` | bool | | `true` | v0.3 跨 scope 自动连接（同 user 内） |
| `worker.enabled` | bool | | `true` | v0.3 worker 自动 polling |
| `worker.pollIntervalMs` | number | | `1000` | v0.3 worker 轮询间隔 |
| `worker.manualWorker` | bool | | `false` | v0.3 serverless 模式 |
| `worker.maxAttempts` | number | | `3` | v0.3 worker 重试次数 |
| `logger` | function | | stderr | 自定义日志 sink |

### `mem.forUser(userId): UserMemory`

每个 `userId` 对应一个完全隔离的 namespace。两个 user 之间的数据不会互通。

### `UserMemory.ingest(content, options?)`

**最常用方法。** 把用户原文沉淀进 nemos。

```typescript
const r = await userMem.ingest(
  '我喜欢早上 6 点起床写作',
  {
    scope: 'project:my-app',          // 默认 'global'
    originAgent: 'cursor',            // 谁触发的写入（审计用）
    skipAnalysis: false,              // true 时只存 archival，跳过 LLM
  }
);
// r.archival: 1 条不可变原文记录
// r.derived:  N 条 LLM 抽取的事实/偏好/习惯
// r.verification_stats: 双 pass 的统计（high/medium/conflicts）
```

### `UserMemory.write(input)`

直接写一条 memory（绕过 LLM）。用于上层应用已知分类的场景。

```typescript
await userMem.write({
  layer: 'episodic',
  content: '用户在 14:30 提交了 PR #42',
  source: { authoritative: false, origin: 'cursor', chain_depth: 1 },
});
```

⚠️ **守约束**：`layer: 'personal_semantic'` + `source.authoritative: true` 会被拒绝（spec I4）。

### `UserMemory.search(query, options?)`

```typescript
const results = await userMem.search('写作偏好', {
  layers: ['personal_semantic', 'semantic'],
  scope: 'global',
  topK: 10,
  confidenceMin: 'high',          // 仅高置信度
  authoritativeOnly: false,       // 仅用户直说，不返回 AI 推断
});
```

如果配了 `embedding` → 向量相似度检索。否则降级为 SQLite FTS5 BM25。

### `UserMemory.getRelevantContext(query, options?)`

`search` 的便利封装：直接返回拼好的 markdown 字符串，供你塞进 LLM prompt。

```typescript
const ctx = await userMem.getRelevantContext('新写一个 handler', {
  topK: 5,
  asMarkdown: true,        // 默认 true
  maxTokens: 1000,         // 按 char/4 估算的粗略上限
});
```

### `UserMemory.listByLayer(layer, options?)`

按 layer 列最近 N 条（按 created_at 倒序）。

```typescript
const recent = await userMem.listByLayer('episodic', { limit: 20, offset: 0 });
```

### `UserMemory.export(format)`

```typescript
const jsonld = await userMem.export('json-ld');     // 完整 schema 序列化
const md = await userMem.export('markdown');         // 每条带 frontmatter
```

### `UserMemory.forget(memoryId)`

软删除一条非 archival 记忆。archival 永不删（spec I3）。

### `UserMemory.stats()`

```typescript
const s = await userMem.stats();
// { total, by_layer: {...}, by_scope: {...}, schema_version }
```

---

## 配置详解

### Storage

```typescript
// 生产推荐
storage: { type: 'sqlite', path: './data/nemos.db' }

// 仅测试
storage: { type: 'memory' }
```

### LLM Provider

```typescript
// Anthropic（默认 claude-sonnet-4-6）
llm: { provider: 'anthropic', apiKey: '...', model: 'claude-sonnet-4-6' }

// OpenAI（默认 gpt-4o；自动开启 JSON mode）
llm: { provider: 'openai', apiKey: '...', model: 'gpt-4o' }

// 智谱 GLM（默认 glm-5.1；OpenAI 兼容端点 + JSON mode）
llm: { provider: 'zhipu', apiKey: process.env.ZHIPU_API_KEY!, model: 'glm-5.1' }

// 完全自定义（接 Ollama / 本地模型 / 自家网关）
llm: {
  provider: 'custom',
  name: 'ollama-local',
  chat: async (system, user) => {
    const resp = await fetch('http://localhost:11434/api/chat', { ... });
    return (await resp.json()).message.content;
  },
}
```

### Embedding Provider

```typescript
// OpenAI（默认 text-embedding-3-small，1536 dim）
embedding: { provider: 'openai', apiKey: '...' }

// 智谱 GLM（默认 embedding-3，2048 dim）
embedding: { provider: 'zhipu', apiKey: process.env.ZHIPU_API_KEY! }

// 自定义（任何能返回 Float32Array 的函数）
embedding: {
  provider: 'custom',
  embed: async (text) => { /* 你的本地 ONNX / API */ },
  modelId: 'bge-small-zh-v1.5',
  dim: 512,
}

// 关闭，search 退化为 SQLite FTS5
embedding: { provider: 'none' }
```

---

## 数据流图

### Ingest 路径

```
   user content
       │
       ▼
  ┌─────────┐
  │ Nemos  │
  │.ingest()│
  └────┬────┘
       │
       ▼
  ┌────────────────┐    SYSTEM_PROMPT_A
  │  双 pass 抽取  │ ─────────────────────┐
  │  (default on)  │    SYSTEM_PROMPT_B  │
  └────────┬───────┘                     ▼
           │              ┌──────────────────────┐
           │              │ Pass A: N 条 derived │
           │              │ Pass B: M 条 derived │
           │              └──────────┬───────────┘
           │                         │
           │                         ▼
           │              ┌──────────────────────┐
           │              │ CHECK_SYSTEM_PROMPT  │
           │              │ 合并 + confidence    │
           │              │ high/medium/conflict │
           │              └──────────┬───────────┘
           │                         │
           ▼                         ▼
  ┌───────────────────────────────────────┐
  │ 强约束兜底：                          │
  │  - archival.content = 原文（I3）      │
  │  - derived.authoritative = false      │
  │  - personal_semantic 拒 auth=true(I4) │
  └────────────────┬──────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │ SQLite（5 张表 + FTS5 + emb）    │
  │ archival 写 trigger 拒 update    │
  └─────────────────────────────────┘
```

### Search 路径

```
  query string
       │
       ▼
  ┌─────────────────┐
  │ embedding 配了? │
  └────┬───────┬────┘
   yes │       │ no
       ▼       ▼
  ┌─────────┐ ┌──────────┐
  │向量检索 │ │ FTS5 BM25│
  │cosine   │ │          │
  └────┬────┘ └────┬─────┘
       │           │
       └─────┬─────┘
             ▼
  ┌──────────────────────┐
  │ filters:             │
  │  - layers            │
  │  - scope             │
  │  - confidenceMin     │
  │  - authoritativeOnly │
  └──────────┬───────────┘
             │
             ▼
        Memory[]
```

---

## 集成场景

| 场景 | 例子 |
|---|---|
| 聊天产品（跨对话记住用户偏好） | [`examples/chat-product/`](examples/chat-product/) |
| 文档/笔记搜索 | [`examples/doc-search/`](examples/doc-search/) |
| Coding agent（跨 session 偏好） | [`examples/coding-agent/`](examples/coding-agent/) |

---

## FAQ

### 性能？

- **写入**：默认 `doubleCheck:true` → 3 次 LLM 调用，~3-8s/条（Sonnet）。关掉走单 pass，~1-3s/条。
- **读取**：SQLite + 内存 cosine 在 < 10k 条数据集上 < 50ms。embedding API 调用约 100-300ms。
- **数据规模**：v0.1 适合 < 100k 条/用户（个人长期使用绰绰有余）。

### 数据迁移？

- **Schema 升级**：每条 record 带 `schema_version`，v0.x 范围内向前兼容。跨 minor 走 migration adapter（v0.2+ 内置）。
- **跨 SDK 迁移**：`export('json-ld')` → 任何 v0.x 都能 import（spec §11.3 承诺）。
- **embedding 模型升级**：每条 record 带 `embedding_model_id`，未来 lazy re-embed。

### E2EE？

v0.1 不支持。Spec §10 设计了 E2EE SKU（客户端密钥 / 客户端 embedding / 客户端 HNSW），属于 SKU b。v0.2+ 路线图。

### 备份？

直接 cp 那个 SQLite 文件。它是单进程独占的，所以备份前关 SDK 实例：

```typescript
mem.close();
// 现在可以安全 cp nemos.db backup-2026-06-04.db
```

### 我的产品已经有数据库了，能集成吗？

可以——`Nemos` 用自己的 SQLite 文件，跟你现有数据库独立。也可以走 `storage: { type: 'memory' }` 在测试时跑。未来 v0.2+ 会加 `{ type: 'remote', endpoint }` 把这层抽掉。

### 多个 agent 共享同一个用户的记忆？

会的。让所有 agent 用同一个 `userId` 调 `forUser(userId)`，再用 `originAgent` 字段标谁写的。后续 v0.2+ 加 capability/agent 签名做跨 agent 串供防护（spec §7）。

### 版本兼容承诺？

- **v0.x 范围**：minor 版本向后兼容，跨 minor 走 migration
- **v1.0+**：schema 变更走 RFC + 6 个月 deprecation 窗口
- **Export schema**：永远向后兼容

---

## 与现有方案对比

| 维度 | mem0 | Letta (MemGPT) | Memory-Palace | **nemos** |
|---|---|---|---|---|
| 分层存储 | ❌ 单池 vector | ✅ 三层（core/recall/archival） | ✅ 多层 | ✅ **5 层 + 三维元数据** |
| 不可变原始层 | ❌ | ❌ | 部分 | ✅ **I3 不变量 + DB trigger** |
| 反 AI 自污染 | ❌ | ❌ | ❌ | ✅ **I4：personal_semantic 拒 derived** |
| 默认衰减 | ❌ | ❌ | ✅ | ✅ + 12 类显式保留信号 |
| 跨厂商可移植 | partial | partial | ❌ | ✅ **JSON-LD + Markdown 双轨** |
| 开放协议 | proprietary API | open-source code | ❌ | ✅ **协议 + ref impl 都开源** |
| 部署 | SaaS-first | self-host + cloud | research | ✅ **嵌入式 / 自托管 / SaaS 三档** |
| 设计 RFC | 无 | 无 | 论文 | ✅ **founding RFC + 5 份 spec** |

详细对比见 [`docs/architecture-overview.md`](../../docs/architecture-overview.md)。

---

## 设计原则（深度用户）

完整 12 条 founding principles 见 [`rfcs/0001-nemos-design-principles.md`](../../rfcs/0001-nemos-design-principles.md)。

最关键的 5 条：

1. **AI 是仆人不是代理** —— LLM 推断永远标 `authoritative=false`，永不伪装成用户陈述
2. **分层存储，分通道处理** —— CLS 启示：快慢分层防止灾难性遗忘
3. **默认衰减 + 显式保留** —— 不是"全部记住"（Funes 病理）
4. **Immutable archive + 可变解释层** —— 原文永不变，理解可叠加新版本
5. **三维元数据强制** —— source / arousal / surprise 必填

---

## Known Limitations & Future Work (v0.4+)

v0.3 已实施：B2 后台 ingest 队列 / B4 多视角抽取 / B5 跨 memory 自动连接。
v0.4+ 未做项（生产前提请知悉）：

1. **FSRS 未接** —— 仍用单 float `stability` 字段，没接完整 FSRS 三参数模型。spec §9 的 R1-R12 信号尚未触发 stability 调整。**计划 v0.4**。
2. **Reflect 离线 job 没做** —— Episodic → Semantic 的抽象目前只发生在 ingest 实时路径。没有 nightly job 做高阶抽象 / contradiction detection。**计划 v0.4**。
3. ~~**Sensitivity tagging 默认未自动检测**~~ —— ✅ v0.4 B6 已实施（SENSITIVITY_GUIDANCE 自动拼到非 diary prompt）。
4. ~~**Output formatting tiers 没做**~~ —— ✅ v0.4 B7 已实施（`format: 'flat' | 'tiered' | 'narrative'`）。
5. **Dead-letter queue 未做** —— worker 失败 N 次后仅标 `'failed'` + 日志。**计划 v0.5**：DLQ + manual retry API（RFC 0003 决议 1）。
6. **Entity 别名表未做** —— "张三" / "Zhang San" / "@zhangsan" 不会合并。**计划 v0.5**（RFC 0003 决议 2）。
7. **Vector + entity 混合 linking** —— v0.3 仅 entity 精确匹配。**计划 v0.5**（RFC 0003 Alternative C）。
8. **Worker 并行处理** —— v0.3 单线程串行，throughput 受限。**计划 v0.5**。

### v0.4 新加 limitations / 留给 v0.5+

23. **FSRS D 参数未启用** —— v0.4 简化版只用 S/R 两参数（公式 `R=exp(-Δt/S)`）。完整 FSRS 含 D（difficulty）参数，留 v0.5。
24. **Reflect 月报 / 年报未做** —— v0.4 reflect 输出独立 derived，不串成时间窗口报告。**计划 v0.5+**。
25. **Protected flag 用户主动锁定未做** —— archival 永久 protected，但 derived 中重要记忆（如年度纪念日）可能被 cold 误伤。**计划 v0.5**：`Memory.protected: true` 用户显式锁定。
26. **multi-modal memory（图片 / 音频）未做** —— v0.4 仍仅文本。**计划 v0.5+**。
27. **Cold storage 二级表** —— 当前 cold 仅是标志位，仍占主表空间；大规模下可考虑迁到 cold 专表。**计划 v0.5+**。
28. **Narrative 缓存** —— 每次 `getRelevantContext({format:'narrative'})` 都调 LLM；可加 query→narrative LRU 缓存。**计划 v0.5+**。
9. **Relational store 没做** —— 跨 user 共享记忆走独立 ACL 模型（spec §7.4 + §2.7）。
10. **E2EE 没做** —— spec §12 设计的客户端加密 / 客户端 embedding / 客户端 HNSW 未实现。
11. **Lifetime Period 没做** —— spec §8 的 "回到上周二的我" 时间旅行查询未实现（但 `event_at` 已就位）。
12. **id 不是 content-addressed** —— 仍用 UUID v4（带 type prefix）。spec §3.1 要求 `<prefix>_sha256(canonical_json)`。已锁 prefix 形态，未来无损迁移。
13. **content_hash 去重未实现** —— archival 写入时不查重。
14. **audit.mutations 未记录** —— 只有 created_at / last_accessed / access_count。
15. **embedding model migration 没做** —— 未来更换 embedding 模型时需要全库 re-embed；目前没自动化机制。
16. **多设备同步未做** —— 单设备本地 SQLite。
17. **Agent 签名（Ed25519）未做** —— spec §7.3 跨 agent 串供防护未实施。
18. **Proposal 队列未做** —— spec §2.3.2 提到 personal_semantic 应通过 proposal 队列（用户审批）写入。v0.1+ 仍简化为直接拒绝 authoritative=true。
19. **sqlite-vec ANN 未启用** —— 用 JS 内置 cosine 全扫。<10k 量级够用；>10k 切 sqlite-vec 即可（已预留 hook）。
20. **`scenario: 'auto'` 未做** —— 需朋友显式声明 scenario；自动检测仍是 v0.4+ 候选（RFC 0002 Alternative B）。
21. **跨 chunk 的 entity 关联** —— chunking 时每段独立分析，跨段引用同一实体可能产生重复 derived（v0.2 用 layer+content lowercase dedupe 兜底，但不完美）。
22. **相对时间 anchor** —— `event_at` 抽取依赖 LLM 解析"昨天""上周"，SDK 不强解析（prompt 引导但不强校验）。

---

## v0.3 跟 nemos spec 的对齐度

> 这是 handoff 给 maintainer 的对照表。

### 100% 实施

| Spec 要求 | 状态 |
|---|---|
| `tenant_id` + `user_id` namespace 隔离（spec §1） | ✅ SQLite 表所有 row 带这两列 |
| `archival` 表 INSERT-only（spec §2.5 + I3） | ✅ SQLite trigger 强制 |
| `source.kind` enum + `source.authoritative` 双写（spec §3 #5,#7） | ✅ |
| `source.chain_depth` 单调递增（spec §3 #6） | ✅ 强制 derived ≥ 1 |
| `archival_ref` 字段（spec §3 #8） | ✅ derived 都指回 archival.id |
| `schema_version` 字段（spec §3 #4） | ✅ 每条 record 必带，新写入 `"0.3"`；旧记录保留 `"0.1"` / `"0.2"` |
| `related` 字段 + 跨 memory 双向 link（spec §3 #14） | ✅ v0.3 worker 自动填 |
| 后台 ingest 队列 + 失败重试 + 崩溃恢复（spec §11 ops） | ✅ v0.3 |
| 多视角抽取（5 perspectives + merge）| ✅ v0.3，confidence 客户端推导 |
| `scope_id` 三段式（spec §7.1） | ✅ 'global' / 'project:xxx' / 'task:xxx' |
| `ownership.kind` 枚举（spec §3 #10） | ✅ 默认 'self' |
| `embedding_model_id` 字段（spec §3 #11） | ✅ 在每条带 embedding 的 record 上 |
| Personal Semantic 拒 `authoritative=true`（spec §2.3.2 + I4） | ✅ SDK 写入层强制 |
| Import/Export 双轨（spec §10.1） | ✅ JSON-LD + Markdown |
| 三维元数据强制（spec §4） | ✅ 每条 record 都有 source / arousal / surprise |

### 简化

| Spec 要求 | v0.1 简化 |
|---|---|
| `id = <prefix>_sha256(canonical_json)`（spec §3.1） | UUID v4 + type prefix；prefix 形态已锁，未来可平滑过渡 |
| FSRS 三参数衰减（spec §9） | 单 float `stability` 字段，无衰减逻辑 |
| `audit.mutations[]` 完整（spec §2.0.1） | 只有 created_at/last_accessed/access_count |
| `surprise.value` is bits（spec §4.3） | 用 0-1 归一化值 |
| `content_hash` SHA256 去重（spec §2.5） | 未实现 |
| Lifetime Period（spec §8） | 未实现 |
| Relational Store（spec §2.7 / §7.4） | 未实现 |
| E2EE field-level visibility（spec §12） | 未实现（SQLite 明文） |
| Migration adapter registry（spec §11.4） | 未实现（v0.1 单版本） |
| Capability JWT（spec/20-rest-api.md） | 未实现（嵌入式 SDK 不需要 auth） |

### 故意偏离

| Spec | SDK v0.1 |
|---|---|
| spec/40-sdk-contract.md 是 **远程 client**（→ REST → server） | SDK v0.1 是**嵌入式直连 SQLite**（无 server）。这是本任务硬约束 1。未来 v0.2 可加 `storage: { type: 'remote' }` 切回 spec 设计 |
| `proposePersonalSemantic` 走 proposal 队列 | v0.1 直接拒绝 authoritative=true（更严但少了用户审批 UX） |

---

## 朋友升级 v0.2 时最应等的 3 个功能

1. **FSRS 衰减 + 12 类保留信号** —— 让"记住什么忘掉什么"真正生效。目前所有记忆生命周期一致，长期下来会变噪。
2. **Reflect 离线 job** —— Episodic → Semantic 抽象 + contradiction detection，让记忆系统能"复盘"。需要 LLM 凭证 + 一个定时器。
3. **E2EE SKU**（spec §12） —— 客户端密钥 + 客户端 embedding，敏感场景刚需。

---

## 给 maintainer 的 PR 建议（实施顺序）

按"撬动比 / 解锁后续功能"排序：

1. **加 content-addressed id**（spec §3.1）
   - 替换 `utils/id.ts` 的 `randomUUID` 为 `sha256(canonical_json)`
   - 加一个 migration 跑全库重算 id（带映射表）
   - 解锁：跨厂商 id 校验、去重、import lossless

2. **抽象 storage 层接口为可插拔**
   - 已经做了 `Storage` interface
   - 加一个 `PostgresStorage` 实现 → 解锁多用户 SaaS 部署
   - 加一个 `RemoteStorage` → 切回 spec/40-sdk-contract.md 的远程客户端模型

3. **接 FSRS**
   - 新增 `src/decay.ts` 用 ts-fsrs 库
   - 在 `search()` 命中时更新 `last_accessed` 并跑 FSRS step
   - 加 nightly cron hook（用户自己接 setInterval 或 cron）

4. **proposal 队列**
   - 在 storage 加一张 `proposals` 表
   - `proposePersonalSemantic(input)` + `listProposals()` + `approveProposal(id)`
   - 替换 v0.1 的"硬拒绝 authoritative=true"逻辑

5. **audit.mutations 完整记录**
   - 每次 write/update 追加一条 MutationEntry
   - 解锁：合规审计 + 时间旅行查询基础

---

## License

Apache-2.0 © nemos founding team. 见 [LICENSE](LICENSE)。

nemos 是开源协议 + 实现。你可以商用、改造、内嵌进你的产品。唯一要求：保留 license header + 改动声明。

---

## 项目链接

- 主仓库：[nemos-org/nemos](https://github.com/nemos-org/nemos)
- Spec：[`spec/`](../../spec/)
- RFCs：[`rfcs/`](../../rfcs/)
- 架构总览：[`docs/architecture-overview.md`](../../docs/architecture-overview.md)
- 设计原则（必读）：[`rfcs/0001-nemos-design-principles.md`](../../rfcs/0001-nemos-design-principles.md)
