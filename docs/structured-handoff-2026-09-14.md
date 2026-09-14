# 结构化步骤交接（第一期）

日期：2026-09-14

## 目标与范围

这一期只改进已有助理团队/多步骤执行：把每一步实际返回的原始成果作为不可变历史保存，再由程序按执行计划确定性归集。它不增加 Bot 数量，不新增蜂群、自主循环、消息渠道、长期记忆或外部操作权限。

## 合同

`StepResultV1` / `StepReceiptV1` 是版本为 `1` 的显式合同。每条回执包含：

- 稳定的 task、plan、step、attempt、result 和 receipt identity；
- `succeeded` / `failed` 状态、原始输出（有界 24,000 字符）、摘要和时间；
- 结构化 claim：稳定 `key`、原值、canonical value、`sourceRefs` 与 `evidenceState`；
- 运行时实际观察到的 evidence refs、未决项、input/output SHA-256；
- Bot id/revision、规则哈希、模型标签和固定 `tools: off` 元数据；
- 上游 result identity (`derivedFrom`)。

模型只能引用运行时给出的材料或上游步骤 ref。新 final 只接受精确 runtime ref、确实存在的 `material:<label>` 的短别名，或明确 `unknown` / `材料未提供`；`S99`、自由文本假标签以及伪造的 `artifact:`、`tool:`、`step-result:`、`material:` ref 都会使本次交付失败。旧最终交付中的自由文本来源标签只继续兼容显示，不会被升级为结构化事实证据。一个来源被观察到只说明“来源存在/被引用”，`factVerified` 始终为 `false`；没有可接受 ref 的 claim 明确标记为 `unknown` 并加入未决项。

## 持久化与恢复

步骤回执写入独立的 `assistant-team-step-receipts.json` append-only store。相同 `receiptId` 的相同内容可幂等重复追加；相同 identity 的不同内容会报错。写文件使用同目录临时文件和 rename，失败时内存回滚，任务不会把持久化失败静默当成成功。

重试为同一 plan/step 分配递增 attempt，旧成功或失败回执不覆盖。独立 store 不受旧 job checkpoint 100 条裁剪限制；checkpoint 只保留兼容/UI 投影，并且只能在健康 store 上经同一完整语义校验 bootstrap，不能成为另一份可写真源。worker 在规划或模型调用之前检查权威 store；语法或语义损坏会把 store 转为只读并明确阻断任务，checkpoint 不能绕过，也不会覆盖损坏文件。旧任务没有结构化 store 时仍可读取和恢复原 `TeamReceipt`，并在真正复用该回执时生成一次结构化兼容投影，不触发额外模型调用，也不迁移用户数据。

## 确定性汇合

`mergeStepReceipts` 完全由程序执行：

1. 严格按已验证 execution plan 中的步骤顺序遍历；
2. 每步选择最新的成功 attempt，同时保留全部历史回执供审阅；
3. 只在相同 claim key 出现不同 canonical value 时报告冲突；
4. 缺失、仅失败、claim 自带未决项或冲突均进入 `unresolvedItems`，不会被静默合并；
5. 不删除、覆盖或重写步骤原始输出。

reviewer/final 接收的是确定性 merge 的结构化有界投影：每步 identity/hash、有限摘要、claims、未决项和有限原文摘录。序列化沿用 prompt 安全 JSON，使用显式不可信数据定界。投影超过字符预算时逐级缩减，最终只保留结果索引，并显式加入“因运行时字符限制截断”的未决项；完整原始结果仍在独立回执 store 中。

最终交付继续由模型撰写，但程序返回的 `structuredMerge` 将最终步骤及其 `derivedFrom` 链到原始步骤 evidence。UI 同时展示最终叙述、每次步骤尝试、原始成果、claims/evidence/unresolved 和程序汇合状态，明确写出“结构核验不代表事实正确”。

## 安全边界与限制

- 运行仍为单一已有授权计划，默认工具关闭；没有新增 shell、网络、文件工具或外部写入能力。
- task-only 共享与 memoryScopes 空数组保持不变，不扩大私人记忆。
- 来源 ref 是 provenance，不是事实正确性判定；事实仍需人工或专门模型审阅。
- 旧自由文本输出可恢复，但无法可靠反推 claims，会标记“structured claims 未返回、事实状态 unknown”。
- 当前 store 为单进程文件存储，不是通用跨进程事件/结果平台；并发多进程写同一文件不在本期保证范围。
- 原始输出仍受既有 24,000 字符上限；超过上限的模型返回会失败并保存有界失败信息，不声称保存了被运行时拒绝的无限全文。

## 验证与未来公平评测

本期验证覆盖合同、hash、稳定顺序、相同 worker 原始结果的确定性汇合、冲突、无证据、失败后重试历史、伪造 artifact ref 拒绝、旧 checkpoint 恢复、进程重启后历史仍在，以及隔离 mock UI 展示。测试不调用付费模型，也不写外部系统。

未来可以在同一任务集、同一模型/温度、相同输入与调用预算下做四臂盲评：

- A：单助理直接回答；
- B：多步骤自由文本汇总；
- C：结构化中心上下文，由模型自由汇总；
- D：本期这种程序确定性 merge 后再交给 final/reviewer。

建议预注册结构完整率、来源可追溯率、冲突召回率、事实正确率、延迟、token/调用量和人工偏好，并分别报告失败/无证据样本。目前没有运行这项基准，也不据此宣称质量、速度或成本提升。
