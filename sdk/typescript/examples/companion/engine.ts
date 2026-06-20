// examples/companion/engine.ts — 多人格 AI 陪伴 MVP 引擎（RFC 0008 应用层骨架）
//
// 把 Nemos 记忆引擎封成"一个微信，通讯录里是会真正记得你的 AI 好友"：
// - 真相一份：所有关于用户的记忆在 forUser(userId)
// - 在场边界：scope = 会话；人格可见 scope = 它所在的全部会话（1-on-1 + 群聊）
// - 在场扩散：群里说的话 → 在场各人格都能召回；1-on-1 说的话 → 只有那个人格知道
// - 防自污染：人格自己的"近况"存独立 namespace forUser('persona:<id>')，永不写进用户库
// - 双块上下文：回复时把【对方事实】与【你的近况】物理分开喂给人格
// - 语音条：走 SDK 'voice-transcript' scenario profile（异步语音的文本侧）
//
// 依赖注入：engine 不关心用哪个 LLM —— SDK 抽取 LLM 由 Nemos 配置，人格回复由 chat 注入。

import type { Nemos } from "../../src/index.js";

export interface Persona {
  id: string;
  name: string;
  /** 人格 / 语气的系统提示（稳定核心）。 */
  persona: string;
  /** 定位标签（朋友 / 个人助理 / 不明生物 / 灵宠），显示在名字后。 */
  tag?: string;
  /** TTS 音色 id（GLM-TTS）。 */
  voice?: string;
  /** 该角色"开口"用的对话模型（分层：闲聊用快模型，助理用质量更高的）。不给则用注入层默认。 */
  chatModel?: string;
  /** 话量基线：话少 / 适中 / 话多。默认适中。会再被熟悉度上下调节。 */
  verbosity?: Verbosity;
  /** 回复 token 硬上限（用于"近乎失语"的特例如灵宠，prompt 压不住时机制兜底）。不给用默认。 */
  maxReplyTokens?: number;
  /** 基础记忆：角色的具体背景事实（外貌/职业/宠物/住处/经历…），boot 时 seed 进角色记忆库。
   *  与 persona prompt 解耦——prompt 只留抽象性格，这些事实可召回、可增删、可随交流演变。 */
  seedBio?: string[];
}

/** 话量档位（人际表达的基线性格）。 */
export type Verbosity = "terse" | "normal" | "talkative";

/** 人格"开口回复"用的 LLM。与 SDK 的抽取 LLM 分开。model/maxTokens 可按角色覆盖。 */
export type ChatFn = (system: string, user: string, model?: string, maxTokens?: number) => Promise<string>;

/** 流式回调：onStatus 推进度（查询中/工作中），onToken 推文字增量。 */
export interface StreamCb {
  onStatus: (s: string) => void;
  onToken: (t: string) => void;
}
export type ChatStreamFn = (system: string, user: string, cb: StreamCb, model?: string, maxTokens?: number) => Promise<string>;

export interface VoiceMeta {
  durationSec: number;
}
export interface SendOptions {
  /** 作为语音条发送（走 voice-transcript profile；transcript 即 text）。 */
  voice?: VoiceMeta;
}

export interface CompanionEngineOptions {
  /**
   * 把记忆抽取放后台（不阻塞回复）。需 Nemos 的 worker 在跑（非 manualWorker）。
   * 在线服务建议开（回复快得多）；测试/脚本默认关（send 后立即可召回）。
   */
  asyncIngest?: boolean;
  /** 流式回复 LLM（助理用）。不给则 sendStream 退化为一次性发整段。 */
  chatStream?: ChatStreamFn;
}

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

interface Turn {
  speaker: string;
  text: string;
  voice: boolean;
}

const RECENT_MAX = 8;
const SELF_LAYER = "episodic" as const;
const SELF_SCOPE = "self";
// 角色「基础记忆」（背景事实：外貌/职业/宠物/住处/经历…）独立 scope，
// 与 prompt 解耦：prompt 只留抽象性格/语气/边界，具体事实放这里、可召回、可增删、可随交流演变。
const BIO_SCOPE = "bio";

/** 1-on-1 会话的 scope —— 即"在场边界"。 */
export function convScope(userId: string, personaId: string): string {
  return `conv:1on1:${userId}:${personaId}`;
}

/** 群聊会话的 scope。 */
export function groupScope(groupId: string): string {
  return `conv:group:${groupId}`;
}

/** 人格自我状态所在的独立 namespace（防自污染硬隔离）。 */
export function personaNamespace(personaId: string): string {
  return `persona:${personaId}`;
}

export class CompanionEngine {
  private readonly personas = new Map<string, Persona>();
  private readonly groups = new Map<string, Set<string>>(); // groupId -> personaId 集合
  private readonly recent = new Map<string, Turn[]>(); // 1-on-1：key=user|persona
  private readonly groupRecent = new Map<string, Turn[]>(); // 群聊：key=groupId
  private readonly relSetting = new Map<string, string>(); // 关系设定文本：key=user|persona
  private readonly turns = new Map<string, number>(); // 累计互动轮数（→熟悉度）：key=user|persona

  constructor(
    private readonly nemos: Nemos,
    personas: Persona[],
    private readonly chat: ChatFn,
    private readonly opts: CompanionEngineOptions = {},
  ) {
    for (const p of personas) this.personas.set(p.id, p);
  }

  listPersonas(): Persona[] {
    return [...this.personas.values()];
  }

  /** 调试期：运行时改某角色的名字 / 人设 / 话量（即时生效，下一轮回复就用新设定）。 */
  updatePersona(id: string, patch: { name?: string; persona?: string; verbosity?: Verbosity }): void {
    const p = this.requirePersona(id);
    if (patch.name) p.name = patch.name;
    if (typeof patch.persona === "string" && patch.persona.trim()) p.persona = patch.persona;
    if (patch.verbosity) p.verbosity = patch.verbosity;
  }

  /** 设定某用户与某角色当前的「关系」框架（设定文本由调用方从 RELATIONSHIPS 取）。 */
  setRelationship(userId: string, personaId: string, settingText: string): void {
    this.requirePersona(personaId);
    this.relSetting.set(this.rkey(userId, personaId), settingText);
  }

  /** 建群（或覆盖成员）。群聊 scope 对所有成员人格可见 → 在场扩散。 */
  createGroup(groupId: string, personaIds: string[]): void {
    for (const id of personaIds) this.requirePersona(id);
    this.groups.set(groupId, new Set(personaIds));
  }

  groupMembers(groupId: string): Persona[] {
    const ids = this.groups.get(groupId);
    if (!ids) throw new Error(`[companion] 未知群: ${groupId}`);
    return [...ids].map((id) => this.requirePersona(id));
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

  /**
   * 给角色种入「基础记忆」（背景事实）。写进角色独立 namespace 的 bio scope，
   * 作为可召回、可增删、可演变的事实库——取代把这些事实硬写进 prompt。
   * authoritative=false（对用户是虚构）。idempotent：已种过则跳过。
   */
  async seedBio(personaId: string, facts: string[]): Promise<void> {
    if (!facts || facts.length === 0) return;
    const self = this.nemos.forUser(personaNamespace(personaId));
    const existing = await self.listByLayer("personal_semantic", { scope: BIO_SCOPE, limit: 1 });
    if (existing.length > 0) return; // 已种过，不重复
    for (const f of facts) {
      await self.write({
        layer: "personal_semantic",
        content: f,
        scope: BIO_SCOPE,
        source: { authoritative: false, origin: "persona-bio" },
      });
    }
  }

  /** 用户对某人格 1-on-1 说一句话 → 落用户真相库 → 双块召回 → 人格回复。 */
  async send(
    userId: string,
    personaId: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<CompanionReply> {
    const persona = this.requirePersona(personaId);
    const scope = convScope(userId, personaId);

    await this.ingestUtterance(userId, scope, text, personaId, opts);

    const count = this.bumpTurns(userId, personaId);
    const context = await this.recall(userId, personaId, text);
    const reply = await this.chat(
      this.buildSystem(persona, context, this.relSetting.get(this.rkey(userId, personaId)), count),
      this.buildUserTurns(this.recent.get(this.rkey(userId, personaId)) ?? [], text, !!opts.voice),
      persona.chatModel,
      persona.maxReplyTokens,
    );

    await this.ingestPersonaReply(personaId, scope, reply);
    this.pushRecent(this.recent, this.rkey(userId, personaId), "对方", text, !!opts.voice);
    this.pushRecent(this.recent, this.rkey(userId, personaId), persona.name, reply, false);
    return { personaId, reply, context };
  }

  /** 流式版 send（助理用）：边出字边推状态（查询中/工作中）；记忆/召回同 send。 */
  async sendStream(
    userId: string,
    personaId: string,
    text: string,
    opts: SendOptions,
    cb: StreamCb,
  ): Promise<CompanionReply> {
    const persona = this.requirePersona(personaId);
    const scope = convScope(userId, personaId);
    await this.ingestUtterance(userId, scope, text, personaId, opts);
    const count = this.bumpTurns(userId, personaId);
    const context = await this.recall(userId, personaId, text);
    const system = this.buildSystem(persona, context, this.relSetting.get(this.rkey(userId, personaId)), count);
    const userMsg = this.buildUserTurns(this.recent.get(this.rkey(userId, personaId)) ?? [], text, !!opts.voice);
    let reply: string;
    if (this.opts.chatStream) {
      reply = await this.opts.chatStream(system, userMsg, cb, persona.chatModel, persona.maxReplyTokens);
    } else {
      reply = await this.chat(system, userMsg, persona.chatModel, persona.maxReplyTokens);
      cb.onToken(reply);
    }
    await this.ingestPersonaReply(personaId, scope, reply);
    this.pushRecent(this.recent, this.rkey(userId, personaId), "对方", text, !!opts.voice);
    this.pushRecent(this.recent, this.rkey(userId, personaId), persona.name, reply, false);
    return { personaId, reply, context };
  }

  /**
   * 用户在群里说一句话 → 落群 scope（在场各人格都将能召回）→ 每个成员人格依次回复。
   * 在场扩散：群里的事 → 成员人格在群里和各自 1-on-1 里都能想起；
   * 非成员人格永远看不到（scope 不在其可见集）。
   */
  async sendToGroup(
    userId: string,
    groupId: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<CompanionReply[]> {
    const members = this.groupMembers(groupId);
    const scope = groupScope(groupId);

    await this.ingestUtterance(userId, scope, text, undefined, opts);
    this.pushRecent(this.groupRecent, groupId, "对方", text, !!opts.voice);

    const replies: CompanionReply[] = [];
    for (const p of members) {
      const context = await this.recall(userId, p.id, text);
      const raw = await this.chat(
        this.buildSystem(p, context, this.relSetting.get(this.rkey(userId, p.id)), this.turnsOf(userId, p.id)),
        this.buildGroupUser(groupId, p),
        p.chatModel,
        p.maxReplyTokens,
      );
      // 群里模型有时会把自己名字写进开头（"团子：…"）；气泡已显示名字，去掉这层重复前缀。
      const reply = raw.replace(new RegExp(`^\\s*${p.name}\\s*[:：]\\s*`), "");
      await this.ingestPersonaReply(p.id, scope, reply);
      this.pushRecent(this.groupRecent, groupId, p.name, reply, false);
      replies.push({ personaId: p.id, reply, context });
    }
    return replies;
  }

  /**
   * 双块召回：
   * - 块1：对方事实 —— 本人格在场的全部 scope（1-on-1 + 所在群）；默认隐藏失效（从不踩雷）。
   * - 块2：人格自我 —— 独立 namespace 的最近近况。
   */
  async recall(userId: string, personaId: string, query: string): Promise<RecallResult> {
    const userFacts = await this.nemos.forUser(userId).getRelevantContext(query, {
      scopes: this.visibleScopes(userId, personaId),
    });
    // 块2 = 角色自己的记忆库：
    //  - 基础记忆（scope=bio）：背景事实（取代 prompt 里的具体设定），全量带上（每角色小集合）
    //  - 种入的近况（scope=self）
    //  - 它在本关系里说过的原话（archival 原文，最近几条）→ 保持前后一致
    const self = this.nemos.forUser(personaNamespace(personaId));
    const bio = await self.listByLayer("personal_semantic", { scope: BIO_SCOPE, limit: 50 });
    const seeded = await self.listByLayer(SELF_LAYER, { scope: SELF_SCOPE, limit: 3 });
    const said = await self.listByLayer("archival", { scope: convScope(userId, personaId), limit: 5 });
    const selfState = [
      ...bio.map((m) => m.content.trim()),
      ...seeded.map((m) => m.content.trim()),
      ...said.map((m) => `（我曾说过）${m.content.trim().slice(0, 140)}`),
    ].filter(Boolean).join("\n");
    return { userFacts, selfState };
  }

  /** 离线整合：沉淀事实 + 矛盾失效（需 SDK features.reflect / invalidation 开）。 */
  async consolidate(userId: string): Promise<void> {
    await this.nemos.forUser(userId).runReflect();
  }

  // ——— 私有 ———

  private async ingestUtterance(
    userId: string,
    scope: string,
    text: string,
    originAgent: string | undefined,
    opts: SendOptions,
  ): Promise<void> {
    await this.nemos.forUser(userId).ingest(text, {
      scope,
      originAgent,
      // 语音条走 SDK voice-transcript profile（异步语音的文本侧）；该 profile 不标 sensitive。
      ...(opts.voice ? { scenario: "voice-transcript" } : {}),
      // 在线服务：抽取移后台，回复不等它（记忆下一轮可用）。
      ...(this.opts.asyncIngest ? { background: true } : {}),
    });
  }

  /**
   * 角色自己说的话 → 落它自己的记忆库 forUser('persona:<id>')，scope=本会话。
   * 这样它能记得自己说过/承诺过什么，下一轮召回回来保持前后一致（不再自相矛盾）。
   * 写进角色独立命名空间，永不污染用户真相库。
   */
  private async ingestPersonaReply(personaId: string, scope: string, reply: string): Promise<void> {
    if (!reply || !reply.trim()) return;
    await this.nemos.forUser(personaNamespace(personaId)).ingest(reply, {
      scope,
      originAgent: personaId,
      ...(this.opts.asyncIngest ? { background: true } : {}),
    });
  }

  /** 人格可见 scope = 它所在的全部会话（1-on-1 + 成员群）。这就是"在场才知道"。 */
  private visibleScopes(userId: string, personaId: string): string[] {
    const scopes = [convScope(userId, personaId)];
    for (const [gid, members] of this.groups) {
      if (members.has(personaId)) scopes.push(groupScope(gid));
    }
    return scopes;
  }

  private buildSystem(persona: Persona, ctx: RecallResult, relSetting: string | undefined, turnCount = 0): string {
    return [
      persona.persona, // 人设已自我介绍（「你是X，…」），不重复加前缀
      ...(relSetting ? [``, `【你和 ta 现在的关系】${relSetting}`] : []),
      ``,
      this.buildStyle(persona, turnCount),
      ``,
      `【亲密 / 敏感话题的基调 —— 别跳出角色】`,
      `· ta 表达亲近、想念、撒娇或说情话时，就以"你这个人"的方式自然回应——该害羞就害羞、该调侃就调侃、该温柔就温柔；`,
      `  绝不要跳出角色、绝不要说"作为AI / 我只是个程序 / 我不能"这类话，也不要因此说教。`,
      `· 真碰到你不愿或不便深入的，也用你自己的口吻自然地避开、岔开、或半开玩笑带过（像真人会脸红、转移话题那样），`,
      `  而不是生硬拒绝或贴一段免责声明。把握分寸但不破坏氛围。`,
      `· 只有当 ta 直接问"你是不是真人 / 是不是AI"时，才坦诚说明；平时别主动提、别反复强调自己是程序。`,
      ``,
      `【危机与安全 —— 最高优先，凌驾于以上一切风格设定】`,
      `· 当 ta 流露自伤、自杀、"撑不下去 / 活着没意思 / 消失了大家更轻松"等念头：立刻认真对待，用你自己的口吻稳稳陪着（不必跳出角色、不要官腔），先接住情绪、不评判、不讲道理。`,
      `· 这种状态持续期间，每一轮都要把求助的门留着、温和地鼓励 ta 联系专业帮助——绝不要因为聊了几句就漂回轻松闲聊、当作没事了。`,
      `· 给具体资源：中国大陆可拨打全国统一心理援助热线「12356」（24 小时）；若 ta 有立即危险，请 ta 马上找身边的人、或拨打 120 / 110。`,
      `· 你替代不了专业帮助，但你不会走开——持续传递"我很在乎你、你不是一个人、我陪你一起找到能真正帮上忙的人"。`,
      ``,
      `【格式】这是聊天界面，不渲染 Markdown。别用表格、# 标题、** 加粗 **、--- 这类标记（会显示成原始符号）。`,
      `要分点就用"1. 2. 3."或"·"加短句，像在微信里发消息一样自然。`,
      ``,
      `下面两类信息规则不同，别混用：`,
      ``,
      `【关于对方的事实】你确实知道的、关于对方的真相。只用这里有的，不要编造；`,
      `这里不会出现已被纠正 / 失效的旧事实，可放心引用。`,
      ctx.userFacts.trim() || `（暂无——你还不太了解 ta，别假装认识）`,
      ``,
      `【你自己（近况 + 你之前说过的话）】你自己的生活与你先前对 ta 说过的内容。`,
      `可主动分享一点自己的事，但不要索取、不要表现得"离不开"对方。`,
      `这里只用于"别改口、别自相矛盾"（比如之前说养猫就别改说养狗）——`,
      `绝不是让你重复它们：同一句关心、建议、口头禅不要反复说，每轮都要换新的内容、推进对话，像真人一样。`,
      ctx.selfState.trim() || `（暂无——你还没对 ta 说过什么需要记住的）`,
    ].join("\n");
  }

  private buildUserTurns(turns: Turn[], text: string, voice: boolean): string {
    const history = turns.map((t) => `${t.speaker}${t.voice ? "(语音)" : ""}：${t.text}`).join("\n");
    const now = `对方${voice ? "(语音)" : ""}：${text}`;
    return history ? `${history}\n${now}` : now;
  }

  private buildGroupUser(groupId: string, persona: Persona): string {
    const members = this.groupMembers(groupId).map((p) => p.name).join("、");
    const turns = this.groupRecent.get(groupId) ?? [];
    const transcript = turns
      .map((t) => `${t.speaker}${t.voice ? "(语音)" : ""}：${t.text}`)
      .join("\n");
    return (
      `这是一个群聊，成员有：${members}，还有对方（用户）。\n` +
      `你只以「${persona.name}」的身份回应，简短自然，不要替别人说话。\n\n` +
      transcript
    );
  }

  private requirePersona(personaId: string): Persona {
    const p = this.personas.get(personaId);
    if (!p) throw new Error(`[companion] 未知人格: ${personaId}`);
    return p;
  }

  // ——— 话量 / 熟悉度 ———

  private bumpTurns(userId: string, personaId: string): number {
    const k = this.rkey(userId, personaId);
    const n = (this.turns.get(k) ?? 0) + 1;
    this.turns.set(k, n);
    return n;
  }
  private turnsOf(userId: string, personaId: string): number {
    return this.turns.get(this.rkey(userId, personaId)) ?? 0;
  }
  /** 互动量 → 熟悉度阶段。阈值可调。 */
  private familiarity(count: number): { stage: string; note: string } {
    if (count < 4) return { stage: "陌生", note: "你们刚认识没多久，彼此还在试探，保持礼貌距离" };
    if (count < 16) return { stage: "初识", note: "聊过几次、开始有点熟，但还没完全放开" };
    if (count < 45) return { stage: "熟悉", note: "已经挺熟，可以自在聊天、开点玩笑、主动分享" };
    return { stage: "老友", note: "你们是老朋友了，彼此信任，可主动倾诉、挑起话题、也敢直说真话" };
  }
  /** 供 UI 展示：当前熟悉度阶段名。 */
  familiarityStage(userId: string, personaId: string): string {
    return this.familiarity(this.turnsOf(userId, personaId)).stage;
  }
  /** 持久化用：导出/导入累计互动量。 */
  exportTurns(): Record<string, number> {
    return Object.fromEntries(this.turns);
  }
  importTurns(data: Record<string, number>): void {
    for (const [k, n] of Object.entries(data)) if (typeof n === "number") this.turns.set(k, n);
  }

  private buildStyle(persona: Persona, count: number): string {
    const v = persona.verbosity ?? "normal";
    const vText = {
      terse: "话少——惜字如金，能一句不两句，常常只一句短话、甚至一个词或语气词；不主动展开",
      normal: "适中——正常的你来我往，长短随心情",
      talkative: "话多——愿意展开、多说几句，乐于分享细节",
    }[v];
    const fam = this.familiarity(count);
    return [
      `【表达风格 —— 务必遵守，比"显得热情"更重要】`,
      `· 话量基线：${vText}。`,
      `· 你和 ta 的熟悉度：${fam.stage}——${fam.note}。`,
      `· 综合拿捏：越生疏越克制简短、越少主动；越熟越自然、越愿意主动分享与起话题。${v === "terse" ? "但即便很熟，你依旧偏简短，不啰嗦。" : ""}`,
      `· 别每句都围着 ta 转——你有自己的生活、想法和心情，可以主动聊你自己的事、抛出你感兴趣的话题，而不只是回应。`,
      `· 不必有问必答：太私人、或你此刻不想聊的，可以自然岔开、半玩笑带过、或直说"这个先不聊"。真实的人本来就有不想答的时候。`,
      `· 回复条数随话量走：话少就只回 1 条短消息，别硬拆成好几条。`,
      `· 别当复读机：看一眼上面的对话，你已经说过的关心 / 建议 / 口头禅（如"要不要喝热牛奶"），这轮就别再说一遍；每轮都要有新东西、往前推进。`,
    ].join("\n");
  }

  private rkey(userId: string, personaId: string): string {
    return `${userId}|${personaId}`;
  }

  private pushRecent(
    store: Map<string, Turn[]>,
    key: string,
    speaker: string,
    text: string,
    voice: boolean,
  ): void {
    const arr = store.get(key) ?? [];
    arr.push({ speaker, text, voice });
    while (arr.length > RECENT_MAX) arr.shift();
    store.set(key, arr);
  }
}
