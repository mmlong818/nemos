# Nemos v0.1 — 规范总览 (00-overview)

> **状态**：Draft，Round 1 输出
> **版本**：v0.1
> **更新**：2026-06-04
> **License**：Apache-2.0

本文件是 Nemos 协议族的入口。它定义了 Nemos 是什么、不是什么，以及读完接下来 4 份规范前必须先知道的不变量。

---

## 1. Nemos 是什么

**Nemos 是 AI 应用的多租户个人记忆基础设施**。

具体来说：
- 它为每个用户在多 AI 应用环境下提供"同一个我"——Cursor / Claude Code / ChatGPT / Notion AI / 任意 MCP-兼容 client 看到的是同一份、用户可审计的记忆库
- 它把记忆按 5 层独立存储（episodic / semantic / personal-semantic / procedural / archival），强制三维元数据（source / arousal / surprise），强制衰减 + 显式保留信号
- 它把"AI 推断的事实"和"用户陈述的事实"在 schema 层物理隔离，防止 AI 自污染
- 它把"记忆"按 ownership 三分（self / relational / public），把"关系类记忆"当作多方契约管理
- 它把用户的导出权当作产品伦理底线——任何 Nemos 部署的数据可在 30 分钟内导出成 JSON-LD + Markdown 双轨格式，跨厂商可移植

它由三个协议层组成：
1. **数据 Schema**（见 `10-data-schema.md`）—— Nemos 协议的核心。所有部署、所有 SKU 共享同一份 schema
2. **REST API**（见 `20-rest-api.md`）—— 标准化网络接入面
3. **MCP Server**（见 `30-mcp-server.md`）—— 与 AI app 集成的优先入口
4. **SDK**（见 `40-sdk-contract.md`）—— 开发者直接 import 用的客户端契约

## 2. Nemos 不是什么

| 不是 | 理由 |
|---|---|
| 不是 enterprise B2B 平台 | 决策锁定 B2C OSS infra（见 README） |
| 不是闭源 SaaS | Apache-2.0 全栈，部署者随时可自托管 |
| 不是 vector database | 主存是结构化 5 层 schema，向量索引只是其中一个 facet |
| 不是 RAG 框架 | 不做检索增强生成的中间件，只做记忆存储 + 协议；RAG 框架可在 Nemos 之上构建 |
| 不是 chat history 存储 | 单次对话 log 是 Nemos 的输入，不是它的产出；Nemos 输出的是抽象、去冗、可审计的"关于用户的事实" |
| 不是训练数据收集器 | Nemos 永不向第三方导出用户数据用于训练；用户对自己数据有 burn 权 |
| 不是 AI 人格上传 / 二次创造 | 死后默认 `archive_only`，AI 永不以用户身份说话除非用户生前手签 opt-in |

---

## 3. 三 SKU 部署形态

Nemos 同一份协议、同一份 schema、同一组 API/MCP/SDK 接口在三种部署形态下都可运行。

| SKU | 谁运营 | 数据加密 | 索引位置 | 价格 | 协议适配关键点 |
|---|---|---|---|---|---|
| **a. 公共云**（默认） | Nemos 社区/项目方 | 服务端加密（rest + transit） | 服务端 | 免费 + 捐赠覆盖 | 全字段服务端可见；所有 API/MCP 与 SDK 工作模式一致 |
| **b. 付费 E2EE 云** | 同 SKU a 基础设施 | 客户端加密，运营方永不可解密 | 客户端 + 服务端只存密文 + 路由元数据 | $3-5/月 | 部分字段服务端必须 `client_only`；SDK 必装 ONNX embedding + 客户端 HNSW；MCP server 必走 hybrid 部署 |
| **c. 自托管** | 用户/AI app 自部署 | 由部署者自决 | 由部署者自决 | 0（用户自付基础设施） | docker-compose / helm / Go single-binary 三种 release artifact；schema 与 SKU a 一致 |

### 3.1 各 SKU 的协议适配

| 维度 | SKU a 公共云 | SKU b E2EE | SKU c 自托管 |
|---|---|---|---|
| REST API | 全字段 | content / embedding / sensitive flag 走密文字段；服务端永不解密 | 部署者自决（默认与 SKU a 同） |
| MCP Server | 远程托管 + 本地 stdio 二选一 | 必须 hybrid（local proxy 做加解密 + cloud 做密文 sync） | local stdio 为主 |
| SDK 行为 | 直接调 REST，可选本地 cache | 自动加密上传 + 客户端语义查询走本地 HNSW | 直接调 REST 或 in-process 调 server |
| 跨 SKU 迁移 | a ↔ b ↔ c 走同一 export schema | 同左 | 同左 |

### 3.2 SKU 跨界迁移路径

```
                ┌─────────────┐
                │  Export     │
                │  Schema     │  ← §10 of data-schema.md
                │  (JSON-LD + │
                │   Markdown) │
                └──────┬──────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   SKU a 云       SKU b E2EE       SKU c 自托管
   服务端加密      客户端加密         部署者自决
       ▲               ▲               ▲
       │               │               │
       └───────────────┴───────────────┘
            任意两两可互转，走同一 export schema
```

迁移路径完全由 export schema 保证；任何 Nemos 部署都必须实现一键 export + 一键 import。

---

## 4. 关键不变量（多租户版的 5 条强约束 → 10 条不变量）

以下 10 条是 Nemos 协议的硬规则。任何 SKU、任何 personality preset、任何 AI app、任何 SDK 实现都不可破坏。

### I1. 多租户 day-1
- 所有数据带 `tenant_id` + `user_id`；公共云强制非 null，自托管 single-tenant 可 null
- Schema namespace / 逻辑 DB / 物理集群三种隔离粒度由 SKU 选择，但 **schema 字段 day-1 存在**

### I2. 三维元数据缺一不可写入
- `source` / `arousal` / `surprise` 三组字段任一缺失 → 写入 REJECT
- E2EE SKU 下 `arousal` / `surprise` 可在客户端算后回填，但记录写入服务端时元数据必带

### I3. Archival 永不被 mutated
- 只能 append（写新版本指向旧 id 的 supersede 链）或 GDPR burn（彻底删除字节）
- Hot path / Reflect / 任何 personality 层都不可绕过

### I4. Personal Semantic 永不接收 derived
- `source.kind = derived` 或 `chain_depth >= 1` 的记录写入 Personal Semantic store → REJECT
- 这是 SC6（AI 是仆人不是代理）的工程铁律

### I5. Reflect 不在 hot path
- 所有 LLM 推断 fact 只能在离线 Reflect 通道里发生
- Hot path 的写入只能是 authoritative（用户陈述 / 系统观察的事件）或 derived（标 flag 的 AI 输出，不可进 Personal Semantic）

### I6. 关系记忆走独立 ownership.kind
- `ownership.kind = relational` 的记录在独立 Relational Store
- 不进入用户独立画像（Personal Semantic）合成
- Burn / share 需所有 principal 同意（或 veto wins）

### I7. 私区永不被 AI 自动 surface
- `flags.private_zone = true` 的记录不参与 Reflect / Personal Semantic 合成 / Cross-agent 共享 / 主动 surface
- 用户显式 enter-zone 才显示

### I8. 跨厂商可导出
- 所有 Nemos 部署必实现 §10 export schema（§10 见 `10-data-schema.md`）
- Export tar.gz 可被任意 Nemos 部署 import，且 round-trip checksum = 0

### I9. AI 是仆人不是代理（SC6 的协议层守门）
- 所有 LLM-generated fact 必标 `source.kind = derived` + `chain_depth >= 1`
- 用户能 query "这条事实是用户说的还是 AI 推断的" → 立即返回 source

### I10. 死后默认 archive_only
- Identity 状态机必含 `archive_only`
- `ai_speaks_as_user_after_death = true` 必须用户手写签名（多签认证）
- 没有 inheritor manifest → 默认 archive_only + 不向任何人开放

### 与 Universal Substrate 不变量的对应

| Substrate §15 | Nemos 不变量 |
|---|---|
| 1 Archival 永不 mutated | I3 |
| 2 Personal Semantic 不接 derived | I4 + I9 |
| 3 三维元数据 | I2 |
| 4 Reflect 不在 hot path | I5 |
| 5 Reflect run 必留 audit | 在 schema §3 audit 字段强制 |
| 6 关系记忆独立 | I6 |
| 7 私区永不参与 | I7 |
| 8 死后 archive_only | I10 |
| 9 任何记忆能 export | I8 |
| 10 stability 调整必留 audit | 在 schema §3 audit 字段强制 |

Nemos 在 Substrate 之上**多加 I1（多租户）**——这是 OSS B2C 部署的反向约束。

---

## 5. 与现有方案的差异

| 项目 | 主要思路 | 与 Nemos 的差异 |
|---|---|---|
| **mem0** | personal memory layer for LLM apps，向量驱动 | mem0 是单租户向量库 + chat history wrapper；Nemos 是多租户 5 层 schema + 三维元数据 + ownership 分类，向量只是一个 facet |
| **Letta (MemGPT)** | agent core memory + recall memory，分级 | Letta 是 agent-runtime 内的记忆；Nemos 是 agent-independent infra，多 agent 共享同一份用户记忆 |
| **OpenMemory / Mem0 OSS** | 个人 OSS 记忆 layer | OpenMemory 单租户 markdown；Nemos 多租户 + E2EE 兼容 + 三 SKU |
| **Cognee** | knowledge graph + cognitive cycles | Cognee 偏 graph；Nemos 偏关系 + 时间 + ownership；可在 Nemos 上叠 graph 层 |
| **MCP (Anthropic)** | tool/resource protocol | MCP 是协议层；Nemos 是 MCP server 实现 + REST 双协议；Nemos 必然适配 MCP 但不仅是 MCP |
| **Memory-Palace** | provenance + immutable | Memory-Palace 思路与 Nemos archival 一致，但单租户；Nemos 借鉴 provenance |
| **basic-memory / khoj** | 个人知识库 | AGPL/GPL，Nemos 不可派生；Nemos 思路差异在多租户 + B2C OSS + 协议化 |
| **Memori / memobase** | profile 抽象 | Nemos personal_semantic 借鉴 facet 设计 |

**Nemos 与所有现有方案的根本差异**：它不是"应用内记忆模块"，它是"用户主导的、跨应用的、可携带的、可导出的、可纠正的记忆 infra"。AI app 是它的客户，用户是它的所有者。

---

## 6. 版本与兼容承诺（v0.x 期间）

### 6.1 版本号语义

Nemos 用 SemVer 2.0，但额外约定：
- **v0.x**：协议未稳定。每个 minor 版本可能有 breaking change，但必须配 migration script 自动从 v0.(x-1) 升
- **v1.0**：协议冻结。后续只在 minor 增字段、不删字段；major 升级走 RFC

每条 record 带 `schema_version: "0.1"`；读取方按版本路由。

### 6.2 v0.x 期间的兼容承诺

- **加字段允许**：新增 optional 字段不算 breaking
- **改字段语义禁止**：现有字段含义变更走 v0.(x+1) + migration
- **删字段禁止**：v0.x 期间不删字段，只 deprecate（标 `@deprecated: true`）
- **Export schema 永远向后兼容**：任意 v0.x export 必须能被任意 v0.y (y >= x) import

### 6.3 v0 → v1 路径

- v0.1 → v0.2 → ... → v0.9 是迭代期，每个版本可能动 schema
- v0.9 → v1.0 是冻结期，至少 1 个月的 RC 候选
- v1.0 后任何 schema 变更走 RFC 流程

### 6.4 不兼容窗口

下列字段在 v0.x 期间可能改语义（不冻结）：
- `arousal.signal_sources[]` 内部 weight 算法
- `fsrs.difficulty` 和 `fsrs.retention_target` 的默认值
- `surprise.basis` 枚举值的增减
- `audit.signals_applied[]` 的字符串 ID 命名

下列字段 day-1 锁定，v0.1 不再变（见 `10-data-schema.md` §2.3）：
- `id` 算法（sha256 of canonical_json）
- `tenant_id` / `user_id` / `scope_id` 字段名与类型
- `source.kind` 枚举（authoritative / derived）
- `source.chain_depth` 单调递增不可降级
- `ownership.kind` 枚举（self / relational / public）
- `type` 枚举（episodic / semantic / personal_semantic / procedural / archival）

---

## 7. 协议族构成

| 文件 | 内容 | 状态 |
|---|---|---|
| `00-overview.md` | 本文件 | Draft v0.1 |
| `10-data-schema.md` | 数据 schema，所有字段定义 | Draft v0.1 |
| `20-rest-api.md` | REST API 端点 | Draft v0.1 |
| `30-mcp-server.md` | MCP server tools / resources / prompts | Draft v0.1 |
| `40-sdk-contract.md` | SDK 接口契约（TS + Python） | Draft v0.1 |

未来文件（Round 2+）：
- `50-witness-layer.md`：Witness Layer 强制安全过滤（PreWrite / PreQuery / PostRetrieve）
- `60-personality-presets.md`：Continuity / Companion preset 字段扩展
- `70-federation.md`：Nemos 节点之间联邦同步协议
- `80-import-export.md`：单独抽出的导出格式 spec

---

## 8. Round 2 需要回答的开放问题清单

以下 12 个开放问题是 Round 1 设计过程中识别的、依赖 Round 2 进一步研究或体量数据才能闭环的点。每条标注「不确定原因 + Round 2 解决路径」。

### Q1. `chain_depth` 上限策略
- **不确定**：sizing study 假设 `chain_depth` 单调递增，但没设上限。理论上 100 次 reflect 后 chain_depth = 100 仍合法，但实践中 `chain_depth > 5` 几乎无意义
- **Round 2 路径**：1k DAU 真实 metric 后看 chain_depth 分布，决定是否在 `chain_depth >= N` 时强制 archive 旧链 + 重新从 archival 出发

### Q2. `arousal` 在 E2EE SKU 的客户端算法版本管理
- **不确定**：客户端跑 arousal v1（rule-based）vs v2（小 LLM）的版本协调；不同设备版本可能不一致 → arousal 值跨设备分叉
- **Round 2 路径**：跑 5-device CRDT 模拟（sizing §11 风险 #14），决定是否在 `arousal` 字段加 `algorithm_version` 子字段做仲裁

### Q3. `period_id` 一对多 vs 多对多
- **不确定**：Continuity Layer 允许一条记忆属于多个 period（`period_ids: []`）；但 Universal Substrate §11.2 说"默认 = 当前 active period"——单值 vs 列表 day-1 锁哪个？
- **Round 2 路径**：v0.1 锁单值 `period_id`，多 period 关联走独立 join table（`record_period_links`）；如真实使用中 join 性能差，再升级 schema

### Q4. Relational Store 的 ACL 模型在跨 Nemos 部署时的 PKI
- **不确定**：alice 在 nemos.com（SKU a）+ user 自托管 SKU c，怎么互相签名？需要 PKI 网络 / Web of Trust / fediverse-style identity
- **Round 2 路径**：先用 email 作弱 identity（hash 后存）；Round 3+ 探 ActivityPub-style federation

### Q5. `surprise.value` 在 E2EE SKU 下服务端是否可见
- **不确定**：sizing §7.1 说 `surprise` 客户端算更安全，但服务端如果完全看不到，则无法做"按 surprise 排序 inject"
- **Round 2 路径**：v0.1 让客户端算后回填到服务端的 bucket（0-3 区间），服务端只看 bucket 不看精确值；如不够则 Round 2 升级

### Q6. `embedding_model_id` 升级时的 re-embed 策略
- **不确定**：embedding 模型 18 月升一次，re-embed 全库会撞 1M DAU 的 GPU 配额；inline lazy re-embed 可能让用户的 query 偶发慢
- **Round 2 路径**：v0.1 锁 `embedding_model_id` 字段 + lazy re-embed 标记 + nightly batch；真实负载下看 lazy vs batch 的 trade-off

### Q7. MCP `resources` 是否暴露用户全量 memory
- **不确定**：MCP resources 设计上是"可订阅资源"；Nemos 是否应把整个 memory 当 resource 暴露 vs 只暴露过滤后的 view
- **Round 2 路径**：v0.1 只暴露按 capability 过滤的 view；跟 Anthropic MCP working group 互动后调整（sizing §11 风险 #15）

### Q8. SDK 离线模式的 write 队列冲突解决
- **不确定**：SDK L1/L2 cache + 离线写队列在网络恢复后的合并冲突；多设备并发写同一 record 的 `version` 字段如何仲裁
- **Round 2 路径**：v0.1 用 last-write-wins + audit 双写 + 警告；Round 2 看是否需要客户端 vector clock

### Q9. `tenant_id` 在自托管 SKU 是否真允许 null
- **不确定**：null tenant 让 schema 二值化（多租户分支 + 单租户分支），增加实现复杂度；但强制 default tenant 又让自托管显得繁琐
- **Round 2 路径**：v0.1 自托管允许 `tenant_id = "default"` 字符串（不是 null），统一非空约束；如真实使用中烦人再考虑 null

### Q10. `period_active = true` 跨 scope 的语义冲突
- **不确定**：Companion Layer 一个用户多 scope，每个 scope 是否有独立 active period？还是全局只有一个？Conway 理论支持后者，但 work scope 和 health scope 显然可以平行
- **Round 2 路径**：v0.1 强制全局 active period（单一身份）；Companion Layer 用 scope 内 `current_focus` 子字段表达"在 work scope 内现在专注的子主题"，不与 period 冲突

### Q11. `corrects` / `corrected_by` 双向链的强一致性
- **不确定**：跨 shard / 跨 SKU 时双向链同步窗口；A.corrects = [B] 但 B 还没拉到这个变更
- **Round 2 路径**：v0.1 接受最终一致（< 5s 窗口）；audit 日志兜底；强一致版本走 v0.2+ RFC

### Q12. 与 mem0 / Letta / Memory-Palace 的 schema 对齐语义
- **不确定**：Nemos 想做"协议化"，但其他 OSS 项目已经有自己的 schema；强行对齐会拖慢 Nemos，不对齐会变孤岛
- **Round 2 路径**：v0.1 spec 独立发布；同时发 import adapter（`mem0_to_nemos.py` / `letta_to_nemos.py`）做单向迁移；不做双向语义绑定

### Q13. Audit log 的 archival 路径
- **不确定**：audit log 自身写入 Archival 是 Universal Substrate 不变量，但 audit log 体量（sizing §1.1 估 200/月/用户）远大于主存；全部进 archival 会让 archival 增长比预期快 4x
- **Round 2 路径**：v0.1 让 audit log 独立 store（`audit_log`），但其完整性 hash 写入 archival；archival 只存 audit summary 而非全量

### Q14. Forget vs Burn 在多 agent capability 下的传播
- **不确定**：用户 burn 一条 episodic，已被 agent A 缓存的内容怎么回收？Companion §6.5 提到 `AgentMemoryCache.invalidate`，但跨 agent / 跨 SKU 的 cache invalidation 协议不存在
- **Round 2 路径**：v0.1 只保证 Nemos 服务端 + 官方 SDK cache 的回收；第三方 cache 由 agent 自行实现 + audit log 记录"burn 已发起"

---

## 9. Round 1 决议清单（落地映射）

下列决议在 spec 各文件中已落地，本节作为索引：

| Round 决议 | 落地位置 |
|---|---|
| 决议 1（AI 调 surface 频次需授权） | schema §3 audit + REST `/forget` `/cool` 端点 |
| 决议 2（反例必保但不主动 surface） | schema §6 contradiction policy = `preserve_counter` |
| 决议 3（deleted_scenes muse pull 默认关闭） | Continuity preset extension（Round 2 落地） |
| 决议 4（D 默认 opt-in） | schema §7 ownership + capability registry |
| 决议 6（统一 export schema） | schema §10 完整落地 |
| 决议 7（immutable + 可变层） | schema §2.6 archival + interpretation |
| 决议 8（GDPR 反编译） | REST `/burn` + schema §8 burn 算法 |
| 决议 9（authoritative vs derived 隔离） | schema §3.1 + I4 不变量 |
| 决议 10（见证为默认） | Witness Layer 独立 spec（Round 2 单独成文） |

---

**End of overview. 下一步：读 `10-data-schema.md`。**
