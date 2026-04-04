import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { state, nextId } from "./state.js";
import { getDb } from "./db/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const LEGACY_JSON = path.join(DATA_DIR, "bot-state.json");

const defaultPersisted = () => ({
  jobs: [],
  decisions: [],
  crmLog: [],
  funnel: {
    viewContent: 0,
    lead: 0,
    qualified: 0,
    booking: 0,
  },
  trackingHealth: 0.85,
  metaCampaigns: [],
  revenueEvents: [],
  crmQualityEvents: [],
  performanceByAdset: {},
});

export let persisted = defaultPersisted();

function loadPersistedFromDb() {
  const db = getDb();
  const funnel = db.prepare("SELECT * FROM engine_funnel WHERE id = 1").get();
  const settings = db.prepare("SELECT * FROM engine_settings WHERE id = 1").get();
  const jobs = db
    .prepare("SELECT job_json FROM engine_jobs ORDER BY id DESC LIMIT 200")
    .all()
    .map((r) => JSON.parse(r.job_json));
  const decisions = db
    .prepare("SELECT decision_json FROM engine_decisions ORDER BY id DESC LIMIT 300")
    .all()
    .map((r) => JSON.parse(r.decision_json));
  const crmLog = db
    .prepare("SELECT log_json FROM engine_crm_log ORDER BY id DESC LIMIT 500")
    .all()
    .map((r) => JSON.parse(r.log_json));
  const metaCampaigns = db
    .prepare(
      `SELECT campaign_name, adset_name, meta_campaign_id, meta_adset_id, meta_ad_id, meta_creative_id, updated_at
       FROM engine_meta_campaigns ORDER BY updated_at DESC LIMIT 100`
    )
    .all()
    .map((r) => ({
      campaignName: r.campaign_name,
      adsetName: r.adset_name,
      metaCampaignId: r.meta_campaign_id || "",
      metaAdsetId: r.meta_adset_id || "",
      metaAdId: r.meta_ad_id || "",
      metaCreativeId: r.meta_creative_id || "",
      updatedAt: r.updated_at,
    }));
  const perfRows = db.prepare("SELECT * FROM engine_performance").all();
  const performanceByAdset = {};
  for (const r of perfRows) {
    performanceByAdset[r.meta_adset_id] = {
      metaAdsetId: r.meta_adset_id,
      metaCampaignId: r.meta_campaign_id || "",
      campaignName: r.campaign_name || "",
      adsetName: r.adset_name || "",
      spend: r.spend,
      clicks: r.clicks,
      impressions: r.impressions,
      leads: r.leads,
      qualifiedLeads: r.qualified_leads,
      bookings: r.bookings,
      revenue: r.revenue,
      cogs: r.cogs ?? 0,
      currency: r.currency || "USD",
      updatedAt: r.updated_at,
    };
  }
  const revenueEvents = db
    .prepare("SELECT event_json FROM engine_revenue_events ORDER BY rowid DESC LIMIT 1000")
    .all()
    .map((r) => JSON.parse(r.event_json));
  const crmQualityEvents = db
    .prepare("SELECT event_json FROM engine_crm_quality ORDER BY id DESC LIMIT 3000")
    .all()
    .map((r) => JSON.parse(r.event_json));

  return {
    jobs,
    decisions,
    crmLog,
    funnel: funnel
      ? {
          viewContent: funnel.view_content,
          lead: funnel.lead_count,
          qualified: funnel.qualified,
          booking: funnel.booking,
        }
      : defaultPersisted().funnel,
    trackingHealth: settings?.tracking_health ?? 0.85,
    metaCampaigns,
    revenueEvents,
    crmQualityEvents,
    performanceByAdset,
  };
}

function trimJobs(db) {
  db.exec(`
    DELETE FROM engine_jobs WHERE id NOT IN (
      SELECT id FROM engine_jobs ORDER BY id DESC LIMIT 200
    );
  `);
}

function trimDecisions(db) {
  db.exec(`
    DELETE FROM engine_decisions WHERE id NOT IN (
      SELECT id FROM engine_decisions ORDER BY id DESC LIMIT 300
    );
  `);
}

function trimCrmLog(db) {
  db.exec(`
    DELETE FROM engine_crm_log WHERE id NOT IN (
      SELECT id FROM engine_crm_log ORDER BY id DESC LIMIT 500
    );
  `);
}

function trimCrmQuality(db) {
  db.exec(`
    DELETE FROM engine_crm_quality WHERE id NOT IN (
      SELECT id FROM engine_crm_quality ORDER BY id DESC LIMIT 3000
    );
  `);
}

async function migrateLegacyJsonIfNeeded() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM engine_jobs) AS j,
        (SELECT COUNT(*) FROM engine_revenue_events) AS r,
        (SELECT COUNT(*) FROM engine_meta_campaigns) AS m`
    )
    .get();
  if (row.j + row.r + row.m > 0) return;
  let raw;
  try {
    raw = await fs.readFile(LEGACY_JSON, "utf8");
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const p = { ...defaultPersisted(), ...parsed };
  if (!p.funnel) p.funnel = defaultPersisted().funnel;
  db.prepare(
    `UPDATE engine_funnel SET view_content=?, lead_count=?, qualified=?, booking=? WHERE id=1`
  ).run(
    Number(p.funnel.viewContent || 0),
    Number(p.funnel.lead || 0),
    Number(p.funnel.qualified || 0),
    Number(p.funnel.booking || 0)
  );
  db.prepare(`UPDATE engine_settings SET tracking_health=? WHERE id=1`).run(
    Number(p.trackingHealth ?? 0.85)
  );
  for (const j of (p.jobs || []).slice(0, 200)) {
    db.prepare(`INSERT INTO engine_jobs (job_json) VALUES (?)`).run(JSON.stringify(j));
  }
  for (const d of (p.decisions || []).slice(0, 300)) {
    db.prepare(`INSERT INTO engine_decisions (decision_json) VALUES (?)`).run(JSON.stringify(d));
  }
  for (const c of (p.crmLog || []).slice(0, 500)) {
    db.prepare(`INSERT INTO engine_crm_log (log_json) VALUES (?)`).run(JSON.stringify(c));
  }
  for (const m of (p.metaCampaigns || []).slice(0, 100)) {
    db.prepare(
      `INSERT OR REPLACE INTO engine_meta_campaigns
       (campaign_name, adset_name, meta_campaign_id, meta_adset_id, meta_ad_id, meta_creative_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      m.campaignName,
      m.adsetName,
      m.metaCampaignId || "",
      m.metaAdsetId || "",
      m.metaAdId || "",
      m.metaCreativeId || "",
      m.updatedAt || new Date().toISOString()
    );
  }
  const perf = p.performanceByAdset || {};
  for (const key of Object.keys(perf)) {
    const x = perf[key];
    db.prepare(
      `INSERT OR REPLACE INTO engine_performance
       (meta_adset_id, meta_campaign_id, campaign_name, adset_name, spend, clicks, impressions,
        leads, qualified_leads, bookings, revenue, cogs, currency, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      key,
      x.metaCampaignId || "",
      x.campaignName || "",
      x.adsetName || "",
      Number(x.spend || 0),
      Number(x.clicks || 0),
      Number(x.impressions || 0),
      Number(x.leads || 0),
      Number(x.qualifiedLeads || 0),
      Number(x.bookings || 0),
      Number(x.revenue || 0),
      Number(x.cogs || 0),
      x.currency || "USD",
      x.updatedAt || new Date().toISOString()
    );
  }
  for (const ev of (p.revenueEvents || []).slice(0, 1000)) {
    db.prepare(`INSERT OR REPLACE INTO engine_revenue_events (order_id, event_json) VALUES (?, ?)`).run(
      ev.orderId,
      JSON.stringify(ev)
    );
  }
  for (const ev of (p.crmQualityEvents || []).slice(0, 3000)) {
    db.prepare(`INSERT INTO engine_crm_quality (event_json) VALUES (?)`).run(JSON.stringify(ev));
  }
}

export async function initEngineStore() {
  getDb();
  await migrateLegacyJsonIfNeeded();
  persisted = loadPersistedFromDb();
}

/** @deprecated kept for compatibility — state is persisted per-operation */
export async function saveEngineState() {
  persisted = loadPersistedFromDb();
}

export function findCompletedJobByIdempotencyKey(key) {
  if (!key || typeof key !== "string") return null;
  return persisted.jobs.find((j) => j.idempotencyKey === key && j.status === "done") || null;
}

export async function pushJob(job) {
  const db = getDb();
  if (job.idempotencyKey && job.status === "done") {
    const dup = findCompletedJobByIdempotencyKey(job.idempotencyKey);
    if (dup) return dup;
  }
  db.prepare(`INSERT INTO engine_jobs (job_json) VALUES (?)`).run(JSON.stringify(job));
  trimJobs(db);
  persisted = loadPersistedFromDb();
  return job;
}

export async function pushDecision(entry) {
  const db = getDb();
  db.prepare(`INSERT INTO engine_decisions (decision_json) VALUES (?)`).run(JSON.stringify(entry));
  trimDecisions(db);
  persisted = loadPersistedFromDb();
}

export async function appendCrmLog(entry) {
  const db = getDb();
  db.prepare(`INSERT INTO engine_crm_log (log_json) VALUES (?)`).run(
    JSON.stringify({ ...entry, at: new Date().toISOString() })
  );
  trimCrmLog(db);
  persisted = loadPersistedFromDb();
}

export async function bumpFunnel(eventName) {
  const db = getDb();
  const e = String(eventName || "").toLowerCase();
  if (e.includes("view") || e === "viewcontent") {
    db.prepare(`UPDATE engine_funnel SET view_content = view_content + 1 WHERE id = 1`).run();
  }
  if (e.includes("lead")) {
    db.prepare(`UPDATE engine_funnel SET lead_count = lead_count + 1 WHERE id = 1`).run();
  }
  if (e.includes("qualified")) {
    db.prepare(`UPDATE engine_funnel SET qualified = qualified + 1 WHERE id = 1`).run();
  }
  if (e.includes("purchase") || e.includes("booking") || e === "deal.won") {
    db.prepare(`UPDATE engine_funnel SET booking = booking + 1 WHERE id = 1`).run();
  }
  persisted = loadPersistedFromDb();
}

/**
 * Persist Meta object IDs for reconciliation + live optimizer.
 */
export async function upsertMetaCampaignRecord(record) {
  const {
    campaignName,
    adsetName,
    metaCampaignId,
    metaAdsetId,
    metaAdId,
    metaCreativeId,
  } = record;
  if (!campaignName || !adsetName) return;
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO engine_meta_campaigns
     (campaign_name, adset_name, meta_campaign_id, meta_adset_id, meta_ad_id, meta_creative_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    campaignName,
    adsetName,
    metaCampaignId || "",
    metaAdsetId || "",
    metaAdId || "",
    metaCreativeId || "",
    new Date().toISOString()
  );
  persisted = loadPersistedFromDb();
}

function ensurePerfRow(db, metaAdsetId, fallback = {}) {
  const key = String(metaAdsetId || "");
  if (!key) return null;
  const existing = db.prepare(`SELECT * FROM engine_performance WHERE meta_adset_id = ?`).get(key);
  if (!existing) {
    db.prepare(
      `INSERT INTO engine_performance
       (meta_adset_id, meta_campaign_id, campaign_name, adset_name, spend, clicks, impressions,
        leads, qualified_leads, bookings, revenue, cogs, currency, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`
    ).run(
      key,
      fallback.metaCampaignId || "",
      fallback.campaignName || "",
      fallback.adsetName || "",
      fallback.currency || "USD",
      new Date().toISOString()
    );
  }
  return db.prepare(`SELECT * FROM engine_performance WHERE meta_adset_id = ?`).get(key);
}

export async function upsertPerformanceSample(sample) {
  const db = getDb();
  const row = ensurePerfRow(db, sample.metaAdsetId, sample);
  if (!row) return null;
  const spend = sample.spend != null ? Number(sample.spend) || 0 : row.spend;
  const clicks = sample.clicks != null ? Number(sample.clicks) || 0 : row.clicks;
  const impressions = sample.impressions != null ? Number(sample.impressions) || 0 : row.impressions;
  const leads = sample.leads != null ? Number(sample.leads) || 0 : row.leads;
  const qualifiedLeads =
    sample.qualifiedLeads != null ? Number(sample.qualifiedLeads) || 0 : row.qualified_leads;
  const bookings = sample.bookings != null ? Number(sample.bookings) || 0 : row.bookings;
  const revenue = sample.revenue != null ? Number(sample.revenue) || 0 : row.revenue;
  const cogs = sample.cogs != null ? Number(sample.cogs) || 0 : row.cogs;
  const metaCampaignId = sample.metaCampaignId != null ? sample.metaCampaignId : row.meta_campaign_id;
  const campaignName = sample.campaignName != null ? sample.campaignName : row.campaign_name;
  const adsetName = sample.adsetName != null ? sample.adsetName : row.adset_name;
  const currency = sample.currency || row.currency || "USD";
  db.prepare(
    `UPDATE engine_performance SET
      meta_campaign_id = ?, campaign_name = ?, adset_name = ?,
      spend = ?, clicks = ?, impressions = ?, leads = ?, qualified_leads = ?, bookings = ?, revenue = ?, cogs = ?, currency = ?, updated_at = ?
     WHERE meta_adset_id = ?`
  ).run(
    metaCampaignId || "",
    campaignName || "",
    adsetName || "",
    spend,
    clicks,
    impressions,
    leads,
    qualifiedLeads,
    bookings,
    revenue,
    cogs,
    currency,
    new Date().toISOString(),
    row.meta_adset_id
  );
  persisted = loadPersistedFromDb();
  return persisted.performanceByAdset[row.meta_adset_id];
}

export async function recordRevenueEvent(event) {
  const orderId = String(event.orderId || "").trim();
  if (!orderId) {
    throw new Error("orderId is required");
  }
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM engine_revenue_events WHERE order_id = ?`).get(orderId);
  if (exists) {
    return { duplicate: true };
  }
  const revenue = Number(event.revenue || 0);
  if (!(revenue > 0)) {
    throw new Error("revenue must be > 0");
  }
  const cogs = Number(event.cogs || 0);
  const row = ensurePerfRow(db, event.metaAdsetId, event);
  if (!row) throw new Error("metaAdsetId is required");
  const newRevenue = Number(row.revenue || 0) + revenue;
  const newCogs = Number(row.cogs || 0) + cogs;
  const newBookings = Number(row.bookings || 0) + 1;
  db.prepare(
    `UPDATE engine_performance SET revenue = ?, cogs = ?, bookings = ?, updated_at = ? WHERE meta_adset_id = ?`
  ).run(newRevenue, newCogs, newBookings, new Date().toISOString(), row.meta_adset_id);
  const item = {
    orderId,
    revenue,
    cogs,
    currency: event.currency || row.currency || "USD",
    metaCampaignId: event.metaCampaignId || row.meta_campaign_id || "",
    metaAdsetId: String(event.metaAdsetId),
    leadId: event.leadId || "",
    bookedAt: event.bookedAt || new Date().toISOString(),
    source: event.source || "crm",
    createdAt: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO engine_revenue_events (order_id, event_json) VALUES (?, ?)`).run(
    orderId,
    JSON.stringify(item)
  );
  persisted = loadPersistedFromDb();
  return { ok: true, item };
}

export async function recordCrmQualityEvent(event) {
  const leadId = String(event.leadId || "").trim();
  if (!leadId) throw new Error("leadId is required");
  const quality = String(event.quality || "warm").toLowerCase();
  const qualified = event.qualified === true || quality === "hot";
  const db = getDb();
  const row = ensurePerfRow(db, event.metaAdsetId, event);
  if (!row) throw new Error("metaAdsetId is required");
  const newLeads = Number(row.leads || 0) + 1;
  const newQ = Number(row.qualified_leads || 0) + (qualified ? 1 : 0);
  db.prepare(
    `UPDATE engine_performance SET leads = ?, qualified_leads = ?, updated_at = ? WHERE meta_adset_id = ?`
  ).run(newLeads, newQ, new Date().toISOString(), row.meta_adset_id);
  const item = {
    leadId,
    quality,
    qualified,
    metaCampaignId: event.metaCampaignId || row.meta_campaign_id || "",
    metaAdsetId: String(event.metaAdsetId),
    at: event.at || new Date().toISOString(),
  };
  db.prepare(`INSERT INTO engine_crm_quality (event_json) VALUES (?)`).run(JSON.stringify(item));
  trimCrmQuality(db);
  persisted = loadPersistedFromDb();
  return { ok: true, item };
}

/** After restart: merge persisted Meta IDs into in-memory campaign rows */
export function hydrateMetaStateFromPersisted() {
  const list = persisted.metaCampaigns || [];
  for (const m of list) {
    const row = state.campaigns.find((c) => c.campaign === m.campaignName && c.adset === m.adsetName);
    if (row) {
      Object.assign(row, {
        metaCampaignId: m.metaCampaignId || row.metaCampaignId,
        metaAdsetId: m.metaAdsetId || row.metaAdsetId,
        metaAdId: m.metaAdId || row.metaAdId,
        metaCreativeId: m.metaCreativeId || row.metaCreativeId,
      });
    } else {
      state.campaigns.unshift({
        id: m.metaCampaignId || nextId("cmp"),
        campaign: m.campaignName,
        adset: m.adsetName,
        spend: 0,
        leads: 0,
        cpa: 0,
        roas: 0,
        status: "PAUSED",
        metaCampaignId: m.metaCampaignId,
        metaAdsetId: m.metaAdsetId,
        metaAdId: m.metaAdId,
        metaCreativeId: m.metaCreativeId,
      });
    }
  }
}

export function applyPersistedPerformanceToState() {
  const byAdset = persisted.performanceByAdset || {};
  for (const row of state.campaigns) {
    const key = row.metaAdsetId ? String(row.metaAdsetId) : "";
    if (!key || !byAdset[key]) continue;
    const perf = byAdset[key];
    row.spend = Number(perf.spend || 0);
    row.leads = Number(perf.leads || 0);
    row.impressions = Number(perf.impressions || 0);
    row.clicks = Number(perf.clicks || 0);
    row.cpa = row.leads > 0 ? row.spend / row.leads : row.spend;
    row.revenue = Number(perf.revenue || 0);
    row.cogs = Number(perf.cogs || 0);
    const grossProfit = row.revenue - row.cogs;
    row.profitRoas = row.spend > 0 ? grossProfit / row.spend : 0;
    row.roas = row.spend > 0 ? row.revenue / row.spend : 0;
    row.qualifiedLeads = Number(perf.qualifiedLeads || 0);
    row.bookings = Number(perf.bookings || 0);
  }
}

/**
 * Blend recent CAPI HTTP success rate into engine_settings.tracking_health (0–1).
 */
export function recomputeTrackingHealthFromCapiLog() {
  const db = getDb();
  const rows = db.prepare(`SELECT http_status FROM engine_capi_log ORDER BY id DESC LIMIT 50`).all();
  if (!rows.length) return;
  const ok = rows.filter((r) => r.http_status >= 200 && r.http_status < 300).length;
  const ratio = ok / rows.length;
  const prevRow = db.prepare(`SELECT tracking_health FROM engine_settings WHERE id = 1`).get();
  const prev = Number(prevRow?.tracking_health ?? 0.85);
  const blended = 0.35 * prev + 0.65 * ratio;
  const clamped = Math.max(0.1, Math.min(1, blended));
  db.prepare(`UPDATE engine_settings SET tracking_health = ? WHERE id = 1`).run(clamped);
  persisted = loadPersistedFromDb();
}

/**
 * Partial/full refund for a recorded order — adjusts performance aggregates.
 */
export async function recordRevenueRefund(event) {
  const orderId = String(event.orderId || "").trim();
  if (!orderId) throw new Error("orderId is required");
  const refundAmount = Number(event.refundAmount ?? event.amount);
  if (!(refundAmount > 0)) throw new Error("refundAmount must be > 0");
  const db = getDb();
  const existing = db.prepare(`SELECT event_json FROM engine_revenue_events WHERE order_id = ?`).get(orderId);
  if (!existing) throw new Error("orderId not found");
  const parsed = JSON.parse(existing.event_json);
  if (parsed.refunded === true) throw new Error("order already refunded");
  const originalRev = Number(parsed.revenue || 0);
  const originalCogs = Number(parsed.cogs || 0);
  const applied = Math.min(refundAmount, originalRev);
  const refundCogs = Math.min(Number(event.refundCogs ?? originalCogs), originalCogs);
  const metaAdsetId = String(parsed.metaAdsetId || "");
  if (!metaAdsetId) throw new Error("original event missing metaAdsetId");
  const row = db.prepare(`SELECT * FROM engine_performance WHERE meta_adset_id = ?`).get(metaAdsetId);
  if (!row) throw new Error("performance row not found for adset");
  const newRev = Math.max(0, Number(row.revenue || 0) - applied);
  const newCogs = Math.max(0, Number(row.cogs || 0) - refundCogs);
  const newBookings = Math.max(0, Number(row.bookings || 0) - (event.cancelBooking === false ? 0 : 1));
  db.prepare(
    `UPDATE engine_performance SET revenue = ?, cogs = ?, bookings = ?, updated_at = ? WHERE meta_adset_id = ?`
  ).run(newRev, newCogs, newBookings, new Date().toISOString(), metaAdsetId);
  parsed.refunded = true;
  parsed.refundAmount = applied;
  parsed.refundCogs = refundCogs;
  parsed.refundedAt = new Date().toISOString();
  db.prepare(`UPDATE engine_revenue_events SET event_json = ? WHERE order_id = ?`).run(
    JSON.stringify(parsed),
    orderId
  );
  persisted = loadPersistedFromDb();
  return { ok: true, orderId, appliedRefund: applied, performance: persisted.performanceByAdset[metaAdsetId] };
}

export function getBusinessSummary() {
  const byAdset = Object.values(persisted.performanceByAdset || {});
  const spend = byAdset.reduce((a, r) => a + Number(r.spend || 0), 0);
  const revenue = byAdset.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const cogs = byAdset.reduce((a, r) => a + Number(r.cogs || 0), 0);
  const grossProfit = revenue - cogs;
  const leads = byAdset.reduce((a, r) => a + Number(r.leads || 0), 0);
  const qualifiedLeads = byAdset.reduce((a, r) => a + Number(r.qualifiedLeads || 0), 0);
  const bookings = byAdset.reduce((a, r) => a + Number(r.bookings || 0), 0);
  return {
    spend,
    revenue,
    cogs,
    grossProfit,
    leads,
    qualifiedLeads,
    bookings,
    roas: spend > 0 ? revenue / spend : 0,
    profitRoas: spend > 0 ? grossProfit / spend : 0,
    qualifiedRate: leads > 0 ? qualifiedLeads / leads : 0,
    bookingRate: leads > 0 ? bookings / leads : 0,
  };
}

export function getEngineSnapshot() {
  return {
    jobs: persisted.jobs.slice(0, 50),
    decisions: persisted.decisions.slice(0, 50),
    crmLog: persisted.crmLog.slice(0, 30),
    funnel: persisted.funnel,
    trackingHealth: persisted.trackingHealth,
    metaCampaignsPersisted: (persisted.metaCampaigns || []).length,
    revenueEvents: persisted.revenueEvents.slice(0, 40),
    crmQualityEvents: persisted.crmQualityEvents.slice(0, 60),
    business: getBusinessSummary(),
  };
}

export function getLastScaleAt(metaAdsetId) {
  const db = getDb();
  const r = db.prepare(`SELECT last_scaled_at FROM engine_scale_history WHERE meta_adset_id = ?`).get(
    String(metaAdsetId || "")
  );
  return r ? new Date(r.last_scaled_at).getTime() : 0;
}

export function recordScaleHistory(metaAdsetId, budgetMinor) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO engine_scale_history (meta_adset_id, last_scaled_at, last_budget_minor)
     VALUES (?, ?, ?)`
  ).run(String(metaAdsetId || ""), new Date().toISOString(), Math.round(Number(budgetMinor || 0)));
}

export function logAudienceSync(segment, audienceId, matchedUsers, detail) {
  const db = getDb();
  db.prepare(
    `INSERT INTO engine_audience_sync (segment, audience_id, matched_users, detail_json) VALUES (?, ?, ?, ?)`
  ).run(segment || "", audienceId || "", Number(matchedUsers || 0), JSON.stringify(detail || {}));
}
