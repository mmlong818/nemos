# Changelog

## 0.4.0 — 2026-06-05

Forgetting & Consolidation：让 nemos 从「全部记住」走向「有质量地记忆」。RFC 0004 实施。

### 新增（B6）Sensitivity defaults

- **`SENSITIVITY_GUIDANCE`** —— 所有非 `diary` profile 的 system prompt 自动拼上该引导段，让 LLM 主动给敏感内容（健康 / 财务 / 亲密关系 / 情绪危机 / 身份认同）标 `sensitive=true`
- **`SearchOptions.sensitiveOnly`** —— 用户主动只看自己的敏感记录（与 `includeSensitive` 独立）
- 朋友首次 search 返回空 + 未传 `includeSensitive` 时，logger 提示「可能命中默认隐藏行为」
- archival 始终可见（RFC 0001 原则 4 用户主权不变）

### 新增（B7）Output tiers

- **`ContextOptions.format`** —— `'flat' | 'tiered' | 'narrative'`
  - `flat`（默认，v0.3 行为）：层分组 + `_conf:_` / `_ai-inferred_` 后缀
  - `tiered`：H2 中文标签 + `(high confidence)` 行内注释
  - `narrative`：调 1 次 LLM 把 memory 列表合成自然段（失败降级 tiered + warn）
- **`memoriesToMarkdownTiered`** / **`memoriesToMarkdownNarrative`** 公开导出

### 新增（B9）FSRS Decay 引擎

- **`Memory.difficulty / retrievability / last_decay_at / archival_protected / cold / cold_at`** schema 字段
- **`Memory.archival_protected: true`** archival 自动 backfill；永远不参与 decay scan
- **`features.decay.{ enabled, coldThreshold, coldDormancyDays, scanIntervalMs, stabilityCapDays }`** 配置；默认 `enabled=false`（向后兼容）
- **`UserMemory.runDecayScan(nowMs?)`** —— 手动跑 decay scan（serverless 友好）
- **`UserMemory.listCold()`** / **`clearCold(id)`** —— cold 管理
- **公式**：`R = exp(-Δt/S)`；search 命中 `S *= 1.3 capped 365`；R<0.1 + access=0 + 7 天未访问 → cold
- **`SearchOptions.includeCold`** —— 默认 false；cold 记录默认从 search 隐藏
- Worker 周期任务自动跑 scan（24h 默认 interval）

### 新增（B10）Reflect Consolidation

- **`Memory.consolidated_from / consolidated_at`** schema 字段
- **`UserMemory.runReflect()`** —— 手动触发；返回 `ReflectResult { episodicConsumed, anchorCount, derived }`
- **`features.reflect.{ enabled, autoTriggerThreshold, includePersonalSemantic }`** 配置；默认 `enabled=false`
- 累积 ≥ N 条 episodic 时下一次 `ingest()` 自动触发 reflect（baseline 推进）
- Reflect 输出走 `persistDerivedList` → `authoritative=false` 强制
- **防 LLM 编造**：`consolidated_from` 必须引用本次输入的真实 episodic id；不在集合内的全部丢弃
- archival 永远不被读 / 不被修改（reflect 只看 derived）

### 强约束（v0.4 实施时未违反）

- archival 永不衰减 / 永不被 reflect 修改（`archival_protected=true`）
- 跨 user namespace 永不互相 reflect / 互相 decay
- derived authoritative=false 强制（reflect 产 derived 也强制）
- schema migration v0.3 → v0.4 幂等（含一次性 archival_protected backfill）
- 完全向后兼容（decay/reflect 默认关 = v0.3 行为）

### 文件结构

- `src/decay.ts` 新建（130 行）—— FSRS 简化算法 + scan
- `src/reflect.ts` 新建（291 行）—— reflect prompt + merge
- `src/spreading.ts` 新建（30 行）—— 从 user-memory 抽出 spreading activation
- `src/utils/export.ts` 新建（50 行）—— 从 user-memory 抽出 json-ld / md export
- `src/storage/decay-ops-sqlite.ts` 新建（130 行）—— v0.4 SQLite 操作
- `src/storage/schema.ts` 加 v0.4 ALTER 列 + 索引
- `src/prompts.ts` 加 `SENSITIVITY_GUIDANCE` 常量
- `src/utils/markdown.ts` 重写为 flat/tiered/narrative 三函数
- 所有源文件保持 ≤ 600 行 budget

### Tests

v0.1-v0.3 70 + v0.4 42 = **112/112 通过**：

- `tests/v04/unit/sensitivity-detection.test.ts`
- `tests/v04/unit/output-tiers.test.ts`
- `tests/v04/unit/fsrs-decay.test.ts`
- `tests/v04/unit/reflect-merge.test.ts`
- `tests/v04/integration/cold-hide-from-search.test.ts`
- `tests/v04/integration/auto-reflect-trigger.test.ts`
- `tests/v04/integration/migration-v03-to-v04.test.ts`

### Examples 新增

- `examples/forgetting/` —— 写 10 条 → 模拟 100 天 → decay scan → 列 cold
- `examples/reflect-job/` —— 20 条 episodic + manual reflect → 输出 personal_semantic

### 兼容性

- 朋友 `import { Nemos, UserMemory, persistDerivedList, ... } from '@nemos/sdk'` 一切照旧
- `features.decay` / `features.reflect` 不传 = v0.3 行为
- v0.3 SQLite db 加载 v0.4 SDK 自动 ALTER + backfill；旧数据 0 丢失

### Verified

- `npm run build` 干净
- `npm test` 112/112 通过
- `npm pack` 出 0.4.0.tgz（与 0.1/0.2/0.3/0.3.1 并存共 5 个 tarball）

### v0.5 候选清单

1. **FSRS 完整 D 参数** —— 加 difficulty 启用公式 `S_next = D-dependent`
2. **Reflect 月报 / 年报** —— 多 chunk consolidation 串成时间窗口报告
3. **`Memory.protected: true` 用户主动锁定** —— derived 中年度纪念日类记忆防误伤
4. **Multi-modal memory** —— 图片 / 音频 archival
5. **Dead-letter queue + manual retry API**
6. **Entity 别名表** —— "张三" / "Zhang San" / "@zhangsan" 合并
7. **Vector + entity 混合 linking**
8. **Worker 并行处理**
9. **Narrative 缓存** —— LRU `query → narrative` 减少 LLM 调用
10. **Cold storage 二级表** —— 大规模下 cold 迁出主表

---

## 0.3.1 — 2026-06-05

**Pure internal refactor — 0 API changes, 0 behavior changes.**

为 v0.4 预留 size budget。所有公开 import / 类签名 / 行为完全不变，70/70 测试继续通过。

### 文件结构变化

| 原 (v0.3) | 新 (v0.3.1) | 说明 |
|---|---|---|
| `src/storage.ts` (1273 行) | `src/storage.ts` shim + `src/storage/` 7 文件 | 拆 schema / memory-ops / queue-ops / entity-ops / sqlite-impl / memory-impl / row-mapper |
| `src/analyzer.ts` (663 行) | `src/analyzer.ts` shim + `src/analyzer/` 7 文件 | 拆 build-memory / json-parse / single-pass / multi-perspective / chunked / options / index |
| `src/index.ts` (760 行) | `src/index.ts` (25 行 shim) + `src/nemos.ts` + `src/user-memory.ts` + `src/persist-derived.ts` | Nemos / UserMemory / helper 各居各位 |

### 当前文件 size 分布（最大 5 个）

- `src/user-memory.ts` 538 行（原 index.ts 内的 UserMemory 类）
- `src/storage/sqlite-impl.ts` 458 行
- `src/types.ts` 447 行（不动）
- `src/queue.ts` 408 行（不动）
- `src/storage/memory-impl.ts` 311 行

其他文件全部 < 220 行。

### 为什么

v0.3 让 storage/index/analyzer 单文件爆到 600+ 行。v0.4 还要加 FSRS decay / reflect job / sensitivity 默认开关 / output tiers 多项功能 —— 不先 refactor 会更糟。

### 兼容性

- 朋友 `import { Nemos, UserMemory, persistDerivedList, ... } from '@nemos/sdk'` 一切照旧
- 内部实现移动到子文件，但 v0.3 的 `from './storage.js'` / `from './analyzer.js'` 通过 shim 仍然 work
- 不需要重新装包；但出了新 `nemos-sdk-0.3.1.tgz` 与 0.1/0.2/0.3 三个 tarball 并存

### Verified

- `npm run build` 干净
- v0.1 16 + v0.2 24 + v0.3 30 = 70/70 测试通过
- `npm pack` 出 0.3.1.tgz

---

## 0.3.0 — 2026-06-05

Production pipeline：后台 ingest 队列 + 多视角抽取 + 跨 memory 自动连接。完全向后兼容 v0.1 / v0.2。

### 新增（B2）后台 ingest 队列

- **`IngestOptions.background: true`** —— archival 同步写入；derived/entity/linking 走 worker 异步
  - 立即返回 `IngestHandle { id, archival, status: 'queued', created_at }`
  - 不传 = v0.2 同步路径（向后兼容）
- **`UserMemory.getIngestStatus(id)`** —— 查 background 任务状态（queued / analyzing / completed / failed）
- **`UserMemory.listPendingIngests()`** —— 列当前 user 的未完成 ingest（跨 user 隔离）
- **`Nemos.runWorkerTick()`** —— 手动跑一次 tick（serverless / cron 友好）
- **`Nemos.stopWorker()`** —— 优雅停止 worker
- **`Nemos.waitForIngest(id, timeoutMs?)`** —— 等待 background 任务进入终态（测试 / 同步等待场景）
- **`WorkerConfig`** —— `enabled` / `pollIntervalMs` / `manualWorker` / `maxAttempts`
- **崩溃恢复**：worker 启动时把 `status='analyzing'` 重置为 `'queued'`
- **失败重试**：backoff 1s / 4s / 16s（attempts 1/2/3）；超出 → `failed`
- **archival immutability 不变**：sync 写入，即便 derived 失败用户也不丢原文

### 新增（B4）多视角抽取

- **`features.perspectives: Perspective[]`** —— 取代 v0.2 双 pass 的"同 prompt 抗噪"为"多视角并行抽 + merge pass"
  - 5 个内置视角：`fact` / `emotion` / `method` / `decision` / `temporal`
  - 默认推荐组合：`['fact', 'method', 'decision']`
  - 与 `features.doubleCheck=true` 互斥（同传 throw）
  - chunking 触发时自动关
- **`MemorySource.perspectives: Perspective[]`** —— 该 derived 出现在哪些视角抽取里
- **`MemorySource.perspectives_conflict: boolean`** —— 视角间矛盾标记
- **专用 merge prompt**（不复用 v0.2 `CHECK_SYSTEM_PROMPT`）
- **confidence 推导**：客户端规则（不信 LLM 自填）
  - `>=2 视角` → `high`
  - `1 视角` → `medium`
  - `conflict` → `conflict`
  - 兜底 → `low`

### 新增（B5）跨 memory 自动连接

- **`Memory.entities: string[]`** —— 抽取出的 entity（人名 / 项目 / 概念 / 工具），≤10 个
- **Worker 流程**：derived 写完后 → entity 抽取 → cross-memory match → 双向 `related` 写入
  - entity 抽取走 LLM 短 prompt（~100 token output）
  - 同 content 在进程内 cache，避免重抽
  - top-K 默认 5 / memory
- **`SearchOptions.spreadingActivation: true`** —— 沿 `related` 拓展 2 跳，每跳每节点取前 5
- **`features.autoLinking: false`** —— 关掉自动 linking（默认 true）
- **`features.crossScopeLink: false`** —— 禁跨 scope 连接（默认 true）
- **跨 user namespace 永不连接**（硬约束）

### Schema 升级

- 5 层表加 `entities_json TEXT` 列
- 加 `idx_entities_<layer>` 条件索引（仅非空）
- 新表 `ingest_queue`：`id / archival_id / scope / content / scenario_json / origin_agent / content_date / perspectives_json / status / attempts / last_error / created_at / updated_at / completed_at / derived_count`
- 索引 `idx_iq_status` + `idx_iq_tu`
- 新虚表 `nemos_entities_fts`（FTS5，按 entity 字符串匹配跨 memory）
- 新 memory `schema_version = "0.3"`；老 memory 保留原值（0.1 / 0.2）
- v0.2 → v0.3 自动 ALTER + CREATE IF NOT EXISTS，**幂等**，旧数据零丢失

### 类型升级

- `Confidence` 升 4 档：`'high' | 'medium' | 'low' | 'conflict'`（软 break：低使用率字段，新增枚举值）
- 新增 `Perspective`、`IngestHandle`、`IngestStatus`、`IngestStatusInfo`、`WorkerConfig`

### Breaking changes

- **软 break**：`Confidence` 加 `'low'` 枚举值。v0.1 / v0.2 写出的 memory 不会带 `'low'`（默认从未被生成），但消费方做 `switch` 时需要补 case 或 fallback。
- **API 重载**：`ingest(content, { background: true })` 返回 `IngestHandle` 而非 `IngestResult`；TypeScript 的 overload 已声明，传统 `ingest(content)` 行为不变。
- 其余完全向后兼容：不传 `background` / 不传 `perspectives` / 不传 `features.autoLinking` = v0.2 行为。

### 测试

- v0.1 16/16 + v0.2 24/24 + **v0.3 30/30** 全部通过
- 新增测试：
  - `tests/v03/unit/queue.test.ts` — 队列 CRUD + status + 崩溃恢复 + 跨 user
  - `tests/v03/unit/perspectives-merge.test.ts` — confidence 推导 + 冲突 + 互斥校验 + 向后兼容
  - `tests/v03/unit/entity-extraction.test.ts` — LLM 解析 + cache + 容错 + dedupe
  - `tests/v03/unit/worker-crash-recovery.test.ts` — analyzing → queued 重置
  - `tests/v03/integration/background-ingest.test.ts` — 端到端 + 跨 user 隔离 + waitForIngest + archival sync
  - `tests/v03/integration/cross-memory-linking.test.ts` — 双向 related + 跨 user 隔离 + autoLinking=false
  - `tests/v03/integration/spreading-activation.test.ts` — 2 跳拓展 + 跨 user 不拓展
  - `tests/v03/integration/migration-v02-to-v03.test.ts` — schema migration 0 损失 + 幂等

### v0.4 候选

按 [ROADMAP.md](../../ROADMAP.md) v0.4：

1. **FSRS 衰减引擎** —— 访问强化 / 不访问衰减 / 阈值降级
2. **Sensitivity tagging** —— 健康 / 财务 / 情感自动标 sensitive（v0.3 仍靠 scenario.privacy 触发）
3. **Output formatting tiers** —— `getRelevantContext()` 支持 flat / tiered / narrative
4. **Reflect 离线 job** —— Episodic → Semantic 抽象 + contradiction detection
5. Dead-letter queue + manual retry API（v0.3 仅标 failed）
6. Entity 别名表（"张三" / "Zhang San" 合并）
7. Vector + entity 混合 linking
8. Worker 并行处理（v0.3 单线程串行）
9. Content-addressed id（spec §3.1：`<prefix>_sha256(canonical_json)`）
10. sqlite-vec ANN 启用（>10k 量级）

### 守住的硬约束（不变）

- archival.content 客户端强制 = 用户原文（spec I3）
- archival 表 INSERT-only（trigger）
- 所有 derived `authoritative=false`（RFC 0001 §1）
- personal_semantic 拒绝 `authoritative=true`（spec I4）
- archival sync 写入（即便 background 模式）
- 跨 user namespace 永不 link（B5 硬约束）

---

## 0.2.0 — 2026-06-04

场景感知 + 时间感知 + 长内容 chunking + 敏感度标签。完全向后兼容 v0.1。

### 新增

- **ScenarioProfile** —— `IngestOptions.scenario` 接受内置 string 或自定义 object
  - 6 个内置 profile：`chat` / `doc-research` / `coding` / `diary` / `meeting` / `voice-transcript`（外加默认 `default`）
  - 每个 profile 控制 `emphasis.layers`（层级加权引导）、`exclude.layers`（hard filter）、`promptAddendum`（拼到 SYSTEM_PROMPT）、`temporal.extractEventDate`、`privacy.sensitive`/`hideFromSearch`、`chunking.maxChars`/`overlap`
  - `composeSystemPrompt(base, profile)` 在 base SYSTEM_PROMPT 之上拼场景引导
  - `resolveScenario()` 解析 string ↔ object；自定义 object 与 default 浅合并
- **Memory.event_at** —— 事件实际发生时间（ISO 8601 day/month/full datetime），与 `created_at`（ingest 落地时间）区分
- **Memory.sensitive** —— 敏感记录标记，默认 search 隐藏（archival 始终可见，用户主权）
- **Memory.scenario** —— 来源 profile 名（审计追溯）
- **`IngestOptions.contentDate`** —— 显式声明内容产生时间，覆盖 LLM 自动抽取
- **`SearchOptions.includeSensitive`** —— 默认 false；设为 true 才返回 sensitive 记录
- **长内容自动 chunking** —— `src/utils/chunking.ts`，按 markdown 章节 → 段落 → 句子三级 fallback，段间 overlap 保留语义；多段分析 → merge derived → dedupe
  - RFC 0002 决议 C：chunking 触发时自动关 `doubleCheck`（多段已构成跨视角冗余）
- **6 个新测试 group**（v0.2 unit + integration，共 ~18 测试）

### Schema 升级

- 5 层表加 `event_at TEXT` / `sensitive INTEGER DEFAULT 0` / `scenario TEXT` 三列
- 加索引 `idx_event_at_<layer>`（条件索引，仅非空）+ `idx_sensitive_<layer>`
- search 默认 SQL 加 `WHERE sensitive = 0`
- 新 memory `schema_version = "0.2"`；老 memory 不动（保留 `"0.1"`）
- v0.1 → v0.2 自动 ALTER TABLE migration，**幂等**，旧数据零丢失

### Breaking changes

无。完全向后兼容：

- 不传 `scenario` = 用 `default` profile = v0.1 行为
- v0.1 SQLite DB 加载 v0.2 SDK → 自动 migration 通过
- v0.1 测试 16/16 全部继续通过

### 守住的硬约束（不变）

- archival.content 客户端强制 = 用户原文（spec I3）
- archival 表 INSERT-only（trigger）
- 所有 derived `authoritative=false`（RFC 0001 §1）
- personal_semantic 拒绝 `authoritative=true`（spec I4）—— scenario.promptAddendum 不能松绑

### v0.3 候选

按 ROADMAP.md：

1. `scenario: 'auto'` —— LLM 自动检测场景（RFC 0002 Alternative B）
2. FSRS 三参数衰减 + 12 类保留信号（首次让"记住什么忘掉什么"生效）
3. Reflect 离线 job —— Episodic → Semantic 抽象 + contradiction detection
4. Proposal 队列 —— `proposePersonalSemantic` + 用户审批 UX
5. Content-addressed id（spec §3.1：`<prefix>_sha256(canonical_json)`）
6. `audit.mutations[]` 完整记录
7. Reflect-on-search —— 命中冷僻 cluster 时触发 LLM 二次抽象
8. sqlite-vec ANN 启用（>10k 量级）
9. Lifetime Period（spec §8 时间旅行查询）
10. E2EE SKU 第一步（客户端密钥派生 + storage at-rest 加密）

---

## 0.1.0 — 2026-06-04

首次发布。

### 核心能力
- 嵌入式 SQLite 存储（better-sqlite3），零运维
- 5 层记忆模型（archival / episodic / semantic / personal_semantic / procedural）
- 三维元数据（source / arousal / surprise）
- 5 行接入：`new Nemos({...}).forUser(id).ingest(text)`
- 多用户 namespace 隔离（`tenant_id + user_id`）
- 双 pass + 校验合并（抗 LLM 非确定性）
- LLM provider：Anthropic / OpenAI / Custom
- Embedding provider：OpenAI / Custom / 关（降级 FTS5）
- 关键词搜索（SQLite FTS5）+ 语义搜索（cosine over float32 blob）
- Export 双轨：JSON-LD + Markdown

### 守住的硬约束
- archival.content 客户端强制 = 用户原始输入（spec I3）
- archival 表 schema 层 INSERT-only（trigger 拒绝 UPDATE/DELETE）
- 所有 derived 强制 `authoritative=false`（RFC 0001 §1）
- personal_semantic 拒绝 authoritative=true 写入（spec I4）
- 双 pass + 校验默认开启（生产质量）
- 每条 memory 强制三维元数据 + scope + schema_version

### 来源
从 `examples/web-test/` PoC（analyzer.js / storage.js / app.js）产品化而来。
