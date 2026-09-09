# 程序设计：自媒体两项能力（原生实现）提案，待确认

状态：**提案。尚未实现，尚未批准。** 只到文件位置、类型与签名、调用栈、测试断言；不含实现体。

背景：原方案是接 [Easel 连接器](../../docs/easel-studio-program-design-2026-09-08.md)。你决定不验证 Easel，
只要"在我这边有对应的能力"。因此改为**在小丑鱼里原生实现**——用你已配置的模型，走现有的
能力／任务／产物／审批链路。

**这样做省掉的东西**：Python 3.10+ 与 `openclaw`、数 GB 依赖、OpenAI 兼容回环垫片、
`spawn` Python 的沙箱问题、产物跨进程导入。Easel 设计里"最没把握的三条"全部消失，因为
它们都是关于那三个进程的。

---

## 一、做哪两项，以及为什么不是四项

Easel 白名单原本四个：`skill-topic-evaluator`、`video-script`、`skill-hook-generator`、
`skill-article-outline`。原生实现时前两个建成能力，后两个不建：

| Easel skill | 小丑鱼怎么办 | 理由 |
| --- | --- | --- |
| `skill-topic-evaluator` | 新能力 **选题评估** | 没有对应能力 |
| `video-script` | 新能力 **短视频脚本** | 没有对应能力 |
| `skill-hook-generator` | **不单列**，作为脚本能力里的必需小节（3 个开头备选） | 一段钩子是几十个字。按已定的工具策略，"短答复、判断、复述不是产物"——为它造一个文件和一次任务不合适 |
| `skill-article-outline` | **不单列**，用现有 `document-draft` | 文章大纲与"写正式文档"重合度过高，再加一个会让能力页出现两个看起来一样的入口 |

### 关于"选题发现"

你最初的范围是"选题发现、脚本"。**发现这一段不新建能力**：小丑鱼已经有 `research-brief`
（深度研究，会联网搜索并给来源分级）和 `market-opportunity`（市场机会）。选题评估的输入
就是它们的产出，或你自己给的一串候选。

这与[已定的决定](../../docs/easel-studio-program-design-2026-09-08.md)一致——不引入抓取平台实时热搜的
链路，因为抓取失效时会安静地给出空榜或过时榜，用户看不出区别。

**落差要说清**：你不会得到"今天有什么热点"这种一键结果。你会得到"这 8 个候选里哪 3 个值得做、
为什么、各自的风险"。要前者就得接抓取，那是另一个决定。

---

## 二、文件与改动点

| 文件 | 改动 |
| --- | --- |
| `capabilities.ts` | `BUILTIN_ABILITIES` 追加 2 条 |
| `media-capability-prompts.ts`（新） | 两条提示词单独成文件 |
| `web/assets/workflow-catalog.js` | `CATALOG` 追加 2 条 + `identities` 追加 2 条（新类别「自媒体」） |
| `docs/clownfish-capability-map.md` | 追加 2 行，计数 15 → 17 |
| `examples/companion/README.md` | 计数 15 → 17 |
| `tests/unit/workflow-bots.test.ts` | 计数 11 流程 Bot → 13（工具仍 4）；测试名同步 |
| **不动** | 执行器、审批、产物模型、界面代码、`skipsOpenQuestions` |

提示词单独成文件的理由：`capabilities.ts` 已经接近 3000 行，而这两条提示要写得比一句话长
（见第五节的必需小节）。既有的 `imagePromptCapabilityPrompt()` 就是同一处理。

**为什么不做成 bot-market 模板**：模板是人格 + 材料表单，靠 `instructions` 约束行为，产出仍
要落到某个能力上。你要的是能力本身，先把能力建出来；之后要不要再加一个「自媒体助理」模板
把两者串起来，是独立的一步（见第六节）。

---

## 三、类型与签名（无实现体）

能力本身不需要新类型——`Capability` 已有的字段够用：

```ts
// capabilities.ts，追加进 BUILTIN_ABILITIES
{
  id: "topic-evaluation",
  name: "选题评估",
  description: "把一批候选选题排出优先级，逐条说明理由、受众、风险和不做的原因。",
  kind: "builtin",
  defaultFormat: "md",
  prompt: topicEvaluationPrompt(),
  createdAt: BUILTIN_CREATED_AT,
}
{
  id: "video-script",
  name: "短视频脚本",
  description: "把一个选题写成可直接开拍的脚本：开头备选、分段口播、画面提示和结尾动作。",
  kind: "builtin",
  defaultFormat: "md",
  prompt: videoScriptPrompt(),
  createdAt: BUILTIN_CREATED_AT,
}
```

```ts
// media-capability-prompts.ts（新）
/** 选题评估的提示。要求逐条给理由与不做的原因，并禁止声称掌握实时热度。 */
export function topicEvaluationPrompt(): string;

/** 短视频脚本的提示。四项参数缺失时不猜，写进待确认。 */
export function videoScriptPrompt(): string;

/** 两条提示共用的参数清单——平台、时长、受众、目标。 */
export const MEDIA_REQUIRED_PARAMETERS: readonly string[];
```

两项都是 `defaultFormat: "md"`：口播稿和选题清单都要能直接复制进提词器或备忘录，
HTML 反而多一层。

---

## 四、参数怎么传（这一段是设计的核心难点）

能力的执行入口只有**目标 + 材料 + 格式**三样，没有结构化参数位——`inputTemplate` /
`requiredFields` 是 bot-market 模板的机制，不是能力的。而脚本至少需要四项：
**平台、时长、受众、目标**。

不新增参数位。做法是：

1. 提示里列出这四项为必需；
2. **缺失时不猜**，按平台中位数假设一个并**写进产物的待确认小节**；
3. 这一步不用自己实现——本轮已有的[交付物待确认判断](../../docs/deliverable-alignment-program-design-2026-09-08.md)
   会在交付物产出后单独追问一次，把"我假设是抖音 60 秒"这类判断收进产物元数据，
   能力页显示「N 处待你确认」。

所以这两个能力**不进** `skipsOpenQuestions` 名单（那是给润色、格式转换、OCR 用的）。
这是复用而不是新建机制，也是这两项能力选在本轮做的原因之一。

---

## 五、提示词里的硬性要求

**选题评估**必须输出：

- 每条候选的：判断（做／不做／改造后做）、理由、目标受众、预计难点、放弃的原因；
- 排序依据要写出来，不能只给一个序号；
- **禁止声称掌握实时热度或平台数据**。材料里没有数据支撑时，说的是"这类题材通常"，
  而不是"当前热度高"。这条与小丑鱼在事实层的既有立场一致，也是不接抓取的直接后果。

**短视频脚本**必须输出：

- 开头 **3 个备选**（这是 hook-generator 的替代，不单列成能力）；
- 分段：时间轴、口播原文、画面提示；
- 结尾动作（关注／评论／跳转，只列一个）；
- 参数假设小节：平台、时长、受众、目标各自用了什么值，哪些是我假设的。

---

## 六、调用栈

```
用户在能力页选「短视频脚本」，填目标与材料
  └─ POST /api/agent/job  { kind: "capability-adhoc", capabilityId: "video-script" }
       └─ CapabilityRuntime.runTask / runTaskStream
            ├─ 用 ability.prompt + 材料调模型（现有路径，无改动）
            ├─ 写产物（md，现有路径）
            └─ collectOpenQuestions()：把"我假设平台是抖音"收进 artifact.metadata.openQuestions
                 （toolMode/memoryMode 都 off、1 轮、2000 字上限，失败只少一段附注）
       └─ 能力页显示「N 处待你确认」
```

零新增端点、零新增执行路径。

---

## 七、测试会断言什么

`tests/unit/media-capabilities.test.ts`（新）

- 两个 id 都出现在 `listAbilities()` 里，且 `kind === "builtin"`；
- `workflow-catalog.js` 里两条新目录项的 `backendId` **都能在 `listAbilities()` 里找到**
  ——目录写一个不存在的 backendId 会变成点了没反应的入口，与 `skipsOpenQuestions`
  写不存在的 id 是同一类错误；
- `skipsOpenQuestions("topic-evaluation") === false`、`("video-script") === false`
  ——它们恰恰是最需要交出假设的两个；
- 选题评估的提示里含"禁止声称实时热度"这条约束（用关键词断言），
  且**不含**任何抓取、热搜、榜单类词汇；
- 脚本提示要求 3 个开头备选与四项参数假设小节；
- `MEDIA_REQUIRED_PARAMETERS` 恰为平台／时长／受众／目标四项，且两条提示都引用了它
  ——避免清单改了而提示没跟着改。

`tests/unit/workflow-bots.test.ts`（改）

- 流程 Bot 11 → 13，工具仍 4，总数 15 → 17；
- 既有的"每个流程 Bot 提交仍使用原执行器、材料、交付格式与关闭记忆选项"是按 catalog
  循环生成的，两个新 Bot 会**自动**被覆盖，不需要新写。

`scripts/verify-docs.mjs`（无需改）

- 它从 `workflow-catalog.js` 数 `backendId:`，会自动变成 17，然后要求能力地图与
  应用 README 写的也是 17。这两处文档我会一并改；忘了改会直接报错。

---

## 八、我最没把握的几个决定

1. **"不给选题发现"你能不能接受。** 第一节写清了落差：你得到的是"这些候选里哪个值得做"，
   不是"今天有什么热点"。我认为这是对的取舍，但这是产品判断，不是技术判断。

2. **钩子和大纲不单列。** 理由是重合与"短答复不是产物"，但如果你实际用起来是"我只想快速
   换 5 个开头"，那单列一个轻量工具（像 `quick-polish` 那样进 `tools` 而不是流程 Bot）会
   更顺手。这一条用起来才知道，现在建议先不单列。

3. **两项都用 `md` 而不是 `html`。** 脚本我有把握（要复制进提词器）；选题评估如果你想要
   可排序、可勾选的表格，`html` 更好——像 `market-opportunity` 那样。倾向 `md`，但不确定。

4. **新增「自媒体」类别只有两个成员。** 现有类别（写作表达／决策验证／工作推进／日程沟通）
   都有两个以上。两个成员单开一类会让能力页多一行分组标题，可能不如挂进「写作表达」。
   我倾向单开——自媒体和写正式文档是两种活儿——但这是界面判断，你看着更准。

5. **参数走提示 + 待确认，而不是新增表单位。** 好处是零机制改动、复用已有的待确认链路；
   代价是每次都要在目标里手写"抖音、60 秒、面向新手"。如果你每次参数都一样，更该做的是
   让能力记住默认值——那需要新的存储，本轮不做。
