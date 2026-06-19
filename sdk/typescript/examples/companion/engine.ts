// examples/companion/engine.ts — 多人格 AI 陪伴 MVP 引擎（RFC 0008 应用层骨架）
//
// 把 Nemos 记忆引擎封成"一个微信，通讯录里是会真正记得你的 AI 好友"：
// - 真相一份：所有关于用户的记忆在 forUser(userId)
// - 在场边界：scope = 'conv:1on1:<user>:<persona>'，人格检索只看自己在场的会话
// - 防自污染：人格自己的"近况"存独立 namespace forUser('persona:<id>')，永不写进用户库
// - 双块上下文：回复时把【对方事实】与【你的近况】物理分开喂给人格
//
// 依赖注入：engine 不关心用哪个 LLM —— SDK 抽取 LLM 由 Nemos 配置，人格回复由 chat 注入。

import type { Nemos } from "../../src/index.js";

export interface Persona {
  id: string;
  name: string;
  /** 人格 / 语气的系统提示（稳定核心）。 */
  persona: string;
}

/** 人格"开口回复"用的 LLM。与 SDK 的抽取 LLM 分开。 */
export type ChatFn = (system: string, user: string) => Promise<string>;

export interface CompanionReply {
  personaId: string;
  reply: string;
  /** 供检视 / 测试：本轮喂给人格的两块上下文。 */
  context: RecallResult;
}

export interface RecallResult {
  /** 块1：关于对方的事实（仅本人格在场的 scope；默认已隐藏失效事实）。 */
  userFacts: string;
  /** 块2：人格自己的近况（独立 namespace 的最近自述）。 */
  selfState: string;
}

const RECENT_MAX = 8;
const SELF_LAYER = "episodic" as const;
const SELF_SCOPE = "self";

/** 1-on-1 会话的 scope —— 即"在场边界"。 */
export function convScope(userId: string, personaId: string): string {
  return `conv:1on1:${userId}:${personaId}`;
}

/** 人格自我状态所在的独立 namespace（防自污染硬隔离）。 */
export function personaNamespace(personaId: string): string {
  return `persona:${personaId}`;
}

export class CompanionEngine {
  private readonly personas = new Map<string, Persona>();
  private readonly recent = new Map<string, Array<{ role: "user" | "persona"; text: string }>>();

  constructor(
    private readonly nemos: Nemos,
    personas: Persona[],
    private readonly chat: ChatFn,
  ) {
    for (const p of personas) this.personas.set(p.id, p);
  }

  listPersonas(): Persona[] {
    return [...this.personas.values()];
  }

  /**
   * 给某人格种入"近况"（轻倾诉素材）。写进**独立 namespace**，
   * authoritative=false（对用户而言是虚构），永不污染用户事实库。
   */
  async seedSelfState(personaId: string, lines: string[]): Promise<void> {
    const self = this.nemos.forUser(personaNamespace(personaId));
    for (const line of lines) {
      await self.write({
        layer: SELF_LAYER,
        content: line,
        scope: SELF_SCOPE,
        source: { authoritative: false, origin: "persona-self" },
      });
    }
  }

  /** 用户对某人格说一句话 → 落用户真相库 → 双块召回 → 人格回复。 */
  async send(userId: string, personaId: string, text: string): Promise<CompanionReply> {
    const persona = this.requirePersona(personaId);
    const scope = convScope(userId, personaId);

    // 1) 落进用户真相库：scope=会话(在场边界)，origin_agent=听到它的人格。
    //    （scenario 标签 companion:1on1/group 留作后续——需注册自定义 ScenarioProfile；
    //     MVP 的在场边界完全由 scope 承载。）
    await this.nemos.forUser(userId).ingest(text, {
      scope,
      originAgent: personaId,
    });

    // 2) 双块召回
    const context = await this.recall(userId, personaId, text);

    // 3) 组装 prompt + 人格回复
    const reply = await this.chat(
      this.buildSystem(persona, context),
      this.buildUser(userId, personaId, text),
    );

    this.pushRecent(userId, personaId, "user", text);
    this.pushRecent(userId, personaId, "persona", reply);
    return { personaId, reply, context };
  }

  /**
   * 双块召回：
   * - 块1：对方事实 —— 仅本人格在场的 scope；getRelevantContext 默认隐藏失效事实（从不踩雷）。
   * - 块2：人格自我 —— 独立 namespace 的最近近况（与查询无关，"我有事想分享"）。
   */
  async recall(userId: string, personaId: string, query: string): Promise<RecallResult> {
    const userFacts = await this.nemos.forUser(userId).getRelevantContext(query, {
      scopes: this.visibleScopes(userId, personaId),
    });
    const selfMems = await this.nemos
      .forUser(personaNamespace(personaId))
      .listByLayer(SELF_LAYER, { scope: SELF_SCOPE, limit: 3 });
    const selfState = selfMems.map((m) => m.content).join("\n");
    return { userFacts, selfState };
  }

  /** 离线整合：沉淀事实 + 矛盾失效（需 SDK features.reflect / invalidation 开）。 */
  async consolidate(userId: string): Promise<void> {
    await this.nemos.forUser(userId).runReflect();
  }

  // MVP：1-on-1 只看自己这段会话。群聊版会并入在场的群 scope（RFC 0008 §3）。
  private visibleScopes(userId: string, personaId: string): string[] {
    return [convScope(userId, personaId)];
  }

  private buildSystem(persona: Persona, ctx: RecallResult): string {
    return [
      `你是${persona.name}。${persona.persona}`,
      ``,
      `你在和对方一对一聊天。下面两类信息规则不同，别混用：`,
      ``,
      `【关于对方的事实】你确实知道的、关于对方的真相。只用这里有的，不要编造；`,
      `这里不会出现已被纠正 / 失效的旧事实，可放心引用。`,
      ctx.userFacts.trim() || `（暂无——你还不太了解 ta，别假装认识）`,
      ``,
      `【你自己的近况】你自己的生活，可以主动分享一点；但不要索取，不要表现得"离不开"对方。`,
      ctx.selfState.trim() || `（无特别近况）`,
    ].join("\n");
  }

  private buildUser(userId: string, personaId: string, text: string): string {
    const turns = this.recent.get(this.rkey(userId, personaId)) ?? [];
    const history = turns.map((t) => `${t.role === "user" ? "对方" : "你"}：${t.text}`).join("\n");
    return history ? `${history}\n对方：${text}` : `对方：${text}`;
  }

  private requirePersona(personaId: string): Persona {
    const p = this.personas.get(personaId);
    if (!p) throw new Error(`[companion] 未知人格: ${personaId}`);
    return p;
  }

  private rkey(userId: string, personaId: string): string {
    return `${userId}|${personaId}`;
  }

  private pushRecent(
    userId: string,
    personaId: string,
    role: "user" | "persona",
    text: string,
  ): void {
    const k = this.rkey(userId, personaId);
    const arr = this.recent.get(k) ?? [];
    arr.push({ role, text });
    while (arr.length > RECENT_MAX) arr.shift();
    this.recent.set(k, arr);
  }
}
