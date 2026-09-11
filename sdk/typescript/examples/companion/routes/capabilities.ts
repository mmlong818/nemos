// capabilities 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { Type } from "typebox";
import { type CapabilityNotification, type ArtifactFormat, type CapabilityTaskDecision, type CapabilityTaskExpertAssignment, type CapabilityTaskStorylineStatus } from "../capabilities.js";
import { routeCapability } from "../capability-router.js";
import { buildCapabilitySystemRegistry, companionRuntimeToolSummaries } from "../capability-system-registry.js";
import { expertAssignmentPrompt, finalDeliveryPrompt, planExpertTeam } from "../expert-contracts.js";
import { LONG_FORM_EXPERT_IDS } from "../experts.js";
import { APP_PERSONA_ID } from "../identity.js";
import { appendCurrentUiEvidence } from "../ui-evidence.js";
import { AgentUserActionGateway, FileAgentJobQueue } from "../../../src/index.js";
import { BackgroundScheduler } from "../background-scheduler.js";
import { CapabilityRuntime } from "../capabilities.js";
import { type CapabilityExtensionSummary, type CapabilityProviderSummary } from "../capability-system-registry.js";
import { createDefaultCapabilityToolRegistry, type CapabilityToolSummary } from "../capability-tools.js";
import { FileDeliveryOutbox } from "../delivery-outbox.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface CapabilityDeps {
  readonly USER: string;
  readonly WEB_DIR: ReturnType<typeof join>;
  readonly agentJobQueue: FileAgentJobQueue;
  readonly agentUserActions: AgentUserActionGateway;
  readonly autoLearnFromWork: (personaId: string, text: string, capabilityId: string, format: ArtifactFormat) => void;
  readonly backgroundScheduler: BackgroundScheduler;
  readonly capabilities: CapabilityRuntime;
  readonly capabilityExtensionSummaries: () => CapabilityExtensionSummary[];
  readonly capabilityProviderSummaries: () => CapabilityProviderSummary[];
  readonly capabilityReply: (item: CapabilityNotification) => {
    personaId: string;
    name: string;
    reply: string;
    messages: string[];
    artifact: CapabilityNotification["artifact"];
  };
  readonly capabilityTools: ReturnType<typeof createDefaultCapabilityToolRegistry>;
  readonly deliveryOutbox: FileDeliveryOutbox;
  readonly extensionToolSummaries: () => CapabilityToolSummary[];
  readonly fetchSkillMarkdownFromUrl: (url: string, signal?: AbortSignal) => Promise<string>;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  readonly teamConnectionFingerprint: () => string;
  // TSC_DEPS
}

export function createCapabilityRoutes(deps: CapabilityDeps): RouteEntry[] {
  const { USER, WEB_DIR, agentJobQueue, agentUserActions, autoLearnFromWork, backgroundScheduler, capabilities, capabilityExtensionSummaries, capabilityProviderSummaries, capabilityReply, capabilityTools, deliveryOutbox, extensionToolSummaries, fetchSkillMarkdownFromUrl, readBody, send, teamConnectionFingerprint } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("POST", "/api/capability-conversations/archive",
      Type.Object({ taskId: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const task = capabilities.snapshot().tasks.find((item) => item.id === body.taskId && item.oneOff);
      if (!task) { send(res, 404, { error: "找不到这条能力对话" }); return; }
      const running = agentJobQueue.list({ limit: 500 }).some((job) => {
        const result = job.result?.data as { artifact?: { taskId?: string } } | undefined;
        const originTask = capabilities.snapshot().tasks.find((item) => item.origin?.jobId === job.id);
        const linkedTaskId = String(result?.artifact?.taskId || job.payload.continuationTaskId || originTask?.id || "");
        return linkedTaskId === task.id && (job.status === "queued" || job.status === "running");
      });
      if (running) { send(res, 409, { error: "对话仍在执行，完成或取消后才能归档" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_conversation_archive",
        description: "把用户选中的能力对话移入归档",
        arguments: { taskId: task.id },
        execute: () => capabilities.archiveTask(task.id),
        summarizeResult: (value) => ({ ok: true, taskId: value.id, archived: true }),
      });
      send(res, 200, { ok: true, task: action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/capability-conversations/restore",
      Type.Object({ taskId: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const task = capabilities.snapshot().tasks.find((item) => item.id === body.taskId && item.oneOff && item.archivedAt);
      if (!task) { send(res, 404, { error: "找不到这条已归档对话" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_conversation_restore",
        description: "把用户选中的能力对话恢复到首页",
        arguments: { taskId: task.id },
        execute: () => capabilities.restoreTask(task.id),
        summarizeResult: (value) => ({ ok: true, taskId: value.id, archived: false }),
      });
      send(res, 200, { ok: true, task: action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/capability-conversations/delete",
      Type.Object({ taskId: Type.Optional(Type.String()), deleteFiles: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const task = capabilities.snapshot().tasks.find((item) => item.id === body.taskId && item.oneOff);
      if (!task) { send(res, 404, { error: "找不到这条能力对话" }); return; }
      if (!task.archivedAt) { send(res, 409, { error: "只有归档中的对话可以删除" }); return; }
      const jobIds = agentJobQueue.list({ limit: 500 }).filter((job) => {
        const result = job.result?.data as { artifact?: { taskId?: string } } | undefined;
        const originTask = capabilities.snapshot().tasks.find((item) => item.origin?.jobId === job.id);
        return String(result?.artifact?.taskId || job.payload.continuationTaskId || originTask?.id || "") === task.id;
      }).map((job) => job.id);
      const action = await agentUserActions.execute({
        name: "capability_conversation_delete",
        description: "删除用户在归档中选中的能力对话，并按选择保留或删除产出文件",
        arguments: { taskId: task.id, deleteFiles: !!body.deleteFiles },
        execute: () => {
          const capabilityData = capabilities.deleteTaskData([task.id], { keepFiles: !body.deleteFiles });
          const deliveries = deliveryOutbox.deleteBySources("agent-job", jobIds);
          const jobs = agentJobQueue.deleteMany(jobIds);
          return { jobs, tasks: capabilityData.tasks, artifacts: capabilityData.artifacts, deliveries };
        },
        summarizeResult: (value) => ({ ok: true, ...value }),
      });
      send(res, 200, { ok: true, deleted: action.value, auditRunId: action.runId });
      return;
    }),
    route("GET", "/api/capabilities", ({ res }) => {
      send(res, 200, capabilities.snapshot());
      return;
    }),
    route("POST", "/api/capabilities/route",
      Type.Object({ goal: Type.Optional(Type.String()), materialNames: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
      ({ res }, body) => {
      send(res, 200, {
        ok: true,
        route: routeCapability({
          goal: String(body.goal || ""),
          materialNames: Array.isArray(body.materialNames) ? body.materialNames.slice(0, 20).map(String) : [],
        }),
      });
      return;
    }),
    route("GET", "/api/capabilities/tools", ({ res }) => {
      const snap = capabilities.snapshot();
      send(res, 200, { tools: snap.tools, sourceConnectors: snap.sourceConnectors });
      return;
    }),
    route("GET", "/api/capabilities/registry", ({ res }) => {
      const snap = capabilities.snapshot();
      send(res, 200, buildCapabilitySystemRegistry({
        tools: capabilityTools,
        additionalTools: [...companionRuntimeToolSummaries(), ...extensionToolSummaries()],
        abilities: snap.abilities,
        providers: capabilityProviderSummaries(),
        extensions: capabilityExtensionSummaries(),
      }));
      return;
    }),
    route("GET", "/api/capabilities/roadmap", ({ res }) => {
      send(res, 200, capabilities.snapshot().roadmap);
      return;
    }),
    route("GET", "/api/capabilities/intakes", ({ res }) => {
      send(res, 200, { intakes: capabilities.snapshot().recentIntakes });
      return;
    }),
    route("GET", "/api/capabilities/skills/audit", ({ res }) => {
      const audit = capabilities.auditSkills();
      send(res, 200, {
        ...audit,
        items: audit.items.map(({ sourceUrl, ...item }) => ({ ...item, canUpdate: Boolean(sourceUrl) })),
      });
      return;
    }),
    route("POST", "/api/capabilities/ability/state",
      Type.Object({ id: Type.Optional(Type.String()), action: Type.Optional(Type.Union([Type.Literal("pin"), Type.Literal("unpin"), Type.Literal("disable"), Type.Literal("enable"), Type.Literal("stale"), Type.Literal("refresh")])) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const actions = ["pin", "unpin", "disable", "enable", "stale", "refresh"] as const;
      if (!body.id || !body.action || !actions.includes(body.action)) {
        send(res, 400, { error: "能力状态参数不完整" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "capability_ability_state",
        description: "更新用户选中能力的固定、停用或陈旧状态",
        arguments: { abilityId: body.id, action: body.action },
        execute: () => capabilities.setAbilityLifecycle(body.id!, body.action!),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id, action: body.action }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/artifact/feedback",
      Type.Object({ id: Type.Optional(Type.String()), outcome: Type.Optional(Type.Union([Type.Literal("useful"), Type.Literal("needs-work")])), note: Type.Optional(Type.String()), applyToSkill: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      if (!body.id || (body.outcome !== "useful" && body.outcome !== "needs-work")) {
        send(res, 400, { error: "结果反馈参数不完整" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "capability_artifact_feedback",
        description: "记录用户对能力结果的验证反馈，并按明确选择写回技能",
        arguments: { artifactId: body.id, outcome: body.outcome, applyToSkill: Boolean(body.applyToSkill), noteChars: body.note?.length || 0 },
        execute: () => capabilities.recordArtifactFeedback({
          artifactId: body.id!,
          outcome: body.outcome!,
          note: body.note,
          applyToSkill: Boolean(body.applyToSkill),
        }),
        summarizeResult: (value) => ({ ok: true, artifactId: value.artifact.id, applied: value.applied }),
      });
      send(res, 200, { ok: true, applied: action.value.applied, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/search", async ({ req, res }) => {
      const b = (await readBody(req)) as { query?: string; limit?: number; kinds?: Array<"artifact" | "ability" | "task" | "intake"> };
      if (!b.query || !b.query.trim()) { send(res, 400, { error: "missing query" }); return; }
      send(res, 200, capabilities.searchLocal({ query: b.query, limit: b.limit, kinds: b.kinds }));
      return;
    }),
    route("POST", "/api/capabilities/ability/archive", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing ability id" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_ability_archive",
        description: "归档用户在能力管理页选中的能力",
        arguments: { abilityId: b.id },
        execute: () => capabilities.archiveAbility(b.id!),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id, archived: true }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/ability/restore", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing ability id" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_ability_restore",
        description: "恢复用户在能力管理页选中的能力",
        arguments: { abilityId: b.id },
        execute: () => capabilities.restoreAbility(b.id!),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id, archived: false }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/ability/update", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        id?: string;
        name?: string;
        description?: string;
        defaultFormat?: ArtifactFormat;
        prompt?: string;
      };
      if (!b.id) { send(res, 400, { error: "missing ability id" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_ability_update",
        description: "保存用户在能力管理页编辑的能力",
        arguments: {
          abilityId: b.id,
          name: b.name,
          description: b.description,
          defaultFormat: b.defaultFormat,
          promptUpdated: b.prompt !== undefined,
        },
        execute: () => capabilities.updateGeneratedAbility({
          id: b.id!,
          name: b.name,
          description: b.description,
          defaultFormat: b.defaultFormat,
          prompt: b.prompt,
        }),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/skill/upgrade", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing ability id" }); return; }
      const item = capabilities.auditSkills().items.find((row) => row.abilityId === b.id);
      const ability = capabilities.getAbility(b.id);
      if (!item || !ability || ability.kind !== "generated") {
        send(res, 404, { error: "skill not found" });
        return;
      }
      if (!item.sourceUrl) {
        send(res, 400, { error: "这个 Skill 没有远端 source_url，不能自动更新。" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "skill_upgrade",
        description: "更新用户在 Skill 管理页选中的 Skill",
        arguments: { abilityId: b.id, sourceUrl: item.sourceUrl },
        execute: async (signal) => {
          const sourceText = await fetchSkillMarkdownFromUrl(item.sourceUrl!, signal);
          return capabilities.installSkill({
            personaId: item.personaId === "shared" ? (ability.ownerPersonaId || APP_PERSONA_ID) : item.personaId,
            name: ability.name,
            description: ability.description,
            sourceText,
            sourceUrl: item.sourceUrl,
            defaultFormat: ability.defaultFormat,
          });
        },
        summarizeResult: (updated) => ({ ok: true, abilityId: updated.id, sourceUrl: item.sourceUrl }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/skill/delete", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing ability id" }); return; }
      const action = await agentUserActions.execute({
        name: "skill_delete",
        description: "删除用户在 Skill 管理页选中的 Skill",
        arguments: { abilityId: b.id },
        execute: () => capabilities.deleteGeneratedAbility(b.id!),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id, deleted: true }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/intake", async ({ req, res }) => {
      const b = (await readBody(req)) as { request?: string; format?: ArtifactFormat; persist?: boolean };
      if (!b.request || !b.request.trim()) {
        send(res, 400, { error: "missing request" });
        return;
      }
      if (b.persist === false) {
        const report = capabilities.intakeDemand({
          request: b.request,
          targetFormat: b.format,
          persist: false,
        });
        send(res, 200, { ok: true, report, snapshot: capabilities.snapshot() });
        return;
      }
      const action = await agentUserActions.execute({
        name: "capability_intake_save",
        description: "保存用户提交的新需求分析和能力缺口记录",
        arguments: { requestChars: b.request.length, format: b.format, persist: true },
        execute: () => capabilities.intakeDemand({
          request: b.request!,
          targetFormat: b.format,
          persist: true,
        }),
        summarizeResult: (report) => ({ ok: true, intakeId: report.id, matchedAbilityId: report.matchedAbilities[0]?.abilityId }),
      });
      send(res, 200, { ok: true, report: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/skill/rollback", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing ability id" }); return; }
      const action = await agentUserActions.execute({
        name: "skill_rollback",
        description: "将用户选中的可复用能力恢复到上一个可用版本",
        arguments: { abilityId: b.id },
        execute: () => capabilities.rollbackAbilityVersion(b.id!),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id, rolledBack: true }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("GET", "/api/capabilities/artifact/workspace", ({ res, url }) => {
      const id = new URLSearchParams(url.split("?")[1] || "").get("id");
      const state = capabilities.artifactWorkspace(id);
      if (!state) send(res, 404, { error: "artifact workspace not found" });
      else send(res, 200, { ok: true, state });
      return;
    }),
    route("POST", "/api/capabilities/artifact/workspace",
      Type.Object({ id: Type.Optional(Type.String()), action: Type.Optional(Type.Union([Type.Literal("save"), Type.Literal("version"), Type.Literal("restore")])), current: Type.Optional(Type.Unknown()), versionId: Type.Optional(Type.String()), expectedRevision: Type.Optional(Type.Number()) }, { additionalProperties: false }),
      ({ res }, body) => {
      if (!body.id || !body.action) { send(res, 400, { error: "missing artifact workspace action" }); return; }
      const state = capabilities.updateArtifactWorkspace({ id: body.id, action: body.action, current: body.current, versionId: body.versionId, expectedRevision: body.expectedRevision });
      send(res, 200, { ok: true, state, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/retained-artifact/delete",
      Type.Object({ id: Type.Optional(Type.String()), confirm: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      ({ res }, body) => {
      if (!body.id || body.confirm !== true) { send(res, 400, { error: "需要确认删除保留文件" }); return; }
      if (!capabilities.deleteRetainedArtifact(body.id)) { send(res, 404, { error: "保留文件不存在" }); return; }
      send(res, 200, { ok: true, snapshot: capabilities.snapshot() });
      return;
    }),
    route("GET", "/api/capabilities/artifact/preview", ({ res, url }) => {
      const id = new URLSearchParams(url.split("?")[1] || "").get("id");
      if (!capabilities.previewArtifact(res, id)) send(res, 404, { error: "artifact not found" });
      return;
    }),
    route("GET", "/api/capabilities/artifact/context", ({ res, url }) => {
      const id = new URLSearchParams(url.split("?")[1] || "").get("id");
      const handoff = capabilities.artifactHandoff(id);
      if (!handoff) send(res, 404, { error: "artifact not found" });
      else send(res, 200, { ok: true, artifact: handoff.artifact, text: handoff.text });
      return;
    }),
    route("GET", "/api/capabilities/artifact", ({ res, url }) => {
      const id = new URLSearchParams(url.split("?")[1] || "").get("id");
      const download = new URLSearchParams(url.split("?")[1] || "").get("download") === "1";
      if (!capabilities.sendArtifact(res, id, download ? "attachment" : "inline")) send(res, 404, { error: "artifact not found" });
      return;
    }),
    route("GET", "/api/capabilities/due", ({ res }) => {
      const jobs = agentJobQueue.list({ limit: 1_000 }).filter((job) => job.type === "capability-task" && job.metadata?.scheduled === "true");
      send(res, 200, {
        notifications: [],
        scheduler: backgroundScheduler.status(),
        jobs: jobs.map((job) => ({ id: job.id, status: job.status, taskId: job.payload.taskId })),
      });
      return;
    }),
    route("POST", "/api/capabilities/ability", async ({ req, res }) => {
      const b = (await readBody(req)) as { personaId: string; name: string; description?: string; goal: string; defaultFormat?: ArtifactFormat };
      const action = await agentUserActions.execute({
        name: "capability_ability_create",
        description: "创建用户在能力管理页填写的新能力",
        arguments: {
          personaId: b.personaId,
          name: b.name,
          description: b.description,
          defaultFormat: b.defaultFormat,
          goalChars: b.goal?.length ?? 0,
        },
        metadata: { personaId: b.personaId || APP_PERSONA_ID },
        execute: () => capabilities.createGeneratedAbility(b),
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/skill/install", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        personaId?: string;
        name?: string;
        description?: string;
        sourceText?: string;
        sourcePath?: string;
        sourceUrl?: string;
        defaultFormat?: ArtifactFormat;
      };
      const personaId = b.personaId || APP_PERSONA_ID;
      const sourceUrl = b.sourceUrl || (/^https?:\/\//i.test((b.sourcePath || "").trim()) ? (b.sourcePath || "").trim() : undefined);
      const action = await agentUserActions.execute({
        name: "skill_install",
        description: "安装用户在 Skill 管理页提交的 Skill",
        arguments: {
          personaId,
          name: b.name,
          sourceUrl,
          sourcePath: sourceUrl ? undefined : b.sourcePath,
          sourceTextChars: b.sourceText?.length ?? 0,
          defaultFormat: b.defaultFormat,
        },
        metadata: { personaId },
        execute: async (signal) => {
          const sourceText = sourceUrl && !b.sourceText
            ? await fetchSkillMarkdownFromUrl(sourceUrl, signal)
            : b.sourceText;
          return capabilities.installSkill({
            personaId,
            name: b.name,
            description: b.description,
            sourceText,
            sourcePath: sourceUrl ? undefined : b.sourcePath,
            sourceUrl,
            defaultFormat: b.defaultFormat,
          });
        },
        summarizeResult: (ability) => ({ ok: true, abilityId: ability.id, sourceUrl }),
      });
      send(res, 200, { ok: true, ability: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        id?: string;
        title: string;
        personaId: string;
        capabilityId: string;
        instruction: string;
        format?: ArtifactFormat;
        schedule?: { mode?: "manual" | "daily" | "turns"; time?: string; timezone?: string; days?: number[]; everyTurns?: number };
        enabled?: boolean;
        promote?: boolean;
        spaceId?: string | null;
        knowledgeIds?: string[];
      };
      const action = await agentUserActions.execute({
        name: b.id ? "capability_task_update" : "capability_task_create",
        description: b.id ? "保存用户在任务管理页编辑的任务" : "创建用户在任务管理页填写的新任务",
        arguments: {
          taskId: b.id,
          title: b.title,
          personaId: b.personaId,
          capabilityId: b.capabilityId,
          format: b.format,
          schedule: b.schedule,
          enabled: b.enabled,
          spaceId: b.spaceId,
          knowledgeCount: b.knowledgeIds?.length ?? 0,
          instructionChars: b.instruction?.length ?? 0,
        },
        metadata: { personaId: b.personaId || APP_PERSONA_ID },
        execute: () => b.id ? capabilities.updateTask({ ...b, id: b.id! }) : capabilities.createTask({ ...b, spaceId: b.spaceId ?? undefined }),
        summarizeResult: (task) => ({ ok: true, taskId: task.id }),
      });
      send(res, 200, { ok: true, task: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task/reviewed", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing task id" }); return; }
      try {
        send(res, 200, { ok: true, task: capabilities.markTaskReviewed(b.id) });
      } catch (error) {
        send(res, 404, { error: error instanceof Error ? error.message : "未知任务" });
      }
      return;
    }),
    route("POST", "/api/capabilities/task/resume", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing task id" }); return; }
      // 恢复一个会自己跑的任务是真实动作，走和任务编辑同一条审计路径。
      const action = await agentUserActions.execute({
        name: "capability_task_resume",
        description: "恢复因结果无人查看而自动暂停的计划任务",
        arguments: { taskId: b.id },
        execute: () => capabilities.resumeAutoPausedTask(b.id!),
        summarizeResult: (task) => ({ ok: true, taskId: task.id }),
      });
      send(res, 200, { ok: true, task: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("GET", "/api/capabilities/tasks/awaiting-resume", ({ res }) => {
      send(res, 200, { ok: true, tasks: capabilities.tasksAwaitingResumeDecision() });
      return;
    }),
    route("POST", "/api/capabilities/space", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        id?: string;
        title?: string;
        description?: string;
        status?: "active" | "archived";
      };
      if (!b.id && !b.title?.trim()) { send(res, 400, { error: "missing space title" }); return; }
      const action = await agentUserActions.execute({
        name: b.id ? "capability_space_update" : "capability_space_create",
        description: b.id ? "更新工作空间的名称、说明或归档状态" : "创建用于组织相关任务和结果的工作空间",
        arguments: {
          spaceId: b.id,
          title: b.title,
          descriptionChars: b.description?.length ?? 0,
          status: b.status,
        },
        execute: () => b.id
          ? capabilities.updateSpace({ id: b.id!, title: b.title, description: b.description, status: b.status })
          : capabilities.createSpace({ title: b.title!, description: b.description }),
        summarizeResult: (space) => ({ ok: true, spaceId: space.id, status: space.status }),
      });
      send(res, 200, { ok: true, space: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task/storyline", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        id?: string;
        status?: CapabilityTaskStorylineStatus;
        summary?: string;
        nextAction?: string;
        experts?: CapabilityTaskExpertAssignment[];
      };
      if (!b.id) { send(res, 400, { error: "missing task id" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_task_storyline_update",
        description: "保存长期任务的当前进展、下一步和专家职责",
        arguments: {
          taskId: b.id,
          status: b.status,
          summaryChars: b.summary?.length ?? 0,
          nextActionChars: b.nextAction?.length ?? 0,
          expertCount: b.experts?.length ?? 0,
        },
        execute: () => capabilities.updateTaskStoryline({
          id: b.id!,
          status: b.status,
          summary: b.summary,
          nextAction: b.nextAction,
          experts: b.experts,
        }),
        summarizeResult: (task) => ({ ok: true, taskId: task.id, status: task.storyline.status }),
      });
      send(res, 200, { ok: true, task: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task/decision", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        id?: string;
        text?: string;
        note?: string;
        supersedesId?: string;
        status?: CapabilityTaskDecision["status"];
        evidenceIds?: string[];
        confidence?: number;
        validFrom?: string;
        validUntil?: string;
        producedBy?: CapabilityTaskDecision["producedBy"];
        derivedFrom?: string[];
        sourceFingerprints?: string[];
      };
      if (!b.id || !b.text?.trim()) { send(res, 400, { error: "missing task id or decision" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_task_decision_record",
        description: "记录长期任务的关键决定，并保留被替代结论",
        arguments: {
          taskId: b.id,
          decisionChars: b.text.length,
          noteChars: b.note?.length ?? 0,
          supersedesId: b.supersedesId,
        },
        execute: () => capabilities.recordTaskDecision({
          id: b.id!,
          text: b.text!,
          note: b.note,
          supersedesId: b.supersedesId,
          status: b.status,
          evidenceIds: b.evidenceIds,
          confidence: b.confidence,
          validFrom: b.validFrom,
          validUntil: b.validUntil,
          producedBy: b.producedBy,
          derivedFrom: b.derivedFrom,
          sourceFingerprints: b.sourceFingerprints,
        }),
        summarizeResult: (task) => ({ ok: true, taskId: task.id, decisionCount: task.storyline.decisions.length }),
      });
      send(res, 200, { ok: true, task: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task/delete", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing task id" }); return; }
      const selected = capabilities.snapshot().tasks.find((item) => item.id === b.id);
      if (selected?.oneOff && selected.origin?.kind === "capability" && !selected.archivedAt) {
        send(res, 409, { error: "只有归档中的能力对话可以删除" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "capability_task_delete",
        description: "删除用户在任务管理页选中的任务",
        arguments: { taskId: b.id },
        execute: () => {
          capabilities.deleteTask(b.id!);
          return { taskId: b.id! };
        },
        summarizeResult: (value) => ({ ok: true, taskId: value.taskId, deleted: true }),
      });
      send(res, 200, { ok: true, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task/collaborate", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "缺少任务编号" }); return; }
      const task = capabilities.snapshot().tasks.find((item) => item.id === b.id);
      if (!task) { send(res, 404, { error: "未找到这个任务" }); return; }
      const teamPlan = planExpertTeam({ capabilityId: task.capabilityId, instruction: task.instruction });
      const collaborationObjective = appendCurrentUiEvidence(task.instruction, WEB_DIR);
      const assignments = teamPlan.assignments
        .filter((assignment) => LONG_FORM_EXPERT_IDS.has(assignment.personaId));
      capabilities.updateTaskStoryline({
        id: task.id,
        summary: teamPlan.reason,
        nextAction: "等待专家意见汇总后，由小丑鱼完成最终交付。",
        experts: assignments.map(({ personaId, responsibility }) => ({ personaId, responsibility })),
      });
      const expertTasks = assignments.map((assignment, index) => ({
        id: `expert-${index + 1}`,
        title: assignment.responsibility,
        instruction: expertAssignmentPrompt(assignment, collaborationObjective),
        dependsOn: [] as string[],
        metadata: {
          personaId: assignment.personaId,
          capabilityId: assignment.capabilityId,
          format: assignment.format as ArtifactFormat,
          memoryMode: assignment.memoryMode,
          expertContractId: assignment.personaId,
        },
      }));
      const finalTask = {
        id: "clownfish-final",
        title: `复核并完成：${task.title}`,
        instruction: finalDeliveryPrompt({ objective: collaborationObjective, reviewChecks: teamPlan.finalReviewChecks }),
        dependsOn: expertTasks.map((item) => item.id),
        metadata: {
          personaId: APP_PERSONA_ID,
          capabilityId: task.capabilityId,
          format: task.format,
          memoryMode: teamPlan.finalMemoryMode,
        },
      };
      const action = await agentUserActions.execute({
        name: "capability_task_collaborate",
        description: "由小丑鱼按任务需要自动组织专家检查并完成最终交付",
        arguments: { taskId: task.id, capabilityId: task.capabilityId, expertCount: assignments.length },
        execute: () => agentJobQueue.enqueue({
          type: "orchestration",
          payload: { objective: collaborationObjective, tasks: [...expertTasks, finalTask], taskId: task.id, connectionFingerprint: teamConnectionFingerprint() },
          metadata: {
            userId: USER,
            workTaskId: task.id,
            requestedBy: APP_PERSONA_ID,
            expertTeamId: teamPlan.id,
            expertTeamReason: teamPlan.reason,
          },
          deliveryRequired: true,
          sideEffectRisk: true,
          maxAttempts: 1,
          timeoutMs: 45 * 60_000,
          idempotencyKey: `collaboration:${task.id}:${Date.now()}`,
        }),
        summarizeResult: (job) => ({ ok: true, jobId: job.id, status: job.status }),
      });
      capabilities.projectTaskExecution({
        taskId: task.id,
        jobId: action.value.id,
        status: action.value.status,
        label: "小丑鱼正在组织协作",
        updatedAt: action.value.updatedAt,
      });
      send(res, 202, { ok: true, job: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/task/run", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing task id" }); return; }
      const task = capabilities.snapshot().tasks.find((item) => item.id === b.id);
      if (!task) { send(res, 404, { error: "task not found" }); return; }
      const action = await agentUserActions.execute({
        name: "capability_task_run",
        description: "把用户选中的常规任务加入持久队列",
        arguments: { taskId: task.id, personaId: task.personaId, capabilityId: task.capabilityId },
        metadata: { personaId: task.personaId },
        execute: () => agentJobQueue.enqueue({
          type: "capability-task",
          payload: { taskId: task.id, trigger: "manual", connectionFingerprint: teamConnectionFingerprint() },
          metadata: { userId: USER, workTaskId: task.id },
          deliveryRequired: true,
          sideEffectRisk: true,
          maxAttempts: 1,
          idempotencyKey: `capability-task:${task.id}:${Date.now()}`,
        }),
        summarizeResult: (job) => ({ ok: true, jobId: job.id, taskId: task.id, status: job.status }),
      });
      capabilities.projectTaskExecution({
        taskId: task.id,
        jobId: action.value.id,
        status: action.value.status,
        updatedAt: action.value.updatedAt,
      });
      send(res, 202, { ok: true, job: action.value, auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
    route("POST", "/api/capabilities/adhoc/run", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        title?: string;
        personaId?: string;
        capabilityId?: string;
        instruction?: string;
        format?: ArtifactFormat;
      };
      if (!b.personaId || !b.capabilityId || !b.instruction) {
        send(res, 400, { error: "missing personaId, capabilityId, or instruction" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "capability_adhoc_run",
        description: "执行用户在任务工作台提交的临时任务并保存交付物",
        timeoutMs: 10 * 60_000,
        arguments: {
          title: b.title,
          personaId: b.personaId,
          capabilityId: b.capabilityId,
          format: b.format,
          instructionChars: b.instruction.length,
        },
        metadata: { personaId: b.personaId },
        execute: async (signal) => {
          const notification = await capabilities.runAdHocTask({
            title: b.title || "任务工作台",
            personaId: b.personaId!,
            capabilityId: b.capabilityId!,
            instruction: b.instruction!,
            format: b.format || "md",
            trigger: "workspace",
            origin: { kind: "direct" },
          }, signal);
          autoLearnFromWork(b.personaId!, b.instruction!, b.capabilityId!, b.format || "md");
          return notification;
        },
        summarizeResult: (notification) => ({ ok: true, artifactId: notification.artifact.id }),
      });
      send(res, 200, { ok: true, notification: capabilityReply(action.value), auditRunId: action.runId, snapshot: capabilities.snapshot() });
      return;
    }),
  ];
}
