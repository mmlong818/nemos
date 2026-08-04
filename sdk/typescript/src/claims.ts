import { createHash } from "node:crypto";
import type {
  Memory,
  PredicateDefinition,
  Specificity,
  SubjectResolution,
  UtteranceMode,
} from "./types.js";

export const CLAIM_KEY_VERSION = 1;
export const NORMALIZER_VERSION = 1;

const PREDICATES: PredicateDefinition[] = [
  define("identity.name", ["name", "名字", "姓名", "叫"], "string", true, [], "timeless"),
  define("identity.preferred_address", ["preferred address", "称呼", "怎么称呼", "叫我"], "string", true, [], "current"),
  define("residence.current", ["residence", "current residence", "居住地", "住在", "现居", "搬到"], "entity", true, [], "current"),
  define("employment.organization", ["employer", "company", "任职公司", "工作单位", "就职于"], "entity", true, [], "current"),
  define("employment.role", ["job title", "role", "职位", "岗位", "职业"], "string", true, [], "current"),
  define("workplace.location", ["workplace", "office location", "办公地点", "办公室", "工作地点"], "entity", true, [], "current"),
  define("contact.emergency", ["emergency contact", "紧急联系人"], "entity", true, [], "current"),
  define("document.passport_expiry", ["passport expiry", "passport expiration", "护照到期", "护照有效期"], "string", true, [], "current"),
  define("relationship.family", ["family", "家庭关系", "亲属", "家人"], "entity_set", false, ["relation"], "current"),
  define("preference.food", ["food preference", "饮食偏好", "喜欢吃", "不吃"], "string_set", false, ["polarity"], "current"),
  define("preference.color", ["favorite color", "colour preference", "最喜欢的颜色", "喜欢什么颜色"], "string", true, [], "current"),
  define("preference.diet", ["diet", "dietary pattern", "饮食方式", "饮食习惯"], "string", true, [], "current"),
  define("relationship.status", ["relationship status", "marital status", "感情状态", "婚姻状态"], "string", true, [], "current"),
  define("membership.gym", ["gym membership", "健身房会员", "健身房"], "entity", true, [], "current"),
  define("device.phone_brand", ["phone brand", "手机品牌", "手机"], "string", true, [], "current"),
  define("device.camera.primary", ["primary camera", "camera model", "主力相机", "主力机", "相机"], "entity", true, [], "current"),
  define("commute.mode", ["commute mode", "通勤方式", "上班方式"], "string", true, [], "current"),
  define("possession.vehicle", ["vehicle", "car", "车辆", "汽车"], "entity", true, [], "current"),
  define("preference.communication_style", ["communication style", "沟通偏好", "回复风格", "表达风格"], "string_set", false, [], "current"),
  define("achievement.personal_best", ["personal best", "personal record", "个人最好成绩", "个人最佳"], "string", true, ["activity"], "current"),
  define("constraint.health", ["health constraint", "健康限制", "过敏", "忌口", "疾病"], "string_set", false, [], "current"),
  define("constraint.safety", ["safety constraint", "安全限制", "安全要求", "禁忌"], "string_set", false, [], "current"),
];

function define(
  id: string,
  aliases: string[],
  valueType: PredicateDefinition["value_type"],
  singleValued: boolean,
  contextDimensions: string[],
  temporalRule: PredicateDefinition["temporal_rule"],
): PredicateDefinition {
  return {
    id,
    aliases,
    value_type: valueType,
    single_valued: singleValued,
    context_dimensions: contextDimensions,
    subject_kinds: ["user", "agent", "contact"],
    temporal_rule: temporalRule,
    normalization: valueType.endsWith("_set") ? "set" : valueType === "entity" ? "entity_ref" : "text",
  };
}

const BY_ID = new Map(PREDICATES.map((item) => [item.id, item]));
const BY_ALIAS = new Map<string, PredicateDefinition>();
for (const predicate of PREDICATES) {
  BY_ALIAS.set(predicate.id, predicate);
  for (const alias of predicate.aliases) BY_ALIAS.set(normalizeText(alias).toLowerCase(), predicate);
}

export interface AssertionCandidate {
  subject?: string;
  predicate?: string;
  object?: unknown;
  contextDimensions?: Record<string, string>;
  utteranceMode?: UtteranceMode;
  specificity?: Specificity;
  trustTier?: number;
  validFrom?: string;
}

export interface NormalizedAssertion {
  subject_id: string | null;
  subject_resolution: SubjectResolution;
  predicate: PredicateDefinition | null;
  object_json: unknown;
  canonical_object_hash: string | null;
  context_dimensions: Record<string, string>;
  claim_key: string | null;
  utterance_mode: UtteranceMode;
  specificity: Specificity;
  trust_tier: number;
}

export function listPredicates(): PredicateDefinition[] {
  return PREDICATES.map((item) => ({ ...item, aliases: [...item.aliases], context_dimensions: [...item.context_dimensions], subject_kinds: [...item.subject_kinds] }));
}

export function getPredicate(id: string | undefined): PredicateDefinition | null {
  if (!id) return null;
  return BY_ID.get(id) ?? BY_ALIAS.get(normalizeText(id).toLowerCase()) ?? null;
}

export function normalizeAssertion(
  memory: Memory,
  userId: string,
  candidate: AssertionCandidate = {},
): NormalizedAssertion | null {
  if (memory.layer !== "personal_semantic" && !candidate.predicate && !memory.predicate) return null;
  const inferred = inferCandidate(memory.content);
  const utteranceMode = candidate.utteranceMode ?? memory.utterance_mode ?? inferred.utteranceMode ?? inferUtteranceMode(memory.content);
  const predicate = getPredicate(candidate.predicate ?? memory.predicate ?? inferred.predicate);
  const object = candidate.object ?? memory.object_json ?? inferred.object;
  const subject = candidate.subject ?? memory.subject_id ?? inferred.subject;
  const resolved = resolveSubject(subject, userId, memory.source.origin_agent);
  const context = normalizeContext(predicate, candidate.contextDimensions ?? memory.context_dimensions ?? inferred.contextDimensions ?? {});
  const normalizedObject = predicate && object !== undefined ? normalizeObject(object, predicate.value_type.endsWith("_set")) : undefined;
  const objectHash = normalizedObject === undefined ? null : hashCanonical(normalizedObject);
  const subjectKind = resolved.subjectId?.startsWith("agent:") ? "agent" : resolved.subjectId?.startsWith("user:") ? "user" : "contact";
  const claimEligible = utteranceMode === "literal" && predicate !== null && objectHash !== null
    && resolved.resolution !== "ambiguous" && predicate.subject_kinds.includes(subjectKind);
  const claimKey = claimEligible
    ? makeClaimKey(resolved.subjectId!, predicate.id, context)
    : null;
  return {
    subject_id: resolved.subjectId,
    subject_resolution: resolved.resolution,
    predicate,
    object_json: normalizedObject,
    canonical_object_hash: objectHash,
    context_dimensions: context,
    claim_key: claimKey,
    utterance_mode: utteranceMode,
    specificity: candidate.specificity ?? memory.specificity ?? inferred.specificity ?? "global",
    trust_tier: clampTrustTier(candidate.trustTier ?? memory.trust_tier ?? inferTrustTier(memory)),
  };
}

export function applyNormalizedAssertion(memory: Memory, normalized: NormalizedAssertion): Memory {
  memory.subject_id = normalized.subject_id ?? undefined;
  memory.subject_resolution = normalized.subject_resolution;
  memory.data_subject_ids = normalized.subject_id ? [normalized.subject_id] : undefined;
  memory.predicate = normalized.predicate?.id;
  memory.object_json = normalized.object_json;
  memory.canonical_object_hash = normalized.canonical_object_hash ?? undefined;
  memory.context_dimensions = Object.keys(normalized.context_dimensions).length > 0 ? normalized.context_dimensions : undefined;
  memory.claim_key = normalized.claim_key ?? undefined;
  memory.claim_key_version = normalized.claim_key ? CLAIM_KEY_VERSION : undefined;
  memory.normalizer_version = NORMALIZER_VERSION;
  memory.utterance_mode = normalized.utterance_mode;
  memory.specificity = normalized.specificity;
  memory.trust_tier = normalized.trust_tier;
  memory.source_event_ids = [...new Set(memory.source_event_ids ?? (memory.archival_ref ? [memory.archival_ref] : []))];
  if (!normalized.claim_key && memory.layer === "personal_semantic") memory.legacy_unstructured = true;
  if (normalized.utterance_mode !== "literal" && memory.layer === "personal_semantic") {
    memory.layer = "episodic";
    memory.claim_key = undefined;
    memory.legacy_unstructured = undefined;
  }
  return memory;
}

export function makeClaimKey(subjectId: string, predicateId: string, context: Record<string, string>): string {
  const body = canonicalJson({ subject_id: subjectId, predicate_id: predicateId, context_dimensions: context });
  return `ck:${CLAIM_KEY_VERSION}:${toBase32(createHash("sha256").update(body).digest())}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function normalizeObject(value: unknown, setSemantics: boolean): unknown {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeObject(item, false));
    if (!setSemantics) return items;
    const unique = new Map(items.map((item) => [canonicalJson(item), item]));
    return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [normalizeText(key), normalizeObject(item, false)]),
    );
  }
  return value;
}

function normalizeContext(predicate: PredicateDefinition | null, input: Record<string, string>): Record<string, string> {
  if (!predicate) return {};
  const allowed = new Set(predicate.context_dimensions);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => allowed.has(key) && normalizeText(value).length > 0)
      .map(([key, value]) => [key, normalizeText(value).toLowerCase()])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function resolveSubject(raw: string | undefined, userId: string, originAgent?: string): { subjectId: string | null; resolution: SubjectResolution } {
  const value = normalizeText(raw ?? "user:self");
  const lower = value.toLowerCase();
  if (["user:self", "self", "我", "本人", "自己", "当前用户", userId.toLowerCase()].includes(lower)) {
    return { subjectId: "user:self", resolution: "resolved" };
  }
  if (["agent:self", "assistant:self", "助手", "你"].includes(lower) && originAgent) {
    return { subjectId: `agent:${normalizeText(originAgent).toLowerCase()}`, resolution: "resolved" };
  }
  if (/^(user|agent|identity|contact):[a-z0-9._:-]+$/i.test(value)) {
    return { subjectId: lower, resolution: "resolved" };
  }
  if (!value || /[|/、,，]|或者|还是/.test(value)) return { subjectId: null, resolution: "ambiguous" };
  return { subjectId: `provisional:${hashCanonical(value).slice(0, 26)}`, resolution: "provisional" };
}

export function inferControlledAssertions(content: string): AssertionCandidate[] {
  const text = normalizeText(content);
  const candidates: AssertionCandidate[] = [];
  const seen = new Set<string>();
  for (const inferred of inferPersonalBestClaims(text)) {
    const key = inferred.predicate + ":" + canonicalJson(inferred.object);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(inferred);
  }
  for (const segment of splitAssertionSegments(text)) {
    const utteranceMode = inferUtteranceMode(segment);
    if (utteranceMode !== "literal") continue;
    const inferredClaims = [
      inferControlledPersonalClaim(segment),
      inferResidenceClaim(segment),
      inferWorkplaceLocation(segment),
      inferPassportExpiry(segment),
      inferEmergencyContact(segment),
      inferPrimaryCamera(segment),
      inferColorPreference(segment),
      inferHealthConstraint(segment),
    ];
    for (const inferred of inferredClaims) {
      if (!inferred?.predicate || inferred.object === undefined) continue;
      const key = inferred.predicate + ":" + canonicalJson(inferred.object);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        subject: "user:self",
        ...inferred,
        utteranceMode,
        trustTier: 1,
      });
    }
  }
  return candidates;
}

function splitAssertionSegments(content: string): string[] {
  return content.split(/(?<=[.!?\u3002\uff01\uff1f])\s*|\n+/u).filter(Boolean);
}

export function inferPersonalBestActivity(content: string): string | null {
  const text = normalizeText(content);
  if (/\bcharity\s+5\s*k(?:\s+run)?\b/i.test(text) || /(?:慈善|公益)\s*5\s*(?:公里|千米)/u.test(text)) {
    return "charity 5k run";
  }
  if (/\b5\s*k(?:\s+run)?\b/i.test(text) || /\b5\s*(?:公里|千米)(?:跑|跑步)?\b/u.test(text)) {
    return "5k run";
  }
  return null;
}

function inferPersonalBestClaims(content: string): AssertionCandidate[] {
  const activity = inferPersonalBestActivity(content);
  if (!activity) return [];
  const values = new Set<string>();
  for (const segment of splitAssertionSegments(content)) {
    if (inferUtteranceMode(segment) !== "literal") continue;
    for (const marker of segment.matchAll(/personal best|personal record|\u4e2a\u4eba\u6700\u597d\u6210\u7ee9|\u4e2a\u4eba\u6700\u4f73/giu)) {
      const nearby = segment.slice(marker.index, marker.index + 180);
      const time = nearby.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/u)?.[1];
      if (time) values.add(time);
    }
  }
  return [...values].map((value) => ({
    subject: "user:self",
    predicate: "achievement.personal_best",
    object: value,
    contextDimensions: { activity },
    utteranceMode: "literal",
    specificity: "contextual",
    trustTier: 1,
  }));
}

export function inferControlledAssertion(content: string): AssertionCandidate | null {
  return inferControlledAssertions(content)[0] ?? null;
}

function inferCandidate(content: string): AssertionCandidate {
  const text = normalizeText(content);
  const direct = inferControlledAssertion(text);
  if (direct) return direct;

  const rules: Array<{ re: RegExp; predicate: string; object: (m: RegExpMatchArray) => unknown; context?: (m: RegExpMatchArray) => Record<string, string> }> = [
    { re: /(?:我叫|我的名字是)\s*([^，。！？,.!?]{1,40})/u, predicate: "identity.name", object: (m) => m[1] },
    { re: /(?:以后)?(?:请)?叫我\s*([^，。！？,.!?]{1,40})/u, predicate: "identity.preferred_address", object: (m) => m[1] },
    { re: /(?:我(?:现在)?住在|我(?:已经)?搬到|我现居)\s*([^，。！？,.!?]{1,80})/u, predicate: "residence.current", object: (m) => m[1] },
    { re: /我(?:目前)?(?:在|就职于)\s*([^，。！？,.!?]{1,80}?)(?:工作|任职)/u, predicate: "employment.organization", object: (m) => m[1] },
    { re: /(?:我的职位是|我的岗位是|我担任)\s*([^，。！？,.!?]{1,80})/u, predicate: "employment.role", object: (m) => m[1] },
    { re: /我(?:很)?喜欢吃\s*([^，。！？,.!?]{1,80})/u, predicate: "preference.food", object: (m) => [m[1]], context: () => ({ polarity: "like" }) },
    { re: /我(?:不吃|不喜欢吃)\s*([^，。！？,.!?]{1,80})/u, predicate: "preference.food", object: (m) => [m[1]], context: () => ({ polarity: "avoid" }) },
  ];
  for (const rule of rules) {
    const match = text.match(rule.re);
    if (match) return { subject: "user:self", predicate: rule.predicate, object: rule.object(match), contextDimensions: rule.context?.(match) };
  }
  return {};
}

function inferControlledPersonalClaim(text: string): AssertionCandidate | null {
  const employer = text.match(/\b(?:started working at|work(?:ing)? at|employed (?:at|by)|(?:am|['’]m) now with|now with|switched jobs? (?:to|and (?:am|['’]m) now with))\s+([^.!?]{2,100})/i);
  const joinedEmployer = text.match(/\bjoined\s+([^.!?]{2,80}?\b(?:Industries|Inc|LLC|Corp|Corporation|Company|Solutions|Technologies))\b/i);
  const employerValue = employer?.[1] ?? joinedEmployer?.[1];
  if (employerValue) {
    return { predicate: "employment.organization", object: cleanCapturedValue(employerValue) };
  }

  const residence = text.match(/\b(?:moving to|moved to|relocated to|live in|living in|lived in|moved(?!\s+up\b))\s+([^,.!?]{2,80})/i);
  if (residence) {
    return { predicate: "residence.current", object: cleanCapturedValue(residence[1]!) };
  }

  if (/\bvegan\b/i.test(text)) return { predicate: "preference.diet", object: "vegan" };
  if (/\bpescatarian\b/i.test(text)) return { predicate: "preference.diet", object: "pescatarian" };
  if (/\bvegetarian\b/i.test(text)) return { predicate: "preference.diet", object: "vegetarian" };

  if (/\b(?:got married|we(?:'ve| have)? just got married|married last)\b/i.test(text)) {
    return { predicate: "relationship.status", object: "married" };
  }
  if (/\b(?:in a relationship|started (?:a )?relationship)\b/i.test(text)) {
    return { predicate: "relationship.status", object: "in a relationship" };
  }
  if (/\b(?:been single|am single|['’]m single)\b/i.test(text)) {
    return { predicate: "relationship.status", object: "single" };
  }

  const role = text.match(/\b(?:new job as a?|promoted to|moved up to|work as a?|working as a?)\s+([^.!?]{2,80})/i);
  if (role) return { predicate: "employment.role", object: cleanCapturedValue(role[1]!) };

  const gym = text.match(/\b(?:going to|switched to|joined)\s+((?:Planet Fitness|Gold['’]s Gym|Equinox|[^.!?]{2,60}\b(?:Gym|Fitness)))\b/i);
  if (gym) return { predicate: "membership.gym", object: cleanCapturedValue(gym[1]!) };

  const phone = text.match(/\b(Samsung|OnePlus|Apple|Nokia|Google Pixel|Huawei|Xiaomi|Oppo|Vivo)\b/i);
  if (phone && /\b(?:phone|switched to|try out|got a new)\b/i.test(text)) {
    return { predicate: "device.phone_brand", object: canonicalPhoneBrand(phone[1]!) };
  }

  const commute = inferCommuteMode(text);
  if (commute) return { predicate: "commute.mode", object: commute };

  const vehicle = text.match(/\b(Toyota Corolla|Honda Civic|Tesla Model 3)\b/i);
  if (vehicle && /\b(?:drive|driving|car|got myself|switched to|go electric)\b/i.test(text)) {
    return { predicate: "possession.vehicle", object: canonicalVehicle(vehicle[1]!) };
  }

  return null;
}

function inferResidenceClaim(text: string): AssertionCandidate | null {
  const current = text.match(/我[^。！？.!?]{0,80}?(?:现在|目前)常住\s*([^，。；;！？!?]{1,40})/u);
  if (current) {
    return { predicate: "residence.current", object: normalizeText(current[1]!) };
  }

  const direct = text.match(/我(?:现在|目前)?(?:住在|居住在|常住|现居)\s*([^，。；;！？!?]{1,40})/u);
  if (direct) {
    return { predicate: "residence.current", object: normalizeText(direct[1]!) };
  }

  const moved = text.match(/我(?:已经)?(?:从[^，。；;！？!?]{1,40})?搬到\s*([^，。；;！？!?]{1,40})/u);
  if (moved) {
    return { predicate: "residence.current", object: normalizeText(moved[1]!) };
  }
  return null;
}

function inferWorkplaceLocation(text: string): AssertionCandidate | null {
  const match = text.match(/(?:我(?:现在|目前)?的|我的)?(?:办公地点|办公室|工作地点)(?:目前|现在)?(?:是|在|位于|还在)\s*([^，。；;！？!?]{1,60})/u);
  if (!match) return null;
  return { predicate: "workplace.location", object: normalizeText(match[1]!) };
}

function inferPassportExpiry(text: string): AssertionCandidate | null {
  const match = text.match(/(?:我的)?护照(?:将在|将于|会在|在)?\s*((?:20\d{2})[年\-\/.](?:0?[1-9]|1[0-2])(?:月)?(?:\d{1,2}日?)?)\s*(?:到期|过期)/u);
  if (!match) return null;
  return { predicate: "document.passport_expiry", object: normalizeText(match[1]!) };
}

function inferEmergencyContact(text: string): AssertionCandidate | null {
  const match = text.match(/(?:我的)?紧急联系人(?:是|为)\s*([^，。；;！？!?]{1,40})/u);
  if (!match) return null;
  return { predicate: "contact.emergency", object: normalizeText(match[1]!) };
}

function inferPrimaryCamera(text: string): AssertionCandidate | null {
  const primary = text.match(/(?:现在|目前)?(?:的)?主力(?:相机|机)(?:是|为)\s*([^，。；;！？!?]{1,60})/u);
  if (primary) return { predicate: "device.camera.primary", object: normalizeText(primary[1]!) };

  const switched = text.match(/我(?:已经)?(?:从[^，。；;！？!?]{1,40})?(?:换成|改用)\s*([^，。；;！？!?]{1,40}?相机)/u);
  if (switched) return { predicate: "device.camera.primary", object: normalizeText(switched[1]!) };

  const using = text.match(/我(?:以前|现在|目前)?(?:一直)?(?:使用|用)\s*([^，。；;！？!?]{1,40}?相机)/u);
  if (using) return { predicate: "device.camera.primary", object: normalizeText(using[1]!) };
  return null;
}
function inferColorPreference(text: string): AssertionCandidate | null {
  const chinese = text.match(/(?:^|[，。；;！？!?])\s*我最喜欢的颜色是\s*([^，。；;！？!?]{1,30})/u);
  if (chinese) {
    return { predicate: "preference.color", object: normalizeText(chinese[1]!) };
  }

  const english = text.match(/(?:^|[.!?;]\s*)my favou?rite colou?r is\s+([^,.!?;]{1,30})/i);
  if (english) {
    return { predicate: "preference.color", object: cleanCapturedValue(english[1]!) };
  }
  return null;
}

function inferHealthConstraint(text: string): AssertionCandidate | null {
  const chinese = text.match(/(?:^|[，。；;！？!?])\s*我对\s*([^，。；;！？!?]{1,40}?)(?:严重|重度|高度)?过敏/u);
  if (chinese) {
    return { predicate: "constraint.health", object: [normalizeText(chinese[1]!)] };
  }

  const english = text.match(/(?:^|[.!?;]\s*)I(?:['’]m| am)?(?: severely| seriously)? allergic to\s+([^,.!?;]{1,50})/i);
  if (english) {
    return { predicate: "constraint.health", object: [cleanCapturedValue(english[1]!)] };
  }
  return null;
}

function cleanCapturedValue(value: string): string {
  return normalizeText(value)
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+(?:recently|now|last (?:year|month)|a few (?:months|years) ago|for (?:a while|quite some time))(?:\s+.*)?$/i, "")
    .replace(/\s+(?:because|and|but|so)\s+.*$/i, "")
    .trim();
}

function canonicalPhoneBrand(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "oneplus") return "OnePlus";
  if (lower === "google pixel") return "Google Pixel";
  return value[0]!.toUpperCase() + value.slice(1).toLowerCase();
}

function inferCommuteMode(text: string): string | null {
  if (/\b(?:bike|bicycle|cycling)\b/i.test(text) && /\b(?:work|commut)\b/i.test(text)) return "bicycle";
  if (/\b(?:take|taking|switched to taking)\s+the bus\b/i.test(text)) return "bus";
  if (/\b(?:drive|driving)\s+(?:my\s+)?car\s+to work\b/i.test(text)) return "car";
  return null;
}

function canonicalVehicle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace("Tesla Model 3", "Tesla Model 3");
}
function inferUtteranceMode(content: string): UtteranceMode {
  const text = normalizeText(content);
  if (/如果|假如|假设|要是|\b(?:if|suppose|assuming|hypothetically)\b/i.test(text)) return "hypothetical";
  if (/可能|也许|大概|考虑(?:中|过)?|\b(?:maybe|perhaps|possibly)\b/i.test(text)) return "uncertain";
  if (/听说|据说|他说|她说|他们说|转述|\b(?:according to|he said|she said|they said)\b/i.test(text)) return "quoted";
  if (/开玩笑|逗你|玩笑|\b(?:joking|just kidding)\b/i.test(text)) return "joke";
  if (/角色扮演|剧情里|设定中|假装|\b(?:roleplay|in this story|pretend)\b/i.test(text)) return "roleplay";
  return "literal";
}
function inferTrustTier(memory: Memory): number {
  if (memory.scenario === "doc-research") return 7;
  if (memory.source.extractor === "sensor" || memory.source.origin.startsWith("tool:")) return 3;
  if (memory.source.extractor === "agent_observation") return 5;
  if (memory.archival_ref && memory.source.origin_agent) return 1;
  if (memory.archival_ref) return 1;
  return memory.source.authoritative ? 2 : 6;
}

function clampTrustTier(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(7, Math.trunc(value)));
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function toBase32(buffer: Buffer): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}