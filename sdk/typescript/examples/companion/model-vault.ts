import type { CompanionCapabilityCheck, CompanionModelCheck, CompanionModelConnection, CompanionModelInfo, CompanionModelProtocol, CompanionModelProvider } from "./model-connection.js";
import { bindModelChecksToRevision, ensureConnectionRevision, normalizeCompanionModelConnection, normalizeFavoriteModels, retainModelChecksForRevision } from "./model-connection.js";
import { eligibleCuratedCatalog, emptyCapabilityAssignments, normalizeCapabilityAssignments, type CapabilityAssignments, type ModelCapability } from "./model-resource-center.js";
import type { ReasoningEffort } from "./model-reasoning.js";
import { normalizeModelQuickSetupSnapshot, type ModelQuickSetupSnapshot } from "./model-quick-setup.js";

export type SavedReasoningEffort = ReasoningEffort | "auto";
export interface ChatInvocationPreferences {
  system: { reasoningEffort: SavedReasoningEffort };
  scenes: Record<string, { reasoningEffort: SavedReasoningEffort } | undefined>;
}
export const defaultChatInvocationPreferences = (): ChatInvocationPreferences => ({ system: { reasoningEffort: "auto" }, scenes: {} });

export interface RuntimeModelConnectionRecord {
  id: string;
  label: string;
  connection: CompanionModelConnection;
  rawCatalog: CompanionModelInfo[];
  /** Curated, official, active, wired shortlist. Kept as `catalog` for runtime compatibility. */
  catalog: CompanionModelInfo[];
  catalogFetchedAt: string;
  catalogConnectionRevision: string;
  catalogSource: "provider" | "maintained" | "none";
}
export interface RuntimeModelVault {
  activeConnectionId: string | null;
  connections: RuntimeModelConnectionRecord[];
  assignments: CapabilityAssignments;
  chatPreferences: ChatInvocationPreferences;
  quickSetup?: ModelQuickSetupSnapshot;
}

interface SavedRecord {
  id?: string; label?: string; provider?: string; protocol?: CompanionModelProtocol;
  baseUrl?: string; model?: string; cipher?: string; connectionRevision?: string;
  credentialCiphers?: Record<string, string>; providerSettings?: Record<string, string>;
  networkFingerprint?: string;
  selectionMode?: "auto" | "manual"; registeredModels?: string[]; favoriteModels?: string[]; enabledModels?: string[]; modelChecks?: Record<string, CompanionModelCheck>; capabilityChecks?: Record<string, CompanionCapabilityCheck>;
  models?: CompanionModelInfo[]; rawModels?: CompanionModelInfo[]; eligibleModels?: CompanionModelInfo[]; modelsFetchedAt?: string; catalogConnectionRevision?: string;
  catalogSource?: "provider" | "maintained" | "none";
}
export interface SavedModelVaultFile extends SavedRecord {
  version?: number; encryption?: string; activeConnectionId?: string | null;
  connections?: SavedRecord[]; assignments?: CapabilityAssignments; chatPreferences?: ChatInvocationPreferences;
  quickSetup?: ModelQuickSetupSnapshot;
}

const safeId = (value: unknown, fallback: () => string) => typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : fallback();

function decodeRecord(saved: SavedRecord, decrypt: (cipher: string) => string, createId: () => string, bindLegacy: boolean): RuntimeModelConnectionRecord | null {
  if (!saved.provider) return null;
  const credentials: Record<string, string> = {};
  for (const [name, cipher] of Object.entries(saved.credentialCiphers || {})) {
    if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) && typeof cipher === "string" && cipher) credentials[name] = decrypt(cipher).trim();
  }
  if (!credentials.apiKey && saved.cipher) credentials.apiKey = decrypt(saved.cipher).trim();
  const connection = ensureConnectionRevision(normalizeCompanionModelConnection({
    provider: saved.provider as CompanionModelProvider, protocol: saved.protocol, baseUrl: saved.baseUrl, model: saved.model,
    apiKey: credentials.apiKey || "", credentials, providerSettings: saved.providerSettings, selectionMode: saved.selectionMode,
    registeredModels: saved.registeredModels ?? saved.favoriteModels, connectionRevision: saved.connectionRevision,
    enabledModels: saved.enabledModels,
    capabilityChecks: saved.capabilityChecks,
    networkFingerprint: saved.networkFingerprint,
  }));
  connection.modelChecks = bindLegacy
    ? bindModelChecksToRevision(saved.modelChecks, connection.connectionRevision!)
    : retainModelChecksForRevision(saved.modelChecks, connection.connectionRevision!);
  const id = safeId(saved.id, createId);
  return {
    id, label: String(saved.label || `${connection.provider} · ${connection.baseUrl}`).slice(0, 120), connection,
    rawCatalog: Array.isArray(saved.rawModels) ? saved.rawModels : Array.isArray(saved.models) ? saved.models : [],
    catalog: Array.isArray(saved.eligibleModels) ? saved.eligibleModels : eligibleCuratedCatalog(connection.provider, connection.baseUrl), catalogFetchedAt: String(saved.modelsFetchedAt || ""),
    catalogConnectionRevision: String(saved.catalogConnectionRevision || connection.connectionRevision || ""),
    catalogSource: saved.catalogSource === "provider" || saved.catalogSource === "maintained" ? saved.catalogSource : "none",
  };
}

export function decodeModelVault(saved: SavedModelVaultFile | undefined, decrypt: (cipher: string) => string, createId: () => string): RuntimeModelVault {
  if (!saved) return { activeConnectionId: null, connections: [], assignments: emptyCapabilityAssignments(), chatPreferences: defaultChatInvocationPreferences() };
  if ([5, 6, 7, 8, 9].includes(Number(saved.version)) && Array.isArray(saved.connections)) {
    let failedRecords = 0;
    const connections = saved.connections.map((item) => {
      try { return decodeRecord(item, decrypt, createId, false); }
      catch { failedRecords += 1; return null; }
    }).filter((item): item is RuntimeModelConnectionRecord => Boolean(item));
    if (failedRecords) console.error(`[companion] ${failedRecords} 条模型连接因解密或结构错误未能恢复；其余连接已保留。`);
    const activeConnectionId = saved.activeConnectionId === null
      ? null
      : connections.some((item) => item.id === saved.activeConnectionId)
        ? saved.activeConnectionId!
        : connections[0]?.id || null;
    const assignments = normalizeCapabilityAssignments(saved.assignments?.system, saved.assignments?.scenes);
    // Legacy `reasoning` model refs are intentionally ignored. Reasoning is an
    // invocation parameter of the selected chat model, never another resource.
    const quickSetup = normalizeModelQuickSetupSnapshot(saved.quickSetup);
    return {
      activeConnectionId,
      connections: migrateLegacyEnabledModels(connections, assignments),
      assignments,
      chatPreferences: normalizeChatPreferences(saved.chatPreferences),
      ...(quickSetup ? { quickSetup } : {}),
    };
  }
  if ([2, 3, 4].includes(Number(saved.version)) && saved.provider) {
    const record = decodeRecord(saved, decrypt, createId, saved.version !== 4);
    if (!record) return { activeConnectionId: null, connections: [], assignments: emptyCapabilityAssignments(), chatPreferences: defaultChatInvocationPreferences() };
    const assignments = emptyCapabilityAssignments();
    assignments.system.chat = { mode: "fixed", ref: { connectionId: record.id, modelId: record.connection.model, capability: "chat" } };
    return { activeConnectionId: record.id, connections: migrateLegacyEnabledModels([record], assignments), assignments, chatPreferences: defaultChatInvocationPreferences() };
  }
  return { activeConnectionId: null, connections: [], assignments: emptyCapabilityAssignments(), chatPreferences: defaultChatInvocationPreferences() };
}

function migrateLegacyEnabledModels(connections: RuntimeModelConnectionRecord[], assignments: CapabilityAssignments): RuntimeModelConnectionRecord[] {
  return connections.map((record) => {
    if (record.connection.enabledModels !== undefined) return record;
    const enabled = new Set<string>([record.connection.model, ...Object.keys(record.connection.modelChecks || {})]);
    const collect = (assignment: CapabilityAssignments["system"][ModelCapability]) => {
      if (assignment.mode === "fixed" && assignment.ref.connectionId === record.id) enabled.add(assignment.ref.modelId);
    };
    for (const assignment of Object.values(assignments.system)) collect(assignment);
    for (const scene of Object.values(assignments.scenes)) for (const assignment of Object.values(scene)) if (assignment) collect(assignment);
    return { ...record, connection: { ...record.connection, enabledModels: normalizeFavoriteModels([...enabled]) } };
  });
}

function normalizeChatPreferences(value: unknown): ChatInvocationPreferences {
  const allowed = new Set(["auto", "none", "low", "medium", "high", "xhigh", "max"]);
  const source = value && typeof value === "object" ? value as Partial<ChatInvocationPreferences> : {};
  const systemValue = source.system?.reasoningEffort;
  const result = defaultChatInvocationPreferences();
  if (allowed.has(String(systemValue))) result.system.reasoningEffort = systemValue!;
  for (const [scene, item] of Object.entries(source.scenes || {})) {
    if (scene === "task" || scene === "task_workspace") continue;
    if (item && allowed.has(String(item.reasoningEffort))) result.scenes[scene] = { reasoningEffort: item.reasoningEffort };
  }
  const sourceScenes = source.scenes || {};
  const taskPreference = Object.prototype.hasOwnProperty.call(sourceScenes, "task_workspace")
    ? sourceScenes.task_workspace
    : sourceScenes.task;
  if (taskPreference && allowed.has(String(taskPreference.reasoningEffort))) {
    result.scenes.task_workspace = { reasoningEffort: taskPreference.reasoningEffort };
  }
  return result;
}

export function encodeModelVault(vault: RuntimeModelVault, encrypt: (secret: string) => string): SavedModelVaultFile {
  return {
    version: 9, encryption: "windows-dpapi-per-secret", activeConnectionId: vault.activeConnectionId,
    assignments: vault.assignments,
    chatPreferences: vault.chatPreferences,
    ...(vault.quickSetup ? { quickSetup: vault.quickSetup } : {}),
    connections: vault.connections.map((record) => ({
      id: record.id, label: record.label, provider: record.connection.provider, protocol: record.connection.protocol,
      baseUrl: record.connection.baseUrl, model: record.connection.model, selectionMode: record.connection.selectionMode || "manual",
      connectionRevision: record.connection.connectionRevision,
      networkFingerprint: record.connection.networkFingerprint,
      modelChecks: retainModelChecksForRevision(record.connection.modelChecks, record.connection.connectionRevision || ""),
      capabilityChecks: Object.fromEntries(Object.entries(record.connection.capabilityChecks || {}).filter(([, check]) => check.connectionRevision === record.connection.connectionRevision)),
      registeredModels: record.connection.registeredModels || [], enabledModels: record.connection.enabledModels || [], rawModels: record.rawCatalog, eligibleModels: record.catalog, modelsFetchedAt: record.catalogFetchedAt,
      catalogConnectionRevision: record.catalogConnectionRevision, catalogSource: record.catalogSource,
      providerSettings: record.connection.providerSettings || {},
      credentialCiphers: Object.fromEntries(Object.entries(record.connection.credentials || (record.connection.apiKey ? { apiKey: record.connection.apiKey } : {})).filter(([, value]) => Boolean(value)).map(([name, value]) => [name, encrypt(value)])),
    })),
  };
}

export function activeVaultRecord(vault: RuntimeModelVault): RuntimeModelConnectionRecord | undefined {
  return vault.connections.find((item) => item.id === vault.activeConnectionId);
}

export async function runAtomicVaultActivation(
  previous: RuntimeModelVault,
  next: RuntimeModelVault,
  hooks: {
    persist: (vault: RuntimeModelVault) => void | Promise<void>;
    activate: (vault: RuntimeModelVault) => void | Promise<void>;
    restore: (vault: RuntimeModelVault) => void | Promise<void>;
  },
): Promise<void> {
  let committed = false;
  try {
    await hooks.persist(next);
    committed = true;
    await hooks.activate(next);
  } catch (error) {
    let rollbackError: unknown;
    if (committed) {
      try { await hooks.persist(previous); } catch (failure) { rollbackError = failure; }
    }
    try { await hooks.restore(previous); } catch (failure) { rollbackError ??= failure; }
    if (rollbackError) throw new Error(`模型连接提交失败，回滚也未完整落盘：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error });
    throw error;
  }
}
