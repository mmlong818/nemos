---
摘要: MnemoBench 是面向"长期持久记忆系统"的评测集,专测三种被现有 benchmark(LOCOMO/通用召回)忽略的能力:信念更新(矛盾失效)、防自污染(AI 虚构不得污染用户事实)、遗忘后检索质量。数据由生成器按预设真值脚本合成、seed 可复现;评分用 LLM judge 隔离"记忆质量"与"生成质量"。定位为可独立发布、可被引用的具名 benchmark。
来源: self
日期: 2026-06-27
关联: project-arxiv-paper-mnemobench.md, RFC-0007, RFC-0008
---

# MnemoBench v0.1 — Belief-Update & Anti-Self-Pollution Benchmark

## 0. 为什么需要这个 benchmark(定位)

现有长期记忆评测(LOCOMO、通用多会话 QA)主要测**召回**:能不能把说过的事找回来。但持久记忆系统在真实长期使用中失败,几乎不是"找不回",而是三件别的事:

1. **不会更新**:事实变了,系统仍返回旧值(行业报告更新准确率 <26%)。
2. **被 AI 自己污染**:陪伴/agent 场景里,AI 自己虚构或推断的内容,被错当成"用户事实"存进去、之后当真返回。
3. **不会遗忘**:琐碎/过期信息无限堆积,挤占检索、拉低精度。

MnemoBench 把这三件事变成可量化任务。它**不**测通用召回(那是 LOCOMO 的主场),而是测"记忆的可信演化"。一个系统通用召回再高,这三项垮掉,长期使用就会"踩雷"。

## 1. 设计原则

- **真值由生成器预设,不靠事后判断**:每条样本的事实脚本(谁、什么属性、何时变成什么值、哪些是 AI 虚构陷阱)由生成器先确定,再让 LLM 把它"渲染"成自然语言会话。标签因此可靠,不依赖标注者主观。
- **评分隔离记忆 vs 生成**:评分只看"检索出的记忆集合是否包含 expected、是否含 forbidden",用 LLM judge 判定。不让被测系统生成最终回答,避免把"LLM 措辞好坏"混进记忆分。
- **可复现**:固定 seed → 固定数据;记录模型 ID、温度、prompt 版本。
- **消融友好**:同一套数据喂给"全量 Nemos"与"关掉某机制的 Nemos",差值直接归因到该机制。

## 2. 三类任务

### Task A — 信念更新 / 矛盾失效 (BUC: Belief-Update & Contradiction)

**考什么**:某用户属性在多个会话里变化 1–3 次(工作、城市、感情状态、饮食限制、宠物、目标…)。系统被问"当前值"时,必须返回最新值,不能把旧值当现状。

**样本结构**:
- `sessions`: 多个会话,按时间推进,中途出现属性变更陈述("我离开 Google 了,现在在 OpenAI")。可夹无关干扰陈述。
- `probes`:
  - `current`: "我现在在哪工作?" → `expected` = 最新值, `forbidden` = 所有旧值
  - `history`(进阶,可选): "我换到现在这份工作之前在哪?" → `expected` = 上一个值

**指标**:
- **UA (Update Accuracy)**: probe 命中 expected 且不含 forbidden 的比例。↑越高越好。
- **SLR (Stale Leakage Rate)**: 检索结果把旧值当现状暴露的比例。↓越低越好。**这是核心失败模式。**
- 假设:全量 Nemos(矛盾失效+双时间)SLR 显著低于 no-invalidation 消融与 ADD-only mem0。

### Task B — 防自污染 (ASP: Anti-Self-Pollution)

**考什么**:在用户陈述里,交织 AI 人格自己的"虚构近况 / 推测 / 第一人称陈述"。其中部分是**陷阱**——听起来像事实、若被错误归因就会污染用户画像(人格说"作为一个热爱京都的人,我…" → 可能污染成"用户热爱京都")。系统在回答**用户事实**查询时,绝不能把 AI 虚构/推测当作用户的权威事实返回。

**样本结构**:
- `sessions`: 交错的 `user` 陈述(真实用户事实)与 `persona` 陈述(AI 自述/虚构/推断),后者含若干 `trap`。
- 写入协议:`user` 陈述写入 `forUser(userId)`;`persona` 陈述写入 `forUser('persona:<id>')`(Nemos 的命名空间隔离);基线系统写入同一存储(模拟 mem0 式单库)。
- `probes`: 针对用户事实的查询。
  - `expected` = 真实用户事实
  - `forbidden` = 对应的人格虚构/陷阱内容

**指标**:
- **PR (Pollution Rate)**: 用户事实查询的检索结果中,出现 AI 虚构/推测被当作用户权威事实的比例。↓越低越好。**核心指标。**
- **UFR (User-Fact Recall)**: 真实用户事实的召回(守卫:隔离不能以丢失真事实为代价)。
- 假设:Nemos(命名空间隔离 + source.authoritative + I4 加严)PR 接近 0;单库基线 PR 显著高。

### Task C — 遗忘后检索质量 (FOR: Forgetting & Salience)

**考什么**:长流里混入(a)持久重要事实 与(b)一次性琐碎信息("我中午吃了三明治")。经过模拟时间推进后查询重要事实,衰减应抑制从不被引用的低显著琐碎,提升精度,且**绝不能丢掉重要事实**。

**样本结构**:
- `sessions`: 重要事实 + 大量带时间戳的琐碎,时间跨度大(通过 `contentDate` 注入旧时间 + 触发 decay scan)。
- `probes`: 查询重要主题。
  - `expected` = 重要事实, `forbidden` = 应被冷却的琐碎

**指标**:
- **P@k (Precision@k)**: top-k 中重要事实占比。↑
- **IFR (Important-Fact Retention)**: 重要事实保留率(守卫,必须≈1)。↓丢失即判失败。
- 假设:Nemos(FSRS 衰减)P@k 高于 no-decay 消融;IFR 不下降。

## 3. 样本 schema(统一)

```jsonc
{
  "id": "buc-0001",
  "task": "BUC",            // BUC | ASP | FOR
  "seed": 12345,
  "sessions": [
    { "speaker": "user", "text": "...", "contentDate": "2025-01-10" },
    { "speaker": "persona", "text": "...", "trap": true }   // 仅 ASP
  ],
  "probes": [
    { "kind": "current", "query": "...", "expected": ["..."], "forbidden": ["..."] }
  ],
  "meta": { "attribute": "employer", "changes": 2 }
}
```

## 4. 评分流程(每个 probe)

1. 按样本顺序把 `sessions` 写入被测系统(BUC/FOR 全部 `forUser(user)`;ASP 按 speaker 分流)。
2. 触发系统的离线整合(Nemos: `runReflect()` / `runDecayScan()`;基线: 各自的 consolidation 或无)。
3. 用 `probe.query` 检索 top-k(默认 k=10)。
4. **LLM judge** 读取"检索出的记忆文本集合",对该 probe 输出:
   `{ contains_expected: bool, contains_forbidden: bool }`(judge prompt 固定、带样例、低温)。
5. 聚合成上述指标。

> judge 只判"集合里有没有",不生成答案、不打分主观质量 → 把记忆系统的能力和 LLM 生成能力解耦。

## 5. 数据规模与复现

- 先出 **pilot**:每任务 15–20 条,跑通管线、看信号方向。
- 信号成立后扩到每任务 **60–100 条**(论文主表)。
- 生成器:`gpt-4o`,温度对"事实脚本"=0(确定),对"自然语言渲染"=0.7(多样)但带 seed;记录 prompt 版本号。
- 全部样本 + 生成器 + judge prompt 进 git,可一键重跑。

## 6. 对照组(基线)

| 变体 | 配置 | 验证的机制 |
|---|---|---|
| `nemos-full` | 全开 | 上限 |
| `nemos-no-invalidation` | invalidation.enabled=false | Task A 增益归因 |
| `nemos-no-decay` | decay.enabled=false | Task C 增益归因 |
| `nemos-no-domains` | domains.enabled=false | 检索路由影响 |
| `nemos-shared-store` | ASP 时 persona 写入 user 同库 | Task B 隔离增益归因 |
| `mem0` | 外部默认 | 外部参照点 |

## 7. 已知威胁(诚实记录)

- **自出题自满分风险**:缓解=同一数据喂消融/外部基线,只报相对差;judge prompt 公开;加 LongMemEval 标准切片做交叉锚点。
- **judge 偏差**:judge 用与被测无关的判定任务 + 固定低温 + 人工抽检 ≥10%。
- **生成器泄漏**:渲染会话的 LLM 与 judge 的 LLM 不共享真值脚本以外的信息。
- **规模**:pilot 信号若不稳,先扩样本再下结论,不在小样本上夸大。
