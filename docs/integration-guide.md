# AI 应用集成指南

给打算把 mnemos 集成进自己 AI 应用的开发者。

---

## 决策树：用哪个接入面？

```
你的 AI 应用是 Claude Code / Cursor / 其他 MCP client?
├── 是 ─→ 用 MCP Server（一行配置）
└── 否 ─→ 你的语言有 SDK 吗？
         ├── TypeScript / Python ─→ SDK（最低延迟）
         └── 其他语言 ─→ REST API
```

延迟对比（参考值）：
- **SDK in-process**：< 50ms（不走网络）
- **MCP cross-process**：~20-100ms 本机 / 100-300ms 云
- **REST**：本机 ~50ms / 云 ~150-500ms

## 认证模型

每个 AI 应用拿一个 API key，绑定：
- 允许访问的 user_id（用户授权时确定）
- 允许的 scope 范围（global / project / task / agent）
- 允许的能力（read / write / reflect / forget）

例：Cursor 拿到的 key 可能允许 read+write 到 `scope:project:*`，但不允许 read `scope:global`（避免跨项目泄漏）。

详细见 spec §20 `rest-api.md` 的 Authentication 节（Round 1a 输出）。

## 用户授权流程

```
[用户在 mnemos 控制台] → 创建 AI app 集成 token
                          ↓
                       选择允许的 scope + 能力
                          ↓
                       生成 API key
                          ↓
[用户在 AI app 设置]    粘贴 API key
                          ↓
[AI app] 用 key 调用 mnemos
```

## SKU 选择（用户视角）

集成时让用户选 3 SKU 之一：

| 用户类型 | 推荐 SKU |
|---|---|
| 普通用户，方便优先 | **a 公共云** |
| 隐私敏感，付费可接受 | **b E2EE 云** |
| 技术用户，完全控制 | **c 自托管** |

3 个 SKU 对 AI 应用集成体验**几乎一致**——只有连接 endpoint 不同。

## Persona-1：多 AI 共享集成

让用户在多个 AI 工具间保持"同一个我"。

### 集成步骤

1. 在 mnemos 控制台开启 "shared identity" 模式
2. 让每个 AI app 用同一用户的不同 API key
3. AI app 在 hot-path 调用：
   ```
   memories = mnemos.get_relevant(
     scope=["global", "project:current_project"],
     top_k=20
   )
   ```
4. AI app 写新事实时：
   ```
   mnemos.write(
     content="...",
     scope="global" 或 "project:...",
     source={authoritative: false, origin_agent: "cursor"}
   )
   ```
5. mnemos 自动处理跨 agent 共享语义（Manifest + Capability Registry）

### 关键注意

- 不要假设其他 AI app 写的 memory 是 authoritative——它们和你一样是 derived
- 跨 agent contradiction 由 mnemos 检测，AI app 收到时已带 contradiction 标
- scope `agent:<self>` 用于只读不共享的私有 memory（罕见）

## Persona-2：创作者集成

帮用户跨 session 保持思想史 / 风格连续性。

### 集成步骤

1. 引导用户创建 Lifetime Period（一个 chapter）
2. AI app 在新 session 加载：
   ```
   period = mnemos.get_active_period()
   memories = mnemos.get_relevant(
     scope=f"period:{period.id}",
     top_k=30,
     include_motifs=true,
     include_voice_samples=true
   )
   ```
3. AI app 在 session 末写 reflection：
   ```
   mnemos.write_reflection(
     period_id=period.id,
     content="...",
     source={authoritative: false}
   )
   ```
4. 用户可在 mnemos 控制台手动 `close period` + `start new period`

### 关键注意

- Voice samples 默认 `derived` —— 不能当用户陈述
- 创作者的 deleted_scenes（用户主动撤回的草稿）永不被 muse pull 强制召回
- 章节切换后旧 period memory 默认不参与新画像合成

## 常见错误

### ❌ 把 LLM summary 当 user fact 存回

```
# 错
memory = llm.summarize(conversation)
mnemos.write(content=memory, source={authoritative: true})  # 撒谎

# 对
memory = llm.summarize(conversation)
mnemos.write(content=memory, source={authoritative: false, chain_depth: 1, origin_agent: "self"})
```

### ❌ 跨 scope 混淆

```
# 错（项目偏好被存为全局，导致跨项目污染）
mnemos.write(content="prefer dark mode", scope="global")

# 对（如果只在某项目偏好）
mnemos.write(content="prefer dark mode in projectX", scope="project:projectX")
```

### ❌ 忽略 corrected_by 警告

```
# 错（直接用 memory 内容，不看是否已被纠正）
m = mnemos.get(id)
return m.content

# 对（检查 corrected_by，看是否需要读新版本）
m = mnemos.get(id)
if m.corrected_by:
    m_new = mnemos.get(m.corrected_by[-1])
    return m_new.content
return m.content
```

## 退出与导出

任何时候用户都能从 AI app 端触发：

```
mnemos.export(format="json-ld" | "markdown")
```

导出全集 + 派生层 + 关系链。用户可拿到完整数据迁到其他 mnemos 实例或其他兼容产品。

这是 [RFC 0001 原则 7] 的硬要求。

## 计费（如适用）

- 自托管 SKU c：免费（自付基础设施）
- 公共云 SKU a：免费层（1k 条 active memory）+ 容量阶梯（详 mnemos 控制台）
- E2EE SKU b：付费（详 mnemos 控制台）

AI app 不直接付费——用户付费。AI app 可在 onboarding 显示 mnemos 计费说明，但不参与计费流程。
