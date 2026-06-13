# mnemos v0.1 — MCP Server (30-mcp-server)

> **状态**：Draft，Round 1 输出
> **版本**：v0.1
> **更新**：2026-06-04
> 配套阅读：`00-overview.md` + `10-data-schema.md` + `20-rest-api.md`
> 上游协议：Model Context Protocol（Anthropic / 跨厂商）2025-2026 演进中。本文档与 MCP spec 0.x 兼容。

---

## 0. 阅读地图

| 节 | 内容 |
|---|---|
| §1 | mnemos 作为 MCP server 的姿态 |
| §2 | Tools 列表（mapping 到 REST） |
| §3 | Resources 列表 |
| §4 | Prompts 列表 |
| §5 | AI app 接入示例 |
| §6 | REST ↔ MCP 字段一致性保证 |
| §7 | 本地模式 vs 云模式部署 |
| §8 | 与 MCP working group 的对接策略 |

---

## 1. mnemos 作为 MCP server 的姿态

### 1.1 为什么有独立的 MCP server

REST API 是 mnemos 的标准化网络面，MCP 是 mnemos 与 AI app 集成的优先入口。两者**字段一致、语义等价**，差异只在：

| 维度 | REST API | MCP Server |
|---|---|---|
| 传输 | HTTP/2 + JSON | JSON-RPC over stdio / HTTP |
| 目标调用者 | 任何 HTTP client | MCP-compliant AI app（Claude Code / Cursor / Anthropic-ecosystem） |
| 部署位置 | 远程 | local stdio（用户机器）/ remote / hybrid |
| 鉴权 | OAuth + per-agent JWT | MCP capability handshake + JWT |
| 资源订阅 | 不支持（轮询） | 原生支持（resources subscribe） |
| 预制 prompt | 不支持 | 原生支持（prompts） |

### 1.2 MCP server 永远是 REST API 的子集 + 扩展

- 任何 MCP tool 调用都能用一组 REST 调用等价实现
- MCP 额外提供 resources（订阅）+ prompts（预制模板），REST 不直接做这两件事
- mnemos 的服务端逻辑只实现一次，MCP server 和 REST API 共享同一组 service handler

### 1.3 与 capability registry 的关系

MCP 协议本身有 capability handshake（client / server 互声明能力）。mnemos 在此之上叠加：
- mnemos 的 `capability_jwt`（Companion §3）传到 MCP server
- MCP server 用 JWT 决定哪些 tools / resources / prompts 对该 client 可见
- 同一 mnemos 部署对不同 capability 的 client 暴露不同的 tools list

---

## 2. Tools 列表

MCP tools 是 AI app 可调用的函数。下表列出 mnemos MCP server v0.1 暴露的 tools。

> 命名约定：`<verb>_<noun>` 全小写下划线，与 MCP 生态主流命名一致。

### 2.1 核心 tools（must-have）

| Tool | Mapping to REST | 用途 |
|---|---|---|
| `query_memory` | POST `/inject/query` | M2 hot-path：根据 query 取 top-N record |
| `inject_session_start` | POST `/inject/session-start` | M1 cold-start：bulk pull |
| `write_episodic` | POST `/records` (type=episodic) | 写一个事件 |
| `write_relational` | POST `/relational/records` | 写关系记忆 |
| `write_procedural` | POST `/records` (type=procedural) | 写习惯模式 |
| `get_record` | GET `/records/{id}` | 读单条 |
| `list_record_versions` | GET `/records/{id}/versions` | supersede 链 |
| `forget` | POST `/forget` | 软遗忘 |
| `cool_topic` | POST `/cool` | 主题冷却 |
| `mark_narrative_event` | POST `/episodic/{id}/narrative-event` | R4 标 high/low/turning |
| `propose_personal_semantic` | POST `/reflect-proposals` | 提议（永不直写 personal_semantic） |
| `list_proposals` | GET `/reflect-proposals` | 用户审批队列 |

### 2.2 Companion tools（multi-agent persona 用）

| Tool | Mapping | 用途 |
|---|---|---|
| `list_scopes` | GET `/identity/scopes` | 列当前 user 的 scope |
| `get_capability_self` | GET `/capabilities?agent=self` | 本 agent 当前 capability |
| `list_other_agents` | GET `/agents` | 同 user 下其他 agent（按 manifest 可见） |
| `signal_user_attention` | POST `/agents/notify` | 给用户发提示（dashboard 通知） |

### 2.3 Lifetime Period tools（创作者 persona 用）

| Tool | Mapping | 用途 |
|---|---|---|
| `get_active_period` | GET `/periods?active=true` | 当前章节 |
| `propose_chapter_break` | POST `/periods/proposals` | AI 提议新章节（用户必须确认） |
| `view_as_of` | POST `/inject/query` + `period_id` 字段 | 时间旅行查询 |

### 2.4 Reflect tools（仅 AI app 显式触发）

| Tool | Mapping | 用途 |
|---|---|---|
| `trigger_reflect` | POST `/reflect/run` | 异步触发；AI app 可在 session end 时调 |
| `get_reflect_status` | GET `/reflect/runs/{id}` | 拉状态 |

### 2.5 不暴露 / 仅 user dashboard

下列操作 **mnemos MCP server 不暴露**（无论 agent capability 多高），只能通过 REST API + user OAuth token 走：

- `burn`（GDPR 反编译）
- `update_manifest`（修改 sharing manifest）
- `register_agent`（agent 自我注册）
- `update_inheritor_manifest`（死后 manifest）
- `update_identity_hard_facts`（CoreIdentity hard facts）
- `delete_period`

理由：这些是用户主权操作，不能让 agent 间接触发（即使错误地）。MCP capability 模型不够强大覆盖这层风险。

### 2.6 Tool schema 示例

每个 tool 的 MCP schema：

```yaml
- name: query_memory
  description: |
    Query the user's memory for records relevant to a topic.
    Returns top-K records ranked by semantic similarity + recency + stability.
    Respects scope_id and capability restrictions automatically.
  inputSchema:
    type: object
    required: [query]
    properties:
      query:
        type: object
        required: [text]
        properties:
          text:
            type: string
            description: Natural-language query
          embedding:
            type: array
            items: { type: number }
            description: Optional pre-computed embedding (client-side, saves server compute)
          filters:
            type: object
            properties:
              type:
                type: array
                items:
                  enum: [episodic, semantic, personal_semantic, procedural]
              scope_id:
                type: string
              period_id:
                type: string
                description: "ULID, or literal 'active' for current period"
              facet:
                type: array
                items: { type: string }
              ownership_kind:
                type: array
                items: { enum: [self, relational, public] }
              max_age_days:
                type: integer
          top_k:
            type: integer
            default: 5
            maximum: 50
          min_confidence:
            type: number
            default: 0.5
  outputSchema:
    type: object
    properties:
      records:
        type: array
        items: { $ref: "#/definitions/Record" }
      query_id:
        type: string
      filters_applied:
        type: object
```

```yaml
- name: write_episodic
  description: |
    Write a new episodic memory.
    
    Strict rules:
    - You (the AI agent) MUST set source.kind = "derived" with chain_depth >= 1
      unless you are directly transcribing user input verbatim.
    - You CANNOT write personal_semantic records via this tool (use propose_personal_semantic).
    - Three-axis metadata (source, arousal, surprise) is mandatory.
    
    Returns the record_id and archival_ref.
  inputSchema:
    type: object
    required: [content, occurred_at, source, arousal, surprise]
    properties:
      content:
        type: object
        required: [text]
        properties:
          text: { type: string }
          lang: { type: string }
          modality:
            enum: [text, audio, image, screen, mixed]
      occurred_at:
        type: string
        format: date-time
      scope_id:
        type: string
        default: "global"
      source:
        $ref: "#/definitions/Source"
      arousal:
        $ref: "#/definitions/Arousal"
      surprise:
        $ref: "#/definitions/Surprise"
      ownership:
        $ref: "#/definitions/Ownership"
      context:
        type: object
      flags:
        type: object
```

```yaml
- name: propose_personal_semantic
  description: |
    Propose an update to the user's Personal Semantic store.
    
    YOU CANNOT directly write personal_semantic - you can only propose.
    The proposal will appear in the user's review queue.
    User explicitly accepts the proposal -> mnemos writes it with source.kind=authoritative.
    
    This is the I4 invariant: AI never writes Personal Semantic directly.
  inputSchema:
    type: object
    required: [facet, key, value, evidence_episodic_ids]
    properties:
      facet:
        type: string
        enum: [preference, skill, relation, value, identity, health, voice, motif, chapter]
      key:
        type: string
      value:
        type: object        # arbitrary JSON
      evidence_episodic_ids:
        type: array
        items: { type: string }
        minItems: 1
      confidence:
        type: number
        minimum: 0
        maximum: 1
      reasoning:
        type: string
        description: Why you think this is true; shown to user
```

### 2.7 Tool result conventions

所有 tool 响应都遵循同一 envelope：

```json
{
  "ok": true,
  "data": { ... },                          // tool-specific payload
  "audit_id": "audit_<ulid>",               // 所有 tool 调用必留 audit
  "warnings": [],                           // e.g. "this query was scoped down due to capability"
  "schema_version": "0.1"
}
```

错误响应：

```json
{
  "ok": false,
  "error": {
    "code": "I4_VIOLATION",
    "message": "...",
    "fix_hint": "...",
    "rest_equivalent": "POST /v1/reflect-proposals"
  }
}
```

---

## 3. Resources 列表

MCP resources 是 server 暴露给 client 可订阅的资源。mnemos 暴露的 resources 都是**按 capability 过滤后的 view**——不暴露用户全量记忆（见 overview Q7）。

### 3.1 Resource URI 格式

```
mnemos://memory/<scope>/<view-name>
```

示例：
- `mnemos://memory/scope:work/personal-semantic-summary`
- `mnemos://memory/global/recent-narrative-events`
- `mnemos://memory/scope:health/forbidden`  ← 返回 403 (capability denied)

### 3.2 v0.1 暴露的 resources

| URI 模板 | 内容 | 订阅频率 |
|---|---|---|
| `mnemos://memory/<scope>/personal-semantic-summary` | 该 scope 内 personal_semantic 的简化 view（key+value+confidence） | on change（manifest 允许的范围） |
| `mnemos://memory/<scope>/active-period` | 当前 active period 元数据 | on change |
| `mnemos://memory/<scope>/recent-episodic` | 最近 N 条 episodic | 5 min poll |
| `mnemos://memory/<scope>/procedural-patterns` | 已成形的 procedural patterns | on change |
| `mnemos://memory/<scope>/proposals` | 该 scope 下 AI 提议的 personal_semantic（待用户审批） | on change |
| `mnemos://meta/capability-self` | 本 agent 的当前 capability | on change |
| `mnemos://meta/schema-version` | 服务端 schema version | static |

### 3.3 Resource subscription 示例

```json
// Client → Server
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/subscribe",
  "params": {
    "uri": "mnemos://memory/scope:work/personal-semantic-summary"
  }
}

// Server → Client (initial)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "uri": "mnemos://memory/scope:work/personal-semantic-summary",
    "mimeType": "application/json",
    "text": "{\"records\": [...], \"schema_version\": \"0.1\"}"
  }
}

// Server → Client (notification on change)
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": {
    "uri": "mnemos://memory/scope:work/personal-semantic-summary"
  }
}
```

### 3.4 Resource 字段一致性

所有 resource 暴露的 record 字段子集**与 REST API 的 `/records/{id}` GET 完全一致**——只是把数组 wrap 在 view envelope 里。

### 3.5 不暴露 raw archival

- archival bytes 永远不通过 resource 暴露（即使 capability 允许）
- 必须通过 REST `/archival/{id}/raw` 显式拉
- 理由：避免被动 subscribe 全量数据流

---

## 4. Prompts 列表

MCP prompts 是 server 提供的预制 prompt template，让 AI app 在与 mnemos 交互时有"推荐用法"。

### 4.1 v0.1 暴露的 prompts

| Name | 用途 |
|---|---|
| `reflect-on-session` | 一轮对话结束时，引导 agent 提议 personal_semantic + 标 narrative event |
| `correct-existing-memory` | 用户纠正后，引导 agent 写 `wrong_scope` + `corrects` 字段 |
| `respect-private-zone` | 在生成回答前，让 agent 显式确认未引用 private_zone 数据 |
| `confirm-burn` | burn 操作前的二次确认 prompt（user-facing） |
| `propose-chapter-break` | 章节断点候选 prompt |

### 4.2 Prompt 示例：reflect-on-session

```yaml
- name: reflect-on-session
  description: |
    Use this prompt at the end of a multi-turn session to reflect on what
    happened and propose memory updates.
  arguments:
    - name: session_id
      description: The session_id from inject_session_start
      required: true
    - name: turn_count
      description: Number of turns in this session
      required: true
  messages:
    - role: user
      content:
        type: text
        text: |
          You just finished a session ({{turn_count}} turns) with the user.
          
          Reflect on the following:
          
          1. **User corrections you received** - For each correction, decide if
             it should become a feedback memory (wrong_scope = always / context-specific).
             Use `propose_personal_semantic` only for cross-session patterns.
          
          2. **New facts the user stated** - These go in episodic with
             source.kind = "authoritative" and chain_depth = 0.
             If they revealed stable preferences, propose them via
             `propose_personal_semantic`.
          
          3. **Procedural patterns** - If you observed a habit (e.g., user always
             runs tests before commit), propose with `write_procedural`.
          
          4. **Old memories you referenced** - For each, call `query_memory` with
             the same query - the R10 signal will boost their stability automatically.
          
          5. **Narrative events** - If a major emotional moment / turning point
             occurred, propose via `mark_narrative_event` BUT ONLY for user-marked
             events. Do NOT auto-classify (I9 invariant + Continuity §7.5).
          
          Never directly write personal_semantic. Always propose.
```

### 4.3 Prompt 一致性约束

- 任何 prompt 的措辞引用的不变量编号必须与 `00-overview.md` 一致（I1-I10）
- 任何 prompt 提到的 tool 必须存在于本文 §2

---

## 5. AI app 接入示例

### 5.1 Claude Code MCP config

`~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "mnemos": {
      "command": "mnemos-mcp",
      "args": ["--mode", "local-stdio"],
      "env": {
        "MNEMOS_ENDPOINT": "https://api.mnemos.org/v1",
        "MNEMOS_CAPABILITY_JWT_FILE": "~/.mnemos/agent-claude-code.jwt",
        "MNEMOS_AGENT_KEY_FILE": "~/.mnemos/agent-claude-code.key"
      }
    }
  }
}
```

### 5.2 Cursor MCP config

`~/.cursor/mcp/config.json`:

```json
{
  "servers": [
    {
      "name": "mnemos",
      "transport": "stdio",
      "command": "mnemos-mcp",
      "args": ["--mode", "local-stdio"]
    }
  ]
}
```

### 5.3 通用 MCP client（Python）

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="mnemos-mcp",
    args=["--mode", "local-stdio"],
    env={"MNEMOS_ENDPOINT": "https://api.mnemos.org/v1", "MNEMOS_CAPABILITY_JWT": "..."}
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("query_memory", {
            "query": {"text": "用户的写作偏好", "top_k": 5}
        })
```

### 5.4 Remote MCP（云模式）

```json
{
  "mcpServers": {
    "mnemos-cloud": {
      "transport": "http",
      "url": "https://mcp.mnemos.org",
      "headers": {
        "Authorization": "Bearer <capability_jwt>"
      }
    }
  }
}
```

适合移动端 / 浏览器 web app。

---

## 6. REST ↔ MCP 字段一致性保证

mnemos 的硬约束：MCP tool 的请求 / 响应字段必须能 1:1 映射到 REST API 的同名端点。

### 6.1 自动测试

每次 release 必跑 `mcp-rest-parity-test`：
- 对每个 MCP tool，构造一个调用
- 同时调对应 REST 端点，参数等价
- 比对响应 JSON canonical hash → 必须相同

### 6.2 字段命名规则

- REST 用 snake_case（`scope_id` / `created_at`）
- MCP 用 snake_case（同上）—— 与 REST 一致
- SDK 在 TS 中转换为 camelCase（`scopeId` / `createdAt`），在 Python 保持 snake_case

### 6.3 Schema 单一来源

`spec/schemas/` 目录（Round 2 产出）放 JSON Schema 定义；REST OpenAPI + MCP tool inputSchema 都从这里引用。

---

## 7. 本地模式 vs 云模式部署

### 7.1 部署形态对比

| 维度 | local stdio | remote http | hybrid |
|---|---|---|---|
| 适合 | 桌面 AI app（persona 1 主流） | 移动端 / web app | E2EE SKU 必需 |
| 网络 RTT | 0 | 网络 RTT | 0（本地解密）+ 网络（密文 sync） |
| 安装 | 每台机器装 mnemos-mcp binary | 注册 cloud account | 装 local proxy + cloud account |
| 鉴权 | local file（jwt + agent key） | bearer header | local file + cloud sync token |
| 升级 | 用户手动 / package manager | 服务端透明 | local 手动 + server 透明 |

### 7.2 local stdio 部署

```
~/.mnemos/
├── config.json                       # endpoint, sku, e2ee_mode
├── agent-keys/
│   ├── claude-code.jwt
│   ├── claude-code.key
│   ├── cursor.jwt
│   └── cursor.key
└── cache/
    ├── personal-semantic.sqlite      # L2 cache
    └── hnsw-index.bin                # E2EE 本地索引
```

`mnemos-mcp` binary 从 config 读 endpoint，转换 MCP JSON-RPC ↔ REST HTTP。

### 7.3 remote http 部署

服务端直接暴露 `https://mcp.mnemos.org`，AI app 直连。鉴权走 capability JWT。

### 7.4 hybrid 部署（E2EE SKU 必走）

```
AI app ↔ local mnemos-mcp (stdio) ↔ local key store + 客户端 SQLite + HNSW
                                  ↘ remote mnemos cloud (密文 sync only)
```

- AI app 看到的是 local MCP server（语义查询走本地索引）
- local MCP server 做密文加解密
- 远程 cloud 只存密文 + 元数据
- multi-device sync 走 CRDT delta（见 sizing §7.2 方案 B）

### 7.5 SKU c 自托管 MCP

部署者跑 `mnemos-server` + `mnemos-mcp` 在同一台机器；MCP server 通过 in-process call 直接调 service handler，不走 HTTP。

---

## 8. 与 MCP working group 的对接策略

### 8.1 现状

- MCP 协议在 Anthropic 主导下 2025-2026 持续演进
- capability handshake / resource subscription / prompt templates 是 v0 已稳定字段
- 部分高级特性（流式 tool 输出 / federated capability）还在演进

### 8.2 mnemos v0.1 的 MCP 兼容承诺

- 与 MCP 0.x spec 兼容（具体 minor 版本号待 Round 2 锁定）
- 任何 MCP spec breaking change → mnemos 在 6 个月内适配
- 任何 mnemos 内部协议变更不影响 MCP 兼容

### 8.3 mnemos 想推动的 MCP 扩展

下列 mnemos 用例可能推动 MCP working group 加新字段（Round 3+ RFC）：

| 用例 | MCP 缺的字段 |
|---|---|
| Capability 元数据中暴露 "server_e2ee" 标志（让 AI app 知道是否会泄漏内容到服务端） | `serverCapabilities.privacyMode` |
| Tool 调用的 audit_id 反向引用 | tool result 顶层 `audit_id` |
| Resource subscription 的 ACL 过滤说明 | resource metadata `filteredBy` |
| 跨 MCP server 的 capability federation | `crossServerCapability` |

mnemos v0.1 在自己的 envelope 里加这些字段（如 §2.7 的 `audit_id`），同时跟进 MCP working group 推动标准化。

### 8.4 不依赖 MCP spec 变更的兜底

如果 MCP spec 演进不接受 mnemos 的扩展请求，mnemos 仍能通过：
- Tool args 自带 metadata 字段（不依赖 MCP envelope）
- Resource URI 子路径表达 ACL 过滤
- 自定义 prompts 文档化使用约定

---

## 9. 不变量（MCP 层）

- **N1**: 任何 MCP tool 必带 `audit_id` 在 response（与 REST 同步）
- **N2**: 任何 MCP tool 调用必经 capability check（即使是 local stdio）
- **N3**: MCP server 永远不暴露 burn / update-manifest / register-agent 等 user-sovereign 操作
- **N4**: MCP server 字段命名与 REST API 严格一致（自动测试保证）
- **N5**: MCP resources 永远不暴露 raw archival bytes
- **N6**: MCP server 在 E2EE SKU 下必须走 hybrid 部署或显式 client-side 模式
- **N7**: 任何 MCP tool 写入 personal_semantic 必触发 I4_VIOLATION（即使 agent 试图 bypass，服务端兜底）
- **N8**: MCP server 必须在 `meta/schema-version` resource 暴露 schema_version，让 AI app 路由不同版本

---

## Handoff

> 下一步：读 `40-sdk-contract.md`（开发者直接 import 用的客户端契约）。

**End of mcp-server.**
