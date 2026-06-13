# mnemos v0.1 — REST API (20-rest-api)

> **状态**：Draft，Round 1 输出
> **版本**：v0.1
> **更新**：2026-06-04
> 配套阅读：`00-overview.md` + `10-data-schema.md`
> Spec 格式：OpenAPI 3.1（本文档是人读版；机器读版见 `openapi.yaml`，Round 2 产出）

---

## 0. 阅读地图

| 节 | 内容 |
|---|---|
| §1 | API 基础（base URL / 版本 / 内容协商 / idempotency） |
| §2 | 认证模型（OAuth + per-agent capability JWT） |
| §3 | 错误模型（problem+json） |
| §4 | 速率限制 |
| §5 | 端点目录 |
| §6 | 各端点详细定义 |
| §7 | 延迟预算与 hot-path 端点 |
| §8 | 分页与游标 |
| §9 | E2EE SKU 的端点行为差异 |

---

## 1. API 基础

### 1.1 Base URL

```
SKU a 公共云:     https://api.mnemos.org/v1
SKU b E2EE:       https://api.mnemos.org/v1     (同 URL，密文走 body)
SKU c 自托管:     http://localhost:8080/v1       (默认)
```

### 1.2 版本化

URL 内嵌主版本：`/v1`。次版本通过 `MnemosSchema-Version: 0.1` 响应 header 暴露。

v0.x 期间 `/v1` 是 alias（v0.x = pre-1.0 不稳定期）。v1.0 GA 时 `/v1` 冻结。

### 1.3 内容协商

- 请求与响应默认 `application/json`
- Export 端点支持 `application/json+ld`、`application/tar+gzip`
- 错误响应 `application/problem+json`（RFC 7807）

### 1.4 Idempotency

所有 POST 写入端点必须支持 `Idempotency-Key` header：
- key 由 client 生成（UUID v4 或 ULID）
- 24h 内同 key 重放 → 服务端返回首次的响应（200 / 201）
- 超过 24h → 视为新请求

幂等的客户端职责：
- write hot path 必带 Idempotency-Key（网络抖动重试）
- bulk import 必带

### 1.5 Content-addressed 校验

写入响应必返回 `record.id`。客户端可重算 sha256 比对（防中间人篡改）。

---

## 2. 认证模型

### 2.1 三类调用者

| 调用者 | 认证方式 | 范围 |
|---|---|---|
| User dashboard / CLI | OAuth 2.0 access token（用户登录） | 该 user 全量 |
| AI App（带 capability） | per-agent JWT + agent signing key | capability 限定的 scope/facet |
| Server-to-server（管理） | API key（部署管理员） | 部署级管理 |

### 2.2 OAuth 2.0 流（用户）

```
Authorization: Bearer <access_token>
```

- Access token TTL = 15 min
- Refresh token TTL = 90 days
- 端点 `/auth/token`（OAuth 2.1 标准）

### 2.3 Per-agent Capability JWT（AI app）

每个 AI app 在 mnemos 中注册 → 获得：
- `agent_id`
- `agent_private_key`（Ed25519，仅初始化时返回）
- `capability_jwt`（无过期，可 revoke）

调用时：
```http
Authorization: Bearer <capability_jwt>
X-Agent-Signature: <Ed25519 sign of body + timestamp>
X-Timestamp: 2026-06-04T10:00:00Z
```

JWT claim：
```json
{
  "iss": "mnemos.org",
  "sub": "agent_<id>",
  "tenant_id": "...",
  "capability_id": "cap_<id>",
  "agent_kind": "code_editor",
  "scopes": ["scope:work"],
  "read": ["preference.coding_style", "preference.frameworks"],
  "write_kinds": ["episodic", "procedural"],
  "must_have_source": "agent_observation",
  "chain_depth_start": 1,
  "rate_limit": "100/hour",
  "iat": 1717488000
}
```

服务端拒绝任何 JWT claim 之外的操作（capability check，详见 Companion §3.2）。

### 2.4 Agent 注册流（用户主导）

```
POST /agents/register
Authorization: Bearer <user_access_token>
Body: {
  agent_kind: "code_editor",
  display_name: "Cursor IDE",
  requested_capability: { scopes, read, write_kinds, ... }
}
→ 200 {
  agent_id, capability_id, capability_jwt, agent_private_key  // 仅此一次返回
}
```

用户在 dashboard UI 二次确认才生成 JWT。

### 2.5 Revoke

```
DELETE /agents/{agent_id}
Authorization: Bearer <user_access_token>
→ 204
```

所有该 agent 的后续调用 → 401。已写入的 record 不删（保留 audit），但用户可批量 burn by `audit.created_by = agent_id`。

### 2.6 E2EE SKU 下的认证差异

- OAuth + JWT 同上
- 额外：客户端要传 `X-Tenant-Key-Fingerprint`（用户密码派生 key 的 hash，证明持有，但不传 key 本体）
- 服务端用 fingerprint 路由到正确的密文 bucket

---

## 3. 错误模型（problem+json）

### 3.1 响应格式（RFC 7807）

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type": "https://mnemos.org/errors/source-routing-violation",
  "title": "Source routing violation",
  "status": 422,
  "detail": "source.kind=derived cannot write to personal_semantic store (I4 invariant)",
  "instance": "/v1/records/personal_semantic",
  "mnemos_error_code": "I4_VIOLATION",
  "invariant_violated": "I4",
  "fix_hint": "Use POST /v1/reflect-proposals instead, or change source.kind to authoritative"
}
```

### 3.2 错误码表

| HTTP | code | 含义 |
|---|---|---|
| 400 | INVALID_PAYLOAD | JSON 结构错误 |
| 400 | SCHEMA_VERSION_UNSUPPORTED | record.schema_version 超 server 范围 |
| 401 | UNAUTHENTICATED | 缺 / 错 token |
| 403 | CAPABILITY_DENIED | capability 不允许此操作 |
| 403 | MANIFEST_DENIED | sharing manifest 拒绝 |
| 403 | ACL_DENIED | record acl/visibility 拒绝 |
| 404 | RECORD_NOT_FOUND | id 不存在 / 在另一 tenant |
| 409 | CONTRADICTION | 写入触发同/反 schema 冲突，需 policy 决议 |
| 409 | CONCURRENT_MODIFY | version 不一致（乐观锁） |
| 410 | RECORD_BURNED | id 曾存在但已 burn |
| 422 | I3_VIOLATION | 试图 mutate archival |
| 422 | I4_VIOLATION | derived 写 personal_semantic |
| 422 | I7_VIOLATION | 试图自动 surface private_zone |
| 422 | INVARIANT_VIOLATION | 其他不变量违反 |
| 422 | METADATA_MISSING | 三维元数据缺失 |
| 422 | SIGNATURE_INVALID | agent_signature 不通过 |
| 429 | RATE_LIMITED | 超速 |
| 451 | LEGAL_HOLD | record 在 legal_hold，不可 burn |
| 500 | INTERNAL_ERROR | 服务端 bug |
| 503 | DEGRADED | E2EE 客户端索引未同步 / 服务端降级 |

### 3.3 错误 body 字段

- `mnemos_error_code` 是机器可读的常量（不变）
- `invariant_violated` 列出违反的不变量编号（I1-I10）
- `fix_hint` 是给开发者的人类可读建议
- 422 错误必须给 `fix_hint`

---

## 4. 速率限制

### 4.1 默认限额

| 调用者 | per-minute | per-day |
|---|---|---|
| 免费用户（SKU a） | 100 | 10,000 |
| Pro 用户（SKU a） | 1,000 | 100,000 |
| E2EE 付费（SKU b） | 1,000 | 100,000 |
| 自托管（SKU c） | 无限（部署者配置） | — |
| AI agent（per JWT） | JWT.rate_limit 字段 | 同上 |

突发 token bucket = 2 × rate。

### 4.2 速率限制响应 header

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1717488060
Retry-After: 30                         (仅 429 时)
```

### 4.3 滥用防护

- per-IP rate limit（防匿名爆破）
- 异常 burn 操作触发 60s 冷静期（要求用户 dashboard 再次确认）
- agent JWT 超出 rate_limit 3 次 → 自动 cool 1 小时 + 通知用户

---

## 5. 端点目录

| 分组 | 端点 | 方法 | 说明 |
|---|---|---|---|
| Records CRUD | `/records` | POST | 写入单条 record（自动路由到对应 store） |
| | `/records/{id}` | GET | 读取单条 |
| | `/records/{id}` | DELETE | 软删（forget intent） |
| | `/records/bulk` | POST | 批量写入（import 用） |
| | `/records/query` | POST | 复合查询（M2 hot-path） |
| | `/records/{id}/versions` | GET | 获取 supersede 链 |
| Store-specific | `/episodic` | GET POST | episodic 专用 |
| | `/semantic` | GET POST | |
| | `/personal-semantic` | GET POST | （I4 强校验） |
| | `/procedural` | GET POST | |
| | `/archival/{id}/raw` | GET | 拿 raw bytes |
| Hot-path inject | `/inject/session-start` | POST | M1：session 启动 bulk inject |
| | `/inject/query` | POST | M2：单次 hot-path query（最严延迟） |
| Reflect | `/reflect/run` | POST | 触发离线 reflect（异步） |
| | `/reflect/runs/{id}` | GET | run 状态 |
| | `/reflect-proposals` | GET | pending proposals（用户审批） |
| | `/reflect-proposals/{id}/accept` | POST | 接受 proposal → 写入 personal_semantic |
| | `/reflect-proposals/{id}/reject` | POST | 拒绝 |
| Forgetting | `/forget` | POST | 软遗忘（scope） |
| | `/burn` | POST | GDPR 反编译（强校验 + 二次确认 token） |
| | `/cool` | POST | 主题冷却 |
| | `/decay/{id}` | GET | 未来留存曲线预测 |
| Lifetime Period | `/periods` | GET POST | |
| | `/periods/{id}/close` | POST | 关闭并切新 |
| | `/periods/{id}/proposals` | GET | AI chapter-break proposal |
| Relational | `/relational/records` | POST GET | |
| | `/relational/records/{id}/share` | POST | 跨 user share |
| | `/relational/records/{id}/veto` | POST | veto share |
| Companion | `/agents/register` | POST | |
| | `/agents/{id}` | GET DELETE | |
| | `/capabilities` | GET | 当前 user 的 capability 列表 |
| | `/manifest` | GET PUT | sharing manifest |
| Identity | `/identity` | GET PUT | CoreIdentity |
| | `/identity/scopes` | GET POST | scope 管理 |
| | `/identity/inheritor-manifest` | GET PUT | 死后 manifest |
| Audit | `/audit/events` | GET | audit log 查询 |
| Export/Import | `/export` | POST | 触发 export，返回 job_id |
| | `/export/jobs/{id}` | GET | 状态 / 下载链接 |
| | `/import` | POST | 上传 tar.gz import |
| Health | `/health` | GET | liveness |
| | `/health/ready` | GET | readiness（含 DB / embedding） |
| | `/meta` | GET | 部署元信息（SKU / schema_version / e2ee_mode） |

---

## 6. 各端点详细定义

下面只列关键端点；其余端点遵循同样的模式。完整 OpenAPI 见 `openapi.yaml`。

### 6.1 POST /records — 写入单条

**用途**：通用写入入口；服务端按 `type` 字段路由到对应 store。

#### Request

```http
POST /v1/records
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
X-Agent-Signature: <ed25519 sig>
X-Timestamp: 2026-06-04T10:00:00Z
Content-Type: application/json

{
  "type": "episodic",
  "schema_version": "0.1",
  "scope_id": "scope:work",
  "period_id": "period_2026_phd",
  "content": {
    "text": "今早 6 点起床写了 800 字",
    "lang": "zh",
    "modality": "text"
  },
  "occurred_at": "2026-06-04T06:30:00+08:00",
  "context": {
    "app_origin": "cursor",
    "device": "macbook"
  },
  "source": {
    "kind": "authoritative",
    "chain_depth": 0,
    "authoritative": true,
    "extractor": "user_typed",
    "origin_agent": null
  },
  "arousal": {
    "value": 0.45,
    "valence": 0.3,
    "signal_sources": [{"name": "lexicon", "score": 0.4}],
    "computed_by": "rule_v1",
    "algorithm_version": "rule_v1"
  },
  "surprise": {
    "value": 1.83,
    "basis": "embedding+entity_freq",
    "algorithm_version": "embed_centroid_v1"
  },
  "ownership": { "kind": "self" },
  "flags": {}
}
```

#### Response

```http
HTTP/1.1 201 Created
MnemosSchema-Version: 0.1
Location: /v1/records/ep_ab12...

{
  "id": "ep_ab12cd34...",
  "archival_ref": "arch_ef56...",
  "type": "episodic",
  "created_at": "2026-06-04T10:00:00Z",
  "audit": {
    "created_by": "agent_cursor",
    "signals_applied": ["R8", "R3"],
    "agent_signature_verified": true
  }
}
```

#### 写入流（服务端）

```
1. JWT 校验（包括 agent_signature 验证）
2. Capability check（来自 JWT 的 read/write claim）
3. Schema validate（必填字段 + enum）
4. I2 三维元数据完整性检查
5. I4 + I9：source.kind + chain_depth → store 路由表
6. If type == personal_semantic and source.kind != authoritative: REJECT 422 I4_VIOLATION
7. If type == archival: REJECT 422 I3_VIOLATION (use /archival POST 专用端点)
8. Archival write（自动派生）：服务端先写 archival raw_content，再写 episodic 指向之
9. ID 算法（§3.1 of schema）: 计算 sha256(canonical) → set record.id
10. Idempotency-Key 检查：24h 内重复 → 返回首次结果
11. Contradiction detector check（同/反 schema）
12. If contradiction: 按 policy 走（report / evolve / preserve_counter）
13. R1-R12 signals 扫描 + fsrs.stability 调整
14. Write to store + audit log
15. Return 201
```

#### 失败码

- 401 缺 token / 签名 invalid
- 403 capability 不允许 type / scope
- 422 I4_VIOLATION / METADATA_MISSING / SIGNATURE_INVALID
- 409 CONTRADICTION（含 policy 提示）

### 6.2 POST /inject/query — M2 hot-path（最严延迟）

**用途**：AI agent 在对话中间问 "我需要查 X"。这是延迟生死路径（M2 P50 < 100ms，P99 < 300ms）。

#### Request

```http
POST /v1/inject/query
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "query": {
    "text": "用户的写作偏好",                       // 自然语言
    "embedding": [0.1, ...],                       // 可选，客户端预算
    "filters": {
      "type": ["personal_semantic", "semantic"],
      "scope_id": "scope:work",
      "period_id": "active",                       // active 字面常量
      "facet": ["preference"],
      "ownership.kind": ["self"]
    },
    "top_k": 5,
    "min_confidence": 0.5,
    "max_age_days": null
  }
}
```

#### Response（必须 < 100ms P50）

```http
HTTP/1.1 200 OK
MnemosSchema-Version: 0.1
X-Query-Latency-Ms: 47

{
  "records": [
    {
      "id": "psem_...",
      "type": "personal_semantic",
      "facet": "preference",
      "key": "writing_time",
      "value": "early morning",
      "confidence": 0.95,
      "source": { "kind": "authoritative", "chain_depth": 0 },
      "score": 0.89,
      "rerank_reason": ["semantic_match", "R10_recently_referenced"]
    },
    ...
  ],
  "query_id": "q_<ulid>",                            // 用于 audit 关联
  "filters_applied": { ... },                        // 服务端实际应用的过滤
  "next_cursor": null
}
```

#### 延迟预算

| 阶段 | 预算 |
|---|---|
| JWT 校验 + capability check | < 3ms |
| Filter index lookup | < 5ms |
| Vector ANN（pgvector HNSW） | < 30ms |
| FTS rerank | < 10ms |
| Witness Layer 过滤（敏感度） | < 5ms |
| 序列化 | < 5ms |
| **服务端总** | **< 60ms** |

加上 SDK 30-60ms 网络 → 客户端体感 < 100ms。

### 6.3 POST /inject/session-start — M1 bulk inject

**用途**：AI app cold-start 时 bulk pull top-N。

```http
POST /v1/inject/session-start
{
  "session": {
    "app_origin": "cursor",
    "scope_id": "scope:work",
    "period_id": "active"
  },
  "want": {
    "personal_semantic": { "top_k": 50, "facets": ["preference", "voice", "coding_style"] },
    "semantic": { "top_k": 10 },
    "episodic": { "top_k": 20, "by": "recency_x_stability_x_R10" },
    "procedural": { "top_k": 5 }
  }
}
→ 200
{
  "session_id": "sess_<ulid>",
  "records": {
    "personal_semantic": [...],
    "semantic": [...],
    "episodic": [...],
    "procedural": [...]
  }
}
```

延迟预算：P50 < 500ms，P99 < 2s。

### 6.4 POST /reflect/run — 触发离线 reflect（异步）

**用途**：手动 / cron 触发。

```http
POST /v1/reflect/run
{
  "scope_id": "scope:work",
  "window": { "from": "2026-06-01", "to": "2026-06-04" },
  "trigger": "user_explicit" | "schedule" | "event:chapter_close",
  "config": {
    "do_not_reflect_flag_respected": true,         // 永真，不可关
    "mdl_threshold": 0.3
  }
}
→ 202 Accepted
{
  "run_id": "reflect_<ulid>",
  "status": "queued",
  "estimated_duration_s": 60,
  "status_url": "/v1/reflect/runs/reflect_<ulid>"
}
```

#### GET /reflect/runs/{id}

```
→ 200
{
  "run_id": "...",
  "status": "running" | "completed" | "failed",
  "started_at": "...",
  "completed_at": "...",
  "records_processed": 142,
  "summaries_written_to_semantic": 3,
  "proposals_for_personal_semantic": 2,
  "stability_changes_count": 18,
  "contradictions_resolved": 0,
  "user_review_required": ["proposal_<id1>", "proposal_<id2>"],
  "rollback_until": "2026-07-04T...",
  "audit_log_url": "/v1/audit/events?reflect_run_id=..."
}
```

#### 不变量

- Reflect 永不修改 archival（I3）
- Reflect 永不自动写 personal_semantic（I4）—— 只能写 proposal
- 任何 reflect 输出可在 30 天内 rollback

### 6.5 POST /burn — GDPR 反编译

**用途**：硬删，从所有派生层移除。

```http
POST /v1/burn
Authorization: Bearer <user_access_token>     # 必须 user token，不允许 agent
Content-Type: application/json

{
  "target": {
    "kind": "single" | "topic" | "time_range" | "period" | "ownership_principal" | "agent",
    "id": "ep_..."                           # kind=single
    // 或 topic: "...", time_range: {from, to}, ...
  },
  "confirm_token": "BURN-AB12CD"             # 6 字符 token，从 GET /burn/confirm 拿
}
→ 200
{
  "burned_archival_count": 12,
  "affected_summaries_count": 3,
  "affected_summaries_action": "regenerated|marked_stale|deleted",
  "burn_receipt_id": "burn_<ulid>",
  "irreversible": true
}
```

#### GET /burn/confirm

```http
POST /v1/burn/confirm
{ "target": {...}, "preview": true }
→ 200
{
  "confirm_token": "BURN-AB12CD",            # 5min TTL
  "preview": {
    "archival_count": 12,
    "episodic_count": 8,
    "semantic_affected": 3,
    "personal_semantic_affected": 1,
    "estimated_cascade_seconds": 4
  },
  "warning": "irreversible - re-import from external backup is the only recovery"
}
```

#### 不变量

- 必须 user token（agent JWT 拒绝）
- 必须 confirm_token（5min TTL）
- 必须 record 不在 legal_hold（否则 451）
- Burn 异步执行：response 立即返回 receipt；实际 cascade 后台跑
- burn_log 不可被 burn

### 6.6 POST /forget — 软遗忘

```http
POST /v1/forget
{
  "target": { "kind": ..., ... },
  "reason": "user_decision"
}
→ 200
{
  "affected_count": 5,
  "fsrs_adjusted": true,
  "user_can_undo_until": "2026-09-04T..."     # forget 是可逆的
}
```

### 6.7 POST /cool — 主题冷却

```http
POST /v1/cool
{
  "topic": "string or embedding",
  "duration": "P30D"                          # ISO 8601 duration
}
→ 200
{
  "affected_count": 3,
  "cooldown_until": "..."
}
```

### 6.8 GET /export — 触发导出

```http
POST /v1/export
{
  "format": "jsonld+markdown",
  "include": ["all"],                          # 或 ["episodic", "personal_semantic"]
  "scope_id": null,                            # null = 全部
  "encrypted": false                           # SKU b 下默认 true
}
→ 202
{
  "job_id": "export_<ulid>",
  "status": "queued",
  "estimated_duration_s": 30,
  "status_url": "/v1/export/jobs/export_<ulid>"
}

GET /v1/export/jobs/{id}
→ 200
{
  "status": "completed",
  "download_url": "https://...",               # presigned, 1h TTL
  "size_bytes": 158234,
  "checksum_sha256": "..."
}
```

### 6.9 POST /import

```http
POST /v1/import
Content-Type: multipart/form-data

file=@mnemos-export.tar.gz
mode=replace|merge|dry_run
adapter=mnemos-v0|ecc-v2|mem0
→ 202
{
  "job_id": "import_<ulid>",
  ...
}
```

### 6.10 GET /meta — 部署元信息

```http
GET /v1/meta
→ 200
{
  "sku": "a" | "b" | "c",
  "schema_version": "0.1",
  "server_version": "v0.1.4",
  "e2ee_mode": false,
  "capabilities_supported": [
    "reflect", "muse_pull", "relational", "lifetime_periods"
  ],
  "embedding_models": ["openai-text-embedding-3-small-v1"],
  "max_record_bytes": 1048576,
  "audit_retention_days": 730
}
```

AI app 用此端点判断本部署支持什么。

### 6.11 GET /audit/events

```http
GET /v1/audit/events?from=2026-06-01&kind=stability_adjust&record_id=ep_...
→ 200
{
  "events": [
    {
      "audit_id": "audit_<ulid>",
      "at": "...",
      "kind": "stability_adjust",
      "by": "system",
      "record_id": "ep_...",
      "signals_applied": ["R6", "R10"],
      "before": { "stability": 2.5 },
      "after":  { "stability": 5.0 },
      "reason": "R6 surprise > 2.0 bits"
    }
  ],
  "next_cursor": "..."
}
```

### 6.12 PUT /manifest — 更新 sharing manifest

```http
PUT /v1/manifest
Authorization: Bearer <user_access_token>     # 用户操作，不允许 agent
{
  "version": 4,
  "default_policy": "opt_in",
  "rules": [...],
  "signature": "<user signed canonical JSON>"
}
→ 200
{
  "manifest_id": "manif_<ulid>",
  "previous_version": 3,
  "active_from": "...",
  "audit_id": "audit_<ulid>"
}
```

manifest 变更必须用户 signed payload（防 agent 越权改 manifest）。

---

## 7. 延迟预算与 hot-path 端点

| 端点 | M-模式 | P50 目标 | P99 目标 | 备注 |
|---|---|---|---|---|
| POST /inject/query | M2 | 100ms | 300ms | 生死路径 |
| POST /inject/session-start | M1 | 500ms | 2s | bulk inject |
| POST /records | M4 | 300ms | 800ms | 含 contradiction check + R1-R12 |
| POST /reflect/run | M3 | 30s | 120s | 异步，不影响 hot path |
| POST /relational/records/{id}/share | M5 | 200ms | 500ms | 跨 user |
| GET /records/query (time-travel) | M6 | 2s | 5s | period_id query |
| POST /export | M7 | n/a | n/a | 异步 job |
| GET /audit/events | M7 | 500ms | 2s | |
| GET /multimodal | M8 | 1s | 3s | CLIP/CLAP query |

### 7.1 hot-path 端点的额外约束

`/inject/query` 与 `/inject/session-start` 必须：
- 不阻塞写入（read-replica）
- 不调用 LLM（任何 LLM 调用走 reflect 异步）
- 不做 contradiction detect（已有 record 不重做）
- 不做 reflect（明确分离）
- 不做 multimodal heavy processing（multimodal 走独立端点）

---

## 8. 分页与游标

### 8.1 Cursor-based pagination（推荐）

```
GET /v1/records/query?cursor=eyJpZCI6ImVwXz...&limit=50
→ 200
{
  "records": [...],
  "next_cursor": "eyJpZCI6...",                # null = 无更多
  "prev_cursor": "eyJpZCI6..."
}
```

cursor 是 base64 编码的 `{last_id, last_sort_key, direction}`，opaque。

### 8.2 Limit 上限

- 默认 limit = 20
- 最大 limit = 100
- bulk 端点（/records/bulk / /import）单批 max 1000

### 8.3 不允许 offset-based pagination（性能差）

---

## 9. E2EE SKU 的端点行为差异

### 9.1 写入差异

- `content.text` `arousal.signal_sources` `surprise.value` 等 `client_only` 字段 → 客户端发送密文字段 `content_encrypted: <base64>` + IV
- 服务端不解密，按 metadata（scope_id_hash / type / source.kind / arousal.value_bucket）路由存储
- embedding 由客户端算后上传密文（或不上传，由客户端本地 HNSW 索引）

### 9.2 查询差异

- `/inject/query` 在 E2EE SKU 下：
  - 服务端只能按 metadata filter（time / scope / type / kind / bucket）
  - 返回 metadata-filtered candidate set（去掉密文 content）
  - 客户端 SDK 接收后用本地 HNSW + FTS 做语义重排，返回最终 top_k

- 服务端不做 FTS / ANN，端点行为退化为 metadata-only query
- SDK 内部把这两条路径透明化（开发者写同样 query 调用）

### 9.3 端点元信息差异

- `GET /meta`: `"e2ee_mode": true`
- `POST /reflect/run`: 在 E2EE 下走 client-side reflect（SDK 内置 LLM call），服务端只收 reflect 后的密文 summary

### 9.4 Burn 差异

E2EE 服务端 burn 后还需要客户端清理本地 mirror：
- 服务端 burn 后返回 `burned_record_ids[]`
- SDK 监听该事件，本地 SQLite + HNSW 同步删除

---

## 10. 端点版本协商 + Deprecation

### 10.1 Deprecation header

```
Deprecation: true
Sunset: 2027-01-01
Link: <https://docs.mnemos.org/migrate/v0.2-v0.3>; rel="successor-version"
```

任何 deprecated 端点必须保留 ≥ 6 个月。

### 10.2 Feature flags（per-request）

```
X-Mnemos-Features: muse-pull,relational-crdt-v2
```

服务端按 capability + feature flag 路由到不同实现。Round 2+ 用。

---

## 11. 安全 header

所有响应包含：

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

---

## Handoff

> 下一步：读 `30-mcp-server.md`（MCP 协议适配）。

**End of rest-api.**
