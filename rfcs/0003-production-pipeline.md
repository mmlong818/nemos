---
rfc_number: 0003
title: Production Pipeline — Background Queue + Multi-Perspective + Cross-Memory Linking
authors:
  - nemos founding team
status: accepted
created_at: 2026-06-05
updated_at: 2026-06-05
discussion_url: ROADMAP.md
implementation_pr: TBD (v0.3 dispatch)
supersedes: []
---

# Summary

把 nemos SDK 从「sync 单线」升级到「生产级 pipeline」：三件事一起做——
- **B2 后台分析队列**：ingest 立刻返回 archival，derived 抽取走后台
- **B4 多视角抽取**：取代单一 prompt 双 pass，改为多个专注角度（事实/情绪/方法论/决策）并行抽 + 合并
- **B5 跨 memory 自动连接**：写入时识别 entity，自动填 `related` 字段，检索时支持 spreading activation

# Motivation

v0.2 后 SDK 已可用，但生产场景暴露三个真实问题：

1. **ingest 慢**：长内容 + 双 pass + scenario 合并 = 5-30s 才返回；朋友的 AI 产品 hot-path 不能等
2. **同一 prompt 双 pass 是冗余而不是深度**：跑两次同样的 prompt 抗噪有限，不会找到第一次漏掉的维度
3. **memory 之间没有显式关系**：第 100 条提到的「项目 X」和第 7 条的「项目 X」是同一个，但 SDK 不知道，检索时各自独立

# Detailed Design

## B2. 后台分析队列

### API 变更

```typescript
// 默认行为不变（向后兼容）
const result = await userMem.ingest(content);
// result.derived 是已完成的，含 confidence 等

// 新模式：后台跑
const handle = await userMem.ingest(content, { background: true });
// 立刻返回：handle.id, handle.status='queued', archival 已写入
// handle.derived = undefined（还没产）

// 查状态
const status = await userMem.getIngestStatus(handle.id);
// status: 'queued' | 'analyzing' | 'completed' | 'failed'
// status='completed' 时 status.derivedCount 可查
```

### 实现

- **队列存储**：SQLite 表 `ingest_queue`（id / content / scope / scenario / created_at / status / attempts / last_error）
- **Worker**：SDK 启动时启 `NemosWorker`（per Nemos 实例），单线程串行处理（v0.3 不做并行）
- **触发**：`ingest({ background: true })` 写队列 → worker tick 轮询（poll interval 1s default）
- **完成**：worker 跑完 analyzer + write derived，更新 queue 状态
- **失败**：3 次重试 backoff（1s/4s/16s），最后失败标 status='failed' + last_error
- **可见性**：`mem.listPendingIngests(userId)` / `userMem.getIngestStatus(id)`
- **持久化**：进程重启后 queue 留存，worker 自动 resume
- **手动控制**：朋友可选 `manualWorker: true` 自己调 `mem.runWorkerTick()`（适合 serverless）

### Archival immutability 不变

archival 仍 sync 写入。background 仅延后 derived。这守住「即便 derived 失败用户也不丢原文」原则。

## B4. 多视角抽取

### 设计

取代 v0.2 的"同 prompt 双 pass + check pass"，改为：

```
            [完整内容]
                ↓
   ┌────────┬────────┬────────┐
   ↓        ↓        ↓        ↓
[Fact   ][Emo    ][Method ][Decision]
 perspective]   perspective] perspective] perspective]
   ↓        ↓        ↓        ↓
   └────────┴────────┴────────┘
                ↓
         [Merge pass]
                ↓
   { derived[]: 含 perspectives[] 字段 }
```

### Perspective 定义

每个 perspective 是个特化的 sub-prompt，只关注一类信号：

| Perspective | 关注什么 | 产生的 derived 层倾向 |
|---|---|---|
| **`fact`** | 客观事实、数据、对比、引用 | semantic / reference 类 |
| **`emotion`** | 情绪、关系、态度、感受 | episodic（高 arousal）/ personal_semantic |
| **`method`** | 方法论、流程、模式、how-to | procedural |
| **`decision`** | 决定、承诺、行动项、转折 | episodic（高 surprise）/ personal_semantic |
| **`temporal`** | 时间线、事件序列 | episodic（带 event_at） |

朋友配置：

```typescript
new Nemos({
  ...,
  features: {
    perspectives: ['fact', 'emotion'],   // 选 2 个；默认 ['fact', 'method', 'decision']
    // 或保持 v0.2 行为：
    doubleCheck: true,                    // 与 perspectives 互斥
  }
});
```

### Merge 算法

- 每条 perspective 抽出的 derived 带 `from_perspective: 'fact'|'emotion'|...`
- Merge pass 把内容相近的合并（同 fact 不同视角都看到 = 高 confidence）
- 同条 derived 多视角看到 → `perspectives: ['fact','decision']` 数组字段
- 仅 1 视角看到 → `perspectives: ['fact']`
- 完全冲突（fact 说 X，emotion 说反向情绪暗示 not-X）→ 标 `perspectives_conflict: true`

### Confidence 升级

v0.2 用 high/medium/conflict 字符串。v0.3 改为：

```typescript
source.confidence: 'high' | 'medium' | 'low' | 'conflict';
// 计算规则：
//   perspectives.length >= 2 → high
//   perspectives.length == 1 (出现在 ≥1 个视角) → medium
//   perspectives.length == 0 (仅 v0.2 doubleCheck single-pass) → low
//   perspectives_conflict → conflict
```

向后兼容：v0.2 数据的 confidence 字段保持原值。

## B5. 跨 memory 自动连接

### 设计

每条新 memory 写入完成后，触发轻量 entity match + 关联：

1. **Entity 抽取**：从 memory.content 抽取 entity（人名 / 项目名 / 概念 / 工具）
   - v0.3 用 LLM 跑一次轻量抽取（约 100 token output），不并入 perspectives 主流程
   - 缓存：相同 content 不重抽
2. **Match**：在所有 memory 里搜含同 entity 的（FTS 或简单 string match）
3. **Auto-link**：top-K 匹配双向写入 `related: [id1, id2, ...]`
4. **Spreading activation 检索**：`search(query, { spreadingActivation: true })` 时，先 vector/FTS 找种子 → 沿 related 拓展 N 跳

### 实施细节

- entity 字段加入 Memory：`entities?: string[]`（≤ 10 个）
- 默认 K=5 双向 link（避免爆炸）
- 跨 user namespace 不连接（隔离硬约束）
- 跨 scope 默认连接，但 search 时 scope filter 仍生效

### 关闭选项

```typescript
new Nemos({
  features: {
    autoLinking: false,   // 默认 true
  }
});
```

## 三者的关系

- B2（background）是基础设施 — 让 B5 entity 抽取可以异步跑，不挡 hot-path
- B4（perspectives）替换 v0.2 的双 pass 逻辑 — 走 background pipeline 自然落地
- B5（linking）是 B2 worker 的最后一步 — 在 derived 写完后再跑 entity match

完整 ingest flow（background 模式）：

```
ingest()
  ↓
1. archival 同步写入（< 50ms）
  ↓
2. 加入 queue，返回 handle
  ↓
[bg worker tick]
  ↓
3. 多视角抽取并行（B4）
  ↓
4. Merge pass（B4）
  ↓
5. derived 写入 storage
  ↓
6. entity 抽取（B5）
  ↓
7. cross-memory match + auto-link（B5）
  ↓
8. queue status='completed'
```

# Drawbacks

- 后台模式让朋友处理"derived 还没好怎么办"——需要文档清楚
- 多视角 = 4-5 次 LLM 调用，比 v0.2 双 pass（3 次）贵
- entity 抽取增加 1 次 LLM 调用
- worker 在 serverless 环境需要 manual tick（已设计 `manualWorker` 选项）
- 跨 memory linking 可能产生意外关联（误标 entity 时）

# Alternatives

## A. 不做 background，纯靠双 pass 优化
- 优：API 简单
- 劣：长内容 hot-path 永远慢
- **拒绝**：朋友生产场景必需

## B. 不做多视角，只优化双 pass prompt
- 优：复杂度低
- 劣：单一 prompt 上限低，不同视角的盲区无法被同一 prompt 覆盖
- **拒绝**：v0.2 已显示双 pass 提升有限，多视角是质变

## C. linking 用 vector 相似度而非 entity
- 优：完全无 LLM
- 劣：相似度 ≠ 关联（"我和老板谈"与"老板的女儿"vector 接近但关联弱）
- **决议**：v0.3 用 entity；v0.4 加 vector + entity 混合

## D. 跨 user linking
- 优：发现群体模式
- 劣：违反 user namespace 硬约束 + 隐私风险
- **拒绝**：永远不跨 user

# Unresolved Questions

1. **Worker 失败 3 次后**：dead-letter queue？让朋友能手动重试？
   - 决议：v0.3 仅标 failed + 日志；v0.4 加 dead-letter queue + manual retry API

2. **Entity 抽取的标准化**：人名 "张三" / "Zhang San" / "@zhangsan" 是否合并？
   - 决议：v0.3 字符串精确匹配；v0.4 加 entity 别名表

3. **跨 scope linking 的产品哲学**：scope:work 的 "项目 X" 应该 link 到 scope:personal 的 "项目 X" 吗？
   - 决议：v0.3 默认 link（不分 scope），朋友可关闭 `crossScopeLink: false`

4. **多视角的 schema 暴露**：朋友是否需要看到 `perspectives` 数组？
   - 决议：暴露，作为可选 debug 字段，朋友可忽略

5. **Background queue 持久化的崩溃恢复**：worker 跑到一半 crash 怎么办？
   - 决议：worker 启动时把 status='analyzing' 的 task 重置为 'queued'，靠 attempts 字段防无限重试

# Prior Art

- Celery/Sidekiq：背景队列设计借鉴
- LangChain `MultiQueryRetriever`：多视角抽取的思路相似
- Memory-Palace `vitality token`：linking 触发的衰减启发
- v0.2 doubleCheck：单 prompt 双 pass 是 v0.3 multi-perspective 的前身

# Implementation Plan

按依赖顺序：

1. **B2 基础设施**（最先做）
   - `src/queue.ts` — SQLite 队列 + Worker class
   - `src/types.ts` 加 `IngestHandle`, `IngestStatus`, `WorkerConfig`
   - `index.ts` `UserMemory.ingest` 加 `background` 分支
   - `index.ts` 加 `getIngestStatus()`, `listPendingIngests()`
   - storage migration v0.2 → v0.3 加 `ingest_queue` 表
   - schema_version: "0.2" → "0.3"

2. **B4 多视角**（在 B2 之上）
   - `src/perspectives.ts` — 5 个 perspective 的 sub-prompt 常量
   - `analyzer.ts` 加 `analyzeMultiPerspective(content, profile, perspectives)` 路径
   - merge pass 用专用 prompt（不是 v0.2 的 CHECK_SYSTEM_PROMPT，因为输入是多 perspective）
   - 兼容：传 `doubleCheck: true` 仍走 v0.2 路径
   - Memory `source.confidence` 升级到 4 档

3. **B5 跨 memory 链接**（在 B4 之后，跑在 worker 末尾）
   - `src/entity.ts` — entity 抽取（LLM）+ string match
   - storage 加 `entities` 字段 + `idx_entities_fts`
   - worker 在 derived 写完后跑 entity match + 双向 link
   - search 加 `spreadingActivation` 选项

4. **测试**：
   - `tests/v03/unit/queue.test.ts` — 队列 CRUD + worker tick
   - `tests/v03/unit/perspectives-merge.test.ts` — 多视角 merge 逻辑
   - `tests/v03/unit/entity-extraction.test.ts` — entity 抽取 mock
   - `tests/v03/integration/background-ingest.test.ts` — 端到端：background 模式 ingest → 等 completed → derived 可读
   - `tests/v03/integration/cross-memory-linking.test.ts` — 写 2 条含同 entity → related 自动填
   - `tests/v03/integration/migration-v02-to-v03.test.ts` — schema migration

5. **examples/**：
   - `examples/background-ingest/` — 长内容 background 模式 demo
   - `examples/multi-perspective/` — 多视角 vs 双 pass 对比
   - `examples/cross-memory-linking/` — entity 自动 link 演示

6. **README**：加 4 节（Background mode / Perspectives / Cross-memory linking / Worker config）

7. **CHANGELOG**：v0.3 entry

# FAQ

**Q**：朋友的 AI 产品在 serverless 环境（每请求 spawn 新 process）能用 background 吗？
A：能。配 `manualWorker: true` 让朋友在每个请求结尾调一次 `mem.runWorkerTick()`，或起 cron 跑 tick。文档会说明。

**Q**：升 v0.3 后旧 v0.2 数据怎么处理？
A：自动 migration 加 `ingest_queue` 表 + Memory 加 `entities` 字段。旧 memory `entities = []` 默认；不会自动补抽（避免重跑 LLM 烧 token）。可选 `mem.backfillEntities()` 手动跑。

**Q**：多视角默认开吗？
A：默认关。`features.perspectives` 不传 = v0.2 行为（doubleCheck=true）。朋友显式开 perspectives 才启用。

**Q**：entity 抽取也走朋友的 LLM key 吗？
A：是。entity 抽取是 LLM 调用，走配置的 provider。每条 memory 多 ~100 token。
