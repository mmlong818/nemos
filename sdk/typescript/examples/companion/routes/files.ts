// files 域：办公文件导入、工作副本会话、导出与工作台状态。
//
// 处理函数体是从 server.ts 的 if 链逐条搬来的，未改写；这一层只做两件事：
// 匹配口径统一到 pathname，以及对形状固定的 body 做运行时校验。
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Type } from "typebox";

import type { AgentUserActionGateway } from "../../../src/index.js";
import { userFacingMessage } from "../office-errors.js";
import { exportOfficeDocument, type OfficeExportFormat } from "../office-export.js";
import { MAX_OFFICE_FILE_BYTES, officeExtractionFromMarkdown } from "../office-file-parser.js";
import type { OfficeFileSessionStore } from "../office-file-sessions.js";
import { convertOfficeToMarkdown } from "../office-to-markdown.js";
import { OfficeWorkbenchRevisionConflict, type OfficeWorkbenchStateStore } from "../office-workbench-state.js";
import type { TaskFileOwnerKind, TaskFileRegistry } from "../task-files.js";
import { route, type RouteEntry } from "./table.js";

/** server.ts 持有的那几个实例与两个响应助手，由调用方注入。 */
export interface FilesRouteDeps {
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly taskFiles: TaskFileRegistry;
  readonly officeFileSessions: OfficeFileSessionStore;
  readonly officeWorkbenchState: OfficeWorkbenchStateStore;
  readonly agentUserActions: AgentUserActionGateway;
}

function officeSessionContentType(extension: string): string {
  return ({
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docm: "application/vnd.ms-word.document.macroEnabled.12",
    odt: "application/vnd.oasis.opendocument.text",
    rtf: "application/rtf",
    epub: "application/epub+zip",
    ppt: "application/vnd.ms-powerpoint",
    pps: "application/vnd.ms-powerpoint",
    pot: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
    ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
    odp: "application/vnd.oasis.opendocument.presentation",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    csv: "text/csv; charset=utf-8",
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

export function createFileRoutes(deps: FilesRouteDeps): RouteEntry[] {
  const { send, readBody, taskFiles, officeFileSessions, officeWorkbenchState, agentUserActions } = deps;
  // 导出下载的短期暂存，只有本域用。
  const preparedOfficeExports = new Map<string, {
    data: Buffer;
    contentType: string;
    filename: string;
    expiresAt: number;
  }>();
  return [
    route("GET", "/api/files/export", ({ res, url }) => {
      const id = new URL(url, "http://127.0.0.1").searchParams.get("id") || "";
      const prepared = preparedOfficeExports.get(id);
      if (!prepared || prepared.expiresAt < Date.now()) {
        if (id) preparedOfficeExports.delete(id);
        send(res, 404, { error: "下载已过期，请重新导出" });
        return;
      }
      preparedOfficeExports.delete(id);
      res.writeHead(200, {
        "Content-Type": prepared.contentType,
        "Content-Length": prepared.data.length,
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(prepared.filename),
        "Cache-Control": "no-store",
      });
      res.end(prepared.data);
      return;
    }),
    route("POST", "/api/files/export", async ({ req, res, url }) => {
      const received = (await readBody(req, 5 * 1024 * 1024)) as {
        payload?: string;
        name?: string;
        format?: OfficeExportFormat;
        blocks?: Array<{ title?: string; text?: string; titleAlignment?: "left" | "center" | "right" | "justify"; paragraphAlignments?: Array<"left" | "center" | "right" | "justify"> }>;
      };
      const body = (typeof received.payload === "string" ? JSON.parse(received.payload) : received) as {
        name?: string;
        format?: OfficeExportFormat;
        blocks?: Array<{ title?: string; text?: string; titleAlignment?: "left" | "center" | "right" | "justify"; paragraphAlignments?: Array<"left" | "center" | "right" | "justify"> }>;
      };
      const allowed: OfficeExportFormat[] = ["docx", "pptx", "xlsx", "pdf", "html", "md"];
      if (!body.format || !allowed.includes(body.format) || !Array.isArray(body.blocks)) {
        send(res, 400, { error: "导出参数不完整" });
        return;
      }
      try {
        const exported = await exportOfficeDocument({
          name: String(body.name || "办公文稿"),
          format: body.format,
          blocks: body.blocks.map((block) => ({ title: String(block.title || ""), text: String(block.text || ""), titleAlignment: block.titleAlignment, paragraphAlignments: block.paragraphAlignments })),
        });
        const prepare = new URL(url, "http://127.0.0.1").searchParams.get("prepare") === "1";
        if (prepare) {
          for (const [id, item] of preparedOfficeExports) {
            if (item.expiresAt < Date.now()) preparedOfficeExports.delete(id);
          }
          const id = randomBytes(18).toString("hex");
          preparedOfficeExports.set(id, {
            data: exported.data,
            contentType: exported.contentType,
            filename: exported.filename,
            expiresAt: Date.now() + 2 * 60_000,
          });
          send(res, 200, {
            downloadUrl: `/api/files/export?id=${id}`,
            warnings: exported.warnings,
          });
          return;
        }
        res.writeHead(200, {
          "Content-Type": exported.contentType,
          "Content-Length": exported.data.length,
          "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(exported.filename),
          "X-Clownfish-Warnings": encodeURIComponent(exported.warnings.join("\n")),
          "Cache-Control": "no-store",
        });
        res.end(exported.data);
      } catch (error) {
        send(res, 500, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("POST", "/api/files/extract", async ({ req, res }) => {
      // 请求体上限会先于下面的 8 MB 判断触发，这里翻译成用户能照做的说明。
      let body: { name?: string; dataBase64?: string };
      try {
        body = (await readBody(req, 12 * 1024 * 1024)) as { name?: string; dataBase64?: string };
      } catch {
        send(res, 400, { error: "请求内容过大", userMessage: "单个办公文件不能超过 8 MB" });
        return;
      }
      const name = String(body.name ?? "").trim();
      const encoded = String(body.dataBase64 ?? "");
      if (!name || !encoded || !/^[a-z0-9+/=\r\n]+$/i.test(encoded)) {
        send(res, 400, { error: "文件内容不完整", userMessage: "文件内容不完整，请重新选择文件" });
        return;
      }
      const data = Buffer.from(encoded, "base64");
      if (!data.byteLength || data.byteLength > MAX_OFFICE_FILE_BYTES) {
        send(res, 400, { error: "单个办公文件不能超过 8 MB", userMessage: "单个办公文件不能超过 8 MB" });
        return;
      }
      try {
        // 上传文件生成结构化可编辑副本；原文件仍完整保存在会话里，可随时下载。
        const conversion = await convertOfficeToMarkdown(name, data);
        const extraction = officeExtractionFromMarkdown(conversion.sourceFormat, conversion.markdown, conversion.truncated);
        const session = officeFileSessions.create(name, data);
        const fileRecord = taskFiles.register({
          sourceKey: `office:${session.id}`,
          ownerKind: "office",
          ownerId: session.id,
          displayName: session.name,
          extension: session.extension,
          byteLength: session.byteLength,
          contentHash: session.contentHash,
          storageRef: session.id,
        });
        send(res, 200, { ok: true, extraction, conversion, session, fileRecord });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("GET", "/api/files/workbench", ({ res }) => {
      send(res, 200, { ok: true, state: officeWorkbenchState.read() });
      return;
    }),
    route("PUT", "/api/files/workbench", async ({ req, res }) => {
      const body = (await readBody(req, 7 * 1024 * 1024)) as { expectedRevision?: number; documents?: unknown[]; trash?: unknown[]; selectedId?: string | null };
      try {
        const state = officeWorkbenchState.save({
          expectedRevision: Number(body.expectedRevision),
          documents: body.documents || [],
          trash: body.trash || [],
          selectedId: body.selectedId,
        });
        send(res, 200, { ok: true, state });
      } catch (error) {
        if (error instanceof OfficeWorkbenchRevisionConflict) send(res, 409, { error: error.message, state: error.current });
        else send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("GET", "/api/files", ({ res, url }) => {
      const query = new URL(url, "http://127.0.0.1").searchParams;
      const ownerKind = query.get("ownerKind") as TaskFileOwnerKind | null;
      const ownerId = query.get("ownerId") || undefined;
      const allowedOwner = ownerKind && ["conversation", "task", "artifact", "office"].includes(ownerKind) ? ownerKind : undefined;
      send(res, 200, { ok: true, files: taskFiles.list(allowedOwner, ownerId) });
      return;
    }),
    route("POST", "/api/files/link",
      Type.Object({ id: Type.Optional(Type.String()), ownerKind: Type.Optional(Type.Union([Type.Literal("conversation"), Type.Literal("task"), Type.Literal("artifact"), Type.Literal("office")])), ownerId: Type.Optional(Type.String()), sourceKey: Type.Optional(Type.String()) }, { additionalProperties: false }),
      ({ res }, body) => {
      try {
        if (!body.ownerKind || !["conversation", "task", "artifact", "office"].includes(body.ownerKind)) throw new Error("文件归属类型无效");
        const file = taskFiles.link(String(body.id || ""), body.ownerKind, String(body.ownerId || ""), String(body.sourceKey || "") || undefined);
        send(res, 200, { ok: true, file });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("POST", "/api/files/status",
      Type.Object({ id: Type.Optional(Type.String()), status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("trashed")])) }, { additionalProperties: false }),
      ({ res }, body) => {
      try {
        if (body.status !== "active" && body.status !== "trashed") throw new Error("文件状态无效");
        const file = taskFiles.setStatus(String(body.id || ""), body.status);
        send(res, 200, { ok: true, file });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("GET", "/api/files/session", ({ res, url }) => {
      const id = new URL(url, "http://127.0.0.1").searchParams.get("id") || "";
      try {
        const { session, data } = officeFileSessions.read(id);
        res.writeHead(200, {
          "Content-Type": officeSessionContentType(session.extension),
          "Content-Length": data.byteLength,
          "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(session.name),
          "Cache-Control": "no-store",
          "X-Clownfish-Content-Hash": session.contentHash,
        });
        res.end(data);
      } catch (error) {
        send(res, 404, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("POST", "/api/files/session/open",
      Type.Object({ id: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      try {
        const action = await agentUserActions.execute({
          name: "office_file_open_desktop",
          description: "在 Windows 已关联的桌面应用中打开用户明确选择的本机工作副本",
          arguments: { sessionId: body.id },
          execute: () => officeFileSessions.openDesktop(String(body.id || "")),
          summarizeResult: (session) => ({ ok: true, sessionId: session.id, extension: session.extension }),
        });
        send(res, 200, { ok: true, session: action.value, auditRunId: action.runId });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("POST", "/api/files/session/refresh",
      Type.Object({ id: Type.Optional(Type.String()), expectedHash: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async ({ res }, body) => {
      try {
        const { session, data } = officeFileSessions.read(String(body.id || ""));
        const changed = !body.expectedHash || body.expectedHash !== session.contentHash;
        const conversion = await convertOfficeToMarkdown(session.name, data);
        const extraction = officeExtractionFromMarkdown(conversion.sourceFormat, conversion.markdown, conversion.truncated);
        send(res, 200, { ok: true, changed, session, extraction, conversion, dataBase64: data.toString("base64") });
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("GET", "/api/files/session/history", ({ res, url }) => {
      const id = new URL(url, "http://127.0.0.1").searchParams.get("id") || "";
      try {
        send(res, 200, { ok: true, versions: officeFileSessions.history(id) });
      } catch (error) {
        send(res, 404, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("GET", "/api/files/session/events", ({ res, url }) => {
      const id = new URL(url, "http://127.0.0.1").searchParams.get("id") || "";
      try {
        send(res, 200, { ok: true, events: officeFileSessions.eventHistory(id) });
      } catch (error) {
        send(res, 404, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
    route("POST", "/api/files/session/restore",
      Type.Object({ id: Type.Optional(Type.String()), versionId: Type.Optional(Type.String()), expectedHash: Type.Optional(Type.String()) }, { additionalProperties: false }),
      ({ res }, body) => {
      try {
        const session = officeFileSessions.restore(String(body.id || ""), String(body.versionId || ""), String(body.expectedHash || ""));
        send(res, 200, { ok: true, session });
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error), userMessage: userFacingMessage(error) });
      }
      return;
    }),
  ];
}
