// entity.ts — v0.3 轻量 entity 抽取 + cross-memory linking 工具
//
// 设计：
// - LLM 短 prompt 抽 ≤10 个 entity（人名 / 项目 / 概念 / 工具），输出 JSON 数组
// - content → entities 在 worker 缓存里 memoize，避免同 archival 重抽
// - string match 走 storage.findByEntity（SQLite 走 FTS，InMemory 走线性扫）
//
// 标准化：v0.3 字符串精确匹配（trim + collapse whitespace），不做别名归一。
//        v0.4 加 entity 别名表。
//
// 跨 user namespace 永不连接 → 由 storage 层 tenant+user filter 守住。

import type { LLMProvider } from "./types.js";

export const ENTITY_EXTRACT_PROMPT = `你是 nemos entity 抽取器。

任务：从给定文本中识别最多 10 个有信息价值的 entity（命名实体），按出现顺序输出。

entity 类型偏好：
- 人名 / 角色名 / 团队名
- 项目名 / 产品名 / 公司名
- 具体概念 / 技术名词 / 库 / 工具
- 文档名 / 报告名 / 标识符

不要输出：
- 通用词（"用户" / "今天" / "项目"无后缀）
- 形容词 / 副词 / 情绪词
- 代词

输出严格 JSON（不要 markdown 围栏）：
{ "entities": ["entity1", "entity2", ...] }

- 0 个也合法，输出 { "entities": [] }
- 不要解释，不要输出 JSON 以外的内容。`;

/** 简易内存缓存，content hash → entities。同进程内复用，进程退出即丢。 */
const cache = new Map<string, string[]>();
const MAX_CACHE = 1024;
const MAX_CONTENT_HASH_LEN = 4096; // 防止单条超大 content 撑爆 key

/**
 * 抽取 entity。带 in-memory cache，避免同 archival 重抽。
 * 失败/非法 JSON → 返回 []（不阻塞 worker）。
 */
export async function extractEntities(
  content: string,
  llm: LLMProvider,
): Promise<string[]> {
  const trimmed = (content || "").trim();
  if (!trimmed) return [];
  const cacheKey = trimmed.length <= MAX_CONTENT_HASH_LEN
    ? trimmed
    : trimmed.slice(0, MAX_CONTENT_HASH_LEN);
  const hit = cache.get(cacheKey);
  if (hit) return [...hit];

  let raw: string;
  try {
    raw = await llm.chat(ENTITY_EXTRACT_PROMPT, `文本：\n${trimmed}`);
  } catch {
    return [];
  }
  const cleaned = stripFence(raw);
  let arr: string[];
  try {
    const obj = JSON.parse(cleaned) as { entities?: unknown };
    if (!Array.isArray(obj.entities)) return [];
    arr = obj.entities
      .filter((x): x is string => typeof x === "string")
      .map((s) => normalizeEntity(s))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }

  // dedupe + 截断
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of arr) {
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= 10) break;
  }

  if (cache.size >= MAX_CACHE) {
    // 朴素 LRU 替代：清最早的一半
    const keep = Array.from(cache.keys()).slice(-Math.floor(MAX_CACHE / 2));
    const oldCache = new Map(cache);
    cache.clear();
    for (const k of keep) {
      const v = oldCache.get(k);
      if (v) cache.set(k, v);
    }
  }
  cache.set(cacheKey, [...out]);
  return out;
}

/** 清缓存（测试用）。 */
export function _resetEntityCache(): void {
  cache.clear();
}

function normalizeEntity(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return s;
}
