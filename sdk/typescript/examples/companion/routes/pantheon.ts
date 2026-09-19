import { type ServerResponse } from "node:http";
import { Type } from "typebox";
import { PantheonService } from "../pantheon.js";
import { ThoughtLibraryStore, type ThoughtDraftPatch } from "../thought-library.js";
import { route, type RouteEntry } from "./table.js";

export interface PantheonRouteDeps {
  readonly pantheon: PantheonService;
  readonly thoughtLibrary: ThoughtLibraryStore;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
}

const Intent = Type.Union([
  Type.Literal("explore"), Type.Literal("challenge"), Type.Literal("decision"), Type.Literal("answer"),
]);
const Kind = Type.Union([Type.Literal("person"), Type.Literal("role"), Type.Literal("framework")]);
const TextList = Type.Array(Type.String({ maxLength: 500 }), { maxItems: 8 });

function fail(send: PantheonRouteDeps["send"], res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : "万神殿暂时无法完成这项操作";
  send(res, /不存在|找不到/.test(message) ? 404 : /达到|不能|不允许|请选择/.test(message) ? 409 : 400, { ok: false, error: message, userMessage: message });
}

export function createPantheonRoutes(deps: PantheonRouteDeps): RouteEntry[] {
  const { pantheon, thoughtLibrary, send } = deps;
  return [
    route("GET", "/api/pantheon/catalog", ({ res }) => {
      try { send(res, 200, { ok: true, models: pantheon.catalog() }); }
      catch (error) { fail(send, res, error); }
    }),
    route("POST", "/api/pantheon/session",
      Type.Object({
        issue: Type.String({ minLength: 4, maxLength: 12_000 }),
        intent: Type.Optional(Intent),
        modelIds: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { minItems: 1, maxItems: 3 })),
      }, { additionalProperties: false }),
      ({ res }, body) => {
        try { send(res, 201, { ok: true, session: pantheon.createSession(body) }); }
        catch (error) { fail(send, res, error); }
      }),
    route("GET", "/api/pantheon/session", ({ res, query }) => {
      const session = pantheon.getSession(query.get("id") ?? "");
      if (!session) send(res, 404, { ok: false, error: "讨论会话不存在或服务已重启" });
      else send(res, 200, { ok: true, session });
    }),
    route("POST", "/api/pantheon/session/models",
      Type.Object({
        sessionId: Type.String({ minLength: 1, maxLength: 120 }),
        modelIds: Type.Array(Type.String({ maxLength: 120 }), { minItems: 1, maxItems: 3 }),
      }, { additionalProperties: false }),
      ({ res }, body) => {
        try { send(res, 200, { ok: true, session: pantheon.adjustSeats(body.sessionId, body.modelIds) }); }
        catch (error) { fail(send, res, error); }
      }),
    route("POST", "/api/pantheon/session/interject",
      Type.Object({ sessionId: Type.String({ minLength: 1, maxLength: 120 }), text: Type.String({ minLength: 1, maxLength: 2_000 }) }, { additionalProperties: false }),
      ({ res }, body) => {
        try { send(res, 200, { ok: true, session: pantheon.interject(body.sessionId, body.text) }); }
        catch (error) { fail(send, res, error); }
      }),
    route("POST", "/api/pantheon/session/advance",
      Type.Object({
        sessionId: Type.String({ minLength: 1, maxLength: 120 }),
        action: Type.Optional(Type.Union([Type.Literal("next"), Type.Literal("continue"), Type.Literal("converge")])),
      }, { additionalProperties: false }),
      async ({ res }, body) => {
        try { send(res, 200, { ok: true, session: await pantheon.advance(body.sessionId, body.action) }); }
        catch (error) { fail(send, res, error); }
      }),
    route("GET", "/api/pantheon/thoughts", ({ res }) => {
      try { send(res, 200, { ok: true, units: thoughtLibrary.list() }); }
      catch (error) { fail(send, res, error); }
    }),
    route("POST", "/api/pantheon/distill",
      Type.Object({
        displayName: Type.String({ minLength: 1, maxLength: 80 }),
        kind: Kind,
        sourceLabel: Type.Optional(Type.String({ maxLength: 160 })),
        sourceKind: Type.Optional(Type.Union([Type.Literal("public_source"), Type.Literal("user_material")])),
        material: Type.Optional(Type.String({ maxLength: 20_000 })),
      }, { additionalProperties: false }),
      async ({ res }, body) => {
        try { send(res, 201, { ok: true, unit: await thoughtLibrary.createDraft(body) }); }
        catch (error) { fail(send, res, error); }
      }),
    route("POST", "/api/pantheon/thought",
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 120 }),
        displayName: Type.Optional(Type.String({ maxLength: 80 })),
        applicableProblems: Type.Optional(TextList),
        corePrinciples: Type.Optional(TextList),
        judgmentSteps: Type.Optional(TextList),
        counterexamplesAndLimits: Type.Optional(TextList),
        questioningStyle: Type.Optional(TextList),
        uncertaintyStatements: Type.Optional(TextList),
      }, { additionalProperties: false }),
      ({ res }, body) => {
        const { id, ...patch } = body;
        try { send(res, 200, { ok: true, unit: thoughtLibrary.updateDraft(id, patch as ThoughtDraftPatch) }); }
        catch (error) { fail(send, res, error); }
      }),
    route("POST", "/api/pantheon/thought/status",
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 120 }),
        action: Type.Union([Type.Literal("submit_review"), Type.Literal("approve"), Type.Literal("publish"), Type.Literal("enable"), Type.Literal("disable")]),
      }, { additionalProperties: false }),
      ({ res }, body) => {
        try {
          const unit = body.action === "enable" ? thoughtLibrary.setEnabled(body.id, true)
            : body.action === "disable" ? thoughtLibrary.setEnabled(body.id, false)
              : thoughtLibrary.transition(body.id, body.action);
          send(res, 200, { ok: true, unit });
        } catch (error) { fail(send, res, error); }
      }),
    route("POST", "/api/pantheon/thought/delete",
      Type.Object({ id: Type.String({ minLength: 1, maxLength: 120 }) }, { additionalProperties: false }),
      ({ res }, body) => {
        try { send(res, 200, { ok: true, deleted: thoughtLibrary.remove(body.id) }); }
        catch (error) { fail(send, res, error); }
      }),
  ];
}
