# 对记忆内核的接口请求：让「零产出」的原因可区分

补丁：[`nemos-memory-reflect-dropped.patch`](nemos-memory-reflect-dropped.patch)
目标仓库：<https://github.com/mmlong818/nemos-memory>
基线提交：`1e56566ec4bf537c95ee48804d8f60c9166f3d6a`（与 [`memory-core.version.json`](../sdk/typescript/memory-core.version.json) 锁定的一致，可直接 `git apply`）

## 一、先更正一个此前的判断

上一轮记录的说法是：「离线整合内部把失败分成提案无效／复核未通过／状态漂移重排队／证据超容量丢弃四种，这些区分都不穿过 `runReflect()` 的接口」。

核对编译产物与源码后，这个判断**只有一半成立**：

| 原先声称拿不到 | 实际情况 |
| --- | --- |
| 状态漂移需重排队 | **本来就有出口**：`ReflectResult.skippedReason === "lease-held"`，是唯一枚举值 |
| 证据超容量丢弃 | **有间接出口**：`anchorCount` 是裁剪**前**的全量条数，与内核的 `DEFAULT_ANCHOR_CAP`（50）比较即可判断本轮被裁过；但丢弃条数拿不到，且该常量当时未导出 |
| 提案无效 | 确实没有出口：`buildReflectDerived` 三处静默 `return null`，其中 JSON 解析失败连日志都没有 |
| 复核未通过 | 名字本身就不准：reflect 里**没有独立的 LLM 复核环节**，所谓复核只是守门过滤（`invalidates` 必须来自 anchor、psem 三重守门），同样静默 |

另外还漏掉了一个真实出口：`Nemos.raw().storage.getReflectionState(tenant, user, space)` 返回 `last_error` / `last_run_at` / `last_event_seq` / `lease_owner` / `lease_until`。**自动整合由内核按 `autoTriggerThreshold` 自己触发、不经过 `consolidate()`，所以它是自动整合失败时应用侧唯一的观察点。**

结论：真正需要内核补的只剩「提案为什么被丢」，比原先以为的小得多。应用侧的改动已在本仓库完成（见第三节）。

## 二、补丁做了什么

纯增量，**不改变任何丢弃行为**，只把已经发生的丢弃计数出来。

```ts
export interface ReflectDropped {
  unparseable: number;        // 模型输出不是合法 JSON，或缺少 derived 数组
  wrongLayer: number;         // layer 不是 semantic / personal_semantic
  emptyContent: number;       // content 去空白后为空
  unknownSource: number;      // consolidated_from 不在本轮 episodic 集合（防编造来源）
  unknownInvalidates: number; // invalidates 里指向非 anchor 的 id 被剔除的条数
}
```

- `ReflectResult` 增加可选的 `dropped?: ReflectDropped`；
- `parseReflectJson` 从「静默返回空数组」改为同时报告 `unparseable`——解析成功但结构不对与解析失败同属「这轮模型输出用不了」；
- `buildReflectDerived` 从返回 `Memory | null` 改为返回带原因的联合类型，调用点按原因分桶累加；
- 顺带导出 `DEFAULT_ANCHOR_CAP`，这样应用侧判断「依据被裁过」不必抄一个 50。

**只计数，不携带被丢内容**：把 LLM 原始输出带出接口会让调用方无意间把它写进日志或界面。

### 有意没做的两件事

- **没有加日志**。三处丢弃里有两处已有 `log("warn", ...)`，补上第三处会改变现有日志量；`dropped` 计数已经能回答"有没有被丢、丢在哪一类"，而具体内容应当由调用方决定要不要打。
- **没有区分「提案无效」与「守门过滤」的更细语义**。`wrongLayer` / `emptyContent` 属于前者，`unknownSource` / `unknownInvalidates` 属于后者；调用方要合并成两类很容易，内核再分层反而会把实现细节固化进接口。

### 验证状态

- `src/reflect.ts` 单文件 strict 类型检查零错误（用消费方仓库的 TypeScript 跑的）。
- **没有跑目标仓库的测试**：克隆里没有 `node_modules`，装依赖并跑全量测试需要在目标机器上做。应用侧未做「消费 `dropped`」的改动，所以接口即使不合并也不影响当前功能。

## 三、应用侧已经做完的部分（不依赖本补丁）

问题比"内核缺接口"更近一层：**接口已经给出的区分，应用侧一个都没取用。**

- `engine.ts` 的 `consolidate()` 原先声明为 `Promise<void>`，把整个 `ReflectResult` 原地丢掉——一次「租约被占所以什么都没做」和一次「跑完并沉淀了 5 条」对调用方完全一样。现在返回归一化后的互斥结果：`consolidated` / `no-input` / `no-output` / `skipped`，并附带对应的失败编号。
- 新增 `memoryConsolidationState()` 读 `getReflectionState()`，把上一次自动整合的失败暴露到「需要处理」队列。**不读它的话，记忆停止沉淀是完全静默的：用户只会觉得"它最近不太记得事"。**
- 失败注册表的记忆域从一条笼统的「整合失败」拆成四条真实可区分的：`memoryConsolidationFailed`（可重试）、`memoryConsolidationLeaseHeld`（可重试）、`memoryConsolidationNoOutput`（不可重试）、`memoryEvidenceCapped`（不可重试）。
- `(tenant, user, space)` 行键与锚点上限放进 [`memory-config.ts`](../sdk/typescript/examples/companion/memory-config.ts) 并由守卫测试盯住：SDK 把它们放在私有 config 里、没有 getter，一旦 `makeMem()` 开始传 `tenantId` 或 `defaultScope` 而常量没跟着改，状态读取会命中不存在的行——返回空状态、**永远报「没有失败」**。这种失败看不见，所以宁可让测试拦住。

本补丁合并后，`memoryConsolidationNoOutput` 那一条可以进一步按 `dropped` 拆开，告诉用户"模型输出用不了"和"这轮确实没东西可沉淀"的区别。
