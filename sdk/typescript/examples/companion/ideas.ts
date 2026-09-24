import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseJsonObject } from "./feed.js";

/**
 * 点子：小丑鱼根据用户的目标、事项和偏好想出来的"我能帮你做的事"。
 *
 * 只提小丑鱼现在真能做到的：构件、定时任务、目标、报告或文档、技能库里的规则。
 * 读邮件、看日历、下单付款这类还没接通的一律不提（校验时也会拦）。
 * "马上开始"只是带着一句准备好的开场白进聊天，由用户看着小丑鱼动手；点子本身不执行任何事。
 */
export const IDEA_DELIVERABLES = {
  widget: "可交互的小工具",
  routine: "定时任务",
  goal: "目标",
  report: "报告或文档",
  skill: "技能库里的规则",
} as const;
export type IdeaDeliverable = keyof typeof IDEA_DELIVERABLES;

export interface IdeaCard {
  id: string; createdAt: string; expiresAt: string;
  /** 第一人称的一句承诺："我可以……" */
  title: string;
  /** 怎么做、交付什么 */
  summary: string;
  /** 为什么想到你：依据只能是目标、事项、偏好 */
  rationale: string;
  deliverable: IdeaDeliverable;
  /** 点"马上开始"后以用户身份发出的第一句话 */
  startPrompt: string;
  state: "available" | "started" | "dismissed";
  startedAt?: string;
  feedback?: { kind: "more" | "less"; reason?: string; note?: string; at: string };
}

export const IDEA_LIMITS = { perBatch: 5, keep: 60, ttlDays: 14, title: 36, summary: 140, rationale: 90, startPrompt: 300 } as const;
export const IDEA_DISLIKE_REASONS = ["不相关", "太重复", "太具体", "不喜欢"] as const;
/** 还没接通的能力：点子里出现就丢掉，免得"马上开始"之后做不到。 */
const UNAVAILABLE = /(邮件|邮箱|收件箱|日历|日程表同步|支付|付款|购买|下单|订票|订酒店|订餐|帮你订|取消订阅|银行|信用卡|短信|打电话|微信消息|WhatsApp)/;

export class IdeaError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

interface IdeaFile { version: 1; ideas: IdeaCard[]; generatedAt: string }

export class IdeaStore {
  private data: IdeaFile;
  constructor(private readonly file: string) {
    this.data = { version: 1, ideas: [], generatedAt: "" };
    try {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<IdeaFile>;
        this.data = { version: 1, ideas: Array.isArray(saved.ideas) ? saved.ideas : [], generatedAt: String(saved.generatedAt || "") };
      }
    } catch { /* 读坏了就从空的开始 */ }
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), "utf8");
    renameSync(temp, this.file);
  }
  /** 页面上显示的：没过期、没被说不感兴趣的。开始过的也留着，标成"已开始"。 */
  visible(now = new Date()): IdeaCard[] {
    return this.data.ideas.filter((idea) => idea.state !== "dismissed" && Date.parse(idea.expiresAt) > now.getTime());
  }
  all(): IdeaCard[] { return [...this.data.ideas]; }
  get(id: string): IdeaCard | undefined { return this.data.ideas.find((idea) => idea.id === id); }
  generatedAt(): string { return this.data.generatedAt; }
  add(ideas: IdeaCard[], now = new Date()): void {
    this.data.ideas = [...ideas, ...this.data.ideas].slice(0, IDEA_LIMITS.keep);
    this.data.generatedAt = now.toISOString();
    this.persist();
  }
  private require(id: string): IdeaCard {
    const idea = this.get(id);
    if (!idea) throw new IdeaError("这个点子不存在", 404);
    return idea;
  }
  started(id: string): IdeaCard {
    const idea = this.require(id);
    idea.state = "started";
    idea.startedAt = new Date().toISOString();
    this.persist();
    return { ...idea };
  }
  feedback(id: string, kind: unknown, reason: unknown, note: unknown): IdeaCard {
    const idea = this.require(id);
    const at = new Date().toISOString();
    const text = String(note ?? "").trim().slice(0, 200);
    if (kind === "more") {
      idea.feedback = { kind: "more", at, ...(text ? { note: text } : {}) };
    } else if (kind === "less") {
      const picked = IDEA_DISLIKE_REASONS.find((item) => item === reason);
      if (!picked) throw new IdeaError("请选一个理由");
      idea.feedback = { kind: "less", reason: picked, at, ...(text ? { note: text } : {}) };
      idea.state = "dismissed";
    } else {
      throw new IdeaError("无效的反馈");
    }
    this.persist();
    return { ...idea };
  }
  /** 口味：想多要的、不想要的（带理由）、已经开始过的。只认明确动作。 */
  taste(): { more: string[]; less: string[]; started: string[]; recent: string[] } {
    const ideas = this.data.ideas;
    return {
      more: ideas.filter((i) => i.feedback?.kind === "more").slice(0, 12).map((i) => i.title),
      less: ideas.filter((i) => i.feedback?.kind === "less").slice(0, 12).map((i) => `${i.title}（${i.feedback!.reason}${i.feedback!.note ? `：${i.feedback!.note}` : ""}）`),
      started: ideas.filter((i) => i.state === "started").slice(0, 12).map((i) => i.title),
      recent: ideas.slice(0, 30).map((i) => i.title),
    };
  }
}

export interface IdeaContext {
  today: string;
  goals: string[];
  matters: string[];
  preferences: string[];
  feedTopic: string;
  topics?: { tellMe: string; neverMention: string };
  taste: ReturnType<IdeaStore["taste"]>;
}

export function ideaPrompt(ctx: IdeaContext): { system: string; user: string } {
  return {
    system: [
      "你是用户的个人助理小丑鱼，要主动想几个\"我能帮你做的事\"。只输出 JSON：",
      `{"ideas": [{"title": "我可以……", "summary": "怎么做、交付什么", "rationale": "为什么想到你", "deliverable": "${Object.keys(IDEA_DELIVERABLES).join("|")}", "startPrompt": "用户点开始后发给你的第一句话"}]}`,
      `最多 ${IDEA_LIMITS.perBatch} 个。title 用第一人称，不超过 30 个字；summary 不超过 100 个字；rationale 用"你"来写，一句话，依据只能是给出的目标、在做的事、偏好或动态话题，不许说读过对方没给的数据。`,
      `只提你现在真能做到的：${Object.entries(IDEA_DELIVERABLES).map(([k, v]) => `${k}=${v}`).join("、")}。你还不能读邮件、看日历、下单付款、订票订房、发消息，这类不要提。`,
      "startPrompt 以用户的口吻写，说清要做什么，让你一看就能动手（例如\"帮我做一个能勾选的……清单\"）。",
      "要具体到这个人：和他的目标、在做的事直接相关；和\"最近提过\"\"已经开始过\"重复的不要；\"不想要\"写了理由，避开同类或同样的毛病；\"想多要\"的可以往那个方向多想。",
      "\"别提\"里写的话题不要碰；\"想听\"里写的可以优先想。",
      "没有真正有用的就返回 {\"ideas\": []}，不要凑数。",
    ].join("\n"),
    user: JSON.stringify({
      今天: ctx.today, 目标: ctx.goals, 在做的事: ctx.matters, 偏好: ctx.preferences, 动态话题: ctx.feedTopic,
      想听: ctx.topics?.tellMe || "", 别提: ctx.topics?.neverMention || "",
      想多要: ctx.taste.more, 不想要: ctx.taste.less, 已经开始过: ctx.taste.started, 最近提过: ctx.taste.recent,
    }),
  };
}

export function parseIdeas(raw: string, recentTitles: readonly string[], now = new Date()): IdeaCard[] {
  const value = parseJsonObject(raw);
  const items = Array.isArray(value?.ideas) ? value!.ideas : [];
  const seen = new Set(recentTitles.map(normalize));
  const out: IdeaCard[] = [];
  const expiresAt = new Date(now.getTime() + IDEA_LIMITS.ttlDays * 86400_000).toISOString();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const deliverable = String(r.deliverable) in IDEA_DELIVERABLES ? String(r.deliverable) as IdeaDeliverable : null;
    const title = clip(r.title, IDEA_LIMITS.title);
    const summary = clip(r.summary, IDEA_LIMITS.summary);
    const rationale = clip(r.rationale, IDEA_LIMITS.rationale);
    const startPrompt = clip(r.startPrompt, IDEA_LIMITS.startPrompt);
    if (!deliverable || !title || !summary || !rationale || !startPrompt) continue;
    // 做不到的不收：宁可少一个，也别让"马上开始"之后才发现接不上。
    if (UNAVAILABLE.test(title + summary + startPrompt)) continue;
    const key = normalize(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: randomUUID(), createdAt: now.toISOString(), expiresAt, title, summary, rationale, deliverable, startPrompt, state: "available" });
    if (out.length >= IDEA_LIMITS.perBatch) break;
  }
  return out;
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function normalize(value: string): string {
  return value.replace(/[\s，。、！？!?,.：:「」“”"'《》…]/g, "").toLowerCase();
}
