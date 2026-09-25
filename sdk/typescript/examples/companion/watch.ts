import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseJsonObject, type FeedCandidateSource } from "./feed.js";

/**
 * 帮我盯着：用户写的几件事，隔一段时间联网看一眼，有值得说的新变化才出声。
 *
 * 限额写死：最多 5 件，间隔 1–24 小时，每天最多检查 48 次（每次一件事算一次）；只在应用运行时跑。
 * 没有联网搜索就不盯：不用模型的记忆冒充"查过了"。和上次结论一样就不提醒。
 */
export const WATCH_LIMITS = { items: 5, text: 120, minInterval: 60, maxInterval: 1440, dailyChecks: 48, alerts: 50 } as const;

export interface WatchItem {
  id: string; text: string; createdAt: string;
  lastCheckedAt?: string;
  /** 上次看到的情况：下次对比用，也显示给用户。 */
  lastSummary?: string;
  lastStatus?: "quiet" | "alerted" | "failed";
}
export interface WatchAlert {
  id: string; itemId: string; itemText: string; at: string;
  message: string; sources: Array<{ title: string; url: string }>;
  /** 聊天页取走后回执；托盘通知按 id 去重。 */
  delivered?: boolean;
}
interface WatchFile {
  version: 1; enabled: boolean; intervalMinutes: number; lastRunAt: string;
  items: WatchItem[]; alerts: WatchAlert[];
  usage: { date: string; checks: number };
}

export class WatchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export class WatchStore {
  private data: WatchFile;
  constructor(private readonly file: string) {
    this.data = { version: 1, enabled: false, intervalMinutes: 120, lastRunAt: "", items: [], alerts: [], usage: { date: "", checks: 0 } };
    try {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<WatchFile>;
        this.data = { ...this.data, ...saved, items: Array.isArray(saved.items) ? saved.items : [], alerts: Array.isArray(saved.alerts) ? saved.alerts : [], usage: saved.usage ?? this.data.usage };
      }
    } catch { /* 读坏了就从空的开始 */ }
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), "utf8");
    renameSync(temp, this.file);
  }
  snapshot() {
    return { enabled: this.data.enabled, intervalMinutes: this.data.intervalMinutes, lastRunAt: this.data.lastRunAt, items: this.data.items.map((i) => ({ ...i })), alerts: this.data.alerts.slice(0, 20), usage: { ...this.data.usage } };
  }
  /** 用户改清单：每行一件。保留原来那件事的上次结论（按文字对上）。 */
  update(input: { enabled?: unknown; intervalMinutes?: unknown; items?: unknown }, now = new Date()): ReturnType<WatchStore["snapshot"]> {
    if (input.intervalMinutes !== undefined) {
      const minutes = Number(input.intervalMinutes);
      if (!Number.isInteger(minutes) || minutes < WATCH_LIMITS.minInterval || minutes > WATCH_LIMITS.maxInterval) throw new WatchError("间隔需要在 1 到 24 小时之间");
      this.data.intervalMinutes = minutes;
    }
    if (input.items !== undefined) {
      const lines = (Array.isArray(input.items) ? input.items : String(input.items ?? "").split(/\r?\n/))
        .map((line) => String(line ?? "").trim()).filter(Boolean);
      const unique = [...new Set(lines)];
      if (unique.length > WATCH_LIMITS.items) throw new WatchError(`最多盯 ${WATCH_LIMITS.items} 件事`);
      if (unique.some((line) => line.length > WATCH_LIMITS.text)) throw new WatchError(`每件事不超过 ${WATCH_LIMITS.text} 个字`);
      this.data.items = unique.map((text) => this.data.items.find((item) => item.text === text) ?? { id: randomUUID(), text, createdAt: now.toISOString() });
    }
    if (input.enabled !== undefined) this.data.enabled = input.enabled === true;
    this.persist();
    return this.snapshot();
  }
  /** 该跑了吗：开着、有清单、离上次满间隔、今天还有额度。 */
  due(now = new Date()): boolean {
    if (!this.data.enabled || !this.data.items.length) return false;
    if (this.remainingChecks(now) <= 0) return false;
    const last = Date.parse(this.data.lastRunAt || "");
    return !Number.isFinite(last) || now.getTime() - last >= this.data.intervalMinutes * 60_000;
  }
  remainingChecks(now = new Date()): number {
    const used = this.data.usage.date === localDate(now) ? this.data.usage.checks : 0;
    return WATCH_LIMITS.dailyChecks - used;
  }
  /** 开始一轮：先记下时间和额度，失败也不会一轮轮重试。返回这轮要看的事（额度不够就少看几件）。 */
  beginRun(now = new Date()): WatchItem[] {
    const date = localDate(now);
    if (this.data.usage.date !== date) this.data.usage = { date, checks: 0 };
    const items = this.data.items.slice(0, Math.max(0, this.remainingChecks(now)));
    this.data.usage.checks += items.length;
    this.data.lastRunAt = now.toISOString();
    this.persist();
    return items.map((i) => ({ ...i }));
  }
  record(itemId: string, result: { status: WatchItem["lastStatus"]; summary?: string; alert?: Omit<WatchAlert, "id" | "itemId" | "itemText" | "at"> }, now = new Date()): WatchAlert | null {
    const item = this.data.items.find((i) => i.id === itemId);
    if (!item) return null;
    item.lastCheckedAt = now.toISOString();
    item.lastStatus = result.status;
    if (result.summary) item.lastSummary = result.summary;
    let alert: WatchAlert | null = null;
    if (result.alert) {
      alert = { id: randomUUID(), itemId, itemText: item.text, at: now.toISOString(), ...result.alert };
      this.data.alerts = [alert, ...this.data.alerts].slice(0, WATCH_LIMITS.alerts);
    }
    this.persist();
    return alert;
  }
  pendingAlerts(): WatchAlert[] { return this.data.alerts.filter((a) => !a.delivered); }
  /** 最近 12 小时的提醒，托盘通知用（回执后也算，按 id 去重）。 */
  recentAlerts(now = new Date()): WatchAlert[] {
    const since = now.getTime() - 12 * 3600_000;
    return this.data.alerts.filter((a) => Date.parse(a.at) >= since);
  }
  acknowledge(id: string): void {
    const alert = this.data.alerts.find((a) => a.id === id);
    if (!alert) throw new WatchError("提醒不存在", 404);
    alert.delivered = true;
    this.persist();
  }
}

export function watchCheckPrompt(item: WatchItem, sources: FeedCandidateSource[], today: string): { system: string; user: string } {
  return {
    system: [
      "你在替用户盯一件事，判断这次联网看到的情况里有没有值得马上告诉 ta 的新变化。只输出 JSON：",
      "{\"notify\": true|false, \"summary\": \"一句话概括现在的情况\", \"message\": \"要告诉 ta 的一两句话（notify 为 false 时留空）\", \"sources\": [编号]}",
      "只根据下面的\"来源\"判断，不用自己的记忆补；来源里没有相关内容就 notify=false，summary 写\"没查到相关的新消息\"。",
      "和\"上次看到\"的情况一样、或者只是换了说法，notify=false。真有变化（出了新消息、数字或状态变了、到了 ta 关心的条件）才 notify=true，并在 sources 里写依据。",
      "时效要如实：来源没写日期、或看不出是最近的，就不要说\"现在\"\"刚刚\"，在 message 里写明\"来源没写时间\"或来源的日期。",
      "message 用\"你\"来写，直接说变化是什么，不夸张，不写\"重大\"\"紧急\"这类词，除非来源这么说。",
    ].join("\n"),
    user: JSON.stringify({
      今天: today, 要盯的事: item.text, 上次看到: item.lastSummary || "（第一次看）",
      来源: sources.map((s, i) => ({ 编号: i + 1, 标题: s.title, 链接: s.url, 摘要: s.content.slice(0, 400) })),
    }),
  };
}

/** 解析判断：要提醒必须有真实来源；第一次看也只在确有相关内容时提醒。 */
export function parseWatchCheck(raw: string, sources: FeedCandidateSource[]): { notify: boolean; summary: string; message: string; sources: Array<{ title: string; url: string }> } {
  const value = parseJsonObject(raw) ?? {};
  const cited = [...new Set((Array.isArray(value.sources) ? value.sources : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length))]
    .map((n) => ({ title: sources[n - 1].title || sources[n - 1].url, url: sources[n - 1].url }))
    .filter((s) => /^https?:\/\//i.test(s.url));
  const summary = String(value.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const message = String(value.message ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  // 没有可核对的来源就不出声：宁可漏一次，也不凭空提醒。
  const notify = value.notify === true && !!message && cited.length > 0;
  return { notify, summary: summary || "没查到相关的新消息", message: notify ? message : "", sources: notify ? cited : [] };
}
