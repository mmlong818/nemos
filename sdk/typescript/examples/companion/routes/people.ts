// people 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { Type } from "typebox";
import { normalizeAddedContactIds } from "../contact-roster.js";
import { RELATIONSHIPS } from "../personas.js";
import { type CounterpartPatch } from "../relationship-memory.js";
import { AgentUserActionGateway } from "../../../src/index.js";
import { RelationshipMemory } from "../relationship-memory.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { AvatarOverrides } from "../server.js";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface PeopleDeps {
  readonly addedContactIds: Set<string>;
  readonly agentUserActions: AgentUserActionGateway;
  readonly allPersonaIdsInOrder: () => string[];
  readonly applyRel: (personaId: string) => void;
  readonly currentContactIds: () => string[];
  readonly loadAvatarOverrides: () => AvatarOverrides;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly relOf: Map<string, string>;
  readonly relationships: RelationshipMemory;
  readonly saveAvatarOverride: (owner: string, id: string | undefined, image: string | undefined, clear: boolean) => AvatarOverrides;
  readonly saveContacts: () => void;
  readonly saveRel: () => void;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  // TSC_DEPS
}

export function createPeopleRoutes(deps: PeopleDeps): RouteEntry[] {
  const { addedContactIds, agentUserActions, allPersonaIdsInOrder, applyRel, currentContactIds, loadAvatarOverrides, readBody, relOf, relationships, saveAvatarOverride, saveContacts, saveRel, send } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("GET", "/api/relationships", ({ res, url }) => {
      const id = new URLSearchParams(url.split("?")[1] || "").get("id");
      if (id) {
        const profile = relationships.get(id);
        if (!profile) send(res, 404, { error: "counterpart not found" });
        else send(res, 200, { ok: true, profile });
      } else {
        send(res, 200, { ok: true, profiles: relationships.list() });
      }
      return;
    }),
    route("POST", "/api/relationships", async ({ req, res }) => {
      const body = (await readBody(req)) as { id?: string } & CounterpartPatch;
      if (!body.id) { send(res, 400, { error: "missing counterpart id" }); return; }
      send(res, 200, { ok: true, profile: relationships.upsert(body.id, body) });
      return;
    }),
    route("POST", "/api/relationships/delete",
      Type.Object({ id: Type.Optional(Type.String()) }, { additionalProperties: false }),
      ({ res }, body) => {
      if (!body.id) { send(res, 400, { error: "missing counterpart id" }); return; }
      send(res, 200, { ok: relationships.remove(body.id) });
      return;
    }),
    route("POST", "/api/relationship", async ({ req, res }) => {
      const b = (await readBody(req)) as { personaId: string; relationship: string };
      if (!RELATIONSHIPS.some((r) => r.id === b.relationship)) {
        send(res, 400, { error: "unknown relationship" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "relationship_update",
        description: "保存用户为角色选择的关系类型",
        arguments: { personaId: b.personaId, relationship: b.relationship },
        metadata: { personaId: b.personaId },
        execute: () => {
          relOf.set(b.personaId, b.relationship);
          applyRel(b.personaId);
          saveRel();
          return { personaId: b.personaId, relationship: b.relationship };
        },
        summarizeResult: (value) => ({ ok: true, ...value }),
      });
      send(res, 200, { ok: true, ...action.value, auditRunId: action.runId });
      return;
    }),
    route("GET", "/api/avatars", ({ res }) => {
      send(res, 200, { avatars: loadAvatarOverrides() });
      return;
    }),
    route("POST", "/api/avatar", async ({ req, res }) => {
      const b = (await readBody(req)) as { owner?: string; id?: string; image?: string; clear?: boolean };
      try {
        const action = await agentUserActions.execute({
          name: "avatar_update",
          description: b.clear ? "清除用户在头像编辑器选中的头像" : "保存用户在头像编辑器裁剪后的头像",
          arguments: {
            owner: String(b.owner ?? ""),
            personaId: b.id,
            clear: Boolean(b.clear),
            imageChars: b.image?.length ?? 0,
          },
          metadata: b.id ? { personaId: b.id } : undefined,
          execute: () => saveAvatarOverride(String(b.owner ?? ""), b.id, b.image, !!b.clear),
          summarizeResult: () => ({ ok: true, owner: b.owner, personaId: b.id, cleared: Boolean(b.clear) }),
        });
        send(res, 200, { ok: true, avatars: action.value, auditRunId: action.runId });
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }),
    route("POST", "/api/contacts/add", async ({ req, res }) => {
      const b = (await readBody(req)) as { personaIds?: unknown };
      const ids = normalizeAddedContactIds(allPersonaIdsInOrder(), b.personaIds);
      const action = await agentUserActions.execute({
        name: "contacts_add",
        description: "把用户在联系人选择器勾选的角色加入通讯录",
        arguments: { personaIds: ids },
        execute: () => {
          for (const id of ids) addedContactIds.add(id);
          saveContacts();
          return { contactIds: currentContactIds() };
        },
        summarizeResult: (value) => ({ ok: true, added: ids, contactCount: value.contactIds.length }),
      });
      send(res, 200, { ok: true, ...action.value, auditRunId: action.runId });
      return;
    }),
  ];
}
