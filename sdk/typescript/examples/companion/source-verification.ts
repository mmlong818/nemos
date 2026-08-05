import { matchSourceConnectors } from "./source-connectors.js";

export type SourceVerificationStatus =
  | "live-adapter-ready"
  | "adapter-needed"
  | "manual-check-needed"
  | "source-discovery-needed";

export interface SourceVerificationCard {
  id: string;
  label: string;
  status: SourceVerificationStatus;
  sourceTypes: string[];
  requiredInputs: string[];
  realtimeRisk: string;
  verificationRules: string[];
  nextIntegration: string;
}

export interface SourceVerificationReport {
  relevant: boolean;
  checkedAt: string;
  status: SourceVerificationStatus;
  summary: string;
  cards: SourceVerificationCard[];
  unresolved: string[];
  artifactRules: string[];
}

const SOURCE_INTENT_TERMS = [
  "来源", "信息源", "数据源", "核验", "官方", "可靠", "实时", "票价", "余票", "房态", "菜单", "营业时间", "行情", "公告",
  "source", "verify", "official", "reliable", "live", "price", "availability", "schedule", "quote", "filing",
];

export function buildSourceVerificationReport(instruction: string): SourceVerificationReport {
  const matches = matchSourceConnectors(instruction, 4);
  const onlyFallback = matches.length === 1 && matches[0]?.connector.id === "source-discovery";
  const relevant = !onlyFallback || includesAny(instruction, SOURCE_INTENT_TERMS);
  const cards = matches.map(({ connector }) => {
    const needsManual = connector.sourceTypes.includes("manual-verification");
    const status: SourceVerificationStatus = connector.id === "source-discovery"
      ? "source-discovery-needed"
      : connector.id === "market-briefing"
        ? "live-adapter-ready"
        : needsManual
          ? "manual-check-needed"
          : "adapter-needed";
    return {
      id: connector.id,
      label: connector.label,
      status,
      sourceTypes: [...connector.sourceTypes],
      requiredInputs: [...connector.accessNeeds],
      realtimeRisk: connector.realtimeRisk,
      verificationRules: [...connector.evidenceRules],
      nextIntegration: connector.nextIntegration,
    };
  });
  const status = overallStatus(cards);
  return {
    relevant,
    checkedAt: new Date().toISOString(),
    status,
    summary: summaryFor(status),
    cards,
    unresolved: unresolvedFor(cards),
    artifactRules: [
      "实时价格、库存、余票、房态、营业时间、菜单、排队、行情等，必须标注查询时间和来源等级。",
      "没有真实接口或官方页面结果时，只能给待核验方案，不能写成已确认事实。",
      "通用搜索结果只能作为线索，不能替代官方系统、可信平台或商家确认。",
    ],
  };
}

export function sourceVerificationPromptBlock(report: SourceVerificationReport): string {
  if (!report.relevant) return "";
  return [
    "Source verification status:",
    `Checked at: ${report.checkedAt}`,
    `Overall status: ${report.status}`,
    `Summary: ${report.summary}`,
    ...report.cards.flatMap((card) => [
      `- ${card.id}: ${card.label}`,
      `  status: ${card.status}`,
      `  source types: ${card.sourceTypes.join(", ")}`,
      `  output fields: ${adapterFields(card.id).join(", ")}`,
      `  downgrade rule: ${adapterDowngradeRule(card.id)}`,
      `  required inputs: ${card.requiredInputs.join(" / ")}`,
      `  realtime risk: ${card.realtimeRisk}`,
      `  verification rules: ${card.verificationRules.join(" ")}`,
      `  next integration: ${card.nextIntegration}`,
    ]),
    `Unresolved: ${report.unresolved.join(" | ") || "none"}`,
  ].join("\n");
}

export function sourceVerificationMarkdown(report: SourceVerificationReport): string {
  if (!report.relevant) return "";
  const lines = [
    "## 来源核验状态",
    "",
    `- 核验时间：${report.checkedAt}`,
    `- 总体状态：${statusLabel(report.status)}`,
    `- 结论：${report.summary}`,
    "",
    "| 来源模块 | 状态 | 来源类型 | 不能直接确认的风险 | 下一步接入 |",
    "| --- | --- | --- | --- | --- |",
    ...report.cards.map((card) => [
      card.label,
      statusLabel(card.status),
      card.sourceTypes.join("、"),
      card.realtimeRisk,
      card.nextIntegration,
    ].map(escapeCell).join(" | ")).map((row) => `| ${row} |`),
    "",
    "### 产物使用规则",
    "",
    ...report.artifactRules.map((rule) => `- ${rule}`),
    "",
    "### 适配器字段要求",
    "",
    "| 模块 | 必须输出的字段 | 降级规则 |",
    "| --- | --- | --- |",
    ...report.cards.map((card) => [
      card.label,
      adapterFields(card.id).join("、"),
      adapterDowngradeRule(card.id),
    ].map(escapeCell).join(" | ")).map((row) => `| ${row} |`),
  ];
  if (report.unresolved.length) {
    lines.push("", "### 尚未解决", "", ...report.unresolved.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function overallStatus(cards: SourceVerificationCard[]): SourceVerificationStatus {
  if (cards.some((card) => card.status === "source-discovery-needed")) return "source-discovery-needed";
  if (cards.some((card) => card.status === "manual-check-needed")) return "manual-check-needed";
  if (cards.some((card) => card.status === "adapter-needed")) return "adapter-needed";
  return "live-adapter-ready";
}

function summaryFor(status: SourceVerificationStatus): string {
  if (status === "live-adapter-ready") return "已有可执行适配器，可以把结果标为已核验。";
  if (status === "adapter-needed") return "已识别可靠来源类型，但还没有接入真实 API 或页面执行器。";
  if (status === "manual-check-needed") return "部分信息必须通过官方、平台、商家页面或人工确认后才能当成事实。";
  return "这是新领域需求，必须先做来源地图和可靠性分级。";
}

function unresolvedFor(cards: SourceVerificationCard[]): string[] {
  const unresolved = new Set<string>();
  for (const card of cards) {
    if (card.status === "source-discovery-needed") unresolved.add("需要先确定该领域的官方入口、可信平台和人工核验方式。");
    if (card.status === "adapter-needed") unresolved.add(`${card.label} 还缺真实接口或页面自动化执行器。`);
    if (card.status === "manual-check-needed") unresolved.add(`${card.label} 涉及实时或人工确认字段，不能静默写成已确认。`);
  }
  return [...unresolved];
}

function statusLabel(status: SourceVerificationStatus): string {
  if (status === "live-adapter-ready") return "已接入";
  if (status === "adapter-needed") return "待接入";
  if (status === "manual-check-needed") return "需人工/平台确认";
  return "需发现来源";
}

function includesAny(input: string, terms: string[]): boolean {
  const lower = input.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

function adapterFields(id: string): string[] {
  if (id === "travel-rail") {
    return ["出发地", "目的地", "日期", "车次", "出发/到达时间", "耗时", "座席", "票价", "余票", "来源", "查询时间", "确认状态"];
  }
  if (id === "travel-flight") {
    return ["出发机场", "到达机场", "日期", "航司/航班号", "起降时间", "耗时", "舱位", "票价", "行李/退改", "来源", "查询时间", "确认状态"];
  }
  if (id === "hotel-booking") {
    return ["城市/区域", "入住/离店", "酒店名", "位置", "房型", "总价/税费", "取消政策", "房态", "评分", "预订入口", "查询时间", "确认状态"];
  }
  if (id === "restaurant-booking") {
    return ["城市/区域", "用餐时间", "人数", "餐馆名", "菜系", "人均", "营业时间", "菜单状态", "电话/预订入口", "评分", "查询时间", "确认状态"];
  }
  if (id === "market-briefing") {
    return ["市场", "标的", "公告/新闻", "行情快照", "时间戳", "来源", "风险", "待确认项", "非投资建议声明"];
  }
  return ["目标", "候选来源", "来源等级", "访问方式", "查询时间", "确认状态", "待确认项"];
}

function adapterDowngradeRule(id: string): string {
  if (id === "travel-rail") return "没有官方或可信平台实时结果时，票价和余票只能标为待核验。";
  if (id === "travel-flight") return "没有航司/机场/可信平台实时结果时，票价、余座、延误状态只能标为待核验。";
  if (id === "hotel-booking") return "没有平台或酒店官方确认时，房态、总价、取消政策只能标为待核验。";
  if (id === "restaurant-booking") return "没有商家或平台确认时，营业时间、菜单、排队和可订座只能标为待核验。";
  if (id === "market-briefing") return "没有交易所、公司公告或可信行情源时，行情和新闻只能作为线索，不构成投资建议。";
  return "没有可靠来源时，只输出来源地图、核验入口和下一步接入方案。";
}
