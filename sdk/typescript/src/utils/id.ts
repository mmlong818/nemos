// utils/id.ts — ID 生成
//
// v0.1 用 UUID v4。spec §3.1 要求 content-addressed sha256 id（带 type prefix），
// 我们保留 type prefix 以便未来无损迁移到 content-addressed。
//
// 未来 v0.2+: id = "<prefix>_" + sha256_hex(canonical_json) 替换 randomUUID 部分，
// 但 prefix 形态不变 → 现有数据 id 不会全失效。

import { randomUUID } from "node:crypto";
import type { Layer } from "../types.js";

const LAYER_PREFIX: Record<Layer, string> = {
  archival: "arch",
  episodic: "ep",
  semantic: "sem",
  personal_semantic: "psem",
  procedural: "proc",
};

export function newId(layer: Layer): string {
  const uuid = randomUUID().replace(/-/g, "");
  return `${LAYER_PREFIX[layer]}_${uuid}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
