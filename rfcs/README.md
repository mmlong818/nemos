# Nemos RFC

RFC（Request for Comments）用于记录影响公开接口、数据模型、安全边界或长期兼容性的设计决策。

当前接口以 SDK 类型、README、测试和发布记录为准；RFC 解释决策背景和演进方向。

## 需要 RFC 的变化

| 变更 | 要求 |
| --- | --- |
| 破坏性 Schema 变化 | 迁移路径、兼容性测试和回滚说明 |
| 公开 API 或协议变化 | 接口设计、替代方案和升级影响 |
| 新存储层或核心生命周期 | 数据边界、失败模式和验证方法 |
| 用户隔离、权限或安全边界 | 威胁分析和回归测试 |
| 许可证或治理变化 | 影响说明和维护者明确批准 |

Bug 修复、文档勘误、向后兼容的小功能、测试和翻译通常可以直接通过 Issue 或 PR 讨论。

## 流程

1. 通过 Issue 描述问题、目标和约束；
2. 复制 [RFC 模板](0000-template.md)；
3. 提交设计、替代方案、风险和未决问题；
4. 根据评审意见修订；
5. 接受后分配正式编号并合并；
6. 实现完成后更新状态和关联资料。

讨论时间根据影响范围决定，不使用固定时长代替实际评审。

## 状态

- `draft`：讨论中；
- `accepted`：设计已接受，尚未完全实现；
- `implemented`：核心方案已实现；
- `withdrawn`：提案已撤回；
- `superseded`：已被后续 RFC 替代；
- `deferred`：保留但暂不推进。

## 编写要求

RFC 至少包含：

- Motivation：需要解决的问题；
- Detailed Design：数据、接口和行为；
- Security and Privacy：权限与数据影响；
- Drawbacks：代价和限制；
- Alternatives：其他可行方案；
- Compatibility：迁移和回滚；
- Unresolved Questions：尚未决定的事项。

## 现有 RFC

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [0001](0001-nemos-design-principles.md) | Nemos Design Principles | accepted |
| [0002](0002-scenario-profiles-and-content-awareness.md) | Scenario Profiles & Content Awareness | implemented |
| [0003](0003-production-pipeline.md) | Production Pipeline | implemented |
| [0004](0004-forgetting-and-consolidation.md) | Forgetting & Consolidation | implemented |
| [0005](0005-domain-experts-and-sparse-activation-routing.md) | Domain Experts & Sparse Activation Routing | implemented |
| [0006](0006-prospective-memory-and-prediction-verification-loop.md) | Prospective Memory & Prediction-Verification Loop | draft |
| [0007](0007-bitemporal-validity-and-invalidation.md) | Bi-Temporal Validity & Invalidation Semantics | implemented |
| [0008](0008-companion-memory-topology.md) | Multi-Role Memory Visibility and Self-State Isolation | implemented |
