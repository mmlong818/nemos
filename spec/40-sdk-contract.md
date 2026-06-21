# Nemos v0.1 — SDK 接口契约 (40-sdk-contract)

> **状态**：Draft，Round 1 输出
> **版本**：v0.1
> **更新**：2026-06-04
> 配套阅读：`00-overview.md` + `10-data-schema.md` + `20-rest-api.md` + `30-mcp-server.md`

---

## 0. 阅读地图

| 节 | 内容 |
|---|---|
| §1 | SDK 姿态：直接调 REST，不包 MCP |
| §2 | TypeScript SDK 接口 |
| §3 | Python SDK 接口 |
| §4 | 配置项 |
| §5 | 客户端缓存策略（L1/L2/L3） |
| §6 | E2EE SKU 下 SDK 承担的客户端职责 |
| §7 | 错误处理与重试 |
| §8 | 离线模式 |
| §9 | 不变量（SDK 层） |

---

## 1. SDK 姿态

### 1.1 直接调 REST，不包 MCP

```
                    ┌─────────────────────┐
                    │   Developer code    │
                    └──────────┬──────────┘
                               │ import @nemos/sdk
                               ▼
                    ┌─────────────────────┐
                    │   nemos SDK        │  ← 本文档定义
                    │   (TS / Python)     │
                    └──────────┬──────────┘
                               │ HTTP/2 + JSON
                               ▼
                    ┌─────────────────────┐
                    │   nemos REST API   │  ← 见 20-rest-api.md
                    └─────────────────────┘
                               
                    ─────────────────────────
                    AI app 集成 MCP server 用：
                    ─────────────────────────
                    
                    ┌─────────────────────┐
                    │   AI app (Cursor)   │
                    └──────────┬──────────┘
                               │ MCP JSON-RPC
                               ▼
                    ┌─────────────────────┐
                    │   nemos-mcp        │  ← 见 30-mcp-server.md
                    │   binary            │     这是独立产品，
                    └──────────┬──────────┘     不是 SDK
                               │ HTTP REST
                               ▼
                          (nemos server)
```

**SDK 不包 MCP**——SDK 是给开发者直接 import 用的；MCP server 是给 AI app 集成用的。两条路径并行，互不依赖。

### 1.2 SDK 责任

- HTTP 调用 Nemos REST API
- 客户端 L1/L2/L3 cache（M2 hot-path < 5ms 体感）
- E2EE SKU 下：密钥管理 + 客户端 embedding + 客户端 HNSW + 客户端 LLM call for reflect
- 离线模式：本地写队列 + 在线时同步
- 错误重试 + idempotency
- 字段类型转换（TS camelCase ↔ REST snake_case；Python 同 REST）

### 1.3 SDK 不做

- 不暴露 MCP protocol
- 不包 LLM 调用（除 E2EE SKU 的客户端 reflect）
- 不做 prompt engineering
- 不做 chat history 管理

---

## 2. TypeScript SDK 接口

### 2.1 包

```
npm install @nemos/sdk
```

支持 Node 20+、Deno、Bun、modern browsers（含 React Native 视 §6.4 限制）。

### 2.2 顶层 API

```typescript
import { Nemos, MemoryRecord, Source, Arousal, Surprise } from '@nemos/sdk';

const client = new Nemos({
  endpoint: 'https://api.nemos.org/v1',
  apiKey: process.env.NEMOS_CAPABILITY_JWT,
  agentPrivateKey: process.env.NEMOS_AGENT_KEY,    // for ed25519 sign
  sku: 'a',                                          // 'a' | 'b' | 'c'
  e2eeKey: undefined,                                // SKU b 必填
  cache: { l1Max: 100, l2Path: '~/.nemos/cache.db' }
});
```

### 2.3 完整接口签名

```typescript
class Nemos {
  // ── 构造 ──
  constructor(config: NemosConfig);
  
  // ── Hot-path query (M2) ──
  query(input: QueryInput): Promise<QueryResult>;
  injectSessionStart(input: SessionStartInput): Promise<SessionStartResult>;
  
  // ── Write ──
  writeEpisodic(input: EpisodicInput): Promise<WriteResult>;
  writeSemantic(input: SemanticInput): Promise<WriteResult>;
  writeProcedural(input: ProceduralInput): Promise<WriteResult>;
  writeRelational(input: RelationalInput): Promise<WriteResult>;
  
  // ── Personal Semantic (propose only, I4) ──
  proposePersonalSemantic(input: ProposalInput): Promise<ProposalResult>;
  listProposals(filters?: ProposalFilter): Promise<Proposal[]>;
  
  // ── Read ──
  getRecord(id: string): Promise<MemoryRecord>;
  listRecordVersions(id: string): Promise<MemoryRecord[]>;
  
  // ── Forget / Burn ──
  forget(target: ForgetTarget, reason?: string): Promise<ForgetReceipt>;
  burn(target: BurnTarget, confirmToken: string): Promise<BurnReceipt>;
  cool(topic: string | Float32Array, duration: string): Promise<CoolReceipt>;
  showDecay(id: string): Promise<DecayCurve>;
  
  // ── Reflect ──
  triggerReflect(input?: ReflectInput): Promise<ReflectJob>;
  getReflectStatus(runId: string): Promise<ReflectStatus>;
  
  // ── Lifetime Period ──
  getActivePeriod(): Promise<Period | null>;
  closePeriod(id: string, summary?: string): Promise<Period>;
  viewAsOf(timestamp: string): Promise<HistoricalSelf>;
  markNarrativeEvent(recordId: string, type: 'high' | 'low' | 'turning'): Promise<void>;
  
  // ── Relational ──
  attemptShareRelational(recordId: string, toAgent: string): Promise<ShareReceipt>;
  vetoShare(recordId: string): Promise<void>;
  
  // ── Audit ──
  listAuditEvents(filter: AuditFilter): Promise<AuditEvent[]>;
  
  // ── Export / Import ──
  exportArchive(options?: ExportOptions): Promise<ExportJob>;
  getExportStatus(jobId: string): Promise<ExportStatus>;
  importArchive(file: Blob | Buffer, options?: ImportOptions): Promise<ImportJob>;
  
  // ── Meta ──
  meta(): Promise<DeploymentMeta>;
  
  // ── Cache control ──
  cache: {
    flush(): Promise<void>;
    warmup(scope: string): Promise<void>;
    stats(): CacheStats;
  };
  
  // ── Events ──
  on(event: 'recordWritten' | 'recordBurned' | 'proposalCreated' | 'reflectCompleted', handler: (e: any) => void): void;
  off(event: string, handler: Function): void;
}
```

### 2.4 类型定义（关键）

```typescript
interface NemosConfig {
  endpoint: string;
  apiKey: string;                                    // capability_jwt
  agentPrivateKey?: string;                          // ed25519 private key (PEM)
  sku?: 'a' | 'b' | 'c';                             // 默认 from meta()
  e2eeKey?: CryptoKey | Uint8Array;                  // SKU b 必填
  cache?: CacheConfig;
  timeout?: number;                                  // ms, default 30000
  maxRetries?: number;                               // default 3
  embeddingProvider?: 'server' | 'client-onnx';      // SKU b 强制 client
  embeddingModelId?: string;                         // 默认 from meta()
  schemaVersion?: string;                            // default '0.1'
}

interface QueryInput {
  text?: string;
  embedding?: Float32Array;
  filters?: {
    type?: ('episodic' | 'semantic' | 'personal_semantic' | 'procedural')[];
    scopeId?: string;
    periodId?: string | 'active';
    facet?: string[];
    ownershipKind?: ('self' | 'relational' | 'public')[];
    maxAgeDays?: number;
  };
  topK?: number;
  minConfidence?: number;
}

interface MemoryRecord {
  id: string;
  type: string;
  schemaVersion: string;
  scopeId: string;
  periodId?: string;
  content: {
    text?: string;
    lang?: string;
    modality?: string;
    claim?: string;                                  // semantic
    pattern?: string;                                // procedural
    attachments?: Attachment[];
  };
  source: Source;
  arousal?: Arousal;
  surprise?: Surprise;
  ownership: Ownership;
  fsrs: FSRSState;
  flags: Flags;
  audit: AuditMeta;
  archivalRef: string;
  embeddingModelId: string;
  embedding?: Float32Array;                          // 仅 client_only contexts
  createdAt: string;
  // type-specific:
  facet?: string;
  key?: string;
  value?: any;
  occurredAt?: string;
  evidenceEpisodicIds?: string[];
  version?: number;
  supersedes?: string;
  validFrom?: string;
  validTo?: string | null;
  corrects?: string[];
  correctedBy?: string[];
  related?: string[];
}

interface Source {
  kind: 'authoritative' | 'derived';
  originId: string;
  chainDepth: number;
  authoritative: boolean;
  confidence: number;
  extractor: 'user_typed' | 'ocr' | 'asr' | 'llm_summary' | 'llm_inference' | 'agent_observation' | 'sensor';
  originAgent?: string;
  extractedAt: string;
}

interface Arousal {
  value: number;
  valence: number;
  signalSources: Array<{ name: string; score: number }>;
  computedAt: string;
  computedBy: string;
  algorithmVersion: string;
}

interface Surprise {
  value: number;
  basis: string;
  comparisonWindow: string;
  computedAt: string;
  algorithmVersion: string;
}

interface Ownership {
  kind: 'self' | 'relational' | 'public';
  principals?: string[];
  consentStatus: 'implicit' | 'explicit' | 'pending' | 'revoked';
  consentRecords?: string[];
}
```

### 2.5 使用示例

```typescript
const nemos = new Nemos({
  endpoint: 'https://api.nemos.org/v1',
  apiKey: process.env.NEMOS_JWT!,
  agentPrivateKey: process.env.NEMOS_AGENT_KEY!
});

// session 开始
const session = await nemos.injectSessionStart({
  appOrigin: 'cursor',
  scopeId: 'scope:work',
  periodId: 'active',
  want: {
    personalSemantic: { topK: 50, facets: ['preference', 'voice'] },
    episodic: { topK: 20 }
  }
});

// hot-path query
const result = await nemos.query({
  text: '用户的写作偏好',
  filters: { type: ['personal_semantic'], scopeId: 'scope:work' },
  topK: 5
});

// 写入观察
const written = await nemos.writeEpisodic({
  content: { text: '用户今早 6 点起床写作', modality: 'text' },
  occurredAt: '2026-06-04T06:30:00+08:00',
  source: {
    kind: 'derived',
    chainDepth: 1,
    authoritative: false,
    extractor: 'agent_observation',
    originAgent: 'cursor'
  },
  arousal: { value: 0.45, valence: 0.3, signalSources: [...] },
  surprise: { value: 1.8, basis: 'embedding+entity_freq' },
  scopeId: 'scope:work',
  ownership: { kind: 'self', consentStatus: 'implicit' }
});

// 提议 personal_semantic（永不直写）
await nemos.proposePersonalSemantic({
  facet: 'preference',
  key: 'writing_time',
  value: 'early morning',
  evidenceEpisodicIds: [written.id, 'ep_xx', 'ep_yy'],
  confidence: 0.85,
  reasoning: '过去 30 天 6 次写作中 5 次在 6-8am'
});
```

---

## 3. Python SDK 接口

### 3.1 包

```
pip install nemos
```

支持 Python 3.10+。

### 3.2 顶层 API

```python
from nemos import Nemos, MemoryRecord, Source, Arousal, Surprise

client = Nemos(
    endpoint="https://api.nemos.org/v1",
    api_key=os.environ["NEMOS_CAPABILITY_JWT"],
    agent_private_key_path=os.environ["NEMOS_AGENT_KEY_PATH"],
    sku="a",
    cache={"l1_max": 100, "l2_path": "~/.nemos/cache.db"}
)
```

### 3.3 完整接口签名

```python
class Nemos:
    def __init__(self, **config): ...
    
    # ── Hot-path ──
    def query(self, *, text=None, embedding=None, filters=None, top_k=5, min_confidence=0.5) -> QueryResult: ...
    async def aquery(self, ...) -> QueryResult: ...    # 异步版
    def inject_session_start(self, *, app_origin, scope_id="global", period_id="active", want=None) -> SessionStartResult: ...
    
    # ── Write ──
    def write_episodic(self, *, content, occurred_at, source, arousal, surprise, **kwargs) -> WriteResult: ...
    def write_semantic(self, *, content, evidence_episodic_ids, **kwargs) -> WriteResult: ...
    def write_procedural(self, *, pattern, frequency, evidence_episodic_ids, **kwargs) -> WriteResult: ...
    def write_relational(self, *, content, principals, **kwargs) -> WriteResult: ...
    
    # ── Personal Semantic ──
    def propose_personal_semantic(self, *, facet, key, value, evidence_episodic_ids, confidence=None, reasoning=None) -> ProposalResult: ...
    def list_proposals(self, **filters) -> list[Proposal]: ...
    
    # ── Read ──
    def get_record(self, id: str) -> MemoryRecord: ...
    def list_record_versions(self, id: str) -> list[MemoryRecord]: ...
    
    # ── Forget / Burn ──
    def forget(self, target, reason=None) -> ForgetReceipt: ...
    def burn(self, target, confirm_token: str) -> BurnReceipt: ...
    def cool(self, topic, duration: str) -> CoolReceipt: ...
    def show_decay(self, id: str) -> DecayCurve: ...
    
    # ── Reflect ──
    def trigger_reflect(self, **kwargs) -> ReflectJob: ...
    def get_reflect_status(self, run_id: str) -> ReflectStatus: ...
    
    # ── Lifetime Period ──
    def get_active_period(self) -> Period | None: ...
    def close_period(self, id: str, summary=None) -> Period: ...
    def view_as_of(self, timestamp: str) -> HistoricalSelf: ...
    def mark_narrative_event(self, record_id: str, type: str) -> None: ...
    
    # ── Relational ──
    def attempt_share_relational(self, record_id: str, to_agent: str) -> ShareReceipt: ...
    def veto_share(self, record_id: str) -> None: ...
    
    # ── Audit ──
    def list_audit_events(self, **filters) -> list[AuditEvent]: ...
    
    # ── Export / Import ──
    def export_archive(self, **options) -> ExportJob: ...
    def get_export_status(self, job_id: str) -> ExportStatus: ...
    def import_archive(self, file, **options) -> ImportJob: ...
    
    # ── Meta ──
    def meta(self) -> DeploymentMeta: ...
    
    # ── Cache control ──
    @property
    def cache(self) -> CacheController: ...
    
    # ── Events (callbacks) ──
    def on(self, event: str, handler: Callable) -> None: ...
    def off(self, event: str, handler: Callable) -> None: ...
```

### 3.4 类型定义（dataclass / pydantic）

```python
from dataclasses import dataclass
from typing import Literal, Optional

@dataclass
class Source:
    kind: Literal["authoritative", "derived"]
    origin_id: str
    chain_depth: int
    authoritative: bool
    confidence: float
    extractor: Literal["user_typed", "ocr", "asr", "llm_summary", "llm_inference", "agent_observation", "sensor"]
    extracted_at: str
    origin_agent: Optional[str] = None

@dataclass
class MemoryRecord:
    id: str
    type: str
    schema_version: str
    scope_id: str
    period_id: Optional[str]
    content: dict
    source: Source
    arousal: Optional[Arousal]
    surprise: Optional[Surprise]
    ownership: Ownership
    fsrs: FSRSState
    flags: dict
    audit: AuditMeta
    archival_ref: str
    embedding_model_id: str
    created_at: str
    # ... 同 TS
```

### 3.5 使用示例

```python
from nemos import Nemos

client = Nemos(
    endpoint="https://api.nemos.org/v1",
    api_key=os.environ["NEMOS_JWT"],
    agent_private_key_path="~/.nemos/agent.key"
)

# session 启动
session = client.inject_session_start(
    app_origin="cursor",
    scope_id="scope:work",
    want={
        "personal_semantic": {"top_k": 50},
        "episodic": {"top_k": 20}
    }
)

# query
result = client.query(
    text="用户写作偏好",
    filters={"type": ["personal_semantic"]},
    top_k=5
)

# write
written = client.write_episodic(
    content={"text": "用户 6:30 起床写作", "modality": "text"},
    occurred_at="2026-06-04T06:30:00+08:00",
    source={"kind": "derived", "chain_depth": 1, "extractor": "agent_observation"},
    arousal={"value": 0.45, "valence": 0.3, "signal_sources": [...]},
    surprise={"value": 1.8, "basis": "embedding+entity_freq"},
    scope_id="scope:work"
)

# propose
client.propose_personal_semantic(
    facet="preference",
    key="writing_time",
    value="early_morning",
    evidence_episodic_ids=[written.id, "ep_xx"],
    confidence=0.85,
    reasoning="..."
)
```

### 3.6 Python idiom 差异

- 同步 + 异步两套（`query` / `aquery`）；TypeScript 只有 async
- 用 dict 直接传入，类型 hint 用 dataclass / pydantic（项目可选）
- 字段名 snake_case 与 REST 一致（TS 是 camelCase）
- 没有 `Float32Array`，用 `numpy.ndarray` 或 `list[float]`

---

## 4. 配置项

### 4.1 必填配置

| 项 | TS | Python | 说明 |
|---|---|---|---|
| endpoint | `endpoint` | `endpoint` | Nemos server base URL |
| API key | `apiKey` | `api_key` | capability JWT |

### 4.2 推荐配置

| 项 | TS | Python | 默认 | 说明 |
|---|---|---|---|---|
| Agent key | `agentPrivateKey` | `agent_private_key_path` | undefined | ed25519 私钥（agent 必带） |
| SKU mode | `sku` | `sku` | from meta() | 'a' / 'b' / 'c'，默认调 `/meta` 自检 |
| Cache | `cache` | `cache` | {} | 见 §5 |
| Timeout | `timeout` | `timeout_seconds` | 30000 ms | request 超时 |
| Max retries | `maxRetries` | `max_retries` | 3 | 网络错误重试 |
| Embedding provider | `embeddingProvider` | `embedding_provider` | 'server' | SKU b 强制 'client-onnx' |
| Embedding model id | `embeddingModelId` | `embedding_model_id` | from meta() | |
| E2EE key | `e2eeKey` | `e2ee_key` | undefined | SKU b 必填 |
| Schema version | `schemaVersion` | `schema_version` | '0.1' | |
| Default scope | `defaultScopeId` | `default_scope_id` | 'global' | 调用未指定时用 |
| Default period | `defaultPeriodId` | `default_period_id` | 'active' | |
| Tenant ID | `tenantId` | `tenant_id` | from JWT | 自托管多租户用 |

### 4.3 SDK env var 约定

| Env var | 用途 |
|---|---|
| `NEMOS_ENDPOINT` | endpoint |
| `NEMOS_API_KEY` | capability JWT |
| `NEMOS_AGENT_KEY` | agent ed25519 私钥 PEM |
| `NEMOS_E2EE_KEY` | E2EE 密钥（hex/base64） |
| `NEMOS_SKU` | 'a' / 'b' / 'c' |
| `NEMOS_CACHE_DIR` | L2/L3 SQLite mirror 路径 |

---

## 5. 客户端缓存策略（L1/L2/L3）

### 5.1 三层 cache（与 sizing §5.3 对齐）

| 层 | 内容 | TTL | invalidation | 体感 |
|---|---|---|---|---|
| **L1: in-memory LRU** | 最近 100 条 query 结果 | 60s | 进程退出 | < 1ms |
| **L2: 本地 SQLite mirror** | 用户的 Personal Semantic 全量（< 1k 条，< 1MB） | 5min refresh | server SSE push | < 5ms |
| **L3: 本地 SQLite mirror** | 当前 active period 的 episodic top-200 by stability | 1h refresh | 同 L2 | < 10ms |

### 5.2 Cache key 设计

```
query_cache_key = sha256(canonical({
  text, embedding_hash, filters, top_k, schema_version
}))
```

任何 filter 变化 → key 变 → cache miss。

### 5.3 L2/L3 同步协议

```
1. SDK 启动 → 调 GET /records/query?cache_bootstrap=true
2. server 返回 personal_semantic + top episodic snapshot + sync_token
3. SDK 写入本地 SQLite
4. SDK 订阅 GET /events?token=<sync_token>（SSE long-poll）
5. server 在用户数据变更时推 invalidation event
6. SDK 收到 → 拉变更 → 更新本地 + 重置 sync_token
```

### 5.4 Cache 命中率目标

- L1 命中率 > 30%（频繁重复 query）
- L2 命中率 > 80%（personal_semantic 稳定）
- L3 命中率 > 60%（episodic 活跃集）

### 5.5 Cache.flush() 时机

- 用户登出
- API key 变更
- schema_version 变化
- 用户 burn 后

---

## 6. E2EE SKU 下 SDK 承担的客户端职责

### 6.1 密钥管理

```typescript
const client = new Nemos({
  endpoint: '...',
  apiKey: '...',
  sku: 'b',
  e2eeKey: await deriveKeyFromPassword(userPassword, salt)
});
```

- SDK 不存密钥到 disk（密钥派生用户密码）
- SDK 在 memory 中持密钥；进程退出即丢
- 多设备：用户在每台设备输密码派生同一 key（密码相同，盐相同）

### 6.2 客户端 embedding

E2EE SKU 默认 `embeddingProvider: 'client-onnx'`：

- SDK 内置 ONNX runtime（TS：`onnxruntime-web` / Python：`onnxruntime`）
- 内置模型：`bge-small-en-v1.5`（~100MB）或 `all-MiniLM-L6-v2`（~30MB）
- 首次启动下载模型到本地缓存
- 写入时本地算 embedding → 上传密文

### 6.3 客户端 HNSW

```typescript
// SDK 内部
const localIndex = new HNSWIndex({
  dim: 384,                                          // bge-small dim
  M: 16,
  efConstruction: 200,
  maxElements: 50000
});
```

- 用 `hnswlib-node` (TS) / `hnswlib` (Python)
- 增量插入：写入时同时更新本地索引
- 多设备同步：CRDT delta 通过服务端 relay（见 sizing §7.2）

### 6.4 客户端 reflect

E2EE SKU 下 `triggerReflect` 在 SDK 内部跑：

```typescript
async function clientReflect(window) {
  // 1. 从本地 SQLite 拉 unconsolidated episodic
  const records = await localStore.getUnconsolidated(window);
  
  // 2. embedding cluster（本地算）
  const clusters = await localCluster(records);
  
  // 3. 调用用户自配的 LLM API（OpenAI / Anthropic / local Ollama）
  const llmConfig = config.llmEndpoint || 'https://api.openai.com';
  for (const cluster of clusters) {
    const summary = await callLLM(llmConfig, structuredSummaryPrompt(cluster));
    // ...
  }
  
  // 4. 写入加密后的 summary 到服务端
  await client.writeSemantic({ ...summary, encrypted: true });
  
  // 5. proposal → 走 propose_personal_semantic（同 SKU a）
}
```

### 6.5 多设备 sync 协议

```
device A 写新 record → 加密 → 上传密文 + CRDT op
                            ↓
device B 启动 → 拉 op log → 客户端 merge
```

详见 Companion §8。SDK v0.1 只支持单设备（多设备走 Round 2 RFC）。

### 6.6 移动端限制（Round 2 待验证）

- React Native：`onnxruntime-react-native` 实验性，性能未验证
- iOS Safari：WASM ONNX 可跑但 ~5x 慢
- Android Chrome：WASM ONNX 可跑

sizing §11 风险 #12 标注需 PoC 验证。

---

## 7. 错误处理与重试

### 7.1 错误类型

```typescript
class NemosError extends Error {
  code: string;                          // nemos_error_code
  status: number;                        // HTTP status
  invariantViolated?: string;
  fixHint?: string;
  restEquivalent?: string;
  retryable: boolean;
  auditId?: string;
}

class NemosInvariantError extends NemosError {}     // 4xx invariant violation
class NemosCapabilityError extends NemosError {}    // 403
class NemosRateLimitError extends NemosError {
  retryAfterSeconds: number;
}
class NemosNetworkError extends NemosError {
  retryable: true;
}
```

### 7.2 重试策略

| 错误 | 是否重试 | 策略 |
|---|---|---|
| 网络错误 / 5xx | 是 | exponential backoff，max 3 次 |
| 429 RateLimit | 是 | 等 `Retry-After` |
| 401 / 403 | 否 | 抛错让开发者处理 |
| 422 invariant | 否 | 永远不重试，schema 错误 |
| 409 contradiction | 否 | 开发者必须处理 policy |

### 7.3 Idempotency

SDK 自动为每个 write 调用生成 `Idempotency-Key`（UUID v4），24h 内重试同一调用安全。

### 7.4 Circuit breaker（可选）

```typescript
const client = new Nemos({
  ...,
  circuitBreaker: {
    threshold: 0.5,                      // 50% 错误率
    windowSize: 50,                      // 最近 50 个请求
    recoveryTimeout: 30000               // 30s 后半开
  }
});
```

Open 状态时 SDK 立即返回 cached 数据（如果有）+ 标 stale。

---

## 8. 离线模式

### 8.1 启用

```typescript
const client = new Nemos({ ..., offlineMode: { enabled: true, queuePath: '~/.nemos/queue.db' } });
```

### 8.2 行为

- 在线时：透明，与默认一致
- 离线时：
  - `query`：从 L1/L2/L3 cache 返回，标 `stale: true`
  - `write*`：写入本地 SQLite 队列
  - `burn` / `forget` / `cool`：拒绝（用户主权操作必在线）
- 网络恢复：自动 flush 队列到服务端

### 8.3 队列冲突解决（v0.1）

last-write-wins + audit 双写 + 警告。Round 2 看是否需要 vector clock（见 overview Q8）。

### 8.4 队列容量

- 默认上限 1000 条 / 100MB
- 超出 → 拒绝新写入 + raise `NemosQueueFullError`
- 用户必须连网 flush 或手动 drop

---

## 9. 不变量（SDK 层）

- **S1**: SDK 永远直接调 REST，不内嵌 MCP
- **S2**: SDK 不允许构造非法 source.kind / chain_depth → 客户端校验后服务端兜底
- **S3**: SDK 不允许 bypass propose（`writePersonalSemantic` 这种方法**不存在**于 API；只有 `proposePersonalSemantic`）
- **S4**: SDK 在 SKU b 下永远本地算 embedding，永远本地存 HNSW
- **S5**: SDK 自动注入 `Idempotency-Key` for writes
- **S6**: SDK 自动签名（agent_signature）若配了 agent_private_key
- **S7**: SDK 的 cache 命中不更新 `audit.last_accessed`（cache 是 SDK 内部状态，audit 由服务端记）；只有真正命中服务端才更新 R10
- **S8**: SDK 在 schema_version 不匹配时 raise `NemosSchemaMismatchError`，不静默降级
- **S9**: SDK 在 E2EE SKU 下不允许通过任何方式将 `content.text` 明文发送到服务端
- **S10**: SDK 在 burn / forget / cool 操作 必须接受 user OAuth token，拒绝 agent JWT

---

## 10. 版本与发布

### 10.1 SemVer

- `@nemos/sdk` 版本独立于 Nemos schema_version
- SDK SemVer 跟 Nemos schema major：
  - SDK 0.x 对应 schema 0.x
  - SDK 1.x 对应 schema 1.x
- 同 major 内 SDK 与 server 向后兼容（SDK 0.3 可调 server 0.1）

### 10.2 SDK 版本协商

```typescript
const client = new Nemos({ ... });
const meta = await client.meta();
if (meta.schemaVersion.split('.')[0] !== '0') {
  throw new Error('Server major version mismatch');
}
```

SDK 启动时自动调一次 `/meta` 校验版本兼容。

### 10.3 多语言 SDK 同步

- TS 和 Python SDK 同步发版（同一 git tag）
- 字段、接口、错误码完全等价
- 自动测试 `sdk-parity-test` 跑两边同一组测试，比对响应

---

## Handoff

> 5 份 spec 文件到此完整：
> - `00-overview.md` 项目总览 + 不变量 + 开放问题
> - `10-data-schema.md` 数据 schema（最长）
> - `20-rest-api.md` REST API
> - `30-mcp-server.md` MCP server tools/resources/prompts
> - `40-sdk-contract.md` SDK 接口契约（本文件）
>
> **下一步（Round 2）**：
> - 把 `00-overview.md §8` 列出的 14 个开放问题落地为 RFC
> - 跑 PoC（sizing §11 风险 #12 #13 #14）验证 schema 假设
> - 写 OpenAPI YAML（机器可读 REST spec）
> - 写 JSON Schema for shared types
> - 起 nemos-server reference implementation（Go single-binary，SKU c first）

**End of sdk-contract.**
