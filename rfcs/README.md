# nemos RFCs

> RFC（Request for Comments）是 nemos 重大变更的公开讨论与归档流程。
> 灵感来自 Rust RFC、Python PEP、Kubernetes KEP。

---

## 什么时候必须写 RFC

| 变更类型 | RFC 必需 | 备注 |
|---|---|---|
| Schema 破坏性变更 | ✅ | 必须含迁移路径 |
| 协议（REST / MCP / SDK contract）变更 | ✅ | |
| 新接入面 / 新 SKU | ✅ | |
| 新核心能力（如新存储层） | ✅ | |
| License 变更 | ✅ | 60 天 + 现存 contributor 全员同意 |
| Governance 变更 | ✅ | 60 天讨论 |
| 商业化决策 | ✅ | 60 天讨论 |
| 默认依赖变更（如换 vector DB） | ✅ | 影响所有 SKU |

## 什么时候不需要 RFC

| 变更类型 | 直接 PR 即可 |
|---|---|
| Bug fix | ✅ |
| 文档勘误 / 补充 | ✅ |
| Schema 字段新增（向后兼容） | 轻量讨论 issue 即可 |
| 性能优化（不改 API） | ✅ |
| 测试覆盖 | ✅ |
| 翻译 | ✅ |

不确定？先开 issue 问，maintainer 会判断是否需要升级为 RFC。

---

## RFC 流程

```
1. 想法 / Issue 讨论
        ↓
2. 复制 0000-template.md 到 0000-<slug>.md（保持 0000 编号占位）
        ↓
3. 提交 PR：rfc/<slug>
        ↓
4. 公开讨论期（轻量 14d / 重大 30d / 治理 60d）
        ↓
5. Maintainer 决策：
   - Accept   → 分配正式编号 → merge 进 main → 状态 accepted
   - Withdraw → close PR     → 归档 withdrawn/
   - Defer    → 留 PR open   → 进入 deferred
        ↓
6. （Accepted 后）实施 PR 关联本 RFC
        ↓
7. 实施完成 → 更新 RFC 状态为 implemented
```

## 编号规则

- `0000-template.md`：模板，永不分配
- `0001` 起按 accepted 顺序递增
- Withdrawn 的 RFC 保留编号，避免后续编号混淆
- Deferred 的 RFC 保留编号

## 状态

- `draft` — PR open，公开讨论中
- `accepted` — merge 进 main，未实施
- `implemented` — 已实施
- `withdrawn` — 提案人或 maintainer 撤回
- `superseded` — 被后续 RFC 替代（必须标 superseded-by）
- `deferred` — 不否定但暂不推进

## 编写规范

参考 `0000-template.md`。要点：
- **Motivation 必写**：为什么必须做这件事，不做会怎样
- **Detailed Design**：具体到 schema 字段 / API 签名 / 协议消息
- **Drawbacks**：诚实列出代价
- **Alternatives**：至少 2 个其他方案 + 为什么本方案胜出
- **Unresolved questions**：明示哪些子问题留作未决

---

## 现有 RFCs

| 编号 | 标题 | 状态 |
|---|---|---|
| 0001 | nemos Design Principles | accepted（founding document） |
| 0002 | Scenario Profiles & Content Awareness | accepted |
| 0003 | Production Pipeline | accepted |
| 0004 | Forgetting & Consolidation | accepted |
| 0005 | Domain Experts & Sparse Activation Routing | draft |
| 0006 | Prospective Memory & Prediction-Verification Loop | draft |
