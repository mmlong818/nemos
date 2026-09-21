import { companionModelCapabilities, openAIReasoningFamily, type CompanionModelConnection } from "./model-connection.js";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
// Provider capability profiles take precedence; OpenAI Responses families then
// retain their transport-coupled effort list. Unknown/proxied models opt out.
export function supportedReasoningEfforts(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string): ReasoningEffort[] {
  return [...(companionModelCapabilities(connection, model).reasoningEfforts
    ?? openAIReasoningFamily(connection, model)?.efforts
    ?? [])];
}
export function resolveReasoningEffort(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string, value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (typeof value !== "string" || !supportedReasoningEfforts(connection, model).includes(value as ReasoningEffort)) {
    throw new Error("当前模型不支持所选思考强度，请选择自动或重新选择强度。");
  }
  return value as ReasoningEffort;
}

const EFFORT_ORDER: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

/**
 * 实际发给厂商的强度。用户显式选择的原样返回；「自动」在 thinking 已开启的型号上取
 * 最低可用档，让推理长度有界，正文不会被 max_tokens 截空。其他型号仍不发该字段。
 */
export function effectiveReasoningEffort(
  connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined,
  model: string,
  requested: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (requested) return requested;
  if (companionModelCapabilities(connection, model).thinking !== "enabled") return undefined;
  const supported = supportedReasoningEfforts(connection, model);
  return EFFORT_ORDER.find((effort) => effort !== "none" && supported.includes(effort));
}

export function resolveReasoningPreference(
  connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined,
  model: string,
  values: { request?: ReasoningEffort | "auto"; scene?: ReasoningEffort | "auto"; system?: ReasoningEffort | "auto" },
): ReasoningEffort | undefined {
  return resolveReasoningEffort(connection, model, values.request ?? values.scene ?? values.system ?? "auto");
}
