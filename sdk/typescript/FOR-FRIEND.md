# 给你（朋友）的试用包

> 这个 tarball 是 nemos 个人记忆基础设施 SDK 的 v0.1（embedded SQLite，无服务端）。
> 想看你能不能 5 行接入你的 AI 产品。

---

## 30 秒上手

```bash
# 1. 装包（不走 npm registry，直接装本地 tar）
npm install ./nemos-sdk-0.1.0.tgz

# 2. 装 peer dep（任选一个 LLM provider，或两个都装）
npm install @anthropic-ai/sdk
# 或
npm install openai
```

```typescript
// 3. 用
import { Nemos } from '@nemos/sdk';

const mem = new Nemos({
  storage: { type: 'sqlite', path: './nemos.db' },
  llm: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
});

const userMem = mem.forUser('user-abc');

// 沉淀：用户的任何输入
await userMem.ingest('我今天和老板谈了项目X，希望Q4交付');

// 取用：AI 中途搜索
const ctx = await userMem.getRelevantContext('项目X');
// → 直接拼到 LLM prompt 里
```

## 想试的话

1. 先读 **README.md** —— 完整 API + 5 分钟 Quickstart
2. 看 **examples/** 三个场景：chat-product / doc-search / coding-agent，挑最贴近你产品的那个跑一遍
3. 在你自己产品里挑一个真实使用场景试集成，~~~小时即可

## 我想要的反馈（按优先级）

### 1. 集成体验
- 5 行接入是真的吗？哪里磕？
- API 名字对吗？`ingest` / `search` / `getRelevantContext` 看到的第一眼能不能理解？
- 文档够不够？哪里看到一半"不知道下一步该做啥"？

### 2. 分类质量
- 拿你产品真实的用户输入跑 `ingest`，分类对吗？
- 在你场景下，5 层（archival/episodic/semantic/personal_semantic/procedural）够用吗？少了哪层？多了哪层？
- 搜索时 confidence/层级过滤有没有用？

### 3. 缺的东西
- 你想做但 SDK 没提供的能力（直说，不用客气）
- 你产品的特殊需求（多语言？大文件？多模态？团队共享？）

## 已知不完美（不用报）

v0.1 故意没做，README §「Known Limitations」有完整列表：
- ❌ FSRS decay（记忆衰减）
- ❌ Reflect 离线 job
- ❌ Relational store（关系共享）
- ❌ E2EE 端到端加密
- ❌ Lifetime Period（章节）
- ❌ Embedding 模型升级 migration
- ❌ 多设备同步
- ❌ Ed25519 agent 签名
- ❌ sqlite-vec ANN 索引（目前 brute force）
- 其他 4 项见 README

这些都列在路线图，不用试。

## 反馈怎么给

随便：
- 微信发我观察
- 写到 issue 文件
- 屏幕录制问题点

不用憋成完整报告——零散观察就够。

## 风险与边界

- 这是 Pre-Alpha，schema 还可能改（v0.1 → v0.2 我会管 migration）
- LLM 调用走你自己的 key，账单你付
- SQLite 文件归你产品所有，迁移/备份你掌控
- License Apache-2.0，你可以放进任何商业产品

## 我希望听到的最有价值的话

> "这个 API 我用了，但 [具体场景] 时遇到 [具体问题]，应该 [你的建议]"

不要：
> "看起来不错"（这话我学不到东西）

谢谢试用。
