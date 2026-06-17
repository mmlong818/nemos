# Nemos v0.1 — 数据 Schema (10-data-schema)

> **状态**：Draft，Round 1 输出
> **版本**：v0.1
> **更新**：2026-06-04
> 配套阅读：`00-overview.md`（不变量 I1-I10）+ Universal Substrate `00-universal-substrate.md`（5 层 + 三维元数据 + R1-R12）

---

## 0. 阅读地图

| 节 | 内容 |
|---|---|
| §1 | 多租户基础（tenant / user / scope / namespace） |
| §2 | 5 层存储 schema 全字段定义 |
| §3 | day-1 必锁的 12 个字段（误锁迁移代价） |
| §4 | 三维元数据完整定义 |
| §5 | 关系字段（双向链 / corrects） |
| §6 | 错误标注（来自 ECC v2 实战） |
| §7 | scope + ownership 模型 |
| §8 | Lifetime Period 字段（创作者 persona 用） |
| §9 | 衰减字段 + FSRS 接口 |
| §10 | Import / Export Schema（跨 SKU + 跨厂商） |
| §11 | Schema 演化策略 + 版本字段 |
| §12 | E2EE 字段可见性总表（最终对账） |

---

## 1. 多租户基础

Nemos 是 day-1 多租户系统。所有数据都用三级隔离键：

| 键 | 类型 | 必填 | E2EE 可见 | 说明 |
|---|---|---|---|---|
| `tenant_id` | string (ULID / 部署者定义) | true | server | 部署单位。SKU a/b 一个部署多 tenant；SKU c 自托管单 tenant 可用 `"default"` 字符串。**永不为 null**（即使自托管也用 `"default"`，见 overview Q9） |
| `user_id` | string (ULID) | true | server | 每 tenant 内的用户。E2EE SKU 下服务端可见（用于路由），但用户身份与现实身份的绑定（email/phone）必须 hash 后存 |
| `scope_id` | string | true | server (HMAC) | 见 §7。E2EE SKU 服务端见 HMAC 后的 hash |

### 1.1 隔离粒度（与 sizing §3.3 对齐）

| 规模 | 物理隔离 | 字段隔离 |
|---|---|---|
| 0-10k DAU | Postgres + per-user **schema namespacing**（`schema user_<ulid>`） | 同 schema 内 record 按 `tenant_id + user_id` 复合主键过滤 |
| 10k-500k DAU | Citus 分片 + per-user **logical DB** | shard key = `user_id` |
| 500k+ DAU | Multi-region cluster + per-user dedicated container | 同上 |
| SKU c 自托管 | SQLite 单文件 / Postgres 单实例 | `tenant_id = "default"`，单 user 或多 user 自决 |

**协议层不绑定特定物理隔离方案**——schema 字段不变，但部署形态可以从最低粒度（schema namespacing）无损升到最高粒度（per-user cluster）。

### 1.2 E2EE 下的 tenant/user/scope 处理

| 字段 | 服务端见 | 客户端见 | 备注 |
|---|---|---|---|
| `tenant_id` | 明文 | 明文 | 路由必需 |
| `user_id` | 明文（ULID） | 明文 | 路由必需 |
| `scope_id` | **HMAC(scope_label, tenant_key)** | 明文 label（如 `"work"` `"health"`） | scope label 可能泄漏（如 `"health"` 暗示用户有健康记忆），用 HMAC 存 |

每用户拥有一个 `tenant_key`（用户密码派生）。所有 scope_id 在 E2EE SKU 下都是 HMAC 后的 hash；客户端缓存 `{label → hash}` 的映射做 UI 展示。

### 1.3 跨租户的禁止

- 任何 query 不带 `tenant_id` + `user_id` → REJECT
- 任何 record 写入跨租户 → REJECT
- 跨 user 的共享走 Relational Store（§7.4），不通过跨 user_id query

---

## 2. 五层存储 Schema 全字段

> 字段定义格式：
> ```
> - 字段名: 类型
>   required: true|false
>   e2ee_visibility: server|client_only
>   index: btree|gin|hnsw|none
>   default: ...
>   notes: 用途
> ```
>
> 所有层共享一组**公共字段**（§2.0），各层再叠加自己的字段（§2.1-§2.5）。

### 2.0 公共字段（所有 5 层都有）

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `id` | string | true | server | btree (PK) | computed | 见 §3.1。`<type_prefix>_<sha256_hex>` |
| `tenant_id` | string | true | server | btree (复合 PK) | — | §1 |
| `user_id` | string | true | server | btree (复合 PK) | — | §1 |
| `type` | enum | true | server | btree | — | `episodic` / `semantic` / `personal_semantic` / `procedural` / `archival` |
| `schema_version` | string | true | server | none | `"0.1"` | SemVer minor.patch；major 由 type 隐含 |
| `scope_id` | string | true | server (HMAC) | btree | — | §7 |
| `period_id` | string | false | server (HMAC) | btree | active period | §8。archival 不带 period |
| `created_at` | timestamptz | true | server | btree | now() | 系统创建时间 |
| `audit` | object | true | server (metadata only in E2EE) | gin | 见 §2.0.1 | 不可篡改的写入痕迹 |
| `flags` | object | true | mixed | gin | `{}` | 见 §2.0.2 |

#### 2.0.1 `audit` 子结构

```yaml
audit:
  created_by:
    type: string                # agent_id | "user_self" | "system"
    required: true
    e2ee_visibility: server     # 路由必需
  created_at:
    type: timestamptz
    required: true
    e2ee_visibility: server
  created_session_id:
    type: string                # SDK 写入的 session id（可关联多个 record）
    required: false
    e2ee_visibility: server
  agent_signature:
    type: bytes (Ed25519)
    required: when created_by is agent
    e2ee_visibility: server     # 跨 agent 防串供（见 Companion §7.3）
  mutations:
    type: array<MutationEntry>
    required: true
    default: []
    e2ee_visibility: server (metadata) + client_only (semantic content of mutations)
    notes: 每次 stability 调整、flag 变更、Reflect 摘要引用 → 追加一条
  signals_applied:
    type: array<string>          # R1, R2, R6, ...
    required: true
    default: []
    e2ee_visibility: server (枚举值不泄漏内容)
    notes: 见 §9.4 + Substrate §4
```

`MutationEntry`：
```yaml
MutationEntry:
  at: timestamptz
  kind: enum [stability_adjust, flag_set, supersede_pointer, ownership_change, ...]
  before: jsonb (可为 null)
  after: jsonb (可为 null)
  reason: string
  by: string (agent_id | user | system)
```

#### 2.0.2 `flags` 子结构

| 字段 | 类型 | required | e2ee_visibility | default | notes |
|---|---|---|---|---|---|
| `sensitive` | bool | true | client_only | false | Witness Layer 标 |
| `private_zone` | bool | true | client_only | false | §7.3 / I7 |
| `do_not_reflect` | bool | true | server | false | 用户可标 |
| `do_not_surface` | bool | true | server | false | 用户可标 |
| `quarantined` | bool | true | server | false | Forgetting Service 可设 |
| `legal_hold` | bool | true | server | false | GDPR / 法律强制保留 |
| `counter_example` | bool | true | server | false | R1 反例标记 |
| `contains_burned_evidence` | bool | true | server | false | 派生品的源被 burn 后标 |
| `surface_cooldown_until` | timestamptz | false | server | null | §9.6 |
| `user_forget_intent` | bool | true | server | false | §9.5 |
| `ai_contamination_risk` | bool | true | client_only | false | Continuity Layer §9 扫描结果 |

### 2.1 Episodic Store（事件层）

事件 = 一次具体的发生。粒度：一次对话、一次观察、一次代码 commit、一次截图。

继承所有 §2.0 公共字段，叠加：

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `content.text` | string | true | client_only | hnsw (embedding) + gin (FTS) | — | 原文。永不为 null |
| `content.lang` | string (BCP-47) | false | server | none | "auto" | 自动检测 |
| `content.modality` | enum | true | server | btree | "text" | text / audio / image / screen / mixed |
| `content.attachments` | array<Attachment> | false | client_only | none | [] | 见 §2.1.1 |
| `occurred_at` | timestamptz | true | server | btree | created_at | 事件发生时间（用户主张） |
| `captured_at` | timestamptz | true | server | btree | created_at | 系统捕获时间 |
| `duration_s` | int | false | server | none | null | 事件持续时长 |
| `context` | object | false | mixed | gin | `{}` | 见 §2.1.2 |
| `source` | object | true | server (kind) + client_only (origin) | gin | — | §4.1 |
| `arousal` | object | true | mixed | btree (value bucket) | — | §4.2 |
| `surprise` | object | true | mixed | btree (value bucket) | — | §4.3 |
| `ownership` | object | true | server (kind) | btree (kind) | `{kind: self}` | §7 |
| `fsrs` | object | true | server | btree (next_review_at) | §9 default | §9 |
| `archival_ref` | string (archival id) | true | server | btree | — | §2.5；指向 immutable layer |
| `interpretation_ids` | array<string> | false | server | none | [] | 见 §2.6 |
| `embedding_model_id` | string | true | server | btree | "openai-3-small-v1" | §3.10 |
| `embedding` | array<float32> (1024-3072) | false | client_only (E2EE) / server (a) | hnsw | — | 向量；E2EE 客户端存，公共云服务端存 |
| `embedding_dim` | int | true | server | none | 1536 | 与 model 对应 |

#### 2.1.1 `Attachment` 结构

```yaml
Attachment:
  hash: string (sha256)        # content-addressed
  kind: enum [image, audio, video, document, code, screen]
  mime: string                  # image/jpeg, text/markdown, ...
  size_bytes: int
  archival_ref: string          # 指向 archival 中的 raw bytes
  embedding_id: string?         # 多模态向量 ID
  ocr_text: string?             # OCR/ASR 后文本（标 source.extractor=ocr）
```

#### 2.1.2 `context` 子结构

| 字段 | 类型 | required | e2ee_visibility | notes |
|---|---|---|---|---|
| `location` | string | false | client_only | "home/study"，用户标或推断 |
| `device` | string | false | server | "macbook" / "phone-ios" / "browser" |
| `app_origin` | string | false | server | 写入来源（"cursor" / "claude-code" / "chrome"） |
| `social.with` | array<string> | false | client_only (E2EE) | 共同在场者 ID 或 label |
| `social.ownership_hint` | enum | false | server | self / relational / public |
| `preceding_event_id` | string | false | server | 因果/时序链 |
| `session_id` | string | false | server | 同一 AI app session 的 record group |
| `geo` | object | false | client_only | `{lat, lon, accuracy_m}`，可空 |

**Episodic Store 索引集**：
- 主键 `(tenant_id, user_id, id)`
- 时间索引 `(tenant_id, user_id, occurred_at desc)`
- 向量索引 `embedding` (hnsw, per-shard)
- FTS 索引 `content.text → tsvector` (gin)
- 复合索引 `(scope_id, period_id, type)`
- 二级索引 `flags.sensitive`, `flags.private_zone`, `ownership.kind`

**Decay 策略**：FSRS 基础衰减 + R1-R12 信号拉平（见 §9.4 + Substrate §4）

### 2.2 Semantic Store（世界知识层）

世界知识 / 一般化的非个人事实。由 Episodic 经 Reflect 抽象而来。

继承所有 §2.0 公共字段，叠加：

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `content.claim` | string | true | client_only | hnsw + gin | — | 一阶事实陈述 |
| `content.lang` | string | false | server | none | "auto" | |
| `evidence_episodic_ids` | array<string> | true (≥1) | server | gin | — | trail 入口（R12） |
| `abstraction_level` | int | true | server | btree | 1 | 0=原 fact, 1=一阶抽象, 2+=高阶 |
| `mdl_score` | float | false | server | btree | null | §7.3 of Substrate |
| `source` | object | true | server (kind) | gin | `{kind: derived}` | semantic 主要是 derived |
| `arousal` | object | false | mixed | btree | null | semantic 一般无 arousal |
| `surprise` | object | true | mixed | btree | — | 抽象时计算 |
| `ownership` | object | true | server | btree | `{kind: self or public}` | §7 |
| `fsrs` | object | true | server | btree | §9 (base ×3 慢衰减) | |
| `archival_ref` | string | true | server | btree | — | |
| `interpretation_ids` | array<string> | false | server | none | [] | |
| `embedding_model_id` | string | true | server | btree | — | |
| `embedding` | array<float32> | false | client_only/server | hnsw | — | |

**与 Episodic 的区别**：semantic 不绑特定时间地点；它的 `evidence_episodic_ids` 是 trail 入口（R12）。

### 2.3 Personal Semantic Store（关于"我"的事实层）

**这是 SC6（AI 是仆人不是代理）的最严格区**——任何 LLM 推断永不自动写入这里（I4 + I9 不变量）。

继承所有 §2.0 公共字段，叠加：

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `facet` | string | true | server | btree | — | `preference` / `skill` / `relation` / `value` / `identity` / `health` / `voice` / `motif` / `chapter` |
| `key` | string | true | server | btree | — | facet 内的字段名（"writing_voice" / "favorite_writing_time"） |
| `value` | jsonb | true | client_only | gin | — | 字段值，可任意 JSON |
| `evidence_episodic_ids` | array<string> | false | server | gin | [] | 引用支撑事件 |
| `confidence` | float (0-1) | true | server | btree | 1.0 | authoritative 默认 1.0 |
| `source` | object | true | server | gin | `{kind: authoritative, chain_depth: 0}` | **强制 authoritative + chain_depth=0** |
| `version` | int | true | server | btree | 1 | 见 §2.6 |
| `supersedes` | string (psem_id) | false | server | btree | null | 旧版本指针 |
| `valid_from` | date | true | server | btree | created_at | 此 fact 生效起始 |
| `valid_to` | date | false | server | btree | null | null = 仍生效 |
| `period_id` | string | false | server | btree | active | 在特定 period 内有效 |
| `ownership` | object | true | server | btree | `{kind: self}` | personal_semantic 默认 self（relational 走独立 store） |
| `visibility` | object | true | server | gin | `{default: self_only}` | §7.5 字段级 ACL |
| `fsrs` | object | true | server | btree | §9 (base ×3) | |
| `archival_ref` | string | true | server | btree | — | |
| `embedding_model_id` | string | true | server | btree | — | |
| `embedding` | array<float32> | false | client_only/server | hnsw | — | |

#### 2.3.1 `visibility` 子结构（字段级 ACL，见 Companion §5.1）

```yaml
visibility:
  default: enum [self_only, scope_local, public_in_tenant]
  rules:
    - scope: scope_id
      agents: array<agent_id>      # 空 = scope 内所有 agent
      fields: array<string>         # value 内允许暴露的子字段
      expires_at: timestamptz?      # 临时授权
```

#### 2.3.2 写入约束

- 任何 record 写入此 store 必满足：`source.kind == "authoritative" && source.chain_depth == 0`
- 违反 → REJECT (HTTP 422 / SDK throw)
- Reflect 不能直接写此 store，只能写 `proposals/` 队列（见 REST API `/reflect-proposals` 端点）

### 2.4 Procedural Store（习惯流程层）

习惯、流程、操作模式。低 arousal、高频、低叙事价值。

继承所有 §2.0 公共字段，叠加：

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `pattern` | string | true | client_only | hnsw + gin | — | "工作日 9:00 打开 Obsidian 写 morning page" |
| `frequency.count` | int | true | server | btree | 1 | 模式出现次数 |
| `frequency.window_days` | int | true | server | none | 30 | 统计窗口 |
| `trigger` | string | false | server | btree | null | "time:weekday@09:00" / "event:after_meeting" |
| `outcome` | string | false | client_only | none | null | 结果描述 |
| `evidence_episodic_ids` | array<string> | true (≥3) | server | gin | — | 至少 3 次出现才能成 pattern |
| `source` | object | true | server | gin | `{kind: derived, chain_depth: 1}` | **procedural 允许 derived**（本来就是统计模式） |
| `confidence` | float | true | server | btree | 0.5 | 越多 evidence 越高 |
| `ownership` | object | true | server | btree | `{kind: self}` | |
| `fsrs` | object | true | server | btree | §9 (base ×5 极慢) | |
| `archival_ref` | string | true | server | btree | — | |

**特性**：procedural 允许 derived（本来就是统计模式），但用户能 query "AI 是怎么知道这个的" → 必须返回 `evidence_episodic_ids`。

### 2.5 Archival Store（不可变原始层）

**最神圣的层。所有其他层都是它的派生品。**（I3 不变量）

继承 §2.0 公共字段（type=archival），叠加：

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `raw_content.bytes` | bytes | true | client_only | none | — | 原始字节 |
| `raw_content.encoding` | enum | true | server | none | "utf-8" | utf-8 / base64 / binary |
| `raw_content.mime` | string | true | server | btree | — | text/plain / image/jpeg / ... |
| `raw_content.size_bytes` | int | true | server | btree | — | 用于配额 |
| `captured_by` | string | true | server | btree | — | agent_id / user_input / system |
| `source_provenance.device_id` | string | false | server | btree | null | |
| `source_provenance.app_origin` | string | false | server | btree | null | |
| `source_provenance.ingestion_method` | enum | true | server | btree | — | user_typed / ocr / asr / api_import / agent_observation |
| `legal_hold` | bool | true | server | btree | false | GDPR 抹除时设 false 后可 vacuum |
| `content_hash` | string (sha256 hex) | true | server | btree (unique) | computed | 用于去重 |

**Archival 不带**：
- `fsrs` —— archival 不衰减
- `arousal` / `surprise` —— 这些是派生品的元数据
- `embedding` —— embedding 可随时重算，不是 raw
- `flags`（除 `legal_hold`、`quarantined`）
- `ownership` —— archival 是 raw bytes，ownership 由派生 record 决定
- `period_id` —— archival 是 raw，period 由派生决定

**不变量**：
- `id = "arch_" + sha256(canonical(raw_content + captured_at + source_provenance))`
- 写入即冻结。**没有 update 端点，只有 delete（GDPR burn）**
- 任何 mutation 走 supersede 链：`new_archival_record.supersedes_id = old_id`

### 2.6 Immutable 原始层 + 可变解释层（决议 7）

每条"用户可见的记忆"在概念上是 `{original, interpretations[]}` 二元组：

```
       ┌─────────────────────────┐
       │  Archival (immutable)   │  ← archival_ref
       │  raw_content            │
       └────────────┬────────────┘
                    │ referenced by
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │Episodic│ │Semantic│ │PersSem │   ← interpretations
   │  v1    │ │  v1    │ │  v2    │
   └────────┘ └────────┘ └────────┘
                                ▲
                                │ 新理解叠加
                          ┌────────┐
                          │PersSem │  ← v3 supersedes v2
                          │  v3    │
                          └────────┘
```

**Schema 约定**：
- Episodic / Semantic / Personal Semantic / Procedural 每条都带 `archival_ref`
- 任一记录修订 → 新版本 + `supersedes: <old_id>`，旧版本 `valid_to` 设值
- `interpretation_ids[]` 字段允许一条 archival 关联多条平行解释

**UI 回滚**：
```
function viewAsOfTimestamp(t):
  for type in [episodic, semantic, personal_semantic, procedural]:
    for r in type where ownership.kind=self and valid_from <= t:
      yield latest version v where v.valid_from <= t and (v.valid_to is null or v.valid_to > t)
```

### 2.7 Relational Store（关系契约层，独立于 5 层）

关系类记忆走独立 store（不在 5 层内但 schema 兼容）。详见 §7.4 + Companion §6。

继承 §2.0 公共字段（type=`relational`，扩展枚举），叠加：

| 字段 | 类型 | required | e2ee_visibility | index | default | notes |
|---|---|---|---|---|---|---|
| `content` | 同 Episodic | true | client_only | hnsw + gin | — | |
| `principals` | array<Principal> | true (≥2) | server | gin | — | 见下 |
| `vector_clock` | object<principal_id, int> | true | server | gin | — | CRDT base |
| `principal_acl` | object | true | server | gin | — | 见 §7.4.3 |
| `share_decisions` | array<ShareDecision> | false | server | gin | [] | |
| `source` | object | true | server | gin | — | |
| `fsrs` | object | true | server | btree | — | |
| `archival_ref` | string | true | server | btree | — | |

`Principal`:
```yaml
Principal:
  id: string                # user_id 或外部 identity hash
  role: enum [self, partner, family, colleague, friend, ...]
  consent: enum [explicit, implicit_via_relationship, pending, revoked]
  consent_at: timestamptz
```

`ShareDecision`:
```yaml
ShareDecision:
  to_scope_or_agent: string
  approved_by_principals: array<principal_id>
  veto_pending_from: array<principal_id>
  vetoed_by: array<principal_id>
  effective: bool
  decided_at: timestamptz
```

---

## 3. day-1 必锁字段（错一次后期迁移代价不可逆）

下列 12 个字段在 v0.1 day-1 锁定，v0.x 期间不再变动语义。错一次会让所有部署用户的数据迁移痛苦不可逆（sizing §12.4 + §12.6）。

| # | 字段 | 锁定的内容 | 错一次的迁移代价 |
|---|---|---|---|
| 1 | `id` 算法 | `<type_prefix>_` + sha256_hex(canonical_json) | 全库 id 失效 → 所有引用、reflection、audit log、Relational ACL 全断 → 等于灾难性 wipe |
| 2 | `tenant_id` + `user_id` 字段名 + 类型 | string ULID；非 null（自托管用 `"default"`） | 多租户隔离层重写 → SKU a/b 部署整盘迁移；行级 ACL 全部失效 |
| 3 | `scope_id` 字段名 + HMAC 兼容 | string；E2EE 下 HMAC(label, tenant_key) | scope 是 Companion 跨 agent 路由的核心 → 一变所有 capability registry 失效 |
| 4 | `schema_version` 字段名 + SemVer 语义 | string；新增 record 必带 | 读取方按版本路由的能力废掉 → 兼容性承诺被推翻 |
| 5 | `source.kind` 枚举 | `authoritative` \| `derived` | I4 不变量（Personal Semantic 不接 derived）失效 → SC6 被推翻 |
| 6 | `source.chain_depth` 单调递增 | int，写入时只能递增 | R8 信号失效；防 AI 自污染机制崩 |
| 7 | `source.authoritative` bool（ECC v2 遗留） | bool；与 `kind == authoritative` 等价 | 与 ECC v2 兼容性断 → 已有用户数据无法 import |
| 8 | `archival_ref` 字段名 + content-addressed | string；指向 archival.id | immutable 原始层 day-1 ；一变所有 supersede 链失效 |
| 9 | `period_id` 字段名 + 类型 | string ULID；nullable | 时间旅行查询失效；创作者 persona 用 |
| 10 | `ownership.kind` 枚举 | `self` \| `relational` \| `public` | relational store 字段错位 → 跨 user 共享全断 |
| 11 | `embedding_model_id` 字段存在 | string；标记 embedding 来源 | embedding 升级路径失效 → 1M DAU 时全库 re-embed 撞墙 |
| 12 | `audit.created_by` + `audit.agent_signature` | string + Ed25519 bytes | 跨 agent 串供防护失效（Companion §7）→ multi-agent 信任崩 |

### 3.1 `id` 字段算法（day-1 锁，最严格）

```
canonical_json(record) = JSON.stringify(record, sort_keys=true, exclude_fields=["id", "audit.mutations", "fsrs", "embedding"])
id_payload = canonical_json(record)
id = type_prefix + "_" + sha256_hex(id_payload)

type_prefix:
  episodic       → "ep"
  semantic       → "sem"
  personal_sem   → "psem"
  procedural     → "proc"
  archival       → "arch"
  relational     → "rel"
  reflection     → "refl"     # Continuity Layer 用
  capability     → "cap"
  manifest       → "manif"
```

`canonical_json` 必须：
- 排序所有 object key
- 排除 `id`（自引用循环）
- 排除 `audit.mutations`（mutation 后会变，需要稳定 id）
- 排除 `fsrs`（衰减状态变化频繁）
- 排除 `embedding`（embedding 升级会变）
- 用 NFC unicode normalization 处理 text
- 数字用 ECMA-404 严格 JSON 数字（无 NaN / Infinity）

### 3.2 `embedding_model_id` 字段（避免 re-embed 灾难）

```yaml
embedding_model_id:
  type: string
  required: true
  format: "<provider>-<model>-<version>"
  examples:
    - "openai-text-embedding-3-small-v1"
    - "anthropic-embed-v1"                  # 假设性
    - "bge-m3-v1"                           # 自托管
    - "bge-small-en-v1.5"                   # E2EE 客户端
    - "qwen3-embedding-0.6b-v1"
  notes: |
    embedding 升级走 lazy re-embed：
    1. 新写入用新 model_id
    2. 旧记录被 query 命中时后台 re-embed
    3. 全库 batch re-embed 走 nightly cron
```

---

## 4. 三维元数据完整定义（强制字段，I2 不变量）

### 4.1 `source` 防 AI 自污染（SC6 / R8 / I4）

```yaml
source:
  kind:
    type: enum [authoritative, derived]
    required: true
    e2ee_visibility: server
  origin_id:
    type: string                    # 原始事件 / 外部 URL / agent session id
    required: true
    e2ee_visibility: server
  chain_depth:
    type: int (>=0)
    required: true
    e2ee_visibility: server
    default: 0
    notes: 0=用户直说；n=经 n 次 LLM 转述
  authoritative:
    type: bool
    required: true
    e2ee_visibility: server
    notes: 与 kind 冗余，ECC v2 遗留字段，二者必须一致
  confidence:
    type: float (0-1)
    required: true
    default: 1.0 (when authoritative) / 0.8 (when derived)
    e2ee_visibility: server
  extractor:
    type: enum [user_typed, ocr, asr, llm_summary, llm_inference, agent_observation, sensor]
    required: true
    e2ee_visibility: server
  origin_agent:
    type: string?                   # agent_id (null = user 或 system)
    required: false
    e2ee_visibility: server
  extracted_at:
    type: timestamptz
    required: true
    e2ee_visibility: server
  agent_signature:
    type: bytes (Ed25519)?
    required: when origin_agent is not null
    e2ee_visibility: server
    notes: Companion §7.2 跨 agent 串供防护
```

**Routing 规则**（不可绕过，I4 + I9）：

| `kind` | `chain_depth` | 允许写入的 store |
|---|---|---|
| authoritative | 0 | Episodic / Semantic / **Personal Semantic** / Procedural / Archival / Relational |
| authoritative | ≥1 | Episodic / Semantic / Procedural / Archival / Relational（不能进 Personal Semantic） |
| derived | 任意 | Episodic / Semantic / Procedural / Archival / Relational（**永不进 Personal Semantic**） |

### 4.2 `arousal` 情绪强度（R2 / F4）

```yaml
arousal:
  value:
    type: float (0-1)
    required: true
    e2ee_visibility: server (bucket 0/0.3/0.5/0.7/1.0)
    notes: E2EE 客户端算精确值，回填服务端用 bucket
  valence:
    type: float (-1 to 1)
    required: true
    e2ee_visibility: server (bucket -1/-0.5/0/0.5/1)
  signal_sources:
    type: array<SignalSource>
    required: true (≥1)
    e2ee_visibility: client_only
    notes: 服务端见 source names 但不见 scores
  computed_at:
    type: timestamptz
    required: true
    e2ee_visibility: server
  computed_by:
    type: string
    required: true
    e2ee_visibility: server
    examples: ["rule_v1", "llm_v2_claude_haiku", "user_marked"]
  algorithm_version:
    type: string
    required: true
    default: "rule_v1"
    e2ee_visibility: server
    notes: 多设备 E2EE 时仲裁用（见 overview Q2）

SignalSource:
  name: enum [punctuation, sentence_length, lexicon, user_marked, speech_prosody, llm_classification]
  score: float (0-1)
```

**E2EE 客户端算法**（v1 规则版）：见 Substrate §3.2。

### 4.3 `surprise` 信息论意外度（R6）

```yaml
surprise:
  value:
    type: float (bits, 0-∞)
    required: true
    e2ee_visibility: server (bucket 0-1, 1-2, 2-3, 3+)
    notes: 同 arousal，E2EE 服务端只见 bucket
  basis:
    type: enum [embedding_distance_to_centroid, entity_freq, llm_unexpectedness, combined]
    required: true
    e2ee_visibility: server
  comparison_window:
    type: string (duration)
    required: true
    default: "last_30d"
    e2ee_visibility: server
  computed_at:
    type: timestamptz
    required: true
    e2ee_visibility: server
  algorithm_version:
    type: string
    required: true
    default: "embed_centroid_v1"
    e2ee_visibility: server
```

---

## 5. 关系字段 + 双向链

### 5.1 `corrects` / `corrected_by`（ECC v2 实战字段）

```yaml
corrects:
  type: array<record_id>
  required: false
  default: []
  e2ee_visibility: server
  notes: 本 record 推翻的旧 record id 列表

corrected_by:
  type: array<record_id>
  required: false
  default: []
  e2ee_visibility: server
  notes: 推翻本 record 的新 record id 列表
```

### 5.2 `related`

```yaml
related:
  type: array<record_id>
  required: false
  default: []
  e2ee_visibility: server
  notes: 相关但不互相纠正的 record
```

### 5.3 一致性约束

双向链最终一致（v0.1）：
- 写入新 record A，含 `corrects: [B]` → 服务端异步追加 B.corrected_by += [A.id]
- 同步窗口 < 5s
- 写入失败 → 写 audit warning，不阻塞
- v0.2+ 走 RFC 决定是否升级强一致（见 overview Q11）

### 5.4 `supersedes` 单向链（用于版本演化）

```yaml
supersedes:
  type: record_id?
  required: false
  e2ee_visibility: server
  notes: |
    指向被本 record 替代的旧版本。
    被指向的 record 必须自动设置 `valid_to = this.valid_from`。
    与 corrects 不同：supersedes 是同一条 fact 的版本演化，corrects 是错误纠正。
```

---

## 6. 错误标注（来自 ECC v2 实战）

ECC v2 dogfood 6 个月发现：用户纠正分两类——"永远错"和"特定 context 下错"。Schema 必须能区分。

### 6.1 `wrong_scope` + `wrong_behavior` + `correction_context`

```yaml
wrong_scope:
  type: enum [always, context-specific]
  required: when corrects is non-empty
  e2ee_visibility: server
  notes: |
    always:   被纠正的 memory 在任何场景都错（如"看到 UI 加载态就略过"）
    context-specific: 仅在特定上下文错（如"v1.1 cluster 用 fact-list 存学情"）

wrong_behavior:
  type: string (max 200 chars)
  required: when corrects is non-empty
  e2ee_visibility: client_only
  notes: 一行错误行为描述

correction_context:
  type: string (max 500 chars)
  required: when wrong_scope == "context-specific"
  e2ee_visibility: client_only
  notes: 在什么情境下错（架构版本、任务类型、特定 agent 等）
```

### 6.2 ECC v2 → Nemos 字段映射

| ECC v2 字段 | Nemos 字段 |
|---|---|
| `scope` (global / project:X / task:X) | `scope_id` (见 §7) |
| `source.authoritative: bool` | `source.kind` + `source.authoritative` 双写（兼容） |
| `source.origin_session` | `audit.created_session_id` |
| `source.chain_depth: 0` | `source.chain_depth` 同名 |
| `type` (user / feedback / project / reference / claude-self / ai-propose) | 走 `facet`（personal_semantic）或 `type` 枚举 + tag |
| `wrong_scope` | `wrong_scope`（同名） |
| `wrong_behavior` | `wrong_behavior`（同名） |
| `corrects` / `corrected_by` | 同名 |
| `last_verified_at` | `audit.mutations[-1].at` (when kind=verify) |
| `stability` | `fsrs.stability` |
| `private_zone` | `flags.private_zone` |

ECC v2 用户从单租户 markdown 迁到 Nemos 时，import adapter 走此映射表自动转换（见 §10.6）。

---

## 7. Scope + Ownership

### 7.1 `scope_id` 三段式语义（来自 ECC v2 D4 + Companion §2.3）

```yaml
scope_id:
  type: string
  format: "<kind>:<label>"
  required: true
  e2ee_visibility: server (HMAC)
  default: "global"
  examples:
    - "global"                          # 跨所有项目/scope 通用
    - "project:maolab"                  # 项目级
    - "task:#10"                        # 单一任务（task 结束归档）
    - "scope:work"                      # Companion 多 scope 模型
    - "scope:health"
    - "scope:creative"
    - "scope:relational:partner_alice"  # 特定关系 scope
```

**选择规则**：
- 跨所有项目都成立 → `global`
- 单项目 → `project:<name>`
- 单任务 → `task:<id>`
- Companion persona → `scope:<label>`

### 7.2 `ownership` 三层分类（SC7 + Substrate §10）

```yaml
ownership:
  kind:
    type: enum [self, relational, public]
    required: true
    e2ee_visibility: server
  principals:
    type: array<string>
    required: when kind == relational
    e2ee_visibility: server (id) + client_only (label)
    notes: relational 必填 ≥2 个 principal
  consent_status:
    type: enum [implicit, explicit, pending, revoked]
    required: true
    default: implicit (self) / pending (relational) / explicit (public)
    e2ee_visibility: server
  consent_records:
    type: array<consent_id>
    required: false
    default: []
    e2ee_visibility: server
```

### 7.3 Private Zone（I7）

```yaml
flags.private_zone:
  type: bool
  required: true
  e2ee_visibility: client_only
  default: false
  notes: |
    true 时该 record:
    - 永不参与 Reflect
    - 永不参与 Personal Semantic 合成
    - 永不参与 Cross-agent 共享
    - 永不主动 surface
    - 仅在用户显式 enter-zone 时返回
    
    Zone 标记本身不在 audit log summary 暴露（避免二阶泄露）
```

### 7.4 Relational Store ACL 模型

#### 7.4.1 PKI 假设

v0.1 用弱 identity：principal_id 是用户 email 的 sha256 hash。
未来（Round 3+）探 federation：见 overview Q4。

#### 7.4.2 跨 user 共享流程

```
1. User A 写一条 relational record (principals: [self, alice])
2. 服务端检查 alice 是否有 Nemos account（按 email hash 查 user table）
3. 若有：向 alice 发 share invitation
4. alice 接受 → share_decisions[..].effective = true，alice 可读
5. alice veto → effective = false，AgentMemoryCache invalidate
6. alice 不响应（超过 30 天）→ 按 manifest.default_policy 决定
```

#### 7.4.3 `principal_acl` 子结构

```yaml
principal_acl:
  type: object<principal_id, ACLEntry>
  required: true
  e2ee_visibility: server

ACLEntry:
  permission: enum [read, read_write, read_burn, none]
  agents:
    type: array<agent_id>
    notes: principal 允许哪些 agent 看到自己这边的副本
  consent_at: timestamptz
  expires_at: timestamptz?
```

#### 7.4.4 跨 user CRDT-merge

详见 Companion §8。Schema 层只需保证 `vector_clock` 字段存在。

### 7.5 字段级 vs 事件级权限（决议 4 / Companion §5）

- **字段级**（Personal Semantic 用）：`visibility` 子字段，控制单条 record 的子字段对哪些 scope/agent 可见
- **事件级**（Episodic / Relational 用）：`acl` 子字段，整条 record 的 ACL

```yaml
# Episodic / Relational 的事件级 acl
acl:
  type: object
  required: false
  e2ee_visibility: server
  schema:
    self: enum [read+write+burn, read+write, read, none]
    agents:
      default: enum [denied, read_with_redaction, read, read_write]
      rules: array<{agent_id, permission}>
    principals:
      type: object<principal_id, permission>
```

---

## 8. Lifetime Period（创作者 persona 用）

详见 Substrate §11 + Continuity §3。Schema 层定义独立 collection `lifetime_periods`：

```yaml
LifetimePeriod:
  id: string (period_<sha>)
  tenant_id: string
  user_id: string
  label:
    type: string
    required: true
    e2ee_visibility: client_only
    notes: "PhD at MIT" 这类标签可能泄漏
  started_at: date
  ended_at: date?                    # null = active
  active:
    type: bool
    required: true
    e2ee_visibility: server
    notes: 全 tenant+user 内仅一条 active=true（DB unique constraint）
  transition_marker:
    from_period_id: period_id?
    narrative_event_id: ep_id?
    user_declared: bool
    ai_proposed: bool
  tags: array<string>
  themes: array<string>
  default_context_for_reflect:
    type: bool
    default: true
  ownership: object (default {kind: self})
  
  # Continuity Layer 扩展（preset opt-in 才有）
  narrative_summary: string?
  user_titled: bool
  chapter_record_id: psem_id?
  muse_pull_enabled: bool (default false)
  deleted_scenes_count: int (default 0)
  narrative_events:
    high_points: array<ep_id>
    low_points: array<ep_id>
    turning_points: array<ep_id>
  
  audit: object
```

### 8.1 与 E2EE 的兼容

`label` / `narrative_summary` / `themes` 是 client_only；服务端只见 `period_id` (HMAC) + 时间区间 + active flag → 可做时间路由不泄漏内容。

### 8.2 unique 约束

```
UNIQUE (tenant_id, user_id) WHERE active = true
```

每用户同一时刻只能有一个 active period（见 overview Q10）。

---

## 9. 衰减字段 + FSRS 接口

### 9.1 `fsrs` 完整字段

```yaml
fsrs:
  stability:
    type: float
    required: true
    e2ee_visibility: server (E2EE 可选 client_only)
    default: 1.0
    notes: 当前稳定性（days）
  difficulty:
    type: float (1-10)
    required: true
    e2ee_visibility: server
    default: 5.0
  last_review_at:
    type: timestamptz
    required: true
    e2ee_visibility: server
    default: created_at
  next_review_at:
    type: timestamptz
    required: true
    e2ee_visibility: server
    default: computed
  retention_target:
    type: float (0.5-0.95)
    required: true
    default: 0.9
  base_factor:
    type: float
    required: true
    default: 1.0
    notes: |
      Personality preset 可调（Continuity = 3.0 / Researcher = 1.5）
  access_count:
    type: int (>=0)
    required: true
    default: 0
  last_accessed_at:
    type: timestamptz?
    required: false
    e2ee_visibility: server
```

### 9.2 跨 personality 的 base_factor 默认表

| Personality | episodic | personal_semantic | procedural |
|---|---|---|---|
| Universal default | 1.0 | 3.0 | 5.0 |
| Continuity preset | 3.0 | 5.0 | 5.0 |
| Companion preset | 1.0 | 3.0 | 5.0 |
| Witness preset | 1.0 | 3.0 | 3.0 |

（来自 Substrate §5.4）

### 9.3 服务端 vs 客户端 decay 选项

| SKU | decay 跑在哪 |
|---|---|
| a 公共云 | 服务端 nightly job |
| b E2EE | **客户端 SDK** 跑 decay；服务端只存 fsrs 字段，不算 |
| c 自托管 | 部署者自决（默认服务端） |

E2EE 客户端跑 decay 时，多设备需要 CRDT 仲裁（见 overview Q2 + Companion §8）。

### 9.4 R1-R12 信号 → stability 调整

| 信号 | stability 调整 | 触发位置 | E2EE 客户端可算 |
|---|---|---|---|
| R1 schema 冲突反例 | × 5 | Reflect | 否（需全库扫，客户端可） |
| R2 高 arousal | × (1+2·arousal) | hot path + Reflect | 是 |
| R3 self-referential | × 1.5 | hot path | 是 |
| R4 narrative event | × 4 | Reflect + 用户审批 | 半 |
| R5 life script event | × 3 | Reflect + 用户审批 | 半 |
| R6 高 surprise | × 2.5 | hot path + Reflect | 是 |
| R7 高 mutual information | × 2 | Reflect | 是 |
| R8 source 明确 (authoritative + depth=0) | × 1.5 | hot path | 是 |
| R9 元认知陈述 | × 2 | Reflect | 否（LLM 分类） |
| R10 用户引用 | × 2 / ref | hot path | 是 |
| R11 形成性时期 | × 1.5 (一次) | 写入时 | 是 |
| R12 graph 中心节点 | × 1.8 | Reflect | 半 |

**信号叠加用乘法**（避免线性放大失控）。每次调整必留 `audit.mutations` + `audit.signals_applied`。

### 9.5 `forget` 软遗忘字段

```yaml
flags.user_forget_intent:
  type: bool
  required: true
  default: false
  e2ee_visibility: server
  notes: 用户标 forget 后，fsrs.stability *= 0.1，加速自然衰减

audit.mutations[].kind:
  type: enum [..., forget, unforget, cool, ...]
```

### 9.6 `cool` 主题冷却

```yaml
flags.surface_cooldown_until:
  type: timestamptz?
  required: false
  default: null
  e2ee_visibility: server

flags.surface_cooldown_reason:
  type: enum [user_cool, witness_layer, ptsd_protocol, ...]?
  required: when cooldown_until set
  e2ee_visibility: server (但具体原因如 ptsd 走 client_only 标 hash)
```

---

## 10. Import / Export Schema

### 10.1 设计原则（决议 6 + Substrate §9）

- **格式可读性 > 完整性**：宁愿丢一些 personality-specific 元数据，也要保证另一厂商能解读核心结构
- **基于开放标准**：JSON-LD（schema.org-style）+ Markdown 双轨
- **本地优先**：用户能随时 `export → tar.gz` 到本地
- **content-addressed**：所有 ID 都是 sha256，跨厂商可校验
- **lossless re-export**：未知 `extensions.*` 必须被保留

### 10.2 顶层结构

```jsonc
// memory-export.jsonld
{
  "@context": "https://nemos.org/schema/v1",
  "@type": "PersonalMemoryArchive",
  "export_version": "1.0",
  "nemos_schema_version": "0.1",
  "exported_at": "2026-06-01T10:00:00Z",
  "exported_by": "user_self",
  "exported_from": "nemos-cloud-v0.1",
  "user_id_hash": "sha256(user_email)",
  "tenant_id_hash": "sha256(tenant_id)",
  "lifetime_periods": [...],
  "stores": {
    "archival":         {"count": 12340, "manifest": "stores/archival.jsonl"},
    "episodic":         {"count": 8203,  "manifest": "stores/episodic.jsonl"},
    "semantic":         {"count": 412,   "manifest": "stores/semantic.jsonl"},
    "personal_semantic":{"count": 87,    "manifest": "stores/personal_semantic.jsonl"},
    "procedural":       {"count": 23,    "manifest": "stores/procedural.jsonl"},
    "relational":       {"count": 156,   "manifest": "stores/relational.jsonl"}
  },
  "audit_logs":        "audit.jsonl",
  "consent_records":   "consent.jsonl",
  "capabilities":      "capabilities.jsonl",
  "manifests":         "manifests.jsonl",
  "reflections":       "reflections.jsonl",
  "checksum_manifest": "checksums.sha256"
}
```

### 10.3 每层 JSONL 行格式

每行是一条 record，schema 同 §2 但只保留 portable 字段（drop `fsrs` `embedding` 这种派生品）：

```jsonc
{
  "@type": "EpisodicMemory",
  "id": "ep_<sha>",
  "schema_version": "0.1",
  "tenant_id": "<orig>",
  "user_id": "<orig>",
  "type": "episodic",
  "scope_id": "global",
  "period_id": "period_2026_phd",
  "content": { "text": "...", "lang": "zh", "modality": "text" },
  "occurred_at": "...",
  "captured_at": "...",
  "context": { ... },
  "source": { ... },
  "arousal": { ... },
  "surprise": { ... },
  "ownership": { ... },
  "archival_ref": "arch_<sha>",
  "fsrs": null,
  "flags": { ... },
  "audit": { "created_at": "...", "created_by": "...", "mutation_count": 3, "signals_applied": [...] },
  "embedding": null,
  "embedding_model_id": "openai-text-embedding-3-small-v1",
  "extensions": {
    "continuity": { ... },          # Continuity preset 私有字段
    "companion": { ... }            # Companion preset 私有字段
  }
}
```

### 10.4 Markdown 双轨

每条 record 同时输出 markdown（用户在无 Nemos 时也能读，与 ECC v2 兼容）：

```markdown
---
name: ep_ab12cd34
type: episodic
scope: global
period_id: period_2026_phd
occurred_at: 2026-06-01T10:23:00+08:00
source:
  kind: authoritative
  chain_depth: 0
  authoritative: true
ownership: self
arousal:
  value: 0.45
  valence: 0.3
surprise:
  value: 1.83
  basis: embedding+entity_freq
archival_ref: arch_<sha>
flags:
  sensitive: false
  private_zone: false
audit:
  created_at: 2026-06-01T10:23:05+08:00
  created_by: user_self
---

# Episodic 2026-06-01 — 早晨写作

## Content

今早 6 点起床写了 800 字，状态很好...

## Context

- Location: home/study
- With: alice (relational)
- Preceding: ep_aa11...

## Source

User typed directly (authoritative, depth=0)
```

### 10.5 目录结构

```
nemos-export-20260601/
├── memory-export.jsonld
├── stores/
│   ├── archival.jsonl
│   ├── archival/
│   │   ├── arch_ab12.../raw.txt
│   │   └── arch_cd34.../raw.jpg
│   ├── episodic.jsonl
│   ├── episodic-md/
│   │   └── 2026/06/01/ep_ab12.md
│   ├── semantic.jsonl
│   ├── personal_semantic.jsonl
│   ├── procedural.jsonl
│   └── relational.jsonl
├── audit.jsonl
├── consent.jsonl
├── capabilities.jsonl
├── manifests.jsonl
├── reflections.jsonl
├── lifetime-periods.jsonl
└── checksums.sha256
```

### 10.6 Import adapter（从 ECC v2 / mem0 / Letta）

每个 import adapter 是独立小程序（`nemos import --from=ecc-v2 --path=...`），由 Nemos CLI 提供：

| 源 | 路径 |
|---|---|
| ECC v2 markdown | `nemos-import-ecc-v2` |
| mem0 export | `nemos-import-mem0`（社区贡献） |
| Letta archive | `nemos-import-letta`（社区贡献） |
| Memory-Palace | `nemos-import-memory-palace`（社区贡献） |

Adapter 责任：
- 字段映射（见 §6.2 for ECC v2）
- 缺失字段填默认（`source.kind` 推断 / `scope_id` 默认 `"global"`）
- 完整性校验（sha256 重算）
- 写入失败 → 输出 reject_log.jsonl 报告

### 10.7 跨 SKU 迁移（a ↔ b ↔ c）

| 路径 | 步骤 |
|---|---|
| a → b | 客户端拉全量 export → 客户端密钥加密 → 上传密文 → 服务端 vacuum 明文 |
| a → c | export tar.gz → 自部署 import |
| c → a | 同上反向 |
| b → c | 客户端密钥解密 → export → import 到自托管 |
| b → a | 客户端解密 + 重新走服务端加密 |

所有路径通过同一 export schema。

### 10.8 不变量

- 任何 personality-layer 数据 → `extensions.<vendor>: {...}` 子字段
- 跨厂商导入未知 `extensions` 必须保留（lossless re-export）
- `archival.raw_content.bytes` 必须导出（不只导元数据）
- `checksums.sha256` 必须重算后写入

---

## 11. Schema 演化策略

### 11.1 字段添加规则

| 操作 | 允许 | 兼容性影响 |
|---|---|---|
| 增 optional 字段 | ✅ | 无（v0.x minor bump） |
| 增 required 字段 | ❌ v0.x | 需 v(major+1)，配 migration |
| 改字段类型（如 int → bigint） | ❌ 在 v0.x | 同上 |
| 改字段名（rename） | ❌ | 同上 |
| 改 enum 增值 | ✅ | minor bump；旧 client 必须能 ignore unknown enum |
| 改 enum 删值 | ❌ | major bump |
| Deprecate 字段（标 @deprecated） | ✅ | minor bump；2 个 minor 后允许删 |

### 11.2 每条 record 的 schema_version 字段

```yaml
schema_version:
  type: string (SemVer)
  required: true
  default: "0.1"
  e2ee_visibility: server
```

读取方按版本路由：
- 同 minor → 直接读
- 跨 minor → 走 migration adapter（nemos-server 内置）
- 跨 major → REJECT，提示用户运行 nemos-cli migrate

### 11.3 向前/向后兼容承诺

- **向后兼容**（新版本读旧数据）：v0.x 内强制保证；v1.0+ 走 RFC
- **向前兼容**（旧版本读新数据）：v0.x 期间 best-effort（未知 optional 字段 ignore；未知 required 字段 REJECT）
- **Export schema 永远向后兼容**：任意 v0.x export 必须能被任意 v0.y (y >= x) import

### 11.4 Migration adapter 接口

nemos-server 内置 migration registry：
```
migrations:
  - from: "0.1"
    to: "0.2"
    script: migrate_0_1_to_0_2.py
    direction: forward_only
    breaking_changes: []
    field_changes:
      - kind: add_optional
        field: ...
```

任何部署升级版本时必须先跑 `nemos migrate --dry-run`。

### 11.5 v0 → v1 路径

```
v0.1 → v0.2 → ... → v0.9 → v0.9-rc1 → v0.9-rc2 → ... → v1.0
                              ↑
                          冻结期 ≥ 1 个月，征集第三方实现反馈
```

v1.0 之后 schema 变更走 RFC + 至少 6 个月 deprecation 窗口。

---

## 12. E2EE 字段可见性总表（最终对账）

| 字段 | SKU a 服务端 | SKU b 服务端 | 备注 |
|---|---|---|---|
| `id` | 明文 | 明文 | content-addressed |
| `tenant_id`, `user_id` | 明文 | 明文 | 路由 |
| `scope_id` | 明文 | HMAC | E2EE 防 scope label 泄漏 |
| `period_id` | 明文 | HMAC | 同上 |
| `type`, `schema_version` | 明文 | 明文 | 路由 |
| `created_at`, `occurred_at` | 明文 | 明文 (可选 day bucket) | |
| `content.text` | 明文 | 密文 | 主体 |
| `content.lang`, `content.modality` | 明文 | 明文 | 路由 |
| `content.attachments` | 明文 | 密文 | |
| `context.location`, `social.with` | 明文 | 密文 | 可能泄漏 |
| `context.device`, `app_origin` | 明文 | 明文 | 路由 |
| `source.kind` | 明文 | 明文 | I4 路由必需 |
| `source.chain_depth` | 明文 | 明文 | 同上 |
| `source.origin_id` | 明文 | 密文 | 可能含 user_id 之外的 origin |
| `source.origin_agent` | 明文 | 明文 | Companion 多 agent 路由 |
| `arousal.value` | 明文 | bucket | 客户端算精确 |
| `arousal.signal_sources` | 明文 | 密文 | |
| `surprise.value` | 明文 | bucket | 同 arousal |
| `ownership.kind` | 明文 | 明文 | 路由 |
| `ownership.principals` | 明文 | 明文 (id) + 密文 (label) | relational 路由 |
| `fsrs.stability` | 明文 | 明文 (E2EE 客户端可覆盖) | |
| `flags.sensitive` | 明文 | 密文 | 内容判断 |
| `flags.private_zone` | 明文 | 密文 | 同上 |
| `flags.do_not_reflect` | 明文 | 明文 | 服务端调度 |
| `flags.legal_hold` | 明文 | 明文 | 法律 |
| `audit.created_by` | 明文 | 明文 | |
| `audit.agent_signature` | 明文 | 明文 | 跨 agent 防串供 |
| `audit.mutations[]` | 明文 | metadata 明文 + content 密文 | |
| `embedding` | 明文 | 密文（客户端存或服务端只存密文） | embedding inversion 攻击防御 |
| `embedding_model_id` | 明文 | 明文 | |
| `archival_ref` | 明文 | 明文 | 索引 |
| `raw_content.bytes` | 明文 | 密文 | |
| `raw_content.mime`, `size_bytes` | 明文 | 明文 | 路由 |

### 12.1 E2EE 服务端能做什么、不能做什么

**能做**：
- 按 `tenant_id` + `user_id` + `scope_id_hash` + `period_id_hash` 过滤
- 按 `type` / `ownership.kind` / `source.kind` 路由
- 按时间区间过滤
- 按 `flags.do_not_reflect` / `legal_hold` 调度
- 按 arousal/surprise bucket 排序
- relational store 的 vector clock 仲裁

**不能做**：
- 全文检索（FTS）→ 客户端 SQLite FTS5
- 向量 ANN 检索 → 客户端 hnswlib
- Reflect / MDL abstraction → 客户端 LLM call
- Contradiction detection（语义层）→ 客户端

详见 sizing §7.1 + Round 2 Q5。

---

## Handoff

> **下一步**：读 `20-rest-api.md`（基于本 schema 暴露 HTTP 接口）+ `30-mcp-server.md`（MCP 协议适配）+ `40-sdk-contract.md`（开发者 import 用的客户端接口）。

**End of data-schema.**
