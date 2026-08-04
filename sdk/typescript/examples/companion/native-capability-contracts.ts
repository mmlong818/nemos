export const NATIVE_CAPABILITY_IDS = [
  "research-brief",
  "presentation-builder",
  "thinking-workbench",
  "product-design",
  "business-deal",
  "market-opportunity",
  "ability-builder",
] as const;

export type NativeCapabilityId = typeof NATIVE_CAPABILITY_IDS[number];

export interface NativeCapabilityPayload {
  kind: NativeCapabilityId;
  title: string;
  summary: string;
  data: Record<string, unknown>;
}

export interface GeneratedAbilitySpec {
  name: string;
  description: string;
  defaultFormat: "md" | "html" | "txt" | "json" | "doc";
  prompt: string;
  triggerExamples: string[];
  nonTriggerExamples: string[];
  checks: string[];
}

const NATIVE_ID_SET = new Set<string>(NATIVE_CAPABILITY_IDS);

export function isNativeCapabilityId(value: string): value is NativeCapabilityId {
  return NATIVE_ID_SET.has(value);
}

export function nativeCapabilityContract(id: NativeCapabilityId): string {
  const common = [
    "只输出一个合法 JSON 对象，不要使用 Markdown 代码块，不要在 JSON 前后解释。",
    `kind 必须等于 ${JSON.stringify(id)}。`,
    "所有未知信息都用空数组、空字符串或明确的待确认状态表达，禁止编造。",
    "用户偏好只影响文笔、版式与格式，不得改变事实、数值或结论。",
  ];
  return [...common, contractFor(id)].join("\n");
}

export function parseNativeCapabilityPayload(id: NativeCapabilityId, raw: string): NativeCapabilityPayload {
  const parsed = extractJson(raw);
  const root = asRecord(parsed, "根对象");
  const kind = asText(root.kind, "kind");
  if (kind !== id) throw new Error(`kind 应为 ${id}`);
  const title = asText(root.title, "title");
  const summary = asText(root.summary, "summary");
  const data = asRecord(root.data, "data");
  if (id === "ability-builder" && !Array.isArray(data.testCases)) {
    const spec = asRecord(data.spec, "data.spec");
    if (Array.isArray(spec.testCases)) data.testCases = spec.testCases;
  }
  validateData(id, data);
  return { kind: id, title, summary, data };
}

export function nativeCapabilityAuditPrompt(
  id: NativeCapabilityId,
  instruction: string,
  raw: string,
  parseError?: string,
): string {
  const focus = id === "research-brief"
    ? "逐条检查来源、关键声明、证据引用、置信度和限制；修正无依据或无法追溯的结论。"
    : id === "ability-builder"
      ? "检查触发边界、步骤可执行性、失败路径、输出约定和验收条件；删掉空泛说明。"
      : "修复结构并保留用户意图。";
  return [
    "Run a backend capability audit.",
    "Execution requirements: return the complete corrected JSON in this response.",
    "你现在进行独立质量审查并交付修订后的最终结构。",
    `用户目标：${instruction}`,
    focus,
    parseError ? `上一版结构错误：${parseError}` : "上一版结构可解析，但仍需质量审查。",
    "上一版：",
    raw.slice(0, 28_000),
    "",
    nativeCapabilityContract(id),
  ].join("\n");
}

export function nativeCapabilityNeedsAudit(id: NativeCapabilityId): boolean {
  return id === "research-brief" || id === "ability-builder";
}

export function generatedAbilitySpec(payload: NativeCapabilityPayload): GeneratedAbilitySpec | null {
  if (payload.kind !== "ability-builder") return null;
  const spec = asRecord(payload.data.spec, "data.spec");
  const defaultFormat = String(spec.defaultFormat || "md");
  if (!["md", "html", "txt", "json", "doc"].includes(defaultFormat)) {
    throw new Error("data.spec.defaultFormat 不受支持");
  }
  return {
    name: asText(spec.name, "data.spec.name").slice(0, 40),
    description: asText(spec.description, "data.spec.description").slice(0, 320),
    defaultFormat: defaultFormat as GeneratedAbilitySpec["defaultFormat"],
    prompt: asText(spec.prompt, "data.spec.prompt").slice(0, 5000),
    triggerExamples: asTextList(spec.triggerExamples, "data.spec.triggerExamples", 2),
    nonTriggerExamples: asTextList(spec.nonTriggerExamples, "data.spec.nonTriggerExamples", 1),
    checks: asTextList(spec.checks, "data.spec.checks", 2),
  };
}

function contractFor(id: NativeCapabilityId): string {
  switch (id) {
    case "research-brief":
      return "结构：{kind,title,summary,data:{question,plan:string[],sources:[{id,title,url,publisher,tier:1|2|3|4,score:0-100,checkedAt,claims:string[]}],findings:[{claim,evidenceIds:string[],confidence:0-1,status:\"confirmed\"|\"partial\"|\"unverified\"}],conclusion,limitations:string[],nextSteps:string[]}}。至少 3 个研究步骤；有联网资料时至少 2 个来源；每条已确认结论必须引用 evidenceIds。";
    case "presentation-builder":
      return "结构：{kind,title,summary,data:{audience,purpose,theme:\"sand\"|\"ink\"|\"forest\",slides:[{title,keyMessage,layout:\"title\"|\"statement\"|\"two-column\"|\"timeline\"|\"comparison\"|\"closing\",bullets:string[],speakerNotes}]}}。slides 为 3-30 页，每页只表达一个主观点。";
    case "thinking-workbench":
      return "结构：{kind,title,summary,data:{problem,facts:string[],assumptions:[{text,risk}],contradictions:string[],options:[{name,upside,downside,signal}],experiments:[{name,method,cost,successSignal}],nextActions:string[]}}。至少 2 个选项和 1 个低成本验证。";
    case "product-design":
      return "结构：{kind,title,summary,data:{user,job,successCriteria:string[],flow:[{step,userAction,systemResponse}],informationArchitecture:string[],screens:[{name,purpose,primaryAction,sections:string[],states:string[]}],designTokens:{accent,background,surface,text},acceptanceChecks:string[]}}。至少 2 个关键页面，包含空、加载、错误或完成状态。";
    case "business-deal":
      return "结构：{kind,title,summary,data:{accountContext,mutualValue,stakeholders:[{name,role,influence,interest,status}],evidence:string[],assumptions:string[],objections:[{objection,response,evidenceNeeded}],boundaries:string[],agenda:string[],followUps:[{channel,message}],nextActions:string[]}}。不得虚构承诺、预算、权限或回复。";
    case "market-opportunity":
      return "结构：{kind,title,summary,data:{targetUser,problem,alternatives:string[],signals:[{signal,evidence,status}],assumptions:[{name,low,base,high,unit}],scenarios:[{name,description,demandScore:0-100,competitionScore:0-100,executionScore:0-100}],thesis,invalidation:string[],experiments:[{name,cost,duration,successSignal}],risks:string[]}}。至少 3 个情景和 2 个可验证实验，估计值必须列入 assumptions。";
    case "ability-builder":
      return "结构：{kind,title,summary,data:{qualification:{shouldBuild:boolean,reason,repeatSignals:string[]},spec:{name,description,defaultFormat:\"md\"|\"html\"|\"txt\"|\"json\"|\"doc\",triggerExamples:string[],nonTriggerExamples:string[],inputs:string[],steps:string[],decisionRules:string[],outputs:string[],exceptions:string[],checks:string[],prompt},testCases:[{request,shouldTrigger:boolean,reason}]}}。仅当任务可重复且边界清晰时 shouldBuild=true；至少 3 个正触发、2 个负触发和 5 个测试。";
  }
}

function validateData(id: NativeCapabilityId, data: Record<string, unknown>): void {
  switch (id) {
    case "research-brief":
      asText(data.question, "data.question");
      asTextList(data.plan, "data.plan", 3);
      asRecordList(data.sources, "data.sources", 0);
      asRecordList(data.findings, "data.findings", 1);
      asText(data.conclusion, "data.conclusion");
      break;
    case "presentation-builder":
      asText(data.audience, "data.audience");
      asText(data.purpose, "data.purpose");
      asRecordList(data.slides, "data.slides", 3, 30);
      for (const [index, slide] of asRecordList(data.slides, "data.slides", 3, 30).entries()) {
        asText(slide.title, `data.slides[${index}].title`);
        asText(slide.keyMessage, `data.slides[${index}].keyMessage`);
        asTextList(slide.bullets, `data.slides[${index}].bullets`, 0);
      }
      break;
    case "thinking-workbench":
      asText(data.problem, "data.problem");
      asRecordList(data.options, "data.options", 2);
      asRecordList(data.experiments, "data.experiments", 1);
      break;
    case "product-design":
      asText(data.user, "data.user");
      asText(data.job, "data.job");
      asRecordList(data.flow, "data.flow", 2);
      asRecordList(data.screens, "data.screens", 2);
      asTextList(data.acceptanceChecks, "data.acceptanceChecks", 2);
      break;
    case "business-deal":
      asText(data.accountContext, "data.accountContext");
      asRecordList(data.stakeholders, "data.stakeholders", 1);
      asRecordList(data.objections, "data.objections", 1);
      asTextList(data.nextActions, "data.nextActions", 1);
      break;
    case "market-opportunity":
      asText(data.targetUser, "data.targetUser");
      asRecordList(data.scenarios, "data.scenarios", 3);
      asRecordList(data.experiments, "data.experiments", 2);
      asTextList(data.invalidation, "data.invalidation", 1);
      break;
    case "ability-builder": {
      const qualification = asRecord(data.qualification, "data.qualification");
      if (typeof qualification.shouldBuild !== "boolean") throw new Error("data.qualification.shouldBuild 必须是布尔值");
      asText(qualification.reason, "data.qualification.reason");
      const spec = asRecord(data.spec, "data.spec");
      asText(spec.name, "data.spec.name");
      asText(spec.description, "data.spec.description");
      asText(spec.prompt, "data.spec.prompt");
      asTextList(spec.triggerExamples, "data.spec.triggerExamples", 3);
      asTextList(spec.nonTriggerExamples, "data.spec.nonTriggerExamples", 2);
      asTextList(spec.checks, "data.spec.checks", 2);
      asRecordList(data.testCases, "data.testCases", 5);
      break;
    }
  }
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [trimmed, trimmed + "}", trimmed + "}}"]) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Some models complete every field but omit a final object delimiter.
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("没有找到 JSON 对象");
  const objectText = trimmed.slice(start, end + 1);
  let lastError: unknown;
  for (const candidate of [objectText, objectText + "}", objectText + "}}"]) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`JSON 无法解析：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function asText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空文本`);
  return value.trim();
}

function asTextList(value: unknown, label: string, min: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const result = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (result.length < min) throw new Error(`${label} 至少需要 ${min} 项`);
  return result;
}

function asRecordList(value: unknown, label: string, min: number, max = 100): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const result = value.map((item, index) => asRecord(item, `${label}[${index}]`));
  if (result.length < min || result.length > max) throw new Error(`${label} 项数应为 ${min}-${max}`);
  return result;
}
