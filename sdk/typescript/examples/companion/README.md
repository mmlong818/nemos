# Companion — 多人格 AI 陪伴 MVP（RFC 0008 骨架）

把 Nemos 当记忆引擎，搭"一个微信，通讯录里是会真正记得你的 AI 好友"。

```bash
npx tsx examples/companion/index.ts        # 离线 demo（本地抽取 + 回声脑）
npm run test:v06                            # 含 companion-mvp 测试
```

## 记忆拓扑（见 `rfcs/0008-companion-memory-topology.md`）

| 概念 | 落地 |
|---|---|
| **真相一份** | 所有关于用户的记忆在 `forUser(userId)` |
| **在场边界** | `scope = conv:1on1:<user>:<persona>`；人格检索只看自己在场的 scope（`recall` 里 `visibleScopes`） |
| **防自污染** | 人格自己的"近况"存独立 namespace `forUser('persona:<id>')`，`authoritative=false`，永不写进用户库 |
| **双块上下文** | 回复时【关于对方的事实】与【你自己的近况】物理分开喂给人格 |
| **从不踩雷** | 检索默认只返回 `belief_state='active'`（失效闭环见 `contradiction-invalidation.test.ts`） |

## 接入真实 LLM

`index.ts` 的 `localExtractionLLM()` 与 `echoChat` 仅为零依赖演示。生产替换：

- **抽取**：`new Nemos({ llm: { provider: 'zhipu'|'anthropic'|'openai', apiKey } })`
- **人格回复**：把 `ChatFn` 换成真实对话 LLM 调用

引擎本身（`engine.ts`）与 LLM 选型无关，靠依赖注入。

## 状态

✅ 1-on-1 文字回路（ingest → 双块召回 → 回复）、按会话分隔、人格自我状态。
⏳ 群聊（在场扩散）、语音条、矛盾失效在 App 层的端到端接线（SDK 侧已就绪，`features.invalidation`）。
