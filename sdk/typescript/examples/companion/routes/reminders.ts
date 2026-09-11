// reminders 域：从 server.ts 的 if 链逐条搬来，函数体未改写。
// 这一层只统一匹配口径（一律 pathname）并对形状固定的 body 做运行时校验。
import { APP_PERSONA_ID } from "../identity.js";
import { AgentUserActionGateway, FileAgentJobQueue } from "../../../src/index.js";
import { BackgroundScheduler } from "../background-scheduler.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { HkReminder } from "../server.js";
// TSC_IMPORTS
import { route, type RouteEntry } from "./table.js";

export interface ReminderDeps {
  readonly agentJobQueue: FileAgentJobQueue;
  readonly agentUserActions: AgentUserActionGateway;
  readonly backgroundScheduler: BackgroundScheduler;
  readonly createHkReminderDelivery: (reminder: HkReminder, signal?: AbortSignal, runId?: string) => Promise<{ personaId: string; name: string; reply: string; messages: string[]; facts: string[] }>;
  readonly loadHkReminders: () => HkReminder[];
  readonly readBody: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  readonly sanitizeHkReminder: (input: Partial<HkReminder>, fallback?: HkReminder) => HkReminder;
  readonly saveHkReminders: (reminders: HkReminder[]) => void;
  readonly send: (res: ServerResponse, code: number, body: unknown, type?: string) => void;
  // TSC_DEPS
}

export function createReminderRoutes(deps: ReminderDeps): RouteEntry[] {
  const { agentJobQueue, agentUserActions, backgroundScheduler, createHkReminderDelivery, loadHkReminders, readBody, sanitizeHkReminder, saveHkReminders, send } = deps;
  // TSC_DESTRUCTURE
  void deps;
  return [
    route("GET", "/api/hk-reminders", ({ res }) => {
      send(res, 200, {
        timezone: "Asia/Hong_Kong",
        source: "HKEX securities market hours",
        reminders: loadHkReminders(),
      });
      return;
    }),
    route("GET", "/api/hk-reminders/due", ({ res }) => {
      const jobs = agentJobQueue.list({ limit: 1_000 }).filter((job) => job.type === "hk-reminder" && job.metadata?.scheduled === "true");
      send(res, 200, {
        timezone: "Asia/Hong_Kong",
        due: [],
        scheduler: backgroundScheduler.status(),
        jobs: jobs.map((job) => ({ id: job.id, status: job.status, reminderId: (job.payload.reminder as Partial<HkReminder> | undefined)?.id })),
      });
      return;
    }),
    route("POST", "/api/hk-reminders/notify", async ({ req, res }) => {
      const b = (await readBody(req)) as Partial<HkReminder>;
      const reminder = sanitizeHkReminder(b);
      const action = await agentUserActions.execute({
        name: "hk_reminder_notify",
        description: "让小丑鱼立即生成用户请求的港股辅助提醒",
        arguments: {
          reminderId: reminder.id,
          title: reminder.title,
          noteChars: reminder.note.length,
        },
        metadata: { personaId: APP_PERSONA_ID },
        execute: (signal) => createHkReminderDelivery(reminder, signal),
        summarizeResult: () => ({ ok: true, reminderId: reminder.id, delivered: true }),
      });
      send(res, 200, { ...action.value, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/hk-reminders", async ({ req, res }) => {
      const b = (await readBody(req)) as Partial<HkReminder>;
      const action = await agentUserActions.execute({
        name: b.id ? "hk_reminder_update" : "hk_reminder_create",
        description: b.id ? "保存用户编辑的港股辅助提醒" : "创建用户填写的港股辅助提醒",
        arguments: {
          reminderId: b.id,
          enabled: b.enabled,
          time: b.time,
          title: b.title,
          noteChars: b.note?.length ?? 0,
        },
        metadata: { personaId: APP_PERSONA_ID },
        execute: () => {
          const reminders = loadHkReminders();
          const index = reminders.findIndex((reminder) => reminder.id === b.id);
          const next = sanitizeHkReminder(b, index >= 0 ? reminders[index] : undefined);
          if (index >= 0) reminders[index] = next;
          else reminders.push(next);
          reminders.sort((a, other) => a.time.localeCompare(other.time));
          saveHkReminders(reminders);
          return { reminder: next, reminders };
        },
        summarizeResult: (value) => ({ ok: true, reminderId: value.reminder.id }),
      });
      send(res, 200, { ok: true, reminders: action.value.reminders, auditRunId: action.runId });
      return;
    }),
    route("POST", "/api/hk-reminders/delete", async ({ req, res }) => {
      const b = (await readBody(req)) as { id?: string };
      if (!b.id) { send(res, 400, { error: "missing reminder id" }); return; }
      const action = await agentUserActions.execute({
        name: "hk_reminder_delete",
        description: "删除用户在提醒管理页选中的港股辅助提醒",
        arguments: { reminderId: b.id },
        metadata: { personaId: APP_PERSONA_ID },
        execute: () => {
          const reminders = loadHkReminders().filter((reminder) => reminder.id !== b.id);
          saveHkReminders(reminders);
          return { reminderId: b.id!, reminders };
        },
        summarizeResult: (value) => ({ ok: true, reminderId: value.reminderId, deleted: true }),
      });
      send(res, 200, { ok: true, reminders: action.value.reminders, auditRunId: action.runId });
      return;
    }),
  ];
}
