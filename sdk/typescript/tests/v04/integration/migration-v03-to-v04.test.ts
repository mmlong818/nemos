// v0.4 migration-v03-to-v04.test.ts
// 验证：v0.3 SQLite 加载 v0.4 SDK → ALTER 幂等 + archival_protected backfill=1 + 旧数据 0 丢失

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Nemos } from "../../../src/index.js";
import { SCHEMA_VERSION, SCHEMA_VERSION_V03 } from "../../../src/types.js";
import { makeMockLLMConfig } from "../../helpers.js";

function makeV03Db(path: string): void {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  const LAYERS = ["archival", "episodic", "semantic", "personal_semantic", "procedural"];
  // v0.3 schema：含 v0.2 字段 + entities_json；无 v0.4 字段
  const V03_COLS = `
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
    entities_json TEXT
  `;
  for (const layer of LAYERS) {
    db.exec(`CREATE TABLE ${layer} (${V03_COLS});`);
  }
  // v0.3 archival 一条
  db.prepare(
    `INSERT INTO archival
      (id, tenant_id, user_id, layer, type, scope, content,
       source_json, arousal_json, surprise_json, ownership_json,
       created_at, last_accessed, access_count, stability, schema_version,
       entities_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "arch_v03",
    "default",
    "alice",
    "archival",
    "user",
    "global",
    "v0.3 老 archival",
    JSON.stringify({ authoritative: true, kind: "authoritative", origin: "user-upload", chain_depth: 0 }),
    JSON.stringify({ value: 0, signal_sources: [] }),
    JSON.stringify({ value: 0, basis: "raw" }),
    JSON.stringify({ kind: "self", consent_status: "implicit" }),
    "2026-05-01T00:00:00.000Z",
    "2026-05-01T00:00:00.000Z",
    0,
    1.0,
    SCHEMA_VERSION_V03,
    null,
  );
  // v0.3 一条 episodic
  db.prepare(
    `INSERT INTO episodic
      (id, tenant_id, user_id, layer, type, scope, content,
       source_json, arousal_json, surprise_json, ownership_json,
       created_at, last_accessed, access_count, stability, schema_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "ep_v03",
    "default",
    "alice",
    "episodic",
    "user",
    "global",
    "v0.3 老 episodic",
    JSON.stringify({ authoritative: false, kind: "derived", origin: "llm-extract", chain_depth: 1 }),
    JSON.stringify({ value: 0.3, signal_sources: [] }),
    JSON.stringify({ value: 0.2, basis: "x" }),
    JSON.stringify({ kind: "self", consent_status: "implicit" }),
    "2026-05-02T00:00:00.000Z",
    "2026-05-02T00:00:00.000Z",
    0,
    1.0,
    SCHEMA_VERSION_V03,
  );
  db.close();
}

test("v0.4: v0.3 SQLite 加载 v0.4 SDK → ALTER + archival_protected backfill 幂等", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-mig04-"));
  const dbPath = join(dir, "v03.db");
  try {
    makeV03Db(dbPath);

    const mem = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false },
      worker: { manualWorker: true },
    });
    const u = mem.forUser("alice");

    // 老 archival 仍可读 + archival_protected 已 backfill 为 true
    const arch = await u.listByLayer("archival");
    assert.equal(arch.length, 1);
    assert.equal(arch[0]!.content, "v0.3 老 archival");
    assert.equal(arch[0]!.schema_version, SCHEMA_VERSION_V03, "老记录 schema_version 保留");
    assert.equal(arch[0]!.archival_protected, true, "archival_protected backfill=true");

    // 老 episodic 仍可读 + v0.4 字段为 undefined
    const eps = await u.listByLayer("episodic");
    assert.equal(eps.length, 1);
    assert.equal(eps[0]!.cold, undefined);
    assert.equal(eps[0]!.consolidated_from, undefined);
    assert.equal(eps[0]!.retrievability, undefined);

    // 写新数据 → schema_version=v0.4 + archival_protected=true
    const r = await u.ingest("v0.4 新数据");
    assert.equal(r.archival.schema_version, SCHEMA_VERSION);
    assert.equal(r.archival.archival_protected, true);

    mem.close();

    // 二次打开：migration 幂等
    const mem2 = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false },
      worker: { manualWorker: true },
    });
    const all = await mem2.forUser("alice").listByLayer("archival");
    assert.ok(all.length >= 2, "二次开仍可读全部 archival 记录");
    for (const a of all) {
      assert.equal(a.archival_protected, true, "所有 archival backfill 后都 protected");
    }
    mem2.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows: WAL/SHM 文件偶发被锁；不阻塞测试
    }
  }
});

test("v0.4: v0.3 db 中老 archival 永远不会被 decay scan 列出", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-mig04-2-"));
  const dbPath = join(dir, "v03.db");
  try {
    makeV03Db(dbPath);
    const mem = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false, decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99 } },
      worker: { manualWorker: true },
    });
    const u = mem.forUser("alice");
    // 跑 100 年后的 decay
    await u.runDecayScan(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
    const arch = await u.listByLayer("archival");
    for (const a of arch) {
      assert.notEqual(a.cold, true, "老 archival 永远不会 cold");
    }
    mem.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows: WAL/SHM 文件偶发被锁；不阻塞测试
    }
  }
});
