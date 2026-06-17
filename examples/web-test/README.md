# Nemos Web Test PoC

> 端到端 PoC：在浏览器里完整跑一遍 Nemos 的「上传 → 分析 → 5 层分级存储 → 检查」流程。
>
> **状态**：v0.1，可工作的最小 demo。没有真后端，全在浏览器跑。

---

## 这个 PoC 验证什么

- ✅ Nemos schema（5 层 + 三维元数据 + source.authoritative）在真实数据上可工作
- ✅ "AI 是仆人不是代理"原则的工程落地：用户原文是 authoritative；LLM 提取的事实是 derived
- ✅ 分级展示让用户能审计 AI 替自己写了什么 memory
- ✅ 本地存储（IndexedDB）足以承担个人规模

## 不验证什么

- ❌ 多用户 / 多租户（PoC 只单用户）
- ❌ E2EE / 跨设备同步（数据全在 IndexedDB，不出浏览器）
- ❌ MCP / REST API（这是 SDK 直接 in-process 模式的最简版）
- ❌ 性能（没做 FSRS decay / contradiction detection / 跨 memory PageRank）

## 怎么跑

### 选项 1：本地直接打开

直接双击 `index.html`，或在终端：
```bash
# 任意 HTTP 静态 server（避免 CORS 问题）
python -m http.server 8000 -d E:/CC/code/nemos/examples/web-test/
# 浏览器访问 http://localhost:8000/
```

### 选项 2：模式选择

打开后右上角选模式：
- **Mock**（默认）—— 用规则启发式分析，立刻可用，不需 API key
- **Anthropic**—— 输入 Claude API key，用 Claude 真分析
- **OpenAI**—— 输入 OpenAI API key，用 GPT 真分析

API key 仅存浏览器 localStorage，**不发送到第三方**（仅发到对应 LLM provider）。

⚠️ 浏览器直连 LLM API 不适合生产——这里仅 PoC 演示。

---

## 操作流程

1. 左侧粘贴或拖入文本（任何内容：日记、聊天记录、文档摘录）
2. 点 **"分析并存入"**
3. 等待几秒，右侧 5 层面板出现新条目
4. 点条目展开看完整 frontmatter
5. 注意 `source.authoritative`：原文是 ✅ true，LLM 提取的事实是 ❌ false（derived）

## 5 层面板

按 Nemos spec：

| 层 | 颜色 | 含义 |
|---|---|---|
| Archival | 灰 | Immutable 原文备份（用户上传内容） |
| Episodic | 蓝 | 事件/瞬间观察 |
| Semantic | 绿 | 一般事实 |
| Personal Semantic | 紫 | 关于用户自己的事实（preferences, skills, relationships） |
| Procedural | 橙 | 行为模式 / how-to |

每个条目左下角 badge：
- `auth ✅` = 用户陈述（source.authoritative: true）
- `auth ❌` = LLM 推断（source.authoritative: false）
- `arousal: 0.x` = 情绪强度估计
- `surprise: 0.x` = 信息量估计

## 数据管理

- 顶部菜单：导出（JSON-LD）/ 清空 / 切换模式
- 数据全在浏览器 IndexedDB（DB 名 `nemos-poc`）
- 想完全清除：浏览器 DevTools → Application → IndexedDB → 删除 `nemos-poc`

## 文件结构

```
web-test/
├── README.md           本文件
├── index.html          UI 结构
├── style.css           2-pane 布局
├── app.js              主控制器
├── storage.js          IndexedDB wrapper
├── analyzer.js         LLM + Mock 分析器
└── renderer.js         右侧面板渲染
```

## 已知限制

- 浏览器直连 LLM 暴露 API key（PoC 容忍，生产不行）
- 没有 FSRS decay / contradiction detection
- IndexedDB 没有像 server 那样的 query 优化
- Mock 分析器是简化启发式（关键词分类），仅作演示
- 长文本（> 10k 字）可能让 LLM 超 context

## 下一步

如果 PoC 验证有效，下面是真正实施的优先级（参考 [`../../rfcs/`](../../rfcs/) Round 2 决策）：
1. server 端实现（取代 Mock）
2. 多 modality 输入（PDF/图/音）
3. contradiction detection
4. 跨设备同步（E2EE SKU）
