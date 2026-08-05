# 项目资料状态清单

复核日期：2026-08-06

这份清单解决三个问题：哪份资料描述当前产品，哪份只是研究快照，哪份只用于保留历史。出现冲突时，按“当前事实源”列出的顺序判断，不从旧规格反推当前实现。

本次复核覆盖仓库内 59 份 Markdown（含 GitHub 协作模板）、2 份论文 TeX 源码和 2 份许可证文本；第三方依赖、自带文档与本机临时运行数据不计入项目资料。

## 当前事实源

1. 可执行代码、类型与自动化测试；
2. 根 README 和 `docs/` 当前使用文档；
3. SDK README 与 0.7.x 设计基线；
4. 已更新状态的 RFC；
5. 论文、benchmark 与旧 `spec/` 只描述各自冻结时间点。

## 项目与产品文档

| 资料 | 状态 | 说明 |
| --- | --- | --- |
| [README](../README.md) / [English](../README.en.md) | 当前 | 项目首页、产品范围、截图和文档入口 |
| [项目介绍](intro.md) | 当前 | 小丑鱼与记忆 SDK 的边界 |
| [快速开始](getting-started.md) | 当前 | 本机启动和首轮配置 |
| [集成指南](integration-guide.md) | 当前 | 将记忆 SDK 接入其他应用 |
| [架构总览](architecture-overview.md) | 当前 | 已实现结构与数据边界 |
| [运维指南](operator-guide.md) | 当前 | 本机数据、备份、诊断和安全操作 |
| [路线图](../ROADMAP.md) | 当前规划 | 已交付版本与未完成重点，不作为完成证明 |
| [贡献指南](../CONTRIBUTING.md) | 当前 | 开发和验证流程 |
| [安全说明](../SECURITY.md) | 当前 | 安全边界和漏洞报告方式 |
| [治理](../GOVERNANCE.md) / [行为准则](../CODE_OF_CONDUCT.md) | 当前 | 项目治理与协作规则 |
| [许可证](../LICENSE) | 当前法律文本 | Required Notice 已对齐当前仓库地址 |

## 小丑鱼应用设计

| 资料 | 状态 | 说明 |
| --- | --- | --- |
| [小丑鱼使用说明](../sdk/typescript/examples/companion/README.md) | 当前 | 应用版本、运行、构建和数据目录 |
| [产品设计基线](../sdk/typescript/examples/companion/docs/clownfish-product-design-brief.md) | 当前 | 用户路径和界面原则 |
| [产品语言](../sdk/typescript/examples/companion/docs/clownfish-product-language.md) | 当前 | 名称、状态和用户可见文案 |
| [能力地图](../sdk/typescript/examples/companion/docs/clownfish-capability-map.md) | 当前 | 用户能力与内部执行映射 |
| [能力中心](../sdk/typescript/examples/companion/docs/capability-center-design.md) | 当前 | 能力启动和任务交付流程 |
| [能力记忆](../sdk/typescript/examples/companion/docs/capability-center-memory-design.md) | 当前 | 习惯、格式与能力上下文边界 |
| [能力执行系统](../sdk/typescript/examples/companion/docs/capability-os-design.md) | 当前 | 聊天、能力、文件和任务共享的执行事实 |
| [Agent Runtime](../sdk/typescript/examples/companion/docs/agent-runtime-design.md) | 当前 | 工具、权限、恢复、MCP 和专家协作边界 |

## 记忆 SDK

| 资料 | 状态 | 说明 |
| --- | --- | --- |
| [SDK 中文说明](../sdk/typescript/README.md) / [English](../sdk/typescript/README.en.md) | 当前 | `0.7.5-alpha.17` 公开接口 |
| [0.7.x 设计基线](../sdk/typescript/docs/nemos-memory-v0.7-design.md) | 当前设计 | 区分已实现主链路与尚未闭环边界 |
| [CHANGELOG](../sdk/typescript/CHANGELOG.md) | 发布记录 | 只记录版本变化；没有原始产物的评测数字不作复现门槛 |
| [SDK 示例](../sdk/typescript/examples/) | 当前示例 | 已统一标注适用版本；旧版本号表示能力最初引入时间 |

## 论文与评测

| 资料 | 状态 | 说明 |
| --- | --- | --- |
| [论文资料入口](../paper/README.md) | 冻结研究快照 | 论文边界、文件清单和隐私要求 |
| [英文论文](../paper/main.pdf) / [中文论文](../paper/main-zh.pdf) | 工作草稿 | 尚未同行评审；不代表当前 SDK 总体性能 |
| [编译说明](../paper/BUILD.md) | 当前 | 从源码重建和视觉核验 |
| [arXiv 检查](../paper/ARXIV_SUBMIT.md) | 当前 | 官方流程、准确摘要和投稿前检查 |
| [MnemoBench](../bench/README.md) | 冻结研究快照 | BUC、ASP、FOR 的实际运行入口 |
| [评测设计](../bench/DESIGN.md) | 冻结研究设计 | 实际样本数、指标和有效性威胁 |
| [结果 manifest](../bench/results/manifest.json) | 冻结证据 | 结果文件、提交版本、日期和 SHA-256 |

## RFC 与历史规范

| 资料 | 状态 | 说明 |
| --- | --- | --- |
| [RFC 索引](../rfcs/README.md) | 决策记录 | 已区分 implemented、draft 和剩余优化 |
| RFC 0001—0008 | 历史决策 | 解释为什么这样设计，不覆盖当前代码事实 |
| [v0.1 规范归档](../spec/README.md) | 归档 | REST、MCP、Python 和云端早期推演，不是当前契约 |

## 更新规则

- 产品行为变化时，同时更新对应 README、设计基线和测试。
- 发布 SDK 时更新包版本、SDK README 和 CHANGELOG。
- 论文数字变化时新增结果文件并更新 manifest，不覆盖旧实验来源。
- RFC 只有在核心方案真正落地后才改为 `implemented`。
- 旧规格保留历史原文，只加醒目的归档说明，避免把历史改写成当前事实。
