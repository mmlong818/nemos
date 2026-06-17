---
rfc_number: 0002
title: Scenario Profiles + Content Awareness
authors:
  - nemos founding team
status: accepted
created_at: 2026-06-04
updated_at: 2026-06-04
discussion_url: ROADMAP.md
implementation_pr: TBD (v0.2 dispatch)
supersedes: []
---

# Summary

给 Nemos SDK 加入「场景感知」能力：分析同一份内容时，根据用户/AI 应用声明的 scenario，调整层级偏好、抽取重点、时间感知、敏感度处理。同时增加内容时间字段（`event_at`）和长内容自动 chunking。

# Motivation

v0.1 PoC 暴露的问题：

1. **单一 SYSTEM_PROMPT 对所有内容**——把研报当日记，把日记当研报
2. **无时间感知**——MiniMax 报告含 "M3 于 2026-06-01 发布"，但 memory.created_at = ingest 时刻 = 2026-06-04
3. **长内容（>10k 字）压一次喂 LLM**——token 预算紧，episodic 被压入 semantic（双 pass 之前的对比已验证）

朋友的 AI 产品很可能"明确知道当前 context"——客服会话、文档上传、coding session——但 v0.1 没办法让朋友传达这个 context。

# Detailed Design

## 1. ScenarioProfile 类型

```typescript
type ScenarioProfile = {
  name?: string;  // 内置 profile 不必填；自定义建议填
  
  emphasis?: {
    layers?: Partial<Record<Layer, number>>;  // 层加权，default 1.0
    signals?: string[];  // 重点信号（emotion/decision/...）
  };
  
  exclude?: {
    layers?: Layer[];  // 显式排除某层
  };
  
  promptAddendum?: string;  // 拼到 SYSTEM_PROMPT 末尾
  
  temporal?: {
    extractEventDate?: boolean;  // 启用 event_at 抽取
  };
  
  privacy?: {
    sensitive?: boolean;       // 默认标 sensitive
    hideFromSearch?: boolean;  // 默认不进 search 索引（仍存）
  };
  
  chunking?: {
    maxChars?: number;     // 单段最大字符（默认 8000）
    overlap?: number;       // 段间重叠（默认 200，保证不切断语义）
  };
};
```

## 2. 内置 Profile（6 个）

| Name | Emphasis | Exclude | Privacy | Use Case |
|---|---|---|---|---|
| `default` | 无加权 | — | — | 未声明时（v0.1 行为） |
| `chat` | episodic 1.5, personal_semantic 1.3, signals: emotion/decision/relationship | — | — | 聊天对话片段 |
| `doc-research` | semantic 1.5, procedural 1.4 | **personal_semantic** | — | 研报/技术文档（第三方"我"不是用户） |
| `coding` | procedural 1.5, semantic 1.3, signals: pattern/antipattern/config | — | — | 代码 review / 项目笔记 |
| `diary` | episodic 2.0, personal_semantic 1.5 | — | **sensitive + hideFromSearch** | 个人日记/情感记录 |
| `meeting` | episodic 1.5, procedural 1.3, signals: decision/action-item/commitment | — | — | 会议纪要/语音转写 |
| `voice-transcript` | episodic 1.4, signals: narrative-arc | — | — | 语音转文字 |

## 3. API 变更

### IngestOptions 新增：

```typescript
type IngestOptions = {
  // v0.1 已有
  scope?: string;
  originAgent?: string;
  skipAnalysis?: boolean;
  metadata?: Record<string, unknown>;
  
  // v0.2 新增
  scenario?: string | ScenarioProfile;  // string 引用内置；object 自定义
  contentDate?: string;  // 已知内容产生时间，覆盖自动抽取
};
```

### 朋友的代码：

```typescript
// 内置 profile
await userMem.ingest(diaryText, { scenario: 'diary' });

// 自定义
await userMem.ingest(symptomLog, { 
  scenario: {
    promptAddendum: '用户健康追踪。症状/用药/睡眠归 episodic 带时间，规律/触发因素归 procedural',
    privacy: { sensitive: true },
    temporal: { extractEventDate: true }
  }
});

// 不传 = default = v0.1 行为（向后兼容）
await userMem.ingest(anything);
```

## 4. Schema 变更

### Memory 新增字段：

```typescript
type Memory = {
  // ... v0.1 所有字段保留
  
  // v0.2 新增
  event_at?: string;     // 内容里的事件实际发生时间（ISO 8601），与 created_at 区分
  sensitive?: boolean;   // 敏感内容标记
  scenario?: string;     // 来自哪个 scenario profile（追溯用）
};
```

### Storage 变更：

- 5 张层表加 `event_at` 列（nullable）+ `sensitive` 列（default false）+ `scenario` 列（nullable）
- 加索引 `idx_event_at` 支持时间窗口查询
- search 默认 `WHERE sensitive = false`（除非显式 query sensitive）
- schema_version: "0.1" → "0.2"
- migration：旧记录 `event_at = NULL`, `sensitive = false`, `scenario = NULL`

## 5. Analyzer 变更

### 长内容 chunking 算法：

```typescript
function chunk(content: string, maxChars: number, overlap: number): string[] {
  if (content.length <= maxChars) return [content];
  
  // 按 markdown 章节（## ## ###）优先切
  const sections = content.split(/\n(?=##?#? )/);
  
  // 章节太长再按段落切；段落仍长按句切
  const chunks: string[] = [];
  let cur = "";
  for (const s of sections) {
    if (cur.length + s.length <= maxChars) {
      cur += s;
    } else {
      if (cur) chunks.push(cur);
      // 上一段尾巴 overlap 字符接到下一段头
      cur = cur.slice(-overlap) + s;
    }
  }
  if (cur) chunks.push(cur);
  
  return chunks;
}
```

每段独立分析 → merge derived → 第三 pass 全文 dedupe + scenario emphasis 应用。

### Event date 抽取：

prompt 添加："如果 derived 涉及具体事件且原文有时间标识（'昨天'/'2026-05-30'/'去年春天'），抽 `event_at` 字段（ISO 8601 day 或 month 精度即可）"。

LLM 解析"昨天"等相对时间 → 用 ingest 时刻作为 anchor（"昨天" = ingest_date - 1）。这层逻辑由 prompt 引导，SDK 不强解析。

### Scenario emphasis 应用：

`emphasis.layers` 权重不是 hard 排序——是 prompt 里加引导："此场景下倾向把模糊事件归 episodic 而非 semantic"。

`exclude.layers` 是 hard 排除——分析后过滤 derived 数组。

## 6. API 兼容性

- v0.2 完全向后兼容 v0.1
- 不传 `scenario` = 用 `default` profile = v0.1 行为
- schema 升级走自动 migration（首次启动 v0.2 SDK 时跑）
- 已有 v0.1 SQLite 文件可继续用，旧 memory 的新字段值为 NULL/false

## 7. 双 pass + 校验 在 chunking 下的行为

3 选项：
- **A. 每段都跑双 pass + 全文 check pass**（3N+1 次 LLM 调用，最稳但最贵）
- **B. 每段单 pass + 全文 check pass 跨段比对**（N+1 次，省 ½）
- **C. v0.1 行为：仅在不 chunk 时双 pass**（chunk 时关 doubleCheck）

**决议 C**：chunk 多段已经是冗余覆盖（不同段独立抽取），无需再双 pass 加冗余。Chunking 触发时自动 `doubleCheck=false`。文档明确告诉朋友。

# Drawbacks

- API surface 增加（IngestOptions 新增 2 字段 + ScenarioProfile 类型）
- Schema migration 必须可靠（破了会丢数据）
- 内置 profile 选错（朋友传 `chat` 但内容是会议）会比 default 更差
- 长 content chunking 跨段 entity 关联可能丢

# Alternatives

## A. 不做 scenario，让朋友自己写 SYSTEM_PROMPT
- 优：API 简单
- 劣：朋友重写 prompt 工程量大，错误率高
- **拒绝**：违背"5 行接入"承诺

## B. 用 LLM 自动检测 scenario
- 优：朋友不用指定
- 劣：多一次 LLM 调用 + 检测错代价大
- **缓 v0.3**：作为 `scenario: 'auto'` 选项实施，不强制

## C. 把 scenario 改成更细粒度（label[] / tags[]）
- 优：组合更灵活
- 劣：朋友学习曲线高
- **拒绝**：6 个内置 + 自定义 object 已经足够灵活

# Unresolved Questions

1. **跨 chunk 的 archival 怎么处理**？
   - 当前：archival 永远存完整原文（不 chunk）
   - 但若内容超 SQLite TEXT 列限制（1GB 理论上限够大，实际不是问题）
   - 决议：archival 始终存完整原文，chunking 仅影响 LLM 输入

2. **`sensitive=true` 的 archival 是否也 hide**？
   - 若是：getRelevantContext 看不到原文，但 archival 仍存在
   - 若否：archival 可见，但 derived 看不见
   - 决议：archival 始终可见（用户主权），derived 默认 hide
   - 用户主动 `search({ includeSensitive: true })` 显式调出

3. **自定义 ScenarioProfile 的 promptAddendum 安全性**？
   - 朋友能注入任意 prompt → 可能注入恶意指令污染分析
   - 当前：trust 朋友（他是 SDK 集成方，不是终端用户）
   - 文档警告：promptAddendum 来自不可信源时需先净化

# Prior Art

- mem0：单一 prompt 无 scenario 区分
- Memory-Palace：layer 区分但无 scenario
- LangChain Memory：memory_type 配置（buffer/window/summary）类似 scenario 但只控制存储不控制抽取
- v0.1 PoC 双 pass 校验：抗 LLM 非确定性的相关技术

# Implementation Plan

1. **types.ts** 加 ScenarioProfile + Memory.event_at/sensitive/scenario
2. **prompts.ts** 加内置 6 个 profile 常量 + SYSTEM_PROMPT 拼接逻辑
3. **analyzer.ts**：
   - 接受 profile 参数
   - chunking 函数 + 跨 chunk merge
   - scenario emphasis/exclude 应用
   - event_at / sensitive 字段强制
4. **storage.ts**：schema migration v0.1 → v0.2，加 3 字段 + 索引
5. **index.ts** Nemos / UserMemory 转发 scenario 参数
6. **tests/**：
   - 6 个 profile 各自单测（用 fixture 内容）
   - 长内容 chunking 测
   - migration 测（v0.1 db 加载到 v0.2）
   - sensitive hide-from-search 测
7. **examples/** 加 `examples/scenario-profiles/`（演示 6 profile 用同一份内容产出差异）
8. **README**：scenario 节 + 完整 profile 参考表
9. **CHANGELOG.md** v0.2 entry

# FAQ

**Q**：朋友若不知道 scenario 怎么办？
A：传 `default` 或不传 = v0.1 行为，仍然可用。

**Q**：自定义 profile 能完全覆盖内置吗？
A：能。传 object 完全自定义。建议参考内置 profile 的字段组合。

**Q**：`event_at` 是必须的吗？
A：不是。LLM 抽不出来就 NULL。

**Q**：长内容 chunking 时 archival 会被切断吗？
A：不会。Archival 永远完整原文。chunking 仅影响 LLM 输入路径。
