// sources 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { Type } from "typebox";
import { type KnowledgeItemKind } from "../knowledge-library.js";
import { userFacingMessage } from "../office-errors.js";
import { importWeChatPrivateSource, loadPrivateSourcesConfig, privateSourcesSummary, savePrivateSourcesConfig, type PrivateSourcesConfig } from "../private-source-connectors.js";
import { AgentUserActionGateway } from "../../../src/index.js";
import { KnowledgeLibrary } from "../knowledge-library.js";
import { createMarketDataAdapter } from "../market-data-adapter.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface SourceDeps {
  readonly DATA_DIR: string;
  readonly X_OAUTH_REDIRECT: string;
  readonly agentUserActions: AgentUserActionGateway;
  readonly clearSavedXToken: () => void;
  readonly completeXOAuth: (code: string, state: string) => Promise<{ userId: string; username?: string; name?: string }>;
  readonly knowledgeLibrary: KnowledgeLibrary;
  readonly marketData: ReturnType<typeof createMarketDataAdapter>;
  readonly modelConnectionUserMessage: (detail: string) => string;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly saveSavedXToken: (input: { bearerToken?: string; userAccessToken?: string; refreshToken?: string; clientSecret?: string }) => void;
  readonly savedXTokenExists: () => boolean;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  readonly startXOAuth: (input: { clientId?: string; clientSecret?: string }) => { authorizationUrl: string; redirectUri: string; state: string };
  readonly xOAuthCallbackHtml: (ok: boolean, detail: string) => string;
  // TSC_DEPS
}

export function createSourceRoutes(deps: SourceDeps): RouteEntry[] {
  const { DATA_DIR, X_OAUTH_REDIRECT, agentUserActions, clearSavedXToken, completeXOAuth, knowledgeLibrary, marketData, modelConnectionUserMessage, readBody, saveSavedXToken, savedXTokenExists, send, startXOAuth, xOAuthCallbackHtml } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("GET", "/api/knowledge", ({ res, url }) => {
      const params = new URLSearchParams(url.split("?")[1] || "");
      const id = params.get("id");
      if (id) {
        const item = knowledgeLibrary.get(id);
        if (!item) { send(res, 404, { error: "未找到这份资料" }); return; }
        send(res, 200, { ok: true, item });
      } else {
        send(res, 200, { ok: true, items: knowledgeLibrary.list(params.get("archived") === "1") });
      }
      return;
    }),
    route("POST", "/api/knowledge", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        id?: string;
        title?: string;
        kind?: KnowledgeItemKind;
        content?: string;
        sourceUrl?: string;
        fileName?: string;
        mimeType?: string;
        spaceId?: string | null;
      };
      if (!b.id && !b.title?.trim()) { send(res, 400, { error: "资料名称不能为空" }); return; }
      try {
        const item = b.id
          ? knowledgeLibrary.update({ id: b.id, title: b.title, content: b.content, sourceUrl: b.sourceUrl, spaceId: b.spaceId })
          : knowledgeLibrary.create({
              title: b.title!, kind: b.kind, content: b.content, sourceUrl: b.sourceUrl,
              fileName: b.fileName, mimeType: b.mimeType, spaceId: b.spaceId || undefined,
            });
        send(res, 200, { ok: true, item, items: knowledgeLibrary.list() });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("GET", "/api/sources", ({ res }) => {
      send(res, 200, {
        ok: true,
        savedXToken: savedXTokenExists(),
        xOAuthRedirect: X_OAUTH_REDIRECT,
        sources: privateSourcesSummary(DATA_DIR),
      });
      return;
    }),
    route("POST", "/api/sources", async ({ req, res }) => {
      const b = (await readBody(req)) as {
        config?: Partial<PrivateSourcesConfig>;
        xBearerToken?: string;
        xUserAccessToken?: string;
        xRefreshToken?: string;
        xClientSecret?: string;
        clearXToken?: boolean;
      };
      const action = await agentUserActions.execute({
        name: "private_sources_update",
        description: "保存用户在数据源设置页提交的私域来源配置",
        arguments: {
          wechatConfigUpdated: Boolean(b.config?.wechat),
          xConfigUpdated: Boolean(b.config?.x),
          xCredentialsUpdated: Boolean(b.xBearerToken || b.xUserAccessToken || b.xRefreshToken || b.xClientSecret),
          clearXToken: Boolean(b.clearXToken),
        },
        execute: () => {
          if (b.clearXToken) clearSavedXToken();
          if (b.xBearerToken || b.xUserAccessToken || b.xRefreshToken || b.xClientSecret) {
            saveSavedXToken({
              bearerToken: b.xBearerToken,
              userAccessToken: b.xUserAccessToken,
              refreshToken: b.xRefreshToken,
              clientSecret: b.xClientSecret,
            });
          }
          const current = loadPrivateSourcesConfig(DATA_DIR);
          const config = savePrivateSourcesConfig(DATA_DIR, {
            wechat: { ...current.wechat, ...(b.config?.wechat ?? {}) },
            x: { ...current.x, ...(b.config?.x ?? {}) },
          });
          return {
            config,
            savedXToken: savedXTokenExists(),
            xOAuthRedirect: X_OAUTH_REDIRECT,
            sources: privateSourcesSummary(DATA_DIR),
          };
        },
        summarizeResult: (value) => ({ ok: true, savedXToken: value.savedXToken }),
      });
      send(res, 200, { ok: true, ...action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/sources/x/oauth/start", async ({ req, res }) => {
      try {
        const b = (await readBody(req)) as { clientId?: string; clientSecret?: string };
        const action = await agentUserActions.execute({
          name: "source_x_oauth_start",
          description: "开始用户在数据源设置页发起的 X OAuth 授权",
          arguments: {
            clientIdConfigured: Boolean(b.clientId?.trim()),
            clientSecretUpdated: Boolean(b.clientSecret),
          },
          execute: () => {
            const oauth = startXOAuth(b);
            const current = loadPrivateSourcesConfig(DATA_DIR);
            savePrivateSourcesConfig(DATA_DIR, {
              wechat: current.wechat,
              x: { ...current.x, oauthClientId: b.clientId?.trim() || current.x.oauthClientId },
            });
            if (b.clientSecret) saveSavedXToken({ clientSecret: b.clientSecret });
            return { ...oauth, sources: privateSourcesSummary(DATA_DIR) };
          },
          summarizeResult: () => ({ ok: true, provider: "x", authorizationStarted: true }),
        });
        send(res, 200, { ok: true, ...action.value, auditRunId: action.runId });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error(`[companion] 模型连接验证失败：${detail}`);
        send(res, 400, { ok: false, error: detail, userMessage: modelConnectionUserMessage(detail) });
      }
      return;
    }),
    route("GET", "/api/sources/x/oauth/callback", async ({ res, url }) => {
      const q = new URLSearchParams(url.split("?")[1] || "");
      const code = q.get("code") || "";
      const state = q.get("state") || "";
      const denied = q.get("error") || "";
      try {
        if (denied) throw new Error(`X 授权取消或失败：${denied}`);
        if (!code || !state) throw new Error("X 回调缺少 code 或 state");
        const action = await agentUserActions.execute({
          name: "source_x_oauth_complete",
          description: "完成用户已在 X 授权页确认的 OAuth 连接",
          arguments: { provider: "x" },
          metadata: { origin: "oauth-callback" },
          execute: () => completeXOAuth(code, state),
          summarizeResult: (me) => ({ ok: true, provider: "x", userId: me.userId, username: me.username }),
        });
        const me = action.value;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(xOAuthCallbackHtml(true, `已连接 @${me.username || me.userId}，Home Timeline 会在小丑鱼执行任务时作为私域来源读取。`));
      } catch (e) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(xOAuthCallbackHtml(false, "授权未完成，请返回设置后重试。"));
      }
      return;
    }),
    route("POST", "/api/sources/wechat/import", async ({ req, res }) => {
      const b = (await readBody(req)) as { title?: string; text?: string; url?: string; source?: string };
      if (!b.text && !b.url) {
        send(res, 400, { error: "missing text or url" });
        return;
      }
      const action = await agentUserActions.execute({
        name: "source_wechat_import",
        description: "导入用户提交的微信私域资料",
        arguments: {
          title: b.title,
          source: b.source,
          url: b.url,
          textChars: b.text?.length ?? 0,
        },
        execute: () => importWeChatPrivateSource(DATA_DIR, b),
        summarizeResult: (item) => ({ ok: true, file: item.file, title: item.title }),
      });
      send(res, 200, { ok: true, item: action.value, auditRunId: action.runId, sources: privateSourcesSummary(DATA_DIR) });
      return;
    }),
    route("GET", "/api/market/watchlist", async ({ res }) => {
      send(res, 200, { items: await marketData.listWatchlist() });
      return;
    }),
    route("POST", "/api/market/watchlist",
      Type.Object({ symbol: Type.Optional(Type.String()), name: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      if (!body.symbol?.trim()) { send(res, 400, { error: "缺少港股代码" }); return; }
      const action = await agentUserActions.execute({
        name: "market_watchlist_add",
        description: "把用户指定的港股代码加入本机关注列表",
        arguments: { symbol: body.symbol, name: body.name },
        execute: () => marketData.addWatchItem({ symbol: body.symbol!, name: body.name }),
        summarizeResult: (items) => ({ ok: true, symbol: body.symbol, count: items.length }),
      });
      send(res, 200, { ok: true, items: action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/market/watchlist/remove",
      Type.Object({ symbol: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      if (!body.symbol?.trim()) { send(res, 400, { error: "缺少港股代码" }); return; }
      const action = await agentUserActions.execute({
        name: "market_watchlist_remove",
        description: "从本机市场关注列表移除用户指定的港股代码",
        arguments: { symbol: body.symbol },
        execute: () => marketData.removeWatchItem(body.symbol!),
        summarizeResult: (items) => ({ ok: true, symbol: body.symbol, count: items.length }),
      });
      send(res, 200, { ok: true, items: action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/market/snapshot",
      Type.Object({ symbols: Type.Optional(Type.Array(Type.String())), announcementLimit: Type.Optional(Type.Number()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      try {
        const snapshot = await marketData.snapshot({
          symbols: Array.isArray(body.symbols) ? body.symbols.map(String) : undefined,
          announcementLimit: body.announcementLimit,
        });
        send(res, 200, snapshot);
      } catch (error) {
        send(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }),
  ];
}
