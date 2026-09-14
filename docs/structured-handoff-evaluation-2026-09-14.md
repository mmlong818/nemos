# 结构化汇合离线评测协议（第二期）

日期：2026-09-14

## 本期交付

本期提供一个可重复的离线评测基座，用固定合成材料、固定 gold claims 和固定输出检查结构化交接机制。它不调用真实模型，不读取或修改用户数据，不接入生产服务，也不声称复现 EvoX 或证明任何模型质量提升。

评测复用第一期的 `StepReceiptV1`、`StepResultV1`、claims、evidence refs、unresolved 与 `mergeStepReceipts`；没有另建一套事实或证据模型。fixture 覆盖：

- 相同 claim key 的不同 canonical value；
- worker 输出缺失；
- 伪造 `artifact:` 来源；
- 统一传输字符预算导致的显式截断；
- 正常材料来源保留。

## 四臂及可比性

四臂都使用同一显式配置：`transportChars`、`maxModelCalls` 和 `maxTotalTokens`。这些字段是预算上限，不是实际消耗。

- A：synthetic single-agent context simulation。只接收原始材料，不接收 worker outputs。fixture 中的输出是 synthetic oracle，用于检查评分器和报告格式，不是单 Agent 模型实测。
- B：固定 worker 原始输出的自由摘要传输模拟。
- C：相同 worker 原始输出加结构化中心投影的传输模拟。
- D：相同 worker 原始输出加程序确定性 merge 的传输模拟。

A 与 B/C/D 输入不同，因此报告将 A 的 `comparableTo` 设为空，并给出 `incomparableReason`。它不能与 B/C/D 做因果优劣结论。B/C/D 才组成 transmission ablation：三者共享完全相同的 worker corpus hash 和传输上限，只改变交接表示。

B/C 的候选输出来自 fixture 的确定性 synthetic oracle；D 的候选 claims/evidence/unresolved 直接来自程序 merge。它们只验证评测管线可重复、风险指标能被计算，不能代表真实模型在四种条件下的行为。

## 分项评分

报告不生成一个掩盖风险的总 accuracy，也不宣布 winner。每个 case/arm 分别输出：

- claim precision：候选 claims 中与 gold `key + canonicalValue` 一致的比例；
- claim recall：gold claims 被候选覆盖的比例；
- evidence retention：预期 runtime-observed refs 的保留比例；
- unresolved honesty：预期缺失、伪造或截断代码被显式呈现的比例；
- conflict surfacing：预期冲突 key 被呈现的比例；
- forged evidence rejection：仅当该 fixture 要求拒绝伪造 evidence，且该 arm 实际接收含伪造来源的固定 worker corpus 时计分；
- output determinism：相同 fixture/config 重跑的 context 与候选结构 hash 是否一致。

当某项没有适用 gold 分母时 `total` 为 `0`、`rate` 为 `null`，Markdown 显示 `n/a`，而不是伪造满分。尤其 A 不接收 worker outputs，因此即使对应 fixture 的 B/C/D 含伪造来源，A 的 forged evidence rejection 仍不适用；不含伪造来源的 case 对所有 arm 都不适用。适用性由实际固定 worker corpus 中的伪造 `artifact:` 引用计算，并要求与 fixture 的 gold 预期双向一致，不能只靠 gold 开关制造或隐藏分母。来源保留是结构 provenance 指标，不代表 claim 事实正确。

## 预算与测量边界

所有 arm 的报告都包含相同预算配置，但运行字段固定为：

```json
{
  "status": "not-measured",
  "modelCalls": null,
  "inputTokens": null,
  "outputTokens": null,
  "cost": null
}
```

离线 harness 不估算 token、延迟或金额，也不会把预算上限写成实际消耗。报告顶层固定 `benchmarkClaim: "none"`，Markdown 同样声明只是 synthetic protocol check。

## 本地运行

CLI 不设置默认输出目录，必须由操作者显式给出一个尚不存在的绝对目录：

```powershell
cd sdk\typescript
npm run evaluation:structured-handoff -- --out-dir C:\绝对路径\一次性输出目录
```

CLI 拒绝相对路径、Windows UNC/device 路径、仓库根目录及工作树内的子目录、已经存在的文件或目录，以及任一现存祖先是符号链接、junction/reparse 跳转的目标。父目录必须已经存在；CLI 以排他创建方式新建目标目录和两个报告文件，当前没有 `--force`，因此不会覆盖既有结果。它只在该仓库外的新目录生成：

- `structured-handoff-evaluation.json`：machine-readable v1 报告；
- `structured-handoff-evaluation.md`：相同结果的人读表格和限制。

仓库不提交某次生成报告，避免把 synthetic 结果误认成已运行 benchmark。自动测试使用系统临时目录并在结束时清理。

## 何时需要新的用户授权

若未来要比较真实模型，必须先得到用户对以下事项的明确授权：

1. 选定同一个模型、版本、temperature/reasoning 设置和服务商连接；
2. 确认四臂的调用次数、token 上限、预计费用和停止条件；
3. 确认真实 A 基线的输入定义，以及它与 B/C/D 不同输入所造成的不可比性；
4. 对 B/C/D 使用相同固定 worker 输出、相同顺序和相同传输预算；
5. 明确允许向该模型发送的评测材料，且不得混入私人记忆或用户生产数据；
6. 预注册评分规则、盲评方式、重复次数和失败样本处理。

获得这些授权前，只能运行本期无模型、无费用的 synthetic harness。即使未来完成真实实验，也应分别报告各风险指标、置信区间与失败样本，不能用单一总分或未经控制的 A/B/C/D 排名宣传效果。
