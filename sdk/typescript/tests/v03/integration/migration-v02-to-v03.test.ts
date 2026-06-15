// migration-v02-to-v03.test.ts — v0.2 SQLite 加载 v0.3 SDK：旧数据 0 丢失 + 新列默认 NULL

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Nemos } from "../../../src/index.js";
import { SCHEMA_VERSION, SCHEMA_VERSION_V02 } from "../../../src/types.js";
import { makePerspectiveMockLLMConfig } from "../../helpers.js";

function makeV02Db(path: string): void {
  // 模拟 v0.2 schema（含 event_at / sensitive / scenario，但无 entities_json，无 ingest_queue）
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  const LAYERS = ["archival", "episodic", "semantic", "personal_semantic", "procedural"];
  const V02_COLS = `
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
    scenario TEXT
  `;
  for (const layer of LAYERS) {
    db.exec(`CREATE TABLE ${layer} (${V02_COLS});`);
  }
  // 插入一条 v0.2 archival（带 scenario / sensitive）
  db.prepare(
    `INSERT INTO archival
      (id, tenant_id, user_id, layer, type, scope, content,
       source_json, arousal_json, surprise_json, ownership_json,
       created_at, last_accessed, access_count, stability, schema_version,
       event_at, sensitive, scenario)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "arch_v02",
    "default",
    "alice",
    "archival",
    "user",
    "global",
    "v0.2 老数据（diary）",
    JSON.stringify({ authoritative: true, kind: "authoritative", origin: "user-upload", chain_depth: 0 }),
    JSON.stringify({ value: 0, signal_sources: [] }),
    JSON.stringify({ value: 0, basis: "raw" }),
    JSON.stringify({ kind: "self", consent_status: "implicit" }),
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
    0,
    1.0,
    SCHEMA_VERSION_V02,
    "2026-04-01",
    1,
    "diary",
  );
  db.close();
}

test("v0.2 SQLite 加载 v0.3 SDK 自动 ALTER + ingest_queue 新建", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-mig03-"));
  const dbPath = join(dir, "v02.db");
  try {
    makeV02Db(dbPath);

    // 用 v0.3 SDK 打开
    const mem = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makePerspectiveMockLLMConfig(),
      features: { doubleCheck: false },
      worker: { manualWorker: true },
    });

    // 老 archival 仍可读，字段保留
    const all = await mem.forUser("alice").listByLayer("archival");
    assert.equal(all.length, 1);
    const old = all[0]!;
    assert.equal(old.content, "v0.2 老数据（diary）");
    assert.equal(old.schema_version, SCHEMA_VERSION_V02, "老记录 schema_version 仍是 0.2");
    assert.equal(old.scenario, "diary");
    assert.equal(old.sensitive, true);
    assert.equal(old.event_at, "2026-04-01");
    // v0.3 新字段：entities 默认 undefined
    assert.equal(old.entities, undefined);

    // 写新数据 → schema_version = 当前 SDK
    const r = await mem.forUser("alice").ingest("v0.3 新数据");
    assert.equal(r.archival.schema_version, SCHEMA_VERSION);

    // ingest_queue 表已建：background ingest 入队不报错
    const handle = await mem.forUser("alice").ingest("background bg", { background: true });
    assert.equal(handle.status, "queued");
    mem.close();

    // 二次打开：migration 幂等
    const mem2 = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makePerspectiveMockLLMConfig(),
      features: { doubleCheck: false },
      worker: { manualWorker: true },
    });
    const all2 = await mem2.forUser("alice").listByLayer("archival");
    assert.ok(all2.length >= 3, "二次开仍可读全部记录");
    mem2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
