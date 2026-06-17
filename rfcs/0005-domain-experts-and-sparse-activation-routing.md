---
rfc_number: 0005
title: Domain Experts & Sparse Activation Routing
authors:
  - nemos team
status: draft
created_at: 2026-06-15
updated_at: 2026-06-15
discussion_url: <PR URL>
implementation_pr: <if accepted, PR URL>
supersedes: []
---

# Summary

在现有 5 层功能存储之上叠加一个正交的**领域轴**：把记忆按主题/学科组织成大量细粒度"领域专家"，借鉴 LLM 的 MoE（Mixture-of-Experts）思路，用**路由 + 稀疏激活**保证每次检索只点亮"共享层 + 少量高相关领域"，从而既能容纳全世界所有领域，又避免艺术与医疗之间的名词/概念/模式互相污染。

# Motivation

## 现状

Nemos 现有 5 层（episodic / semantic / personal_semantic / procedural / archival，见 RFC 0001 原则 2）按**记忆的功能形态**切分——"这是一段经历" vs "这是一条事实" vs "这是一个习惯"。但**同一功能层内部，所有领域的内容是混在一起的**：医疗事实与艺术事实同处 semantic 层、共享同一个 embedding 空间与检索通道。

## 痛点

- **概念污染**：不相干领域的名词、概念、模式在同一向量空间里相互干扰。"depression"（医学：抑郁症 / 经济学：萧条 / 地理：洼地）在统一空间里无法靠上下文消歧。
- **检索噪声随规模放大**：库越大，跨领域的假性近邻越多，top-k 召回被无关领域稀释。
- **全库搜索变慢**：每次查询都在全部记忆上做向量/FTS 检索，与 RFC 0001 原则 8 的 hot-path `<100ms` 预算逐渐冲突。

## 本 RFC 解决的问题

引入领域轴 + 稀疏激活，使**激活规模与总库规模解耦**：总库可以无限增长，单次激活始终是"共享层 + 3~4 个领域子集"。这同时改善**准确性**（隔离污染）与**延迟**（缩小搜索空间）。

## 与 Nemos 设计原则（RFC 0001）的关系

| 原则 | 本 RFC 的兼容方式 |
|---|---|
| 原则 2（分层存储） | **不改 5 层**。领域是叠加在其上的正交索引，非替代。 |
| 原则 3（默认衰减） | 衰减从"单条记忆"粒度**提升到"领域"粒度**：整个领域可一起沉睡。 |
| 原则 4（immutable archive） | 领域归属属"可变解释层"，reassign 不碰原始字节。 |
| 原则 5（三维元数据） | source/arousal/surprise 每条照常，正交于领域。 |
| 原则 8（reflect 非 hot-path） | 所有领域演化（split/merge/birth/sleep）只在 reflect 离线执行。 |
| 原则 10（E2EE 字段级标注） | 领域质心计算与路由在 E2EE SKU 下迁到客户端。 |

# Detailed Design

## 0. 指导原则：渐进固化（intelligence flows, then crystallizes）

本 RFC（及 RFC 0006）的所有"智能判断"都遵循同一条实现路线：

> **智能先流动**（LLM 直接判断，零工程、能跑）→ **被现实验证后结晶成结构**（规则 / 表 / 固化条目）→ **评估迭代**。

该原则分形地出现在多个层面：领域本体（记忆涌现 → split/merge 固化）、路由（LLM 路由 → 质心 → 路由表）、前瞻记忆（按需 LLM 合成 → 验证后固化，见 RFC 0006）。它既是设计美学的一致性来源，也是实现排期的依据：**每个能力都先用 LLM 发车，再逐步结晶兜底**。其对称面——**反固化（de-crystallization）**，即过时的结晶结构如何退场——见 Unresolved Questions。

## 1. 三轴正交模型

| 轴 | 区分什么 | 来源 |
|---|---|---|
| **功能轴** | episodic / semantic / personal_semantic / procedural / archival | RFC 0001 现有 |
| **领域轴** | 医疗 / 艺术 / 法律 …（MoE 专家路由） | 本 RFC |
| **时态轴** | 回溯（过去） ↔ 前瞻（未来） | RFC 0006 |

三轴**不是笛卡尔积**（会爆炸），它们带约束：例如前瞻记忆恒为 `derived`，因此进不了 personal_semantic 层。

## 2. 核心建模：领域 = embedding 锚点，记忆 = soft 多归属

- 每个领域由一个/一组**质心向量（prototype）** + 一个层级位置表示，而非物理分区（独立表/库）。
- 一条记忆对领域是 **soft membership**（连续隶属度，可多归属），不是布尔归属。"膝伤后还能不能弹钢琴"可同时高隶属于「医疗」与「音乐」。
- 路由 = query 向量到各领域质心的相似度 → top-k。

物理分区被拒绝（见 Alternatives A），因为它无法表达多归属，且 split/merge 会退化为昂贵的数据搬迁；锚点模型下 split/merge 是质心的几何操作。

## 3. 共享层 L0（shared expert, always-on）

借鉴 DeepSeekMoE 的 shared-expert isolation：领域无关的核心——核心人格、通用程序性能力、跨域元概念——归入特殊领域 `GLOBAL`，**无条件注入，不参与路由**。这是"抽象通用顶层不做领域切分"的严格落点。

## 4. 四级稀疏激活

每次检索点亮集合 = L0 ∪ L1 ∪ L2 ∪ L3：

| 级 | 激活内容 | MoE 类比 | 权重 |
|---|---|---|---|
| **L0 共享层** | 无条件注入的核心自我/通用能力 | shared expert | 恒定高 |
| **L1 主领域** | 路由命中的最相关领域，全量检索 | top-1 routed | 高 |
| **L2 邻接领域** | 由 domain_affinity 连出的 2~3 个次相关领域 | top-k routed | 中 |
| **L3 跨域扩散** | 从 L1/L2 命中记忆沿 cross-memory 边扩散 1 跳（限额 N） | spreading activation | 低 |

**L3 是隔离↔关联矛盾（TRIZ 物理矛盾）的系统层级分离解**：隔离发生在「领域」粒度（路由层），关联发生在「记忆」粒度（cross-memory 边，RFC 0003），两者不在同一层级，矛盾化解。L3 保住了 Nemos 引以为傲的跨领域意外联想能力。**明确约束：cross-memory 边的建立与遍历在记忆粒度自由进行，不受领域墙约束**——这是 L3 成立的前提，领域隔离只作用于路由层，绝不限制记忆间的连接。

## 5. RouterProvider：作为独立可替换能力

路由是单一职责模块，与现有 `llm.ts` / `embedding.ts` 的 provider 抽象同构：

```
RouterProvider {
  route(query, userDomains) -> {
    L1: DomainId,
    L2: DomainId[],
    confidence: number,
    fallback?: boolean      // 置信不足 -> 退化为全局检索（逃生阀）
  }
}
```

实现随规模**叠加演化**（非替换）：

| 阶段 | 实现 | 适用 | 角色 |
|---|---|---|---|
| 保底 | `LLMRouter`：领域清单 + query 交 LLM 选 top-k | 冷启动 / 领域数少（<~8） | v1 直接发车 |
| 热路径 | `CentroidRouter`：q_vec · prototype_vec，纯数值 top-k | 中等规模 | 守 100ms；LLM 退到 reflect 离线校正质心 |
| 大规模 | `HybridRouter`：质心 + **路由表**（entity/keyword → domain 硬触发） | 领域多、质心区分度下降 | 规则提供确定性锚点，质心兜其余 |

## 6. 领域生命周期（全部在 reflect 离线层）

| 事件 | 触发条件 | 防抖 |
|---|---|---|
| **诞生 birth** | 一批记忆离所有现有质心超阈值 → 聚新领域，LLM 命名，标 `origin=emergent` | 最小成团数 |
| **分裂 split** | 领域记忆量过载 **且** 内部多峰（二次聚类轮廓高） → 裂子领域，`parent_id` 回指 | 滞后阈值 + 最小存活期 |
| **合并 merge** | 两领域 affinity 长期高 **且** 隶属度交叠大 → 合并 | 持续观察窗 |
| **沉睡 sleep** | 领域整体长期未被路由命中 → 领域级 retrievability 下降，沉为 `cold`，默认不参与路由（可被全局回退唤醒） | —— |

沉睡复用 RFC 0004 的 FSRS，但作用粒度从单条记忆提升到领域。

## 7. 逃生阀（漏检兜底）

隔离架构的原罪是**路由错误导致不可逆漏检**。三道保险：

1. **soft 多归属**：一条记忆挂多领域，先天降低漏检。
2. **低置信回退**：top-1 置信 < 阈值 → 自动全局检索。隔离是优化，不是牢笼。
3. **周期性全局重扫**：reflect 定期跨领域全检，修正长期累积的错置归属。

## Schema / API / 协议变更

### 新增表（叠加在现有 schema 之上，5 层不动）

```
domains {
  id, tenant_id, user_scope,
  label, prototype_vec, parent_id, level,
  status: 'hot' | 'warm' | 'cold',
  origin: 'seed' | 'emergent',
  load_stats, retrievability, last_routed_at,
  created_at, updated_at
}

memory_domain {
  memory_id, domain_id,
  membership_weight: number,   // soft 隶属度
  is_primary: boolean
}

domain_affinity {
  domain_a, domain_b,
  affinity: number,            // 共激活 + 共边统计
  updated_at
}
```

`GLOBAL` 共享层：一条特殊 `domains` 记录 + `always_on=true` 标记，不参与路由打分。

### API / 协议

**对外契约不暴露领域结构**（接口同构、内部异质）：REST / MCP / SDK 仍只暴露 `query → relevant context`；领域本体是 per-user 内部状态，被 `RouterProvider` 完全吸收。这化解"多用户领域结构不一致 → 工程化难"的矛盾——异质性是实现细节，不是契约。

热路径检索流程（守 `/inject/query` <100ms）：

```
1. q_vec = embed(query)
2. RouterProvider.route() -> L1 + L2 + L0；低置信 -> fallback 全局
3. 并行检索: L0 常驻 ‖ L1 高权 ‖ L2 低权
4. L3: 对 top 命中沿 cross-memory 边扩散 1 跳（限额）
5. 融合排序: score = 路由权 × 记忆相关度 × FSRS retrievability × (1 + arousal/surprise)
6. 输出三档: flat / tiered / narrative（复用 RFC 0004）
7. 异步副作用: 记录路由决策 -> 喂 reflect
```

## 跨 SKU 兼容性

- **a 公共云**：质心计算、路由、领域演化均在服务端。
- **b E2EE**：质心计算与路由迁到客户端（原则 10）；服务端只见密文与不可解读的领域 id。
- **c 自托管**：与公共云同，单实例内运行。

## 多租户语义

`domains` / `memory_domain` 均带 `tenant_id` + `user_scope`，领域本体严格隔离在 (tenant, user) 边界内（原则 9）。领域不跨用户共享——跨用户共享走 relational store（原则 6），不在本 RFC 范围。

## 向后兼容

- 纯新增表，现有 5 层 schema 与查询不变。
- 迁移 v0.4 → v0.5：建新表；存量记忆默认全部归入 `GLOBAL` 单领域 → 系统行为**退化为当前现状**（全局检索），随 reflect 逐步分化出领域。**零破坏、可渐进启用**。
- 需要 schema version bump（v0.4 → v0.5）。

# Drawbacks

- **漏检风险**：隔离用"污染"换"漏检"。逃生阀缓解但不能完全消除；路由错误的代价高于统一库。
- **演化抖动**：split/merge 若防抖不当会导致记忆归属反复变、用户感知不一致。
- **复杂度**：新增路由子系统、领域生命周期、三张表与质心维护成本。
- **质心漂移**：长期增量更新的质心可能偏离语义中心，需要 reflect 期重算。
- **冷启动空窗**：新用户领域未分化前，系统等价于现状（这是可接受的退化）。

# Alternatives

## 替代 A：物理硬分区（每领域独立表/库）
- 优：隔离最强，检索空间天然隔开。
- 劣：无法表达多归属；split/merge 退化为昂贵数据搬迁；负载偏斜下产生大量微表。
- **拒绝理由**：与 soft 多归属（痛点 2 的核心）根本冲突。

## 替代 B：纯静态本体（学科树注入，不涌现）
- 优：可解释、稳定、冷启动友好。
- 劣：僵化；强加外部世界观到私人记忆；边界争议永存；无法自适应用户真实分布。
- **拒绝理由**：违反渐进固化原则的"涌现"一端；负载偏斜无法自适应。

## 替代 C：纯涌现聚类（无种子）
- 优：零文化偏见，极贴个人分布。
- 劣：不可解释、命名难、跨 session 漂移抖动、冷启动一片混沌。
- **拒绝理由**：可解释性与稳定性不可接受。

## 替代 D：不分区（维持现状）
- 优：零新增复杂度。
- 劣：痛点 1/2/3 全部不解决，规模增长后必然恶化。
- **拒绝理由**：本 RFC 的存在理由。

> 最终选择 = B/C 的混合（种子 + 涌现裂变），与架构层「混合分层」同构。

# Unresolved Questions

- **路由器选型细节**：质心 vs 轻量分类器 vs LLM 的精确切换阈值与混合权重。
- **领域命名与用户主权**：涌现领域由 LLM 命名，用户能否改名 / 手动 split/merge？（关乎可解释性与信任）
- **多归属写入阈值**：固化时算 top-k 还是固定阈值？默认值待评估确定。
- **评估指标**：路由准确率怎么量化？需要 eval harness（Nemos 已有 eval 文化）。
- **质心表示**：单质心 vs 多质心（一个领域多模态）？
- **反固化（de-crystallization）**：渐进固化的对称面。已结晶的结构（路由表规则、领域、前瞻预案）一旦过时如何退场？倾向方向——**不物理删除，而是"敲低表现"（降权 / 衰减 retrievability）**，与 immutable archive（原则 4）和领域 sleep 一致：让过时结构自然失去影响力而非移除。固化的路由表规则与前瞻预案是否都纳入 retrievability 体系，留待实施期确定。

# Prior Art

- **DeepSeekMoE（2024）**：shared-expert isolation —— L0 共享层的直接来源。
- **Sparsely-Gated MoE（Shazeer et al. 2017）**：top-k gating、expert collapse 与负载均衡问题。
- **Fuzzy c-means**：soft membership 的经典原型。
- **mem0 / Letta**：单层/统一存储方案在规模增长下的概念污染，作为反例。
- Nemos RFC 0003（cross-memory linking / spreading activation）：L3 的现有基础。

# Implementation Plan（accepted 后填）

- Step 1: 新增三张表 + `GLOBAL` 共享层 + 迁移脚本（存量归 GLOBAL）。
- Step 2: `RouterProvider` 接口 + `LLMRouter` 保底实现 + 低置信回退。
- Step 3: reflect 接入领域 birth/split/merge/sleep（含防抖）。
- Step 4: 四级激活检索流程 + 融合排序。
- Step 5: `CentroidRouter` 热路径实现 + LLM 离线校正。
- Step 6: eval harness（路由准确率）+ `HybridRouter` 路由表（大规模）。

预计里程碑：对齐 ROADMAP v0.5。

# FAQ

**Q：领域轴会不会和现有 5 层冲突？**
A：不会，正交。一条记忆功能上是 episodic、领域上属医疗，两个标注独立共存。

**Q：路由错了相关记忆就永远找不到了吗？**
A：有逃生阀——soft 多归属 + 低置信全局回退 + reflect 周期全局重扫。隔离是优化层，不是硬墙。

**Q：用户少量记忆时这套不是过度设计吗？**
A：是，所以冷启动时全部归 GLOBAL 单领域，行为等于现状；领域随数据增长由 reflect 自动分化。

**Q：稀疏激活只是为了省钱？**
A：不只。它同时改善准确性（隔离污染）和延迟（缩小搜索空间），库越大红利越大。
