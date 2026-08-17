import type { Capability } from "./capabilities.js";
import type {
  CapabilitySurface,
  CapabilityToolFilter,
  CapabilityToolRegistry,
  CapabilityToolSummary,
} from "./capability-tools.js";
import type { DevelopmentEnginePluginRegistry } from "./development-engine-plugins.js";

export interface CapabilitySurfacePolicy {
  id: CapabilitySurface;
  name: string;
  description: string;
  toolsets: string[];
  tools?: string[];
}

export interface CapabilityProviderSummary {
  id: string;
  name: string;
  kind: "model" | "search" | "voice" | "vision" | "connector";
  available: boolean;
  inherited?: boolean;
  model?: string;
  detail?: string;
}

export interface CapabilitySkillSummary {
  id: string;
  name: string;
  description: string;
  kind: Capability["kind"];
  source: NonNullable<Capability["source"]> | "builtin";
  available: boolean;
  defaultFormat: Capability["defaultFormat"];
}

export interface CapabilityExtensionSummary {
  id: string;
  name: string;
  version: string;
  kind: string;
  runtime: string;
  enabled: boolean;
  providerAttached: boolean;
  executionSecurity: string;
  available: boolean;
  runtimeError?: string;
  tools: string[];
}

export const DEFAULT_CAPABILITY_SURFACES: readonly CapabilitySurfacePolicy[] = [
  {
    id: "task",
    name: "任务",
    description: "对话、研究、写作、文件与来源核验所需的通用工具。",
    toolsets: ["web", "source", "vision", "document", "writing", "voice", "memory", "task", "skill", "delegation", "artifact", "development", "extension"],
  },
  {
    id: "education",
    name: "学习辅导",
    description: "以讲解、资料核验、图片理解和练习反馈为主。",
    toolsets: ["web", "source", "vision", "document", "writing", "memory", "artifact", "extension"],
  },
  {
    id: "capability",
    name: "能力",
    description: "执行专门任务时按目标选择所需工具。",
    toolsets: ["web", "source", "vision", "document", "writing", "voice", "memory", "task", "skill", "delegation", "artifact", "development", "extension"],
  },
  {
    id: "office",
    name: "文件",
    description: "文档转换、识别、整理与润色。",
    toolsets: ["vision", "document", "writing", "artifact"],
  },
  {
    id: "development",
    name: "开发",
    description: "开发引擎负责改代码，检索工具只用于补充资料和核验来源。",
    toolsets: ["web", "source", "memory", "artifact", "development"],
  },
  {
    id: "automation",
    name: "工作",
    description: "定时或重复运行任务，沿用任务所需的受控工具。",
    toolsets: ["web", "source", "document", "writing", "memory", "task", "delegation", "artifact", "extension"],
  },
] as const;

const COMPANION_RUNTIME_TOOLS = [
  { name: "memory_recall", id: "agent.memory-recall", label: "记忆检索", description: "按当前用户、角色与会话边界找回相关记忆。", toolset: "memory", effect: "read", risk: "normal", permissions: ["memory-read"] },
  { name: "capability_task_list", id: "agent.task-list", label: "任务列表", description: "查看当前能力任务及其状态。", toolset: "task", effect: "read", risk: "normal", permissions: ["task-read"] },
  { name: "capability_task_create", id: "agent.task-create", label: "创建任务", description: "把明确目标创建为可继续执行的能力任务。", toolset: "task", effect: "write", risk: "normal", permissions: ["task-write"] },
  { name: "skill_install", id: "agent.skill-install", label: "安装技能", description: "将经过确认的可复用流程安装到本机技能库。", toolset: "skill", effect: "write", risk: "normal", permissions: ["skill-write"] },
  { name: "agent_delegation_create", id: "agent.delegation-create", label: "委派子任务", description: "把研究、整理或复核工作交给受控执行器。", toolset: "delegation", effect: "write", risk: "normal", permissions: ["task-write"] },
  { name: "capability_artifact_list", id: "agent.artifact-list", label: "产物检索", description: "找回任务和能力此前生成的文件与结果。", toolset: "artifact", effect: "read", risk: "normal", permissions: ["artifact-read"] },
  { name: "development_task_create", id: "agent.development-create", label: "创建开发任务", description: "将编程目标交给选定开发引擎执行。", toolset: "development", effect: "write", risk: "normal", permissions: ["development-write"] },
] as const;

export function companionRuntimeToolSummaries(): CapabilityToolSummary[] {
  const checkedAt = new Date().toISOString();
  return COMPANION_RUNTIME_TOOLS.map((tool) => ({
    id: tool.id,
    name: tool.label,
    description: tool.description,
    toolset: tool.toolset,
    available: true,
    requires: [...tool.permissions],
    readiness: { available: true, reason: "ready", message: "由小丑鱼产品运行时提供", checkedAt },
    source: { kind: "builtin", id: "clownfish-runtime" },
    isAsync: true,
    execution: "runtime-integrated",
    effect: tool.effect,
    risk: tool.risk,
    permissions: [...tool.permissions],
    dynamic: true,
  }));
}

export function filterCompanionRuntimeToolsForSurface<T extends { definition: { name: string } }>(
  surface: CapabilitySurface,
  tools: readonly T[],
): T[] {
  const allowedToolsets = new Set(capabilityToolFilterForSurface(surface).toolsets ?? []);
  const toolsets = new Map<string, string>(COMPANION_RUNTIME_TOOLS.map((tool) => [tool.name, tool.toolset]));
  return tools.filter((tool) => {
    const toolset = toolsets.get(tool.definition.name);
    return toolset ? allowedToolsets.has(toolset) : false;
  });
}

export function capabilityToolFilterForSurface(surface: CapabilitySurface): CapabilityToolFilter {
  const policy = DEFAULT_CAPABILITY_SURFACES.find((item) => item.id === surface);
  return policy ? { toolsets: policy.toolsets, tools: policy.tools } : { toolsets: [], tools: [] };
}

export class CapabilitySurfaceRegistry {
  readonly #policies = new Map<CapabilitySurface, CapabilitySurfacePolicy>();

  constructor(policies: readonly CapabilitySurfacePolicy[] = DEFAULT_CAPABILITY_SURFACES) {
    for (const policy of policies) this.register(policy);
  }

  register(policy: CapabilitySurfacePolicy): void {
    if (this.#policies.has(policy.id)) throw new Error(`能力场景重复：${policy.id}`);
    this.#policies.set(policy.id, {
      ...policy,
      toolsets: [...new Set(policy.toolsets)],
      tools: policy.tools ? [...new Set(policy.tools)] : undefined,
    });
  }

  list(): CapabilitySurfacePolicy[] {
    return [...this.#policies.values()].map((item) => ({
      ...item,
      toolsets: [...item.toolsets],
      tools: item.tools ? [...item.tools] : undefined,
    }));
  }

  toolsFor(surface: CapabilitySurface, tools: readonly CapabilityToolSummary[]): CapabilityToolSummary[] {
    const policy = this.#policies.get(surface);
    if (!policy) return [];
    const ids = new Set(policy.tools ?? []);
    const toolsets = new Set(policy.toolsets);
    return tools.filter((tool) => ids.has(tool.id) || toolsets.has(tool.toolset));
  }
}

export function buildCapabilitySystemRegistry(input: {
  tools: CapabilityToolRegistry;
  additionalTools?: readonly CapabilityToolSummary[];
  abilities: readonly Capability[];
  engines: DevelopmentEnginePluginRegistry;
  providers: readonly CapabilityProviderSummary[];
  extensions?: readonly CapabilityExtensionSummary[];
  surfaces?: CapabilitySurfaceRegistry;
}) {
  const coreTools = input.tools.list();
  const seenToolIds = new Set(coreTools.map((tool) => tool.id));
  const additionalTools = (input.additionalTools ?? []).filter((tool) => {
    if (seenToolIds.has(tool.id)) return false;
    seenToolIds.add(tool.id);
    return true;
  });
  const tools = [...coreTools, ...additionalTools]
    .sort((a, b) => a.toolset.localeCompare(b.toolset) || a.id.localeCompare(b.id));
  const surfaces = input.surfaces ?? new CapabilitySurfaceRegistry();
  const engineReadiness = input.engines.readiness();
  const engines = input.engines.list().map((manifest) => ({
    ...manifest,
    readiness: engineReadiness[manifest.id],
  }));
  const skills: CapabilitySkillSummary[] = input.abilities.map((ability) => ({
    id: ability.id,
    name: ability.name,
    description: ability.description,
    kind: ability.kind,
    source: ability.source ?? "builtin",
    available: !ability.archivedAt && !ability.disabledAt,
    defaultFormat: ability.defaultFormat,
  }));
  const surfaceList = surfaces.list().map((surface) => {
    const selected = surfaces.toolsFor(surface.id, tools);
    return {
      ...surface,
      tools: selected.map((tool) => tool.id),
      readyTools: selected.filter((tool) => tool.available && tool.execution === "direct").length,
      integratedTools: selected.filter((tool) => tool.available && tool.execution === "runtime-integrated").length,
      totalTools: selected.length,
    };
  });
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    counts: {
      skills: skills.length,
      tools: tools.length,
      readyTools: tools.filter((tool) => tool.available && tool.execution === "direct").length,
      integratedTools: tools.filter((tool) => tool.available && tool.execution === "runtime-integrated").length,
      engines: engines.length,
      readyEngines: engines.filter((engine) => engine.readiness.available).length,
      providers: input.providers.length,
      readyProviders: input.providers.filter((provider) => provider.available).length,
      extensions: input.extensions?.length ?? 0,
      readyExtensions: input.extensions?.filter((extension) => extension.available).length ?? 0,
    },
    skills,
    tools,
    toolsets: [...new Set(tools.map((tool) => tool.toolset))].sort().map((id) => ({
      id,
      tools: tools.filter((tool) => tool.toolset === id).map((tool) => tool.id),
      readyTools: tools.filter((tool) => tool.toolset === id && tool.available && tool.execution === "direct").length,
      integratedTools: tools.filter((tool) => tool.toolset === id && tool.available && tool.execution === "runtime-integrated").length,
    })),
    surfaces: surfaceList,
    engines,
    providers: input.providers.map((provider) => ({ ...provider })),
    extensions: (input.extensions ?? []).map((extension) => ({ ...extension, tools: [...extension.tools] })),
  };
}
