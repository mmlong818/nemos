---
rfc_number: 0007
title: Bi-Temporal Validity & Invalidation Semantics
authors:
  - nemos team
status: draft
created_at: 2026-06-17
updated_at: 2026-06-17
discussion_url: <PR URL>
implementation_pr: <if accepted, PR URL>
supersedes: []
---

# Summary

为 Nemos 引入**双时间（bi-temporal）有效性模型**与**失效语义**：每条事实在「世界轴」（何时为真 / 何时停止为真）与「系统轴」（何时被系统采信 / 何时被取代）两条独立时间线上被追踪。失效不再等同删除或遗忘——旧事实被标失效但保留，可回答「我在某时刻所知、关于某事在另一时刻的状态」。失效信息以事件流（复用 `audit.mutations`）记录、物化回扁平字段供热路径查询。

# Motivation

## 现状

Nemos 现有的时间表达是**残缺的半轴**：

- 只有 personal_semantic 层有事实级有效期（`valid_from` / `valid_to`，且 `valid_to` 是 date 精度，见 spec §2.3）；其余 episodic / semantic / procedural 四层没有任何「事实何时停止为真」的表达。
- 只有「世界轴」的一半。系统轴的终点——**「此记录何时被系统取代」**——完全缺失。`created_at` 给了系统轴起点，但没有对应的 `expired_at`。
- `valid_to` 与版本演化（`supersedes`，spec §5.4）语义**混用**：被 supersede 的旧版本会被设 `valid_to`，于是「世界变了」和「系统改主意了」两件本质不同的事被塞进同一个字段。
- 失效只能由**人工纠错**驱动（`corrects` / `corrected_by`，spec §5.1 / §6），没有「新事实与旧事实矛盾 → 自动失效旧事实」的机制。

## 痛点

一个记忆系统若不能区分这三轴，就无法回答用户真正会问的时间问题：

> 「我上周才知道他三年前就离职了。」

这条记忆里有三个互不相同的时刻：事实在世界中为真的起点（三年前入职后某时）、停止为真的点（三年前离职），以及系统知晓这件事的时刻（上周）。现有 schema 只能记录其一，必然丢失另外两个。结果是：

- **无法做可信的时间旅行查询**——「我在 X 日所相信的、关于 Y 的事实是什么」无法回答。
- **失效 = 丢失**——被纠正/被取代的事实要么被覆盖，要么散落在 supersedes 链里，信念演变史不可重建。
- **失效与遗忘混淆**——FSRS 衰减（RFC 0004）让冷记忆下沉，但「不再被想起」与「不再为真」是两回事；当前没有字段区分。

## 本 RFC 解决的问题

补齐缺失的系统轴终点，把有效期从 personal_semantic 泛化到所有 derived 层，引入矛盾驱动的自动失效，并明确**失效（invalidation）/ 取代（supersession）/ 纠错（correction）/ 遗忘（decay）四者的边界**——它们都让一条记忆「不再活跃」，但语义、触发、可逆性、可见性各不相同。

## 与 Nemos 设计原则（RFC 0001）的关系

| 原则 | 本 RFC 的兼容方式 |
|---|---|
| 原则 1（AI 是仆人不是代理 / I4） | personal_semantic 的失效**只能由 authoritative（用户亲述）触发**；LLM 推断永不自动失效个人事实——比矛盾失效的通用规则更严。 |
| 原则 3（默认衰减） | 失效与衰减**正交且互补**：衰减改可见性（FSRS `cold`），失效改有效性（`invalid_at`）。一条记忆可以「冷但仍为真」或「热但已失效」。 |
| 原则 5（三维元数据 / 不可变 archival） | 失效是对**派生品**的标注，archival（I3）永不失效；失效事件挂在 `audit.mutations` 上，本身不可篡改。 |
| 原则 8（reflect 非 hot-path） | 矛盾检测与自动失效只在 reflect / worker 离线执行；热路径只读物化字段。 |
| 原则 10（E2EE 字段级标注） | 时间戳字段服务端可见（用于时间路由），矛盾检测的 LLM 判定在 E2EE SKU 迁客户端。 |

# Detailed Design

## 1. 三条时间轴

每条事实（derived 记忆）在三个时刻上被定位，两两正交：

| 轴 | 字段 | 语义 | 谁设置 |
|---|---|---|---|
| 世界·起 | `valid_at` | 事实在世界中**开始为真** | 抽取（LLM）/ 用户 |
| 世界·止 | `invalid_at` | 事实在世界中**停止为真**；null = 仍为真 | 矛盾失效 / 用户 |
| 系统·起 | `created_at`（已有） | 记录**被系统写入** | 系统 |
| 系统·止 | `expired_at` | 此记录**被系统取代**；null = 当前信念 | 取代 / 失效 / 纠错 |

> 「世界·止」与「系统·止」必须分开：`invalid_at` 说「事实曾为真、现在不真了」；`expired_at` 说「系统对此事实的这条认知被另一条取代了」。前者是关于世界的陈述，后者是关于系统信念的陈述。混用二者正是当前 `valid_to` 的设计债。

## 2. Schema / API / 协议变更

### 2.1 `Memory` 新增字段（全 optional → §11.1 向后兼容）

```ts
// 世界轴 —— 泛化到所有 derived 层
valid_at?: string;     // ISO 8601；统一并替代 personal_semantic.valid_from 与 v0.2 event_at（见 §2.3 迁移）
invalid_at?: string;   // ISO 8601；事实停止为真的时刻；null = 仍为真

// 系统轴 —— 本 RFC 真正补的缺口
expired_at?: string;   // ISO 8601；此记录被系统取代的时刻；null = 当前信念
                       // 系统轴起点复用已有 created_at，无需新增

// 派生态（物化，索引用；由 §3 事件流 fold 得出，写入时同步刷新）
belief_state?: "active" | "invalidated" | "superseded" | "corrected";
```

`belief_state` 是冗余物化字段，单一真相源是 §3 的事件流；它存在仅为让热路径 `WHERE belief_state='active'` 走索引，避免每次查询重算。

### 2.2 失效语义状态机

四种「不再活跃」严格区分，不可互相代替：

| 触发 | 设置 | 旧记录命运 | 可逆 | search 默认 | 复用机制 |
|---|---|---|---|---|---|
| **失效**（世界变了：他离职了） | `invalid_at` + `belief_state=invalidated` | 保留，可作历史查 | 否（除非世界又变→revalidate） | 隐藏 | 本 RFC 新增 |
| **取代**（同命题新版本） | `expired_at` + `supersedes` + `belief_state=superseded` | 保留，版本链可回溯 | 否 | 隐藏 | 既有 `supersedes` 链 |
| **纠错**（本来就错） | `corrected_by` + `expired_at` + `wrong_scope` + `belief_state=corrected` | quarantine | 否 | 隐藏 | 既有 `corrects` / §6 错误标注 |
| **遗忘**（自然衰减） | FSRS `cold` / `cold_at` | 保留，仍为真 | 是（再访问回暖） | 隐藏 | 既有 RFC 0004 decay |

关键不变量：**失效不改 `valid_at`，遗忘不改 `belief_state`**。一条记忆可同时是 `belief_state=active` 且 `cold=true`（仍为真但久未想起），也可 `belief_state=invalidated` 且非 cold（刚被推翻、仍很「热」）。

### 2.3 矛盾驱动自动失效（借 graphiti `resolve_extracted_edges`，不强制图库）

在 worker / reflect 离线执行（原则 8），接入既有 v0.3 background 队列：

```
新 derived 写入（authoritative，或 confidence>=high 的 derived）
  │
  ├─ 1. 用既有 vector + FTS 检索语义相关的 belief_state=active 记录
  ├─ 2. 廉价粗筛：MinHash/Jaccard 先过滤候选（graphiti 式，省 LLM 调用）
  ├─ 3. LLM 仅对候选判矛盾（结构化输出：{contradicts: bool, invalid_at?}）
  └─ 4. 判定矛盾 →
         旧记录追加 audit.mutation{kind:invalidated}
         物化 invalid_at（取新事实 valid_at 或 LLM 给的时点）+ expired_at=now
         写双向 corrects / corrected_by
```

**I4 加严**：当候选属于 personal_semantic 层时，仅当**新事实也是 authoritative** 才允许自动失效；derived 永不自动失效个人事实（只能向 `proposals/` 队列提请，由用户确认）。这比通用矛盾失效规则更严，守住原则 1。

### 2.4 查询语义：双轴 as-of

```ts
interface SearchOptions {
  // ...既有字段
  asOfValid?: string;          // 世界轴 as-of：返回该时刻「为真」的事实
  asOfSystem?: string;         // 系统轴 as-of：返回系统在该时刻「所采信」的版本
  includeInvalidated?: boolean; // 默认 false
}
```

默认（三者都不传）= 当前信念下当前为真的事实：

```sql
valid_at   <= now
AND (invalid_at IS NULL OR invalid_at > now)
AND expired_at IS NULL
AND belief_state = 'active'
```

双轴 as-of（回答开头那句「我上周才知道他三年前就离职了」）：

```sql
-- asOfSystem=上周, asOfValid=两年前 → 「上周的我，关于两年前的他，相信什么」
created_at <= :asOfSystem
AND (expired_at IS NULL OR expired_at > :asOfSystem)
AND valid_at <= :asOfValid
AND (invalid_at IS NULL OR invalid_at > :asOfValid)
```

## 3. 失效作为事件，而非字段（事件溯源基底）

§2 的扁平字段是**物化视图**，不是真相源。真相源是 append-only 的时态事件流，**复用既有 `audit.mutations[]`**——Nemos 已经有这条流，archival 不可变也是同一哲学，因此本 RFC 几乎不引入新概念。

```ts
// audit.mutations[].kind 扩枚举（enum 增值 = minor bump，§11.1 合规）
kind: "asserted" | "invalidated" | "revalidated" | "corrected" | "superseded" | /* ...既有值 */
// 每条带：{ at（系统时间）, valid_at?/invalid_at?（世界时间）, by, reason, evidence_refs }
```

- 写路径：每次失效/取代/纠错 → 追加一条 mutation + 同步刷新 §2.1 的物化字段。
- 读路径：热路径只读物化字段（O(1)）；要重建信念演变史 / 时间旅行审计时，fold 该记录的 mutation 流。
- 一致性：物化字段 = 事件流的确定性投影；提供 `nemos verify --rematerialize` 在物化与日志不一致时重建。

## 跨 SKU 兼容性

- **a 公共云**：时间戳与 `belief_state` 服务端可见，矛盾检测（LLM）服务端跑。
- **b E2EE**：四个时间戳 + `belief_state` 服务端明文可见（用于时间路由与 as-of 过滤，不泄漏内容）；矛盾检测的 LLM 判定与 MinHash 粗筛迁客户端（与既有 contradiction detection 客户端化一致，spec §12.1）。
- **c 自托管**：与公共云同。

## 多租户语义

不影响 tenant / user / scope 隔离。矛盾检测仅在同一 `(tenant_id, user_id)` 内的同 scope（或显式跨 scope，受既有 `crossScopeLink` 约束）候选上进行，跨 user 永不互相失效。

## 向后兼容

- **纯 optional 新增 + enum 增值**，v0.5 → v0.6 minor bump，§11.1 合规，零破坏。
- 字段迁移（保留旧字段读兼容，标 `@deprecated`，两个 minor 后删）：
  - `personal_semantic.valid_from` / `valid_to` → 统一 `valid_at` / `invalid_at`；
  - v0.2 `event_at` → episodic 的 `valid_at` 别名。
- 存量记录默认：`valid_at = created_at`，`invalid_at = null`，`expired_at = null`，`belief_state = 'active'`。被既有 `supersedes` 指向的旧记录回填 `belief_state = 'superseded'` + `expired_at = 后继.created_at`。
- 默认关闭自动失效（`features.invalidation.enabled = false`），与 RFC 0004/0005/0006 的渐进启用风格一致。

# Drawbacks

- **物化一致性负担**：扁平字段与事件流双写，需 `rematerialize` 兜底，增维护面。
- **矛盾检测成本与误判**：LLM 判矛盾有假阳性风险，可能误失效正确事实。缓解：MinHash 粗筛降调用量；失效可逆（revalidate）；personal_semantic 走用户确认。
- **概念负荷**：使用者需理解「失效 ≠ 遗忘 ≠ 取代 ≠ 纠错」四分。缓解：默认查询语义屏蔽全部复杂度，as-of 是 power-user 接口。
- **`valid_to` 迁移**：现有 personal_semantic 数据需迁移脚本，date → ISO 8601 提精度。
- **写放大**：每次失效触发候选检索 + 可能的 LLM 调用，必须严格离线化，否则击穿热路径预算。

# Alternatives

## 替代 A：平铺四时间戳（仅扁平字段，无事件流）
- 简述：把四时间戳作 `Memory` optional 字段，失效直接覆写字段，不留事件流。
- 优：迁移最小，查询最快，与 graphiti 心智一一对应。
- 缺：信念变更史丢进 `supersedes` 链，「为什么改主意」散落，无法完整重放。
- **拒绝理由**：丢失审计级可重建性——而 Nemos 已有 `audit.mutations` 这条流，不用是浪费。（本 RFC 采用其字段作为 §2 物化层，但补上 §3 事件流。）

## 替代 B：命题/断言分离（SQL:2011 教科书双时间）
- 简述：拆出不变的 `Statement`（content-addressed 命题）与可多条的 `Assertion`（带四时间戳的信念区间），`Memory` 持指针。
- 优：审计级、两轴皆可时间旅行、同一命题多来源天然去重、永不丢历史。
- 缺：对嵌入式 SQLite SDK 过重；读需 join；与现有扁平 `Memory` 模型割裂；新增一张核心表。
- **拒绝理由**：over-engineering。其收益（多来源去重、严格规范化）当前阶段不值其复杂度；可留作 v1.x 若审计需求升级时再议。

## 替代 C：不做系统轴，只泛化 valid_from/valid_to
- 简述：把 personal_semantic 的 `valid_from/valid_to` 推广到全层，不引入 `expired_at` 与事件流。
- 优：改动小，复用现有字段。
- 缺：仍混用「世界变了」与「系统改主意」；无法回答双轴 as-of；失效仍 = 丢失。
- **拒绝理由**：不解决 Motivation 的核心缺口（系统轴缺失）。

> 最终选择 = 事件溯源基底（C 式，复用 `audit.mutations`）+ 平铺物化表面（A 式字段作读缓存）。这是 Nemos 已有基础设施（audit 流 + archival 不可变 + FSRS）决定的最优解，非通用模板。

# Unresolved Questions

- **矛盾判定的置信门槛**：derived 触发自动失效的 `confidence` 下限定在哪？误失效的代价是否应让门槛更保守？
- **revalidate 触发**：世界又变回来（复职）时，是写新记录还是 revalidate 旧记录？两者在版本链中如何呈现？
- **`invalid_at` 缺值**：LLM 判矛盾但给不出失效时点时，`invalid_at` 取新事实的 `valid_at` 是否总是正确？
- **物化与日志漂移**：多设备 E2EE 下物化字段的 CRDT 仲裁（与 RFC 0004 decay 仲裁共用？）。
- **与 prospective（RFC 0006）的交互**：前瞻的 `prediction_log` 是否也应纳入双轴模型？预测「失效」与事实「失效」是否同一套语义？
- **as-of 查询的 eval**：时间旅行查询的正确性如何量化测试？需要构造带已知信念演变史的 fixture。

# Prior Art

- **Graphiti（getzep）**：每条边带 `valid_at` / `invalid_at`（世界轴）+ `created_at` / `expired_at`（系统轴）四时间戳，矛盾驱动失效（`resolve_extracted_edges`），MinHash/LSH 去重粗筛——本 RFC 双时间模型与矛盾失效流程的直接来源。
- **SQL:2011 双时间表 / Snodgrass《Developing Time-Oriented Database Applications》**：valid-time 与 transaction-time 双轴的规范理论基础。
- **Datomic / 事件溯源（Event Sourcing）**：事实不可变、当前态是事件流投影——§3 基底的工程范式。
- **Nemos RFC 0004（Forgetting & Consolidation）**：失效与遗忘的边界划分对象；FSRS `cold` 复用。
- **Nemos spec §2.3 / §5.1 / §5.4**：现有 `valid_from`/`valid_to`、`corrects`、`supersedes` 的待统一对象。

# Implementation Plan（accepted 后填）

> **实现现状校正（2026-06-18）**：审计 TS SDK 发现 §3 依赖的 `audit.mutations` 事件流**只存在于 spec，SDK 从未实现**（`Memory` 无 `audit` 字段）；同理 `valid_from`/`valid_to` 也只在 spec、SDK 仅有 v0.2 `event_at`。因此本 RFC 分阶段落地：**先平铺物化字段**（独立解锁 Step 3 as-of），**事件溯源基底（§3）作为后续单独一步**在 SDK 引入 `audit.mutations`。这是 Alternative A 作为 C 式终态的中间态，非推翻 §3 选型。

- Step 1（✅ 平铺字段半已落地 2026-06-18）：`Memory` 新增 `valid_at`/`invalid_at`/`expired_at`/`belief_state`；SQLite schema 迁移（v0.5 → v0.6，存量 `valid_at=created_at` + 被 supersede 旧记录回填 `superseded`+`expired_at`，archival 不参与双时间）；row-mapper + 双 storage 写路径 + 迁移/round-trip 测试。
  - ⏳ 待办：`audit.mutations` 事件流引入 SDK + `kind` 扩枚举（§3 真相源；当前物化字段为唯一存储）。
- Step 2: `valid_from`/`valid_to`/`event_at` → `valid_at`/`invalid_at` 迁移脚本 + `@deprecated` 读兼容层。
- Step 3: 双轴 as-of 查询接入 `SearchOptions`（`asOfValid` / `asOfSystem` / `includeInvalidated`）。
- Step 4: 失效状态机写路径（取代 / 纠错与既有 supersedes / corrects 接线）+ 物化刷新。
- Step 5: 矛盾驱动自动失效 worker（复用 queue.ts + MinHash 粗筛 + LLM 判矛盾），默认关闭。
  - 🟡 最小闭环已落地（2026-06-20，由 RFC 0008 陪伴 App「从不踩雷」需求驱动）：reflect **内联**识别 `invalidates`（守门仅 personal_semantic anchor）→ `storage.markInvalidated`（belief_state=invalidated + invalid_at/expired_at + corrected_by 回链）；检索默认 `belief_state='active'` 过滤（`SearchOptions.includeInvalidated` 逃生阀）；gate = `features.invalidation.enabled`（默认关）。**未做**：独立 worker 化 + MinHash/Jaccard 粗筛（当前每个候选直接靠 reflect LLM 判，无粗筛降本）。
- Step 6: `nemos verify --rematerialize` 一致性兜底 + 时间旅行 eval fixture + E2EE 客户端路径。

预计里程碑：对齐 ROADMAP v0.6，可在 RFC 0005/0006 之后独立推进。

# FAQ

**Q：失效和遗忘（FSRS cold）有什么区别？**
A：正交。遗忘改**可见性**（久未想起 → 下沉，可回暖），失效改**有效性**（不再为真，不可逆除非世界又变）。一条记忆可以「冷但仍为真」或「热但已失效」。

**Q：AI 会不会自动把用户的个人事实判失效？**
A：不会。personal_semantic 的自动失效只能由 authoritative（用户亲述）触发；LLM 推断的 derived 永不自动失效个人事实，只能向 `proposals/` 队列提请用户确认（I4 / 原则 1）。

**Q：为什么不直接覆盖旧事实，非要保留？**
A：保留才能回答「我那时相信什么」。失效是一条事实而非一次删除——这也是 Nemos 与「会膨胀的硬盘」式记忆的根本区别。

**Q：`invalid_at` 和 `expired_at` 到底差在哪？**
A：`invalid_at` 是世界的陈述（事实停止为真）；`expired_at` 是系统信念的陈述（这条认知被另一条取代）。「他离职了」让旧的「他在职」`invalid_at` 置位；而把同一条事实改个措辞重存，是 `expired_at` + supersede，与世界是否变化无关。

**Q：这会拖慢检索吗？**
A：不会。热路径只读物化的 `belief_state` + 时间戳走索引；矛盾检测与事件流 fold 全在 worker / reflect 离线执行（原则 8）。
