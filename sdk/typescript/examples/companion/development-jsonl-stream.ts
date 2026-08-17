import type { DevelopmentTelemetryEvent } from "./pi-development.js";

/** 把 CLI 的 JSONL stdout 增量投影为前端可理解的原生执行事件。 */
export class DevelopmentJsonlEventStream {
  #pending = "";

  constructor(private readonly emit?: (event: DevelopmentTelemetryEvent) => void) {}

  push(chunk: Buffer | string): void {
    if (!this.emit) return;
    this.#pending += chunk.toString();
    const lines = this.#pending.split(/\r?\n/);
    this.#pending = lines.pop() ?? "";
    for (const line of lines) this.emitLine(line);
  }

  flush(): void {
    if (this.#pending) this.emitLine(this.#pending);
    this.#pending = "";
  }

  private emitLine(line: string): void {
    if (!line.trim() || !this.emit) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const part = event.part && typeof event.part === "object" ? event.part as Record<string, unknown> : undefined;
      const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : undefined;
      const type = String(event.type || part?.type || item?.type || "engine/event");
      const toolName = String(event.tool || event.tool_name || part?.tool || item?.tool || item?.name || "").trim() || undefined;
      this.emit({ type, toolName, at: new Date().toISOString() });
    } catch {
      // 普通文本仍由最终结果解析器处理，不伪造结构化事件。
    }
  }
}
