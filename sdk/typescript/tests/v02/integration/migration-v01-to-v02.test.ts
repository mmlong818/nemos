// migration-v01-to-v02.test.ts —— v0.1 SQLite DB 加载 v0.2 SDK 自动 ALTER TABLE

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Nemos } from "../../../src/index.js";
import { SCHEMA_VERSION } from "../../../src/types.js";
import { makeMockLLMConfig } from "../../helpers.js";

function makeV01Db(path: string): void {
  // 模拟 v0.1 schema（无 event_at / sensitive / scenario 列）
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  const LAYERS = ["archival", "episodic", "semantic", "personal_semantic", "procedural"];
  const V01_COLS = `
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    layer           TEXT NOT NULL,
    type            TEXT NOT NULL,
    scope           TEXT NOT NULL,
    content         TEXT NOT NULL,
    source_json     TEXT NOT NULL,
    arousal_json    TEXT NOT NULL,
    surprise_json   TEXT NOT NULL,
    ownership_json  TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    last_accessed   TEXT NOT NULL,
    access_count    INTEGER NOT NULL DEFAULT 0,
    stability       REAL NOT NULL DEFAULT 1.0,
    schema_version  TEXT NOT NULL,
    archival_ref    TEXT,
    related_json    TEXT,
    corrects_json   TEXT,
    corrected_by_json TEXT,
    supersedes      TEXT,
    wrong_scope     TEXT,
    wrong_behavior  TEXT,
    embedding_model_id TEXT
  `;
  for (const layer of LAYERS) {
    db.exec(`CREATE TABLE ${layer} (${V01_COLS});`);
  }
  // 插入一条 v0.1 archival
  db.prepare(
    `INSERT INTO archival
      (id, tenant_id, user_id, layer, type, scope, content,
       source_json, arousal_json, surprise_json, ownership_json,
       created_at, last_accessed, access_count, stability, schema_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "arch_old01",
    "default",
    "alice",
    "archival",
    "user",
    "global",
    "v0.1 老数据",
    JSON.stringify({ authoritative: true, kind: "authoritative", origin: "user-upload", chain_depth: 0 }),
    JSON.stringify({ value: 0, signal_sources: [] }),
    JSON.stringify({ value: 0, basis: "raw" }),
    JSON.stringify({ kind: "self", consent_status: "implicit" }),
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    0,
    1.0,
    "0.1",
  );
  db.close();
}

test("v0.1 SQLite 加载 v0.2 SDK 自动 ALTER TABLE 加新列", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-mig-"));
  const dbPath = join(dir, "v01.db");
  try {
    makeV01Db(dbPath);

    // 用 v0.2 SDK 打开
    const mem = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false },
    });

    // 检查 schema 已被 ALTER（PRAGMA table_info）
    const raw = mem.raw().storage;
    // 通过私有 db 句柄检查 schema：用 listAll 反查老记录
    const all = await mem.forUser("alice").listByLayer("archival");
    assert.equal(all.length, 1, "v0.1 老 archival 应可读");
    assert.equal(all[0]!.content, "v0.1 老数据");
    assert.equal(all[0]!.schema_version, "0.1", "老记录 schema_version 保留 0.1");
    // 新字段：sensitive 默认 false / event_at undefined / scenario undefined
    assert.notEqual(all[0]!.sensitive, true);
    assert.equal(all[0]!.event_at, undefined);

    // 写新数据 → 应当用当前 SDK 的 schema_version（v0.3 SDK = "0.3"，向上兼容旧 SDK）
    const r = await mem.forUser("alice").ingest("v0.2 新数据", { scenario: "chat" });
    assert.equal(r.archival.schema_version, SCHEMA_VERSION);
    assert.equal(r.archival.scenario, "chat");
    void raw;
    mem.close();

    // 二次打开：migration 幂等（不重复 ALTER）
    const mem2 = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makeMockLLMConfig(),
      features: { doubleCheck: false },
    });
    const all2 = await mem2.forUser("alice").listByLayer("archival");
    assert.ok(all2.length >= 2, "二次开仍可读全部记录");
    mem2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
