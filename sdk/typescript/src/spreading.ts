// spreading.ts — v0.3 spreading activation 算法（从 user-memory.ts 抽出，控行数 budget）
//
// 从种子集出发，沿 related 拓展 2 跳；每跳每个节点取前 5；
// 跨 layer / 跨 scope 都允许（链路本身已表达关联）；
// 跨 user / 跨 tenant 由 storage 接口 tenantId+userId 强制隔离。

import type { Memory } from "./types.js";
import type { Storage } from "./storage.js";

export function spreadActivation(
  storage: Storage,
  tenantId: string,
  userId: string,
  seeds: Memory[],
  includeSensitive: boolean,
): Memory[] {
  const HOPS = 2;
  const PER_NODE = 5;
  const seen = new Map<string, Memory>();
  for (const s of seeds) seen.set(s.id, s);

  let frontier: Memory[] = [...seeds];
  for (let hop = 0; hop < HOPS; hop++) {
    const next: Memory[] = [];
    for (const node of frontier) {
      const relIds = node.related ?? [];
      let take = 0;
      for (const rid of relIds) {
        if (seen.has(rid)) continue;
        const m = storage.findById(tenantId, userId, rid);
        if (!m) continue;
        if (!includeSensitive && m.sensitive) continue;
        seen.set(rid, m);
        next.push(m);
        take++;
        if (take >= PER_NODE) break;
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return Array.from(seen.values());
}
