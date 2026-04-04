import { getDb } from "./db/sqlite.js";

/** Internal cache key: query + optional ISO2 country (avoids collisions without DB migration). */
export function targetingSearchCacheKey(searchQ, countryCode) {
  const q = String(searchQ || "").trim();
  const c = String(countryCode || "")
    .trim()
    .toUpperCase();
  if (!c || !/^[A-Z]{2}$/.test(c)) return q;
  return `${q}\u0001${c}`;
}

/**
 * Cache Graph targetingsearch rows for offline/mock reads and deduped history.
 */
export function upsertTargetingCatalogRows(rows, searchType, searchQ, countryCode) {
  if (!Array.isArray(rows) || !rows.length) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO meta_targeting_catalog (meta_id, search_type, name, audience_size, path_json, item_type, search_q, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(meta_id, search_type) DO UPDATE SET
       name = excluded.name,
       audience_size = excluded.audience_size,
       path_json = excluded.path_json,
       item_type = excluded.item_type,
       search_q = excluded.search_q,
       fetched_at = datetime('now')`
  );
  const q = targetingSearchCacheKey(searchQ, countryCode);
  for (const r of rows) {
    const id = r.id != null ? String(r.id) : "";
    if (!id) continue;
    stmt.run(
      id,
      String(searchType || ""),
      r.name || "",
      r.audience_size != null ? Math.round(Number(r.audience_size)) : null,
      JSON.stringify(Array.isArray(r.path) ? r.path : []),
      r.type || "",
      q
    );
  }
}

export function listCachedTargetingSearch(searchType, searchQ, limit = 25, countryCode) {
  const db = getDb();
  const qKey = targetingSearchCacheKey(searchQ, countryCode);
  const rows = db
    .prepare(
      `SELECT meta_id, name, audience_size, path_json, item_type, search_q, fetched_at
       FROM meta_targeting_catalog
       WHERE search_type = ? AND search_q = ?
       ORDER BY fetched_at DESC
       LIMIT ?`
    )
    .all(String(searchType || ""), qKey, Math.min(100, Math.max(1, Number(limit) || 25)));
  return rows.map((row) => ({
    id: row.meta_id,
    name: row.name || "",
    type: row.item_type || String(searchType || ""),
    audience_size: row.audience_size != null ? Number(row.audience_size) : null,
    path: safeParsePath(row.path_json),
    search_q: row.search_q,
    fetched_at: row.fetched_at,
  }));
}

function safeParsePath(raw) {
  try {
    const p = JSON.parse(raw || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
