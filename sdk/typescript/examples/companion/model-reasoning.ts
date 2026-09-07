import type { CompanionModelConnection } from "./model-connection.js";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
// Official model pages checked 2026-09-07. Unknown/proxy models are not assumed compatible.
export function supportedReasoningEfforts(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string): ReasoningEffort[] {
  if (connection?.provider !== "openai" || connection.protocol !== "openai-compatible") return [];
  if (model === "gpt-6-astra") return ["low", "medium", "high", "xhigh", "max"];
  if (["gpt-5.6-terra", "gpt-5.6-luna"].includes(model)) return ["none", "low", "medium", "high", "xhigh", "max"];
  return [];
}
export function resolveReasoningEffort(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string, value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (typeof value !== "string" || !supportedReasoningEfforts(connection, model).includes(value as ReasoningEffort)) {
    throw new Error("当前模型不支持所选思考强度，请选择自动或重新选择强度。");
  }
  return value as ReasoningEffort;
}
