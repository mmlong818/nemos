import type { ModelCapability } from "./model-resource-center.js";

export const QUICK_SETUP_PROVIDERS = ["openai", "zhipu"] as const;
export type QuickSetupProvider = typeof QUICK_SETUP_PROVIDERS[number];

export const QUICK_SETUP_CAPABILITIES = [
  "chat", "vision", "speech_to_text", "text_to_speech", "image_generation",
] as const satisfies readonly ModelCapability[];
export type QuickSetupCapability = typeof QUICK_SETUP_CAPABILITIES[number];

export type QuickSetupStage = "saving" | "discovering" | "verifying" | "assigning" | "complete" | "partial" | "failed" | "interrupted";
export type QuickSetupItemStatus = "pending" | "running" | "ready" | "failed" | "unsupported" | "preserved";

export interface QuickSetupTarget {
  provider: QuickSetupProvider;
  connectionId: string;
  modelId: string;
  capability: QuickSetupCapability;
}

export interface QuickSetupProviderResult {
  provider: QuickSetupProvider;
  status: QuickSetupItemStatus;
  connectionId?: string;
  detail: string;
}

export interface QuickSetupCapabilityResult {
  capability: QuickSetupCapability | "video_generation";
  status: QuickSetupItemStatus;
  provider?: QuickSetupProvider;
  connectionId?: string;
  modelId?: string;
  detail: string;
}

export interface ModelQuickSetupSnapshot {
  requestId: string;
  stage: QuickSetupStage;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  resetRecommendations: boolean;
  providerResults: QuickSetupProviderResult[];
  capabilityResults: QuickSetupCapabilityResult[];
  message: string;
}

export interface ModelQuickSetupDependencies {
  persist(snapshot: ModelQuickSetupSnapshot): void | Promise<void>;
  save(provider: QuickSetupProvider, key: string | undefined): Promise<{ connectionId: string }>;
  discover(provider: QuickSetupProvider, connectionId: string): Promise<{ targets: QuickSetupTarget[]; detail: string }>;
  verify(target: QuickSetupTarget): Promise<{ passed: boolean; detail: string }>;
  assign(
    passed: readonly QuickSetupTarget[],
    resetRecommendations: boolean,
  ): Promise<Array<{ capability: QuickSetupCapability; status: "ready" | "preserved" | "failed" | "pending"; target?: QuickSetupTarget; detail: string }>>;
}

function now(): string { return new Date().toISOString(); }

export function createModelQuickSetupSnapshot(requestId: string, resetRecommendations = false): ModelQuickSetupSnapshot {
  const startedAt = now();
  return {
    requestId,
    stage: "saving",
    startedAt,
    updatedAt: startedAt,
    resetRecommendations,
    providerResults: QUICK_SETUP_PROVIDERS.map((provider) => ({ provider, status: "pending", detail: "等待处理" })),
    capabilityResults: [
      ...QUICK_SETUP_CAPABILITIES.map((capability) => ({ capability, status: "pending" as const, detail: "等待验证" })),
      { capability: "video_generation" as const, status: "unsupported" as const, detail: "当前版本尚未接入视频生成执行器。" },
    ],
    message: "正在安全保存连接。",
  };
}

function replaceProvider(snapshot: ModelQuickSetupSnapshot, next: QuickSetupProviderResult): void {
  snapshot.providerResults = snapshot.providerResults.map((item) => item.provider === next.provider ? next : item);
}

function replaceCapability(snapshot: ModelQuickSetupSnapshot, next: QuickSetupCapabilityResult): void {
  snapshot.capabilityResults = snapshot.capabilityResults.map((item) => item.capability === next.capability ? next : item);
}

async function checkpoint(snapshot: ModelQuickSetupSnapshot, deps: ModelQuickSetupDependencies): Promise<void> {
  snapshot.updatedAt = now();
  await deps.persist(structuredClone(snapshot));
}

/**
 * Provider-neutral setup state machine. All provider I/O is injected so the
 * same transitions can be verified against deterministic fake providers.
 */
export async function runModelQuickSetup(input: {
  requestId: string;
  keys?: Partial<Record<QuickSetupProvider, string>>;
  resetRecommendations?: boolean;
}, deps: ModelQuickSetupDependencies): Promise<ModelQuickSetupSnapshot> {
  const snapshot = createModelQuickSetupSnapshot(input.requestId, input.resetRecommendations === true);
  await checkpoint(snapshot, deps);
  const connections = new Map<QuickSetupProvider, string>();
  for (const provider of QUICK_SETUP_PROVIDERS) {
    replaceProvider(snapshot, { provider, status: "running", detail: "正在加密保存" });
    await checkpoint(snapshot, deps);
    try {
      const saved = await deps.save(provider, input.keys?.[provider]?.trim() || undefined);
      if (saved.connectionId) {
        connections.set(provider, saved.connectionId);
        replaceProvider(snapshot, { provider, status: "ready", connectionId: saved.connectionId, detail: "凭据已加密保存在本机" });
      } else {
        replaceProvider(snapshot, { provider, status: "pending", detail: "未填写密钥，保持未配置" });
      }
    } catch (error) {
      replaceProvider(snapshot, { provider, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
    await checkpoint(snapshot, deps);
  }

  snapshot.stage = "discovering";
  snapshot.message = "正在获取并筛选推荐模型。";
  await checkpoint(snapshot, deps);
  const targets: QuickSetupTarget[] = [];
  for (const provider of QUICK_SETUP_PROVIDERS) {
    const connectionId = connections.get(provider);
    if (!connectionId) continue;
    try {
      const discovered = await deps.discover(provider, connectionId);
      targets.push(...discovered.targets);
      replaceProvider(snapshot, { provider, status: "ready", connectionId, detail: discovered.detail });
    } catch (error) {
      replaceProvider(snapshot, { provider, status: "failed", connectionId, detail: error instanceof Error ? error.message : String(error) });
    }
    await checkpoint(snapshot, deps);
  }

  snapshot.stage = "verifying";
  snapshot.message = "正在执行最小验证；每个 Key 验证一次连接，每项额外能力最多调用一次。";
  await checkpoint(snapshot, deps);
  const passed: QuickSetupTarget[] = [];
  const providerVerified = new Set<QuickSetupProvider>();
  const providerFailed = new Set<QuickSetupProvider>();
  for (const target of targets) {
    if (providerFailed.has(target.provider)) continue;
    const current = snapshot.capabilityResults.find((item) => item.capability === target.capability);
    // Every supplied credential receives one minimal provider check. After a
    // provider is authenticated, already-ready capabilities are not re-probed.
    const fallbackOnly = current?.status === "ready";
    if (fallbackOnly && providerVerified.has(target.provider)) continue;
    if (!fallbackOnly) replaceCapability(snapshot, { capability: target.capability, status: "running", provider: target.provider, connectionId: target.connectionId, modelId: target.modelId, detail: "正在验证" });
    await checkpoint(snapshot, deps);
    try {
      const result = await deps.verify(target);
      if (result.passed) {
        passed.push(target);
        providerVerified.add(target.provider);
        replaceProvider(snapshot, { provider: target.provider, status: "ready", connectionId: target.connectionId, detail: "密钥和最小模型调用已验证。" });
        if (!fallbackOnly) replaceCapability(snapshot, { capability: target.capability, status: "ready", provider: target.provider, connectionId: target.connectionId, modelId: target.modelId, detail: result.detail });
      } else {
        if (!providerVerified.has(target.provider)) {
          providerFailed.add(target.provider);
          replaceProvider(snapshot, { provider: target.provider, status: "failed", connectionId: target.connectionId, detail: result.detail });
        }
        if (!fallbackOnly) replaceCapability(snapshot, { capability: target.capability, status: "failed", provider: target.provider, connectionId: target.connectionId, modelId: target.modelId, detail: result.detail });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!providerVerified.has(target.provider)) {
        providerFailed.add(target.provider);
        replaceProvider(snapshot, { provider: target.provider, status: "failed", connectionId: target.connectionId, detail });
      }
      if (!fallbackOnly) replaceCapability(snapshot, { capability: target.capability, status: "failed", provider: target.provider, connectionId: target.connectionId, modelId: target.modelId, detail });
    }
    await checkpoint(snapshot, deps);
  }

  snapshot.stage = "assigning";
  snapshot.message = "正在配置各项能力的默认模型。";
  await checkpoint(snapshot, deps);
  let assignmentError = "";
  try {
    const assigned = await deps.assign(passed, snapshot.resetRecommendations);
    for (const item of assigned) {
      const existing = snapshot.capabilityResults.find((row) => row.capability === item.capability);
      const status = existing?.status === "failed" && item.status === "pending" ? "failed" : item.status;
      replaceCapability(snapshot, {
        capability: item.capability,
        status,
        provider: item.target?.provider || existing?.provider,
        connectionId: item.target?.connectionId || existing?.connectionId,
        modelId: item.target?.modelId || existing?.modelId,
        detail: item.detail,
      });
    }
  } catch (error) {
    assignmentError = error instanceof Error ? error.message : String(error);
    for (const item of snapshot.capabilityResults) {
      if (item.status !== "ready") continue;
      replaceCapability(snapshot, {
        ...item,
        status: "pending",
        detail: `验证已通过，但默认分配未完成：${assignmentError}`,
      });
    }
  }

  const ready = snapshot.capabilityResults.filter((item) => item.status === "ready" || item.status === "preserved").length;
  const failed = snapshot.capabilityResults.filter((item) => item.status === "failed").length
    + snapshot.providerResults.filter((item) => item.status === "failed").length;
  const pending = snapshot.capabilityResults.filter((item) => item.status === "pending").length;
  snapshot.stage = assignmentError ? (passed.length ? "partial" : "failed") : ready === 0 ? "failed" : failed || pending ? "partial" : "complete";
  snapshot.completedAt = now();
  snapshot.message = assignmentError
    ? `能力验证已完成，但默认分配失败：${assignmentError}。请重试。`
    : ready === 0
    ? "连接已保存，但没有能力通过验证；请检查密钥、网络或账号权限后重试。"
    : failed
      ? `已完成 ${ready} 项能力配置；部分能力未通过，可稍后单独重试。`
      : pending
        ? `已完成 ${ready} 项能力配置；其余能力需要另一个服务或仍未接入。`
        : `已完成 ${ready} 项能力配置。`;
  await checkpoint(snapshot, deps);
  return snapshot;
}

export function normalizeModelQuickSetupSnapshot(value: unknown): ModelQuickSetupSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ModelQuickSetupSnapshot>;
  if (typeof candidate.requestId !== "string" || !/^[A-Za-z0-9._-]{8,100}$/.test(candidate.requestId)) return undefined;
  if (!candidate.startedAt || !candidate.updatedAt || !Array.isArray(candidate.providerResults) || !Array.isArray(candidate.capabilityResults)) return undefined;
  const stage = String(candidate.stage) as QuickSetupStage;
  if (!["saving", "discovering", "verifying", "assigning", "complete", "partial", "failed", "interrupted"].includes(stage)) return undefined;
  const running = ["saving", "discovering", "verifying", "assigning"].includes(stage);
  return {
    ...candidate,
    stage: running ? "interrupted" : stage,
    message: running ? "上次自动配置被中断；已保存的连接不会丢失，可以重新执行。" : String(candidate.message || ""),
  } as ModelQuickSetupSnapshot;
}

export class ModelQuickSetupBusyError extends Error {
  constructor() { super("另一项模型配置正在进行，请等待完成。"); }
}

/** In-process de-duplication plus persisted-result reuse after reload/restart. */
export class ModelQuickSetupCoordinator {
  private active?: { requestId: string; promise: Promise<ModelQuickSetupSnapshot> };

  run(
    requestId: string,
    persisted: ModelQuickSetupSnapshot | undefined,
    execute: () => Promise<ModelQuickSetupSnapshot>,
  ): { reused: boolean; promise: Promise<ModelQuickSetupSnapshot> } {
    if (persisted?.requestId === requestId && ["complete", "partial", "failed"].includes(persisted.stage)) {
      return { reused: true, promise: Promise.resolve(persisted) };
    }
    if (this.active) {
      if (this.active.requestId !== requestId) throw new ModelQuickSetupBusyError();
      return { reused: true, promise: this.active.promise };
    }
    const promise = execute();
    this.active = { requestId, promise };
    void promise.finally(() => { if (this.active?.promise === promise) this.active = undefined; }).catch(() => undefined);
    return { reused: false, promise };
  }
}
