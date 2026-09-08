/**
 * 失败注册表：全应用「失败原因 → 能不能重试」的单一来源。
 *
 * 此前每个模块各自判断可重试性：capability-handoff 有 RETRYABLE_FAILURES，
 * delivery-outbox 靠 attempts 与 maxAttempts，模型路径直接抛字符串。结果是同一类
 * 失败在三处包成三种文案，界面只能猜要不要显示重试入口。这里把它们收成带编号的
 * 注册表，每条声明：唯一编号、名称、所属域、是否可重试、后果说明、唯一抛出点。
 *
 * 两条硬规则：
 * 1. summary 写给工程师看，说清后果（数据留在哪、下一步会发生什么），不是道歉文案；
 *    面向用户的话术仍由 UserFacingError 与界面文案负责。
 * 2. 未注册的失败值到达发射边界必须被重分类成 CF-E0001，原始报错文本、内部路径和
 *    依赖库堆栈都不外传——这正是 office-errors 那套脱敏策略的推广。
 *
 * 新增编号前先确认它对应一个真实抛出点，并把该位置写进 seededFrom；没有抛出点的
 * 编号会让"失败原因"重新变成猜测。
 */

export type FailureDomain =
  | "registry"
  | "model"
  | "tool"
  | "memory"
  | "delivery"
  | "capability"
  | "connector"
  | "storage";

export interface FailureShape {
  readonly code: string;
  readonly name: string;
  readonly domain: FailureDomain;
  /** true = 同样的输入再跑一次有意义；false = 重试必然重复同一结果，界面不应给重试入口。 */
  readonly retryable: boolean;
  readonly summary: string;
  /** 唯一抛出点。改动实现时同步这里，否则失败原因无法反查。 */
  readonly seededFrom: string;
  /** 允许随失败一起上报的非敏感字段名；未列出的键会被丢弃。 */
  readonly payload: readonly string[];
}

/** 未注册失败的兜底哨兵。它必须存在，否则「重分类」无处可去。 */
export const UNREGISTERED_FAILURE_CODE = "CF-E0001";

const SHAPES: readonly FailureShape[] = [
  {
    code: UNREGISTERED_FAILURE_CODE,
    name: "unregistered",
    domain: "registry",
    retryable: false,
    summary: "未注册的失败值到达发射边界后被重分类；原始报错文本、内部路径与依赖库堆栈不会外传。",
    seededFrom: "classifyFailure 兜底分支 in failure-registry.ts",
    payload: [],
  },

  // 模型域：llm.ts 的 Agent 循环、model-scheduler.ts 的排队、model-connection.ts 的连接校验。
  {
    code: "CF-E0101",
    name: "modelQueueFull",
    domain: "model",
    retryable: true,
    summary: "模型并发已满且等待队列到上限，本次请求未进入队列；稍后重试可能获得名额。",
    seededFrom: "容量与 maxWaiting 双满分支 in model-scheduler.ts acquire",
    payload: ["capacity", "waiting"],
  },
  {
    code: "CF-E0102",
    name: "modelQueueCancelled",
    domain: "model",
    retryable: false,
    summary: "排队期间调用方取消，模型请求从未发出；这次取消不需要重试，重试等于新发一次请求。",
    seededFrom: "signal.reason 拒绝分支 in model-scheduler.ts acquire",
    payload: [],
  },
  {
    code: "CF-E0103",
    name: "modelHttpStatus",
    domain: "model",
    retryable: true,
    summary: "模型服务返回非成功状态码，连接配置保留不变；退避后重试可能成功。",
    seededFrom: "CompanionModelHttpError in model-connection.ts",
    payload: ["httpStatus", "operation"],
  },
  {
    code: "CF-E0104",
    name: "modelCatalogMalformed",
    domain: "model",
    retryable: false,
    summary: "模型目录不是有效 JSON 或不含可对话模型；重试无用，需要改服务地址或接口兼容性。",
    seededFrom: "模型目录解析与空目录分支 in model-connection.ts",
    payload: [],
  },
  {
    code: "CF-E0105",
    name: "modelBudgetExhausted",
    domain: "model",
    retryable: false,
    summary: "Agent 循环用尽轮次或总 token 预算就结束，没有终态答复；同样预算重试会重复用尽，需要缩小任务或调高预算。",
    seededFrom: 'complete("max_rounds") 与 complete("token_budget_exhausted") in agent/runtime.ts',
    payload: ["maxRounds", "maxToolRounds", "maxTotalTokens"],
  },

  // 工具域：审批与工具调度。审批被拒和审批过期是两件事，界面反应也不同。
  {
    code: "CF-E0201",
    name: "approvalDenied",
    domain: "tool",
    retryable: false,
    summary: "用户明确拒绝了这次工具调用；同一指纹重试等于无视用户决定，必须换动作或重新征求同意。",
    seededFrom: "decide(false) in agent/approval-store.ts",
    payload: ["toolName"],
  },
  {
    code: "CF-E0202",
    name: "approvalExpired",
    domain: "tool",
    retryable: true,
    summary: "审批在有效期内没有得到答复而过期，什么都没有执行；重新发起会生成新的审批请求。",
    seededFrom: "expireDue in agent/approval-store.ts",
    payload: ["toolName", "ttlMs"],
  },
  {
    code: "CF-E0203",
    name: "approvalDuplicatePending",
    domain: "tool",
    retryable: true,
    summary: "同一指纹的调用已经在等待用户批准，本次不再重复排队；等前一个被决定即可。",
    seededFrom: "waiters 已存在分支 in agent/approval-store.ts authorize",
    payload: ["toolName"],
  },
  {
    code: "CF-E0204",
    name: "toolTimeout",
    domain: "tool",
    retryable: true,
    summary: "工具执行超过自身期限被取消；写类工具的副作用可能已部分发生，重试前先核对现场。",
    seededFrom: "timeoutMs 取消分支 in agent/tool-scheduler.ts",
    payload: ["toolName", "timeoutMs"],
  },
  {
    code: "CF-E0205",
    name: "guidelineNeverAllows",
    domain: "tool",
    retryable: false,
    summary: "工作准则里有一条 never 命中了这次动作，调用未发出也未打扰用户；改准则之前重试必然同样被拒。",
    seededFrom: "never 命中分支 in work-guidelines.ts resolveGuidelineDecision",
    payload: ["toolName", "guidelineId"],
  },

  // 记忆域：只登记应用侧真的能区分出来的落点。
  //
  // 记忆内核在 @nemos/sdk（正本 nemos-memory）。此前这里只记了一条笼统的「整合失败」，
  // 依据是 runReflect 的类型签名看不出区分——那个判断查得不够：ReflectResult 实际带着
  // skippedReason / episodicConsumed / anchorCount / invalidated，storage.getReflectionState()
  // 还能读到 last_error 与 last_run_at。所以能区分的比原先以为的多，逐条登记如下。
  //
  // 仍然拿不到的是「提案无效」与「复核未通过」：两者在内核里都只是静默的 return null
  // 或 continue，既无结构化出口也彼此不可区分，合并成 CF-E0303 一条。
  // 对内核的接口请求因此只剩这一项，见 docs/failure-registry-2026-09-08.md。
  {
    code: "CF-E0301",
    name: "memoryConsolidationFailed",
    domain: "memory",
    retryable: true,
    summary: "上一次离线整合抛错未完成，记忆状态没有被部分写入；游标不前进，下一次触发会从同一位置重新整合。",
    seededFrom: "getReflectionState().last_error 判定 in engine.ts memoryConsolidationState",
    payload: ["lastRunAt"],
  },
  {
    code: "CF-E0302",
    name: "memoryConsolidationLeaseHeld",
    domain: "memory",
    retryable: true,
    summary: "整合租约被另一个进程或上一次未结束的运行持有，本次直接跳过，什么都没做；租约到期后自然重试。",
    seededFrom: 'skippedReason "lease-held" 判定 in engine.ts consolidate',
    payload: ["leaseOwner", "leaseUntil"],
  },
  {
    code: "CF-E0303",
    name: "memoryConsolidationNoOutput",
    domain: "memory",
    retryable: false,
    summary: "整合消费了输入但没有产出任何派生记忆。可能是模型输出不合法、被守门规则过滤，或本轮确实没有可沉淀的内容——内核不区分这三种，重试同一批输入通常得到同一结果。",
    seededFrom: "episodicConsumed 与 derived 长度比对 in engine.ts consolidate",
    payload: ["episodicConsumed"],
  },
  {
    code: "CF-E0304",
    name: "memoryEvidenceCapped",
    domain: "memory",
    retryable: false,
    summary: "参与本轮整合的既有记忆超过内核锚点上限，喂给模型前被裁剪过；结论仍然写入，但依据的是子集。丢弃条数内核不返回，只能从总数推断。",
    seededFrom: "anchorCount 超过 MEMORY_ANCHOR_CAP 的判定 in engine.ts consolidate",
    payload: ["anchorCount", "cap"],
  },
  {
    code: "CF-E0305",
    name: "guidelineEvidenceInsufficient",
    domain: "memory",
    retryable: false,
    summary: "准则提案的证据不属于「用户显式纠正 / 撤销拒绝 / 明确指令」三种，或引用数不足下限；提案被丢弃，不写入任何准则。",
    seededFrom: "证据门槛分支 in work-guidelines.ts reviewGuidelineProposal",
    payload: ["citations", "minimumCitations"],
  },
  {
    code: "CF-E0306",
    name: "guidelineQuotesUser",
    domain: "memory",
    retryable: false,
    summary: "准则提案里出现了用户原话逐字引述；准则只保存高层概括，提案被丢弃而不是截断保存。",
    seededFrom: "逐字引述检测 in work-guidelines.ts reviewGuidelineProposal",
    payload: [],
  },

  // 投递域：任务跑完与结果送达是两件事，失败态必须分开。
  {
    code: "CF-E0401",
    name: "deliveryLeaseExpired",
    domain: "delivery",
    retryable: true,
    summary: "接收方领取了投递但未在租约内确认收到；记录回到待投递，不会被误标成已送达。",
    seededFrom: "recoverExpired in delivery-outbox.ts",
    payload: ["attempts", "leaseMs"],
  },
  {
    code: "CF-E0402",
    name: "deliveryAttemptsExhausted",
    domain: "delivery",
    retryable: false,
    summary: "投递用尽重试次数进入 failed；自动重投不会再发生，需要用户或运维显式重发。",
    seededFrom: "attempts >= maxAttempts 分支 in delivery-outbox.ts fail",
    payload: ["attempts", "maxAttempts"],
  },
  {
    code: "CF-E0403",
    name: "deliveryNotLeased",
    domain: "delivery",
    retryable: false,
    summary: "确认或失败上报的租约持有者与记录不符，本次上报被拒绝；这是调用方用错了租约，不是投递本身失败。",
    seededFrom: "租约校验分支 in delivery-outbox.ts acknowledge / fail",
    payload: ["owner"],
  },

  // 能力域：延续 capability-handoff 已有的四种交接失败，把可重试性搬到注册表统一判定。
  {
    code: "CF-E0501",
    name: "capabilityExecution",
    domain: "capability",
    retryable: true,
    summary: "接收能力跑了但没跑成，未产出交付物；可以重试同一交接。",
    seededFrom: "failureKind execution in capability-handoff.ts",
    payload: ["targetCapabilityId"],
  },
  {
    code: "CF-E0502",
    name: "capabilityTimeout",
    domain: "capability",
    retryable: true,
    summary: "交接超时，动作可能已部分执行；重试前按 uncertain 处理，先核对是否已产生副作用。",
    seededFrom: "failureKind timeout in capability-handoff.ts",
    payload: ["targetCapabilityId", "timeoutMs"],
  },
  {
    code: "CF-E0503",
    name: "capabilityMissing",
    domain: "capability",
    retryable: false,
    summary: "目标能力不存在或已下线；重试多少次都一样，需要改路由或恢复该能力。",
    seededFrom: "failureKind missing-capability in capability-handoff.ts",
    payload: ["targetCapabilityId"],
  },
  {
    code: "CF-E0504",
    name: "capabilityRejected",
    domain: "capability",
    retryable: false,
    summary: "接收方拒绝接手（权限、边界或输入不合约）；必须改输入或授权，不是重试问题。",
    seededFrom: "failureKind rejected in capability-handoff.ts",
    payload: ["targetCapabilityId"],
  },
  {
    code: "CF-E0505",
    name: "routinePausedUnread",
    domain: "capability",
    retryable: false,
    summary: "计划任务连续多次产出结果无人查看，已自动暂停以免继续消耗模型额度；由用户在计划面板显式恢复，定时器不会自行恢复。",
    seededFrom: "未读上限分支 in capabilities.ts pauseUnreadScheduledTasks",
    payload: ["taskId", "unreadRuns", "threshold"],
  },
  // 就绪检查的四种不可用原因来自 CapabilityToolReadiness.reason，逐一登记：
  // 「缺配置」和「探测失败」对用户是两句不同的话，可重试性也相反。
  {
    code: "CF-E0506",
    name: "capabilityNotConfigured",
    domain: "capability",
    retryable: false,
    summary: "能力所需的连接器或密钥没有配置，未开始执行；界面应说明缺什么，不要给重试入口。",
    seededFrom: 'readiness reason "not-configured" in capability-tools.ts readiness',
    payload: ["capabilityId", "missing"],
  },
  {
    code: "CF-E0507",
    name: "capabilityMissingDependency",
    domain: "capability",
    retryable: false,
    summary: "能力依赖的本机程序或插件不存在，未开始执行；需要先安装依赖。",
    seededFrom: 'readiness reason "missing-dependency" in capability-tools.ts readiness',
    payload: ["capabilityId", "missing"],
  },
  {
    code: "CF-E0508",
    name: "capabilityDisabled",
    domain: "capability",
    retryable: false,
    summary: "能力被显式停用，未开始执行；这是用户或策略的决定，不是故障。",
    seededFrom: 'readiness reason "disabled" in capability-tools.ts readiness',
    payload: ["capabilityId"],
  },
  {
    code: "CF-E0509",
    name: "capabilityProbeFailed",
    domain: "capability",
    retryable: true,
    summary: "就绪探测本身抛错，能力的真实可用性未知；探测结果有缓存有效期，过期后会重新探测。",
    seededFrom: 'readiness catch 分支（reason "probe-failed"） in capability-tools.ts readiness',
    payload: ["capabilityId"],
  },

  // 连接域：外部来源与自有端点。私网拦截是安全判定，永远不该重试。
  // 「没配密钥」不在这里——那是就绪问题，归 CF-E0506，避免两个编号说同一件事。
  {
    code: "CF-E0601",
    name: "connectorPrivateNetworkBlocked",
    domain: "connector",
    retryable: false,
    summary: "目标地址是本机或私网，或域名解析落到私网，请求被安全边界拒绝；这是策略结论，不是暂时故障。",
    seededFrom: "resolvePublicWebTarget 私网判定 in local-http-security.ts",
    payload: ["host"],
  },
  {
    code: "CF-E0602",
    name: "connectorResponseTooLarge",
    domain: "connector",
    retryable: false,
    summary: "响应体超过本次读取上限，连接已中断且不保留部分内容；需要缩小范围而不是重试。",
    seededFrom: "maxBytes 超限分支 in local-http-security.ts readPublicWebUrl",
    payload: ["maxBytes"],
  },
  {
    code: "CF-E0603",
    name: "connectorUnreachable",
    domain: "connector",
    retryable: true,
    summary: "在拿到任何响应前传输层就失败了，没有副作用；退避后重试可能成功。",
    seededFrom: "request error 分支 in local-http-security.ts readPublicWebUrl",
    payload: ["host"],
  },

  // 存储域：本机优先意味着落盘失败必须是一等失败态，而不是被 catch 吞掉。
  {
    code: "CF-E0701",
    name: "storeFileCorrupt",
    domain: "storage",
    retryable: false,
    summary: "持久文件的信封解析失败，该存储按空集重建；已损坏的历史记录不会自行回来，重试只会重复解析同一坏文件。",
    seededFrom: "load 解析失败分支 in delivery-outbox.ts 及同形态的 JSON 文件存储",
    payload: ["file"],
  },
  {
    code: "CF-E0702",
    name: "storeWriteFailed",
    domain: "storage",
    retryable: true,
    summary: "临时文件写入或原子改名失败，内存改动已回滚，磁盘上仍是上一个有效版本；可以重试。",
    seededFrom: "临时文件 + renameSync 分支 in delivery-outbox.ts save 及同形态的 JSON 文件存储",
    payload: ["file"],
  },
  {
    code: "CF-E0703",
    name: "jobOutcomeUncertain",
    domain: "storage",
    retryable: false,
    summary: "任务落到 uncertain：副作用可能已经发生，也可能没有。自动重试会有重复执行的风险，必须由人核对后决定重跑还是标记完成。",
    seededFrom: "uncertain 终态 in agent/job-queue.ts",
    payload: ["jobId", "attempts"],
  },
];

const BY_CODE = new Map(SHAPES.map((shape) => [shape.code, shape]));
const BY_NAME = new Map(SHAPES.map((shape) => [shape.name, shape]));

if (BY_CODE.size !== SHAPES.length || BY_NAME.size !== SHAPES.length) {
  throw new Error("失败注册表存在重复编号或重复名称");
}

/** 注册表全量，按编号排序。用于文档核验与设置页展示，调用方拿到的是只读视图。 */
export function listFailureShapes(): readonly FailureShape[] {
  return SHAPES;
}

export function failureShape(code: string): FailureShape | undefined {
  return BY_CODE.get(code);
}

export function failureShapeByName(name: string): FailureShape | undefined {
  return BY_NAME.get(name);
}

/** 界面唯一应当据此决定「显不显示重试入口」的判断。未注册编号一律不可重试。 */
export function isRetryableFailure(code: string): boolean {
  return BY_CODE.get(code)?.retryable === true;
}

export interface FailureReport {
  code: string;
  name: string;
  domain: FailureDomain;
  retryable: boolean;
  summary: string;
  payload: Record<string, string>;
}

/**
 * 已知编号的失败。带上 payload 便于定位，但只保留注册表声明过的键——
 * 否则「顺手多带一个字段」就会把路径或密钥带出去。
 */
export class CompanionFailure extends Error {
  readonly code: string;
  readonly payload: Record<string, string>;

  constructor(code: string, payload: Record<string, unknown> = {}) {
    const shape = BY_CODE.get(code);
    super(shape ? `${shape.code} ${shape.name}` : `${UNREGISTERED_FAILURE_CODE} unregistered`);
    this.name = "CompanionFailure";
    this.code = shape ? shape.code : UNREGISTERED_FAILURE_CODE;
    this.payload = shape ? pickPayload(shape, payload) : {};
  }

  report(): FailureReport {
    return describeFailure(this.code, this.payload);
  }
}

export function describeFailure(code: string, payload: Record<string, unknown> = {}): FailureReport {
  const shape = BY_CODE.get(code) ?? BY_CODE.get(UNREGISTERED_FAILURE_CODE)!;
  return {
    code: shape.code,
    name: shape.name,
    domain: shape.domain,
    retryable: shape.retryable,
    summary: shape.summary,
    payload: pickPayload(shape, payload),
  };
}

/**
 * 发射边界。任何值到这里都会变成注册表里的一条：CompanionFailure 保留自己的编号，
 * 其余全部重分类成 CF-E0001，且不携带原始报错文本。
 */
export function classifyFailure(value: unknown): FailureReport {
  if (value instanceof CompanionFailure) return value.report();
  if (value instanceof Error) {
    const shape = BY_NAME.get(value.name) ?? BY_CODE.get(codeFromMessage(value.message) ?? "");
    if (shape) return describeFailure(shape.code);
  }
  return describeFailure(UNREGISTERED_FAILURE_CODE);
}

function codeFromMessage(message: string): string | undefined {
  return /^(CF-E\d{4})\b/.exec(message)?.[1];
}

function pickPayload(shape: FailureShape, payload: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of shape.payload) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    result[key] = redactFailureDetail(String(value)).slice(0, 200);
  }
  return result;
}

/**
 * 共享脱敏。投递外发箱与失败上报都要落用户可见的错误文本，两处各写一份就会漂移——
 * 一边补了 refresh_token，另一边还漏着。
 */
export function redactFailureDetail(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
}
