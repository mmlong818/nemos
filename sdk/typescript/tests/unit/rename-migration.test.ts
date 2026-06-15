// rename-migration.test.ts — mnemos → nemos legacy 表改名迁移

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/storage/schema.js";

function tableExists(db: Database.Database, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1`).get(name) !== undefined;
}

test("legacy mnemos_embeddings → nemos_embeddings，数据保留", () => {
  const db = new Database(":memory:");
  // 模拟旧 DB：建 legacy 表 + 一行数据
  db.exec(`CREATE TABLE mnemos_embeddings (
    record_id TEXT NOT NULL, layer TEXT NOT NULL, tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL, scope TEXT NOT NULL, model_id TEXT NOT NULL,
    dim INTEGER NOT NULL, vector_blob BLOB NOT NULL, PRIMARY KEY (record_id, layer)
  );`);
  db.prepare(
    `INSERT INTO mnemos_embeddings VALUES ('r1','semantic','t','u','global','m',3,?)`,
  ).run(Buffer.from(new Float32Array([1, 2, 3]).buffer));

  applyMigrations(db);

  assert.equal(tableExists(db, "nemos_embeddings"), true, "新表存在");
  assert.equal(tableExists(db, "mnemos_embeddings"), false, "旧表已 rename 掉");
  const row = db.prepare(`SELECT record_id FROM nemos_embeddings WHERE record_id='r1'`).get();
  assert.ok(row, "旧数据保留在新表");
  db.close();
});

test("迁移幂等：全新 DB 直接建 nemos_* 表，无 legacy 不报错", () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  applyMigrations(db); // 再跑一次，幂等
  assert.equal(tableExists(db, "nemos_embeddings"), true);
  assert.equal(tableExists(db, "mnemos_embeddings"), false);
  db.close();
});

test("已迁移 DB 不被二次 rename 破坏（新表已存在则跳过）", () => {
  const db = new Database(":memory:");
  applyMigrations(db); // 建出 nemos_embeddings
  // 人为再造一个 legacy 空表，模拟脏状态：新表已存在 → 不应 rename 覆盖
  db.exec(`CREATE TABLE mnemos_embeddings (record_id TEXT PRIMARY KEY);`);
  applyMigrations(db);
  assert.equal(tableExists(db, "nemos_embeddings"), true, "新表仍在");
  assert.equal(tableExists(db, "mnemos_embeddings"), true, "新表已存在时不动 legacy（避免覆盖）");
  db.close();
});
