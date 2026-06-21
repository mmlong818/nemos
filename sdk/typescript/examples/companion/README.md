# Companion — 多人格 AI 陪伴 MVP（RFC 0008 骨架）

把 Nemos 当记忆引擎，搭"一个微信，通讯录里是会真正记得你的 AI 好友"。

```bash
# 离线 demo（零依赖：本地启发式抽取 + 回声脑，仍演示拓扑）
npx tsx examples/companion/index.ts

# 真实 LLM（智谱 glm-5.2 抽取 + embedding-3 向量检索 + free-form 人格回复）
#   PowerShell:  $env:ZHIPU_API_KEY="<key>"; npx tsx examples/companion/index.ts
#   bash:        ZHIPU_API_KEY=<key> npx tsx examples/companion/index.ts

# 交互式对话（真实 LLM，记忆持久化、跨次运行保留）
ZHIPU_API_KEY=<key> npx tsx examples/companion/chat-cli.ts

npm run test:v06                            # 含 companion-mvp 测试
```

> **API key 只走环境变量**，不硬编码 / 不入库。可用 `ZHIPU_MODEL`（默认 `glm-5.2`）、
> `COMPANION_DB`（默认 `companion-chat.db`，已 gitignore）、`COMPANION_USER` 覆盖。
> 中文检索：智谱 `embedding-3` 向量召回远胜 SQLite FTS（FTS 对无空格中文几乎只能整句匹配），
> 所以真实模式默认开 embedding。

## 记忆拓扑（见 `rfcs/0008-companion-memory-topology.md`）

| 概念 | 落地 |
|---|---|
| **真相一份** | 所有关于用户的记忆在 `forUser(userId)` |
| **在场边界** | `scope = conv:1on1:<user>:<persona>`；人格检索只看自己在场的 scope（`recall` 里 `visibleScopes`） |
| **防自污染** | 人格自己的"近况"存独立 namespace `forUser('persona:<id>')`，`authoritative=false`，永不写进用户库 |
| **双块上下文** | 回复时【关于对方的事实】与【你自己的近况】物理分开喂给人格 |
| **从不踩雷** | 检索默认只返回 `belief_state='active'`（失效闭环见 `contradiction-invalidation.test.ts`） |

## LLM 接线（`llm.ts`）

`resolveLLM()` 按环境变量自动选择，引擎本身（`engine.ts`）与选型无关、靠依赖注入：

| 用途 | 真实（有 ZHIPU_API_KEY） | 离线兜底 |
|---|---|---|
| 抽取/反思（需 JSON） | 智谱 `glm-5.2`（SDK `ZhipuProvider`，强制 json_object） | 本地启发式抽取 |
| 向量检索 | 智谱 `embedding-3` | 关（退化 FTS） |
| 人格回复（自然语言） | 智谱 free-form（**不**设 response_format） | 回声脑 |

> 关键点：SDK 自带的 provider 对 openai/zhipu **强制 json_object**（为抽取设计），
> 直接拿来做人格回复会得到 JSON。所以 `llm.ts` 的 `makeZhipuChat` 单独发 free-form 请求。
> 换其它 provider（anthropic/openai）照此模式加分支即可。

## 状态

✅ 1-on-1 文字回路（ingest → 双块召回 → 回复）、按会话分隔、人格自我状态。
✅ **群聊·在场扩散**：群是一段 scope，成员人格可见 scope = 它所在的全部会话（1-on-1 + 群）。
   群里说的话所有在场成员都能召回（含各自 1-on-1）；只对某人说的私事，别的成员看不到；非成员看不到群内容。
✅ **语音条**：走 SDK `voice-transcript` profile（异步语音的文本侧；真实 ASR/TTS 是 infra 边界，未含）。
⏳ 矛盾失效在 App 层的端到端接线（SDK 侧已就绪，`features.invalidation`）、真实语音 ASR/TTS。

> 群聊可见性采用「成员制、上下文无关」：人格在任何场合都能召回它在场过的全部会话内容
> （RFC 0008 §3 的「知识毕业」是未决项——是否在群里克制引用 1-on-1 私事，留作社交规范层）。
