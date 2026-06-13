# mnemos Roadmap

> 从 v0.1（朋友试用包）走到 v1.0（生产级 OSS infra）的版本节奏。
> 每条 backlog 项已在 [`rfcs/`](rfcs/) 立项；按版本聚合发布。

---

## 当前状态：v0.1 (2026-06-04 ✅ ship)

朋友试用包：
- TS SDK 嵌入式（SQLite + FTS5 / 可选 sqlite-vec embedding）
- 5 层 schema + 三维元数据 + 双 pass 校验
- 3 个 LLM provider（Anthropic / OpenAI / Custom）
- 3 个集成示例 + 16/16 测试通过
- README 朋友 5 行接入

**反馈窗口**：1-2 周（task #17）

---

## v0.2 — Content-Aware Analysis（计划立即启动）

**主题**：让分析"看场景下菜"——同一段内容在不同场景被抽出不同结构。

**核心 RFC**：[`rfcs/0002-scenario-profiles-and-content-awareness.md`](rfcs/0002-scenario-profiles-and-content-awareness.md)

**Scope**（3 个紧耦合改动，一起 ship）：

| ID | 改动 | 为什么打包 |
|---|---|---|
| **A** | Scenario profiles（6 个内置 + 自定义） | 改 analyzer 入口契约 |
| **B1** | Temporal awareness（`event_at` 抽取） | 同改 schema + analyzer prompt |
| **B3** | Long content auto-chunking | 同改 analyzer 输入路径 |

**朋友新增 API**：
```typescript
await userMem.ingest(content, { scenario: 'chat' | 'doc-research' | 'coding' | 'diary' | 'meeting' | 'voice-transcript' });
```

**目标质量提升**：分类准确度（特别是 doc-research 和 diary 两端）+30-50%。

**工时**：1 个 agent dispatch（~2-3 小时）

---

## v0.3 — Production Pipeline（v0.2 ship 后启动）

**主题**：让 SDK 真正能在生产负载下工作。

**Scope**：

| ID | 改动 | 影响 |
|---|---|---|
| **B2** | Background analysis pipeline | ingest 拆 archival(sync) + derived(bg queue) |
| **B4** | Multi-perspective extract | 不同 pass 不同视角（事实 / 情绪 / 方法论），加深度 |
| **B5** | Cross-memory auto-linking | `related` 字段自动填，spreading activation 检索 |

**目标**：50ms 内 ingest 确认 + 后台秒级深度分析；search 可走 entity graph。

**工时**：~1 周

---

## v0.4 — Forgetting & Consolidation（v0.3 ship 后）

**主题**：从"全部记住"走向"有质量地记忆"。

**Scope**：

| ID | 改动 | 影响 |
|---|---|---|
| **B6** | Sensitivity tagging | 健康/财务/情感自动标 sensitive，默认从 search 隐藏 |
| **B7** | Output formatting tiers | `getRelevantContext()` 支持 flat / tiered / narrative |
| **B9** | FSRS decay engine（已在 v0.1 README 列） | 访问强化 / 不访问衰减 / 阈值降级 |
| **B10** | Reflect 离线 job | 累积 episodic 抽 semantic 升层，sleep consolidation 工程化 |

**工时**：~1-2 周

---

## v0.5 — Multi-modal（v0.4 ship 后）

**Scope**：

| ID | 改动 |
|---|---|
| **B8** | 图片 OCR + Vision LLM / 音频转写保留 arousal / PDF page-aware chunk |
| C-1 | 多设备同步设计（不实施，先 RFC） |
| C-2 | E2EE SKU 雏形（仅协议层） |

**工时**：~2-3 周

---

## v1.0 — Production Ship（≥ 6 个月后，看反馈）

- 3 SKU 全实施（公共云 / E2EE / 自托管）
- MCP server wrapper
- REST API server
- Python SDK
- 跨产品 sync 协议（spec 0004?）
- 真实多 contributor，移出 BDFL 阶段

---

## 依赖图

```
v0.1 (ship) ────────┐
                    ├── feedback collection (1-2 wk)
                    │
v0.2 (now) ─── A scenario ─┐
            └─ B1 temporal ┤
            └─ B3 chunking ┘── analyzer.ts 重构后稳定
                                    │
v0.3 ──── B2 background ────────────┤
       └─ B4 multi-perspective ─────┤── 生产 pipeline
       └─ B5 cross-memory ──────────┘
                                    │
v0.4 ──── B6 sensitivity ───────────┤
       └─ B7 output formatting ─────┤── 衰减 + 整合
       └─ B9 FSRS decay ────────────┤
       └─ B10 reflect job ──────────┘
                                    │
v0.5 ──── B8 multi-modal ───────────┤── 模态扩展
                                    │
v1.0 ──── 全部 SKU + MCP + REST ─────┘
```

---

## 不在路线图（v1.0 之后再说）

- Federated learning（多用户聚合训练）
- Plugin system（第三方插件改 analyzer 行为）
- 实时 streaming ingest
- 分布式 storage 后端
- LangChain / LlamaIndex 集成 adapter

这些 stuff 真的需要时**单独立 RFC 讨论**，不预设进度。

---

## 每版本质量门

任何版本 ship 前必须过：

1. ✅ 全部 unit/integration 测试通过
2. ✅ RFC 0001 的 12 条原则不变量没破坏
3. ✅ `npm pack` + 装到空 demo 项目能跑
4. ✅ 至少 1 个 example/ 用上新功能并跑通
5. ✅ CHANGELOG.md 更新
6. ✅ README 5-min Quickstart 仍然 5 分钟能跑
7. ✅ schema_version bump（如 schema 变）+ migration 路径

---

## 时间线（estimate，不承诺）

| 版本 | 计划 ship | 主要工作 |
|---|---|---|
| v0.1 | ✅ 2026-06-04 | 朋友试用包 |
| v0.2 | 2026-06-06 | scenario + temporal + chunking |
| v0.3 | 2026-06-15 | production pipeline |
| v0.4 | 2026-06-30 | forgetting & consolidation |
| v0.5 | 2026-07-20 | multi-modal |
| v1.0 | 2027 Q1 | 3 SKU + 全协议 |

---

**RFC 进度**：
- ✅ 0001 mnemos Design Principles
- 🔄 0002 Scenario Profiles + Content Awareness（v0.2，写于本 commit）
- 📋 0003 Background Pipeline + Multi-Perspective Extract（v0.3，待写）
- 📋 0004 FSRS Decay + Reflect Consolidation（v0.4，待写）

每个 RFC 都对应一个版本周期，避免 scope creep。
