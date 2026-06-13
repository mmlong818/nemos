---
rfc_number: 0004
title: Forgetting & Consolidation — FSRS Decay + Reflect Job + Sensitivity Defaults + Output Tiers
authors:
  - mnemos founding team
status: accepted
created_at: 2026-06-05
updated_at: 2026-06-05
discussion_url: ROADMAP.md
implementation_pr: TBD (v0.4 dispatch)
supersedes: []
---

# Summary

让 mnemos 从「全部记住」走向「有质量地记忆」：
- **B6 Sensitivity defaults**：sensitive 内容默认从 search 隐藏（v0.2 已加字段，v0.4 默认生效）
- **B7 Output tiers**：`getRelevantContext` 支持 `flat | tiered | narrative` 三种 markdown 形态
- **B9 FSRS decay**：每条 memory 维护 D/S/R 三参数，访问强化、不访问衰减、低于阈值降级
- **B10 Reflect job**：周期性 LLM 整合，N 条 episodic → semantic 升层；mimics sleep consolidation

# Motivation

v0.3 后系统 ingest/search/linking 都能跑，但**没有任何"遗忘"机制**：

1. 所有 memory 同等优先级，老 / 新 / 偶用 / 常用都一样权重 → search 噪音随时间累积
2. 用户 5 年前一次提到的 fact 和昨天的 fact 同等 surface
3. 多条相关 episodic 累积后不会自然升 semantic（小规模可接受，10k+ memory 后 noise 超信号）
4. Sensitivity 字段在 v0.2 加了但默认不生效（朋友自己要 filter）

[RFC 0001 原则 3] 默认衰减 + 显式保留信号 / [原则 4] immutable archive + 可变解释层 都需要 v0.4 才完整落地。

# Detailed Design

## B6. Sensitivity defaults

### 变更

- `SearchOptions.includeSensitive` 默认 `false`（v0.3 已是；只是把行为说清）
- 新增 `SearchOptions.sensitiveOnly?: boolean`（用户主动只看敏感）
- LLM analyzer prompt 添加 sensitivity 检测引导：内容含健康 / 财务 / 亲密关系 / 情绪危机时自动标 `sensitive=true`（除 `diary` profile 外，所有 profile 都生效）
- archival 始终可见（隐私由 derived 层守，archival 是用户主权）

### 不变更

- `Memory.sensitive` 字段不动（v0.2 已加）
- archival 永远不 hide
- 朋友显式 `includeSensitive: true` 仍能查

## B7. Output tiers

`getRelevantContext` 添加 `format` 选项：

```typescript
type ContextFormat = 'flat' | 'tiered' | 'narrative';

await userMem.getRelevantContext(query, { format: 'tiered' });
```

### `flat`（默认，v0.3 行为）

```markdown
- (high) 用户偏好 6 点写作
- (medium) 上次提到项目X截止Q4
- (low) 偶尔在咖啡馆工作
```

### `tiered`

按 layer 分组：

```markdown
## 关于用户（Personal Semantic）
- 偏好 6 点写作（high confidence）

## 项目相关（Semantic）
- 项目X截止Q4（medium）

## 最近事件（Episodic）
- 上周二被打断 30 分钟
```

### `narrative`

LLM 把检索结果合成成自然段落：

```markdown
该用户偏好 6 点写作（一个相对稳定的习惯）。最近的关键事件是项目X的Q4 截止时间确认。在偶发情境下，他会去咖啡馆工作，但这不是常态。
```

`narrative` 走 1 次额外 LLM 调用（用户配的 provider），所以默认关。

## B9. FSRS decay engine

### 字段（v0.2 已有 stability，扩展）

```typescript
type Memory = {
  // ...
  stability: number;       // 0-1，v0.3 已有
  difficulty?: number;     // 0-1，FSRS D 参数，v0.4 新增
  retrievability?: number; // 0-1，FSRS R 参数，v0.4 计算时填
  last_decay_at?: string;  // ISO 8601，上次衰减计算时间
};
```

### FSRS 简化版

完整 FSRS 算法太复杂；mnemos 用简化版：

- **stability (S)**：访问被记住的强度
- **difficulty (D)**：访问失败次数 / 总访问 = 难记度（v0.4 不实施，留 v0.5）
- **retrievability (R)**：基于 (now - last_accessed) / S 计算，遗忘曲线

公式：

```
R = exp(-Δt / S)
其中 Δt = (now - last_accessed) in days，S 是天数
```

### 触发点

| 事件 | 操作 |
|---|---|
| `storage.findById()` / `search()` 命中 | `last_accessed = now`, `access_count++`, `S = S * 1.3`（强化，上限 365 天） |
| `MnemosWorker` 周期任务（每天 1 次） | 所有 memory 算 R；若 R < threshold（default 0.1）且 access_count == 0 → 标 `cold` |
| 标 `cold` 后 7 天仍未访问 | 默认从 search 索引隐藏（archival 永远在） |

### 朋友配置

```typescript
new Mnemos({
  features: {
    decay: {
      enabled: true,                    // 默认 false（v0.4 opt-in，v0.5 改默认 true）
      coldThreshold: 0.1,               // R 低于此值算 cold
      coldDormancyDays: 7,              // cold 多久后从 search hide
    }
  }
});
```

### archival 不受 decay

archival 永久 stability=1.0，永远在。这是 RFC 0001 原则 4 守护。

## B10. Reflect job

### 设计

`MnemosWorker` 加新任务类型 `reflect`：周期性扫描某 user 的最近 N 条 episodic，让 LLM 抽取出可升 semantic 的 pattern。

### 触发

| 触发 | 时机 |
|---|---|
| 每个 user 累积 ≥ 20 条新 episodic | 入 reflect queue |
| 或每周 1 次（人工 cron） | 强制 reflect |
| 或朋友显式 `userMem.runReflect()` | 立即跑 |

### LLM 流程

输入：最近 20 条 episodic（按 created_at 倒序）+ 现有 personal_semantic（作 anchor）

Prompt 让 LLM 输出：
- 新 semantic（从多 episodic 抽出的 pattern）
- 升级建议（某条 episodic → personal_semantic）
- 矛盾检测（新 episodic 与现 personal_semantic 冲突）

### Schema 变更

```typescript
type Memory = {
  // ...
  consolidated_from?: string[];  // semantic / personal_semantic 来自哪几条 episodic
  consolidated_at?: string;
};
```

### 朋友配置

```typescript
new Mnemos({
  features: {
    reflect: {
      enabled: true,                    // 默认 false（v0.4 opt-in）
      autoTriggerThreshold: 20,         // 累积 N 条 episodic 自动触发
      includePersonalSemantic: true,    // reflect 输入是否带 personal_semantic anchor
    }
  }
});
```

# Drawbacks

- FSRS 增加 storage 读写（每次 search 命中都 update last_accessed/S）
- Reflect job 增加 LLM 调用（每个 user 周/月 1 次）
- Sensitivity 默认开可能让朋友首次集成时困惑（"为什么搜不到我刚 ingest 的健康记录"）—— 通过文档 + warning log 解决
- Decay 触发的 cold 判定可能误伤罕用但重要的记忆（如年度纪念日）—— v0.5 加 protected flag

# Alternatives

## A. 不做 FSRS，只用简单时间衰减
- 优：实施简单
- 劣：忽视访问频率，常用记忆也会被衰减
- **拒绝**：FSRS 的 S 强化机制是核心

## B. Reflect 用 vector 聚类而非 LLM
- 优：成本低
- 劣：聚类不能产出可读 semantic，需要再调 LLM 解释
- **拒绝**：直接 LLM 更直观

## C. 不做 cold dormancy，只做 stability 衰减
- 优：search 行为更可预期
- 劣：noise 累积不解决
- **决议**：cold 默认 hide 但提供 `includeCold: true` 朋友查全集

## D. Sensitivity 检测靠用户 tag 而非 LLM
- 优：避免误判
- 劣：朋友不会教用户 tag
- **决议**：LLM 自动 + 用户可 override（write API 允许显式 `sensitive: false` 覆盖）

# Unresolved Questions

1. **Cold memory 是真删还是仅 hide**？
   - 决议：仅 hide。`storage.list({ includeCold: true })` 仍可查。archival 永远不 cold。

2. **Reflect 跨多个 chunk 时是否串成"周报"**？
   - 决议：v0.4 不做。Reflect 输出独立 semantic/personal_semantic，不做月报/年报。v0.5+ 考虑。

3. **FSRS 的 access_count 与 stability 是否互相影响**？
   - 决议：v0.4 仅 stability 互相影响，access_count 是辅助 metric 不进公式。

4. **Sensitivity 检测的"亲密关系" 是否包括职场关系**？
   - 决议：不包括。亲密关系 = 配偶/伴侣/家人。职场关系不标 sensitive。

5. **Narrative format 让朋友的 LLM 写还是 mnemos 自己写**？
   - 决议：朋友的 LLM（用 Mnemos 配置的 llm provider）。mnemos 不持有 LLM 凭证。

# Prior Art

- Memory-Palace `vitality token` —— 衰减启发
- Anki / SuperMemo FSRS（Fresh Spaced Repetition Scheduler）—— S/D/R 三参数
- v0.3 多视角 merge —— reflect 用类似 merge 模式
- v0.2 sensitive 字段 —— v0.4 让它真正生效

# Implementation Plan

按依赖顺序：

1. **B6 Sensitivity defaults**（最简单先做）
   - `SearchOptions.includeSensitive` 默认 false（v0.3 已是；加文档）
   - Prompt 增加 sensitivity 检测引导
   - 测试：含敏感关键词的内容 → memory.sensitive=true
   - 测试：默认 search 不返回 sensitive，显式 `includeSensitive:true` 返回

2. **B7 Output tiers**（独立于 storage）
   - `ContextOptions.format` 字段
   - `utils/markdown.ts` 加 `memoriesToMarkdownTiered()` / `memoriesToMarkdownNarrative()`
   - narrative 走 1 次 LLM 调用
   - 测试：三种 format 各跑一次，输出结构正确

3. **B9 FSRS decay**（基础设施层，需要 storage 改）
   - `Memory.difficulty / retrievability / last_decay_at` 字段加入 schema
   - schema migration v0.3 → v0.4
   - `src/decay.ts` 新建 — FSRS 简化算法 + decay tick 函数
   - `storage` 加 `markCold` / `unmarkCold` / `listCold` 方法
   - `MnemosWorker` 周期任务（每 24h 跑一次）
   - search 时 `last_accessed = now` + `S *= 1.3`（capped）
   - 测试：FSRS 公式正确性 / cold 标注 / archival 永不 cold

4. **B10 Reflect job**（最复杂）
   - `src/reflect.ts` 新建 — reflect prompt + merge 逻辑
   - `Memory.consolidated_from / consolidated_at` 字段加入 schema
   - Worker 加 reflect 任务类型（独立于 ingest 任务）
   - `UserMemory.runReflect()` 手动触发
   - 自动触发：累积 N 条 episodic 后入 queue
   - 测试：reflect 输入 20 条 episodic + 5 条 personal_semantic → 输出新 semantic + consolidated_from 引用

5. **测试** `tests/v04/`：
   - unit/sensitivity-detection.test.ts
   - unit/output-tiers.test.ts
   - unit/fsrs-decay.test.ts
   - unit/reflect-merge.test.ts
   - integration/cold-hide-from-search.test.ts
   - integration/auto-reflect-trigger.test.ts
   - integration/migration-v03-to-v04.test.ts

6. **examples/** 新增：
   - `examples/forgetting/` — FSRS decay 演示（写 10 条 → 等 100ms 算 decay → cold 标注）
   - `examples/reflect-job/` — 20 条 episodic 跑 reflect → 输出 semantic

7. **README**：加 4 节
   - Sensitivity defaults
   - Output formats
   - FSRS Decay
   - Reflect Consolidation

8. **CHANGELOG**：v0.4 entry + v0.5 候选清单

# 强约束（v0.4 实施时不可违反）

- 所有 v0.1-v0.3 测试继续过（70/70）
- 新 v0.4 测试 ≥ 7 个全过
- archival 永远不 cold / 永远不被 reflect 修改
- 跨 user namespace 永不互相 reflect / 互相 decay
- 默认行为完全向后兼容（decay/reflect 默认关，sensitivity 默认 hide 已是 v0.3 行为只是显式化）
- schema migration v0.3 → v0.4 幂等
- TS strict + 零 any in src/

# FAQ

**Q**：升级 v0.4 后我的 v0.3 数据会变化吗？
A：不会。新字段（difficulty / retrievability / last_decay_at / consolidated_from / consolidated_at）旧记录都是 NULL。FSRS decay 默认关，朋友显式开才生效。

**Q**：Reflect job 烧多少 token？
A：每次 ~3000 input + ~1500 output ≈ $0.02 (Claude Sonnet)。每用户每周 1 次 = $1/月。

**Q**：sensitivity 检测错了会怎样？
A：朋友通过 `write()` API 显式 override，或在 UI 让用户 unmark。永远不会因 sensitivity 误标导致数据丢失（archival 永远在）。
