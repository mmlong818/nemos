import type { ArtifactFormat, Capability } from "./capabilities.js";
import type { CapabilityToolSummary } from "./capability-tools.js";
import { matchSourceConnectors } from "./source-connectors.js";

export type DemandMode =
  | "run-existing"
  | "run-operator"
  | "ask-for-input"
  | "create-skill"
  | "propose-connector";

export type DemandGapKind =
  | "missing-input"
  | "missing-live-source"
  | "missing-tool"
  | "requires-confirmation"
  | "new-domain";

export interface DemandGap {
  kind: DemandGapKind;
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

export interface DemandAbilityMatch {
  abilityId: string;
  name: string;
  score: number;
  reason: string;
}

export interface DemandSourceMatch {
  id: string;
  label: string;
  score: number;
  sourceTypes: string[];
  accessNeeds: string[];
  realtimeRisk: string;
  evidenceRules: string[];
  nextIntegration: string;
}

export interface DemandConnectorPlan {
  title: string;
  sourceCandidates: string[];
  toolPlan: string[];
  verificationRules: string[];
  fallback: string;
}

export interface DemandIntakeReport {
  id: string;
  createdAt: string;
  request: string;
  normalizedGoal: string;
  recommendedMode: DemandMode;
  targetFormat: ArtifactFormat;
  needsLiveData: boolean;
  needsUserConfirmation: boolean;
  matchedAbilities: DemandAbilityMatch[];
  tools: CapabilityToolSummary[];
  sources: DemandSourceMatch[];
  connectorPlan: DemandConnectorPlan;
  missingInputs: string[];
  gaps: DemandGap[];
  nextActions: string[];
  promptBlock: string;
}

export interface BuildDemandIntakeInput {
  request: string;
  abilities: Capability[];
  tools: CapabilityToolSummary[];
  targetFormat?: ArtifactFormat;
}

const LIVE_TERMS = [
  "today", "tomorrow", "latest", "current", "now", "price", "availability", "booking", "schedule",
  "今天", "明天", "最新", "现在", "实时", "价格", "票价", "余票", "房态", "营业时间", "菜单", "行情", "汇率",
];

const CONFIRMATION_TERMS = [
  "buy", "sell", "trade", "pay", "transfer", "delete", "send", "submit", "book", "reserve",
  "买入", "卖出", "交易", "下单", "付款", "转账", "删除", "发送", "提交", "预订", "预约", "订座", "订房",
];

const FORMAT_HINTS: Array<{ format: ArtifactFormat; terms: string[] }> = [
  { format: "html", terms: ["html", "网页", "页面"] },
  { format: "json", terms: ["json", "接口", "结构化"] },
  { format: "doc", terms: ["word", "文档", "正式稿", "方案书"] },
  { format: "txt", terms: ["txt", "纯文本"] },
  { format: "md", terms: ["markdown", "md", "报告", "简报", "清单", "表格"] },
];

export function buildDemandIntakeReport(input: BuildDemandIntakeInput): DemandIntakeReport {
  const request = input.request.trim();
  const createdAt = new Date().toISOString();
  const targetFormat = input.targetFormat ?? inferFormat(request);
  let needsLiveData = includesAny(request, LIVE_TERMS);
  const needsUserConfirmation = includesAny(request, CONFIRMATION_TERMS);
  const matchedAbilities = matchAbilities(request, input.abilities);
  const sources = matchSourceConnectors(request).map((item) => ({
    id: item.connector.id,
    label: item.connector.label,
    score: item.score,
    sourceTypes: item.connector.sourceTypes,
    accessNeeds: item.connector.accessNeeds,
    realtimeRisk: item.connector.realtimeRisk,
    evidenceRules: item.connector.evidenceRules,
    nextIntegration: item.connector.nextIntegration,
  }));
  needsLiveData = needsLiveData || sources.some((item) => item.id !== "source-discovery");
  const missingInputs = inferMissingInputs(request, sources.map((item) => item.id));
  const gaps = inferGaps({
    request,
    tools: input.tools,
    sources,
    missingInputs,
    needsLiveData,
    needsUserConfirmation,
    matchedAbilities,
  });
  const recommendedMode = chooseMode(matchedAbilities, gaps, missingInputs);
  const nextActions = buildNextActions(recommendedMode, gaps, matchedAbilities);
  const connectorPlan = buildConnectorPlan(sources);
  const normalizedGoal = request
    .replace(/^(小丑鱼|帮我|请|给我|替我|麻烦|需要你|你来)[，,:：\s]*/g, "")
    .trim()
    .slice(0, 240) || "处理用户交办事项";

  return {
    id: `intake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    request,
    normalizedGoal,
    recommendedMode,
    targetFormat,
    needsLiveData,
    needsUserConfirmation,
    matchedAbilities,
    tools: input.tools,
    sources,
    connectorPlan,
    missingInputs,
    gaps,
    nextActions,
    promptBlock: buildPromptBlock({
      normalizedGoal,
      recommendedMode,
      targetFormat,
      needsLiveData,
      needsUserConfirmation,
      matchedAbilities,
      sources,
      connectorPlan,
      missingInputs,
      gaps,
      nextActions,
    }),
  };
}

function matchAbilities(request: string, abilities: Capability[]): DemandAbilityMatch[] {
  const tokens = tokensFor(request);
  return abilities
    .map((ability) => {
      const haystack = `${ability.name}\n${ability.description}\n${ability.prompt}\n${ability.learnedKey ?? ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token.toLowerCase())) score += token.length >= 3 ? 2 : 1;
      }
      if (ability.source === "learned") score += Math.min(2, ability.useCount ?? 0);
      return {
        abilityId: ability.id,
        name: ability.name,
        score,
        reason: score >= 4 ? "能力描述和需求高度相关" : score > 0 ? "能力描述命中部分关键词" : "未命中",
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function inferGaps(input: {
  request: string;
  tools: CapabilityToolSummary[];
  sources: DemandSourceMatch[];
  missingInputs: string[];
  needsLiveData: boolean;
  needsUserConfirmation: boolean;
  matchedAbilities: DemandAbilityMatch[];
}): DemandGap[] {
  const gaps: DemandGap[] = [];
  if (input.missingInputs.length > 0) {
    gaps.push({
      kind: "missing-input",
      title: "缺少关键输入",
      detail: `还需要：${input.missingInputs.join("、")}`,
      severity: "medium",
    });
  }
  const hasLiveSearch = input.tools.some((tool) => tool.id === "web.search" && tool.available);
  if (input.needsLiveData && !hasLiveSearch) {
    gaps.push({
      kind: "missing-tool",
      title: "缺少实时搜索能力",
      detail: "当前没有可用的联网搜索工具，实时信息只能输出核验入口和接入建议。",
      severity: "high",
    });
  }
  const sourceNeedsAdapter = input.sources.some((source) => source.id !== "source-discovery" && /Add .* adapter/i.test(source.nextIntegration));
  if (sourceNeedsAdapter) {
    gaps.push({
      kind: "missing-live-source",
      title: "结构化来源尚未接入",
      detail: "已有来源类型和核验规则，但还缺真实 API、平台页面解析或网页自动化执行器。",
      severity: input.needsLiveData ? "high" : "medium",
    });
  }
  if (input.needsUserConfirmation) {
    gaps.push({
      kind: "requires-confirmation",
      title: "需要用户确认",
      detail: "涉及交易、付款、发送、提交、预订或删除等动作时，系统只能准备方案，不能静默执行。",
      severity: "high",
    });
  }
  if (input.sources.some((source) => source.id === "source-discovery") && input.matchedAbilities.length === 0) {
    gaps.push({
      kind: "new-domain",
      title: "新领域需求",
      detail: "当前没有明确匹配的专属能力，应先生成需求模型和连接器方案。",
      severity: "medium",
    });
  }
  return gaps;
}

function inferMissingInputs(request: string, sourceIds: string[]): string[] {
  const missing = new Set<string>();
  const hasDate = /\d{1,2}[月/-]\d{1,2}|今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|today|tomorrow/i.test(request);
  const hasBudget = /\d+\s*(元|块|rmb|hkd|usd|港币|美元)|预算|人均|价格|多少钱/i.test(request);
  const hasLocation = /[到在去从近附近]|城市|地址|商圈|机场|车站|hotel|restaurant|near/i.test(request);
  if (sourceIds.includes("travel-rail") || sourceIds.includes("travel-flight")) {
    if (!hasDate) missing.add("出行日期");
    if (!/[从].+[到]|from.+to|到.+的/i.test(request)) missing.add("出发地和目的地");
  }
  if (sourceIds.includes("hotel-booking")) {
    if (!hasDate) missing.add("入住和离店日期");
    if (!hasLocation) missing.add("城市或区域");
    if (!hasBudget) missing.add("预算或房型偏好");
  }
  if (sourceIds.includes("restaurant-booking")) {
    if (!hasDate) missing.add("用餐日期和时间");
    if (!hasLocation) missing.add("城市或区域");
    if (!/几人|人数|人\b|party/i.test(request)) missing.add("人数");
  }
  if (sourceIds.includes("market-briefing") && !/[0-9]{4,5}|HKEX|港股|股票|自选|关注/i.test(request)) {
    missing.add("关注标的或市场范围");
  }
  return [...missing];
}

function chooseMode(
  matchedAbilities: DemandAbilityMatch[],
  gaps: DemandGap[],
  missingInputs: string[],
): DemandMode {
  if (missingInputs.length > 0 || gaps.some((gap) => gap.kind === "requires-confirmation")) return "ask-for-input";
  if (gaps.some((gap) => gap.kind === "new-domain")) return "propose-connector";
  if (matchedAbilities.length === 0) return "create-skill";
  if (gaps.some((gap) => gap.kind === "missing-live-source" || gap.kind === "missing-tool")) return "run-operator";
  return "run-existing";
}

function buildNextActions(mode: DemandMode, gaps: DemandGap[], abilities: DemandAbilityMatch[]): string[] {
  if (mode === "ask-for-input") return ["先向用户补齐关键输入或确认高风险动作", "同时准备可执行计划和待核验清单"];
  if (mode === "propose-connector") return ["输出新领域来源地图", "生成连接器方案", "先交付可确认部分"];
  if (mode === "create-skill") return ["用任务工作台执行一次", "完成后沉淀为新的 SKILL.md"];
  if (mode === "run-operator") return ["用任务工作台交付结果", "明确标注缺少的实时来源或工具", "把缺口加入路线图"];
  const top = abilities[0]?.name ? `优先调用：${abilities[0].name}` : "优先调用已有能力";
  return gaps.length ? [top, "补充缺口说明"] : [top, "保存产物并更新技能使用记录"];
}

function buildConnectorPlan(sources: DemandSourceMatch[]): DemandConnectorPlan {
  const concrete = sources.filter((source) => source.id !== "source-discovery");
  if (concrete.length === 0) {
    return {
      title: "新领域来源发现方案",
      sourceCandidates: ["官方入口或公开 API", "可信平台页面", "商家/机构自有页面", "用户可人工确认的电话、邮箱或表单入口"],
      toolPlan: ["先生成来源地图", "按官方、平台、社区、人工确认四类分级", "选择可重复访问的入口沉淀为连接器"],
      verificationRules: ["回答中必须标注来源类型和查询时间", "不能确认的实时事实只给核验入口，不给确定结论"],
      fallback: "如果暂时没有可靠来源，先交付需求拆解、待确认字段和人工核验清单。",
    };
  }
  const sourceCandidates = unique(concrete.flatMap((source) => source.accessNeeds)).slice(0, 6);
  const verificationRules = unique(concrete.flatMap((source) => source.evidenceRules)).slice(0, 6);
  const toolPlan = unique(concrete.flatMap((source) => toolsForSourceTypes(source.sourceTypes))).slice(0, 6);
  return {
    title: `${concrete.map((source) => source.label).join(" / ")} 接入方案`,
    sourceCandidates,
    toolPlan,
    verificationRules: [
      ...verificationRules,
      "实时价格、库存、排队、余票、行情等必须带查询时间和可验证入口。",
    ],
    fallback: "如果真实接口尚未接入，先用任务工作台产出候选结果，并把未核验字段单独标记。",
  };
}

function toolsForSourceTypes(sourceTypes: string[]): string[] {
  const out: string[] = [];
  if (sourceTypes.includes("official-live") || sourceTypes.includes("official-static")) {
    out.push("官方 API 或官方页面解析");
  }
  if (sourceTypes.includes("platform-live")) {
    out.push("可信平台查询适配器或浏览器自动化");
  }
  if (sourceTypes.includes("merchant-page")) {
    out.push("商家页面抓取、地图入口或电话确认");
  }
  if (sourceTypes.includes("community") || sourceTypes.includes("general-web")) {
    out.push("通用搜索、评价来源聚合和可信度标注");
  }
  if (sourceTypes.includes("manual-verification")) {
    out.push("人工确认入口和待确认字段清单");
  }
  return out;
}

function buildPromptBlock(input: {
  normalizedGoal: string;
  recommendedMode: DemandMode;
  targetFormat: ArtifactFormat;
  needsLiveData: boolean;
  needsUserConfirmation: boolean;
  matchedAbilities: DemandAbilityMatch[];
  sources: DemandSourceMatch[];
  connectorPlan: DemandConnectorPlan;
  missingInputs: string[];
  gaps: DemandGap[];
  nextActions: string[];
}): string {
  return [
    "Demand intake report:",
    `Goal: ${input.normalizedGoal}`,
    `Recommended mode: ${input.recommendedMode}`,
    `Target format: ${input.targetFormat}`,
    `Needs live data: ${input.needsLiveData ? "yes" : "no"}`,
    `Needs user confirmation: ${input.needsUserConfirmation ? "yes" : "no"}`,
    `Matched abilities: ${input.matchedAbilities.map((item) => `${item.name}(${item.score})`).join(", ") || "none"}`,
    `Source matches: ${input.sources.map((item) => item.id).join(", ") || "none"}`,
    `Connector plan: ${input.connectorPlan.title}; sources=${input.connectorPlan.sourceCandidates.join(" / ") || "none"}; tools=${input.connectorPlan.toolPlan.join(" / ") || "none"}`,
    `Missing inputs: ${input.missingInputs.join(", ") || "none"}`,
    `Gaps: ${input.gaps.map((gap) => `${gap.title}: ${gap.detail}`).join(" | ") || "none"}`,
    `Next actions: ${input.nextActions.join(" | ")}`,
  ].join("\n");
}

function inferFormat(request: string): ArtifactFormat {
  const lower = request.toLowerCase();
  for (const hint of FORMAT_HINTS) {
    if (hint.terms.some((term) => lower.includes(term.toLowerCase()))) return hint.format;
  }
  return "md";
}

function includesAny(input: string, terms: string[]): boolean {
  const lower = input.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function tokensFor(input: string): string[] {
  const lower = input.toLowerCase();
  const out = new Set<string>();
  for (const token of lower.match(/[a-z0-9]{3,}/g) ?? []) out.add(token);
  for (const token of lower.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    out.add(token.slice(0, 8));
    for (let i = 0; i < token.length - 1; i++) out.add(token.slice(i, i + 2));
  }
  return [...out].slice(0, 40);
}

function unique(input: string[]): string[] {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))];
}
