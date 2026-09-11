// profile 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { Type } from "typebox";
import { AgentUserActionGateway } from "../../../src/index.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { UserProfile } from "../server.js";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface ProfileDeps {
  readonly agentUserActions: AgentUserActionGateway;
  readonly completeOnboarding: (displayName: unknown) => { profile: UserProfile; messages: string[] };
  readonly generateConversationTitle: (text: string) => Promise<string>;
  readonly publicUserProfile: () => UserProfile;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly saveUserProfile: (next: Partial<UserProfile>) => UserProfile;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  // TSC_DEPS
}

export function createProfileRoutes(deps: ProfileDeps): RouteEntry[] {
  const { agentUserActions, completeOnboarding, generateConversationTitle, publicUserProfile, readBody, saveUserProfile, send } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("GET", "/api/user-profile", ({ res }) => {
      send(res, 200, { ok: true, profile: publicUserProfile() });
      return;
    }),
    route("POST", "/api/user-profile", async ({ req, res }) => {
      const b = (await readBody(req)) as { displayName?: string; personaNicknames?: Record<string, string> };
      const action = await agentUserActions.execute({
        name: "user_profile_update",
        description: "保存用户在个人设置页修改的称呼",
        arguments: {
          displayNameUpdated: b.displayName !== undefined,
          personaNicknameIds: Object.keys(b.personaNicknames ?? {}),
        },
        execute: () => saveUserProfile(b),
        summarizeResult: (profile) => ({ ok: true, profileUpdated: true, nicknameCount: Object.keys(profile.personaNicknames ?? {}).length }),
      });
      send(res, 200, { ok: true, profile: action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/onboarding", async ({ req, res }) => {
      const b = (await readBody(req)) as { displayName?: string };
      const action = await agentUserActions.execute({
        name: "onboarding_complete",
        description: "保存首次启动时用户提交的称呼并生成固定欢迎消息",
        arguments: { displayNameProvided: Boolean(b.displayName?.trim()) },
        execute: () => completeOnboarding(b.displayName),
        summarizeResult: () => ({ ok: true, onboardingCompleted: true }),
      });
      send(res, 200, { ok: true, ...action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/conversation/title",
      Type.Object({ text: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      const text = String(body.text || "").trim();
      if (!text) {
        send(res, 400, { error: "missing text" });
        return;
      }
      send(res, 200, { title: await generateConversationTitle(text) });
      return;
    }),
  ];
}
