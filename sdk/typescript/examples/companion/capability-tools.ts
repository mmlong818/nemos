import type { AgentTool, AgentToolEffect } from "../../src/index.js";
import { buildSourceConnectorGuide, listSourceConnectors, matchSourceConnectors } from "./source-connectors.js";
import { buildSourceVerificationReport, createSourceFreshnessReceipt, sourceVerificationPromptBlock, type SourceFreshnessReceipt } from "./source-verification.js";
import { buildMarketSnapshotText, createMarketDataAdapter, type MarketDataAdapter } from "./market-data-adapter.js";

export interface CapabilityToolContext {
  dataDir: string;
  personaId?: string;
  instruction?: string;
  signal?: AbortSignal;
}

export interface CapabilityToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
  checkedAt: string;
  needsVerification?: boolean;
  freshness?: SourceFreshnessReceipt;
}

export interface CapabilityTool {
  id: string;
  name: string;
  description: string;
  toolset: string;
  requires?: string[];
  inputSchema?: Record<string, unknown>;
  effect?: AgentToolEffect;
  timeoutMs?: number;
  check?: () => boolean;
  run?: (args: Record<string, unknown>, context: CapabilityToolContext) => Promise<CapabilityToolResult>;
}

export interface CapabilityToolSummary {
  id: string;
  name: string;
  description: string;
  toolset: string;
  available: boolean;
  requires: string[];
}

export class CapabilityToolRegistry {
  private readonly tools = new Map<string, CapabilityTool>();

  constructor(private readonly context: CapabilityToolContext) {}

  register(tool: CapabilityTool): void {
    this.tools.set(tool.id, tool);
  }

  list(): CapabilityToolSummary[] {
    return [...this.tools.values()]
      .sort((a, b) => a.toolset.localeCompare(b.toolset) || a.id.localeCompare(b.id))
      .map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        toolset: tool.toolset,
        available: this.isAvailable(tool),
        requires: tool.requires ?? [],
      }));
  }

  listAvailableForInstruction(instruction: string): CapabilityToolSummary[] {
    const matchedConnectors = new Set(matchSourceConnectors(instruction).map((item) => item.connector.id));
    return this.list().filter((tool) => {
      if (tool.toolset !== "source") return tool.available;
      if (tool.id === "source.discovery") return true;
      return matchedConnectors.has(tool.id.replace(/^source\./, ""));
    });
  }

  buildPromptBlock(instruction: string): string {
    const tools = this.listAvailableForInstruction(instruction);
    const toolLines = tools.length
      ? tools.map((tool) => `- ${tool.id} [${tool.available ? "available" : "not configured"}]: ${tool.description}`).join("\n")
      : "- no configured backend tools";
    return [
      "Backend capability tools:",
      toolLines,
      "",
      buildSourceConnectorGuide(instruction),
      "",
      "Tool policy:",
      "- Prefer structured source connectors over generic web snippets for live prices, inventory, schedules, booking slots, and market data.",
      "- If a required connector is not configured, state the missing connector and provide the best verification entry point instead of inventing a confirmed result.",
      "- For OCR, document conversion, meeting minutes, and article polishing, preserve source facts and clearly mark missing attachments, unreadable text, unsupported binary conversion, or uncertain speaker attribution.",
      "- Save the final deliverable in the requested artifact format.",
    ].join("\n");
  }

  toAgentTools(instruction: string): AgentTool[] {
    const sourceMatches = matchSourceConnectors(instruction);
    const includeDiscovery = sourceMatches.some((item) => item.connector.id !== "source-discovery")
      || /(来源|查证|核实|验证|可靠数据|source|verify)/i.test(instruction);
    const available = new Set(
      this.listAvailableForInstruction(instruction)
        .filter((tool) => tool.available && (tool.id !== "source.discovery" || includeDiscovery))
        .map((tool) => tool.id),
    );
    return [...this.tools.values()]
      .filter((tool) => available.has(tool.id) && !!tool.run)
      .map((tool) => ({
        definition: {
          name: capabilityAgentToolName(tool.id),
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
          effect: tool.effect ?? "read",
          timeoutMs: tool.timeoutMs,
        },
        execute: async (args, context) => {
          const result = await this.run(tool.id, args, {
            instruction,
            signal: context.signal,
          });
          return {
            content: result.text,
            isError: !result.ok,
            data: {
              checkedAt: result.checkedAt,
              needsVerification: result.needsVerification,
              result: result.data,
            },
          };
        },
      }));
  }

  async run(id: string, args: Record<string, unknown>, context: Partial<CapabilityToolContext> = {}): Promise<CapabilityToolResult> {
    const tool = this.tools.get(id);
    if (!tool) {
      return { ok: false, text: `Unknown capability tool: ${id}`, checkedAt: new Date().toISOString(), needsVerification: true };
    }
    if (!this.isAvailable(tool)) {
      return {
        ok: false,
        text: `Capability tool is not configured: ${id}`,
        checkedAt: new Date().toISOString(),
        needsVerification: true,
      };
    }
    if (!tool.run) {
      return {
        ok: false,
        text: `Capability tool has no direct runner: ${id}`,
        checkedAt: new Date().toISOString(),
        needsVerification: true,
      };
    }
    if (context.signal?.aborted) {
      return {
        ok: false,
        text: "Capability tool call was cancelled",
        checkedAt: new Date().toISOString(),
      };
    }
    return tool.run(args, { ...this.context, ...context });
  }

  private isAvailable(tool: CapabilityTool): boolean {
    try {
      return tool.check ? tool.check() : true;
    } catch {
      return false;
    }
  }
}

export function capabilityAgentToolName(id: string): string {
  return `capability_${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

export function createDefaultCapabilityToolRegistry(
  dataDir: string,
  checks: {
    hasLiveSearch: () => boolean;
    hasVision: () => boolean;
    hasVoice: () => boolean;
    runLiveSearch?: (query: string, signal?: AbortSignal) => Promise<Array<{ title: string; content: string; url: string }>>;
    marketData?: MarketDataAdapter;
  },
): CapabilityToolRegistry {
  const registry = new CapabilityToolRegistry({ dataDir });
  const marketData = checks.marketData ?? createMarketDataAdapter({ dataDir });

  registry.register({
    id: "web.search",
    name: "Web search",
    description: "General web search for current or source-sensitive facts; use as leads unless sources are authoritative.",
    toolset: "web",
    requires: ["ZHIPU_API_KEY"],
    check: checks.hasLiveSearch,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "需要联网搜索的问题或关键词" } },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    timeoutMs: 30_000,
    run: checks.runLiveSearch ? async (args, context) => {
      const query = String(args.query || "").trim();
      if (!query) return { ok: false, text: "搜索词不能为空", checkedAt: new Date().toISOString(), needsVerification: true };
      try {
        const items = await checks.runLiveSearch!(query, context.signal);
        const checkedAt = new Date().toISOString();
        return {
          ok: true,
          checkedAt,
          text: items.length
            ? [`Search checked at: ${checkedAt}`, ...items.map((item, index) => `[${index + 1}] ${item.title}\n${item.content.slice(0, 500)}\n${item.url}`)].join("\n\n")
            : "没有找到相关结果",
          data: { query, items },
          needsVerification: items.length === 0,
        };
      } catch (error) {
        return {
          ok: false,
          checkedAt: new Date().toISOString(),
          text: error instanceof Error ? error.message : String(error),
          needsVerification: true,
        };
      }
    } : undefined,
  });

  registry.register({
    id: "web.read",
    name: "Webpage reading",
    description: "Read public webpage URLs provided by the user and inject the extracted page text into any persona or group chat context.",
    toolset: "web",
  });

  registry.register({
    id: "vision.analyze",
    name: "Vision analysis",
    description: "Read user-provided images and screenshots before producing a task result.",
    toolset: "vision",
    requires: ["ZHIPU_API_KEY"],
    check: checks.hasVision,
  });

  registry.register({
    id: "ocr.extract",
    name: "OCR extraction",
    description: "Extract text, tables, fields, and uncertain areas from user-provided images or screenshots.",
    toolset: "document",
    requires: ["ZHIPU_API_KEY"],
    check: checks.hasVision,
  });

  registry.register({
    id: "document.convert",
    name: "Document conversion",
    description: "Convert or reorganize text, Markdown, HTML, JSON, or document drafts into the requested artifact format.",
    toolset: "document",
  });

  registry.register({
    id: "meeting.minutes",
    name: "Meeting minutes",
    description: "Turn transcripts, notes, or chat logs into meeting minutes, decisions, action items, risks, and follow-up drafts.",
    toolset: "document",
  });

  registry.register({
    id: "group.progress",
    name: "Group progress tracking",
    description: "Extract progress, blockers, owners, decisions, and follow-up reminders from group chats or project updates.",
    toolset: "document",
  });

  registry.register({
    id: "writing.polish",
    name: "Article polishing",
    description: "Polish, rewrite, proofread, and structurally improve articles while preserving facts and intent.",
    toolset: "writing",
  });

  registry.register({
    id: "voice.io",
    name: "Voice input and output",
    description: "Transcribe voice messages and speak short companion replies.",
    toolset: "voice",
    requires: ["ZHIPU_API_KEY"],
    check: checks.hasVoice,
  });

  registry.register({
    id: "source.discovery",
    name: "Source discovery",
    description: "Classify a new task domain, rank reliable source classes, and decide what still needs live verification.",
    toolset: "source",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "需要查证或选择可靠来源的问题" } },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    timeoutMs: 10_000,
    run: async (args) => {
      const query = String(args.query ?? args.instruction ?? "").trim();
      const report = buildSourceVerificationReport(query);
      const matches = matchSourceConnectors(query);
      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        text: sourceVerificationPromptBlock(report) || buildSourceConnectorGuide(query),
        data: { matches: matches.map((item) => ({ id: item.connector.id, score: item.score })), report },
        needsVerification: report.status !== "live-adapter-ready",
        freshness: report.freshnessReceipt,
      };
    },
  });

  for (const connector of listSourceConnectors()) {
    if (connector.id === "source-discovery") continue;
    if (connector.id === "market-briefing") {
      registry.register({
        id: "source.market-briefing",
        name: "港股公告与行情快照",
        description: "读取本机关注列表或指定港股代码，返回港交所官方公告和带查询时间的第三方行情快照。",
        toolset: "source",
        inputSchema: {
          type: "object",
          properties: {
            symbols: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
              description: "港股代码，例如 00700、09988；不传时使用本机关注列表",
            },
            announcementLimit: {
              type: "number",
              minimum: 1,
              maximum: 10,
              description: "每只股票返回的最新公告数量",
            },
          },
          additionalProperties: false,
        },
        effect: "read",
        timeoutMs: 60_000,
        run: async (args, context) => {
          try {
            const snapshot = await marketData.snapshot({
              symbols: Array.isArray(args.symbols) ? args.symbols.map(String) : undefined,
              announcementLimit: Number(args.announcementLimit || 3),
            }, context.signal);
            const text = buildMarketSnapshotText(snapshot);
            const hasResults = snapshot.symbols.some((item) => item.quote || item.announcements.length > 0);
            return {
              ok: true,
              checkedAt: snapshot.queriedAt,
              text,
              data: snapshot,
              needsVerification: snapshot.symbols.some((item) => !item.quote || item.errors.length > 0),
              freshness: createSourceFreshnessReceipt({
                availability: hasResults ? "available" : "no-results",
                content: hasResults ? text : undefined,
                checkedAt: new Date(snapshot.queriedAt),
              }),
            };
          } catch (error) {
            return {
              ok: false,
              checkedAt: new Date().toISOString(),
              text: error instanceof Error ? error.message : String(error),
              needsVerification: true,
              freshness: createSourceFreshnessReceipt({ availability: "network-failure" }),
            };
          }
        },
      });
      continue;
    }
    registry.register({
      id: `source.${connector.id}`,
      name: connector.label,
      description: `${connector.label}: ${connector.realtimeRisk}`,
      toolset: "source",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
      timeoutMs: 10_000,
      run: async () => {
        const report = buildSourceVerificationReport(connector.terms.join(" "));
        return {
          ok: true,
          checkedAt: new Date().toISOString(),
          text: sourceVerificationPromptBlock(report),
          data: { connector, report },
          needsVerification: report.status !== "live-adapter-ready",
          freshness: report.freshnessReceipt,
        };
      },
    });
  }

  return registry;
}
