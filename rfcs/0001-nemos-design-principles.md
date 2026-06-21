---
rfc_number: 0001
title: Nemos Design Principles
authors:
  - nemos founding team
status: accepted
created_at: 2026-06-04
updated_at: 2026-06-04
discussion_url: founding document
implementation_pr: spec/* (Round 1)
supersedes: []
---

# Summary

Nemos 的核心设计原则。本 RFC 作为 founding document，任何后续 RFC 都必须与本文档兼容；与本文档冲突的 RFC 必须显式声明并经 60 天 governance 流程。

# Motivation

Nemos 来自 75 份研究 + ECC v2 v0 dogfood 验证。本 RFC 把那些研究产出固化为可被后续工作引用的原则集合。没有 founding document，后续 RFC 会重复辩论已有共识，浪费时间且可能漂移。

# Detailed Design

## 原则 1：AI 是仆人，不是代理（servant not agent）

**陈述**：Nemos 是 AI 应用的工具。所有 AI 推断的内容必须可追溯为"AI 推断"，不能伪装成用户陈述。

**工程含义**：
- 每条 memory 强制 `source.authoritative: bool`
- AI 推断 (`derived`) 永远不能直接进入 personal-semantic 层
- 所有 LLM 生成的内容标 `chain_depth >= 1`

**反对的反例**：把 LLM summary 当作 user fact 存回——这是 misattribution sin（Schacter 2001）的工程级放大。

## 原则 2：分层存储，分通道处理

**陈述**：episodic / semantic / personal-semantic / procedural / archival 五层独立存储，各自有写入规则、检索规则、衰减规则、ownership 规则。

**工程含义**：不可用单一 vector DB 模拟所有层。

**理由**：CLS（complementary learning systems，McClelland et al. 1995）启示——快层与慢层必须分离，否则灾难性遗忘。Tulving 解离案例（K.C.）显示 episodic 与 semantic 在病理学上可独立失能。

## 原则 3：默认衰减 + 显式保留信号

**陈述**：所有 memory 默认指数衰减。保留是 exception，需要触发信号（R1-R12，见 universal-substrate spec）。

**工程含义**：
- 不是"全部记住"——这是 Funes 病理（Borges 1942）
- FSRS 三参数管理 stability
- 12 类保留信号 day-1 必现

**反对的反例**：ADD-only 系统（mem0 等）在长程上失败。

## 原则 4：Immutable archive + 可变解释层

**陈述**：原始事件永不被覆盖。任何修订是叠加新版本，原始可被回溯。

**工程含义**：
- 每条 memory `{original_id, interpretation_ids[]}`
- archival 只允许 append + burn（GDPR）
- 用户可"回到上周二的我"

**理由**：reconsolidation（Nader et al.）显示记忆每次提取都被改写——这是生物现实但工程上可控。Conway coherence vs correspondence 张力（Conway 2000）需要双层保留。

## 原则 5：三维元数据（source / arousal / surprise）

**陈述**：每条 memory 强制带 source / arousal / surprise 三维元数据。

**工程含义**：source 防 AI 自污染 + arousal 驱保留与触发回避 + surprise 驱信息论判据（高 -log p 优先）。

## 原则 6：关系类记忆是关系契约，不是个人资产

**陈述**：每条 memory 强制 `ownership: self | relational | public`。relational 记忆走独立 store，跨 user 共享需 principal 同意。

**理由**：Halbwachs 集体记忆 + Levinas 他者伦理——对他人的记忆不是单方面财产。

## 原则 7：跨厂商可移植是伦理底线

**陈述**：任何 SKU 必须支持完整的 JSON-LD + Markdown 双轨 export。用户的记忆是用户的，不被任何厂商锁定。

**工程含义**：
- 协议 spec 公开（本 repo）
- export schema 不依赖任何专有索引
- 自托管 SKU 永远是 first-class，不被故意 cripple

## 原则 8：系统级查询，AI 应用是客户

**陈述**：Nemos 不直接服务终端用户。客户是 AI 应用。查询完全由 AI 应用触发，按 AI 集成模式优化（hot-path 单查 < 100ms / session-start bulk < 2s / reflect 30s 可接受）。

**工程含义**：不需要为终端用户做搜索 UI；但需要审计/编辑/导出 UI（用户主权要求）。

## 原则 9：多租户 day-1 设计

**陈述**：即便 v0 是单机自托管，schema 与 API 在 day-1 就支持 tenant_id 字段，避免后期破坏性迁移。

## 原则 10：E2EE 字段级标注

**陈述**：每个字段在 schema 层标注 `e2ee_visibility: server | client_only`。E2EE SKU 下服务端不可见的字段必须在客户端处理（索引、计算）。

**工程含义**：协议设计同时考虑 server-side 和 client-side 工作分担；某些功能（如某些 surprise 计算）在 E2EE SKU 下迁到客户端。

## 原则 11：死后默认 archive-only

**陈述**：账户停用或死亡证明触发，AI 立刻不得以用户身份发言或写新 memory。

**反对的反例**：让 AI 在用户死后"扮演"用户——破坏哀悼、稀释真实形象、用户无法监督质量。

## 原则 12：完全开源 + PolyForm Noncommercial（禁止商用）

**陈述**：Nemos spec + 引用实现 + 默认 SDK 永远 PolyForm Noncommercial 1.0.0（source-available，禁止商用）。任何人可自由用于非商业用途、做自己的版本；商业用途需另行授权。商业衍生与社区版治理分离，不允许商业版本反向蚕食社区版。

# Drawbacks

- 11 条原则的严格执行会**拒绝某些 feature**（如全屏录制、AI 自动定义用户）。这是 trade-off，但是底线 trade-off。
- 多 SKU 设计（公共云 / E2EE / 自托管）增加复杂度。
- 多租户 day-1 增加 schema 复杂度，自托管单用户场景看似过度设计。

# Alternatives

## 替代 A：合并 5 层为单一 store
- 优：实施简单
- 劣：违反 CLS 启示，长程会有混乱（已被 mem0/Memori 等单层方案验证）
- **拒绝理由**：原则 2 不可妥协

## 替代 B：不强制 source 标签
- 优：简化集成
- 劣：AI 自污染不可控（Schacter misattribution 的工程级放大）
- **拒绝理由**：原则 1 不可妥协

## 替代 C：单一 SKU（仅公共云 / 仅自托管）
- 优：工程量小
- 劣：要么牺牲隐私（仅云）要么牺牲规模（仅自托管）
- **拒绝理由**：12 个原则需要 3 SKU 才能完整

# Unresolved Questions

- 12 条原则在实践中是否出现新冲突？目前没有，但实施可能揭示
- 多 SKU 之间的迁移路径在某些边界情况是否真的无损？
- 原则 11（死后只读）的法律实施细节因地区而异

# Prior Art

- ECC v2 v0 dogfood：本 RFC 的 12 条原则全部在 ECC personal upgrade 上验证过最小可行性
- memory-research 75 份研究：见 `../memory-research/_meta/round-3-synthesis.md`
- 学术：CLS（McClelland 1995）、Conway SMS（2000）、Tulving（1972/2002）、Schacter 7 sins（2001）、Borges Funes（1942）
- 工程：Hindsight (MIT)、Memory-Palace、agentmemory(rohit) — 见 `../memory-research/01-github-survey/_summary.md`

# FAQ

**Q：为什么不允许将来某条原则被推翻？**
A：可以推翻，但必须走 60 天 governance RFC + 现存 contributor 全员讨论。门槛高，但不是不可能。

**Q：原则 12 排除了"以后做商业 SaaS"吗？**
A：不排除。但商业 SaaS 是社区版之外的衍生，需另行商业授权；社区版部分永远 PolyForm Noncommercial 1.0.0（禁止商用）。

**Q：原则 1（AI 不是代理）会不会阻止做"AI 自动管理 memory"？**
A：不会。AI 可以管理（reflect / 衰减 / 巩固），但管理产物必标 `derived`，永不被冒充为用户陈述。
