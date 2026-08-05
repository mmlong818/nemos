---
rfc_number: 0008
title: Multi-Role Memory Visibility and Self-State Isolation
authors:
  - Nemos contributors
status: implemented
created_at: 2026-06-20
updated_at: 2026-08-06
discussion_url: ""
implementation_pr: ""
supersedes: []
---

# Summary

本 RFC 定义多角色应用中的记忆可见性与状态隔离规则：

- 一个用户的事实只保存在该用户的记忆空间；
- 会话 `scope` 决定角色可以读取哪些用户记忆；
- 角色自身状态存放在独立命名空间；
- 已失效事实默认不参与回复；
- 用户事实、角色状态和运行审计保持不同信任边界。

当前小丑鱼使用“小丑鱼 + 按需专家”的产品结构，不依赖固定角色命名；本 RFC 的隔离原则仍适用于聊天、专家协作和群组场景。

# Motivation

当一个用户与多个角色或专家交互时，需要明确回答以下问题：

1. 用户事实是否在不同角色之间复制；
2. 私聊和群聊中的信息对哪些角色可见；
3. 角色生成的自我描述存放在哪里；
4. 用户事实变化后，旧事实如何停止参与回复。

如果缺少统一约定，不同场景会形成互不一致的记忆副本，也可能把模型生成内容误写为用户事实。

# Decision

## 1. 用户事实保持单一

关于用户的事实存入 `forUser(userId)`。不同角色不各自复制一份用户事实。

这样可以让纠正、失效和审计作用于同一事实空间，避免同一信息在不同角色中出现不一致状态。

## 2. 会话范围决定可见性

每段对话使用独立 `scope`。角色回复时，只检索其参与过的会话范围：

```ts
await nemos.forUser(userId).search(query, {
  scopes: visibleScopes,
});
```

- 私聊内容只对参与该私聊的角色可见；
- 群聊内容对当时参与群聊的角色可见；
- 未参与对应会话的角色不能通过普通检索读取其内容。

角色与会话的成员关系由应用层维护，记忆记录只保存会话范围。

## 3. 角色自身状态独立存放

角色或专家的自我描述、工作状态和模型生成背景写入独立命名空间，例如：

```ts
nemos.forUser("persona:<id>")
```

这些内容不能写入用户事实空间，也不能被标记为用户权威陈述。

## 4. 上下文分块组装

回复上下文至少区分两个来源：

```text
[用户事实]
来自用户记忆空间，只包含当前可见且有效的事实。

[角色状态]
来自角色独立命名空间，不能作为用户事实引用。
```

两类内容在读取、标注和写回时保持分离。

## 5. 默认过滤失效事实

用户事实检索默认只返回当前有效、当前采信的记录：

```sql
valid_at <= now
AND (invalid_at IS NULL OR invalid_at > now)
AND expired_at IS NULL
AND belief_state = 'active'
```

用户说明事实已经变化时，新记录可以使旧记录进入 `invalidated` 状态。模型推断不能自动使权威用户事实失效，只能提出待确认变更。

## 6. 记忆保留

普通经历可以按衰减策略降低召回优先级。高显著性内容可以提高稳定性或进入长期层，但仍需保留来源、时间和权威性标记。

衰减控制“是否容易被召回”，失效控制“是否仍被视为有效事实”，两者不能混用。

# Data Mapping

| 实体 | 存储映射 | 说明 |
| --- | --- | --- |
| 用户 | `forUser(userId)` | 用户事实与会话记录 |
| 角色或专家 | `forUser("persona:<id>")` | 角色自身状态 |
| 会话 | `scope = "conv:<id>"` | 可见性边界 |
| 内容来源 | `source.origin_agent` | 用户、角色或系统来源 |
| 场景 | `scenario` | 私聊、群聊或任务类型 |

# Security Properties

- 用户和角色使用不同命名空间；
- 跨角色可见性必须经过 `scope` 过滤；
- 跨用户检索和失效操作被禁止；
- 模型生成内容不能取得用户权威来源标记；
- 检索默认隐藏已失效记录；
- 审计接口可以显式请求历史状态，但普通回复不能使用该模式。

`scope` 是关系级可见性边界，不替代用户和租户的硬隔离。相关过滤应覆盖越权检索、范围注入和群聊成员变化测试。

# Compatibility

本 RFC 复用现有字段和接口，不要求破坏性 Schema 变更：

- `forUser`
- `scope` / `scopes`
- `origin_agent`
- `scenario`
- `belief_state`
- `invalid_at` / `expired_at`
- `authoritative`

关系级可见性当前由应用层维护。未来如引入“角色在何时获知某条事实”的关系边，需要单独 RFC。

# Alternatives

## 每个角色复制一份用户事实

优点是隔离直接；缺点是同一事实会形成多份副本，纠正和失效难以保持一致。因此不采用。

## 所有角色共享全部用户记忆

实现简单，但无法表达私聊、群聊和关系边界，也会扩大不必要的数据可见范围。因此不采用。

## 用户事实加关系边

这种方式可以精确记录角色何时、通过哪段会话获知某条事实，但需要额外数据结构和查询成本。当前保留为后续扩展方向。

# Implementation Status

已实现：

- 用户、角色和租户命名空间隔离；
- 基于 `scope` 的检索过滤；
- `origin_agent` 与 `scenario` 标记；
- 用户事实与角色状态分块组装；
- 已失效事实的默认过滤；
- 相关接口与回归测试。

仍需持续验证：

- 群聊成员变化后的可见性；
- 多来源事实的范围合并；
- 长期运行中的角色状态一致性；
- 关系级过滤的安全回归。

# Related Decisions

- [RFC 0004](0004-forgetting-and-consolidation.md)：衰减与巩固；
- [RFC 0007](0007-bitemporal-validity-and-invalidation.md)：有效时间与事实失效；
- [RFC 0002](0002-scenario-profiles-and-content-awareness.md)：场景配置。
