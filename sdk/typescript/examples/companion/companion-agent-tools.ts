import type { AgentTool, Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "./capabilities.js";
import type { ChatAgentContext } from "./engine.js";
import type { AgentToolProvider } from "./llm.js";

export interface CompanionDelegationJobInput {
  objective: string;
  tasks: Array<{
    id: string;
    title: string;
    instruction: string;
    dependsOn?: string[];
    metadata: Record<string, string>;
    budget: { maxRounds: number; maxToolRounds: number; maxTotalTokens: number; maxOutputChars: number };
  }>;
}

export interface CompanionAgentToolDependencies {
  memory: () => Nemos;
  capabilities: () => CapabilityRuntime;
  fetchSkillSource?: (url: string, signal: AbortSignal) => Promise<string>;
  listPersonas?: () => Array<{ id: string; name: string }>;
  enqueueOrchestration?: (input: CompanionDelegationJobInput, idempotencyKey: string) => { id: string; status: string };
}

const MEMORY_CUE = /(记得|记忆|想起|之前.{0,8}(说|提|聊)|我.{0,8}(说过|提过)|remember|memory|mentioned before)/i;
const TASK_CUE = /(任务|计划|定时|待办|进度|上次运行|task|schedule|todo)/i;
const TASK_CREATE_CUE = /((创建|新增|登记|保存|安排|设为).{0,12}(能力|任务)|常规任务|固定能力|定时任务|每天|每日|每周|每.{0,4}轮)/i;
const SKILL_INSTALL_CUE = /((安装|导入|添加|注册).{0,24}(skill|skills|SKILL\.md|技能包|能力包)|((skill|skills|SKILL\.md|技能包|能力包).{0,24}(安装|导入|添加|注册)))/i;
const DELEGATION_CUE = /(多.{0,4}(角色|专家|人)|团队|分工|并行|分别.{0,10}(分析|研究|核验|给出)|不同.{0,6}(角度|视角)|交叉.{0,4}(验证|复核)|让.{0,12}(马斯克|乔布斯|芒格|苏格拉底).{0,12}(和|与|、))/i;
const ARTIFACT_CUE = /(产物|交付物|生成的.{0,6}(报告|文件|文档)|最近的.{0,6}(报告|文件|文档)|artifact|deliverable)/i;

/**
 * 把产品内部的只读能力暴露为按请求加载的 Agent 工具。
 * 人格、用户和记忆 scope 都来自 Engine，工具不能自行扩大可见范围。
 */
export function createCompanionAgentToolProvider(
  dependencies: CompanionAgentToolDependencies,
): AgentToolProvider {
  return (instruction, context) => {
    if (!context) return [];
    const tools: AgentTool[] = [];
    if (MEMORY_CUE.test(instruction) && context.memoryScopes.length > 0) {
      tools.push(memoryRecallTool(dependencies, context));
    }
    if (TASK_CUE.test(instruction)) {
      tools.push(taskListTool(dependencies, context));
    }
    if (context.personaId === "zhiwei" && TASK_CREATE_CUE.test(instruction)) {
      tools.push(taskCreateTool(dependencies, context));
    }
    if (context.personaId === "zhiwei" && SKILL_INSTALL_CUE.test(instruction)) {
      tools.push(skillInstallTool(dependencies, context));
    }
    if (
      context.personaId === "zhiwei" &&
      DELEGATION_CUE.test(instruction) &&
      dependencies.listPersonas &&
      dependencies.enqueueOrchestration
    ) {
      tools.push(delegationCreateTool(dependencies, context));
    }
    if (ARTIFACT_CUE.test(instruction)) {
      tools.push(artifactListTool(dependencies, context));
    }
    return tools;
  };
}

function memoryRecallTool(
  dependencies: CompanionAgentToolDependencies,
  context: ChatAgentContext,
): AgentTool {
  return {
    definition: {
      name: "memory_recall",
      description: "Search this user's memories visible to the current persona. Never searches another user or a scope where this persona was absent.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "The fact or past conversation to recall" } },
        required: ["query"],
        additionalProperties: false,
      },
      effect: "read",
      timeoutMs: 10_000,
    },
    execute: async (input, toolContext) => {
      ensureActive(toolContext.signal);
      const query = String(input.query ?? "").trim();
      const content = await dependencies.memory().forUser(context.userId).getRelevantContext(query, {
        scopes: [...context.memoryScopes],
        topK: 8,
        maxTokens: 800,
      });
      ensureActive(toolContext.signal);
      return {
        content: content.trim() || "No matching memory was found in the current persona's visible conversations.",
        data: { userId: context.userId, personaId: context.personaId, scopes: [...context.memoryScopes] },
      };
    },
  };
}

function taskListTool(
  dependencies: CompanionAgentToolDependencies,
  context: ChatAgentContext,
): AgentTool {
  return {
    definition: {
      name: "capability_task_list",
      description: "List capability tasks owned by the current persona. This is read-only and cannot create, run, change, or delete tasks.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", description: "Maximum number of tasks to return" } },
        additionalProperties: false,
      },
      effect: "read",
      timeoutMs: 5_000,
    },
    execute: async (input, toolContext) => {
      ensureActive(toolContext.signal);
      const limit = boundedLimit(input.limit, 10, 20);
      const tasks = dependencies.capabilities().snapshot().tasks
        .filter((task) => task.personaId === context.personaId)
        .slice(0, limit)
        .map((task) => ({
          id: task.id,
          title: task.title,
          enabled: task.enabled,
          schedule: task.schedule,
          updatedAt: task.updatedAt,
          lastRunAt: task.lastRunAt ?? null,
        }));
      return {
        content: tasks.length ? JSON.stringify(tasks, null, 2) : "The current persona has no capability tasks.",
        data: { personaId: context.personaId, tasks },
      };
    },
  };
}

function taskCreateTool(
  dependencies: CompanionAgentToolDependencies,
  context: ChatAgentContext,
): AgentTool {
  const abilities = dependencies.capabilities().snapshot().abilities
    .filter((ability) => !ability.archivedAt)
    .map((ability) => ({ id: ability.id, name: ability.name }));
  return {
    definition: {
      name: "capability_task_create",
      description:
        "Create a reusable capability and optional recurring task for the user. Use only when the user explicitly asks to save, schedule, or repeat work. This changes local state and requires confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short Chinese task or capability title" },
          instruction: { type: "string", description: "Complete execution requirements and delivery criteria" },
          capabilityId: {
            type: "string",
            description: "Reuse an existing capability id when suitable. Available: " + abilities.map((item) => item.id + "=" + item.name).join(", "),
          },
          createRecurringTask: { type: "boolean", description: "Whether to create a runnable task in addition to the capability" },
          format: { type: "string", enum: ["md", "html", "txt", "json", "doc"] },
          scheduleMode: { type: "string", enum: ["manual", "daily", "turns"] },
          time: { type: "string", description: "Daily time in HH:mm" },
          everyTurns: { type: "integer", description: "Run after this many persona turns" },
        },
        required: ["title", "instruction", "createRecurringTask", "format", "scheduleMode"],
        additionalProperties: false,
      },
      effect: "write",
      timeoutMs: 10_000,
    },
    execute: async (input, toolContext) => {
      ensureActive(toolContext.signal);
      const title = String(input.title ?? "").trim();
      const instruction = String(input.instruction ?? "").trim();
      if (!title || !instruction) return { content: "title and instruction are required", isError: true };

      const runtime = dependencies.capabilities();
      const requestedCapabilityId = String(input.capabilityId ?? "").trim();
      const existing = abilities.find((ability) => ability.id === requestedCapabilityId);
      const format = capabilityFormat(input.format);
      const ability = existing
        ? runtime.snapshot().abilities.find((item) => item.id === existing.id)!
        : runtime.createGeneratedAbility({
          personaId: "zhiwei",
          name: title,
          goal: instruction,
          defaultFormat: format,
        });

      let task = null;
      if (input.createRecurringTask === true) {
        task = runtime.createTask({
          title,
          personaId: "zhiwei",
          capabilityId: ability.id,
          instruction,
          format,
          enabled: true,
          schedule: capabilitySchedule(input),
        });
      }
      ensureActive(toolContext.signal);
      return {
        content: JSON.stringify({
          capability: { id: ability.id, name: ability.name },
          task: task ? { id: task.id, title: task.title, schedule: task.schedule } : null,
        }, null, 2),
        data: { capabilityId: ability.id, taskId: task?.id ?? null },
      };
    },
  };
}

function skillInstallTool(
  dependencies: CompanionAgentToolDependencies,
  context: ChatAgentContext,
): AgentTool {
  return {
    definition: {
      name: "skill_install",
      description:
        "Install or update a reusable SKILL.md for Zhiwei. Use only when the user explicitly asks to install or import a Skill. Prefer sourceUrl or sourcePath; do not copy sourceText when a URL or path exists. This downloads or reads content and changes local files, so it requires confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          sourceUrl: { type: "string", description: "Public http/https URL containing the Skill", maxLength: 2048 },
          sourcePath: { type: "string", description: "Local SKILL.md file or Skill directory path", maxLength: 2048 },
          sourceText: { type: "string", description: "Pasted SKILL.md content, only when no URL or path exists", maxLength: 65536 },
          name: { type: "string", description: "Optional display name", maxLength: 80 },
          description: { type: "string", description: "Optional short description", maxLength: 320 },
          format: { type: "string", enum: ["md", "html", "txt", "json", "doc"] },
        },
        required: ["format"],
        additionalProperties: false,
      },
      effect: "write",
      timeoutMs: 30_000,
    },
    execute: async (input, toolContext) => {
      ensureActive(toolContext.signal);
      const sourceUrl = String(input.sourceUrl ?? "").trim();
      const sourcePath = String(input.sourcePath ?? "").trim();
      let sourceText = String(input.sourceText ?? "").trim();
      if (!sourceUrl && !sourcePath && !sourceText) {
        return { content: "A Skill URL, local path, or pasted SKILL.md content is required.", isError: true };
      }
      if (sourceText.length > 65_536) {
        return { content: "Pasted SKILL.md content exceeds 64KB; use a local file path instead.", isError: true };
      }
      if (sourceUrl && !sourceText) {
        if (!dependencies.fetchSkillSource) {
          return { content: "This runtime cannot read Skill URLs.", isError: true };
        }
        sourceText = await dependencies.fetchSkillSource(sourceUrl, toolContext.signal);
      }
      ensureActive(toolContext.signal);

      const runtime = dependencies.capabilities();
      const ability = runtime.installSkill({
        personaId: context.personaId,
        name: String(input.name ?? "").trim() || undefined,
        description: String(input.description ?? "").trim() || undefined,
        sourcePath: sourcePath || undefined,
        sourceText: sourceText || undefined,
        sourceUrl: sourceUrl || undefined,
        defaultFormat: capabilityFormat(input.format),
      });
      const skillFile = runtime.snapshot().skillAudit.items
        .find((item) => item.abilityId === ability.id)?.skillFile ?? "";
      return {
        content: JSON.stringify({
          installed: true,
          capability: {
            id: ability.id,
            name: ability.name,
            description: ability.description,
            format: ability.defaultFormat,
          },
          skillFile,
        }, null, 2),
        data: { capabilityId: ability.id, skillFile },
      };
    },
  };
}
function delegationCreateTool(
  dependencies: CompanionAgentToolDependencies,
  context: ChatAgentContext,
): AgentTool {
  const personas = dependencies.listPersonas?.() ?? [];
  const personaOptions = personas.map((persona) => `${persona.id}=${persona.name}`).join(", ");
  return {
    definition: {
      name: "agent_delegation_create",
      description:
        "Delegate one bounded objective to 2-4 distinct expert personas, then require Zhiwei to synthesize and review their artifacts. Use only when the work genuinely benefits from independent perspectives or parallel verification. Never use for a simple single-person task.",
      inputSchema: {
        type: "object",
        properties: {
          objective: { type: "string", description: "The shared objective and final delivery criteria" },
          assignments: {
            type: "array",
            description: "Two to four independent expert assignments",
            items: {
              type: "object",
              properties: {
                personaId: { type: "string", description: `Expert persona. Available: ${personaOptions}` },
                title: { type: "string" },
                instruction: { type: "string" },
                capabilityId: { type: "string", description: "Optional active capability id; defaults to research-brief" },
                format: { type: "string", enum: ["md", "html", "txt", "json", "doc"] },
              },
              required: ["personaId", "title", "instruction", "format"],
              additionalProperties: false,
            },
          },
          synthesisInstruction: {
            type: "string",
            description: "Optional criteria for Zhiwei's final review and synthesis",
          },
        },
        required: ["objective", "assignments"],
        additionalProperties: false,
      },
      effect: "write",
      timeoutMs: 10_000,
    },
    execute: async (input, toolContext) => {
      ensureActive(toolContext.signal);
      const objective = String(input.objective ?? "").trim();
      const rawAssignments = Array.isArray(input.assignments)
        ? input.assignments.filter(isRecord)
        : [];
      if (!objective) return { content: "objective is required", isError: true };
      if (rawAssignments.length < 2 || rawAssignments.length > 4) {
        return { content: "Delegation requires 2-4 expert assignments.", isError: true };
      }

      const personaById = new Map(personas.map((persona) => [persona.id, persona]));
      const activeCapabilities = new Set(
        dependencies.capabilities().snapshot().abilities
          .filter((ability) => !ability.archivedAt)
          .map((ability) => ability.id),
      );
      const assignments = rawAssignments.map((assignment, index) => ({
        id: `delegate-${index + 1}`,
        personaId: String(assignment.personaId ?? "").trim(),
        title: String(assignment.title ?? "").trim(),
        instruction: String(assignment.instruction ?? "").trim(),
        capabilityId: String(assignment.capabilityId ?? "research-brief").trim() || "research-brief",
        format: capabilityFormat(assignment.format),
      }));
      for (const assignment of assignments) {
        if (!personaById.has(assignment.personaId)) {
          return { content: `Unknown persona: ${assignment.personaId}`, isError: true };
        }
        if (!assignment.title || !assignment.instruction) {
          return { content: "Every delegation assignment needs a title and instruction.", isError: true };
        }
        if (!activeCapabilities.has(assignment.capabilityId)) {
          return { content: `Unknown or archived capability: ${assignment.capabilityId}`, isError: true };
        }
      }
      if (new Set(assignments.map((assignment) => assignment.personaId)).size < 2) {
        return { content: "Delegation must use at least two distinct expert personas.", isError: true };
      }

      const taskIds = assignments.map((assignment) => assignment.id);
      const synthesisInstruction = String(input.synthesisInstruction ?? "").trim();
      const tasks: CompanionDelegationJobInput["tasks"] = assignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        instruction: assignment.instruction,
        metadata: {
          personaId: assignment.personaId,
          capabilityId: assignment.capabilityId,
          format: assignment.format,
          role: "expert",
        },
        budget: { maxRounds: 4, maxToolRounds: 3, maxTotalTokens: 12_000, maxOutputChars: 20_000 },
      }));
      tasks.push({
        id: "synthesis",
        title: "知微复核与汇总",
        instruction: synthesisInstruction || [
          "复核各专家交付物，指出一致结论、关键分歧、证据缺口和风险。",
          "只保留能由交付物支持的结论，形成一份可直接给用户使用的最终结果。",
        ].join("\n"),
        dependsOn: taskIds,
        metadata: {
          personaId: context.personaId,
          capabilityId: "research-brief",
          format: "md",
          role: "reviewer",
        },
        budget: { maxRounds: 4, maxToolRounds: 2, maxTotalTokens: 16_000, maxOutputChars: 30_000 },
      });

      const job = dependencies.enqueueOrchestration!({ objective, tasks }, `delegation:${toolContext.runId}`);
      ensureActive(toolContext.signal);
      return {
        content: JSON.stringify({
          queued: true,
          jobId: job.id,
          status: job.status,
          experts: assignments.map((assignment) => ({
            personaId: assignment.personaId,
            name: personaById.get(assignment.personaId)?.name,
            title: assignment.title,
          })),
          reviewer: personaById.get(context.personaId)?.name ?? context.personaId,
        }, null, 2),
        data: { jobId: job.id },
      };
    },
  };
}

function capabilityFormat(value: unknown): "md" | "html" | "txt" | "json" | "doc" {
  return value === "html" || value === "txt" || value === "json" || value === "doc" ? value : "md";
}

function capabilitySchedule(input: Record<string, unknown>): {
  mode: "manual" | "daily" | "turns";
  time?: string;
  timezone?: string;
  days?: number[];
  everyTurns?: number;
} {
  if (input.scheduleMode === "daily") {
    const requested = String(input.time ?? "");
    return {
      mode: "daily",
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(requested) ? requested : "14:00",
      timezone: "Asia/Shanghai",
      days: [1, 2, 3, 4, 5, 6, 7],
    };
  }
  if (input.scheduleMode === "turns") {
    const parsed = typeof input.everyTurns === "number" ? Math.floor(input.everyTurns) : 5;
    return { mode: "turns", everyTurns: Math.min(100, Math.max(1, parsed)) };
  }
  return { mode: "manual" };
}
function artifactListTool(
  dependencies: CompanionAgentToolDependencies,
  context: ChatAgentContext,
): AgentTool {
  return {
    definition: {
      name: "capability_artifact_list",
      description: "List recent deliverables produced by the current persona. Returns metadata and summaries, not local filesystem paths.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", description: "Maximum number of artifacts to return" } },
        additionalProperties: false,
      },
      effect: "read",
      timeoutMs: 5_000,
    },
    execute: async (input, toolContext) => {
      ensureActive(toolContext.signal);
      const limit = boundedLimit(input.limit, 8, 20);
      const artifacts = dependencies.capabilities().snapshot().artifacts
        .filter((artifact) => artifact.personaId === context.personaId)
        .slice(0, limit)
        .map((artifact) => ({
          id: artifact.id,
          title: artifact.title,
          format: artifact.format,
          createdAt: artifact.createdAt,
          summary: artifact.summary,
          verification: artifact.verification?.summary ?? null,
        }));
      return {
        content: artifacts.length ? JSON.stringify(artifacts, null, 2) : "The current persona has no saved artifacts.",
        data: { personaId: context.personaId, artifacts },
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(maximum, Math.max(1, parsed));
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Tool call cancelled");
}
