import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 主动提醒的偏好：什么时候别打扰，动态要不要每天自动出一批。
 * 都按本机时间计算，只在应用运行时生效（开机自启后在托盘里运行也算）。
 */
export interface ProactiveSettings {
  quietHours: { enabled: boolean; start: string; end: string };
  feedSchedule: { enabled: boolean; time: string; lastRunDate: string };
}

export const DEFAULT_PROACTIVE: ProactiveSettings = {
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  feedSchedule: { enabled: false, time: "08:00", lastRunDate: "" },
};

export class ProactiveError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function hhmm(value: unknown, field: string): string {
  const match = /^(\d{1,2}):(\d\d)$/.exec(String(value ?? ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new ProactiveError(`${field}需要是 HH:MM`);
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 免打扰：支持跨午夜（22:00–08:00）。开始等于结束视为全天。 */
export function inQuietHours(settings: ProactiveSettings, now = new Date()): boolean {
  const q = settings.quietHours;
  if (!q.enabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(q.start), end = minutes(q.end);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** 今天到点了、今天还没跑过：跑一次。应用在点之后才打开，当天补一次；隔天不补昨天的。 */
export function feedDue(settings: ProactiveSettings, now = new Date()): boolean {
  const s = settings.feedSchedule;
  if (!s.enabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= minutes(s.time) && s.lastRunDate !== localDate(now);
}

export class ProactiveStore {
  private data: ProactiveSettings;
  constructor(private readonly file: string) {
    this.data = structuredClone(DEFAULT_PROACTIVE);
    try {
      if (existsSync(file)) this.data = this.normalize(JSON.parse(readFileSync(file, "utf8")), this.data);
    } catch { /* 读坏了就用默认，不影响其他功能 */ }
  }
  private normalize(input: unknown, base: ProactiveSettings): ProactiveSettings {
    const raw = (input && typeof input === "object" ? input : {}) as Partial<{ quietHours: Partial<ProactiveSettings["quietHours"]>; feedSchedule: Partial<ProactiveSettings["feedSchedule"]> }>;
    const q = raw.quietHours ?? {}, f = raw.feedSchedule ?? {};
    return {
      quietHours: {
        enabled: q.enabled === undefined ? base.quietHours.enabled : q.enabled === true,
        start: q.start === undefined ? base.quietHours.start : hhmm(q.start, "免打扰开始时间"),
        end: q.end === undefined ? base.quietHours.end : hhmm(q.end, "免打扰结束时间"),
      },
      feedSchedule: {
        enabled: f.enabled === undefined ? base.feedSchedule.enabled : f.enabled === true,
        time: f.time === undefined ? base.feedSchedule.time : hhmm(f.time, "动态生成时间"),
        lastRunDate: typeof f.lastRunDate === "string" ? f.lastRunDate : base.feedSchedule.lastRunDate,
      },
    };
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), "utf8");
    renameSync(temp, this.file);
  }
  get(): ProactiveSettings { return structuredClone(this.data); }
  /** 用户改设置。lastRunDate 由调度器维护，页面传了也不认。 */
  update(input: unknown, now = new Date()): ProactiveSettings {
    const raw = (input && typeof input === "object" ? input : {}) as { feedSchedule?: Record<string, unknown> };
    const { lastRunDate: _ignored, ...feed } = raw.feedSchedule ?? {};
    const next = this.normalize({ ...(input as object), feedSchedule: feed }, this.data);
    // 今天的点已经过了才打开自动生成：不立刻补跑，从明天开始（和定时任务一样）。
    if (next.feedSchedule.enabled && (!this.data.feedSchedule.enabled || next.feedSchedule.time !== this.data.feedSchedule.time)
      && now.getHours() * 60 + now.getMinutes() >= minutes(next.feedSchedule.time)) {
      next.feedSchedule.lastRunDate = localDate(now);
    }
    this.data = next;
    this.persist();
    return this.get();
  }
  markFeedRun(now = new Date()): void {
    this.data.feedSchedule.lastRunDate = localDate(now);
    this.persist();
  }
}
