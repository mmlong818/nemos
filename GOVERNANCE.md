# Governance

nemos 的决策、维护、与社区治理模型。

---

## 当前阶段：BDFL（2026-06-04 起）

项目处于 Pre-Alpha。当前阶段由作者（BDFL，Benevolent Dictator For Life）做最终决策，但所有重大决定走 RFC 公开讨论。

## 阶段演化路径

| 阶段 | 触发条件 | 治理模型 |
|---|---|---|
| **Pre-Alpha** | 当前（无生产部署） | BDFL，所有重大决策 RFC 公开 |
| **Alpha** | 首个引用实现 + 5 个外部 contributor | BDFL + 1-2 个 core maintainer |
| **Beta（~10k DAU 触发）** | 引用云 / SDK 被生产使用 | Core maintainer 团队（3-5 人）+ RFC review committee |
| **GA（~100k DAU 触发）** | 多生产部署 / 多语言 SDK 稳定 | 考虑独立基金会（Linux Foundation / OpenJS / 自建） |
| **商业衍生（如发生）** | 引用云规模运营所需 | 商业实体与 OSS 项目治理分离；OSS 不被商业反向锁定 |

## 决策类型与所需流程

| 决策类型 | 流程 |
|---|---|
| Bug fix / 非破坏性新增 | 直接 PR |
| 文档改进 | 直接 PR |
| Schema 字段添加 | RFC（轻量）+ 14 天讨论 |
| Schema 破坏性变更 | RFC + 30 天讨论 + 迁移路径必备 |
| 协议变更（REST/MCP/SDK 任一） | RFC + 30 天讨论 |
| 新接入面 / 新 SKU | RFC + 30 天讨论 |
| License 变更 | RFC + 60 天讨论 + **所有现存 contributor 同意** |
| Governance 变更（本文件） | RFC + 60 天讨论 |
| 商业化决策（如成立商业实体、引用云收费） | RFC + 60 天讨论 + 不可单方面决策 |

RFC 流程详见 [`rfcs/README.md`](rfcs/README.md)。

## Core Maintainer 准入

Beta 阶段后，Core Maintainer 的加入：
- 提名：现有 maintainer 或 BDFL
- 标准：至少 3 个 substantive PR / RFC contribution，且体现项目价值观
- 决策：现有 maintainer 多数 + BDFL 不反对

## Conflict Resolution

技术决策无共识时：
1. 优先寻找数据 / 引用实现 / 实测验证
2. 若仍无解，BDFL 决策（Pre-Alpha/Alpha 阶段）或 Core Maintainer 投票（Beta+ 阶段）
3. 所有决策必须在 RFC 留下书面理由

## 利益冲突声明

任何 maintainer 在做出可能影响其个人/雇主商业利益的决策时，必须在 RFC 中披露。

## 商业化承诺（Pre-Alpha 阶段锁定）

- nemos 协议 + 引用实现 + 默认 SDK：**永久 Apache-2.0 OSS**
- 引用云（cloud SKU a）：可能由作者/社区/第三方运营，运营方式不影响 OSS 部分
- 任何商业衍生必须经过 60 天 RFC 公开讨论
- 不接受任何包含"OSS 部分被商业版本反向蚕食"条款的资金来源

## 联系

- 治理问题：开 issue 或 RFC
- 维护者直接联系：`<maintainer-email-placeholder>`
