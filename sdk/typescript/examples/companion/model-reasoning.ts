import { openAIReasoningFamily, type CompanionModelConnection } from "./model-connection.js";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
// Efforts and transport come from OPENAI_REASONING_FAMILIES so the two cannot drift apart.
// Unknown and proxied models are still not assumed compatible.
export function supportedReasoningEfforts(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string): ReasoningEffort[] {
  return [...(openAIReasoningFamily(connection, model)?.efforts ?? [])];
}
export function resolveReasoningEffort(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string, value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (typeof value !== "string" || !supportedReasoningEfforts(connection, model).includes(value as ReasoningEffort)) {
    throw new Error("当前模型不支持所选思考强度，请选择自动或重新选择强度。");
  }
  return value as ReasoningEffort;
}
