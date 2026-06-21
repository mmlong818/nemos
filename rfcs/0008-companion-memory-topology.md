---
rfc_number: 0008
title: Companion Memory Topology — Relational Visibility & Persona Self-State
authors:
  - nemos team
status: accepted
created_at: 2026-06-20
updated_at: 2026-06-22
discussion_url: ROADMAP.md
implementation_pr: merged（已并入 main；核心拓扑已实现，未决项见正文）
supersedes: []
---

# Summary

为「多人格 AI 陪伴 / IM」这一旗舰应用确立 Nemos 之上的**记忆拓扑约定**：一个人类用户的真相只存一份（`forUser(human)`），多个 AI 好友通过 **scope = 会话** 实现「在场才知道」的关系级可见性；每个角色的虚构自我（轻倾诉的「近况」）存于**独立 namespace**（`forUser('persona:<id>')`），与用户事实**硬隔离**以守住防自污染。绝大部分能力复用既有原语（`scope` 多过滤、`origin_agent`、`scenario`、`arousal`、`sensitive`、`belief_state`），仅少量 SDK 增补，并显式依赖 RFC 0007（矛盾失效）与 RFC 0004（衰减/唤起）。

# Motivation

## 现状

Nemos 至今没有锁定的应用场景；SDK 提供了通用记忆原语（5 层、双时间字段 v0.6、provenance、FSRS 衰减、scope/user 隔离），但**没有任何文档规定：当上层是"一个用户面对多个有人格的 AI 好友"时，记忆该如何切分、谁能看见谁的记忆、角色自己的"人生"放哪**。

陪伴被选为 Nemos 的旗舰应用（实证媒介），因为它恰好把 Nemos 差异化的楔子——**遗忘 + 矛盾失效 + 防自污染**——变成可被普通人当场感知的体验：现有所有陪伴产品（Replika / character.ai 类）的通病正是「记忆不连续、自相矛盾、把臆测当成你的事实」。

## 痛点

把多人格陪伴硬塞进通用原语，有四个必须先回答、答错代价极大的拓扑问题：

1. **真相该几份**：每个角色一份记忆副本（孤岛），还是全用户一份真相？前者会让"狗狗去世了"在 A 角色处生效、B 角色处仍说活着——跨筒仓矛盾，正是矛盾失效本要消灭的东西。
2. **在场边界**：1-on-1 里 A 听到的，B 不该自动知道；群聊里在场各角色都该知道。这条"在场才知道"如何落到 schema。
3. **角色自我**：轻倾诉要求角色有"近况/人生"。这份虚构内容若与用户事实同库，就会污染用户真相（违反 I4 / 防自污染）。
4. **从不踩雷**：用户说"狗狗走了"后，任何角色都不得再用现在时提它。这要求检索默认屏蔽已失效事实——直接依赖矛盾失效闭环。

无约定则每个应用各自发明切分方式，schema 用法漂移，且第 4 条会被反复重新实现或干脆缺席。

## 本 RFC 解决的问题

锁定一套**最小、可直接实施**的记忆拓扑约定，明确：(a) 用 `forUser` + `scope` 表达"单一真相 + 关系级可见性"；(b) 用独立 namespace 隔离角色自我；(c) 一次回复的上下文如何分块组装以物理隔开"用户事实"与"角色虚构"；(d) 哪些能力现成、哪些需 SDK 增补、哪些依赖 RFC 0007/0004。

## 与 Nemos 设计原则（RFC 0001）的关系

| 原则 | 本 RFC 的兼容方式 |
|---|---|
| 原则 1（AI 是仆人不是代理 / I4） | 角色自我（虚构近况）永不写入用户真相库；角色对用户事实只读、不可改。轻倾诉「不索取」是产品层对"仆人"的具体落地。 |
| 原则 3（默认衰减） | 复用 FSRS：琐碎闲聊自然 cold 下沉，情感重的瞬间靠 `arousal` 抗衰减/升层留存（依赖 RFC 0004 的 arousal→stability 联动）。 |
| 原则 5（不可变 archival / 三维元数据） | 情感高显著性的用户原话可存 archival（`archival_protected`，永不衰减/永不被改）；`arousal`/`surprise` 元数据直接服务情感留存。 |
| 原则 8（reflect 非 hot-path） | 事实沉淀、矛盾失效、跨会话链接全在 worker/reflect 离线跑；回复热路径只做检索 + 上下文拼装。 |
| 原则 10（E2EE 字段级标注） | `scope`/`origin_agent`/`scenario` 为元数据服务端可见（用于可见性路由），对话内容与角色自我内容仍字段级加密。 |

# Detailed Design

## 1. 实体与 namespace 映射

| 现实实体 | 映射 | 性质 |
|---|---|---|
| 人类用户 U | `forUser(U)` | **关于 U 的真相唯一一份**（user-truth store） |
| 角色 P₁…Pₙ（固定人格） | `forUser('persona:Pᵢ')` | 每个角色的**虚构自传**，硬隔离 |
| 一段会话 C（1-on-1 或群） | `scope = 'conv:<C>'` | 记忆归属的会话 = "在场边界" |
| 说话/观察者 | `source.origin_agent`（角色 id 或 `'user'`） | provenance，已实现 |
| 场景类型 | `scenario ∈ {'companion:1on1','companion:group'}` | 已实现字段 |

> **核心取舍**：`forUser = 人`（单一真相），**不是** `forUser = 角色`。后者把真相复制成 N 份孤岛，重新引入跨筒仓矛盾，直接打脸 Nemos 的矛盾失效卖点。角色间的"分隔"由 `scope` 可见性实现（§3），而非 user 硬隔离。

## 2. 三类记忆的落库

| 类别 | layer | 写到哪 | 关键字段 |
|---|---|---|---|
| 会话发言（在场真相源） | `episodic` | `forUser(U)` | `scope='conv:<C>'`，`origin_agent=说话者`，`scenario`，`arousal` |
| 关于 U 的事实（干净真相） | `personal_semantic` / `semantic` | `forUser(U)` | reflect 产出，`consolidated_from` 指回 episodic，scope 见 §3.3 |
| 角色自我（近况/人生） | `episodic` / `personal_semantic` | `forUser('persona:Pᵢ')` | 与 U 完全隔离；`authoritative=false`（对 U 而言是虚构） |

## 3. 关系级可见性：「在场才知道」

### 3.1 成员关系（应用层）

应用维护 `membership: Persona → Set<conv-scope>`：角色参与过哪些会话。这是唯一的应用层状态；记忆本身不冗余存"谁能看"。

### 3.2 检索即过滤

角色 Pᵢ 回复时，对 user-truth store 的检索限定在它在场过的会话：

```ts
await mem.forUser(U).search(userMsg, {
  scopes: membership.get('Pᵢ'),       // 仅 Pᵢ 在场的会话 scope
  // belief_state / invalid / expired 过滤见 §5（依赖 RFC 0007）
});
```

- 1-on-1：`conv:U-Pᵢ` 只在 Pᵢ 的 membership 里 → Pⱼ 检索不到 → **Pⱼ 不知道**。
- 群聊：群 `conv:grp-x` 在所有在场角色的 membership 里 → 都能检索到 → **在场都知道**。

"分隔（compartmentalization）"由此**自然涌现**，无需为每个角色复制记忆。

### 3.3 事实沉淀的可见性（MVP vs 终态）

reflect 把 episodic 沉淀为事实时，事实的可见性 = 它从哪些会话沉淀而来：

- **MVP**：事实**继承源 episodic 的 scope**（单一来源会话）。同一真相若在两个会话分别出现，则产生两条同义事实，经 `related` 链接；矛盾失效在 user 内跨 scope 作用（§5），不会两条打架。代价：少量重复（可接受）。
- **终态（见 Alternative B）**：单条全局事实 + 每角色"知道边"（who-knows-what edge，带 `learned_at`/`via_conv`）。这正是 RFC 0007 §3 事件流 / graphiti 知识边模型；待 `audit.mutations` 落地后升级，消除重复。

## 4. 上下文组装：双块物理隔离

一次回复的 prompt 由两个**来源不同、信任级别不同**的块构成，结构上隔开：

```
[关于对方的事实]   ← forUser(U).search(q, {scopes: membership(Pᵢ), <active-only>})
                     这是对方的真相：不可编造，已失效的不得提及。
[你自己的近况]     ← forUser('persona:Pᵢ').search(q)
                     这是你的虚构生活：可主动分享，但不得索取、不得"需要"用户。
[本次会话最近 N 轮原文]
```

**防自污染落在结构上**：用户事实与角色虚构来自两个 namespace，prompt 里是两个标注清晰的块，LLM 被明确告知二者的信任与使用规则不同。角色的"近况"永远进不了块 1，也永远写不回 `forUser(U)`。

## 5. 「从不踩雷」：检索侧失效过滤（依赖 RFC 0007）

回复前对 user-truth 的检索**必须默认只返回当前为真、当前采信**的事实：

```sql
valid_at <= now
AND (invalid_at IS NULL OR invalid_at > now)
AND expired_at IS NULL
AND belief_state = 'active'
```

- **设置失效**（"狗狗走了" → 旧"养着狗狗" `belief_state=invalidated` + `invalid_at`）由 **RFC 0007 Step 5 矛盾失效 worker** 完成。本 RFC **不重复定义失效机制**，而是声明它为陪伴的核心产品要求——**陪伴 App 是 RFC 0007 的 forcing function**：抽象的双时间/失效语义难以自证价值，但"AI 永不在你说宠物离世后还问它好不好"是能让人落泪的 demo。
- **过滤已失效（已实现，2026-06-22）**：检索默认 `belief_state='active'`，FTS 与向量两条路径均过滤失效记录；`SearchOptions.includeInvalidated` 为审计逃生阀。详见 §7。
- **I4 加严**（沿用 RFC 0007）：personal_semantic 的自动失效只能由 authoritative（用户亲述）触发；角色推断永不自动失效用户的个人事实。

## 6. 情感留存（依赖 RFC 0004）

"琐事淡忘、情感留存"= FSRS 衰减 + 情感显著性抗衰减：

- 高 `arousal` 的 episodic → 提高 FSRS 稳定性 S（抗 cold），或升层至 `personal_semantic`；极高显著性用户原话可固化为 `archival`（`archival_protected`，永不衰减）。
- arousal→stability 联动当前未实现（FSRS 的 D 参数仍占位），属 RFC 0004 范畴的小增补；本 RFC 声明该依赖。

## 7. SDK 变更（最小集）

绝大多数为**约定**，无需改 SDK。真正需要 SDK 侧的仅：

1. **检索默认失效过滤**（`SearchOptions`）：✅ **已实现**——默认 `belief_state='active'`，FTS/向量两路过滤，`includeInvalidated?: boolean` 逃生阀（随 RFC 0007 一并落地）。
2. **arousal → FSRS stability 联动**：RFC 0004 范畴，本 RFC 列为依赖。
3. **（可选，留作未决）关系级可见性是否升为 SDK 一等公民**：当前用 `scope` 约定即可满足；是否在 SDK 内提供 `relationalView`/witness 原语见 Unresolved。

`scope`/`scopes`/`origin_agent`/`scenario`/`arousal`/`sensitive`/`forUser` 隔离均**已实现**，直接复用。

## 跨 SKU 兼容性

- **a 公共云**：`scope`/`origin_agent`/`scenario` 元数据服务端可见，用于可见性路由；对话与角色自我内容正常存储。
- **b E2EE**：上述元数据服务端明文（不泄漏内容）；会话内容、角色自我内容字段级加密。**注意**：`scope='conv:<C>'` 会向服务端暴露"会话图结构"（哪些会话存在、各有多少条记忆），但不暴露内容——见 Unresolved。可见性过滤（scope）服务端执行，安全；矛盾检测 LLM 判定按 RFC 0007 迁客户端。
- **c 自托管**：与公共云同；membership 表与应用同处一地，最简单。

## 多租户语义

一个人类用户 = 一个 `(tenant_id, user_id)`。角色自我是同 tenant 下的附加 `user_id`（`persona:Pᵢ`）。**跨角色分隔（§3）是 scope 软边界，不是 tenant/user 硬边界**——见 Drawbacks 安全条目。跨 user 永不互相失效（沿用 RFC 0007）。

## 向后兼容

纯应用层约定 + 既有字段复用，**不引入 schema 破坏性变更**。§7.1 的检索失效过滤若改默认行为（默认隐藏非 active），属行为变更，应随 RFC 0007 以 feature flag 渐进启用，默认保持现状直到陪伴 SKU 显式开启。

# Drawbacks

- **分隔是软边界（安全攸关）**：跨角色隐私完全依赖 `scope` 过滤的正确性——一个过滤 bug = 跨角色记忆泄漏。这正是"记忆即攻击面"（OWASP ASI06 / MINJA）的本命场景，`scope` 过滤必须按安全边界测试（含越权检索、scope 注入），而非普通功能。
- **MVP 事实重复**：跨会话同义事实在终态知识边模型前会重复存储，依赖 `related` 链接与矛盾失效兜底一致性。
- **角色自我可能空洞或失控**：虚构近况做轻了显假、做重了滑向依赖/操纵。必须严格"有近况、不索取"，且永不污染用户库。
- **群聊事实归属复杂**：群里多个角色同时在场，"谁从群里学到什么"在 MVP 单一 scope 模型下表达力有限（终态靠知识边）。
- **强耦合 RFC 0007 / 0004**："从不踩雷"与"情感留存"两大卖点分别依赖未完成的 0007 Step 5 与 0004 arousal 联动；陪伴的核心体验受其进度制约。

# Alternatives

## 替代 A：每角色独立 namespace（角色即孤岛）
- 简述：每段关系 `forUser('rel:U-Pᵢ')`，各存各的用户副本。
- 优：硬隔离，分隔 = 强保证，过滤 bug 不致跨角色泄漏。
- 缺：关于 U 的真相被复制 N 份；A 处失效的事实 B 处仍活；无单一干净真相；矛盾失效退化为筒仓内局部有效。
- **拒绝理由**：直接摧毁 Nemos 的防自污染/矛盾失效核心价值与"单一真相"叙事。分隔应是可见性问题，不是真相复制问题。

## 替代 B：单一全局事实 + 知识边图（who-knows-what）
- 简述：用户事实存一份全局；另建"知道边"`knows(Pᵢ, fact, learned_at, via_conv)`，检索按边过滤。
- 优：零重复、provenance 极精确、天然支持"Pᵢ 在某时刻知道什么"的双轴 as-of、群聊扩散可精确建模。
- 缺：需要 RFC 0007 §3 的 `audit.mutations` 事件流/边存储（SDK 尚无）；读需 join；当前阶段偏重。
- **拒绝理由（仅暂缓）**：是**理想终态**，但依赖尚未落地的事件流。本 RFC 的 §3.3 MVP（scope 继承）是其中间态，待 0007 §3 落地后升级，非推翻。

## 替代 C：不做分隔（所有角色共享全部用户记忆）
- 简述：所有角色都对 `forUser(U)` 全量可见，无 scope 过滤。
- 优：最简单，无 membership 状态。
- 缺：失去"不同好友知道你不同面"的产品价值；隐私最差（一处倾诉处处皆知）；不真实。
- **拒绝理由**：抹掉了多人格陪伴相对单一 chatbot 的差异化，且隐私叙事崩塌。

# Unresolved Questions

- **多来源事实的 scope**：一条事实由跨多个会话的 episodic 沉淀时，MVP 该取并集 scope、还是拆多条？何时值得提前上知识边（B）？
- **群聊→私聊的知识"毕业"**：角色在群里学到的事，之后在与该角色的 1-on-1 里能否自然引用？边界如何呈现给用户？
- **关系可见性是否升为 SDK 一等公民**：留在应用层 `scope` 约定，还是 SDK 提供 witness/relationalView 原语（利于复用与统一测试，但增 SDK 表面）？
- **角色自我的来源与衰减**：persona self-state 是脚本预置还是 LLM 生成后落库？它是否也走 FSRS 衰减？跨会话一致性如何保证？
- **E2EE 下会话图泄漏**：`scope='conv:<C>'` 暴露会话结构是否可接受？是否需要 scope 名混淆/分桶？
- **0007 落地前的兜底**：矛盾失效 worker 未就绪时，应用层临时失效（仅 authoritative personal_semantic，reflect 后置）应多激进？误失效与"踩雷"如何权衡？

# Prior Art

- **Replika / character.ai 等多人格陪伴**：提供无限人格但**记忆不连续、无关系级分隔、自相矛盾**——本 RFC 要差异化的反面教材。
- **Graphiti（getzep）知识边 / episode 模型**：替代 B 的直接来源（边带 `valid_at`/`learned`，矛盾驱动失效）。
- **Nemos RFC 0007（双时间与失效）**：本 RFC §5「从不踩雷」的直接依赖；§3.3 终态复用其 §3 事件流。
- **Nemos RFC 0004（遗忘与整合）**：§6 情感留存依赖其 FSRS 与 arousal。
- **Nemos RFC 0002（Scenario Profiles）**：复用 `scenario` 字段表达 1on1/group。
- **OWASP ASI06 / MINJA（arXiv 2503.03704）**：记忆即攻击面——软分隔的安全论据。

# Implementation Plan（accepted 后填）

> 与产品 MVP 切片对齐；依赖 RFC 0007 Step 5（矛盾失效）与 RFC 0004（arousal 联动）。

- Step 1（应用层骨架）：`forUser(U)` + `scope=conv` + `origin_agent`/`scenario` 写路径；membership 表；双块上下文组装；2–3 个固定人格的 1-on-1 文字回路（ingest → reflect → 检索 → 回复）。
- Step 2（从不踩雷）：接入 RFC 0007 检索侧失效过滤（§7.1）；在 0007 worker 就绪前用应用层临时失效兜底（仅 authoritative personal_semantic）。
- Step 3（情感留存）：接入 RFC 0004 arousal→stability 联动 + 高显著性升层/固化策略。
- Step 4（群聊）：群 `scope` + 在场 membership 扩散；语音条（异步）。
- Step 5（角色自我）：`forUser('persona:Pᵢ')` self-state 写读 + 一致性；轻倾诉策略护栏（不索取）。
- Step 6（终态升级）：待 RFC 0007 §3 `audit.mutations` 落地，从 scope 继承升级为知识边模型（替代 B），消除事实重复，支持"角色在某时刻知道什么"的双轴 as-of。

# FAQ

**Q：为什么不给每个 AI 好友各存一份记忆，那样隔离不是更干净？**
A：那会把"关于你的真相"复制成 N 份，导致一处更新（狗狗去世）别处不同步——正是矛盾失效要消灭的跨筒仓不一致。正确做法是：真相一份，可见性按"谁在场"过滤（§1 取舍 / 替代 A）。

**Q：角色编造的"自己的生活"会不会被记成关于我的事实？**
A：不会。角色自我存在独立 namespace（`forUser('persona:Pᵢ')`），写路径永不跨入用户库；回复时它只作为"块 2"出现并标注为虚构。防自污染是架构边界，不是启发式（§4）。

**Q：群聊里我说的话，没在群里的角色会知道吗？**
A：不会。记忆按会话 scope 归属，只有在场角色的 membership 含该群 scope（§3.2）。这就是"在场才知道"。

**Q：这个 RFC 要改 SDK 吗？**
A：极少。绝大部分是既有原语（scope/origin_agent/scenario/arousal/forUser）的使用约定。真正的 SDK 增补只有检索侧失效过滤（建议并入 RFC 0007）与 arousal→stability 联动（RFC 0004）。

**Q：陪伴是应用，为什么值得一篇 RFC？**
A：因为它确立了"多主体可见性"如何映射到 Nemos 原语这一**契约级约定**，并把 RFC 0007（矛盾失效）从基础设施待办提升为旗舰产品的核心要求——影响 SDK 优先级与潜在一等公民原语，需公开讨论。
