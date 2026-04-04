import { state } from "./state.js";

/**
 * Match Meta insights rows to local campaigns via metaAdsetId; update spend (platform-reported).
 */
export function mergeInsightsIntoCampaignRows(raw) {
  const rows = raw?.data;
  if (!Array.isArray(rows)) return { matched: 0, samples: [] };
  let matched = 0;
  const samples = [];
  for (const r of rows) {
    const adsetId = r.adset_id != null ? String(r.adset_id) : null;
    if (!adsetId) continue;
    const c = state.campaigns.find((row) => row.metaAdsetId && String(row.metaAdsetId) === adsetId);
    if (!c) continue;
    const spend = Number(r.spend ?? 0);
    if (!Number.isNaN(spend)) c.spend = spend;
    const impressions = Number(r.impressions ?? 0);
    if (!Number.isNaN(impressions)) c.impressions = impressions;
    const clicks = Number(r.clicks ?? 0);
    if (!Number.isNaN(clicks)) c.clicks = clicks;
    samples.push({
      metaAdsetId: adsetId,
      campaignName: c.campaign,
      adsetName: c.adset,
      spend,
      clicks: Number(r.clicks ?? 0),
      impressions: Number(r.impressions ?? 0),
    });
    matched += 1;
  }
  return { matched, samples };
}
