/**
 * Meta Conversions API (server-side) — proof + dedup via event_id.
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api
 */
import { getMetaConfig } from "./meta-graph.js";
import { getDb, logCapiResult, listCapiLog } from "./db/sqlite.js";
import { recomputeTrackingHealthFromCapiLog } from "./engine-store.js";

function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .then(async (res) => {
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      return { res, data };
    })
    .finally(() => clearTimeout(timer));
}

/**
 * @param {object} opts
 * @param {string} opts.eventName — e.g. Purchase, Lead
 * @param {string} [opts.eventId] — dedup key (pair with browser pixel)
 * @param {number} [opts.eventTime] — unix seconds
 * @param {string} [opts.eventSourceUrl]
 * @param {object} [opts.customData] — value, currency, content_name, etc.
 * @param {object} [opts.userData] — em (hashed), ph, etc. (already hashed per Meta spec)
 */
export async function sendCapiEvent(opts = {}) {
  const c = getMetaConfig();
  if (!c.token) throw new Error("META_ACCESS_TOKEN is missing");
  if (!c.pixelId) throw new Error("META_PIXEL_ID is required for Conversions API");

  const eventTime = opts.eventTime != null ? Number(opts.eventTime) : Math.floor(Date.now() / 1000);
  const eventId = opts.eventId || `srv_${eventTime}_${Math.random().toString(36).slice(2, 12)}`;
  const event = {
    event_name: opts.eventName || "Purchase",
    event_time: eventTime,
    event_id: eventId,
    action_source: opts.actionSource || "website",
    ...(opts.eventSourceUrl ? { event_source_url: opts.eventSourceUrl } : {}),
    ...(opts.customData ? { custom_data: opts.customData } : {}),
    ...(opts.userData ? { user_data: opts.userData } : {}),
  };

  const url = new URL(`https://graph.facebook.com/${c.apiVersion}/${c.pixelId}/events`);
  url.searchParams.set("access_token", c.token);

  const { res, data } = await fetchJsonWithTimeout(
    url.href,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
    },
    20000
  );

  const db = getDb();
  logCapiResult(db, {
    eventId,
    eventName: event.event_name,
    pixelId: c.pixelId,
    httpStatus: res.status,
    responseJson: JSON.stringify(data),
  });
  try {
    recomputeTrackingHealthFromCapiLog();
  } catch {
    /* non-fatal */
  }

  if (!res.ok) {
    const err = new Error(data?.error?.message || `CAPI failed (${res.status})`);
    err.meta = data?.error || data;
    throw err;
  }
  return { ok: true, eventId, events_received: data.events_received, fbtrace_id: data.fbtrace_id, raw: data };
}

export function listRecentCapiEvents(limit = 40) {
  const db = getDb();
  return listCapiLog(db, limit);
}
