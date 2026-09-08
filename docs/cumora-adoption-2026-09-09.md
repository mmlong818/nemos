# Cumora 参考设计的个人应用采用记录（2026-09-09）

参考：[Cumora](https://github.com/yetone/cumora) 的已核验提交
[`74dc994`](https://github.com/yetone/cumora/tree/74dc994989536408f37e9c1df0e28c86cf2f974c)，特别是其
`server/src/agents/turn.ts` 的显式回合状态和调用观测、`observability.ts` 的逐调用账目，以及 BYOA 文档中关于合并唤醒与中途转向的边界。本轮只借鉴“完成要有语义、每次真实模型调用可追溯、追加输入不应静默覆盖工作”的问题拆分。

实现完全基于小丑鱼既有 TypeScript、本机文件存储、任务队列和单入口交付模型；没有复制 Cumora 源码、Redis/Kubernetes/多人聊天基础设施或其 UI。

## 本轮采用的三项机制

1. **显式完成语义**：只在 `context.mode === "task"`、工具未关闭且本轮实际挂载了工具的 Agent 运行中启用 `AgentTurnDisposition`；受控工具关闭的团队文字阶段保留既有有界文本交付协议。启用时模型的无工具文本不再自动等同于完成；`completed` 需要本轮已有可见文本或可信 artifact 证据，单独的写入 receipt 不足以宣称交付。`blocked`、`waiting_input` 与取消会保留为明确状态，不伪装成交付完成；它们也不保证原任务会自动续跑。现有 `uncertain` 和人工对账语义不变。
2. **目的级 LLM 调用账本**：每次已经通过模型调度、即将执行文本模型 HTTP 调用的 adapter 调用独立记录。目的包括 `task_turn`、`team_plan`、`team_worker`、`team_review`、`team_final`、`memory_extract` 与保守的 `other`。团队阶段由产品代码显式传递 purpose，而非从提示词猜测；`team/<job-id>/…` 才关联真实任务 ID，其他调用不虚构关联。账本有界、原子落盘，应用重启遗留的 `in_progress` 诚实转换为 `interrupted`。
3. **运行中追加消息的受控转向**：只适用于工具关闭的团队文字任务，并且只在阶段边界读取持久的 steering 消息。`merge` 为下一阶段补充信息；`redirect` 替换后续目标并使旧目标回执不可作为新目标完成证据。界面与回执保存 revision 和处理状态，避免把用户补充静默丢失。

## 账本与展示边界

账本仅保存调用 ID、已有 run/task 关联、purpose、provider、model、开始/结束时间、延迟、状态、服务商实际返回的 token usage 和简化错误类别。它不保存 API key、完整 endpoint URL、原始提示、模型输出或原始错误文本。

服务端提供只读 `/api/llm-calls` 查询；任务详情只显示调用数量、已知 token、usage unknown 数和重启中断数。没有价格表或金额推算：服务商未返回 usage 时字段为 `unknown`，绝不以 `0` 替代，也不以 token 推算美元。账本写入失败被隔离，不能让可选观测导致模型调用重试、丢失结果或改变副作用。

当前只有受控团队任务带有可验证的 `team/<job-id>/…` 调用关联，因此只有这类任务详情显示账本汇总；普通队列任务不从 job ID 猜测模型调用归属，也不显示容易误解为“零次调用”的汇总。

## 当前明确不做的事

- 不把 Cumora 的多 Agent 群聊、共享看板、seen-version/HOLD、通用资源认领、无任务 idle 心跳或云端基础设施带入个人助理；最终责任人仍是小丑鱼。
- steering 不会在工具启用的调用中途注入，也不会在当前 HTTP 请求或工具执行中强行打断/自动重放。它不授权新工具、不扩大记忆 scope，也不把追加消息变成新的外部动作。收件箱累计 500 条后会返回 409，保留所有已接收消息；用户需要在有容量时主动重试。运行中 redirect 可能使当前旧阶段以失败结束，需用户主动重试，可能产生新的模型调用费用，系统不会自动恢复或重放。
- 团队最终字段仅做结构、来源字段和既有产物/工具证据检查，**不是事实真实性验证**；用户仍须审阅结论与外部世界的实际状态。
- `interrupted` 只表示进程重启时本机无法得知一个已发出的调用是否结束；系统不会自动恢复、补记 usage、重放调用或把它记成 provider 失败。取消在调度等待阶段不会产生调用条目；已开始的 HTTP 请求收到 abort 才记为 `cancelled`。

## 验收证据与限制

本轮的专项测试覆盖账本的实测 usage、unknown usage、失败、取消/重启中断、有界裁剪和真实已准入 HTTP 调用；也覆盖显式完成的 token 边界、已发起写操作取消后进入 `uncertain`、团队阶段边界的 merge/redirect、重启回执复用和最终核验后拒绝追加。综合验收执行 `npm run check`：839 项测试中 838 项通过、0 项失败、1 项跳过（需要本机 Blender 的三维环境检查）；build、typecheck、许可证与发布元数据检查均通过。根目录文档校验也通过。

隔离测试没有运行真实付费 provider，也没有向用户数据目录写入测试数据。验收后，本机源码服务已成功激活：`/api/health` 返回 `{ ok: true }`，只读 `llm-calls` 查询成功；启动时没有活动任务或待审批项，且没有改动模型或应用配置。离线模式没有 HTTP provider 调用，因此不产生伪造的 LLM 调用账目；视觉、语音和搜索等非文本模型/外部服务不被本版文本调用账本宣称覆盖。
