# Nemos 架构总览

5 分钟读完。如需详细 spec，参考 [`../spec/`](../spec/)。

---

## Nemos 是什么

一个开源 personal memory infrastructure，让任何 AI 应用（Claude Code、Cursor、ChatGPT、自定义 agent）能跨 session / 跨工具持有"关于用户的同一个我"，同时用户对自己的 AI 记忆保有审计、纠正、删除、迁移的主权。

## 不是什么

- ❌ 不是 vector DB（虽然内部用了 pgvector / hnswlib）
- ❌ 不是 RAG 框架
- ❌ 不是用户面向的 app（用户不直接打开 Nemos）
- ❌ 不是单纯的 AI app（是 AI app 的底层）

## 三个 SKU（部署形态）

```
┌────────────────────────────────────────────────┐
│  SKU a · 公共云（默认）                         │
│  服务端加密；多租户；社区/作者运营小规模引用云  │
├────────────────────────────────────────────────┤
│  SKU b · E2EE 付费云                            │
│  客户端加密；服务端只见密文；索引在客户端       │
├────────────────────────────────────────────────┤
│  SKU c · 自托管                                 │
│  Go single-binary + SQLite + sqlite-vec        │
│  适合技术用户 / 数据敏感场景                    │
└────────────────────────────────────────────────┘
```

## 三个接入面（AI 应用）

```
AI 应用 ──┬──→ SDK（npm/pip）        最低延迟，in-process
          ├──→ MCP Server            标准 MCP 协议接入
          └──→ REST API              任何语言任何工具 fallback
                  ↓
                nemos core
                  ↓
            ┌─────┴─────┐
            ↓           ↓
      Storage Stack   Index Stack
      (PG / SQLite)   (pgvector / hnswlib)
```

## 数据流（典型 hot-path）

```
[用户发消息] → [AI 应用]
                  ↓ SDK.query(scope, top_k)
                [nemos.get_relevant_memories()]
                  ↓ hot-path P50 < 100ms
                [PG + pgvector / 客户端 hnswlib (E2EE)]
                  ↓ top-k 含 metadata
                [AI 应用消化，回应用户]
                  ↓ session 结束 / reflect 触发
                [nemos.write_new_memory(source: derived)]
                  ↓ contradiction check
                [新条目入 episodic + 触发衰减/重排]
```

## 五层存储（核心数据模型）

```
┌─────────────────┐  写入快，遗忘快
│  Episodic       │  事件、对话、瞬间观察
├─────────────────┤
│  Semantic       │  从 episodic 抽出的事实
├─────────────────┤
│  Personal Sem.  │  关于用户的事实（偏好、关系、技能）
├─────────────────┤  authoritative-only zone
│  Procedural     │  工作流、行为模式
├─────────────────┤
│  Archival       │  immutable，append-only，永不覆盖
└─────────────────┘  写入慢，遗忘极慢
```

关键不变量：
- **derived 不能进 Personal Semantic**（防 AI 自污染）
- **archival immutable**（防 reflect 覆盖历史）
- **每层独立衰减规则**

## 三维元数据（每条 memory 强制）

- `source.authoritative: bool` — 用户陈述 / AI 推断
- `arousal: {value, signal_sources}` — 情绪强度代理信号
- `surprise: {value, basis}` — Shannon -log p 信息量

## 关系字段（双向链）

- `corrects` / `corrected_by` — 错误标注，always vs context-specific
- `related` — 相关但不互纠
- `ownership: self | relational | public` — 关系类记忆走独立 store

## 与现有方案的差异

| 维度 | mem0 / Letta | Graphiti / Zep | OpenRecall | **Nemos** |
|---|---|---|---|---|
| 抽象层级 | 单层 fact | KG + temporal | 全屏录制 | 5 层分离 |
| 防 AI 自污染 | 弱 | 部分 | 无 | **强制 source 标签** |
| 遗忘策略 | ADD-only | invalidate | 无 | **默认衰减 + 12 信号** |
| 多 agent 共享 | 部分 | 部分 | 无 | **Manifest + Capability Registry** |
| 跨厂商 export | 弱 | 部分 | 无 | **JSON-LD + Markdown 双轨** |
| E2EE 选项 | 无 | 无 | 本地 | **SKU b 一等公民** |
| OSS 治理 | 公司主导 | 公司主导 | 个人 | **BDFL → 基金会路径** |

详细对比见 RFC 0001 § Prior Art。

## 设计原则（一句话每条）

完整 12 条见 [`../rfcs/0001-nemos-design-principles.md`](../rfcs/0001-nemos-design-principles.md)。

1. AI 是仆人不是代理
2. 分层存储分通道处理
3. 默认衰减 + 显式保留信号
4. Immutable archive + 可变解释层
5. 三维元数据强制
6. 关系类记忆是契约不是资产
7. 跨厂商可移植是伦理底线
8. 系统级查询，AI 应用是客户
9. 多租户 day-1 设计
10. E2EE 字段级标注
11. 死后默认 archive-only
12. 完全开源 Apache-2.0

## Round 2 启动前 Nemos 还需要的决策（agent-v2r1b handoff）

本 task 范围之外但 Round 2 前必须定：

1. **CI/CD 选型**：GitHub Actions / GitLab CI / 自托管？影响 PR 验证速度
2. **文档生成器**：mdBook / Docusaurus / VitePress？影响 docs/ 长期组织
3. **国际化策略**：spec 中英双语 / 仅英语 / 全本地化？OSS 国际化早决定省事
4. **CLA vs DCO**：本项目用 DCO 已决；但若将来收赞助方代码贡献，是否需要 CCLA？
5. **品牌/视觉**：logo / 站点 / 颜色——影响 0.x → 1.0 阶段的社区认知

这 5 个建议在 Round 2 启动前用 5 个轻量 issue / mini-RFC 解决。
