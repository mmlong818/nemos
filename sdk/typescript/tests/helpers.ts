// helpers.ts — 测试用 mock LLM provider，避免烧真 token

import type { LLMConfig } from "../src/types.js";

interface MockResponse {
  archival: { arousal: { value: number; signal_sources: string[] }; surprise: { value: number; basis: string } };
  derived: Array<{
    layer: string;
    content: string;
    type: string;
    source: {
      authoritative: boolean;
      origin: string;
      chain_depth: number;
      confidence?: string;
    };
    arousal: { value: number; signal_sources: string[] };
    surprise: { value: number; basis: string };
    event_at?: string;
    sensitive?: boolean;
  }>;
}

interface MockCheckResponse {
  derived: MockResponse["derived"];
  stats: {
    pass_a_count: number;
    pass_b_count: number;
    merged_count: number;
    high_confidence: number;
    medium_confidence: number;
    conflicts: number;
  };
}

/**
 * Mock LLM：把第一句话当 episodic、含「我」当 personal_semantic 派生。
 * 输出严格遵循 SDK SYSTEM_PROMPT JSON 格式，确保 archival.content 字段被客户端覆盖。
 *
 * 重要：mock 是确定性的——双 pass 模式下两次输出相同，merge 后 confidence=high。
 *
 * 调用方可在测试中通过 `getMockCallCount()` 检查是否触发了 check pass。
 */
let mockCallCount = 0;

export function resetMockCount(): void {
  mockCallCount = 0;
}

export function getMockCallCount(): number {
  return mockCallCount;
}

export function makeMockLLMConfig(): LLMConfig {
  return {
    provider: "custom",
    name: "mock-llm",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      // 路由：CHECK_SYSTEM_PROMPT 还是 SYSTEM_PROMPT？
      if (system.includes("记忆审查官")) {
        return JSON.stringify(buildCheckResponse(user));
      }
      return JSON.stringify(buildExtractResponse(user));
    },
  };
}

function buildExtractResponse(userMsg: string): MockResponse {
  const contentMatch = userMsg.match(/用户内容：\n([\s\S]*)$/);
  const content = (contentMatch?.[1] || "").trim();

  const sentences = content.split(/[\n。.！!？?]+/).map((s) => s.trim()).filter((s) => s.length > 3);
  const derived = sentences.slice(0, 5).map((sent) => {
    const layer = pickLayer(sent);
    return {
      layer,
      content: sent,
      type: layer === "personal_semantic" ? "user" : "project",
      source: {
        authoritative: false,
        origin: "llm-extract",
        chain_depth: 1,
      },
      arousal: { value: 0.3, signal_sources: ["mock"] },
      surprise: { value: 0.3, basis: "mock-heuristic" },
    };
  });

  return {
    archival: {
      arousal: { value: 0.0, signal_sources: [] },
      surprise: { value: 0.0, basis: "raw input baseline" },
    },
    derived,
  };
}

function buildCheckResponse(userMsg: string): MockCheckResponse {
  // 解析 pass_a + pass_b，合并去重，标 confidence=high（mock 确定性 → 两次完全相同）
  const inputMatch = userMsg.match(/(\{[\s\S]*\})\s*$/);
  let parsed: { pass_a_derived?: MockResponse["derived"]; pass_b_derived?: MockResponse["derived"] } = {};
  try {
    parsed = JSON.parse(inputMatch?.[1] || "{}");
  } catch {
    parsed = {};
  }
  const a = parsed.pass_a_derived || [];
  const b = parsed.pass_b_derived || [];
  // 简化合并：以 content 字面相等去重，认为 high confidence
  const seen = new Set<string>();
  const merged: MockResponse["derived"] = [];
  for (const item of [...a, ...b]) {
    const key = `${item.layer}:${item.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...item,
      source: { ...item.source, confidence: "high", chain_depth: 2 },
    });
  }
  return {
    derived: merged,
    stats: {
      pass_a_count: a.length,
      pass_b_count: b.length,
      merged_count: merged.length,
      high_confidence: merged.length,
      medium_confidence: 0,
      conflicts: 0,
    },
  };
}

function pickLayer(s: string): "episodic" | "semantic" | "personal_semantic" | "procedural" {
  if (/我.*(喜欢|讨厌|偏好|是|不是|擅长)/.test(s)) return "personal_semantic";
  if (/(每天|每周|流程|步骤|总是)/.test(s)) return "procedural";
  if (/(今天|昨天|刚才|上周)/.test(s)) return "episodic";
  return "semantic";
}

/**
 * v0.2 mock：scenario 感知 mock。检测 system prompt 中的场景指令，模拟出对应的 derived。
 * - doc-research：所有 personal_semantic 被 mock 主动改为 semantic
 * - diary：所有 derived 都带 sensitive=true（profile 也会强制；这里测试 LLM 主动配合）
 * - 当 prompt 含「event_at」/「时间感知」 → mock 输出 event_at 字段（"2026-05-30"）
 */
export function makeScenarioAwareMockLLMConfig(): LLMConfig {
  return {
    provider: "custom",
    name: "scenario-aware-mock",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      if (system.includes("记忆审查官")) {
        return JSON.stringify(buildCheckResponse(user));
      }
      const resp = buildExtractResponse(user);
      const wantsEventAt = /event_at|时间感知/.test(system);
      const sensitive = /sensitive: true|输出 sensitive/.test(system);
      for (const d of resp.derived) {
        if (wantsEventAt) d.event_at = "2026-05-30";
        if (sensitive) d.sensitive = true;
      }
      return JSON.stringify(resp);
    },
  };
}

// ============================================================================
// v0.3 mocks
// ============================================================================

/**
 * 多视角 mock：根据 system prompt 路由到不同视角输出 / merge 合并 / entity 抽取。
 *
 * 路由：
 * - 含"fact 视角" → 返回 1 条 semantic
 * - 含"emotion 视角" → 返回 1 条 episodic（情绪信号）
 * - 含"method 视角" → 返回 1 条 procedural
 * - 含"decision 视角" → 返回 1 条 episodic（决定信号）
 * - 含"temporal 视角" → 返回 1 条 episodic（带 event_at）
 * - 含"多视角合并器" → merge 输出（带 perspectives 数组）
 * - 含"entity 抽取器" → 返回 entities JSON
 * - 其它 → fallback 单 prompt 输出
 */
export function makePerspectiveMockLLMConfig(): LLMConfig {
  return {
    provider: "custom",
    name: "perspective-mock",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      // entity 抽取
      if (system.includes("entity 抽取器")) {
        return JSON.stringify({ entities: ["X 项目", "团队 Alpha"] });
      }
      // merge pass
      if (system.includes("多视角合并器")) {
        return JSON.stringify(buildMergeResponse(user));
      }
      // 各视角
      if (system.includes("fact 视角")) {
        return JSON.stringify(buildSinglePerspectiveResponse(user, "semantic", "客观事实：X 项目 已发布"));
      }
      if (system.includes("emotion 视角")) {
        return JSON.stringify(buildSinglePerspectiveResponse(user, "episodic", "用户表达对决定的强烈情感"));
      }
      if (system.includes("method 视角")) {
        return JSON.stringify(buildSinglePerspectiveResponse(user, "procedural", "流程步骤：先 A 后 B"));
      }
      if (system.includes("decision 视角")) {
        return JSON.stringify(buildSinglePerspectiveResponse(user, "episodic", "决定：选用 X 而非 Y"));
      }
      if (system.includes("temporal 视角")) {
        const r = buildSinglePerspectiveResponse(user, "episodic", "事件发生在 2026-05-30");
        r.derived[0]!.event_at = "2026-05-30";
        return JSON.stringify(r);
      }
      // 双 pass check
      if (system.includes("记忆审查官")) {
        return JSON.stringify(buildCheckResponse(user));
      }
      // 默认（v0.2 单 pass）
      return JSON.stringify(buildExtractResponse(user));
    },
  };
}

function buildSinglePerspectiveResponse(
  _userMsg: string,
  layer: "semantic" | "episodic" | "procedural" | "personal_semantic",
  content: string,
): MockResponse {
  return {
    archival: {
      arousal: { value: 0, signal_sources: [] },
      surprise: { value: 0, basis: "raw" },
    },
    derived: [
      {
        layer,
        content,
        type: layer === "personal_semantic" ? "user" : "project",
        source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
        arousal: { value: 0.4, signal_sources: ["mock"] },
        surprise: { value: 0.3, basis: "mock" },
      },
    ],
  };
}

interface MergeInput {
  perspectives_input?: Array<MockResponse["derived"][number] & { from_perspective?: string }>;
}

function buildMergeResponse(userMsg: string): MockCheckResponse {
  // 解析输入；按 content 字面合并 → perspectives 数组
  const m = userMsg.match(/(\{[\s\S]*\})\s*$/);
  let parsed: MergeInput = {};
  try {
    parsed = JSON.parse(m?.[1] || "{}") as MergeInput;
  } catch {
    parsed = {};
  }
  const inputs = parsed.perspectives_input || [];
  const grouped = new Map<string, { item: MockResponse["derived"][number]; persp: Set<string> }>();
  for (const it of inputs) {
    const key = `${it.layer}:${it.content}`;
    const ex = grouped.get(key);
    if (ex) {
      if (it.from_perspective) ex.persp.add(it.from_perspective);
    } else {
      const p = new Set<string>();
      if (it.from_perspective) p.add(it.from_perspective);
      grouped.set(key, { item: it, persp: p });
    }
  }
  const merged: MockResponse["derived"] = [];
  for (const { item, persp } of grouped.values()) {
    const out = {
      ...item,
      source: {
        ...item.source,
        origin: "llm-merged",
        chain_depth: 2,
      },
    };
    // 借用扩展字段（绕过 MockResponse 类型）
    (out as unknown as { perspectives?: string[]; perspectives_conflict?: boolean })
      .perspectives = Array.from(persp);
    (out as unknown as { perspectives_conflict?: boolean }).perspectives_conflict = false;
    merged.push(out);
  }
  return {
    derived: merged,
    stats: {
      pass_a_count: inputs.length,
      pass_b_count: 0,
      merged_count: merged.length,
      high_confidence: merged.filter((m2) => {
        const arr = (m2 as unknown as { perspectives?: string[] }).perspectives;
        return Array.isArray(arr) && arr.length >= 2;
      }).length,
      medium_confidence: merged.filter((m2) => {
        const arr = (m2 as unknown as { perspectives?: string[] }).perspectives;
        return Array.isArray(arr) && arr.length === 1;
      }).length,
      conflicts: 0,
    },
  };
}

/**
 * 强制冲突 mock：让 merge pass 返回 perspectives_conflict=true 的合并条目。
 */
export function makeConflictPerspectiveMockLLMConfig(): LLMConfig {
  return {
    provider: "custom",
    name: "perspective-conflict-mock",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      if (system.includes("entity 抽取器")) {
        return JSON.stringify({ entities: [] });
      }
      if (system.includes("多视角合并器")) {
        // 合成一条 conflict
        return JSON.stringify({
          derived: [
            {
              layer: "semantic",
              content: "X 决定（fact 视角）/ 反 X（emotion 视角暗示）",
              type: "project",
              source: { authoritative: false, origin: "llm-merged", chain_depth: 2 },
              arousal: { value: 0.5, signal_sources: ["mock"] },
              surprise: { value: 0.4, basis: "mock" },
              perspectives: ["fact", "emotion"],
              perspectives_conflict: true,
            },
          ],
          stats: { pass_a_count: 2, pass_b_count: 0, merged_count: 1, high_confidence: 0, medium_confidence: 0, conflicts: 1 },
        });
      }
      // 各视角各返回 1 条同 layer 不同 content
      if (system.includes("fact 视角")) {
        return JSON.stringify(buildSinglePerspectiveResponse(user, "semantic", "X 是 true"));
      }
      if (system.includes("emotion 视角")) {
        return JSON.stringify(buildSinglePerspectiveResponse(user, "semantic", "X 不是 true"));
      }
      // 其它视角返回空
      return JSON.stringify({
        archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "raw" } },
        derived: [],
      });
    },
  };
}

/**
 * Entity-only mock：用于 entity 抽取相关测试。返回固定的 entities。
 */
export function makeEntityMockLLMConfig(entities: string[]): LLMConfig {
  return {
    provider: "custom",
    name: "entity-mock",
    chat: async (system: string): Promise<string> => {
      mockCallCount++;
      if (system.includes("entity 抽取器")) {
        return JSON.stringify({ entities });
      }
      if (system.includes("记忆审查官")) {
        return JSON.stringify({ derived: [], stats: {} });
      }
      // 默认 derived
      return JSON.stringify({
        archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "raw" } },
        derived: [
          {
            layer: "semantic",
            content: "fact",
            type: "project",
            source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
            arousal: { value: 0, signal_sources: [] },
            surprise: { value: 0, basis: "raw" },
          },
        ],
      });
    },
  };
}

// ============================================================================
// v0.4 mocks
// ============================================================================

/**
 * v0.4：sensitivity 感知 mock。
 * 当 system prompt 提到「健康 / 财务 / 亲密关系 / 情绪危机」检测引导，
 * 且原文包含约定关键词时输出 sensitive=true。
 *
 * 关键词（抽象描述，避免具体症状细节）：
 * - "健康话题" / "财务困难" / "亲密关系" / "情绪困扰"
 */
export function makeSensitivityAwareMockLLMConfig(): LLMConfig {
  return {
    provider: "custom",
    name: "sensitivity-aware-mock",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      if (system.includes("记忆审查官")) {
        return JSON.stringify(buildCheckResponse(user));
      }
      const hasSensitivityGuide = /隐私敏感检测|sensitive 字段置为 true/.test(system);
      const resp = buildExtractResponse(user);
      if (hasSensitivityGuide) {
        for (const d of resp.derived) {
          if (
            /健康话题|财务困难|亲密关系|情绪困扰|配偶|伴侣/.test(d.content)
          ) {
            d.sensitive = true;
          }
        }
      }
      return JSON.stringify(resp);
    },
  };
}

/**
 * v0.4：narrative LLM mock。
 * 当 system 含「nemos 记忆叙事器」时返回一段固定的自然语言摘要（包含 layer 信号词）。
 * 其它路径走 sensitivity-aware 默认行为。
 */
export function makeNarrativeMockLLMConfig(narrative?: string): LLMConfig {
  const fixed =
    narrative ??
    "该用户偏好早起写作，相对稳定。最近一次提到项目截止时间确认。偶发的工作场景在咖啡馆。";
  return {
    provider: "custom",
    name: "narrative-mock",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      if (system.includes("nemos 记忆叙事器")) {
        return fixed;
      }
      if (system.includes("记忆审查官")) {
        return JSON.stringify(buildCheckResponse(user));
      }
      return JSON.stringify(buildExtractResponse(user));
    },
  };
}

/**
 * v0.4：reflect mock。
 *
 * 当 system 含「nemos 反思整合器」时：
 * - 解析 user message 中 recent_episodic 的 id 列表
 * - 输出一条 personal_semantic derived，consolidated_from = 前 N 个 id
 * - 内容是 fixedContent，默认「用户在工作上倾向早晨高产」
 *
 * 其它路径回 buildExtractResponse。
 */
export function makeReflectMockLLMConfig(opts?: {
  fixedContent?: string;
  layer?: "semantic" | "personal_semantic";
  conflict?: boolean;
}): LLMConfig {
  const content = opts?.fixedContent ?? "用户在工作上倾向早晨时段进入高产状态";
  const layer = opts?.layer ?? "personal_semantic";
  const conflict = opts?.conflict === true;
  return {
    provider: "custom",
    name: "reflect-mock",
    chat: async (system: string, user: string): Promise<string> => {
      mockCallCount++;
      if (system.includes("nemos 反思整合器")) {
        // 提取 ep_xxx id
        const ids: string[] = [];
        const re = /"id":\s*"(ep_[a-zA-Z0-9]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(user)) !== null) {
          if (m[1]) ids.push(m[1]);
          if (ids.length >= 5) break;
        }
        if (ids.length === 0) {
          return JSON.stringify({ derived: [] });
        }
        return JSON.stringify({
          derived: [
            {
              layer,
              content,
              type: layer === "personal_semantic" ? "user" : "project",
              source: {
                authoritative: false,
                origin: "reflect-consolidation",
                chain_depth: 1,
                confidence: "high",
                perspectives_conflict: conflict,
              },
              consolidated_from: ids,
              arousal: { value: 0.3, signal_sources: ["mock"] },
              surprise: { value: 0.2, basis: `consolidated from ${ids.length} episodes` },
            },
          ],
        });
      }
      if (system.includes("记忆审查官")) {
        return JSON.stringify(buildCheckResponse(user));
      }
      return JSON.stringify(buildExtractResponse(user));
    },
  };
}

/**
 * 一个会回 authoritative=true 的恶意 mock，用于测试硬约束是否守住。
 */
export function makeMaliciousMockLLMConfig(): LLMConfig {
  return {
    provider: "custom",
    name: "malicious-mock",
    chat: async (system: string): Promise<string> => {
      if (system.includes("记忆审查官")) {
        return JSON.stringify({ derived: [], stats: {} });
      }
      // 故意把 derived 标成 authoritative=true 试图绕过 SDK
      return JSON.stringify({
        archival: {
          arousal: { value: 0, signal_sources: [] },
          surprise: { value: 0, basis: "x" },
        },
        derived: [
          {
            layer: "personal_semantic",
            content: "用户是 AI 工程师（伪造！）",
            type: "user",
            source: {
              authoritative: true, // 恶意：试图直接写 personal_semantic
              origin: "llm-extract",
              chain_depth: 0, // 恶意：试图谎报 user 直说
            },
            arousal: { value: 0.5, signal_sources: [] },
            surprise: { value: 0.5, basis: "x" },
          },
        ],
      });
    },
  };
}
