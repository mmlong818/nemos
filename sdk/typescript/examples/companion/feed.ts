import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 动态：按用户写的"话题"，结合目标、事项和记住的偏好，生成几条值得看的内容。
 *
 * 如实原则：新闻类必须引用这次真的搜到的来源，引用不到就丢掉；目标、建议类只根据已有记录写；
 * 没有值得写的就记一句"这次没有值得收录的新内容"，不硬凑。只有用户点"生成"时才调用模型和搜索。
 */
export interface FeedSource { title: string; url: string }
export interface FeedPost {
  id: string; batchId: string; createdAt: string;
  kind: "news" | "goal" | "tip";
  title: string; body: string; sources: FeedSource[];
  /** 一句话：为什么给这个人看（按话题、哪个目标、哪条偏好）。 */
  why?: string;
  liked?: boolean;
  /** 点了"不感兴趣"：理由与备注。和 liked 互斥。 */
  disliked?: { reason: FeedDislikeReason; note?: string; at: string };
  /** 点过"讨论"：算作感兴趣的信号。 */
  discussedAt?: string;
}
export const FEED_DISLIKE_REASONS = ["不相关", "太重复", "太具体", "不喜欢"] as const;
export type FeedDislikeReason = (typeof FEED_DISLIKE_REASONS)[number];
export interface FeedBatch {
  id: string; at: string;
  status: "posted" | "empty" | "failed";
  /** 给用户看的一句话：为什么是空的、为什么没联网、哪里失败了。 */
  note: string;
  queries: string[];
}
export interface FeedCandidateSource { title: string; url: string; content: string }

export const DEFAULT_FEED_PROMPT = "根据我的目标、在做的事和关心的领域，给我几条值得看的：相关的新消息、和目标有关的提醒或建议。简洁直接，方便快速扫一眼，不要标题党。";
export const FEED_LIMITS = { prompt: 500, posts: 200, batches: 60, perBatch: 5, queries: 3, title: 40, body: 240 } as const;

interface FeedFile { version: 1; prompt: string; batches: FeedBatch[]; posts: FeedPost[] }

export class FeedError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export class FeedStore {
  private data: FeedFile;
  constructor(private readonly file: string) {
    this.data = { version: 1, prompt: DEFAULT_FEED_PROMPT, batches: [], posts: [] };
    try {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<FeedFile>;
        this.data = {
          version: 1,
          prompt: typeof saved.prompt === "string" && saved.prompt.trim() ? saved.prompt : DEFAULT_FEED_PROMPT,
          batches: Array.isArray(saved.batches) ? saved.batches : [],
          posts: Array.isArray(saved.posts) ? saved.posts : [],
        };
      }
    } catch { /* 读坏了就从空的开始，不影响其他页面 */ }
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), "utf8");
    renameSync(temp, this.file);
  }
  snapshot() { return { prompt: this.data.prompt, batches: [...this.data.batches], posts: [...this.data.posts] }; }
  setPrompt(value: unknown): string {
    const prompt = String(value ?? "").trim();
    if (!prompt) throw new FeedError("话题不能是空的");
    if (prompt.length > FEED_LIMITS.prompt) throw new FeedError(`话题不能超过 ${FEED_LIMITS.prompt} 个字`);
    this.data.prompt = prompt;
    this.persist();
    return prompt;
  }
  addBatch(batch: FeedBatch, posts: FeedPost[]): void {
    this.data.batches = [batch, ...this.data.batches].slice(0, FEED_LIMITS.batches);
    this.data.posts = [...posts, ...this.data.posts].slice(0, FEED_LIMITS.posts);
    const kept = new Set(this.data.batches.map((b) => b.id));
    this.data.posts = this.data.posts.filter((p) => kept.has(p.batchId));
    this.persist();
  }
  private require(id: string): FeedPost {
    const post = this.data.posts.find((p) => p.id === id);
    if (!post) throw new FeedError("这条动态不存在", 404);
    return post;
  }
  like(id: string, liked: boolean): FeedPost {
    const post = this.require(id);
    post.liked = liked;
    if (liked) delete post.disliked;
    this.persist();
    return { ...post };
  }
  dislike(id: string, reason: unknown, note: unknown): FeedPost {
    const post = this.require(id);
    if (reason === null) { delete post.disliked; this.persist(); return { ...post }; }
    const picked = FEED_DISLIKE_REASONS.find((item) => item === reason);
    if (!picked) throw new FeedError("请选一个理由");
    const text = String(note ?? "").trim().slice(0, 200);
    post.disliked = { reason: picked, ...(text ? { note: text } : {}), at: new Date().toISOString() };
    post.liked = false;
    this.persist();
    return { ...post };
  }
  markDiscussed(id: string): FeedPost {
    const post = this.require(id);
    post.discussedAt = new Date().toISOString();
    this.persist();
    return { ...post };
  }
  remove(id: string): void {
    this.require(id);
    this.data.posts = this.data.posts.filter((p) => p.id !== id);
    this.persist();
  }
  /**
   * 口味信号：只认明确的动作（喜欢、讨论、不感兴趣），看过不算。
   * 直接交给写作提示，不另调模型去"总结口味"：便宜，也看得见依据。
   */
  taste(): FeedTaste {
    const recent = this.data.posts.slice(0, 120);
    return {
      liked: recent.filter((p) => p.liked || p.discussedAt).slice(0, 15).map((p) => p.title),
      disliked: recent.filter((p) => p.disliked).slice(0, 15).map((p) => `${p.title}（${p.disliked!.reason}${p.disliked!.note ? `：${p.disliked!.note}` : ""}）`),
    };
  }
  get(id: string): FeedPost | undefined { return this.data.posts.find((p) => p.id === id); }
}

/** 从模型回复里取第一个 JSON 对象；模型常在前后加说明或代码块标记。 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch { /* 往前找下一个右括号 */ }
  }
  return null;
}

export interface FeedTaste { liked: string[]; disliked: string[] }

export interface FeedContext {
  taste?: FeedTaste;
  prompt: string;
  goals: string[];
  matters: string[];
  preferences: string[];
  recentTitles: string[];
  today: string;
}

export function feedPlanPrompt(ctx: FeedContext): { system: string; user: string } {
  return {
    system: [
      "你负责为用户的个人动态挑选联网搜索词。",
      `只输出 JSON：{"queries": ["…"]}，最多 ${FEED_LIMITS.queries} 个，每个是具体、可搜索的中文或英文短语。`,
      "搜索词要落在用户话题和目标的具体领域上，不要泛泛的\"最新新闻\"。话题与新消息无关时返回空列表。",
    ].join("\n"),
    user: JSON.stringify({ 今天: ctx.today, 话题: ctx.prompt, 目标: ctx.goals, 在做的事: ctx.matters, 偏好: ctx.preferences }),
  };
}

export function parseFeedPlan(raw: string): string[] {
  const value = parseJsonObject(raw);
  const queries = Array.isArray(value?.queries) ? value!.queries : [];
  return [...new Set(queries.map((q) => String(q ?? "").trim()).filter((q) => q.length >= 2 && q.length <= 60))].slice(0, FEED_LIMITS.queries);
}

export function feedWritePrompt(ctx: FeedContext, sources: FeedCandidateSource[], searchNote: string): { system: string; user: string } {
  return {
    system: [
      "你在为用户写个人动态。只输出 JSON：{\"posts\": [{\"kind\": \"news|goal|tip\", \"title\": \"…\", \"body\": \"…\", \"sources\": [编号], \"why\": \"…\"}]}。",
      `最多 ${FEED_LIMITS.perBatch} 条；标题不超过 30 个字，正文不超过 120 个字，写给用户本人看，直接说重点。`,
      "每条都带 why：用\"你\"来写（例如\"你在准备冰岛自驾\"），一句话说明为什么给你看，依据只能是话题、给出的目标、在做的事或偏好，不许说读过对方没给的数据。",
      "口味：\"喜欢过\"说明对方想多看这类；\"不想看\"写了理由，别再写同类或犯同样的毛病（太重复就换角度，太具体就写得更有概括性）。",
      "news：只写下面\"来源\"里真的有的事实，sources 填对应编号，至少一个；来源里没写日期就不要说\"今天\"\"刚刚\"。",
      "goal：只根据给出的目标和在做的事写提醒或下一步，不编造进展，sources 留空。",
      "tip：和话题相关、确实有用的建议，不要空话，sources 可以留空。",
      "和\"最近已发过\"重复的不要再写。没有值得写的就返回 {\"posts\": []}，不要为了凑数硬写。不写标题党。",
    ].join("\n"),
    user: JSON.stringify({
      今天: ctx.today, 话题: ctx.prompt, 目标: ctx.goals, 在做的事: ctx.matters, 偏好: ctx.preferences, 最近已发过: ctx.recentTitles,
      喜欢过: ctx.taste?.liked ?? [], 不想看: ctx.taste?.disliked ?? [],
      联网情况: searchNote,
      来源: sources.map((s, i) => ({ 编号: i + 1, 标题: s.title, 链接: s.url, 摘要: s.content.slice(0, 400) })),
    }),
  };
}

/** 校验模型写的帖子：新闻必须引用真实来源编号；超长截断；和最近重复的丢掉。 */
export function parseFeedPosts(raw: string, sources: FeedCandidateSource[], recentTitles: string[], batchId: string, now = new Date().toISOString()): FeedPost[] {
  const value = parseJsonObject(raw);
  const items = Array.isArray(value?.posts) ? value!.posts : [];
  const seen = new Set(recentTitles.map(normalizeTitle));
  const out: FeedPost[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const kind = ["news", "goal", "tip"].includes(String(record.kind)) ? String(record.kind) as FeedPost["kind"] : "tip";
    const title = clip(record.title, FEED_LIMITS.title);
    const body = clip(record.body, FEED_LIMITS.body);
    if (!title || !body) continue;
    const refs = Array.isArray(record.sources) ? record.sources : [];
    const cited = [...new Set(refs.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length))]
      .map((n) => ({ title: sources[n - 1].title || sources[n - 1].url, url: sources[n - 1].url }))
      .filter((s) => /^https?:\/\//i.test(s.url));
    // 新闻没有可核对的来源就不收：宁可少一条，也不把模型的记忆当新闻。
    if (kind === "news" && cited.length === 0) continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const why = clip(record.why, 80);
    out.push({ id: randomUUID(), batchId, createdAt: now, kind, title, body, sources: cited, ...(why ? { why } : {}) });
    if (out.length >= FEED_LIMITS.perBatch) break;
  }
  return out;
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function normalizeTitle(value: string): string {
  return value.replace(/[\s，。、！？!?,.：:「」“”"'《》]/g, "").toLowerCase();
}
