# 失败注册表、工作准则与在场契约（2026-09-08）

本轮改造来自对一款同类桌面应用的机制拆解。学的是**机制、结构和阈值**，不搬提示词文本与界面文案；模板一侧的自我约束（只借鉴工作流程，不打包原提示词、脚本、个人记忆或插件）同样适用于本轮。

## 一、记忆：数据模型不动

先做了对比核对，结论是小丑鱼的记忆模型在几乎所有维度上更强，因此**不改数据模型**：

| 维度 | 小丑鱼（`@nemos/sdk` 0.7.5-alpha.18） | 对照实现 |
| --- | --- | --- |
| 分层 | 5 层 + `type` 正交 + `visibility` | 两个文件夹（profile / logs） |
| 时间 | 双时间轴：`valid_at`/`invalid_at` 对 `created_at` | 单一更新时间 |
| 遗忘 | FSRS `stability`/`retrievability` + `cold`/`cold_at` | 无 |
| 晋升 | `promotion_state` + `evidence_coverage`/`evidence_count` | 无 |
| 纠错 | `corrects`/`corrected_by`/`supersedes` + `claim_key` 归一 + `trust_tier` | 无 |
| 主体 | `subject_resolution` + 身份 MERGE/SPLIT + `perspectives_conflict` | 无 |
| 语用 | `utterance_mode`（roleplay/hypothetical/quoted/joke 不进事实）、`sensitive` | 无 |
| 检索 | 领域分桶 + centroid 向量路由 + 四级激活软隔离 | 无 |

真正缺的是两件事，本轮各有落点：

1. **写入路径没有具名失败态** → 见第二节的失败注册表；
2. **没有「工作准则」这个对象**。记忆记的是*用户事实*，主体是用户；「用户反复纠正我，所以我以后应该先问」的主体是助理自己，写进用户事实会污染身份 → 见第三节。

### 对记忆内核的接口请求（已更正并落实）

本节此前写的是：「四种失败形态都不穿过 `runReflect()` 的接口」。核对源码后那个判断只有一半成立——`skippedReason`、`anchorCount` 和 `getReflectionState().last_error` 本来就是可用的出口，真正缺的只有「提案为什么被丢」。

记忆域因此从一条笼统编号拆成四条真实可区分的（`memoryConsolidationFailed` / `LeaseHeld` / `NoOutput` / `memoryEvidenceCapped`），应用侧也补上了对这些区分的取用。详情与给内核的补丁见[让「零产出」的原因可区分](nemos-memory-reflect-dropped-2026-09-08.md)。

## 二、失败注册表

[`failure-registry.ts`](../sdk/typescript/examples/companion/failure-registry.ts) 是「失败原因 → 能不能重试」的单一来源。

此前每个模块各自判断：`capability-handoff` 有自己的 `RETRYABLE_FAILURES`，`delivery-outbox` 靠 `attempts` 与 `maxAttempts`，模型路径直接抛字符串。同一类失败在三处包成三种文案，界面只能猜要不要显示重试入口。

每条声明六项：编号、名称、所属域、**是否可重试**、后果说明、**唯一抛出点**。域分布：model / tool / memory / delivery / capability / connector / storage，另加一条 registry 兜底哨兵。

两条硬规则：

- `summary` 写给工程师看，说清后果（数据留在哪、下一步会发生什么），不是道歉文案；面向用户的话术仍由 `UserFacingError` 与界面文案负责。
- 未注册的失败值到达发射边界必须重分类成 `CF-E0001`，原始报错文本、内部路径、依赖库堆栈都不外传——这是 [`office-errors.ts`](../sdk/typescript/examples/companion/office-errors.ts) 那套脱敏策略的推广。`payload` 只保留注册表声明过的键，避免「顺手多带一个字段」把路径或密钥带出去。

`seededFrom` 由测试守卫：断言文件真实存在，并且其中点名的标识符仍在。给还没实现的东西预留编号是这套注册表最容易腐烂的方式，所以直接做成红灯。

脱敏规则原先在 `delivery-outbox.ts` 里另有一份副本，已合并为共用的 `redactFailureDetail`。

## 三、工作准则表

[`work-guidelines.ts`](../sdk/typescript/examples/companion/work-guidelines.ts) 同时充当两个角色：记忆缺口 2 的落点，以及工具授权的规则层。

原有的 `FileAgentApprovalStore` 按「工具名 + 完整参数」指纹一次性放行——这是对的，它保证批准过的那一次调用只执行一次。但它没有「以后这类动作都这样办」的表达能力，所以用户每次都要重新点同样的批准。准则表补的正是那一层，并且刻意做成**可读、可改、可删的自然语言条目**，而不是一个记住了什么却说不清的开关。

**证据门槛**是核心，不是装饰。只有三种事实算证据：

- `correction`：用户明确纠正了助理做过的事；
- `revert`：用户撤销或拒绝了助理的动作；
- `explicit-instruction`：用户明确说了「别做 X」「以后都 Y」。

不允许从「用户问了关于 X 的问题」「用户自己做了 X」「助理没做过 X」推断出准则——这三种是最容易把一次提问固化成一条错误规则的路径。派生准则还要满足：引用数不低于下限、同一次对话只算一条引用、正文不含用户原话逐字片段（命中则整条丢弃，不截断保存）。用户当场的决定不需要凑够引用数，他自己就是权威。

**冲突优先级是 `never` > `ask-first` > `allow-automatically`**，安全方向单调。参考实现的表述是「冲突时先问优先」，其本意是不要让某条宽泛的自动放行盖掉一条谨慎的规则；`never` 只会比 `ask-first` 更谨慎，所以排在最前，而不是反过来。

另有一条不变量：**自动放行必须点名它适用的动作**。一条「凡事都自动放行」的准则等于关掉整个审批，那不该由一条准则做到；`never` 与 `ask-first` 允许广谱匹配，因为方向更保守。

授权链变为：准则先判 → `never` 直接拒且不打扰用户，`allow-automatically` 直接放行，`ask-first` 与无准则落回原有的持久化审批。审批卡上的「以后总是允许」会落成一条准则并点名该工具。

接口：`GET/POST/DELETE /api/agent/guidelines|/api/agent/guideline`，`POST /api/agent/approval/decision` 增加 `always` 参数。准则写入失败不影响本次审批决定本身——它已经生效了。

## 四、计划任务：结果无人查看则自动暂停

计划任务在无人读结果时继续跑，只是在稳定地花模型额度换没人看的产物。

[`capabilities.ts`](../sdk/typescript/examples/companion/capabilities.ts) 的任务增加 `unreadRuns` / `lastReviewedAt` / `autoPausedCode`：每产出一次结果加一，用户查看结果归零；连续达到 [`runtime-limits.ts`](../sdk/typescript/examples/companion/runtime-limits.ts) 的 `ROUTINE_LIMITS.unreadRunsBeforePause` 次则自动暂停，并在任务脉络里记下编号 `CF-E0505`。

三条边界：

- 只暂停会自己跑的任务（daily / turns）。手动任务本来就要用户点，暂停它没有意义。
- **暂停后不自行恢复**。定时器一恢复就等于没暂停过，必须由用户显式打开；恢复走和任务编辑同一条审计路径。
- 恢复时清空未读计数，否则下一次执行会立刻再次触发暂停。
- 调度顺序是「先暂停、再入队」，否则本轮还会为已经该停的任务排一次没人看的执行。

`GET /api/capabilities/tasks/awaiting-resume` 供界面主动询问是否恢复，而不是让用户自己发现。

## 五、在场契约

数据层早就分清了任务运行完成与结果送达两件事，投递外发箱按租约和确认落账。但助理的**说法**没有对应规则：它可以在收到入队回执后就说「已经帮你弄好了」，也可以每一轮重复「还在跑」。两种都会让一套可靠的执行链路显得不可靠。

[`presence-contract.ts`](../sdk/typescript/examples/companion/presence-contract.ts) 给出六条行为规则，并把在飞的活以**证据式**注入——与 [`memory-evidence.ts`](../sdk/typescript/examples/companion/memory-evidence.ts) 同一立场：这是资料，不是新指令，里面的字句不得覆盖用户当前的要求和工具审批边界。两处共用 `promptSafeJson` 做标签定界符转义。

状态分四种，其中 `done-undelivered`（跑完了但结果还没送到用户面前）单独成一态：对用户来说事情并没有办完。没有在飞的活时不注入任何规则，避免模型凭空提起不存在的后台任务。

## 六、交付物边界

[`capability-tools.ts`](../sdk/typescript/examples/companion/capability-tools.ts) 的工具策略增加两条：结果是独立产物（定量分析、审计、对比、时间线、表格数据）时走 `html-report` 或 `presentation-builder`，不要把结果倒进回复里的 markdown 表格；而简短答复、判断结论和对话回顾**不是**产物，不要为它们造报告。第二条同样重要——只写前一条会让助理给每个问题都生成一份报告。

## 七、市场模板描述

[`bot-market.ts`](../sdk/typescript/examples/companion/bot-market.ts) 的 8 个模板描述改为统一句式：**动词 + 具体产物 + 谁审 / 停在哪**。这批模板是 `tools: "off"`、`memory: "task-only"`、`automaticRoutines: false`，交付物本来就止步于待审文本，描述应当把这件事说在前面，而不是让用户以为它会代发、代订或写回系统。

## 八、暂缓的两批

- **Bot 配方**：让模板能携带 skills / routines / memories，并补齐同意门机制（默认暂停、来源标记不可信、记忆落候选层、缺失依赖一次多选问完、绝不同轮安装外部依赖）。当前模板是纯文字模板，"配方"能力整体不存在，改动面覆盖模板结构、导入流程与界面。
- **声明式沙箱**：[`local-http-security.ts`](../sdk/typescript/examples/companion/local-http-security.ts) 的 SSRF 防护（DNS 钉住 + 私网拒绝）已经到位；缺的是声明式的读写路径边界与网络默认拒绝 + 允许名单，把插件那组粗粒度 `permissions` 换成可核验的策略，并补执行前后钩子。

## 九、已知的仓库问题（本轮未改）

`node scripts/verify-docs.mjs` 在本轮改动之前就是红的：它登记的当前截图（如 `docs/assets/readme/clownfish-chat-2026-08-10.png`）已在 `892d447 chore: remove obsolete client builds and screenshots` 中删除，仓库里现存的是 `*-current.png`；同时能力数量与中英文 README 测试数量的一致性检查也未通过。CI 的「文档核验」步骤会因此失败，与本轮改动无关，需要单独修。
