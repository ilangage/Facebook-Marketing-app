/**
 * Durable engine state using Node.js built-in SQLite (node:sqlite).
 * Path: ENGINE_DB_PATH or data/bot-engine.db
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DEFAULT_DB = path.join(DATA_DIR, "bot-engine.db");

let dbInstance = null;

export function getDbPath() {
  return process.env.ENGINE_DB_PATH || DEFAULT_DB;
}

export function getDb() {
  if (dbInstance) return dbInstance;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec("PRAGMA journal_mode = WAL;");
  dbInstance.exec("PRAGMA foreign_keys = ON;");
  runMigrations(dbInstance);
  return dbInstance;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    );
  `);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version)
  );
  const migrations = [
    {
      version: 1,
      sql: `
        CREATE TABLE IF NOT EXISTS engine_funnel (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          view_content INTEGER DEFAULT 0,
          lead_count INTEGER DEFAULT 0,
          qualified INTEGER DEFAULT 0,
          booking INTEGER DEFAULT 0
        );
        INSERT OR IGNORE INTO engine_funnel (id) VALUES (1);
        CREATE TABLE IF NOT EXISTS engine_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          tracking_health REAL DEFAULT 0.85
        );
        INSERT OR IGNORE INTO engine_settings (id) VALUES (1);
        CREATE TABLE IF NOT EXISTS engine_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_json TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS engine_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          decision_json TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS engine_crm_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_json TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS engine_meta_campaigns (
          campaign_name TEXT NOT NULL,
          adset_name TEXT NOT NULL,
          meta_campaign_id TEXT,
          meta_adset_id TEXT,
          meta_ad_id TEXT,
          meta_creative_id TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (campaign_name, adset_name)
        );
        CREATE TABLE IF NOT EXISTS engine_performance (
          meta_adset_id TEXT PRIMARY KEY,
          meta_campaign_id TEXT,
          campaign_name TEXT,
          adset_name TEXT,
          spend REAL DEFAULT 0,
          clicks INTEGER DEFAULT 0,
          impressions INTEGER DEFAULT 0,
          leads INTEGER DEFAULT 0,
          qualified_leads INTEGER DEFAULT 0,
          bookings INTEGER DEFAULT 0,
          revenue REAL DEFAULT 0,
          cogs REAL DEFAULT 0,
          currency TEXT DEFAULT 'USD',
          updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS engine_revenue_events (
          order_id TEXT PRIMARY KEY,
          event_json TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS engine_crm_quality (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_json TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS engine_capi_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT,
          event_name TEXT,
          pixel_id TEXT,
          http_status INTEGER,
          response_json TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS engine_scale_history (
          meta_adset_id TEXT PRIMARY KEY,
          last_scaled_at TEXT NOT NULL,
          last_budget_minor INTEGER
        );
        CREATE TABLE IF NOT EXISTS engine_audience_sync (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          segment TEXT,
          audience_id TEXT,
          matched_users INTEGER,
          detail_json TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `,
    },
    {
      version: 2,
      sql: `
        CREATE TABLE IF NOT EXISTS meta_targeting_catalog (
          meta_id TEXT NOT NULL,
          search_type TEXT NOT NULL,
          name TEXT,
          audience_size INTEGER,
          path_json TEXT,
          item_type TEXT,
          search_q TEXT,
          fetched_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (meta_id, search_type)
        );
        CREATE INDEX IF NOT EXISTS idx_meta_targeting_catalog_lookup
          ON meta_targeting_catalog (search_type, search_q);
      `,
    },
  ];
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(m.version);
  }
}

export function logCapiResult(db, { eventId, eventName, pixelId, httpStatus, responseJson }) {
  db.prepare(
    `INSERT INTO engine_capi_log (event_id, event_name, pixel_id, http_status, response_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(eventId || "", eventName || "", pixelId || "", httpStatus ?? 0, responseJson || "");
}

export function listCapiLog(db, limit = 40) {
  return db
    .prepare(
      `SELECT id, event_id, event_name, pixel_id, http_status, response_json, created_at
       FROM engine_capi_log ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
}
