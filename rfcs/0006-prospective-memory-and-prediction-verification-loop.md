---
rfc_number: 0006
title: Prospective Memory & Prediction-Verification Loop
authors:
  - mnemos team
status: draft
created_at: 2026-06-15
updated_at: 2026-06-15
discussion_url: <PR URL>
implementation_pr: <if accepted, PR URL>
supersedes: []
---

# Summary

为 mnemos 引入**前瞻记忆（prospective memory）**：除了记录"发生过什么"（回溯），系统还持有"面对某类情境，这个人可能会/应当如何行为与思考"的建构性模板。前瞻记忆通过 surprise（预测误差）与 reflect 形成**预测-验证-修正闭环**，使记忆从"会膨胀的硬盘"转变为"对用户预测得越来越准的模型"。

# Motivation

## 现状

mnemos 现有 5 层全部是**回溯性**的——episodic（经历）、semantic（事实）、procedural（已成型的习惯）都记录已发生或已稳定的内容。系统能回答"我过去做过什么"，但无法回答"面对一个新情境，我大概会怎么应对"。

## 痛点

一个只记过去的记忆系统在认知上是残缺的。认知科学近二十年的核心翻案是：**记忆的进化目的不是回忆过去，而是模拟未来**——海马体用同一套机制完成回忆与想象（Schacter 的建构性记忆 / episodic future thinking）。RFC 0001 已引用 Schacter，但现有实现只用了他"回溯"的一半。

procedural 层虽指向未来行为，但它只承载**已稳定的习惯**；用户真正需要的是面对**新情境**的、带发散性的、为未来可能性预留空间的响应模板——这是现有任何一层都不承载的新东西。

## 本 RFC 解决的问题

引入前瞻记忆作为一种新记忆形态，并复用现有 surprise/reflect 零件构建预测-验证闭环，让"领域专家"（RFC 0005）真正名副其实——专家不只是仓库，而是能在其领域对未发生之事做出像样预测的**模拟器**。

## 与 mnemos 设计原则（RFC 0001）的关系

| 原则 | 本 RFC 的兼容方式 |
|---|---|
| 原则 1（AI 是仆人不是代理） | 前瞻是建构的，恒为 `derived` / `chain_depth >= 1`，**永不冒充用户陈述**。 |
| 原则 3（默认衰减） | 前瞻条目复用 FSRS：长期不被触发/验证的预案衰减下沉。 |
| 原则 5（三维元数据） | surprise 获得第二身份——**预测误差信号**。 |
| 原则 8（reflect 非 hot-path） | 预测验证与模板修正只在 reflect 离线执行。 |
| 原则 10（E2EE 字段级标注） | 按需前瞻生成（LLM 调用）在 E2EE SKU 下迁到客户端。 |

# Detailed Design

## 1. 双时态记忆

记忆按认识论性质分两类，构成 RFC 0005 三轴模型的**时态轴**：

- **回溯（retrospective，过去式）**：做过、经历过、学过、接触过——含三种关联指向：挂在「人」上、挂在「环境」上、记录「变化」本身（同一对象随时间的演变）。有 ground truth。
- **前瞻（prospective，未来式）**：面对某类情境可能/应当如何行为与思考。建构、发散、未发生。

## 2. 前瞻是一种新记忆形态（不进 personal_semantic）

前瞻本质是建构的，恒为 `derived`。依据原则 1，`derived` 内容**永远不能进入 personal_semantic**。因此前瞻不复用现有 5 层，而是一种**独立形态**，存于专用表，可归属于一个或多个领域专家（RFC 0005）。

## 3. 前瞻记忆数据模型

```
prospective {
  id, tenant_id, user_scope,
  domain_id,                 // 归属标注（可多归属）；仅供 reflect 归并，不作检索分区
  cue, cue_vec,              // “面对什么情境” —— 检索时匹配的 key
  projection,                // “可能/应当如何行为与思考” —— 内容，发散
  confidence,                // = f(证据量, 历史命中率)
  evidence_refs[],           // 支撑它的回溯记忆 id —— 可追溯（呼应 source 哲学）
  source: { authoritative: false, chain_depth: >=1 },  // 恒 derived
  prediction_log[],          // 历次「预测 vs 现实」对照 -> 算校准/命中率
  retrievability,            // 复用 FSRS：长期不触发/验证则衰减
  status: 'crystallized'     // 固化态；按需生成的默认不落库
}
```

## 4. 混合策略：固化 + 按需（渐进固化）

遵循 RFC 0005 的渐进固化原则：

- **固化前瞻（crystallized）**：高频或高风险情境，reflect 离线生成并落库成可证伪的预案。
- **按需前瞻（on-demand）**：长尾、罕见、全新情境，在 query 时由 LLM 现场合成；若被验证有价值，再回写固化。

**只有固化前瞻能进入预测-验证闭环**（按需生成无持久条目，无法对照现实）。因此纯按需会丢失自我修正能力，纯固化又覆盖不了未预演的新情境——混合是唯一两端都保住的选择（见 Alternatives）。

## 5. 预测-验证-修正闭环

这是本 RFC 的核心，**全部复用现有零件**：

| 时刻 | 发生什么 | 落到哪个零件 |
|---|---|---|
| 检索命中前瞻 | 记一笔"系统做了此预测"，挂 `pending` | 异步副作用，不阻塞热路径 |
| 现实事件落库 | reflect 离线匹配：有无对应 `pending` 预测？ | reflect（原则 8） |
| 预测 ≠ 现实 | 算预测误差 → 写 `surprise` | surprise 的**第二身份** |
| surprise 高 | 修正该前瞻：更新 projection / confidence / evidence | reflect consolidation |

结果：surprise 从"信息论意外度"被重新解释为"预测误差"，reflect 从"episodic→semantic 升华"被扩展为"预测→校准修正"。**零新增机制，全是已有零件的再接线。**

## 6. 与领域专家（RFC 0005）的关系

领域专家 = 该领域的 **(回溯记忆库 + 前瞻生成能力)**。这让 MoE 类比落到实处：expert 不是查表，而是持有该领域小世界模型、能对未发生之事外推的子系统。

## Schema / API / 协议变更

- **新增表**：`prospective`（如上）。
- **复用字段**：surprise 维度新增语义（预测误差），无 schema 变更，仅 reflect 计算逻辑扩展。
- **热路径增量**：检索流程（RFC 0005 第 5 节）的"并行检索"阶段新增一路 **前瞻匹配**：
  ```
  前瞻匹配: q_vec ↔ prospective.cue_vec
    命中固化前瞻 -> 打 pending 标记，纳入融合排序
    无模板但情境高价值 -> 异步触发按需生成（这次可能赶不上，固化供下次）
  ```
  默认热路径**只取固化前瞻**；按需生成异步进行，不阻塞 `<100ms` 返回。仅"高风险情境"可配置为同步等待。

**前瞻匹配走独立通道**：cue 匹配在**全局**前瞻集上进行，**不受领域路由（RFC 0005）约束**。理由——新情境常常跨领域，若把前瞻匹配关进 L1 主领域，恰恰掐死了前瞻"面对新情境"的核心价值。因此 `prospective` 表不按领域分片，`domain_id` 仅作归属标注与 reflect 归并之用。前瞻是与领域路由并列的第二条检索通道，最终结果在融合排序阶段汇合。
- **对外契约不变**：前瞻通过现有 `getRelevantContext` 返回，作为带 `kind=prospective` 标注的上下文项，调用方据此知道这是 AI 建构的预测而非用户事实（原则 1）。

## 跨 SKU 兼容性

- **a 公共云**：前瞻生成（LLM）、验证、修正均在服务端。
- **b E2EE**：按需前瞻生成（LLM 调用）与匹配迁到客户端；服务端只存密文前瞻条目（原则 10）。性能风险见 Drawbacks。
- **c 自托管**：与公共云同。

## 多租户语义

`prospective` 带 `tenant_id` + `user_scope`，严格隔离在 (tenant, user) 边界（原则 9）。前瞻不跨用户。

## 向后兼容

- 纯新增表 + reflect 逻辑扩展，回溯路径不变。
- 迁移 v0.4 → v0.5（与 RFC 0005 同批）：建 `prospective` 表，初始为空；前瞻随 reflect 逐步积累。**零破坏、可渐进启用**。

# Drawbacks

- **热路径成本**：按需生成是 LLM 调用，必须严格异步化，否则击穿延迟预算。
- **误导风险**：低质前瞻可能给调用方错误预测。缓解：confidence + `kind=prospective` 显式标注 + 低置信不返回。
- **不可证伪盲区**：按需生成若不固化则无法进入闭环、无法校准。
- **存储增长**：固化前瞻随情境增多而增长，需 FSRS 衰减回收。
- **E2EE 性能**：客户端做前瞻生成对弱端（移动设备）是负担。

# Alternatives

## 替代 A：纯固化前瞻
- 优：全部可证伪、可进闭环、稳定可解释。
- 劣：只覆盖预演过的情境；人生中大量新情境无前瞻可用；存储压力大。
- **拒绝理由**：覆盖面不足。

## 替代 B：纯按需生成
- 优：覆盖任意新情境、不占存储。
- 劣：结果不稳定（每次可能不同）；无持久条目 → 闭环断裂、无法自我修正；热路径成本高。
- **拒绝理由**：丢失预测-验证闭环——本 RFC 最大价值所在。

## 替代 C：不做前瞻，只扩 procedural
- 优：复用现有层，零新形态。
- 劣：procedural 只承载已稳定习惯，无法表达发散的、情境化的、为未来留白的模拟。
- **拒绝理由**：不解决 Motivation 的核心痛点。

> 最终选择 = A/B 混合（固化 + 按需），与 RFC 0005 渐进固化同构。

# Unresolved Questions

- **按需生成何时同步等待**：仅"高风险情境"同步？"高风险"由谁、依据什么判定？
- **前瞻置信如何呈现给调用方**：阈值、分档、还是连续值？
- **多归属前瞻**：一条前瞻跨多个领域时，cue 匹配与修正如何归并？
- **冷启动**：证据不足时是否允许生成低置信前瞻，还是完全静默？
- **评估**：前瞻命中率怎么量化？需要 eval harness（与 RFC 0005 共用）。
- **反固化（de-crystallization）**：过时的固化前瞻预案如何退场？倾向"敲低表现"（降权 / 衰减 retrievability）而非删除，与 RFC 0005 的反固化方向统一处理。

# Prior Art

- **Schacter & Addis，建构性记忆 / episodic future thinking**：记忆即模拟未来——本 RFC 的认知科学根基（RFC 0001 已引 Schacter）。
- **Predictive processing（Friston 等）**：大脑即预测机器，预测误差驱动学习——闭环第 3 步的理论来源。
- **Conway，SMS（2000）**：自我记忆系统中 correspondence vs coherence 张力。
- **Reinforcement learning，TD error**：预测误差作为学习信号的工程类比。
- mnemos RFC 0004（reflect / FSRS / surprise）：闭环复用的现有零件。

# Implementation Plan（accepted 后填）

- Step 1: 新增 `prospective` 表 + 迁移脚本（初始空）。
- Step 2: 检索流程接入"前瞻匹配"一路（仅固化前瞻，异步副作用记 pending）。
- Step 3: reflect 接入预测-验证：匹配 pending、算 surprise、修正前瞻。
- Step 4: 固化前瞻的离线生成（高频/高风险情境）。
- Step 5: 按需生成 + 验证后回写固化。
- Step 6: eval harness（前瞻命中率/校准）+ E2EE 客户端路径。

预计里程碑：对齐 ROADMAP v0.5，紧随 RFC 0005。

# FAQ

**Q：前瞻会不会把 AI 的猜测当成用户事实存下来？**
A：不会。前瞻恒为 `derived`，依原则 1 永不进 personal_semantic，返回时带 `kind=prospective` 标注。

**Q：按需生成会拖垮 100ms 热路径吗？**
A：默认热路径只取固化前瞻；按需生成严格异步，结果固化供下次。仅高风险情境可配置同步。

**Q：前瞻和 procedural 习惯有何区别？**
A：procedural 是已稳定的习惯；前瞻是面对**新情境**的发散性模拟，且自带预测-验证闭环会被现实校准。

**Q：surprise 同时表示"意外度"和"预测误差"会冲突吗？**
A：不冲突——二者是同一信息论量的两种诠释（实际发生与预期的偏离），共用一个字段、一套衰减/保留逻辑。
