/**
 * Dashboard-only aggregates: winner board, split-test comparison, creative rotation hints.
 */

/**
 * @param {Array<{ campaign?: string, adset?: string, metaAdsetId?: string, metaCampaignId?: string, roas?: number, qualifiedLeads?: number, leads?: number, bookings?: number, spend?: number }>} rows
 */
export function buildWinnerBoard(rows) {
  const list = (rows || []).filter((r) => r && Number(r.spend) > 0);
  const byRoas = [...list].sort((a, b) => Number(b.roas || 0) - Number(a.roas || 0));
  const byQualified = [...list].sort((a, b) => {
    const qa = Number(a.leads) > 0 ? Number(a.qualifiedLeads || 0) / Number(a.leads) : 0;
    const qb = Number(b.leads) > 0 ? Number(b.qualifiedLeads || 0) / Number(b.leads) : 0;
    return qb - qa;
  });
  const byBooking = [...list].sort((a, b) => {
    const ba = Number(a.leads) > 0 ? Number(a.bookings || 0) / Number(a.leads) : 0;
    const bb = Number(b.leads) > 0 ? Number(b.bookings || 0) / Number(b.leads) : 0;
    return bb - ba;
  });
  const pick = (r) =>
    r
      ? {
          campaign: r.campaign,
          adset: r.adset,
          metaAdsetId: r.metaAdsetId,
          roas: Number(r.roas || 0),
          qualifiedRate: Number(r.leads) > 0 ? Number(r.qualifiedLeads || 0) / Number(r.leads) : 0,
          bookingRate: Number(r.leads) > 0 ? Number(r.bookings || 0) / Number(r.leads) : 0,
        }
      : null;
  return {
    topRoas: byRoas.slice(0, 5).map(pick),
    topQualifiedRate: byQualified.slice(0, 5).map(pick),
    topBookingRate: byBooking.slice(0, 5).map(pick),
  };
}

/**
 * Group rows by Meta campaign id when 2+ ad sets share a campaign (split tests).
 * @param {Array<{ metaCampaignId?: string, adset?: string, roas?: number, spend?: number, leads?: number }>} rows
 */
export function buildSplitCompare(rows) {
  const byCamp = new Map();
  for (const r of rows || []) {
    const mid = String(r.metaCampaignId || "").trim();
    if (!mid) continue;
    if (!byCamp.has(mid)) byCamp.set(mid, []);
    byCamp.get(mid).push(r);
  }
  const groups = [];
  const gapWarn = Number(process.env.OPTIMIZER_SPLIT_WARN_ROAS_GAP || 0.5);
  for (const [metaCampaignId, list] of byCamp) {
    if (list.length < 2) continue;
    const scored = list.map((x) => ({
      ...x,
      _roas: Number(x.roas || 0),
    }));
    scored.sort((a, b) => b._roas - a._roas);
    const best = scored[0]?._roas ?? 0;
    const outRows = scored.map((x, rank) => ({
      adset: x.adset,
      metaAdsetId: x.metaAdsetId,
      roas: x._roas,
      spend: Number(x.spend || 0),
      leads: Number(x.leads || 0),
      rank: rank + 1,
      lagVsBestRoas: best - x._roas,
      worstInGroup: rank === scored.length - 1 && scored.length > 1,
      warnGap: best - x._roas >= gapWarn,
    }));
    groups.push({ metaCampaignId, rows: outRows });
  }
  return groups;
}

/**
 * @param {Array<{ name?: string, tier?: string, fatigue?: string, suggestedAction?: string }>} creativeScores
 */
export function buildCreativeRotationHints(creativeScores) {
  const list = Array.isArray(creativeScores) ? creativeScores : [];
  return list
    .filter((c) => c && (c.tier === "cut" || String(c.fatigue || "").toLowerCase() === "high"))
    .slice(0, 12)
    .map((c) => ({
      name: c.name,
      tier: c.tier,
      fatigue: c.fatigue,
      note:
        c.tier === "cut"
          ? "Score tier cut — rotate or replace creative"
          : "High fatigue — refresh creative or tighten frequency",
    }));
}
