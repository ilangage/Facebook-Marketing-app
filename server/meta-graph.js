/**
 * Meta Marketing API helpers (Graph).
 * Requires: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (act_...)
 * For creatives/ads: META_PAGE_ID, optional META_PIXEL_ID, optional META_INSTAGRAM_ACTOR_ID (IG professional account for IG placements)
 * Optional: META_APP_ID, META_APP_SECRET — appsecret_proof on Graph calls (recommended if your app requires it).
 */

import crypto from "node:crypto";
import { validateAdCopyForLinkCreative } from "./meta-creative-validate.js";

/** Meta: appsecret_proof = HMAC-SHA256(app_secret, access_token) as hex. */
export function buildAppSecretProof(accessToken) {
  const appSecret = (process.env.META_APP_SECRET || process.env.App_secret || "").trim();
  if (!appSecret || !accessToken) return "";
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/** Preset keys merged into ad set `targeting` (unless user already set those keys). */
const PLACEMENT_PRESETS = {
  /** Facebook + Instagram feeds/reels/stories, mobile only */
  fb_ig_mobile: {
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "story", "reels"],
    device_platforms: ["mobile"],
  },
  /** Same placements, mobile + desktop */
  fb_ig_all_devices: {
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "story", "reels"],
    device_platforms: ["mobile", "desktop"],
  },
};

function getPlacementFragmentToMerge() {
  const raw = (process.env.META_PLACEMENT_TARGETING_JSON || "").trim();
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object" && !Array.isArray(o)) return o;
    } catch {
      /* ignore invalid JSON; fall back to preset */
    }
  }
  const preset = (process.env.META_PLACEMENT_PRESET || "fb_ig_mobile").trim();
  if (preset === "auto" || preset === "none") return null;
  return PLACEMENT_PRESETS[preset] || PLACEMENT_PRESETS.fb_ig_mobile;
}

/**
 * Merges placement-related keys into ad set targeting. User/geo/age/locales take precedence when already set.
 * @param {Record<string, unknown>} targeting
 * @param {{ skipPlacementMerge?: boolean, placementTargeting?: Record<string, unknown> }} [body]
 */
export function mergePlacementIntoTargeting(targeting, body = {}) {
  const out = { ...targeting };
  if (body.placementTargeting && typeof body.placementTargeting === "object") {
    return { ...out, ...body.placementTargeting };
  }
  if (body.skipPlacementMerge === true) return out;
  const frag = getPlacementFragmentToMerge();
  if (!frag) return out;
  for (const [k, v] of Object.entries(frag)) {
    if (out[k] === undefined || out[k] === null) {
      out[k] = v;
    }
  }
  return out;
}

export function getMetaConfig() {
  const token = process.env.META_ACCESS_TOKEN || "";
  let adAccountId = process.env.META_AD_ACCOUNT_ID || "";
  if (adAccountId && !adAccountId.startsWith("act_")) {
    adAccountId = `act_${adAccountId}`;
  }
  const appId = (process.env.META_APP_ID || process.env.App_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || process.env.App_secret || "").trim();
  return {
    token,
    adAccountId,
    pageId: process.env.META_PAGE_ID || "",
    pixelId: process.env.META_PIXEL_ID || "",
    /** Instagram professional account ID — required for many IG placements when using explicit placements */
    instagramActorId: (process.env.META_INSTAGRAM_ACTOR_ID || "").trim(),
    apiVersion: process.env.META_API_VERSION || "v23.0",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",
    /** Meta App Dashboard → App ID (for OAuth/debug; not sent as Graph token). */
    appId,
    /** App Secret — never log; used only for appsecret_proof when set. */
    appSecret,
  };
}

export function isMetaConfigured() {
  const c = getMetaConfig();
  return Boolean(c.token && c.adAccountId);
}

/**
 * Short SHA256 prefix of the current access token (for comparing local vs deployed env without exposing the token).
 */
export function getAccessTokenFingerprint() {
  const t = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!t) return "";
  return crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);
}

/**
 * Meta Graph `debug_token` — requires app id + app secret. Returns validity and expiry (no secrets).
 */
export async function fetchAccessTokenDebugInfo() {
  const c = getMetaConfig();
  const tokenFingerprint = getAccessTokenFingerprint();
  if (!c.token) {
    return { ok: false, tokenFingerprint: "", error: "META_ACCESS_TOKEN missing" };
  }
  if (!c.appId || !c.appSecret) {
    return {
      ok: false,
      tokenFingerprint,
      error: "Set META_APP_ID and META_APP_SECRET to check token expiry (Graph debug_token).",
    };
  }
  const url = new URL(`https://graph.facebook.com/${c.apiVersion}/debug_token`);
  url.searchParams.set("input_token", c.token);
  url.searchParams.set("access_token", `${c.appId}|${c.appSecret}`);
  const res = await fetch(url.href);
  const raw = await res.json();
  if (raw.error) {
    return {
      ok: false,
      tokenFingerprint,
      error: raw.error.message || JSON.stringify(raw.error),
      code: raw.error.code,
    };
  }
  const d = raw.data;
  if (!d || typeof d !== "object") {
    return { ok: false, tokenFingerprint, error: "Empty debug_token response" };
  }
  return {
    ok: true,
    valid: d.is_valid === true,
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
    dataAccessExpiresAt: d.data_access_expires_at
      ? new Date(d.data_access_expires_at * 1000).toISOString()
      : null,
    userId: d.user_id != null ? String(d.user_id) : null,
    appId: d.app_id != null ? String(d.app_id) : null,
    scopes: Array.isArray(d.scopes) ? d.scopes : [],
    applicationName: typeof d.application === "string" ? d.application : "",
    tokenFingerprint,
  };
}

/** Defaults aligned with goal qualified_booking_roas (conversions + revenue), not traffic clicks. */
export function getDefaultCampaignDefaults() {
  return {
    objective: process.env.META_DEFAULT_OBJECTIVE || "OUTCOME_SALES",
    optimizationGoal: process.env.META_DEFAULT_OPTIMIZATION_GOAL || "OFFSITE_CONVERSIONS",
    customEventType: process.env.META_CUSTOM_EVENT_TYPE || "PURCHASE",
  };
}

/**
 * Advantage Campaign Budget (recommended): campaign `daily_budget` + `bid_strategy`; ad sets omit `daily_budget`.
 * `META_CBO=true` (default) for both single- and multi–ad-set chains. `META_CBO=false` → legacy ABO per ad set.
 * Does not change objective / optimization goal — only budget placement.
 */
export function isCampaignBudgetOptimization() {
  const raw = (process.env.META_CBO ?? "true").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return true;
}

/** @deprecated Use `isCampaignBudgetOptimization` (same behavior). */
export function isCampaignBudgetOptimizationMulti() {
  return isCampaignBudgetOptimization();
}

/**
 * Convert major currency units (e.g. dollars) to Meta minor units for daily_budget.
 * META_CURRENCY_MINOR_EXPONENT: 2 for USD/EUR, 0 for JPY (whole currency).
 */
export function majorCurrencyToMinorUnits(majorAmount) {
  const exp = Number(process.env.META_CURRENCY_MINOR_EXPONENT ?? 2);
  const m = Number(majorAmount || 0);
  if (!Number.isFinite(m) || m <= 0) return exp <= 0 ? 1 : 100;
  if (exp <= 0) return Math.max(1, Math.round(m));
  const factor = 10 ** exp;
  return Math.max(factor, Math.round(m * factor));
}

/**
 * Meta often returns generic `message: "Invalid parameter"` (code 100) — merge user-facing and debug fields.
 * @param {Record<string, unknown> | null | undefined} graphErr
 */
export function formatGraphApiErrorMessage(graphErr) {
  if (!graphErr || typeof graphErr !== "object") {
    return String(graphErr ?? "Graph error");
  }
  const primary = String(graphErr.message || "Graph error").trim();
  const parts = [primary];
  const userMsg = graphErr.error_user_msg;
  if (userMsg && String(userMsg).trim() && String(userMsg).trim() !== primary) {
    parts.push(String(userMsg).trim());
  }
  if (graphErr.error_user_title) {
    parts.push(`(${String(graphErr.error_user_title).trim()})`);
  }
  const codeBits = [];
  if (graphErr.code != null) codeBits.push(String(graphErr.code));
  if (graphErr.error_subcode != null) codeBits.push(`subcode ${graphErr.error_subcode}`);
  if (codeBits.length) parts.push(`[${codeBits.join(", ")}]`);

  const blame = graphErr.error_data ?? graphErr.blame_field_specs;
  if (blame != null) {
    try {
      const s = typeof blame === "string" ? blame : JSON.stringify(blame);
      if (s && s !== "{}" && s !== "[]") parts.push(s.length > 800 ? `${s.slice(0, 800)}…` : s);
    } catch {
      /* ignore */
    }
  }
  return parts.join(" ");
}

function toFormBody(token, params) {
  const body = new URLSearchParams();
  body.set("access_token", token);
  const proof = buildAppSecretProof(token);
  if (proof) body.set("appsecret_proof", proof);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      body.set(key, JSON.stringify(value));
    } else if (typeof value === "boolean") {
      /** Graph form-encoded booleans must be literal "true" / "false". */
      body.set(key, value ? "true" : "false");
    } else {
      body.set(key, String(value));
    }
  }
  return body;
}

/** META_ADSET_BUDGET_SHARING=true → sharing on; default false (explicit for Graph). */
function adsetBudgetSharingEnabledFromEnv() {
  const v = String(process.env.META_ADSET_BUDGET_SHARING ?? "false")
    .trim()
    .toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Campaign bid strategy for CBO; empty / omit / none = do not send (some accounts error when combined with objective). */
function campaignBidStrategyFromEnv() {
  const s = (process.env.META_CAMPAIGN_BID_STRATEGY || "LOWEST_COST_WITHOUT_CAP").trim();
  if (!s || /^omit$/i.test(s) || /^none$/i.test(s)) return "";
  return s;
}

/**
 * Meta sometimes returns campaign id without persisting `daily_budget` on create; ad set then fails with
 * is_adset_budget_sharing_enabled (Graph treats spend as non–campaign-budget). Re-apply budget on the campaign.
 */
async function ensureCampaignDailyBudgetApplied(campaignId, dailyBudgetMinor) {
  if (!campaignId || !(dailyBudgetMinor > 0)) return;
  const camp = await graphGet(`/${campaignId}`, { fields: "daily_budget" });
  if (Number(camp.daily_budget || 0) > 0) return;
  const patch = { daily_budget: dailyBudgetMinor, buying_type: "AUCTION" };
  const cbs = campaignBidStrategyFromEnv();
  if (cbs) patch.bid_strategy = cbs;
  await graphPostForm(`/${campaignId}`, patch);
  const again = await graphGet(`/${campaignId}`, { fields: "daily_budget" });
  if (!(Number(again.daily_budget || 0) > 0)) {
    throw new Error(
      "Campaign has no daily_budget after create — Meta did not enable Advantage Campaign Budget. " +
        "Try META_CAMPAIGN_BID_STRATEGY=omit, or set META_CBO=false and META_ADSET_BUDGET_SHARING=true for ad-set budgets."
    );
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json();
    if (!res.ok) {
      const ge = data?.error && typeof data.error === "object" ? data.error : null;
      const msg = ge
        ? formatGraphApiErrorMessage(ge)
        : data?.error?.message || `Graph request failed (${res.status})`;
      const err = new Error(msg);
      err.meta = ge || data?.error || { status: res.status };
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function graphPostForm(path, params) {
  const c = getMetaConfig();
  if (!c.token) {
    throw new Error("META_ACCESS_TOKEN is missing");
  }
  const url = `https://graph.facebook.com/${c.apiVersion}${path.startsWith("/") ? path : `/${path}`}`;
  const body = toFormBody(c.token, params);
  const data = await fetchJsonWithTimeout(url, { method: "POST", body });
  if (data.error) {
    const ge = typeof data.error === "object" ? data.error : { message: String(data.error) };
    const err = new Error(formatGraphApiErrorMessage(ge));
    err.meta = ge;
    throw err;
  }
  return data;
}

/** Maps targetingsearch `type` → flexible_spec key (same as client `TARGETING_FLEX_KEYS`). */
const TARGETING_TYPE_TO_FLEX_KEY = {
  adinterest: "interests",
  adbehavior: "behaviors",
  work_title: "work_positions",
  work_employer: "work_employers",
};

/**
 * Ad account `GET /{ad-account-id}/targetingsearch` expects `limit_type` (interests, behaviors, work_positions, …).
 * Legacy `type=adinterest` / `type=work_title` is not applied → mixed results.
 */
const TARGETING_TYPE_TO_LIMIT_TYPE = {
  adinterest: "interests",
  adbehavior: "behaviors",
  work_title: "work_positions",
  work_employer: "work_employers",
};

/** First path segment is often the category label ("Interests", "Behaviors", …). */
function targetingPathHead(row) {
  return Array.isArray(row?.path) ? String(row.path[0] || "").trim().toLowerCase() : "";
}

/**
 * Graph `row.type` must align with `limit_type`. Meta sometimes returns mixed rows or omits `type`;
 * use `path[0]` to reject obvious cross-category rows (e.g. Interests under Behaviors tab).
 * When `type` is omitted, `limit_type` on the request already scopes results — do not drop rows
 * just because path[0] lacks the substring "interest" (Graph uses varied path labels).
 */
function targetingRowMatchesLimitType(row, limitType) {
  const lt = String(limitType || "").trim().toLowerCase();
  if (!lt) return true;

  const head = targetingPathHead(row);
  if (lt === "interests" && head === "behaviors") return false;
  if (lt === "behaviors" && head === "interests") return false;
  if (lt === "work_positions" && (head === "interests" || head === "behaviors")) return false;
  if (lt === "work_employers" && (head === "interests" || head === "behaviors")) return false;

  const rt = String(row?.type ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!rt) {
    if (lt === "interests") return head !== "behaviors";
    if (lt === "behaviors") return head !== "interests";
    if (lt === "work_positions" || lt === "work_employers") return true;
    return false;
  }
  if (rt === lt) return true;
  const synonyms = {
    interests: new Set(["interests", "interest"]),
    behaviors: new Set(["behaviors", "behavior"]),
    work_positions: new Set(["work_positions", "work_position"]),
    work_employers: new Set(["work_employers", "work_employer"]),
  };
  const syn = synonyms[lt];
  return syn ? syn.has(rt) : rt === lt;
}

function mapTargetingSearchRow(row, type) {
  const t = String(type || "adinterest").trim();
  const lo = row.audience_size_lower_bound != null ? Number(row.audience_size_lower_bound) : null;
  const hi = row.audience_size_upper_bound != null ? Number(row.audience_size_upper_bound) : null;
  let audience_size = row.audience_size != null ? Number(row.audience_size) : null;
  if (audience_size == null && lo != null && hi != null) {
    audience_size = Math.round((lo + hi) / 2);
  } else if (audience_size == null && lo != null) {
    audience_size = lo;
  } else if (audience_size == null && hi != null) {
    audience_size = hi;
  }
  return {
    id: row.id != null ? String(row.id) : "",
    name: row.name || "",
    /** Graph taxonomy only — do not fall back to request tab `t` (that masks mixed rows). */
    type:
      row.type != null && String(row.type).trim() !== ""
        ? String(row.type)
        : null,
    audience_size,
    audience_size_lower_bound: Number.isFinite(lo) ? lo : null,
    audience_size_upper_bound: Number.isFinite(hi) ? hi : null,
    path: Array.isArray(row.path) ? row.path : [],
  };
}

function hasAudienceSignal(row) {
  return (
    row.audience_size != null ||
    row.audience_size_lower_bound != null ||
    row.audience_size_upper_bound != null
  );
}

/** Parses GET /reachestimate response (shape varies slightly by API version). */
export function parseReachEstimatePayload(raw) {
  const first = Array.isArray(raw?.data) ? raw.data[0] : raw?.data ?? raw;
  if (!first || typeof first !== "object") return null;
  if (first.unsupported === true) return null;
  const lo = first.users_lower_bound;
  const hi = first.users_upper_bound;
  const single = first.users;
  if (lo != null && hi != null) {
    const l = Number(lo);
    const h = Number(hi);
    if (!Number.isFinite(l) || !Number.isFinite(h)) return null;
    return { lower: l, upper: h, midpoint: Math.round((l + h) / 2) };
  }
  if (single != null) {
    const n = Number(single);
    if (!Number.isFinite(n)) return null;
    return { lower: n, upper: n, midpoint: n };
  }
  return null;
}

async function reachEstimateForInterest({ flexKey, interestId, countryCode }) {
  const c = getMetaConfig();
  const countries =
    countryCode && /^[A-Z]{2}$/.test(String(countryCode).trim().toUpperCase())
      ? [String(countryCode).trim().toUpperCase()]
      : ["US"];
  const flexObj = { [flexKey]: [{ id: String(interestId) }] };
  const targeting_spec = {
    geo_locations: { countries },
    age_min: 18,
    age_max: 65,
    flexible_spec: [flexObj],
  };
  const raw = await graphGet(`/${c.adAccountId}/reachestimate`, {
    targeting_spec: JSON.stringify(targeting_spec),
  });
  return parseReachEstimatePayload(raw);
}

async function enrichTargetingRowsWithReachEstimates(rows, type, countryCode) {
  if (process.env.TARGETING_REACH_ESTIMATE === "false") return rows;
  const maxCalls = Math.min(50, Math.max(1, Number(process.env.TARGETING_REACH_ESTIMATE_MAX) || 18));
  const flexKey = TARGETING_TYPE_TO_FLEX_KEY[String(type).trim()] || "interests";
  const cc = String(countryCode || "")
    .trim()
    .toUpperCase();
  const validCc = /^[A-Z]{2}$/.test(cc) ? cc : null;
  const out = [];
  let calls = 0;
  for (const row of rows) {
    if (hasAudienceSignal(row)) {
      out.push(row);
      continue;
    }
    if (!row.id || calls >= maxCalls) {
      out.push(row);
      continue;
    }
    calls += 1;
    try {
      const est = await reachEstimateForInterest({
        flexKey,
        interestId: row.id,
        countryCode: validCc,
      });
      if (est) {
        out.push({
          ...row,
          audience_size: est.midpoint,
          audience_size_lower_bound: est.lower,
          audience_size_upper_bound: est.upper,
        });
      } else {
        out.push(row);
      }
    } catch {
      out.push(row);
    }
  }
  return out;
}

/**
 * Meta targeting search (interests, behaviors, work titles, employers, …).
 * When Graph omits `audience_size`, optionally calls `/reachestimate` per row (capped) to fill estimates.
 * @see https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
 * @see https://developers.facebook.com/docs/marketing-api/reference/ad-account/reachestimate/
 */
/** Trim + strip wrapping quotes so pasted `"travel"` searches as travel. */
export function normalizeTargetingSearchQuery(q) {
  let s = String(q ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export async function searchTargetingCatalog({ q, type, limit = 25, countryCode }) {
  const c = getMetaConfig();
  if (!c.token || !c.adAccountId) {
    throw new Error("META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required for targeting search");
  }
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const query = normalizeTargetingSearchQuery(q);
  if (!query) {
    throw new Error("Query q is required");
  }
  const t = String(type || "adinterest").trim();
  const cc = String(countryCode || "")
    .trim()
    .toUpperCase();
  const limitType = TARGETING_TYPE_TO_LIMIT_TYPE[t] || "interests";
  /** Ask for more rows than needed, then filter by category — Graph can return mixed `type` values. */
  const fetchCap = Math.min(50, Math.max(lim, Math.ceil(lim * 2.5)));
  const params = {
    q: query,
    limit_type: limitType,
    limit: fetchCap,
  };
  /** Scopes audience estimates to this country (Meta `country_code` on ad account targetingsearch). */
  if (cc && /^[A-Z]{2}$/.test(cc)) {
    params.country_code = cc;
  }
  const raw = await graphGet(`/${c.adAccountId}/targetingsearch`, params);
  const rawRows = Array.isArray(raw.data) ? raw.data : [];
  const graphRawCount = rawRows.length;
  let data = rawRows.filter((row) => targetingRowMatchesLimitType(row, limitType)).slice(0, lim);
  const afterTypeFilter = data.length;
  const mapped = data.map((row) => mapTargetingSearchRow(row, t));
  const results = await enrichTargetingRowsWithReachEstimates(mapped, t, cc || undefined);
  return {
    results,
    searchStats: {
      queryNormalized: query,
      graphRawCount,
      afterTypeFilter,
      limitType,
      countryCode: cc && /^[A-Z]{2}$/.test(cc) ? cc : undefined,
    },
  };
}

export async function graphGet(path, query = {}) {
  const c = getMetaConfig();
  if (!c.token) {
    throw new Error("META_ACCESS_TOKEN is missing");
  }
  const url = new URL(`https://graph.facebook.com/${c.apiVersion}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const proof = buildAppSecretProof(c.token);
  if (proof) url.searchParams.set("appsecret_proof", proof);
  const data = await fetchJsonWithTimeout(url.href, {
    headers: {
      Authorization: `Bearer ${c.token}`,
    },
  });
  if (data.error) {
    const err = new Error(data.error.message || JSON.stringify(data.error));
    err.meta = data.error;
    throw err;
  }
  return data;
}

/** DELETE /{object-id} — best-effort cleanup when campaign chain fails mid-flight */
export async function deleteGraphObject(objectId) {
  if (!objectId) return null;
  const c = getMetaConfig();
  if (!c.token) {
    throw new Error("META_ACCESS_TOKEN is missing");
  }
  const u = new URL(`https://graph.facebook.com/${c.apiVersion}/${objectId}`);
  const proof = buildAppSecretProof(c.token);
  if (proof) u.searchParams.set("appsecret_proof", proof);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(u.href, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${c.token}` },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from Graph DELETE ${objectId}`);
      }
    }
    if (data.error) {
      const err = new Error(data.error.message || JSON.stringify(data.error));
      err.meta = data.error;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Graph DELETE failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function rollbackPartialCampaignChain(partial) {
  const order = [
    partial.ad?.id,
    partial.creative?.id,
    partial.adset?.id,
    partial.campaign?.id,
  ].filter(Boolean);
  for (const id of order) {
    try {
      await deleteGraphObject(id);
    } catch {
      /* best-effort; log only in caller if needed */
    }
  }
}

async function rollbackPartialMultiChain(partial) {
  if (!partial) return;
  for (const p of partial.pairs || []) {
    try {
      if (p.ad?.id) await deleteGraphObject(p.ad.id);
    } catch {
      /* best-effort */
    }
    try {
      if (p.adset?.id) await deleteGraphObject(p.adset.id);
    } catch {
      /* best-effort */
    }
  }
  try {
    if (partial.creative?.id) await deleteGraphObject(partial.creative.id);
  } catch {
    /* best-effort */
  }
  try {
    if (partial.campaign?.id) await deleteGraphObject(partial.campaign.id);
  } catch {
    /* best-effort */
  }
}

function defaultTargetingFallback() {
  return {
    geo_locations: { countries: ["LK"] },
    age_min: 21,
    age_max: 55,
    locales: [1000],
  };
}

/**
 * Resolves 1–4 ad set specs from `body.adsets` or legacy `adsetName` + `targeting`.
 * @throws {Error} if more than 4 ad sets
 */
export function normalizeAdsetSpecs(body) {
  const shared =
    body.targeting && typeof body.targeting === "object" && Object.keys(body.targeting).length > 0
      ? body.targeting
      : null;

  if (Array.isArray(body.adsets) && body.adsets.length > 0) {
    if (body.adsets.length > 4) {
      throw new Error("Maximum 4 ad sets per campaign");
    }
    return body.adsets.map((a, i) => {
      const name = (a.name && String(a.name).trim()) || `Ad Set ${i + 1}`;
      const t =
        a.targeting && typeof a.targeting === "object" && Object.keys(a.targeting).length > 0
          ? a.targeting
          : shared || defaultTargetingFallback();
      return { name, targeting: t };
    });
  }

  return [
    {
      name: (body.adsetName && String(body.adsetName).trim()) || "Travel Ad Set",
      targeting: shared || defaultTargetingFallback(),
    },
  ];
}

/** Upload image by public HTTPS URL → returns Graph response (images.{hash}) */
export async function uploadAdImageFromUrl(imageUrl, name) {
  const c = getMetaConfig();
  return graphPostForm(`/${c.adAccountId}/adimages`, {
    url: imageUrl,
    name: name || "image",
  });
}

/**
 * Upload image from raw base64 (no data: URL prefix) — Graph `bytes` param.
 * @see https://developers.facebook.com/docs/marketing-api/reference/ad-account/adimages/
 */
export async function uploadAdImageFromBase64(base64Payload, name) {
  const c = getMetaConfig();
  const bytes = String(base64Payload || "").replace(/\s/g, "");
  if (!bytes.length) {
    throw new Error("bytes payload is empty");
  }
  return graphPostForm(`/${c.adAccountId}/adimages`, {
    bytes,
    name: name || "image",
  });
}

/** Upload video by public HTTPS URL (file_url) → returns { id: video_id } */
export async function uploadAdVideoFromFileUrl(fileUrl, name) {
  const c = getMetaConfig();
  return graphPostForm(`/${c.adAccountId}/advideos`, {
    file_url: fileUrl,
    name: name || "video",
  });
}

export async function createLinkAdCreative(payload) {
  const c = getMetaConfig();
  if (!c.pageId) {
    throw new Error("META_PAGE_ID is required to create ad creatives");
  }
  const link = payload.link || c.appBaseUrl;
  const message = payload.message || "Explore travel packages";
  const headline = payload.headline || "Travel Deals";
  const description = payload.description || "Book your trip";
  validateAdCopyForLinkCreative({ message, headline, description });

  const rawCards = Array.isArray(payload.carouselCards) ? payload.carouselCards.filter(Boolean) : [];
  let object_story_spec;
  if (rawCards.length >= 2) {
    const child_attachments = rawCards.map((card, idx) => {
      if (!card.imageHash) {
        throw new Error(`carouselCards[${idx}] requires imageHash`);
      }
      const cardLink = card.link || link;
      const cardName = card.headline || card.name || `Card ${idx + 1}`;
      const attachment = {
        link: cardLink,
        name: cardName,
        description: card.description || "",
        image_hash: card.imageHash,
      };
      return attachment;
    });
    object_story_spec = {
      page_id: c.pageId,
      link_data: {
        link,
        message,
        name: headline,
        description,
        child_attachments,
      },
    };
  } else if (payload.videoId) {
    object_story_spec = {
      page_id: c.pageId,
      video_data: {
        video_id: payload.videoId,
        title: headline,
        message,
        call_to_action: {
          type: "LEARN_MORE",
          value: { link },
        },
      },
    };
  } else if (payload.imageHash) {
    object_story_spec = {
      page_id: c.pageId,
      link_data: {
        link,
        message,
        name: headline,
        description,
        image_hash: payload.imageHash,
      },
    };
  } else {
    throw new Error("Provide carouselCards (2+) or imageHash or videoId for creative");
  }

  if (c.instagramActorId) {
    object_story_spec.instagram_actor_id = c.instagramActorId;
  }

  return graphPostForm(`/${c.adAccountId}/adcreatives`, {
    name: payload.name || "Travel Creative",
    object_story_spec,
  });
}

/**
 * Create campaign → ad set → creative → ad (all PAUSED by default).
 * dailyBudget: dollars in request; sent to Meta as minor units (×100 for USD-style accounts).
 * When `body.adsets` has 2–4 items, creates one campaign + one shared creative + one ad set + ad per spec (audience testing).
 * `META_CBO` (default on): Advantage Campaign Budget — campaign `daily_budget` (+ `bid_strategy`); ad sets omit `daily_budget`.
 * Multi: total campaign budget = `dailyBudget` × ad set count. Single: campaign budget = request `dailyBudget`. Goal/objective unchanged.
 */
export async function createCampaignChain(body) {
  const specs = normalizeAdsetSpecs(body);
  if (specs.length === 1) {
    return createCampaignChainSingle(body, specs[0]);
  }
  return createCampaignChainMulti(body, specs);
}

async function createCampaignChainSingle(body, spec) {
  const merged = { ...body, adsetName: spec.name, targeting: spec.targeting };
  const c = getMetaConfig();
  const defs = getDefaultCampaignDefaults();
  const objective = merged.objective || defs.objective;
  const optimizationGoal = merged.optimizationGoal || defs.optimizationGoal;
  const customEventType = merged.customEventType || defs.customEventType;
  const useCbo = isCampaignBudgetOptimization();

  const partial = { campaign: null, adset: null, creative: null, ad: null };

  try {
    const dailyBudgetMinor = majorCurrencyToMinorUnits(Number(merged.dailyBudget || 20));
    const campaignPayload = {
      name: merged.campaignName || "Travel Campaign",
      objective,
      status: merged.status || "PAUSED",
      special_ad_categories: [],
    };
    if (useCbo) {
      campaignPayload.buying_type = "AUCTION";
      campaignPayload.daily_budget = dailyBudgetMinor;
      const cbs = campaignBidStrategyFromEnv();
      if (cbs) campaignPayload.bid_strategy = cbs;
    }

    partial.campaign = await graphPostForm(`/${c.adAccountId}/campaigns`, campaignPayload);
    if (useCbo) {
      await ensureCampaignDailyBudgetApplied(partial.campaign.id, dailyBudgetMinor);
    }

    let targeting =
      merged.targeting && typeof merged.targeting === "object" && Object.keys(merged.targeting).length > 0
        ? merged.targeting
        : defaultTargetingFallback();

    targeting = mergePlacementIntoTargeting(targeting, merged);

    const adsetPayload = {
      name: merged.adsetName || "Travel Ad Set",
      campaign_id: partial.campaign.id,
      billing_event: "IMPRESSIONS",
      optimization_goal: optimizationGoal,
      targeting,
      status: "PAUSED",
      start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    if (useCbo) {
      /** CBO: budget + bid live on the campaign; ad set `bid_strategy` can make Graph ignore campaign budget. */
    } else {
      adsetPayload.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
      adsetPayload.daily_budget = dailyBudgetMinor;
      adsetPayload.is_adset_budget_sharing_enabled = adsetBudgetSharingEnabledFromEnv();
    }

    if (optimizationGoal === "OFFSITE_CONVERSIONS") {
      if (!c.pixelId) {
        throw new Error(
          "META_PIXEL_ID is required for OFFSITE_CONVERSIONS (sales / ROAS). Set pixel or override optimizationGoal/objective."
        );
      }
      adsetPayload.promoted_object = {
        pixel_id: c.pixelId,
        custom_event_type: customEventType,
      };
    }

    partial.adset = await graphPostForm(`/${c.adAccountId}/adsets`, adsetPayload);

    partial.creative = await createLinkAdCreative({
      name: merged.creativeName || "Travel Creative",
      imageHash: merged.imageHash,
      videoId: merged.videoId,
      carouselCards: merged.carouselCards,
      link: merged.link,
      message: merged.message,
      headline: merged.headline,
      description: merged.description,
    });

    partial.ad = await graphPostForm(`/${c.adAccountId}/ads`, {
      name: merged.adName || "Travel Ad",
      adset_id: partial.adset.id,
      creative: { creative_id: partial.creative.id },
      status: "PAUSED",
    });

    return {
      campaign: partial.campaign,
      adset: partial.adset,
      creative: partial.creative,
      ad: partial.ad,
    };
  } catch (err) {
    await rollbackPartialCampaignChain(partial);
    throw err;
  }
}

async function createCampaignChainMulti(body, specs) {
  const c = getMetaConfig();
  const defs = getDefaultCampaignDefaults();
  const objective = body.objective || defs.objective;
  const optimizationGoal = body.optimizationGoal || defs.optimizationGoal;
  const customEventType = body.customEventType || defs.customEventType;
  const perAdsetMajor = Number(body.dailyBudget || 20);
  const dailyBudgetMinor = majorCurrencyToMinorUnits(perAdsetMajor);
  const useCbo = isCampaignBudgetOptimization();
  /** CBO: total campaign daily = per-ad-set amount × N (same total $ as legacy N × per-ad-set). */
  const campaignDailyBudgetMinor = majorCurrencyToMinorUnits(perAdsetMajor * specs.length);

  const partial = { campaign: null, creative: null, pairs: [] };

  try {
    const campaignPayload = {
      name: body.campaignName || "Travel Campaign",
      objective,
      status: body.status || "PAUSED",
      special_ad_categories: [],
    };
    if (useCbo) {
      campaignPayload.buying_type = "AUCTION";
      campaignPayload.daily_budget = campaignDailyBudgetMinor;
      const cbs = campaignBidStrategyFromEnv();
      if (cbs) campaignPayload.bid_strategy = cbs;
    }

    partial.campaign = await graphPostForm(`/${c.adAccountId}/campaigns`, campaignPayload);
    if (useCbo) {
      await ensureCampaignDailyBudgetApplied(partial.campaign.id, campaignDailyBudgetMinor);
    }

    partial.creative = await createLinkAdCreative({
      name: body.creativeName || "Travel Creative",
      imageHash: body.imageHash,
      videoId: body.videoId,
      carouselCards: body.carouselCards,
      link: body.link,
      message: body.message,
      headline: body.headline,
      description: body.description,
    });

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      let targeting =
        spec.targeting && typeof spec.targeting === "object" && Object.keys(spec.targeting).length > 0
          ? spec.targeting
          : defaultTargetingFallback();
      targeting = mergePlacementIntoTargeting(targeting, body);

      const adsetPayload = {
        name: spec.name,
        campaign_id: partial.campaign.id,
        billing_event: "IMPRESSIONS",
        optimization_goal: optimizationGoal,
        targeting,
        status: "PAUSED",
        start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      if (!useCbo) {
        adsetPayload.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
        adsetPayload.daily_budget = dailyBudgetMinor;
        adsetPayload.is_adset_budget_sharing_enabled = adsetBudgetSharingEnabledFromEnv();
      }

      if (optimizationGoal === "OFFSITE_CONVERSIONS") {
        if (!c.pixelId) {
          throw new Error(
            "META_PIXEL_ID is required for OFFSITE_CONVERSIONS (sales / ROAS). Set pixel or override optimizationGoal/objective."
          );
        }
        adsetPayload.promoted_object = {
          pixel_id: c.pixelId,
          custom_event_type: customEventType,
        };
      }

      const adset = await graphPostForm(`/${c.adAccountId}/adsets`, adsetPayload);
      const adName =
        specs.length > 1 ? `${body.adName || "Travel Ad"} ${i + 1}` : body.adName || "Travel Ad";
      const ad = await graphPostForm(`/${c.adAccountId}/ads`, {
        name: adName,
        adset_id: adset.id,
        creative: { creative_id: partial.creative.id },
        status: "PAUSED",
      });
      partial.pairs.push({ adset, ad });
    }

    const first = partial.pairs[0];
    return {
      campaign: partial.campaign,
      creative: partial.creative,
      adsets: partial.pairs.map((p) => p.adset),
      ads: partial.pairs.map((p) => p.ad),
      adset: first.adset,
      ad: first.ad,
    };
  } catch (err) {
    await rollbackPartialMultiChain(partial);
    throw err;
  }
}

export async function getAdAccountInsights() {
  const c = getMetaConfig();
  return graphGet(`/${c.adAccountId}/insights`, {
    fields:
      "campaign_name,adset_name,adset_id,spend,clicks,cpc,ctr,reach,impressions,actions,purchase_roas",
    level: "adset",
    date_preset: "last_7d",
  });
}

/** POST /{object-id} — e.g. activate/pause an ad, ad set, or campaign */
export async function setObjectStatus(objectId, status) {
  if (!objectId) {
    throw new Error("objectId is required");
  }
  return graphPostForm(`/${objectId}`, { status });
}

export async function getAdsetById(adsetId) {
  if (!adsetId) throw new Error("adsetId is required");
  return graphGet(`/${adsetId}`, { fields: "id,name,daily_budget,status,campaign_id,targeting" });
}

export async function getCampaignById(campaignId) {
  if (!campaignId) throw new Error("campaignId is required");
  return graphGet(`/${campaignId}`, { fields: "id,name,daily_budget,status" });
}

/** List ads under an ad set (for operator tools / creative swap). */
export async function getAdsForAdset(adsetId) {
  if (!adsetId) throw new Error("adsetId is required");
  return graphGet(`/${adsetId}/ads`, { fields: "id,name,status", limit: 50 });
}

/**
 * Deep copy ad set (and ads when supported). Graph returns copied ad set id.
 * @see https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/copies
 */
export async function copyAdSetDeep(adsetId, { statusOption = "PAUSED", deepCopy = true } = {}) {
  if (!adsetId) throw new Error("adsetId is required");
  return graphPostForm(`/${adsetId}/copies`, {
    status_option: statusOption,
    deep_copy: deepCopy ? "true" : "false",
  });
}

/** Point an existing ad at a different ad creative id. */
export async function updateAdCreativeOnAd(adId, creativeId) {
  if (!adId || !creativeId) throw new Error("adId and creativeId are required");
  return graphPostForm(`/${adId}`, { creative: { creative_id: String(creativeId) } });
}

export async function updateAdsetDailyBudget(adsetId, dailyBudgetMinor) {
  if (!adsetId) throw new Error("adsetId is required");
  const next = Math.max(100, Math.round(Number(dailyBudgetMinor || 0)));
  /** Required when budget lives at ad set (no campaign daily_budget / ABO-style updates). */
  return graphPostForm(`/${adsetId}`, {
    daily_budget: next,
    is_adset_budget_sharing_enabled: adsetBudgetSharingEnabledFromEnv(),
  });
}

/** Advantage Campaign Budget: scale spend at the campaign object (ad sets have no daily_budget). */
export async function updateCampaignDailyBudget(campaignId, dailyBudgetMinor) {
  if (!campaignId) throw new Error("campaignId is required");
  const next = Math.max(100, Math.round(Number(dailyBudgetMinor || 0)));
  return graphPostForm(`/${campaignId}`, { daily_budget: next });
}

export function extractImageHashFromAdImagesResponse(data) {
  if (!data?.images) return null;
  const keys = Object.keys(data.images);
  if (!keys.length) return null;
  const first = data.images[keys[0]];
  return first?.hash || keys[0];
}

export async function activateDeliveryChain({ campaignId, adsetId, adId }) {
  await setObjectStatus(campaignId, "ACTIVE");
  await setObjectStatus(adsetId, "ACTIVE");
  await setObjectStatus(adId, "ACTIVE");
}
