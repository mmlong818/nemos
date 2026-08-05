export type SourceReliability =
  | "official-live"
  | "official-static"
  | "platform-live"
  | "merchant-page"
  | "community"
  | "general-web"
  | "manual-verification";

export interface SourceConnector {
  id: string;
  label: string;
  domains: string[];
  sourceTypes: SourceReliability[];
  accessNeeds: string[];
  realtimeRisk: string;
  evidenceRules: string[];
  nextIntegration: string;
  terms: string[];
}

export interface SourceConnectorMatch {
  connector: SourceConnector;
  score: number;
}

const CONNECTORS: SourceConnector[] = [
  {
    id: "travel-rail",
    label: "Train and rail queries",
    domains: ["rail", "train", "route", "ticket"],
    sourceTypes: ["official-live", "platform-live", "manual-verification"],
    accessNeeds: ["Official railway endpoint or a trusted ticketing provider", "Departure, destination, date, passenger constraints"],
    realtimeRisk: "Timetables are stable enough for planning, but seats, prices, delays, and remaining tickets are live data.",
    evidenceRules: [
      "Use official railway inventory or clearly mark live seats/prices as unverified.",
      "Record query time, route, date, train number, duration, and transfer assumptions.",
    ],
    nextIntegration: "Realtime rail adapters are outside product scope; return verification boundaries and official entry points only.",
    terms: ["train", "rail", "ticket", "fare", "seat", "schedule", "12306", "火车", "高铁", "动车", "列车", "车次", "余票", "票价"],
  },
  {
    id: "travel-flight",
    label: "Flight and airport queries",
    domains: ["flight", "airport", "airline", "ticket"],
    sourceTypes: ["official-live", "platform-live", "manual-verification"],
    accessNeeds: ["Airline, airport, OTA, or aviation data API", "Route, date, cabin, baggage, refund/change constraints"],
    realtimeRisk: "Flight prices, seats, and delay status change quickly and must be timestamped.",
    evidenceRules: [
      "Prefer airline or airport data for schedules and status.",
      "Treat OTA snippets as leads unless the result includes live query time and fare conditions.",
    ],
    nextIntegration: "Realtime flight adapters are outside product scope; return verification boundaries and official entry points only.",
    terms: ["flight", "airline", "airport", "fare", "ticket", "delay", "航班", "机票", "机场", "航空", "起飞", "到达", "延误"],
  },
  {
    id: "hotel-booking",
    label: "Hotel and stay planning",
    domains: ["hotel", "stay", "booking", "location"],
    sourceTypes: ["platform-live", "merchant-page", "community", "manual-verification"],
    accessNeeds: ["Booking platform, hotel official site, map/review service", "City, dates, budget, room type, location constraints"],
    realtimeRisk: "Room status, exact price, taxes, cancellation policy, and availability are live and provider-specific.",
    evidenceRules: [
      "Separate stable facts such as location and facilities from live facts such as room status and total price.",
      "Include platform, query time, cancellation terms, and whether direct confirmation is still needed.",
    ],
    nextIntegration: "Realtime hotel adapters are outside product scope; return verification boundaries and direct-confirmation entry points only.",
    terms: ["hotel", "stay", "booking", "room", "availability", "酒店", "民宿", "订房", "房态", "入住", "退房", "位置", "评分"],
  },
  {
    id: "restaurant-booking",
    label: "Restaurant discovery and booking",
    domains: ["restaurant", "food", "reservation", "local"],
    sourceTypes: ["merchant-page", "platform-live", "community", "manual-verification"],
    accessNeeds: ["Map/review service, restaurant official account/site, reservation platform", "Area, time, party size, cuisine, budget"],
    realtimeRisk: "Opening hours, queue status, tables, menus, and prices can be stale outside live platform or direct phone confirmation.",
    evidenceRules: [
      "Distinguish review popularity from actual availability.",
      "For booking decisions, include phone/official account/booking entry and a verification status.",
    ],
    nextIntegration: "Realtime restaurant adapters are outside product scope; return verification boundaries and direct-confirmation entry points only.",
    terms: ["restaurant", "food", "menu", "booking", "reservation", "餐厅", "餐馆", "饭店", "菜单", "营业时间", "排队", "订座", "电话"],
  },
  {
    id: "market-briefing",
    label: "Market and securities briefings",
    domains: ["market", "stocks", "finance", "risk"],
    sourceTypes: ["official-static", "platform-live", "general-web"],
    accessNeeds: ["HKEX official disclosure search", "Timestamped third-party quote snapshot", "Ticker list, time window, and risk rules"],
    realtimeRisk: "Quotes, turnover, holdings, and breaking news are time-sensitive and may be delayed by provider.",
    evidenceRules: [
      "Use exchange/company disclosures for official facts.",
      "Label quote delay, data provider, timestamp, and whether it is advice or only a briefing.",
    ],
    nextIntegration: "Implemented: local watchlist, HKEX official announcements, timestamped quote snapshots, and briefing templates.",
    terms: ["stock", "market", "quote", "earnings", "filing", "HKEX", "港股", "股票", "行情", "公告", "财报", "研报", "复盘", "风险"],
  },
  {
    id: "ai-private-feed",
    label: "AI private-feed briefings",
    domains: ["ai", "wechat", "x", "timeline", "briefing"],
    sourceTypes: ["platform-live", "community", "general-web", "manual-verification"],
    accessNeeds: [
      "WeChat private-source inbox or configured watch folder",
      "X Bearer Token for configured public accounts, or OAuth user access token plus user id for home timeline",
      "Account list, query terms, and a time window",
    ],
    realtimeRisk: "WeChat private material is only available when the user imports or watches local files; X timelines require valid API credentials and may be rate-limited or plan-limited.",
    evidenceRules: [
      "Never claim to have read WeChat groups or X timeline unless the connector returned fresh items.",
      "Separate user-provided private material from public proof.",
      "Cross-check important X/WeChat claims with official announcements, papers, repositories, company blogs, or public product pages.",
    ],
    nextIntegration: "Configure private source inboxes and X API tokens, then inject the collected posts/files into scheduled briefings.",
    terms: ["AI圈", "AI 新闻", "模型", "开源", "微信", "公众号", "私域", "X", "Twitter", "推特", "timeline", "时间线", "重要事件", "简报"],
  },
  {
    id: "source-discovery",
    label: "New-domain source discovery",
    domains: ["source", "verification", "unknown-domain"],
    sourceTypes: ["official-static", "official-live", "platform-live", "merchant-page", "community", "general-web"],
    accessNeeds: ["Domain description, data type, freshness requirement, acceptable proof level"],
    realtimeRisk: "Unknown until the source class is identified.",
    evidenceRules: [
      "Rank source classes before answering exact facts.",
      "If no reliable live source is accessible, return verification entry points instead of a claimed answer.",
    ],
    nextIntegration: "Create a dedicated connector once the repeated domain and reliable source class are clear.",
    terms: ["source", "verify", "official", "reliable", "api", "来源", "信息源", "数据源", "核验", "官方", "可靠", "接入"],
  },
];

export function listSourceConnectors(): SourceConnector[] {
  return CONNECTORS.map((item) => ({ ...item, terms: [...item.terms], sourceTypes: [...item.sourceTypes], accessNeeds: [...item.accessNeeds], evidenceRules: [...item.evidenceRules] }));
}

export function matchSourceConnectors(input: string, limit = 3): SourceConnectorMatch[] {
  const text = input.toLowerCase();
  const scored = CONNECTORS.map((connector) => {
    let score = 0;
    for (const term of connector.terms) {
      if (text.includes(term.toLowerCase())) score += term.length >= 3 ? 2 : 1;
    }
    return { connector, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const fallback = CONNECTORS.find((item) => item.id === "source-discovery")!;
    return [{ connector: fallback, score: 1 }];
  }
  return scored.slice(0, Math.max(1, limit));
}

export function buildSourceConnectorGuide(input: string): string {
  const matches = matchSourceConnectors(input);
  return [
    "Source connector guidance:",
    ...matches.map(({ connector }) => [
      `- ${connector.id}: ${connector.label}`,
      `  source types: ${connector.sourceTypes.join(", ")}`,
      `  realtime risk: ${connector.realtimeRisk}`,
      `  evidence rules: ${connector.evidenceRules.join(" ")}`,
      `  next integration: ${connector.nextIntegration}`,
    ].join("\n")),
  ].join("\n");
}
