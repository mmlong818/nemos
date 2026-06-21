// v0.6 migration-v05-to-v06.test.ts (RFC 0007)
// 验证：v0.5 SQLite 加载 v0.6 SDK → 双时间字段 ALTER 幂等 + valid_at/belief_state backfill
//       + 被 supersedes 指向的旧记录回填 superseded；archival 不参与双时间且永不被 UPDATE。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Nemos } from "../../../src/index.js";
import { SCHEMA_VERSION, SCHEMA_VERSION_V05, type Memory } from "../../../src/types.js";
import { SqliteStorage } from "../../../src/storage/sqlite-impl.js";
import { makeMockLLMConfig } from "../../helpers.js";

// v0.5 的 5 层表 schema：v0.3 字段 + v0.4 FSRS/reflect 列；无 v0.6 双时间列。
const V05_COLS = `
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  source_json TEXT NOT NULL,
  arousal_json TEXT NOT NULL,
  surprise_json TEXT NOT NULL,
  ownership_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  stability REAL NOT NULL DEFAULT 1.0,
  schema_version TEXT NOT NULL,
  archival_ref TEXT,
  related_json TEXT,
  corrects_json TEXT,
  corrected_by_json TEXT,
  supersedes TEXT,
  wrong_scope TEXT,
  wrong_behavior TEXT,
  embedding_model_id TEXT,
  event_at TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  scenario TEXT,
  entities_json TEXT,
  difficulty REAL,
  retrievability REAL,
  last_decay_at TEXT,
  archival_protected INTEGER NOT NULL DEFAULT 0,
  cold INTEGER NOT NULL DEFAULT 0,
  cold_at TEXT,
  consolidated_from_json TEXT,
  consolidated_at TEXT
`;

const SRC_DERIVED = JSON.stringify({
  authoritative: false,
  kind: "derived",
  origin: "llm-extract",
  chain_depth: 1,
});
const SRC_AUTH = JSON.stringify({
  authoritative: true,
  kind: "authoritative",
  origin: "user-upload",
  chain_depth: 0,
});
const AROUSAL = JSON.stringify({ value: 0.2, signal_sources: [] });
const SURPRISE = JSON.stringify({ value: 0.2, basis: "x" });
const OWN = JSON.stringify({ kind: "self", consent_status: "implicit" });

function insertV05(
  db: Database.Database,
  layer: string,
  id: string,
  createdAt: string,
  extra: { supersedes?: string; source?: string } = {},
): void {
  db.prepare(
    `INSERT INTO ${layer}
      (id, tenant_id, user_id, layer, type, scope, content,
       source_json, arousal_json, surprise_json, ownership_json,
       created_at, last_accessed, access_count, stability, schema_version, supersedes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    "default",
    "alice",
    layer,
    layer === "archival" ? "user" : "project",
    "global",
    `${id} 内容`,
    extra.source ?? SRC_DERIVED,
    AROUSAL,
    SURPRISE,
    OWN,
    createdAt,
    createdAt,
    0,
    1.0,
    SCHEMA_VERSION_V05,
    extra.supersedes ?? null,
  );
}

function makeV05Db(path: string): void {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  for (const layer of ["archival", "episodic", "semantic", "personal_semantic", "procedural"]) {
    db.exec(`CREATE TABLE ${layer} (${V05_COLS});`);
  }
  // 老 archival（不参与双时间）
  insertV05(db, "archival", "arch_v05", "2026-05-01T00:00:00.000Z", { source: SRC_AUTH });
  // 独立 derived（无 supersede）
  insertV05(db, "semantic", "sem_solo", "2026-05-02T00:00:00.000Z");
  // supersede 对：sem_new 取代 sem_old
  insertV05(db, "semantic", "sem_old", "2026-05-03T00:00:00.000Z");
  insertV05(db, "semantic", "sem_new", "2026-05-10T00:00:00.000Z", { supersedes: "sem_old" });
  db.close();
}

test("v0.6: v0.5 SQLite 加载 v0.6 SDK → 双时间 backfill + supersede 回填 + 幂等", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-mig06-"));
  const dbPath = join(dir, "v05.db");
  try {
    makeV05Db(dbPath);

    const mem = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false },
      worker: { manualWorker: true },
    });
    const u = mem.forUser("alice");

    // 独立 derived：valid_at backfill=created_at；belief_state 缺省（active）→ undefined
    const sem = await u.listByLayer("semantic");
    const solo = sem.find((m) => m.id === "sem_solo")!;
    assert.ok(solo, "sem_solo 可读");
    assert.equal(solo.valid_at, "2026-05-02T00:00:00.000Z", "valid_at 回填为 created_at");
    assert.equal(solo.belief_state, undefined, "active 缺省不回填对象");
    assert.equal(solo.invalid_at, undefined);
    assert.equal(solo.expired_at, undefined);

    // 被 supersede 的旧记录 → superseded + expired_at=后继.created_at
    const old = sem.find((m) => m.id === "sem_old")!;
    assert.equal(old.belief_state, "superseded", "被取代旧记录回填 superseded");
    assert.equal(old.expired_at, "2026-05-10T00:00:00.000Z", "expired_at=后继 created_at");
    assert.equal(old.valid_at, "2026-05-03T00:00:00.000Z", "valid_at 仍回填 created_at");

    // 后继本身仍 active
    const neu = sem.find((m) => m.id === "sem_new")!;
    assert.equal(neu.belief_state, undefined, "后继 active");
    assert.equal(neu.expired_at, undefined);

    // archival 不参与双时间：valid_at 未回填（NULL→undefined），belief_state 缺省
    const arch = await u.listByLayer("archival");
    assert.equal(arch[0]!.valid_at, undefined, "archival 不回填 valid_at");
    assert.equal(arch[0]!.belief_state, undefined);
    assert.equal(arch[0]!.archival_protected, true);

    // 写新 derived → schema_version=0.6 + valid_at 默认=created_at + active
    const r = await u.ingest("今天确定了发布日期");
    assert.equal(r.archival.schema_version, SCHEMA_VERSION);
    for (const d of r.derived) {
      assert.equal(d.valid_at, d.created_at, "新 derived valid_at 默认=created_at");
      assert.equal(d.belief_state, undefined, "新 derived 默认 active");
    }
    // 新 archival 不带 valid_at
    assert.equal(r.archival.valid_at, undefined, "新 archival 不写 valid_at");

    mem.close();

    // 二次打开：migration 幂等，superseded 不被 valid_at backfill 改回 active
    const mem2 = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false },
      worker: { manualWorker: true },
    });
    const sem2 = await mem2.forUser("alice").listByLayer("semantic");
    assert.equal(sem2.find((m) => m.id === "sem_old")!.belief_state, "superseded", "幂等：仍 superseded");
    mem2.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows: WAL/SHM 偶发被锁
    }
  }
});

test("v0.6: 双时间字段写入→读出 round-trip（invalid_at / expired_at / belief_state）", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-rt06-"));
  const dbPath = join(dir, "rt.db");
  try {
    const store = new SqliteStorage(dbPath);
    const base: Memory = {
      id: "m_invalidated",
      layer: "semantic",
      type: "project",
      content: "他在 A 公司任职",
      scope: "global",
      source: { authoritative: false, kind: "derived", origin: "llm-extract", chain_depth: 1 },
      arousal: { value: 0.2, signal_sources: [] },
      surprise: { value: 0.2, basis: "x" },
      ownership: { kind: "public" },
      created_at: "2023-01-01T00:00:00.000Z",
      last_accessed: "2023-01-01T00:00:00.000Z",
      access_count: 0,
      stability: 1.0,
      schema_version: SCHEMA_VERSION,
      valid_at: "2020-06-01T00:00:00.000Z",
      invalid_at: "2023-03-01T00:00:00.000Z",
      expired_at: "2026-06-18T00:00:00.000Z",
      belief_state: "invalidated",
    };
    store.insert("default", "alice", base);
    const got = store.get("default", "alice", "semantic", "m_invalidated")!;
    assert.equal(got.valid_at, "2020-06-01T00:00:00.000Z");
    assert.equal(got.invalid_at, "2023-03-01T00:00:00.000Z");
    assert.equal(got.expired_at, "2026-06-18T00:00:00.000Z");
    assert.equal(got.belief_state, "invalidated");
    store.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows: WAL/SHM 偶发被锁
    }
  }
});
