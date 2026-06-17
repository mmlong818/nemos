# Getting Started

> **Status**: Pre-Alpha — 引用实现待 Round 2 落地。本文档目前是占位 + 未来章节大纲。

---

## 目前能做什么（Round 1 完成时）

- 阅读 [`spec/`](../spec/) 了解 Nemos 协议设计
- 阅读 [RFC 0001](../rfcs/0001-nemos-design-principles.md) 理解核心设计原则
- 在 issue 提反馈、提议新 RFC
- Star + Watch 跟踪进度

## 还不能做什么（等 Round 2）

- 跑一个真实的 Nemos server
- 用 SDK 集成到你的 AI 应用
- 测试 MCP server 接入

---

## 未来章节大纲（Round 2+ 完成后填）

### 5 分钟 Quickstart

待 self-host binary 发布后补：
- `nemos init` 创建配置
- `nemos serve` 启动
- 用 curl 写第一条 memory
- 用 SDK 读出来

### Self-host 完整 setup

- 系统要求
- 配置 walkthrough
- 数据迁移自其他工具

### Cloud signup

待引用云上线后：
- 注册 / 验证邮箱
- 生成 API key
- AI app 集成首步

### SDK example

`packages/sdk-typescript/examples/` 和 `packages/sdk-python/examples/` 待 SDK 实施后补真实运行样例。

### MCP server setup

Claude Code / Cursor / 其他 MCP client 的配置 snippet 待 mcp-server 实施后补。

### 跨 SKU 迁移

从 a → b → c 或反向，待迁移工具落地后补。

---

## 现阶段最有价值的参与

如果你想现在就深度参与：

1. **读 spec 和 RFC**，反馈设计层问题
2. **提 RFC 提议**新原则或修改现有原则（走 [rfcs/](../rfcs/) 流程）
3. **share 你的集成需求**——你打算把 Nemos 集成进什么 AI 应用？什么 persona？开 issue 让我们知道
4. **报告 spec 内部矛盾**——75 份研究合流可能有遗漏的矛盾，找到一处就开 issue
5. **翻译**（如果你愿意）—— RFC 0001 + architecture-overview 的英文版尤其需要

---

## 不确定从哪开始？

开一个 GitHub issue 自我介绍：
- 你想用 Nemos 解决什么
- 你能贡献什么类型（设计 / 代码 / 文档 / 用户研究）
- 你期待 Round 2 优先看到什么
