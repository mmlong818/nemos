// system 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { Type } from "typebox";
import { bundledCapabilityPluginCatalog, spawnsUnsandboxedProcess, type BundledCapabilityPluginId } from "../bundled-capability-plugins.js";
import { syncSettingsSummary } from "../data-sync.js";
import { buildReviewQueue, capabilityPackStatuses, groupReviewQueue } from "../product-platform.js";
import { type ProductReviewIssue } from "../product-review-runs.js";
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { platformConnectorStatuses } from "../product-platform.js";
import type { DeliveryRecord } from "../delivery-outbox.js";
import type { AgentExtensionManifest, AgentExtensionProvider } from "../../../src/index.js";
import type { CompanionEngine } from "../engine.js";
import { AgentExtensionRegistry, AgentUserActionGateway, FileAgentApprovalStore, FileAgentJobQueue } from "../../../src/index.js";
import { CapabilityRuntime } from "../capabilities.js";
import { applyPendingDataRestore, type DataSyncStoredSettings } from "../data-sync.js";
import { KnowledgeLibrary } from "../knowledge-library.js";
import { FileLlmCallLedger } from "../llm-call-ledger.js";
import { PersonalWorkStore } from "../personal-work.js";
import { ProductReviewRunStore } from "../product-review-runs.js";
import { RelationshipMemory } from "../relationship-memory.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface SystemDeps {
  readonly APP_MANIFEST: Record<string, unknown>;
  readonly MANIFEST_FILE: string;
  readonly MEMORY_CORE_INFO: Record<string, unknown>;
  readonly UNSANDBOXED_NOTICE_FILE: string;
  readonly USER: string;
  readonly agentApprovalStore: FileAgentApprovalStore;
  readonly agentExtensions: AgentExtensionRegistry;
  readonly agentJobQueue: FileAgentJobQueue;
  readonly agentUserActions: AgentUserActionGateway;
  readonly capabilities: CapabilityRuntime;
  readonly createExtensionProvider: (manifest: AgentExtensionManifest) => AgentExtensionProvider | undefined;
  readonly currentPlatformConnectors: () => ReturnType<typeof platformConnectorStatuses>;
  readonly jobWithDelivery: (job: NonNullable<ReturnType<FileAgentJobQueue["get"]>>) => NonNullable<ReturnType<FileAgentJobQueue["get"]>> & { delivery: DeliveryRecord | null; llmCallLedgerAssociated: false };
  readonly knowledgeLibrary: KnowledgeLibrary;
  readonly listAgentRuns: (limit: number) => Array<{
    runId: string;
    status: string;
    updatedAt?: string;
    error?: string;
    resumable?: boolean;
    metadata?: Record<string, string>;
  }>;
  readonly llmCallLedger: FileLlmCallLedger;
  readonly memoryConsolidationStatus: () => ReturnType<CompanionEngine["memoryConsolidationState"]> | { unavailable: true };
  readonly modelConnectionStatus: () => Record<string, unknown>;
  readonly pendingSyncRestore: ReturnType<typeof applyPendingDataRestore>;
  readonly personalWork: PersonalWorkStore;
  readonly productReviewRuns: ProductReviewRunStore;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly readDataSyncSettings: () => DataSyncStoredSettings;
  readonly relationships: RelationshipMemory;
  readonly saveDataSyncSettings: (input: { mode?: string; endpoint?: string; userId?: string; token?: string; passphrase?: string }) => DataSyncStoredSettings;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  readonly unsandboxedNotice: () => { items: Array<{ id: string; name: string; version: string }>; acknowledged: boolean };
  // TSC_DEPS
}

export function createSystemRoutes(deps: SystemDeps): RouteEntry[] {
  const { APP_MANIFEST, MANIFEST_FILE, MEMORY_CORE_INFO, UNSANDBOXED_NOTICE_FILE, USER, agentApprovalStore, agentExtensions, agentJobQueue, agentUserActions, capabilities, createExtensionProvider, currentPlatformConnectors, jobWithDelivery, knowledgeLibrary, listAgentRuns, llmCallLedger, memoryConsolidationStatus, modelConnectionStatus, pendingSyncRestore, personalWork, productReviewRuns, readBody, readDataSyncSettings, relationships, saveDataSyncSettings, send, unsandboxedNotice } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("GET", "/api/health", ({ res }) => {
      send(res, 200, { ok: true });
      return;
    }),
    route("GET", "/api/llm", ({ res }) => {
      send(res, 200, modelConnectionStatus());
      return;
    }),
    route("GET", "/api/version", ({ res }) => {
      send(res, 200, {
        manifest: APP_MANIFEST,
        memoryCore: MEMORY_CORE_INFO,
        manifestFile: MANIFEST_FILE,
      });
      return;
    }),
    route("GET", "/api/llm-calls", ({ res, url }) => {
      const query = new URLSearchParams(url.split("?")[1] || "");
      const taskId = query.get("taskId") || undefined;
      const runId = query.get("runId") || undefined;
      const limit = Number(query.get("limit") || 50);
      // Read-only operational metadata: never expose prompts, outputs, endpoints, credentials or price guesses.
      send(res, 200, {
        ok: true,
        calls: llmCallLedger.list({ taskId, runId, limit }),
        summary: llmCallLedger.summarize({ taskId, runId }),
      });
      return;
    }),
    route("GET", "/api/unsandboxed-notice", ({ res }) => {
      send(res, 200, { ok: true, ...unsandboxedNotice() });
      return;
    }),
    route("POST", "/api/unsandboxed-notice/acknowledge", ({ res }) => {
      const notice = unsandboxedNotice();
      const keys = [...new Set(notice.items.map((item) => `${item.id}@${item.version}`))];
      const temp = `${UNSANDBOXED_NOTICE_FILE}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(keys, null, 2), "utf8");
      renameSync(temp, UNSANDBOXED_NOTICE_FILE);
      send(res, 200, { ok: true, acknowledged: keys });
      return;
    }),
    route("GET", "/api/data-sync", ({ res }) => {
      send(res, 200, { ok: true, settings: syncSettingsSummary(readDataSyncSettings()), pendingRestoreApplied: pendingSyncRestore });
      return;
    }),
    route("POST", "/api/data-sync/settings",
      Type.Object({ mode: Type.Optional(Type.String()), endpoint: Type.Optional(Type.String()), userId: Type.Optional(Type.String()), token: Type.Optional(Type.String()), passphrase: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const action = await agentUserActions.execute({
        name: "data_sync_settings_update",
        description: "保存用户选择的本地或自托管服务器数据模式",
        arguments: { mode: body.mode, endpointProvided: Boolean(body.endpoint), tokenUpdated: Boolean(body.token), passphraseUpdated: Boolean(body.passphrase) },
        execute: () => saveDataSyncSettings(body),
        summarizeResult: (settings) => ({ ok: true, mode: settings.mode, endpoint: settings.endpoint }),
      });
      send(res, 200, { ok: true, settings: syncSettingsSummary(action.value), auditRunId: action.runId });
      return;
    }),
    route("GET", "/api/platform/readiness", ({ res }) => {
      const extensions = agentExtensions.list();
      const snapshot = capabilities.snapshot();
      send(res, 200, {
        ok: true,
        connectors: currentPlatformConnectors(),
        capabilityPacks: capabilityPackStatuses(snapshot.abilities, snapshot.artifacts),
        bundledPlugins: bundledCapabilityPluginCatalog({
          packageRoot: resolve(__dirname, "..", ".."),
          installedIds: extensions.map((item) => item.manifest.id),
          installedManifests: extensions.map((item) => item.manifest),
        }).map(({ manifest: _manifest, ...item }) => item),
      });
      return;
    }),
    route("POST", "/api/platform/bundled-plugin/install", async ({ req, res }) => {
      const body = (await readBody(req)) as { id?: BundledCapabilityPluginId; confirmExecutable?: boolean };
      const catalog = bundledCapabilityPluginCatalog({
        packageRoot: resolve(__dirname, "..", ".."),
        installedIds: agentExtensions.list().map((item) => item.manifest.id),
        installedManifests: agentExtensions.list().map((item) => item.manifest),
      });
      const item = catalog.find((candidate) => candidate.id === body.id);
      if (!item) { send(res, 400, { error: "未知的内置能力插件。" }); return; }
      if (item.installed) { send(res, 409, { error: "这个能力插件已经安装。" }); return; }
      if (!item.installable) { send(res, 409, { error: item.reason || "这个能力插件当前无法安装。" }); return; }
      // 无沙箱的可执行扩展必须由用户确认，而且确认文案要说清它是无沙箱的。
      // 原来这里只说"会启动隔离的 Chrome 进程"，用户确认的是一件风险没被说明的事；
      // 而下面的 allowUnsandboxed 曾按插件 id 硬编码豁免，等于代码替用户做了决定。
      const needsUnsandboxed = spawnsUnsandboxedProcess(item.manifest);
      if (needsUnsandboxed && body.confirmExecutable !== true) {
        send(res, 409, {
          error: `${item.name} 会启动本机进程，并且不在扩展沙箱内运行：它对文件和网络的访问不受读写路径与网络策略限制。确认后才会安装。`,
          requiresConfirmation: true,
          unsandboxed: true,
        });
        return;
      }
      const action = await agentUserActions.execute({
        name: "bundled_capability_plugin_install",
        description: `安装小丑鱼内置能力插件：${item.name}`,
        arguments: { pluginId: item.id, permissions: item.manifest.permissions },
        execute: () => agentExtensions.install(
          item.manifest,
          createExtensionProvider(item.manifest),
          // 由这次请求带来的用户确认决定，不再按插件 id 豁免。
          { allowUnsandboxed: needsUnsandboxed && body.confirmExecutable === true },
        ),
        summarizeResult: (extension) => ({ extensionId: extension.manifest.id, enabled: extension.enabled }),
      });
      send(res, 200, { ok: true, extension: action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/platform/connector/test",
      Type.Object({ id: Type.Optional(Type.Union([Type.Literal("files"), Type.Literal("browser"), Type.Literal("github"), Type.Literal("email"), Type.Literal("calendar"), Type.Literal("enterprise-docs")])) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const status = currentPlatformConnectors().find((item) => item.id === body.id);
      if (!status) { send(res, 400, { error: "未知的数据连接。" }); return; }
      if (status.state !== "ready") { send(res, 409, { error: `${status.name}当前不可用。${status.detail}`, connector: status }); return; }
      try {
        if (status.id === "files" && status.provider === "built-in") {
          const items = knowledgeLibrary.list(true);
          send(res, 200, { ok: true, connector: status, toolCount: 1, itemCount: items.length, checkedAt: new Date().toISOString() });
          return;
        }
        if (status.id === "browser" && status.provider === "built-in") {
          send(res, 200, { ok: true, connector: status, toolCount: 1, checkedAt: new Date().toISOString() });
          return;
        }
        const extension = status.extensionId ? agentExtensions.get(status.extensionId) : null;
        const query = [status.purpose, ...(extension?.manifest.activation || [])].join(" ");
        const tools = await agentExtensions.toolsForRequest(query, {
          allow: (tool) => tool.extensionId === status.extensionId && tool.effect === "read",
        });
        if (!tools.length) throw new Error("连接已启用，但没有发现可用的读取工具。");
        send(res, 200, { ok: true, connector: status, toolCount: tools.length, checkedAt: new Date().toISOString(), note: "已发现该连接器的读取工具；账号权限与实际数据访问仍需在使用时验证。" });
      } catch (error) {
        send(res, 502, { error: error instanceof Error ? error.message : String(error), connector: status });
      }
      return;
    }),
    route("GET", "/api/review-queue", ({ res }) => {
      const items = buildReviewQueue({
        approvals: agentApprovalStore.list({ status: "pending", limit: 500 }),
        jobs: agentJobQueue.list({ limit: 500 }).map(jobWithDelivery),
        runs: listAgentRuns(500),
      });
      send(res, 200, {
        ok: true,
        items,
        groups: groupReviewQueue(items),
        relationshipMemory: relationships.getReadStatus(),
        // 自动整合由内核自己触发、不经过应用代码，失败时这里是唯一的观察点。
        // 不放进"需要处理"的话，记忆停止沉淀是完全静默的：用户只会觉得它最近不记事。
        memoryConsolidation: memoryConsolidationStatus(),
        personalReminders: personalWork.reminders(USER),
      });
      return;
    }),
    route("GET", "/api/product-reviews", ({ res }) => {
      send(res, 200, { ok: true, summary: productReviewRuns.summary(), runs: productReviewRuns.list() });
      return;
    }),
    route("POST", "/api/product-reviews", async ({ req, res }) => {
      const body = (await readBody(req)) as {
        round?: number;
        persona?: string;
        scenario?: string;
        route?: string;
        status?: "passed" | "issues" | "blocked";
        observations?: string[];
        issues?: ProductReviewIssue[];
        evidence?: string[];
      };
      if (!body.round || !body.persona || !body.scenario || !body.route || !body.status || !["passed", "issues", "blocked"].includes(body.status)) {
        send(res, 400, { error: "真实检查记录不完整。" });
        return;
      }
      try {
        const run = productReviewRuns.append({
          round: body.round,
          persona: body.persona,
          scenario: body.scenario,
          route: body.route,
          status: body.status,
          observations: Array.isArray(body.observations) ? body.observations : [],
          issues: Array.isArray(body.issues) ? body.issues : [],
          evidence: Array.isArray(body.evidence) ? body.evidence : [],
        });
        send(res, 201, { ok: true, run, summary: productReviewRuns.summary() });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }),
  ];
}
