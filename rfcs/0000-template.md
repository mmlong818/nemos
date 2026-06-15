---
rfc_number: 0000
title: <RFC title>
authors:
  - <name or github handle>
status: draft
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
discussion_url: <PR URL>
implementation_pr: <if accepted, PR URL>
supersedes: []
superseded_by: <if applicable>
---

# Summary

一段话（≤ 100 字）讲清楚本 RFC 要做什么。

# Motivation

为什么要做这件事？不做会怎样？

- 目前的现状
- 现状的痛点 / 限制
- 本 RFC 解决的具体问题
- 与 nemos 设计原则（见 RFC 0001）的关系

# Detailed Design

具体到可以被直接实施的程度。

## Schema / API / 协议变更

如适用，给出：
- 新增 / 修改 / 删除的字段名 + 类型
- 新增 / 修改 / 删除的端点或方法签名
- 错误模型变化
- 默认值与边界

## 跨 SKU 兼容性

每个 SKU（a 公共云 / b E2EE / c 自托管）下本变更如何工作？

## 多租户语义

本变更是否影响 tenant 隔离？scope 边界？

## 向后兼容

- 已部署实例的迁移路径
- Schema version bump 是否需要
- 弃用窗口

# Drawbacks

诚实列出代价：
- 性能影响
- 复杂度增加
- 维护负担
- 学习曲线
- 与既有用法的冲突

# Alternatives

至少 2 个其他方案。每个方案给出：
- 简述
- 优点
- 缺点
- 为什么本 RFC 没选它

# Unresolved Questions

留作未决的子问题（实施期间通过 issue / 后续 RFC 解决）。

# Prior Art

参考的外部资料：
- 类似 OSS 项目（mem0 / Letta / Memory-Palace 等）的做法
- 学术论文
- 行业规范

# Implementation Plan（accepted 后填）

- Step 1: ...
- Step 2: ...
- Step N: ...

预计工时 / 里程碑。

# FAQ

预期常见疑问 + 答复。
