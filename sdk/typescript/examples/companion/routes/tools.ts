// tools 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { Type } from "typebox";
import { type PersonaToolBinding } from "../persona-tool-bindings.js";
import { AgentUserActionGateway } from "../../../src/index.js";
import { PersonaToolBindings } from "../persona-tool-bindings.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ToolSettings } from "../server.js";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface ToolDeps {
  readonly agentUserActions: AgentUserActionGateway;
  readonly loadToolSettings: () => ToolSettings;
  readonly personaToolBindings: PersonaToolBindings;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly runToolAsrCorrectText: (text: string) => Promise<{ text: string; provider: string }>;
  readonly runToolPolishText: (text: string) => Promise<{ text: string; provider: string }>;
  readonly runToolTranslateText: (text: string) => Promise<{ text: string; provider: string }>;
  readonly saveToolSettings: (settings: Partial<ToolSettings>, zhipuKey?: string, clearZhipuKey?: boolean) => void;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  readonly toolSettingsSummary: () => {
    settings: ToolSettings;
    hasZhipuKey: boolean;
    keySource: "tool" | "env" | "llm" | "none";
    savedKey: boolean;
    file: string;
  };
  // TSC_DEPS
}

export function createToolRoutes(deps: ToolDeps): RouteEntry[] {
  const { agentUserActions, loadToolSettings, personaToolBindings, readBody, runToolAsrCorrectText, runToolPolishText, runToolTranslateText, saveToolSettings, send, toolSettingsSummary } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("GET", "/api/tool-settings", ({ res }) => {
      send(res, 200, { ok: true, ...toolSettingsSummary() });
      return;
    }),
    route("POST", "/api/tool-settings", async ({ req, res }) => {
      const b = (await readBody(req)) as { settings?: Partial<ToolSettings>; zhipuKey?: string; clearZhipuKey?: boolean };
      const action = await agentUserActions.execute({
        name: "tool_settings_update",
        description: "保存用户在工具设置页修改的模型与工具配置",
        arguments: {
          settingKeys: Object.keys(b.settings ?? {}),
          zhipuKeyUpdated: Boolean(b.zhipuKey),
          clearZhipuKey: Boolean(b.clearZhipuKey),
        },
        execute: () => {
          saveToolSettings(b.settings ?? loadToolSettings(), b.zhipuKey, !!b.clearZhipuKey);
          return toolSettingsSummary();
        },
        summarizeResult: (summary) => ({ ok: true, hasZhipuKey: summary.hasZhipuKey }),
      });
      send(res, 200, { ok: true, ...action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/tools/translate", async ({ req, res }) => {
      try {
        const b = (await readBody(req)) as { text?: string };
        const result = await runToolTranslateText(b.text || "");
        send(res, 200, { ok: true, ...result, settings: toolSettingsSummary() });
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e), settings: toolSettingsSummary() });
      }
      return;
    }),
    route("POST", "/api/tools/polish", async ({ req, res }) => {
      try {
        const b = (await readBody(req)) as { text?: string };
        const result = await runToolPolishText(b.text || "");
        send(res, 200, { ok: true, ...result, settings: toolSettingsSummary() });
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e), settings: toolSettingsSummary() });
      }
      return;
    }),
    route("POST", "/api/tools/asr-correct", async ({ req, res }) => {
      try {
        const b = (await readBody(req)) as { text?: string };
        const result = await runToolAsrCorrectText(b.text || "");
        send(res, 200, { ok: true, ...result, settings: toolSettingsSummary() });
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e), settings: toolSettingsSummary() });
      }
      return;
    }),
    route("GET", "/api/persona-tools", ({ res }) => {
      send(res, 200, { ok: true, bindings: personaToolBindings.list() });
      return;
    }),
    route("POST", "/api/persona-tools", async ({ req, res }) => {
      const body = (await readBody(req)) as { personaId?: string } & PersonaToolBinding;
      if (!body.personaId) { send(res, 400, { error: "missing persona id" }); return; }
      send(res, 200, { ok: true, binding: personaToolBindings.set(body.personaId, body) });
      return;
    }),
    route("POST", "/api/persona-tools/clear",
      Type.Object({ personaId: Type.Optional(Type.String()) }, { additionalProperties: false }),
      ({ res }, body) => {
      if (!body.personaId) { send(res, 400, { error: "missing persona id" }); return; }
      send(res, 200, { ok: personaToolBindings.clear(body.personaId) });
      return;
    }),
  ];
}
