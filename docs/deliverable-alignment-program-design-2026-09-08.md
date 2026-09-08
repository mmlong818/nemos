# 程序设计：交付物对齐三项（提案，待确认）

状态：**第 1 项已实现；第 2 项已决定暂不做；第 3 项已决定不做。**
本文保留原始程序设计内容，实现与设计的偏差记在文末。
来源与理由见 [四道门与提示指令预算](agentic-workflow-2026-09-08.md)。

三项彼此独立，可以只批其中一项。

---

## 研究结论（改动前的现状）

| 事实 | 位置 |
| --- | --- |
| 能力执行提示由 `buildRunPrompt` 装配，末尾是 `executionRequirements` 编号列表（当前 10 条） | `capabilities.ts:2078`、`:2143` |
| 执行链：`runTask → notify/notifyStream → completeAbilityReply → finishTaskRun → writeArtifact` | `capabilities.ts:1336`、`:1358`、`:2410` |
| 原始回复整篇写入 `<产物>.context.md`（截至 16 万字符） | `capabilities.ts:2419` |
| 产物已有 `metadata`（`validationChecks` / `workspace` / `lineage` …）与 `proof.level`（produced→validated→verified→approved） | `capabilities.ts:231`、`:259` |
| 原生能力已有"从回复里抽结构"的先例 | `native-capability-contracts.ts:49` `parseNativeCapabilityPayload` |
| 已存在续写提示（按长度续写，不是加深） | `capabilities.ts:2168` `buildContinuationPrompt` |
| 产物在历史列表里渲染，已显示 `proof` 等级与 `generatedAbilityId` | `web/assets/capability-center.js:1088` `renderHistory` |
| 验收字段 `requiredFields` 只在 assistant-team 路径存在，能力路径没有 | `assistant-team.ts:204` |
| **能力执行提示不在 `prompt-budget` 守卫覆盖范围内** | 守卫只量 `engine.send` 装配的那份 |

---

## 第 1 项：待确认判断（`openQuestions`）

每份交付物附上助理自己最没把握的 2–3 个判断。

### 文件与改动点

| 文件 | 改动 |
| --- | --- |
| `deliverable-alignment.ts`（新） | 类型、解析、边界校验。纯函数，不碰运行时 |
| `capabilities.ts` | `executionRequirements` 加一条；`writeArtifact` 解析并写入 `metadata.openQuestions` |
| `web/assets/capability-center.js` | `renderHistory` 的状态行追加"N 项待确认" |
| `prompt-budget.ts` | **不动**——能力执行提示不纳入守卫，理由见文末第 5 条 |

### 类型与签名（无实现体）

```ts
// deliverable-alignment.ts
export interface OpenQuestion {
  /** 助理没把握的那个判断，一句话。 */
  question: string;
  /** 它当前采用了哪个做法——没有这个，用户无法判断要不要改。 */
  assumed: string;
  /** 判断错了会影响交付物的哪一部分。 */
  affects: string;
}

export const OPEN_QUESTION_LIMITS = {
  maxItems: 3,
  maxFieldLength: 200,
  /** 结构块的定界标记，与 memory-evidence 同一套转义立场。 */
  openTag: "<open_questions>",
  closeTag: "</open_questions>",
} as const;

/** 提示里要求模型输出的那一条要求原文。放在这里而不是散在 capabilities.ts。 */
export function openQuestionsRequirement(): string;

/**
 * 从模型原始回复末尾解析结构块。
 * 解析失败一律返回空数组，不抛：拿不到"待确认判断"不该让整个交付物失败。
 */
export function parseOpenQuestions(raw: string): OpenQuestion[];

/** 把结构块从正文里摘掉，交付物本体不应该带着这段 JSON。 */
export function stripOpenQuestions(raw: string): string;
```

```ts
// capabilities.ts — CapabilityArtifact.metadata 追加
openQuestions?: OpenQuestion[];
```

### 调用栈

```
buildRunPrompt
  └─ executionRequirements 末尾 += openQuestionsRequirement()
finishTaskRun
  └─ writeArtifact(task, ability, raw)
       ├─ const openQuestions = parseOpenQuestions(raw)        // 新
       ├─ raw = stripOpenQuestions(raw)                        // 新，在写文件之前
       ├─ writeFileSync(contextFile, raw…)                     // 现有
       └─ artifact.metadata.openQuestions = openQuestions      // 新
```

### 测试会断言什么

`tests/unit/deliverable-alignment.test.ts`
- 正常块解析出 1–3 项，每项三个字段齐全；缺字段的项被丢弃而不是补空串。
- 超过 `maxItems` 时截断到 3；单字段超长时截断到 200 字符。
- 无结构块 / JSON 坏 / 块里是数组之外的东西 → 返回 `[]`，**不抛**。
- `stripOpenQuestions` 摘掉块后正文末尾不留空块残骸；正文里出现 `</open_questions>` 字样时不会被误截。
- 定界符转义：`question` 里含 `<open_questions>` 时不能伪造出第二个块。

`tests/unit/capabilities-open-questions.test.ts`
- 走一次 `runTask`（mock notify 返回带块的回复）→ 产物 `metadata.openQuestions` 有值，且 `.context.md` 里**没有**那段 JSON。
- mock 回复不含块 → 产物照常生成、`openQuestions` 为 `undefined` 或 `[]`，任务不失败。

---

## 第 2 项：薄完整版优先（`thinFirst`）

长交付物先出一版每节都在、每节一段的完整草稿，停下等确认，再逐节加深。

### 文件与改动点

| 文件 | 改动 |
| --- | --- |
| `deliverable-alignment.ts` | 判断哪些能力适用、生成两阶段提示 |
| `capabilities.ts` | `CapabilityTask` 增加阶段字段；`runTask` 分两阶段；新增 `deepenTask` |
| `server.ts` | `POST /api/capabilities/task/deepen`（走 `agentUserActions`） |
| `web/assets/capability-center.js` | 薄版产物上显示"确认后加深"入口 |

### 类型与签名（无实现体）

```ts
// deliverable-alignment.ts
/**
 * 只对"长交付物"启用。判据是目标格式与能力，而不是猜字数：
 * 一份三段的决策简报做两阶段是净损失。
 */
export function usesThinFirst(capabilityId: string, format: ArtifactFormat): boolean;

/** 第一阶段：要求每节都在、每节一段、不许写完整段落。 */
export function thinFirstRequirement(): string;

/** 第二阶段：把薄版当作已确认的骨架传回去，只允许加深、不允许改结构。 */
export function deepenRequirement(thinVersion: string): string;
```

```ts
// capabilities.ts — CapabilityTask 追加
/** undefined = 不走两阶段；"thin" = 薄版已产出待确认；"deep" = 已加深。 */
alignmentStage?: "thin" | "deep";
/** 薄版产物 id，加深时作为骨架输入。 */
thinArtifactId?: string;
```

```ts
// capabilities.ts — 新方法
/** 用户确认薄版后加深。骨架来自 thinArtifactId，不重新规划结构。 */
async deepenTask(taskId: string, opts: RunOptions): Promise<CapabilityNotification>;
```

### 调用栈

```
runTask(id)
  ├─ usesThinFirst(ability.id, task.format) === false → 现有路径，一次产出
  └─ true →
       buildRunPrompt + thinFirstRequirement()
       finishTaskRun → 产物 metadata.alignmentStage = "thin"
       task.alignmentStage = "thin"; task.thinArtifactId = artifact.id
       （停在这里，不自动继续）

POST /api/capabilities/task/deepen
  └─ agentUserActions.execute → capabilities.deepenTask(taskId)
       ├─ 读 thinArtifactId 的正文作为骨架
       ├─ buildRunPrompt + deepenRequirement(骨架)
       └─ finishTaskRun → 新产物 metadata.lineage.previousArtifactId = 薄版 id
```

### 测试会断言什么

`tests/unit/deliverable-alignment.test.ts`
- `usesThinFirst` 对长格式能力为真、对 `decision-brief`/`quick-*` 为假；未知能力 id 为假（默认不改变现有行为）。
- `deepenRequirement` 的提示里必须含"不改变结构"字样——否则加深阶段会重写大纲，两阶段就白做了。

`tests/unit/capabilities-thin-first.test.ts`
- 适用能力：一次 `runTask` 后**停在薄版**，`alignmentStage === "thin"`，且**没有**第二次 notify 调用。
- 未确认时调 `deepenTask` 之外的路径不会自动加深。
- `deepenTask` 产出的新产物 `lineage.previousArtifactId` 指向薄版，薄版**不被删除**（用户要能对照）。
- 不适用能力：路径与改动前完全一致（一次 notify、无 `alignmentStage`）。
- 薄版产出后重启：`alignmentStage` 与 `thinArtifactId` 仍在磁盘上。

---

## 第 3 项：四道门 Bot（`feature-alignment`）

一个市场模板，产出四份对齐文档。受众是"用 AI 写软件的人"。

### 文件与改动点

| 文件 | 改动 |
| --- | --- |
| `bot-market.ts` | 新增一个 `BotMarketTemplate`，`permissions` 与现有 8 个一致（`tools: "off"`、`memory: "task-only"`、`automaticRoutines: false`） |
| — | 不需要新能力、不需要配方、不需要界面改动 |

### 形状

```ts
{
  ...common,
  id: "feature-alignment",
  name: "功能对齐助理",
  category: "工作推进",
  description: "把一个想做的功能拆成四层对齐文档：要解决什么、结构怎么搭、"
    + "代码怎么放、先做哪个能跑通的薄片；每层停下等你确认，不写实现代码。",
  input: "想做的功能、现有系统的相关部分、约束",
  output: "四份对齐文档草稿与每层的待确认问题",
  requiredFields: ["用户问题与成功度量", "结构与数据", "文件与签名", "切片顺序"],
  // instructions 里必须写明：不产出实现代码；每层只输出该层内容；
  // 第一层禁止出现技术细节；每层末尾列出最没把握的判断。
  notIncluded: ["不读你的代码库、不联网", "不产出实现代码", "不自动创建任务或提醒"],
  source: { /* 独立撰写，adaptation: "independent-native"；来源填本仓库的方法文档 */ },
}
```

### 测试会断言什么

现有 `tests/unit/bot-market.test.ts` 的全量循环自动覆盖（权限、边界声明、指令长度、示例合成性）。追加：
- 模板数量断言从 8 改 9（现有测试硬编码了 8）。
- `instructions` 含"不产出实现代码"，且不含任何具体编程语言或框架名——它是流程模板，不是某语言的脚手架。

---

## 我最没把握的几个决定

1. **第 1 项的输出位置**。让模型在正文末尾附结构块，是"多一条指令 + 一次解析"；另一种做法是让它单独再跑一次只问这个问题——那更干净但多一次模型调用。我选了前者，理由是成本，但如果解析失败率高，前者会静默退化成"什么都没有"（返回 `[]` 不抛）。**没有把握的是失败率**，需要真实模型试过才知道。

2. **第 2 项的适用判据**。`usesThinFirst(capabilityId, format)` 用白名单还是黑名单？白名单安全（默认不变）但要逐个能力加；黑名单覆盖广但会误伤短交付物，而两阶段用在短交付物上是净损失。我倾向白名单，但这意味着大部分能力一开始不受益。

3. **第 2 项是否该复用 `buildContinuationPrompt`**。它已存在且形状接近，但语义是"按长度续写"而不是"按骨架加深"。混用会让一个函数有两种意图；分开则有重复。我倾向分开，不确定是否过度。

4. **第 3 项到底该不该做**。它在现有约束内完全可实现、成本几乎为零，但受众比现有 8 个模板里最窄的还窄。如果你只是自己用，做；如果考虑一般用户，我建议先不做——理由是市场目录的价值在于"每一条都有人用"，掺进一条没人用的会稀释它。

5. ~~能力执行提示纳入指令预算之后会不会当场越线~~ —— **已测，答案是"这条不该做"**。

   实测 `buildRunPrompt`：research-brief 5 条、document-draft 8 条、decision-brief 8 条、
   presentation-builder 4 条、html-report 9 条。数字明显偏低——`executionRequirements` 本身
   就有 10 条编号要求。原因是守卫只认「不要／必须／Never／must」这类标记词，而这份提示以
   英文裸动词祈使句为主（"End the deliverable…"、"Prefer structured sources…"），全被漏掉。

   试了两种补法都更糟：把编号行全算成指令 → 16 条，但把提示里的**数据清单**（可用工具、
   已有任务、能力目录）算成了指令；取并集 → 19 条，两种误差都保留。

   结论：**能力执行提示不该纳入这个守卫**。它的条数随本机运行时状态浮动（工具清单、任务
   列表），做成守卫会变成随机失败；要控制得先把数据块与指令块在装配时分开。第 1 项因此
   不受"先削减再加"的约束，可以直接加那一条要求。

   连带修掉了守卫本身两处问题：上限从 85 改成 40（按实测 20–25 加余量——套用别人的 85
   会让这个守卫永远不触发，等于没有），并在文件头写明这个数是**相对量、只能比较同一份
   提示随时间的变化**，不是绝对指令数。


---

## 实现补记（2026-09-08）

### 决定

- 第 1 项：**做了**，且按批复改成"交付物产出后单独跑一次"，不是在主回复末尾附结构块。
  因此不需要 `stripOpenQuestions`——正文从头到尾没被碰过。
- 第 2 项（薄完整版优先）：**暂不做**，取上面三条出路里的第 3 条，理由见下。
- 第 3 项（四道门 Bot）：**不做**。
- 「是否复用 `buildContinuationPrompt`」：**不复用**。它的语义是"按长度续写"而不是
  "按骨架加深"，混用会让一个函数承担两种意图。

### 第 1 项与设计的偏差

| 设计写的 | 实际做的 | 原因 |
| --- | --- | --- |
| `parseOpenQuestions` + `stripOpenQuestions` | 只有 `parseOpenQuestions` | 改成单独跑一次后，追问的回复不进交付物，无需从正文摘除 |
| 跳过名单含 `quick-translate` / `quick-polish` / `quick-speech` | 改为 `article-polish` / `document-conversion` / `ocr-extraction` / `image-prompt-reconstruction` | 那三个 `quick-*` **不是 `CapabilityRuntime` 的能力**（只在工作流目录里），写进去是永远命中不到的死规则。已加守卫测试逐个核对名单里的 id 真实存在——与失败注册表的 `seededFrom` 同一类约束 |

追问调用刻意收紧：`toolMode: "off"`、`memoryMode: "off"`、单轮、输出 2000 字符上限。
整段包在 try/catch 里——拿不到待确认判断只该少一段附注，不该让已完成的交付物失败。

改动两个既有测试的断言：`capabilities-due` 的调用计数 1→2、`capability-center` 的表面序列多一个
`task`。两者的测试意图（到期发现是只读的、表面传对了）没变，变的是每次运行多一次模型调用。

### 第 2 项为什么卡住

白名单去掉原生 JSON 契约能力之后，只剩两个可用对象。

7 个长交付能力是原生契约（`research-brief`、`presentation-builder`、`thinking-workbench`、
`product-design`、`business-deal`、`market-opportunity`、`ability-builder`）——它们的回复要过
`parseNativeCapabilityPayload`，一个"每节一段"的薄版会直接破坏契约。剩下的长交付物只有
`document-draft` 和 `html-report`。

而机制成本是：两个持久化任务字段、一个新公开方法、一个新审计端点、界面入口、一组测试。
**为两个能力付这些，性价比不成立。** 三条出路：

1. 就为这两个能力做；
2. 扩到原生能力——让薄版产出**满足契约的稀疏 payload**（各字段都在、每个一句）。技术上可行，
   但要逐个能力知道 payload 形状，工作量和风险都高一档；
3. 先不做，等到某个长交付能力真的出现"写完才发现方向错了"的实际抱怨再动。

**已定：取第 3 条，暂不做。** 第 1 项已经缓解了同一个问题的一部分——待确认判断让用户知道
该复核哪几处，不必读完全文才发现分歧。真正需要薄版的场景是"结构本身就错了"，而这在
`document-draft` / `html-report` 上不算高频。

重启这一项的触发条件（写下来，避免以后凭印象重开）：某个长交付能力出现实际抱怨"写完才发现
方向错了"，或者原生契约能力被改成允许稀疏 payload（那时出路 2 的成本会降一档）。

### 仍然开着的一个成本问题

第 1 项让**每次能力执行多一次模型调用**。跳过名单挡掉了 4 个纯转换类能力，但研究、文档、
演示、决策这些都会多花一次。如果这个成本需要压，最直接的办法是把追问也改成白名单（只对
长交付物追问）——机制已经在那里，只是把 `skipsOpenQuestions` 反过来写。尚未决定。
