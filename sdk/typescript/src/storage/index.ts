// storage/index.ts — 公开 re-export + makeStorage factory
//
// 外部仍可以 import { Storage, SqliteStorage, InMemoryStorage, IngestQueueRow,
// SearchFilter, makeStorage } from "../storage.js"（top-level shim）或直接
// from "../storage/index.js"。

import { SqliteStorage } from "./sqlite-impl.js";
import { InMemoryStorage } from "./memory-impl.js";
import type { Storage } from "./types.js";

export type { Storage, IngestQueueRow, SearchFilter } from "./types.js";
export { SqliteStorage } from "./sqlite-impl.js";
export { InMemoryStorage } from "./memory-impl.js";

export function makeStorage(
  config: { type: "sqlite"; path: string } | { type: "memory" },
): Storage {
  if (config.type === "memory") return new InMemoryStorage();
  return new SqliteStorage(config.path);
}
