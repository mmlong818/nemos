import { randomUUID } from "node:crypto";
import { getPredicate, inferPersonalBestActivity, makeClaimKey } from "./claims.js";
import type { Storage } from "./storage.js";
import { RECALL_ALGORITHM_VERSION } from "./types.js";
import { hasDurableSalience } from "./salience.js";
import type {
  EmbeddingProvider,
  Layer,
  Memory,
  MemoryPacket,
  QueryPlan,
  RecallChannel,
  RecallChannelTrace,
  RecallIntent,
  RecallItem,
  RecallOptions,
  RecallRejection,
  RecallTimeRange,
  RecallTrace,
} from "./types.js";

const RRF_K = 60;
const DEFAULT_MIN_SCORE = 1 / (RRF_K + 50);
const CHANNEL_WEIGHTS: Record<RecallChannel, number> = {
  claim: 1.6,
  evidence: 1.4,
  fts: 1,
  embedding: 1,
  entity: 1.25,
  time: 1.2,
  related: 0.75,
  recent: 0.4,
  domain: 0.5,
};

interface ChannelResult {
  channel: RecallChannel;
  memories: Memory[];
  elapsedMs: number;
  error?: string;
}

interface RecallServiceOptions {
  storage: Storage;
  embedding: EmbeddingProvider | null;
  tenantId: string;
  userId: string;
  defaultScope: string;
  rerank?: (query: string, memories: Memory[], options: RecallOptions) => Promise<Memory[]>;
}

export class RecallTraceStore {
  private readonly traces = new Map<string, RecallTrace>();

  constructor(private readonly maxEntries = 100) {}

  put(trace: RecallTrace): void {
    this.traces.set(trace.id, trace);
    while (this.traces.size > this.maxEntries) {
      const first = this.traces.keys().next().value as string | undefined;
      if (!first) break;
      this.traces.delete(first);
    }
  }

  get(traceId: string): RecallTrace | null {
    return this.traces.get(traceId) ?? null;
  }
}

export function planRecallQuery(
  query: string,
  options: RecallOptions = {},
  defaultScope = "global",
): QueryPlan {
  const normalized = query.trim();
  const intent = inferIntent(normalized);
  const scopes = options.scopes !== undefined
    ? unique(options.scopes)
    : options.scope
      ? [options.scope]
      : [defaultScope];  const subjectIds = unique(options.subjectIds ?? inferSubjects(normalized));
  const predicates = unique(
    (options.predicates ?? inferPredicates(normalized))
      .map((value) => getPredicate(value)?.id ?? value.trim())
      .filter(Boolean),
  );
  const claimKeys = unique([
    ...(options.claimKeys ?? []),
    ...subjectIds.flatMap((subjectId) => predicates.flatMap((predicate) => {
      const context = inferClaimContext(normalized, predicate);
      return context === null ? [] : [makeClaimKey(subjectId, predicate, context)];
    })),
  ]);
  const timeRange = normalizeTimeRange(options.timeRange ?? inferTimeRange(normalized, options.now));
  const includeHistorical = options.includeHistorical === true
    || options.includeInvalidated === true
    || intent === "historical_fact"
    || isPastTimeRange(timeRange, options.now);
  return {
    algorithm_version: RECALL_ALGORITHM_VERSION,
    query: normalized,
    intent,
    layers: options.layers ?? layersForIntent(intent, normalized),
    scopes,
    subject_ids: subjectIds,
    predicates,
    claim_keys: claimKeys,
    entity_terms: unique([...(options.entities ?? []), ...inferEntityTerms(normalized)]).slice(0, 8),
    time_range: timeRange,
    include_sensitive: options.includeSensitive === true || options.sensitiveOnly === true || isExplicitSensitiveQuery(normalized),
    include_historical: includeHistorical,
    include_related: options.includeRelated !== false,
    include_evidence: options.includeEvidence !== false,
    include_recent:
      intent === "episode" && /最近|刚才|今天|昨天|上周|上个月|发生|recent|latest|happened/i.test(normalized),
    max_candidates_per_channel: clamp(options.maxCandidatesPerChannel ?? 50, 1, 50),
    max_results: clamp(options.maxResults ?? options.topK ?? 12, 1, 50),
    max_tokens: clamp(options.maxTokens ?? 1800, 128, 8192),
  };
}

export class RecallService {
  constructor(
    private readonly options: RecallServiceOptions,
    private readonly traces: RecallTraceStore,
  ) {}

  async recall(query: string, recallOptions: RecallOptions = {}): Promise<MemoryPacket> {
    const started = performance.now();
    const plan = planRecallQuery(query, recallOptions, this.options.defaultScope);
    if (!plan.query) return this.emptyPacket(plan, started, "empty_query");

    const filter = {
      includeSensitive: plan.include_sensitive,
      sensitiveOnly: recallOptions.sensitiveOnly === true,
      includeCold: recallOptions.includeCold === true,
      includeInvalidated: plan.include_historical,
    };
    const scope = plan.scopes.length === 0 ? undefined : plan.scopes.length === 1 ? plan.scopes[0] : plan.scopes;
    const claimChannel = await this.runChannel("claim", () => this.claimCandidates(plan));
    if (contradictsQueriedRole(plan, claimChannel.memories)) {
      return this.emptyPacket(plan, started, "no_reliable_memory");
    }
    const channelTasks: Array<Promise<ChannelResult>> = [
      Promise.resolve(claimChannel),
      this.runChannel("fts", () =>
        this.options.storage.searchFts(
          this.options.tenantId,
          this.options.userId,
          plan.query,
          plan.layers,
          scope,
          plan.max_candidates_per_channel,
          filter,
        )),
    ];
    const hasExactClaim = plan.claim_keys.length > 0 && !plan.include_historical && !plan.time_range
      && !isCompositionalQuery(plan.query)
      && claimChannel.memories.some((memory) => admissionFailure(memory, plan, recallOptions) === null);
    let queryVector: Promise<Float32Array> | null = null;
    if (this.options.embedding && !hasExactClaim) {
      queryVector = this.options.embedding.embed(plan.query);
      channelTasks.push(this.runChannel("embedding", async () => {
        const vector = await queryVector!;
        return this.options.storage.searchEmbedding(
          this.options.tenantId,
          this.options.userId,
          vector,
          plan.layers,
          scope,
          plan.max_candidates_per_channel,
          filter,
        ).map((item) => item.memory);
      }));
    }
    if (plan.entity_terms.length > 0) {
      channelTasks.push(this.runChannel("entity", () => this.entityCandidates(plan)));
    }
    if (plan.time_range) {
      channelTasks.push(this.runChannel("time", () =>
        this.options.storage.searchByTime(
          this.options.tenantId,
          this.options.userId,
          plan.time_range!,
          plan.layers,
          scope,
          plan.max_candidates_per_channel,
          filter,
        )));
    }
    if (plan.include_recent) {
      channelTasks.push(this.runChannel("recent", () => this.recentCandidates(plan)));
    }

    const channels = await Promise.all(channelTasks);
    const rejected: RecallRejection[] = [];
    const accepted = channels.map((channel) => ({
      ...channel,
      memories: channel.memories.filter((memory) => {
        const reason = admissionFailure(memory, plan, recallOptions);
        if (reason) rejected.push({ memory_id: memory.id, reason });
        return reason === null;
      }),
    }));
    const seedMemories = uniqueMemories(accepted.flatMap((channel) => channel.memories)).slice(0, 40);
    if (plan.include_related && seedMemories.length > 0) {
      const related = await this.runChannel("related", () => this.relatedCandidates(seedMemories, plan, recallOptions));
      related.memories = related.memories.filter((memory) => {
        const reason = admissionFailure(memory, plan, recallOptions);
        if (reason) rejected.push({ memory_id: memory.id, reason });
        return reason === null;
      });
      accepted.push(related);
    }

    let items = fuseChannels(accepted, plan);
    const minScore = recallOptions.minScore ?? DEFAULT_MIN_SCORE;
    const candidateMultiplier = isCompositionalQuery(plan.query) ? 8 : 4;
    items = items
      .filter((item) => item.score >= minScore)
      .slice(0, Math.min(200, plan.max_results * candidateMultiplier));
    items = collapseCurrentClaims(items, plan, recallOptions, rejected);
    if (this.options.rerank && items.length > 0) {
      const rerankStarted = performance.now();
      const beforeIds = items.map((item) => item.memory.id);
      const reranked = await this.options.rerank(plan.query, items.map((item) => item.memory), recallOptions);
      const rerankChanged = reranked.length !== beforeIds.length ||
        reranked.some((memory, index) => memory.id !== beforeIds[index]);
      if (rerankChanged) {
        items = applyRerank(items, reranked, plan, recallOptions, rejected);
        accepted.push({
          channel: "domain",
          memories: reranked,
          elapsedMs: performance.now() - rerankStarted,
        });
      }
    }

    if (plan.include_evidence && (isCompositionalQuery(plan.query) || !hasTargetClaim(items, plan))) {
      const evidence = await this.runChannel("evidence", () =>
        this.evidenceCandidates(plan, recallOptions, queryVector ?? undefined));
      evidence.memories = rankEvidenceCandidates(
        evidence.memories,
        this.referencedEvidenceCandidates(items),
      ).slice(0, plan.max_candidates_per_channel);
      evidence.memories = evidence.memories.filter((memory) => {
        const reason = evidenceAdmissionFailure(memory, plan, recallOptions);
        if (reason) rejected.push({ memory_id: memory.id, reason });
        return reason === null;
      });
      accepted.push(evidence);
      items = mergeEvidenceFallback(items, evidence.memories, plan);
    }

    items = filterPersonalCompositionalNoise(items, plan, rejected);
    items = enforceSingleEventRelationIntegrity(items, plan, rejected);
    items = this.prioritizeExplicitUpdates(items, plan);
    items = projectOversizedItems(items, plan);
    items = applyPacketBudget(items, plan, rejected);

    const trace = this.makeTrace(plan, accepted, rejected, items, started);
    this.traces.put(trace);
    return {
      trace_id: trace.id,
      query_plan: plan,
      items,
      estimated_tokens: estimateTokens(items),
      reliable: items.length > 0,
      ...(items.length === 0 ? { refusal_reason: "no_reliable_memory" as const } : {}),
    };
  }

  explain(traceId: string): RecallTrace {
    const trace = this.traces.get(traceId);
    if (!trace || trace.tenant_id !== this.options.tenantId || trace.user_id !== this.options.userId) {
      throw new Error(`[nemos] recall trace not found: ${traceId}`);
    }
    return trace;
  }

  private claimCandidates(plan: QueryPlan): Memory[] {
    const memories: Memory[] = [];
    const scopes = plan.scopes.length > 0
      ? plan.scopes
      : Object.keys(this.options.storage.stats(this.options.tenantId, this.options.userId).by_scope);
    for (const scope of scopes) {
      for (const rawKey of plan.claim_keys) {
        const claimKey = this.options.storage.resolveCanonicalClaimKey(rawKey);
        for (const entry of this.options.storage.listClaimEntries(
          this.options.tenantId,
          this.options.userId,
          scope,
          claimKey,
        )) {
          const memory = this.options.storage.findById(this.options.tenantId, this.options.userId, entry.memory_id);
          if (memory) memories.push(memory);
        }
      }
    }
    return uniqueMemories(memories).slice(0, plan.max_candidates_per_channel);
  }
  private entityCandidates(plan: QueryPlan): Memory[] {
    const memories: Memory[] = [];
    const scope = plan.scopes.length === 1 ? plan.scopes[0] : undefined;
    for (const entity of plan.entity_terms) {
      memories.push(...this.options.storage.findByEntity(
        this.options.tenantId,
        this.options.userId,
        entity,
        { scope, topK: plan.max_candidates_per_channel },
      ));
    }
    return uniqueMemories(memories).slice(0, plan.max_candidates_per_channel);
  }

  private recentCandidates(plan: QueryPlan): Memory[] {
    const memories: Memory[] = [];
    for (const layer of plan.layers) {
      if (plan.scopes.length === 0) {
        memories.push(...this.options.storage.list(
          this.options.tenantId,
          this.options.userId,
          layer,
          { limit: plan.max_candidates_per_channel },
        ));
        continue;
      }
      for (const scope of plan.scopes) {
        memories.push(...this.options.storage.list(
          this.options.tenantId,
          this.options.userId,
          layer,
          { scope, limit: plan.max_candidates_per_channel },
        ));
      }
    }
    return uniqueMemories(memories)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, plan.max_candidates_per_channel);
  }
  private async evidenceCandidates(plan: QueryPlan, options: RecallOptions, queryVector?: Promise<Float32Array>): Promise<Memory[]> {
    const scope = plan.scopes.length === 0 ? undefined : plan.scopes.length === 1 ? plan.scopes[0] : plan.scopes;
    const filter = {
      includeSensitive: plan.include_sensitive,
      sensitiveOnly: options.sensitiveOnly === true,
      includeCold: true,
      includeInvalidated: true,
    };
    const compositional = isCompositionalQuery(plan.query);
    const limit = Math.min(compositional ? 20 : 8, plan.max_candidates_per_channel);
    const candidateLimit = Math.min(compositional ? 50 : 20, plan.max_candidates_per_channel);
    let semantic: Memory[] = [];
    if (this.options.embedding) {
      try {
        const vector = await (queryVector ?? this.options.embedding.embed(plan.query));
        semantic = this.options.storage.searchEmbedding(
          this.options.tenantId,
          this.options.userId,
          vector,
          ["archival"],
          scope,
          candidateLimit,
          filter,
        ).map((item) => item.memory);
      } catch {
        semantic = [];
      }
    }
    const lexical = this.options.storage.searchFts(
      this.options.tenantId,
      this.options.userId,
      evidenceLexicalQuery(plan.query),
      ["archival"],
      scope,
      candidateLimit,
      filter,
    );
    const candidates = rankEvidenceCandidates(semantic, lexical);
    if (plan.intent === "current_fact") {
      const eligible = candidates.filter(isCurrentEvidenceEligible);
      if (plan.claim_keys.length === 0 || compositional) return eligible.slice(0, limit);
      return eligible
        .sort((left, right) => {
          const rightSequence = this.options.storage.getEventMetadata(right.id)?.event_seq ?? 0;
          const leftSequence = this.options.storage.getEventMetadata(left.id)?.event_seq ?? 0;
          return rightSequence - leftSequence || effectiveTime(right).localeCompare(effectiveTime(left));
        })
        .slice(0, 1);
    }
    return candidates.slice(0, limit);
  }

  private referencedEvidenceCandidates(items: RecallItem[]): Memory[] {
    const scores = new Map<string, number>();
    for (const item of items) {
      const sourceIds = unique([
        ...(item.memory.archival_ref ? [item.memory.archival_ref] : []),
        ...(item.memory.source_event_ids ?? []),
      ]);
      for (const sourceId of sourceIds) {
        scores.set(sourceId, (scores.get(sourceId) ?? 0) + item.score);
      }
    }
    return [...scores.entries()]
      .map(([sourceId, score]) => ({
        memory: this.options.storage.findById(this.options.tenantId, this.options.userId, sourceId),
        score,
      }))
      .filter((entry): entry is { memory: Memory; score: number } =>
        entry.memory !== null
          && entry.memory.layer === "archival"
          && entry.memory.source.authoritative)
      .sort((left, right) =>
        right.score - left.score
          || effectiveTime(right.memory).localeCompare(effectiveTime(left.memory)))
      .map((entry) => entry.memory);
  }

  private relatedCandidates(
    seeds: Memory[],
    plan: QueryPlan,
    options: RecallOptions,
  ): Memory[] {
    const memories: Memory[] = [];
    const seen = new Set(seeds.map((memory) => memory.id));
    let frontier = seeds;
    const maxHops = options.spreadingActivation ? 2 : 1;
    for (let hop = 0; hop < maxHops; hop++) {
      const next: Memory[] = [];
      for (const seed of frontier) {
        let perSeed = 0;
        for (const relatedId of seed.related ?? []) {
          if (seen.has(relatedId)) continue;
          seen.add(relatedId);
          const memory = this.options.storage.findById(this.options.tenantId, this.options.userId, relatedId);
          if (!memory) continue;
          memories.push(memory);
          next.push(memory);
          perSeed++;
          if (memories.length >= plan.max_candidates_per_channel) return memories;
          if (perSeed >= 5) break;
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return memories;
  }
  private prioritizeExplicitUpdates(items: RecallItem[], plan: QueryPlan): RecallItem[] {
    if (plan.include_historical || (plan.intent !== "current_fact" && !/还要|还会|是否还|仍然|依然|anymore|still\b/i.test(plan.query))) return items;
    const sourceTime = (memory: Memory): string => {
      const sourceIds = memory.archival_ref
        ? [memory.archival_ref]
        : unique((memory.source_event_ids ?? []).filter((id) => id !== memory.id));
      const sourceTimes = sourceIds
        .map((id) => this.options.storage.findById(this.options.tenantId, this.options.userId, id))
        .filter((source): source is Memory => source !== null)
        .map((source) => source.event_at ?? source.created_at)
        .sort((left, right) => right.localeCompare(left));
      return sourceTimes[0] ?? memory.event_at ?? memory.created_at;
    };
    return items
      .map((item, index) => ({ item, index, sourceTime: sourceTime(item.memory) }))
      .sort((left, right) => right.sourceTime.localeCompare(left.sourceTime) || left.index - right.index)
      .map((entry) => entry.item);
  }
  private async runChannel(
    channel: RecallChannel,
    operation: () => Memory[] | Promise<Memory[]>,
  ): Promise<ChannelResult> {
    const started = performance.now();
    try {
      const memories = await operation();
      return { channel, memories, elapsedMs: performance.now() - started };
    } catch (error) {
      return {
        channel,
        memories: [],
        elapsedMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private emptyPacket(
    plan: QueryPlan,
    started: number,
    reason: "empty_query" | "no_reliable_memory",
  ): MemoryPacket {
    const trace = this.makeTrace(plan, [], [], [], started);
    this.traces.put(trace);
    return {
      trace_id: trace.id,
      query_plan: plan,
      items: [],
      estimated_tokens: 0,
      reliable: false,
      refusal_reason: reason,
    };
  }

  private makeTrace(
    plan: QueryPlan,
    channels: ChannelResult[],
    rejected: RecallRejection[],
    items: RecallItem[],
    started: number,
  ): RecallTrace {
    return {
      id: `recall:${randomUUID()}`,
      tenant_id: this.options.tenantId,
      user_id: this.options.userId,
      query: plan.query,
      plan,
      channels: channels.map((channel): RecallChannelTrace => ({
        channel: channel.channel,
        candidate_count: channel.memories.length,
        elapsed_ms: round(channel.elapsedMs),
        ...(channel.error ? { error: channel.error } : {}),
      })),
      rejected: uniqueRejections(rejected),
      selected_memory_ids: items.map((item) => item.memory.id),
      elapsed_ms: round(performance.now() - started),
      created_at: new Date().toISOString(),
    };
  }
}

function inferIntent(query: string): RecallIntent {
  if (/以前|过去|曾经|当时|历史|去年|上个月|之前|formerly|previously|history/i.test(query)) return "historical_fact";
  if (/怎么|如何|步骤|流程|办法|方法|how\s+to/i.test(query)) return "procedure";
  if (isTemporalCompositionQuery(query)) return "episode";
  if (/发生|做了什么|会议|讨论|刚才|昨天|今天|上周|上个月|when|what happened/i.test(query)) return "episode";
  if (/现在|目前|当前|如今|现居|是什么|多少|哪里|哪儿|叫什么|current|currently|now|what is/i.test(query)) return "current_fact";
  return "general";
}

function contradictsQueriedRole(plan: QueryPlan, claimMemories: Memory[]): boolean {
  if (plan.include_historical || !plan.predicates.includes("employment.role")) return false;
  const expectedRole = plan.query.match(/\b(?:role|job)\s+as\s+([A-Za-z][A-Za-z ]{2,60}?)(?=[?.!,]|$)/i)?.[1];
  if (!expectedRole) return false;
  const normalizedExpected = comparableEvidenceText(expectedRole);
  const currentRoles = claimMemories
    .filter((memory) => memory.predicate === "employment.role")
    .map((memory) => comparableEvidenceText(
      typeof memory.object_json === "string" ? memory.object_json : JSON.stringify(memory.object_json ?? ""),
    ))
    .filter(Boolean);
  return currentRoles.length > 0 && !currentRoles.includes(normalizedExpected);
}
function layersForIntent(intent: RecallIntent, query = ""): Layer[] {
  if (intent === "current_fact") {
    return isCompositionalQuery(query)
      ? ["personal_semantic", "episodic", "semantic"]
      : ["personal_semantic", "semantic"];
  }
  if (intent === "historical_fact") return ["episodic", "personal_semantic", "semantic"];
  if (intent === "episode") return ["episodic", "semantic", "personal_semantic"];
  if (intent === "procedure") return ["procedural", "semantic"];
  return ["episodic", "semantic", "personal_semantic", "procedural"];
}

function inferSubjects(query: string): string[] {
  const explicit = [...query.matchAll(/subject:([\w:.-]+)/gi)].map((match) => match[1]!).filter(Boolean);
  if (/我|我的|本人|自己|\bi\b|\bme\b|\bmy\b|\bmine\b|\bwe\b|\bus\b|\bour\b/i.test(query)) explicit.push("user:self");
  return unique(explicit);
}

function inferPredicates(query: string): string[] {
  const values: string[] = [];
  if (/名字|姓名|叫什么|name/i.test(query)) values.push("identity.name");
  if (/称呼|怎么叫|address me/i.test(query)) values.push("identity.preferred_address");
  const workplaceIntent = /办公|办公室|工作地点|where.*work|office location|workplace/i.test(query);
  if (!workplaceIntent && /住|居住|现居|城市|哪里|哪儿|residen|live/i.test(query)) values.push("residence.current");
  if (workplaceIntent) values.push("workplace.location");
  if (/公司|单位|就职|工作在哪|employ|company/i.test(query)) values.push("employment.organization");
  if (/职位|岗位|职业|role|job title/i.test(query)) values.push("employment.role");
  const healthIntent = /健康|过敏|health|allerg/i.test(query);
  if (healthIntent) values.push("constraint.health");
  if (/颜色|最喜欢什么色|favou?rite colou?r/i.test(query)) values.push("preference.color");
  if (/喜欢吃|忌口|食物|food/i.test(query) && !healthIntent) values.push("preference.food");
  if (/饮食|diet|vegetarian|vegan|pescatarian/i.test(query)) values.push("preference.diet");
  if (/感情|婚姻|relationship status|marital status/i.test(query)) values.push("relationship.status");
  if (/健身房|gym|fitness/i.test(query)) values.push("membership.gym");
  if (/手机|phone brand|brand of phone/i.test(query)) values.push("device.phone_brand");
  if (/相机|主力机|camera/i.test(query)) values.push("device.camera.primary");
  if (/护照.*(?:到期|过期|有效期)|passport.*(?:expir|valid)/i.test(query)) values.push("document.passport_expiry");
  if (/紧急联系人|emergency contact/i.test(query)) values.push("contact.emergency");
  if (/通勤|commute|go to work/i.test(query)) values.push("commute.mode");
  if (/汽车|车辆|开什么车|current car|driving/i.test(query)) values.push("possession.vehicle");
  if (/沟通|回复风格|communication style/i.test(query)) values.push("preference.communication_style");
  if (/个人最好|个人最佳|personal best|personal record/i.test(query)) values.push("achievement.personal_best");
  return values;
}

function inferClaimContext(query: string, predicate: string): Record<string, string> | null {
  if (predicate !== "achievement.personal_best") return {};
  const activity = inferPersonalBestActivity(query);
  return activity ? { activity } : null;
}
function inferEntityTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.matchAll(/["“](.{2,40}?)["”]/g)) terms.push(match[1]!.trim());
  for (const match of query.matchAll(/(?:^|\s)@([\p{L}\p{N}_.-]{2,40})/gu)) terms.push(match[1]!);
  for (const match of query.matchAll(/[A-Za-z][A-Za-z0-9_.-]{1,39}/g)) {
    if (!/^(what|when|where|which|about|current|history|recent|latest|how|the|and)$/i.test(match[0])) {
      terms.push(match[0]);
    }
  }
  for (const match of query.matchAll(/[\p{Script=Han}A-Za-z0-9_-]{2,16}(?:项目|公司|团队|产品|酒店|餐厅|会议)/gu)) {
    terms.push(match[0].replace(/^(关于|查询|回忆|看看|我们|那个)/, ""));
  }
  return unique(terms.filter((term) => term.length >= 2));
}

function inferTimeRange(query: string, nowValue?: string): RecallTimeRange | undefined {
  const now = nowValue ? new Date(nowValue) : new Date();
  if (Number.isNaN(now.getTime())) return undefined;
  const exactDate = query.match(/(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})日?/);
  if (exactDate) {
    const from = new Date(Date.UTC(Number(exactDate[1]), Number(exactDate[2]) - 1, Number(exactDate[3])));
    return dayRange(from);
  }
  const exactMonth = query.match(/(20\d{2})[-年/.](\d{1,2})月?/);
  if (exactMonth) {
    const year = Number(exactMonth[1]);
    const month = Number(exactMonth[2]) - 1;
    return { from: new Date(Date.UTC(year, month, 1)).toISOString(), to: new Date(Date.UTC(year, month + 1, 1) - 1).toISOString() };
  }
  const namedMonth = query.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (namedMonth) {
    const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const year = Number(namedMonth[2]);
    const month = names.indexOf(namedMonth[1]!.toLowerCase());
    return { from: new Date(Date.UTC(year, month, 1)).toISOString(), to: new Date(Date.UTC(year, month + 1, 1) - 1).toISOString() };
  }
  const namedMonthPattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi;
  const namedMonths = unique([...query.matchAll(namedMonthPattern)].map((match) => match[1]!.toLowerCase()));
  if (namedMonths.length === 1) {
    const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const month = names.indexOf(namedMonths[0]!);
    const year = month > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    return { from: new Date(Date.UTC(year, month, 1)).toISOString(), to: new Date(Date.UTC(year, month + 1, 1) - 1).toISOString() };
  }
  const exactYear = query.match(/\b(20\d{2})(?:年)?\b/);
  if (exactYear) {
    const year = Number(exactYear[1]);
    return { from: new Date(Date.UTC(year, 0, 1)).toISOString(), to: new Date(Date.UTC(year + 1, 0, 1) - 1).toISOString() };
  }
  if (/最近\s*24\s*小时|past\s*24\s*hours/i.test(query)) {
    return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
  }
  const relativeOffset = query.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)\s+ago\b/i);
  if (relativeOffset) {
    const quantity = parseRelativeQuantity(relativeOffset[1]!);
    const days = quantity * (/^week/i.test(relativeOffset[2]!) ? 7 : 1);
    const toleranceDays = /^week/i.test(relativeOffset[2]!) ? 3 : 0;
    const target = new Date(now.getTime() - days * 86400000);
    const from = dayRange(new Date(target.getTime() - toleranceDays * 86400000)).from;
    const to = dayRange(new Date(target.getTime() + toleranceDays * 86400000)).to;
    return { from, to };
  }
  if (/\blast Friday\b/i.test(query)) {
    const daysSinceFriday = ((now.getUTCDay() - 5 + 7) % 7) || 7;
    return dayRange(new Date(now.getTime() - daysSinceFriday * 86400000));
  }
  if (/\b(?:last|past) weekend\b/i.test(query)) {
    const daysSinceSunday = ((now.getUTCDay() + 7) % 7) || 7;
    const sunday = new Date(now.getTime() - daysSinceSunday * 86400000);
    return {
      from: dayRange(new Date(sunday.getTime() - 86400000)).from,
      to: dayRange(sunday).to,
    };
  }
  if (/今天|today/i.test(query)) return dayRange(now);
  if (/昨天|yesterday/i.test(query)) return dayRange(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (/上个月|last month/i.test(query)) {
    const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const month = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
    return { from: new Date(Date.UTC(year, month, 1)).toISOString(), to: new Date(Date.UTC(year, month + 1, 1) - 1).toISOString() };
  }
  if (/去年|last year/i.test(query)) {
    const year = now.getUTCFullYear() - 1;
    return { from: new Date(Date.UTC(year, 0, 1)).toISOString(), to: new Date(Date.UTC(year + 1, 0, 1) - 1).toISOString() };
  }
  if (/上周|last week/i.test(query)) {
    const weekday = now.getUTCDay() || 7;
    const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday + 1));
    return { from: new Date(thisMonday.getTime() - 7 * 86400000).toISOString(), to: new Date(thisMonday.getTime() - 1).toISOString() };
  }
  return undefined;
}

function parseRelativeQuantity(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
    .indexOf(value.toLowerCase()) + 1;
}
function dayRange(value: Date): RecallTimeRange {
  const from = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400000 - 1).toISOString() };
}

function normalizeTimeRange(range?: RecallTimeRange): RecallTimeRange | undefined {
  if (!range?.from && !range?.to) return undefined;
  const normalize = (value: string | undefined, end: boolean): string | undefined => {
    if (!value) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  };
  const from = normalize(range.from, false);
  const to = normalize(range.to, true);
  return from || to ? { from, to } : undefined;
}

function isPastTimeRange(range: RecallTimeRange | undefined, nowValue?: string): boolean {
  if (!range) return false;
  const boundary = Date.parse(range.to ?? range.from ?? "");
  const now = Date.parse(nowValue ?? new Date().toISOString());
  return Number.isFinite(boundary) && Number.isFinite(now) && boundary < now;
}
function isExplicitSensitiveQuery(query: string): boolean {
  const asksAboutSelf = /我|本人|自己|\bmy\b|\bme\b/i.test(query);
  const namesSensitiveTopic = /过敏|看牙|牙医|口腔|医院|就诊|病历|疾病|诊断|用药|药物|健康|医疗|怀孕|心理|medical|health|allerg|dent|hospital|diagnos|medication/i.test(query);
  return asksAboutSelf && namesSensitiveTopic;
}
function admissionFailure(memory: Memory, plan: QueryPlan, options: RecallOptions): string | null {
  if (!plan.layers.includes(memory.layer)) return "layer_not_requested";
  if (plan.scopes.length > 0 && !plan.scopes.includes(memory.scope)) return "scope_not_visible";
  if (options.sensitiveOnly && !memory.sensitive) return "not_sensitive";
  if (!plan.include_sensitive && memory.sensitive) return "sensitive_not_allowed";
  if (!options.includeCold && memory.cold) return "cold";
  if (
    plan.intent !== "current_fact" &&
    !plan.time_range &&
    !memory.claim_key &&
    !isLongTermMemoryEligible(memory, options.now) &&
    !isSupportedPersonalEvidence(memory, plan) &&
    !isExplicitlyQueriedEvidence(memory, plan)
  ) {
    return "low_long_term_salience";
  }
  if (
    plan.intent === "current_fact" &&
    memory.utterance_mode &&
    memory.utterance_mode !== "literal"
  ) {
    return "utterance_" + memory.utterance_mode;
  }
  if (plan.intent === "current_fact" && memory.subject_resolution === "ambiguous") {
    return "subject_ambiguous";
  }
  const state = memory.belief_state ?? "active";
  if (["disputed", "stale", "hidden"].includes(state)) return `belief_${state}`;
  if (!plan.include_historical && state !== "active") return `belief_${state}`;
  if (options.authoritativeOnly && !memory.source.authoritative) return "not_authoritative";
  if (options.confidenceMin) {
    const confidence = memory.source.confidence;
    if (options.confidenceMin === "high" && confidence && confidence !== "high") return "confidence_below_high";
    if (options.confidenceMin === "medium" && confidence && !["high", "medium"].includes(confidence)) return "confidence_below_medium";
  }
  const timestamp = memory.event_at ?? memory.valid_at ?? memory.created_at;
  const softRelativeMatch = canUseRelativeTemporalEvidence(memory, plan);
  if (plan.time_range?.from && timestamp < plan.time_range.from && !softRelativeMatch) return "before_time_range";
  if (plan.time_range?.to && timestamp > plan.time_range.to && !softRelativeMatch) return "after_time_range";
  if (plan.intent === "current_fact" && memory.valid_at && memory.valid_at > new Date(options.now ?? Date.now()).toISOString()) {
    return "not_yet_valid";
  }
  if (/external|web|url/i.test(memory.source.origin) && containsPersistenceInstruction(memory.content)) {
    return "external_persistence_instruction";
  }
  return null;
}

function evidenceAdmissionFailure(memory: Memory, plan: QueryPlan, options: RecallOptions): string | null {
  if (memory.layer !== "archival" || !memory.source.authoritative) return "not_direct_evidence";
  if (plan.scopes.length > 0 && !plan.scopes.includes(memory.scope)) return "scope_not_visible";
  if (options.sensitiveOnly && !memory.sensitive) return "not_sensitive";
  if (!plan.include_sensitive && memory.sensitive) return "sensitive_not_allowed";
  if (plan.intent === "current_fact" && evidenceUtteranceMode(memory) !== "literal") {
    return "evidence_non_literal";
  }
  if (
    plan.intent !== "current_fact" &&
    !plan.time_range &&
    !isLongTermMemoryEligible(memory, options.now) &&
    !matchesExplicitQuery(memory, plan)
  ) return "evidence_low_long_term_salience";
  const timestamp = memory.event_at ?? memory.created_at;
  const softRelativeMatch = canUseRelativeTemporalEvidence(memory, plan);
  if (plan.time_range?.from && timestamp < plan.time_range.from && !softRelativeMatch) return "before_time_range";
  if (plan.time_range?.to && timestamp > plan.time_range.to && !softRelativeMatch) return "after_time_range";
  return null;
}

function canUseRelativeTemporalEvidence(memory: Memory, plan: QueryPlan): boolean {
  return isRelativeTemporalQuery(plan.query) && matchesExplicitQuery(memory, plan);
}

function isRelativeTemporalQuery(query: string): boolean {
  return /(?:last|past)\s+(?:day|week|month|year|24\s*hours)|today|yesterday|\u4eca\u5929|\u6628\u5929|\u4e0a\u5468|\u4e0a\u4e2a\u6708|\u53bb\u5e74|\u6700\u8fd1\s*24\s*\u5c0f\u65f6/i.test(query);
}

function isSupportedPersonalEvidence(memory: Memory, plan: QueryPlan): boolean {
  if (!isPersonalFactQuery(plan) || !memoryRepresentsUser(memory)) return false;
  return memory.evidence_coverage === "supported" || memory.evidence_coverage === "corroborated";
}

function isExplicitlyQueriedEvidence(memory: Memory, plan: QueryPlan): boolean {
  if (memory.evidence_coverage !== "supported" && memory.evidence_coverage !== "corroborated") return false;
  return matchesExplicitQuery(memory, plan);
}

function matchesExplicitQuery(memory: Memory, plan: QueryPlan): boolean {
  const terms = unique(
    (evidenceLexicalQuery(plan.query).toLowerCase().match(/[a-z0-9_]{3,}|[\p{Script=Han}]{2,}/gu) ?? []),
  );
  if (terms.length === 0) return false;
  const searchable = (memory.content + " " + JSON.stringify(memory.object_json ?? "")).toLowerCase();
  const matched = terms.filter((term) => searchable.includes(term)).length;
  const oneStrongEventTerm = isCompositionalQuery(plan.query)
    && (hasCompletedEventSignal(memory.content) || hasTemporalSignal(memory.content));
  const required = isRelativeTemporalQuery(plan.query) || oneStrongEventTerm
    ? 1
    : Math.min(2, terms.length);
  return matched >= required;
}

function isPersonalFactQuery(plan: QueryPlan): boolean {
  return plan.intent !== "procedure" && plan.subject_ids.includes("user:self");
}

function personalFactWeight(memory: Memory, plan: QueryPlan): number {
  if (!isPersonalFactQuery(plan)) return 1;
  if (isCompositionalQuery(plan.query) && prefersUserEvidence(plan.query)) {
    if (memory.source.authoritative) return 1.55;
    if (memoryRepresentsUser(memory)) return 1.45;
    if (memory.type === "reference" || memory.layer === "procedural") return 0.4;
  }
  if (memoryRepresentsUser(memory)) return 1.35;
  if (memory.type === "reference") return 0.7;
  return 1;
}

function filterPersonalCompositionalNoise(
  items: RecallItem[],
  plan: QueryPlan,
  rejected: RecallRejection[],
): RecallItem[] {
  if (
    !isPersonalFactQuery(plan)
    && !(isCompositionalQuery(plan.query) && prefersUserEvidenceForProjection(plan.query))
  ) {
    return items;
  }
  if (!isCompositionalQuery(plan.query) || !prefersUserEvidenceForProjection(plan.query)) {
    return items;
  }
  const hasPersonalEvidence = items.some((item) =>
    item.memory.source.authoritative || memoryRepresentsUser(item.memory));
  if (!hasPersonalEvidence) return items;
  return items.filter((item) => {
    const isAssistantReference = !memoryRepresentsUser(item.memory)
      && (item.memory.type === "reference" || item.memory.layer === "procedural");
    if (!isAssistantReference) return true;
    rejected.push({ memory_id: item.memory.id, reason: "not_personal_evidence" });
    return false;
  });
}

function enforceSingleEventRelationIntegrity(
  items: RecallItem[],
  plan: QueryPlan,
  rejected: RecallRejection[],
): RecallItem[] {
  if (!isSingleEventRelationQuery(plan.query) || items.length < 2) return items;
  const groups = new Map<string, RecallItem[]>();
  for (const item of items) {
    const sourceId = item.memory.layer === "archival"
      ? item.memory.id
      : item.memory.archival_ref ?? item.memory.source_event_ids?.[0] ?? item.memory.id;
    const group = groups.get(sourceId) ?? [];
    group.push(item);
    groups.set(sourceId, group);
  }
  if (groups.size < 2) return items;
  const terms = unique(
    (evidenceLexicalQuery(plan.query).toLowerCase().match(/[a-z0-9_]{3,}|[\p{Script=Han}]{2,}/gu) ?? []),
  );
  const rankedGroups = [...groups.entries()].map(([sourceId, group]) => {
    const personalItems = group.filter((item) =>
      item.memory.source.authoritative || memoryRepresentsUser(item.memory));
    const searchable = personalItems.map((item) => recallItemContent(item)).join(" ").toLowerCase();
    const coverage = terms.filter((term) => searchable.includes(term)).length;
    return { sourceId, group, score: coverage * 100 + group.reduce((sum, item) => sum + item.score, 0) };
  }).sort((left, right) => right.score - left.score);
  const selected = new Set(rankedGroups[0]!.group.map((item) => item.memory.id));
  for (const item of items) {
    if (!selected.has(item.memory.id)) {
      rejected.push({ memory_id: item.memory.id, reason: "cross_event_relation" });
    }
  }
  return items.filter((item) => selected.has(item.memory.id));
}

function isSingleEventRelationQuery(query: string): boolean {
  return !isCompositionalQuery(query)
    && prefersUserEvidence(query)
    && /\b(?:at which|which|what|where)\b.{0,120}\b(?:did i|i (?:presented|visited|attended|bought|used|met|worked|stayed))\b/i.test(query);
}
function memoryRepresentsUser(memory: Memory): boolean {
  if (memory.utterance_mode && memory.utterance_mode !== "literal") return false;
  if (memory.type === "user") return true;
  if (memory.layer !== "episodic" && memory.layer !== "personal_semantic") return false;
  return /(?:\bthe user\b|\buser\b|用户)/i.test(memory.content);
}

function isLongTermMemoryEligible(memory: Memory, nowValue?: string): boolean {
  const eventMs = Date.parse(memory.event_at ?? memory.created_at);
  const nowMs = Date.parse(nowValue ?? new Date().toISOString());
  if (!Number.isFinite(eventMs) || !Number.isFinite(nowMs)) return true;
  const ageDays = (nowMs - eventMs) / 86400000;
  if (ageDays <= 90) return true;
  if (memory.access_count >= 2) return true;
  return hasDurableSalience(memory);
}
function collapseCurrentClaims(
  items: RecallItem[],
  plan: QueryPlan,
  options: RecallOptions,
  rejected: RecallRejection[],
): RecallItem[] {
  if (plan.intent !== "current_fact") return items;
  const now = new Date(options.now ?? Date.now()).toISOString();
  const winners = new Map<string, RecallItem>();
  const unstructured: RecallItem[] = [];

  for (const item of items) {
    const claimKey = item.memory.claim_key;
    if (!claimKey) {
      unstructured.push(item);
      continue;
    }
    const existing = winners.get(claimKey);
    if (!existing) {
      winners.set(claimKey, item);
      continue;
    }
    const winner = compareCurrentClaim(item, existing, now) > 0 ? item : existing;
    const loser = winner === item ? existing : item;
    winners.set(claimKey, winner);
    rejected.push({ memory_id: loser.memory.id, reason: "historical_version" });
  }

  const targetKeys = new Set(plan.claim_keys);
  const hasExactTarget = [...winners.keys()].some((claimKey) => targetKeys.has(claimKey));
  if (hasExactTarget) {
    for (const item of unstructured) {
      rejected.push({ memory_id: item.memory.id, reason: "shadowed_by_structured_claim" });
    }
    unstructured.length = 0;
  }

  const selected = new Set([...winners.values(), ...unstructured].map((item) => item.memory.id));
  return items.filter((item) => selected.has(item.memory.id));
}

function hasTargetClaim(items: RecallItem[], plan: QueryPlan): boolean {
  if (plan.claim_keys.length === 0) return false;
  const targetKeys = new Set(plan.claim_keys);
  return items.some((item) => item.memory.claim_key !== undefined && targetKeys.has(item.memory.claim_key));
}

function evidenceLexicalQuery(query: string): string {
  const stopWords = new Set([
    "a", "about", "after", "ago", "all", "altogether", "an", "and", "at", "before",
    "between", "can", "combined", "could", "current", "day", "days", "did", "discussed",
    "do", "does", "earlier", "earliest", "eight", "end", "experience", "first", "five",
    "for", "four", "from", "got", "had", "has", "have", "how", "in", "is", "it",
    "last", "latest", "learn", "list", "many", "me", "month", "months", "much", "my",
    "new", "nine", "of", "on", "one", "order", "past", "provided", "related", "recently",
    "remember", "remind", "seven", "significant", "six", "sum", "ten", "the",
    "think", "three", "to", "total", "two", "was", "week", "weeks", "were", "what",
    "when", "where", "which", "with", "would", "year", "years", "you", "your",
  ]);
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const filtered = unique(
    terms
      .map((term) => normalizeEvidenceTerm(term))
      .filter((term) => !stopWords.has(term) && !/^20\d{2}$/.test(term)),
  );
  const expanded = [...filtered];
  if (/\bsiblings?\b|兄弟姐妹|手足/i.test(query)) {
    expanded.push("sibling", "brother", "sister");
  }
  if (/\b(?:albums?|eps?|records?)\b|专辑|唱片/i.test(query)) {
    expanded.push("album", "ep", "record", "vinyl", "downloaded", "bought", "purchased");
  }
  const termsWithSynonyms = unique(expanded);
  return termsWithSynonyms.length > 0 ? termsWithSynonyms.join(" ") : query;
}

function normalizeEvidenceTerm(term: string): string {
  const lower = term.toLowerCase();
  if (!/^[a-z]+$/.test(lower)) return lower;
  if (lower.length > 5 && lower.endsWith("ies")) return lower.slice(0, -3) + "y";
  if (lower.length > 5 && lower.endsWith("ing")) return lower.slice(0, -3);
  if (lower.length > 4 && lower.endsWith("ed")) return lower.slice(0, -2);
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

function rankEvidenceCandidates(semantic: Memory[], lexical: Memory[]): Memory[] {
  const scores = new Map<string, { memory: Memory; score: number }>();
  const add = (memories: Memory[], weight: number): void => {
    memories.forEach((memory, index) => {
      const current = scores.get(memory.id) ?? { memory, score: 0 };
      current.score += weight / (RRF_K + index + 1);
      scores.set(memory.id, current);
    });
  };
  add(semantic, 1);
  add(lexical, 1.25);
  return [...scores.values()]
    .sort((left, right) => right.score - left.score || effectiveTime(right.memory).localeCompare(effectiveTime(left.memory)))
    .map((entry) => entry.memory);
}

function mergeEvidenceFallback(items: RecallItem[], evidence: Memory[], plan: QueryPlan): RecallItem[] {
  const existingById = new Map(items.map((item) => [item.memory.id, item]));
  const maxEvidence = evidenceSlotLimit(plan);
  const compositional = isCompositionalQuery(plan.query);
  const selectedEvidence = evidence
    .filter((memory) =>
      existingById.has(memory.id)
      || compositional
      || !items.some((item) => evidenceIsRedundant(memory, item.memory))
    )
    .slice(0, maxEvidence);
  const promoted = selectedEvidence.map((memory, index): RecallItem => {
    const contribution = round(CHANNEL_WEIGHTS.evidence / (RRF_K + index + 1));
    const existing = existingById.get(memory.id);
    if (existing) {
      return {
        ...existing,
        excerpt: existing.excerpt ?? buildEvidenceExcerpt(
          memory.content,
          plan.query,
          compositional ? 1800 : 2400,
        ),
        reasons: existing.reasons.some((reason) => reason.channel === "evidence")
          ? existing.reasons
          : [...existing.reasons, { channel: "evidence", rank: index + 1, contribution }],
      };
    }
    return {
      memory,
      excerpt: buildEvidenceExcerpt(
        memory.content,
        plan.query,
        compositional ? 1800 : 2400,
      ),
      score: contribution,
      reasons: [{ channel: "evidence", rank: index + 1, contribution }],
    };
  });
  if (promoted.length === 0) return items;

  const promotedIds = new Set(promoted.map((item) => item.memory.id));
  const direct: RecallItem[] = [];
  const indirect: RecallItem[] = [];
  for (const item of items) {
    if (promotedIds.has(item.memory.id)) continue;
    if (item.reasons.some((reason) => !["related", "domain"].includes(reason.channel))) direct.push(item);
    else indirect.push(item);
  }
  // Reserve early packet slots for authoritative sources, including sources
  // already present at a low fused rank.
  const evidenceIndex = compositional ? Math.min(2, direct.length) : Math.min(5, direct.length);
  return [
    ...direct.slice(0, evidenceIndex),
    ...promoted,
    ...direct.slice(evidenceIndex),
    ...indirect,
  ];
}

function evidenceIsRedundant(evidence: Memory, derived: Memory): boolean {
  const sourceIds = new Set([
    ...(derived.archival_ref ? [derived.archival_ref] : []),
    ...(derived.source_event_ids ?? []),
  ]);
  if (!sourceIds.has(evidence.id)) return false;

  const evidenceText = comparableEvidenceText(evidence.content);
  const derivedText = comparableEvidenceText(derived.content);
  if (!evidenceText || !derivedText) return false;
  const shorter = evidenceText.length <= derivedText.length ? evidenceText : derivedText;
  const longer = shorter === evidenceText ? derivedText : evidenceText;
  return longer.includes(shorter) && shorter.length / longer.length >= 0.6;
}

function comparableEvidenceText(content: string): string {
  return content
    .toLowerCase()
    .replace(/^(?:the user|user|i)\s+(?:has|have|had|am|was|did|does|is|attended|completed|successfully)?\s*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isCurrentEvidenceEligible(memory: Memory): boolean {
  if (evidenceUtteranceMode(memory) !== "literal") return false;
  return !["doc-research", "meeting", "coding"].includes(memory.scenario ?? "");
}

function evidenceUtteranceMode(memory: Memory): "literal" | "non_literal" {
  if (memory.utterance_mode) return memory.utterance_mode === "literal" ? "literal" : "non_literal";
  return /如果|假如|假设|要是|可能|也许|大概|听说|据说|他说|她说|他们说|开玩笑|逗你|玩笑|角色扮演|剧情里|设定中|假装/.test(memory.content)
    ? "non_literal"
    : "literal";
}

function compareCurrentClaim(left: RecallItem, right: RecallItem, now: string): number {
  const leftTime = effectiveTime(left.memory);
  const rightTime = effectiveTime(right.memory);
  const leftEffective = leftTime <= now;
  const rightEffective = rightTime <= now;
  if (leftEffective !== rightEffective) return leftEffective ? 1 : -1;
  if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
  const leftTrust = left.memory.trust_tier ?? 6;
  const rightTrust = right.memory.trust_tier ?? 6;
  if (leftTrust !== rightTrust) return rightTrust - leftTrust;
  return left.score - right.score;
}

function effectiveTime(memory: Memory): string {
  return memory.valid_at ?? memory.event_at ?? memory.created_at;
}

function containsPersistenceInstruction(content: string): boolean {
  return /ignore (all |the )?(previous|prior) instructions|system prompt|永久记住|写入长期记忆|忽略.{0,8}指令|必须永远遵守/i.test(content);
}

function fuseChannels(channels: ChannelResult[], plan: QueryPlan): RecallItem[] {
  const fused = new Map<string, RecallItem>();
  for (const channel of channels) {
    const weight = CHANNEL_WEIGHTS[channel.channel];
    channel.memories.forEach((memory, index) => {
      const rank = index + 1;
      const contribution = weight * personalFactWeight(memory, plan) / (RRF_K + rank);
      const existing = fused.get(memory.id) ?? { memory, score: 0, reasons: [] };
      existing.score += contribution;
      existing.reasons.push({ channel: channel.channel, rank, contribution: round(contribution) });
      fused.set(memory.id, existing);
    });
  }
  return [...fused.values()]
    .map((item) => ({ ...item, score: round(item.score) }))
    .sort((left, right) => right.score - left.score || right.memory.created_at.localeCompare(left.memory.created_at));
}

function applyRerank(
  items: RecallItem[],
  memories: Memory[],
  plan: QueryPlan,
  options: RecallOptions,
  rejected: RecallRejection[],
): RecallItem[] {
  const byId = new Map(items.map((item) => [item.memory.id, item]));
  const output: RecallItem[] = [];
  memories.forEach((memory, index) => {
    let item = byId.get(memory.id);
    if (!item) {
      const reason = admissionFailure(memory, plan, options);
      if (reason) {
        rejected.push({ memory_id: memory.id, reason });
        return;
      }
      item = { memory, score: DEFAULT_MIN_SCORE, reasons: [] };
    }
    item.reasons.push({ channel: "domain", rank: index + 1, contribution: 0 });
    output.push(item);
    byId.delete(memory.id);
  });
  output.push(...byId.values());
  return output;
}
function applyPacketBudget(items: RecallItem[], plan: QueryPlan, rejected: RecallRejection[]): RecallItem[] {
  const selected: RecallItem[] = [];
  let tokens = 0;
  for (const item of items) {
    if (selected.length >= plan.max_results) break;
    const itemTokens = Math.max(1, Math.ceil(recallItemContent(item).length / 4));
    if (tokens + itemTokens > plan.max_tokens) {
      rejected.push({ memory_id: item.memory.id, reason: "token_budget" });
      continue;
    }
    selected.push(item);
    tokens += itemTokens;
  }
  return selected;
}

function estimateTokens(items: RecallItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(1, Math.ceil(recallItemContent(item).length / 4)), 0);
}

function recallItemContent(item: RecallItem): string {
  return item.excerpt ?? item.memory.content;
}

function projectOversizedItems(items: RecallItem[], plan: QueryPlan): RecallItem[] {
  const maxChars = isCompositionalQuery(plan.query) ? 1800 : 2400;
  return items.map((item) => {
    if (item.excerpt || item.memory.content.length <= maxChars) return item;
    return {
      ...item,
      excerpt: buildEvidenceExcerpt(item.memory.content, plan.query, maxChars),
    };
  });
}

function buildEvidenceExcerpt(content: string, query: string, maxChars = 2400): string {
  const compositional = isCompositionalQuery(query);
  const preferUser = prefersUserEvidenceForProjection(query);
  if (content.length <= maxChars && !preferUser) return content;
  const terms = unique(
    (evidenceLexicalQuery(query).toLowerCase().match(/[a-z0-9_]{3,}|[\p{Script=Han}]{2,}/gu) ?? []),
  );
  let segments = content
    .split(/\n(?=(?:User|Assistant|System|Tool):\s)/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const sequenceOrdinal = referencedSequenceOrdinal(query);
  const userTurnIndexes = segments
    .map((segment, index) => /^User:\s/i.test(segment) ? index : -1)
    .filter((index) => index >= 0);
  const requestedUserTurnIndex = sequenceOrdinal === null
    ? undefined
    : userTurnIndexes[sequenceOrdinal - 1];
  const requestedAssistantTurn = requestedUserTurnIndex === undefined
    ? undefined
    : segments.slice(requestedUserTurnIndex + 1).find((segment) => /^Assistant:\s/i.test(segment));
  const requestedTurnParts = new Set(
    requestedAssistantTurn ? splitCompositionalSegment(requestedAssistantTurn) : [],
  );
  if (compositional) segments = segments.flatMap(splitCompositionalSegment);
  if (segments.length > 1) {
    let ranked = segments
      .map((segment, index) => ({
        index,
        segment,
        requested: requestedTurnParts.has(segment),
        score: scoreEvidenceSegment(segment, terms, query) + (requestedTurnParts.has(segment) ? 1_000 : 0),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || right.index - left.index);

    const userCandidates = ranked.filter((candidate) => /^User:\s/i.test(candidate.segment));
    if (preferUser && userCandidates.length > 0) ranked = userCandidates;
    const selected: Array<{ index: number; text: string }> = [];
    let remaining = maxChars;
    const targetSpan = compositional && !isKinshipAggregateQuery(query) ? 360 : 700;
    const maxSpans = compositional ? 10 : 6;
    for (const candidate of ranked) {
      const separatorLength = selected.length === 0 ? 0 : 5;
      const spanLimit = Math.min(candidate.requested ? 700 : targetSpan, remaining - separatorLength);
      if (spanLimit < 100) break;
      const excerpt = bestEvidenceWindow(candidate.segment, terms, spanLimit, query);
      selected.push({ index: candidate.index, text: excerpt });
      remaining -= excerpt.length + separatorLength;
      if (selected.length >= maxSpans) break;
    }
    if (selected.length > 0) {
      const body = selected
        .sort((left, right) => left.index - right.index)
        .map((item) => item.text)
        .join("\n...\n");
      return `...${body}...`;
    }
  }
  return bestEvidenceWindow(content, terms, maxChars, query);
}

function splitCompositionalSegment(segment: string): string[] {
  if (segment.length <= 520) return [segment];
  const role = segment.match(/^(?:User|Assistant|System|Tool):\s*/i)?.[0] ?? "";
  const body = role ? segment.slice(role.length) : segment;
  const sentences = body
    .split(/(?<=[.!?。！？])\s+(?=[\p{L}\p{N}"'“‘(])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return [segment];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > 520) {
      chunks.push(`${role}${current}`);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(`${role}${current}`);
  return chunks;
}

function scoreEvidenceSegment(segment: string, terms: string[], query: string): number {
  const lower = segment.toLowerCase();
  let score = terms.reduce(
    (total, term) => total + (lower.includes(term) ? Math.min(term.length, 20) * 10 : 0),
    0,
  );
  const userSegment = /^User:\s/i.test(segment);
  const assistantSegment = /^Assistant:\s/i.test(segment);
  if (prefersUserEvidence(query)) {
    if (userSegment) score += 180;
    if (assistantSegment) score -= 120;
  }
  if (isMoneyQuery(query) && hasMoneySignal(segment)) score += 240;
  if (isAggregateQuery(query) && /\d/.test(segment)) score += 100;
  if (isCompositionalQuery(query) && hasCompletedEventSignal(segment)) score += 200;
  if (isCompositionalQuery(query) && hasFutureSignal(segment) && !hasCompletedEventSignal(segment)) score -= 160;
  if (isTemporalCompositionQuery(query) && hasTemporalSignal(segment)) score += 200;
  const ordinal = referencedOrdinal(query);
  if (ordinal && new RegExp("(?:^|\\b)" + ordinal + "\\s*[.)\\]:-]").test(segment)) score += 500;
  return score;
}

function bestEvidenceWindow(content: string, terms: string[], maxChars: number, query: string): string {
  if (content.length <= maxChars) return content.trim();
  const lower = content.toLowerCase();
  const maxStart = content.length - maxChars;
  const starts = new Set<number>([0, maxStart]);
  const addAnchor = (position: number): void => {
    starts.add(Math.max(0, Math.min(maxStart, position - Math.floor(maxChars / 3))));
  };
  for (const term of terms) {
    let position = lower.indexOf(term);
    let occurrences = 0;
    while (position >= 0 && occurrences < 32 && starts.size < 256) {
      addAnchor(position);
      position = lower.indexOf(term, position + term.length);
      occurrences += 1;
    }
  }
  if (isMoneyQuery(query)) {
    for (const match of content.matchAll(/(?:[$€£¥]\s*\d|\d[\d,.]*\s*(?:dollars?|yuan|euros?|pounds?))/gi)) {
      addAnchor(match.index);
    }
  }
  if (isCompositionalQuery(query)) {
    for (const match of content.matchAll(/\b(?:attended|went|visited|bought|purchased|assembled|sold|fixed|repaired|serviced|baked|finished|completed|received|submitted|flew|stayed|spent|paid|earned|started|began|rearranged|replaced|viewed|participated|volunteered|graduated|enrolled|studied|subscribed|gave birth|was born)\b/gi)) {
      addAnchor(match.index);
    }
  }
  const ordinal = referencedOrdinal(query);
  if (ordinal) {
    for (const match of content.matchAll(new RegExp("(?:^|\\b)" + ordinal + "\\s*[.)\\]:-]", "g"))) {
      addAnchor(match.index);
    }
  }
  if (isTemporalCompositionQuery(query)) {
    for (const match of content.matchAll(/\b(?:20\d{2}(?:[-/.]\d{1,2}){0,2}|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|yesterday|last week|last month|last weekend|\d+\s+(?:days?|weeks?|months?|years?)\s+ago)\b/gi)) {
      addAnchor(match.index);
    }
  }
  let bestStart = 0;
  let bestScore = -Infinity;
  for (const start of starts) {
    const window = content.slice(start, start + maxChars);
    const windowLower = window.toLowerCase();
    let score = terms.reduce(
      (total, term) => total + (windowLower.includes(term) ? Math.min(term.length, 20) * 10 : 0),
      0,
    );
    if (isMoneyQuery(query) && hasMoneySignal(window)) score += 240;
    if (isAggregateQuery(query) && /\d/.test(window)) score += 100;
    if (isCompositionalQuery(query) && hasCompletedEventSignal(window)) score += 200;
    if (isCompositionalQuery(query) && hasFutureSignal(window) && !hasCompletedEventSignal(window)) score -= 160;
    if (isTemporalCompositionQuery(query) && hasTemporalSignal(window)) score += 200;
    if (score > bestScore || (score === bestScore && start < bestStart)) {
      bestStart = start;
      bestScore = score;
    }
  }
  const body = content.slice(bestStart, bestStart + maxChars).trim();
  return `${bestStart > 0 ? "..." : ""}${body}${bestStart + maxChars < content.length ? "..." : ""}`;
}

function referencedSequenceOrdinal(query: string): number | null {
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const match = query.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
  return match ? words.indexOf(match[1]!.toLowerCase()) + 1 : null;
}

function referencedOrdinal(query: string): string | null {
  return query.match(/\b(\d+)(?:st|nd|rd|th)\b/i)?.[1]
    ?? query.match(/\b(?:number|item|parameter|entry)\s+#?(\d+)\b/i)?.[1]
    ?? null;
}

function prefersUserEvidence(query: string): boolean {
  const asksAboutSelf = /我|我的|本人|自己|\b(?:i|me|my|mine|we|us|our|ours)\b/i.test(query);
  if (!asksAboutSelf) return false;
  return !asksAboutAssistantEvidence(query);
}

function prefersUserEvidenceForProjection(query: string): boolean {
  return prefersUserEvidence(query)
    || (isMoneyQuery(query) && !asksAboutAssistantEvidence(query));
}

function asksAboutAssistantEvidence(query: string): boolean {
  return /(?:你|您).{0,24}(?:说|告诉|提供|推荐|建议|列出|分配|解释)|\b(?:you|your)\b.{0,50}\b(?:said|told|provided|recommended|suggested|listed|allocated|gave|called|described|explained)\b|\b(?:our|the) previous (?:chat|conversation)\b/i.test(query);
}

function isMoneyQuery(query: string): boolean {
  return /\b(?:how much|total money|spent|spend|cost|expenses?|cashback|discount|save|price|fare|made from)\b|花了多少|总金额|总费用|多少钱|成本|返现|折扣|节省/i.test(query);
}

function hasMoneySignal(content: string): boolean {
  return /(?:[$€£¥]\s*\d|\d[\d,.]*\s*(?:dollars?|yuan|euros?|pounds?))/i.test(content);
}

function hasCompletedEventSignal(content: string): boolean {
  return /\b(?:attended|went|visited|bought|purchased|assembled|sold|fixed|repaired|serviced|baked|finished|completed|received|submitted|flew|stayed|spent|paid|earned|started|began|rearranged|replaced|viewed|participated|volunteered|graduated|enrolled|studied|subscribed|gave birth|was born)\b|参加了|去了|参观了|买了|组装了|卖了|修了|烤了|完成了|收到了|提交了|乘坐了|花了|开始了|毕业|出生/i.test(content);
}

function hasFutureSignal(content: string): boolean {
  return /\b(?:plan(?:ning)? to|want to|would like to|considering|thinking of|recommend(?:ed|ation)?|suggest(?:ed|ion)?|upcoming|might|may)\b|计划|打算|想要|考虑|推荐|建议|可能/i.test(content);
}

function hasTemporalSignal(content: string): boolean {
  return /\b(?:20\d{2}(?:[-/.]\d{1,2}){0,2}|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|yesterday|last week|last month|last weekend|\d+\s+(?:days?|weeks?|months?|years?)\s+ago)\b|今天|昨天|上周|上个月|周末|\d{1,2}月\d{1,2}日/i.test(content);
}

function isKinshipAggregateQuery(query: string): boolean {
  return isAggregateQuery(query)
    && /\b(?:siblings?|brothers?|sisters?)\b|兄弟姐妹|手足/i.test(query);
}
function isAggregateQuery(query: string): boolean {
  return /\b(?:how many|how much|total|sum|all|before|after|between|combined|altogether)\b|多少|总共|合计|之前|之后|之间/i.test(query);
}

function isTemporalCompositionQuery(query: string): boolean {
  return /\b(?:order|earliest|latest|how long|how old\b.{0,40}\bwhen|how many (?:days|weeks|months|years)|days? passed|weeks? (?:ago|had passed)|when did i|which\b.{0,80}\bfirst|what\b.{0,80}\bfirst|most recently|from earliest|starting from the earliest|compared to)\b|顺序|最早|最晚|多久|多大.{0,20}时|相隔|经过|早到晚|先后|哪个.{0,20}先/i.test(query);
}

function isCompositionalQuery(query: string): boolean {
  return isAggregateQuery(query)
    || isTemporalCompositionQuery(query)
    || referencedOrdinal(query) !== null
    || referencedSequenceOrdinal(query) !== null;
}

function evidenceSlotLimit(plan: QueryPlan): number {
  const ratio = isCompositionalQuery(plan.query) ? 0.5 : 0.2;
  return Math.max(1, Math.min(10, Math.floor(plan.max_results * ratio)));
}

function uniqueMemories(memories: Memory[]): Memory[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    if (seen.has(memory.id)) return false;
    seen.add(memory.id);
    return true;
  });
}

function uniqueRejections(rejections: RecallRejection[]): RecallRejection[] {
  const seen = new Set<string>();
  return rejections.filter((rejection) => {
    const key = `${rejection.memory_id}:${rejection.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}