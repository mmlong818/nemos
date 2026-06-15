// storage/schema.ts — SQLite DDL + migration（v0.1 → v0.2 → v0.3 幂等迁移）
//
// 五层表 + ingest_queue + embedding 表 + FTS 虚表。
// archival 表通过 trigger 强制 INSERT-only。

import type Database from "better-sqlite3";
import { LAYERS } from "../types.js";

export const COMMON_COLS = `
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
  embedding_model_id TEXT,
  event_at        TEXT,
  sensitive       INTEGER NOT NULL DEFAULT 0,
  scenario        TEXT,
  entities_json   TEXT,
  difficulty      REAL,
  retrievability  REAL,
  last_decay_at   TEXT,
  archival_protected INTEGER NOT NULL DEFAULT 0,
  cold            INTEGER NOT NULL DEFAULT 0,
  cold_at         TEXT,
  consolidated_from_json TEXT,
  consolidated_at TEXT
`;

// v0.2 新增列（用于 migration v0.1 → v0.2）
const V02_NEW_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "event_at", ddl: "ALTER TABLE %TABLE% ADD COLUMN event_at TEXT" },
  {
    name: "sensitive",
    ddl: "ALTER TABLE %TABLE% ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0",
  },
  { name: "scenario", ddl: "ALTER TABLE %TABLE% ADD COLUMN scenario TEXT" },
];

// v0.3 新增列（migration v0.2 → v0.3）
const V03_NEW_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "entities_json", ddl: "ALTER TABLE %TABLE% ADD COLUMN entities_json TEXT" },
];

// v0.4 新增列（migration v0.3 → v0.4）
const V04_NEW_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "difficulty", ddl: "ALTER TABLE %TABLE% ADD COLUMN difficulty REAL" },
  { name: "retrievability", ddl: "ALTER TABLE %TABLE% ADD COLUMN retrievability REAL" },
  { name: "last_decay_at", ddl: "ALTER TABLE %TABLE% ADD COLUMN last_decay_at TEXT" },
  {
    name: "archival_protected",
    ddl: "ALTER TABLE %TABLE% ADD COLUMN archival_protected INTEGER NOT NULL DEFAULT 0",
  },
  { name: "cold", ddl: "ALTER TABLE %TABLE% ADD COLUMN cold INTEGER NOT NULL DEFAULT 0" },
  { name: "cold_at", ddl: "ALTER TABLE %TABLE% ADD COLUMN cold_at TEXT" },
  {
    name: "consolidated_from_json",
    ddl: "ALTER TABLE %TABLE% ADD COLUMN consolidated_from_json TEXT",
  },
  {
    name: "consolidated_at",
    ddl: "ALTER TABLE %TABLE% ADD COLUMN consolidated_at TEXT",
  },
];

const INDEX_DDL = (table: string): string => `
  CREATE INDEX IF NOT EXISTS idx_${table}_tu ON ${table}(tenant_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_${table}_tu_scope ON ${table}(tenant_id, user_id, scope);
  CREATE INDEX IF NOT EXISTS idx_${table}_tu_created ON ${table}(tenant_id, user_id, created_at DESC);
`;

/**
 * 应用所有 schema migration（幂等）。
 * 启动时调用一次。
 */
export function applyMigrations(db: Database.Database): void {
  // 五层表
  for (const layer of LAYERS) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${layer} (${COMMON_COLS});`);
    db.exec(INDEX_DDL(layer));
  }

  // v0.1 → v0.2 migration：补 event_at / sensitive / scenario 列（幂等）
  // v0.2 → v0.3 migration：补 entities_json 列
  for (const layer of LAYERS) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${layer})`).all() as Array<{ name: string }>).map(
        (r) => r.name,
      ),
    );
    for (const col of V02_NEW_COLUMNS) {
      if (!existing.has(col.name)) {
        db.exec(col.ddl.replace("%TABLE%", layer));
      }
    }
    for (const col of V03_NEW_COLUMNS) {
      if (!existing.has(col.name)) {
        db.exec(col.ddl.replace("%TABLE%", layer));
      }
    }
    for (const col of V04_NEW_COLUMNS) {
      if (!existing.has(col.name)) {
        db.exec(col.ddl.replace("%TABLE%", layer));
      }
    }
    // archival 表中已存在的旧 row 需补 archival_protected=1（一次性 backfill，幂等）
    if (layer === "archival") {
      db.exec(`UPDATE archival SET archival_protected = 1 WHERE archival_protected = 0;`);
    }
    // v0.4：cold 索引（加速默认 WHERE cold=0 过滤）
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_cold_${layer} ON ${layer}(tenant_id, user_id, cold);`,
    );
    // v0.4：last_decay_at 条件索引（worker decay-scan 用）
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_decay_${layer} ON ${layer}(tenant_id, user_id, last_decay_at);`,
    );
    // event_at 索引（条件索引：仅非空）
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_event_at_${layer} ON ${layer}(event_at) WHERE event_at IS NOT NULL;`,
    );
    // sensitive 索引（加速默认 WHERE sensitive=0 过滤）
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sensitive_${layer} ON ${layer}(tenant_id, user_id, sensitive);`,
    );
    // v0.3：entities 文本索引（条件：仅非空）
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_entities_${layer} ON ${layer}(entities_json) WHERE entities_json IS NOT NULL;`,
    );
  }

  // archival immutable triggers（spec I3 + day-1 锁定）
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS archival_no_update
    BEFORE UPDATE ON archival
    BEGIN
      SELECT RAISE(ABORT, 'archival is immutable: UPDATE forbidden by mnemos I3');
    END;

    CREATE TRIGGER IF NOT EXISTS archival_no_delete
    BEFORE DELETE ON archival
    BEGIN
      SELECT RAISE(ABORT, 'archival is immutable: DELETE forbidden (use burn() via SDK)');
    END;
  `);

  // FTS5 虚表（每层独立 FTS，便于按 layer 过滤）
  for (const layer of LAYERS) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${layer}_fts USING fts5(
        id UNINDEXED,
        tenant_id UNINDEXED,
        user_id UNINDEXED,
        scope UNINDEXED,
        content,
        tokenize='unicode61'
      );
    `);
  }

  // embedding 单独表（避免污染 5 层 schema；多个 layer 共用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS mnemos_embeddings (
      record_id   TEXT NOT NULL,
      layer       TEXT NOT NULL,
      tenant_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      scope       TEXT NOT NULL,
      model_id    TEXT NOT NULL,
      dim         INTEGER NOT NULL,
      vector_blob BLOB NOT NULL,
      PRIMARY KEY (record_id, layer)
    );
    CREATE INDEX IF NOT EXISTS idx_emb_tu ON mnemos_embeddings(tenant_id, user_id);
  `);

  // v0.3：后台 ingest 队列
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingest_queue (
      id                TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      archival_id       TEXT NOT NULL,
      scope             TEXT NOT NULL,
      content           TEXT NOT NULL,
      scenario_json     TEXT,
      origin_agent      TEXT,
      content_date      TEXT,
      perspectives_json TEXT,
      status            TEXT NOT NULL,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      completed_at      TEXT,
      derived_count     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_iq_status ON ingest_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_iq_tu ON ingest_queue(tenant_id, user_id, status);
  `);

  // v0.3：entity FTS 表（每条 memory 的 entities 拼字符串入 FTS）
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS mnemos_entities_fts USING fts5(
      record_id UNINDEXED,
      layer UNINDEXED,
      tenant_id UNINDEXED,
      user_id UNINDEXED,
      scope UNINDEXED,
      entities,
      tokenize='unicode61'
    );
  `);

  applyV05Migrations(db);
}

/**
 * v0.5：领域轴（RFC 0005）+ 前瞻记忆（RFC 0006）。纯新增表，5 层 schema 不动。
 * GLOBAL 共享层按 (tenant,user) 在运行时 lazy 注入（见 domain-ops），非建表时。
 */
function applyV05Migrations(db: Database.Database): void {
  // 领域：embedding 锚点 + 层级，soft 多归属。prototype 以 BLOB 存。
  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id              TEXT NOT NULL,
      tenant_id       TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      label           TEXT NOT NULL,
      prototype_blob  BLOB,
      prototype_dim   INTEGER,
      parent_id       TEXT,
      level           INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'warm',
      origin          TEXT NOT NULL DEFAULT 'emergent',
      always_on       INTEGER NOT NULL DEFAULT 0,
      load_count      INTEGER NOT NULL DEFAULT 0,
      retrievability  REAL NOT NULL DEFAULT 1.0,
      last_routed_at  TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_domains_tu ON domains(tenant_id, user_id, status);
  `);

  // 记忆↔领域 soft membership。
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_domain (
      tenant_id         TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      memory_id         TEXT NOT NULL,
      domain_id         TEXT NOT NULL,
      membership_weight REAL NOT NULL DEFAULT 1.0,
      is_primary        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, user_id, memory_id, domain_id)
    );
    CREATE INDEX IF NOT EXISTS idx_md_domain ON memory_domain(tenant_id, user_id, domain_id);
    CREATE INDEX IF NOT EXISTS idx_md_memory ON memory_domain(tenant_id, user_id, memory_id);
  `);

  // 领域间亲和度。
  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_affinity (
      tenant_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      domain_a    TEXT NOT NULL,
      domain_b    TEXT NOT NULL,
      affinity    REAL NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, domain_a, domain_b)
    );
  `);

  // 前瞻记忆：独立形态，恒 derived。cue 以 BLOB 存向量，另建 FTS 兜底。
  db.exec(`
    CREATE TABLE IF NOT EXISTS prospective (
      id                  TEXT NOT NULL,
      tenant_id           TEXT NOT NULL,
      user_id             TEXT NOT NULL,
      scope               TEXT NOT NULL,
      domain_ids_json     TEXT NOT NULL,
      cue                 TEXT NOT NULL,
      cue_blob            BLOB,
      cue_dim             INTEGER,
      projection          TEXT NOT NULL,
      confidence          REAL NOT NULL DEFAULT 0.5,
      evidence_refs_json  TEXT NOT NULL,
      prediction_log_json TEXT NOT NULL,
      retrievability      REAL NOT NULL DEFAULT 1.0,
      status              TEXT NOT NULL DEFAULT 'crystallized',
      created_at          TEXT NOT NULL,
      last_accessed       TEXT NOT NULL,
      last_verified_at    TEXT,
      PRIMARY KEY (tenant_id, user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_prosp_tu ON prospective(tenant_id, user_id);
  `);

  // 前瞻 cue 全局通道（不受领域路由约束，RFC 0006）。
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS prospective_cue_fts USING fts5(
      id UNINDEXED,
      tenant_id UNINDEXED,
      user_id UNINDEXED,
      cue,
      tokenize='unicode61'
    );
  `);
}

/**
 * v0.2 hook：探测 sqlite-vec 是否可用 → 切到 SQL ANN。
 * v0.1 不强制 sqlite-vec；如果环境装了，未来 v0.2 切到 SQL ANN。
 * 这里只占位，先返回 false 表示走 JS cosine。
 */
export function tryLoadSqliteVec(db: Database.Database): boolean {
  void db;
  return false;
}
