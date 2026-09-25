import { randomUUID } from "node:crypto";

/**
 * 目标：用户想在一段时间里做到的一件事。先在聊天里谈清楚，再由小丑鱼记下并跟着进展更新。
 *
 * 和"事项"的区别：事项盯下一步和跟进时间，目标盯"怎么算做到"和一路上的进展。
 * 时间线只记真实发生的事——建立、调整、完成子目标、用户报告的进展——并注明是谁记的，
 * 不写推断出来的进度。
 */
export const GOAL_CATEGORIES = [
  { id: "health", label: "健康" },
  { id: "relationships", label: "人际关系" },
  { id: "finance", label: "财务" },
  { id: "career", label: "职业" },
  { id: "interests", label: "兴趣" },
  { id: "productivity", label: "效率提升" },
  { id: "other", label: "其他" },
] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number]["id"];

export interface GoalMilestone { id: string; title: string; done: boolean; doneAt?: string }
export interface GoalEntry {
  id: string; at: string;
  kind: "created" | "revised" | "milestone" | "progress" | "completed" | "reopened";
  /** 条目内容，不含类型前缀（界面按 kind 显示"定下目标""子目标完成"等）。 */
  text: string;
  /** 谁记的：assistant = 小丑鱼在对话里记下，user = 用户在页面上操作。 */
  by: "assistant" | "user";
}
export interface PersonalGoal {
  id: string; revision: number; title: string; category: GoalCategory;
  /** 为什么想做到，用户原话优先。 */
  why: string;
  /** 怎么算做到：可以核对的口径。 */
  measure: string;
  /** 节奏或计划，例如"每晚睡前读 20 分钟"。 */
  plan: string;
  dueAt: string;
  status: "active" | "completed" | "archived";
  milestones: GoalMilestone[];
  timeline: GoalEntry[];
  /** 定期对进度；没有就不提醒。 */
  checkIn?: GoalCheckIn;
  /** 势头：对照期限和计划的判断，附一句依据。依据不足时不填，不用百分比冒充进度。 */
  momentum?: GoalMomentum;
  /** 这个目标的那条聊天：聊进展、对进度都回到这里。 */
  sessionId?: string;
  createdAt: string; updatedAt: string;
}
export const MOMENTUM_LABELS = { on_track: "按计划", at_risk: "有风险", behind: "落后" } as const;
export interface GoalMomentum { status: keyof typeof MOMENTUM_LABELS; note: string; at: string; by: GoalEntry["by"] }
export interface GoalInput {
  id?: unknown; revision?: unknown; title?: unknown; category?: unknown; why?: unknown; measure?: unknown; plan?: unknown;
  dueAt?: unknown; status?: unknown; milestones?: unknown; result?: unknown;
  /** { cadence, time?, weekday?, monthDay? }；null 或 cadence "off" 表示取消。 */
  checkIn?: unknown;
  /** { status: on_track | at_risk | behind, note }；null 表示清掉。 */
  momentum?: unknown;
}

export class GoalError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export const GOAL_LIMITS = { goals: 200, milestones: 20, timeline: 300 } as const;

export function goalCategoryLabel(id: string): string {
  return GOAL_CATEGORIES.find((item) => item.id === id)?.label ?? "其他";
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value !== undefined && value !== null && typeof value !== "string") throw new GoalError(`${field}必须是文字`);
  const result = String(value ?? "").trim();
  if (required && !result) throw new GoalError(`请填写${field}`);
  if (result.length > max) throw new GoalError(`${field}不能超过 ${max} 个字`);
  return result;
}

function instant(value: unknown, field: string): string {
  const raw = text(value, field, 40);
  if (!raw) return "";
  // 只给日期时按当天结束算；带时间的必须带时区，避免把用户的"月底"存成别的时区。
  const normalized = /^\d{4}-\d\d-\d\d$/.test(raw) ? `${raw}T23:59:59+08:00` : raw;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new GoalError(`${field}需要有效日期`);
  }
  return new Date(normalized).toISOString();
}

function milestones(value: unknown, old: readonly GoalMilestone[], now: string): GoalMilestone[] {
  if (value === undefined) return old.map((item) => ({ ...item }));
  if (!Array.isArray(value)) throw new GoalError("子目标需要是列表");
  let list: unknown[] = value;
  if (list.length > GOAL_LIMITS.milestones) throw new GoalError(`子目标最多 ${GOAL_LIMITS.milestones} 个`);
  // 只传了几个已有子目标（例如只勾上一个）时按局部修改处理，其余保持原样；
  // 否则按完整列表替换。避免模型只传一项就把别的子目标全删掉。
  const idOf = (raw: unknown) => raw && typeof raw === "object" ? String((raw as { id?: unknown }).id ?? "") : "";
  if (list.length && list.length < old.length && list.every((raw) => old.some((m) => m.id === idOf(raw)))) {
    const patch = list;
    list = old.map((m) => patch.find((raw) => idOf(raw) === m.id) ?? m);
  }
  return list.map((raw) => {
    const item = (raw && typeof raw === "object" ? raw : { title: raw }) as { id?: unknown; title?: unknown; done?: unknown };
    const id = text(item.id, "子目标编号", 100);
    const prior = id ? old.find((m) => m.id === id) : undefined;
    const title = text(item.title ?? prior?.title, "子目标", 120, true);
    const done = item.done === undefined ? !!prior?.done : item.done === true;
    const doneAt = done ? (prior?.done ? prior.doneAt : now) : undefined;
    return { id: prior?.id ?? randomUUID(), title, done, ...(doneAt ? { doneAt } : {}) };
  });
}

/**
 * 定期对进度。按本机时间计算（和定时任务一致），只在应用运行时触发。
 * 到点只把这一次标成待对（pendingSince），同时排好下一次；错过的几次不补发，免得一开机连弹几条。
 */
export interface GoalCheckIn {
  cadence: "daily" | "weekly" | "biweekly" | "monthly";
  /** 本机时间 HH:MM */
  time: string;
  /** 0 = 周日；每周、每两周用 */
  weekday?: number;
  /** 1–31，超过当月天数按月底算；每月用 */
  monthDay?: number;
  nextAt: string;
  pendingSince?: string;
  /** 最近一次到点的时间；回执后也保留，给桌面端通知去重用。 */
  lastFiredAt?: string;
}
const CADENCES = ["daily", "weekly", "biweekly", "monthly"] as const;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function describeCheckIn(c: Pick<GoalCheckIn, "cadence" | "time" | "weekday" | "monthDay">): string {
  if (c.cadence === "daily") return `每天 ${c.time}`;
  if (c.cadence === "monthly") return `每月 ${c.monthDay} 号 ${c.time}`;
  return `${c.cadence === "biweekly" ? "每两周" : "每周"}${WEEKDAYS[c.weekday ?? 0]} ${c.time}`;
}

function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}
function monthAt(year: number, month: number, monthDay: number, time: string): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return atTime(new Date(year, month, Math.min(monthDay, last)), time);
}
/** 第一次：严格晚于 after 的最近一次。 */
function firstOccurrence(c: Omit<GoalCheckIn, "nextAt">, after: Date): Date {
  if (c.cadence === "monthly") {
    for (let i = 0; ; i++) {
      const at = monthAt(after.getFullYear(), after.getMonth() + i, c.monthDay ?? 1, c.time);
      if (at > after) return at;
    }
  }
  for (let i = 0; i < 8; i++) {
    const at = atTime(new Date(after.getFullYear(), after.getMonth(), after.getDate() + i), c.time);
    if (at > after && (c.cadence === "daily" || at.getDay() === c.weekday)) return at;
  }
  throw new GoalError("无法计算下次对进度的时间");
}
/** 从上一次往后按周期推，直到晚于 now；两周一次要按上一次推，不能从今天重新找周几。 */
export function advanceCheckIn(c: GoalCheckIn, now: Date): string {
  let at = new Date(c.nextAt);
  for (let guard = 0; at <= now && guard < 1000; guard++) {
    if (c.cadence === "monthly") at = monthAt(at.getFullYear(), at.getMonth() + 1, c.monthDay ?? 1, c.time);
    else at = atTime(new Date(at.getFullYear(), at.getMonth(), at.getDate() + (c.cadence === "daily" ? 1 : c.cadence === "weekly" ? 7 : 14)), c.time);
  }
  return at.toISOString();
}

function checkIn(value: unknown, old: GoalCheckIn | undefined, now: Date): GoalCheckIn | undefined {
  if (value === undefined) return old ? { ...old } : undefined;
  if (value === null) return undefined;
  if (typeof value !== "object") throw new GoalError("定期对进度的设置无效");
  const input = value as { cadence?: unknown; time?: unknown; weekday?: unknown; monthDay?: unknown };
  if (input.cadence === "off") return undefined;
  const cadence = String(input.cadence ?? old?.cadence ?? "");
  if (!(CADENCES as readonly string[]).includes(cadence)) throw new GoalError("对进度的频率只能是每天、每周、每两周或每月");
  const time = String(input.time ?? old?.time ?? "20:00");
  const hm = /^(\d{1,2}):(\d\d)$/.exec(time);
  if (!hm || Number(hm[1]) > 23 || Number(hm[2]) > 59) throw new GoalError("对进度的时间需要是 HH:MM");
  const normalizedTime = `${hm[1].padStart(2, "0")}:${hm[2]}`;
  const weekday = cadence === "weekly" || cadence === "biweekly" ? Number(input.weekday ?? old?.weekday ?? now.getDay()) : undefined;
  if (weekday !== undefined && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw new GoalError("星期需要是 0 到 6");
  const monthDay = cadence === "monthly" ? Number(input.monthDay ?? old?.monthDay ?? now.getDate()) : undefined;
  if (monthDay !== undefined && !(Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31)) throw new GoalError("日期需要是 1 到 31");
  const settings = { cadence: cadence as GoalCheckIn["cadence"], time: normalizedTime, ...(weekday !== undefined ? { weekday } : {}), ...(monthDay !== undefined ? { monthDay } : {}) };
  // 设置没变就保留原来的排期和待对状态。
  if (old && describeCheckIn(old) === describeCheckIn(settings)) return { ...old };
  return { ...settings, nextAt: firstOccurrence(settings, now).toISOString() };
}

function momentum(value: unknown, old: GoalMomentum | undefined, by: GoalEntry["by"], now: string): GoalMomentum | undefined {
  if (value === undefined) return old ? { ...old } : undefined;
  if (value === null) return undefined;
  const input = (value && typeof value === "object" ? value : {}) as { status?: unknown; note?: unknown };
  const status = String(input.status ?? "");
  if (!(status in MOMENTUM_LABELS)) throw new GoalError("势头只能是按计划、有风险或落后");
  const note = text(input.note, "势头的依据", 160, true);
  return { status: status as GoalMomentum["status"], note, at: now, by };
}

function entry(kind: GoalEntry["kind"], value: string, by: GoalEntry["by"], at: string): GoalEntry {
  return { id: randomUUID(), at, kind, text: value, by };
}

/** 时间线超长时丢最旧的非"建立"条目：建立那一条是整条线的起点，留着。 */
function capTimeline(timeline: GoalEntry[]): GoalEntry[] {
  const out = timeline.slice();
  while (out.length > GOAL_LIMITS.timeline) {
    const index = out.findIndex((item) => item.kind !== "created");
    out.splice(index < 0 ? 0 : index, 1);
  }
  return out;
}

/** 合并一次保存：校验字段、推进版本号，并把真实发生的变化写进时间线。 */
export function applyGoalSave(old: PersonalGoal | undefined, input: GoalInput, by: GoalEntry["by"], now = new Date().toISOString()): PersonalGoal {
  if (old && Number(input.revision) !== old.revision) throw new GoalError("目标已被更新，请重新读取后再保存", 409);
  const category = String(input.category ?? old?.category ?? "other");
  if (!GOAL_CATEGORIES.some((item) => item.id === category)) throw new GoalError("无效的目标类别");
  const status = String(input.status ?? old?.status ?? "active");
  if (!["active", "completed", "archived"].includes(status)) throw new GoalError("无效的目标状态");
  const goal: PersonalGoal = {
    id: old?.id ?? randomUUID(),
    revision: (old?.revision ?? 0) + 1,
    title: text(input.title ?? old?.title, "目标名称", 60, true),
    category: category as GoalCategory,
    why: text(input.why ?? old?.why, "为什么想做到", 500),
    measure: text(input.measure ?? old?.measure, "怎么算做到", 300, true),
    plan: text(input.plan ?? old?.plan, "计划", 1000),
    dueAt: input.dueAt === undefined ? old?.dueAt ?? "" : instant(input.dueAt, "期限"),
    status: status as PersonalGoal["status"],
    milestones: milestones(input.milestones, old?.milestones ?? [], now),
    timeline: old?.timeline.slice() ?? [],
    ...(() => { const c = checkIn(input.checkIn, old?.checkIn, new Date(now)); return c ? { checkIn: c } : {}; })(),
    ...(() => { const m = momentum(input.momentum, old?.momentum, by, now); return m ? { momentum: m } : {}; })(),
    ...(old?.sessionId ? { sessionId: old.sessionId } : {}),
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
  if (!old) {
    goal.timeline.push(entry("created", goal.title, by, now));
    if (goal.checkIn) goal.timeline.push(entry("revised", `定期对进度（${describeCheckIn(goal.checkIn)}）`, by, now));
  } else {
    const changed = [
      goal.title !== old.title ? "名字" : "",
      goal.measure !== old.measure ? "怎么算做到" : "",
      goal.plan !== old.plan ? "计划" : "",
      goal.dueAt !== old.dueAt ? "期限" : "",
      goal.category !== old.category ? "类别" : "",
    ].filter(Boolean);
    const added = goal.milestones.filter((m) => !old.milestones.some((o) => o.id === m.id)).map((m) => m.title);
    if (added.length) changed.push(`子目标（新增 ${added.join("、")}）`);
    const before = old.checkIn ? describeCheckIn(old.checkIn) : "", after = goal.checkIn ? describeCheckIn(goal.checkIn) : "";
    if (before !== after) changed.push(after ? `定期对进度（${after}）` : "取消定期对进度");
    if (goal.momentum && goal.momentum.status !== old.momentum?.status) changed.push(`势头为「${MOMENTUM_LABELS[goal.momentum.status]}」：${goal.momentum.note}`);
    if (changed.length) goal.timeline.push(entry("revised", changed.join("、"), by, now));
    for (const m of goal.milestones) {
      const prior = old.milestones.find((o) => o.id === m.id);
      if (m.done && !prior?.done) goal.timeline.push(entry("milestone", m.title, by, now));
    }
    if (goal.status === "completed" && old.status !== "completed") {
      const result = text(input.result, "完成情况", 500);
      goal.timeline.push(entry("completed", result, by, now));
    }
    if (goal.status === "active" && old.status !== "active") goal.timeline.push(entry("reopened", "", by, now));
  }
  goal.timeline = capTimeline(goal.timeline);
  return goal;
}

/** 记一条进展。只记用户说过或页面上填的内容，不写推断。 */
export function applyGoalProgress(old: PersonalGoal, value: unknown, by: GoalEntry["by"], now = new Date().toISOString(), momentumInput?: unknown): PersonalGoal {
  const note = text(value, "进展", 500, true);
  const nextMomentum = momentum(momentumInput, old.momentum, by, now);
  const timeline = [...old.timeline, entry("progress", note, by, now)];
  if (nextMomentum && nextMomentum.status !== old.momentum?.status) timeline.push(entry("revised", `势头为「${MOMENTUM_LABELS[nextMomentum.status]}」：${nextMomentum.note}`, by, now));
  return { ...old, revision: old.revision + 1, updatedAt: now, ...(nextMomentum ? { momentum: nextMomentum } : {}), timeline: capTimeline(timeline) };
}

/**
 * 目标对话的追加说明：只在从目标页开出来的会话里出现，不进普通聊天的提示。
 * 新目标：先谈清楚再记；已有目标：记进展、按需调整。
 */
const CHECK_IN_RULE = `· 只有 ta 明确要定期对进度、并说了多久一次时，才用 goal_save 的 checkIn 设好，建目标时不要顺手设（cadence 为 daily/weekly/biweekly/monthly，time 如 20:00，每周填 weekday 0–6，每月填 monthDay）；设好之前别说"到时候我提醒你"，并告诉 ta 只有应用开着才会提醒。`;
export function goalCoachingAddendum(category: string, goal?: PersonalGoal): string {
  if (goal) {
    // 编号直接给出：聊天每轮只有一次工具机会，不能先花在 goal_list 上。
    const milestones = goal.milestones.map((m) => `${m.title}（${m.done ? "已完成" : "未完成"}，id ${m.id}）`).join("；");
    const recent = goal.timeline.filter((e) => e.kind === "progress").slice(-3).map((e) => `${e.at.slice(0, 10)} ${e.text}`).join("；");
    return [
      `【这段对话是关于目标「${goal.title}」的】目标 id ${goal.id}，${new Date(goal.createdAt).toLocaleDateString("zh-CN")} 建立（今天是 ${new Date().toLocaleDateString("zh-CN")}）。怎么算做到：${goal.measure}${goal.plan ? `；计划：${goal.plan}` : ""}。`,
      ...(milestones ? [`子目标：${milestones}。`] : []),
      ...(recent ? [`最近记过的进展：${recent}。`] : [`还没有记过进展。`]),
      `· ta 说了进展就用 goal_log_progress 记下，尽量用 ta 的原话；没说的不要替 ta 估。同一轮里某个子目标因此完成，就同时用 goal_save 勾上（带目标 id 和完整子目标列表）。`,
      `· 进展不顺时先问卡在哪，给一个更小的下一步，不要说教。`,
      `· 记进展时顺带对照期限和计划判断势头（momentum：on_track 按计划 / at_risk 有风险 / behind 落后），note 写一句依据；只凭一句话判断不了就不填。${goal.momentum ? `现在是「${MOMENTUM_LABELS[goal.momentum.status]}」：${goal.momentum.note}。` : ""}`,
      ...(goal.checkIn ? [`定期对进度：${describeCheckIn(goal.checkIn)}，只在应用开着时提醒。`] : []),
      CHECK_IN_RULE,
    ].join("\n");
  }
  return [
    `【这是一段定目标的对话】ta 从目标页选了「${goalCategoryLabel(category)}」类。`,
    `· 先聊清楚再记：想做到什么、怎么算做到（能核对的口径）、打算怎么做（节奏）。每次最多问两个问题，ta 已经说过的别再问。`,
    `· ta 定的量明显过高时，建议一个更小的起点，由 ta 决定。`,
    `· 计划用 ta 说过的节奏；ta 没说就问一句，别自己推算后直接记。`,
    `· 谈妥后用 goal_save 记下（category 填 ${category}），milestones 里带上 2 到 4 个子目标；记好后用一两句复述，再问要不要定期对一次进度。`,
    `· 没谈妥之前不要调用 goal_save，也不要说"已经帮你记下了"。`,
    CHECK_IN_RULE,
  ].join("\n");
}

/** 给模型看的精简视图：不带完整时间线，只带最近几条，避免一轮就把上下文吃满。 */
export function goalBrief(goal: PersonalGoal): Record<string, unknown> {
  return {
    id: goal.id, revision: goal.revision, title: goal.title, category: goalCategoryLabel(goal.category), status: goal.status,
    why: goal.why, measure: goal.measure, plan: goal.plan, dueAt: goal.dueAt,
    milestones: goal.milestones.map((m) => ({ id: m.id, title: m.title, done: m.done })),
    // 给模型本地时间的写法：只给 UTC 时它会把日期换算错（实测把 9/30 说成 10/7）。
    momentum: goal.momentum ? { status: MOMENTUM_LABELS[goal.momentum.status], note: goal.momentum.note } : null,
    checkIn: goal.checkIn ? { schedule: describeCheckIn(goal.checkIn), next: new Date(goal.checkIn.nextAt).toLocaleString("zh-CN", { month: "long", day: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit" }) } : null,
    recent: goal.timeline.slice(-5).map((item) => ({ at: item.at, kind: item.kind, text: item.text })),
  };
}
