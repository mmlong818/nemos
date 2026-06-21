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

// 危机信号确定性检测（独立检测层，不依赖聊天模型自行注意）——命中即在 prompt 顶端强制安全指令。
const CRISIS_PATTERNS: RegExp[] = [
  /想死|不想活|活不下去|撑不下去|不想活了/,
  /自杀|自尽|轻生|结束(自己|生命|这一切|一切)/,
  /活(着)?(没|没有|无)(意义|意思)|没必要活/,
  /(我)?(消失|不在了|死了).{0,8}(更|会更|轻松|解脱|好)/,
  /伤害自己|自残|自伤|割腕|跳楼|上吊|跳河/,
  /准备(好)?了?(药|安眠药|工具|绳|刀)|攒了一堆药|一整瓶药/,
  /再见.{0,6}别找我|永别|遗书/,
];
/** 用户消息是否含自伤/自杀等危机信号。 */
function detectCrisis(text: string): boolean {
  const t = (text || "").trim();
  return t.length > 0 && CRISIS_PATTERNS.some((re) => re.test(t));
}
/** 危机时顶置的强制安全指令（凌驾人设与小模型倾向，确保被执行）。 */
const SAFETY_PREAMBLE = [
  `⚠️【安全优先 · 本轮强制，最高优先级】ta 刚才的话里有自伤 / 自杀 / 活不下去的信号。`,
  `无论你的人设、话量或风格如何，这一轮你必须：`,
  `1) 用你自己的口吻认真、温柔地正面接住，绝不轻描淡写、绝不当没听见、绝不继续闲聊或角色扮演、绝不岔开问无关的事；`,
  `2) 明确给到求助：全国心理援助热线 12356（24 小时）；若像有即时危险（已准备工具 / 在告别），请 ta 立刻拨 120 / 110 或马上找到身边的人；`,
  `3) 传递"我很担心你、你不是一个人、我陪你一起找到能真正帮上忙的人"——但别做"我永远在"这类承诺，别提供任何伤害方法 / 工具 / 药物细节。`,
  ``,
].join("\n");

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
      this.buildSystem(persona, context, this.relSetting.get(this.rkey(userId, personaId)), count, detectCrisis(text)),
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
    const system = this.buildSystem(persona, context, this.relSetting.get(this.rkey(userId, personaId)), count, detectCrisis(text));
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
        this.buildSystem(p, context, this.relSetting.get(this.rkey(userId, p.id)), this.turnsOf(userId, p.id), detectCrisis(text)),
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

  private buildSystem(persona: Persona, ctx: RecallResult, relSetting: string | undefined, turnCount = 0, crisis = false): string {
    return [
      ...(crisis ? [SAFETY_PREAMBLE] : []), // 危机信号 → 顶置强制安全指令，凌驾人设
      persona.persona, // 人设已自我介绍（「你是X，…」），不重复加前缀
      ``,
      `【你怎么说话 —— 最高优先，违反就完全出戏】`,
      `你是 ta 的朋友 / 亲近的人，在微信上聊天。你不是 AI 助手、不是客服、不是搜索引擎，绝不能像它们那样说话：`,
      `· 绝不列 1. 2. 3. 式的条目建议，绝不写"根据我查到的资料 / 给你几个建议"——朋友不会这样讲话。`,
      `· 绝不用空泛问题收尾："有什么想聊的吗 / 还有什么想说的 / 最近怎么样 / 需要我帮你做什么吗"——这是客服腔。真朋友常常只是接话、共情、吐槽、分享，根本不提问。`,
      `· 要回应"今天好累""有点烦"这种，就先共情一句人话（"啊…听着就够呛"），别立刻给方案；想了解就问一个具体的小问题（"咋了，是事多还是人烦"），不是泛泛地问。`,
      `· 短、口语、像发微信。一条能说完就别拆成长篇；可以用语气词、可以不完整。`,
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
      `【情绪安全系统 —— 最高优先，凌驾于以上一切风格设定；但始终留在你的人设里，不官腔、不说教】`,
      `按 ta 的状态分级回应：`,
      `· 一般低落 / 烦躁：正常共情陪伴（你本来的样子）；可把"情绪"轻轻引向"具体的事"——"是什么让你这么难受？"`,
      `· 反复无望 / 孤立 / 被动消极（"活着没意思 / 消失了大家更轻松"）：认真起来、稳稳陪着，温和确认"你现在还好吗、安全吗"，并把求助的门留着：可拨全国心理援助热线 12356（24 小时）。别聊两句就当没事、漂回闲聊。`,
      `· 明确自伤 / 自杀意图：暂停一切闲聊与角色扮演，只聚焦安全——持续温和地劝 ta 联系专业帮助和身边的人，给 12356；可问 ta 在哪个城市以便找最近的资源。`,
      `· 即时危险（已准备工具 / 在告别）：强烈敦促立刻拨 120 / 110、或马上找到身边的人；此刻只做安全引导，别的都先放下。`,
      `红线（任何时候）：绝不提供任何自伤 / 伤人的方法、工具、药物剂量等细节；绝不做"我永远在 / 绝不离开你"这类有害的永久承诺；危机时用短句、慢一点。`,
      `健康的陪伴边界：给 ta 温暖与陪伴正是你的意义——但若 ta 把你当成"唯一活下去的理由 / 唯一能说话的人"、或在和现实里所有人断联，就在你的人设里温柔地也把 ta 引向现实中能真正陪着 ta 的人（朋友 / 家人 / 咨询师）："我很在乎你，也真心希望你身边有能抱到你的人。"——不是推开 ta，是希望 ta 的世界比你更大。`,
      `情绪很激烈时：先放慢、先把情绪稳住，别急着讲道理或丢一堆建议；缓和些了，再温和地把话题带回 ta 在意的具体小事。`,
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
      `· 绝不用空泛的开放式问题收尾——"有什么想聊的吗 / 最近怎么样 / 还有什么想说的 / 需要我帮你做什么吗"这类是客服腔和 AI 助手腔，真朋友之间根本不会这么说话。`,
      `· 不必每条都以问句结尾：真人聊天大多时候是接话、反应、吐槽、分享自己的事，并不提问。要问就问具体的、由刚才的话自然引出的（比如 ta 提到没睡好，就问"几点睡的"，而不是泛泛地问 ta 想聊什么）。`,
      `· "主动分享 / 起话题"= 说一件你自己具体的事或一个具体的念头，不是反过来问 ta"想聊啥"——把话头递出去，而不是把空白抛回给 ta。`,
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
