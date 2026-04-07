/**
 * Heuristic creative score 0–100 (ROAS-oriented, not CTR-only).
 * Optional `roas`, `qualifiedRate`, `bookingRate` (0–1) tighten winner detection when CRM/engine data exists.
 */
export function scoreCreative({
  ctr = 0,
  cpc = 0,
  cpa = 0,
  fatigue = "Low",
  roas = null,
  qualifiedRate = null,
  bookingRate = null,
} = {}) {
  const ctrN = Number(String(ctr).replace("%", "")) || 0;
  const cpcN = Number(String(cpc).replace(/[^0-9.]/g, "")) || 0;
  const cpaN = Number(String(cpa).replace(/[^0-9.]/g, "")) || 0;
  const roasN = roas != null && roas !== "" ? Number(String(roas).replace(/[^0-9.]/g, "")) : null;
  const qRate = qualifiedRate != null && qualifiedRate !== "" ? Number(qualifiedRate) : null;
  const bRate = bookingRate != null && bookingRate !== "" ? Number(bookingRate) : null;

  let score = 50;
  score += Math.min(20, ctrN * 2);
  score -= Math.min(15, cpcN * 10);
  score -= Math.min(20, Math.max(0, cpaN - 5) * 2);
  if (fatigue === "High") score -= 15;
  if (fatigue === "Medium") score -= 7;
  if (fatigue === "Low") score += 5;

  /** Down-funnel bonuses — surface winners faster when measurement exists */
  if (roasN != null && Number.isFinite(roasN)) {
    if (roasN >= 4) score += 14;
    else if (roasN >= 2.5) score += 10;
    else if (roasN >= 1.5) score += 4;
    else if (roasN < 1) score -= 8;
  }
  if (qRate != null && Number.isFinite(qRate)) {
    score += Math.min(12, qRate * 40);
  }
  if (bRate != null && Number.isFinite(bRate)) {
    score += Math.min(10, bRate * 120);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  /** Strong signals lower the bar from 75 → 70 for "winner" */
  const strong =
    (roasN != null && roasN >= 3 && qRate != null && qRate >= 0.15) ||
    (roasN != null && roasN >= 3.5) ||
    (bRate != null && bRate >= 0.08 && qRate != null && qRate >= 0.12);
  const winnerCut = strong ? 70 : 75;
  const keepCut = strong ? 50 : 55;

  let tier = "test";
  if (score >= winnerCut) tier = "winner";
  else if (score >= keepCut) tier = "keep";
  else tier = "cut";

  return {
    score,
    tier,
    signals: {
      ctr: ctrN,
      cpc: cpcN,
      cpa: cpaN,
      fatigue,
      roas: roasN,
      qualifiedRate: qRate,
      bookingRate: bRate,
    },
  };
}

export function scoreCreativesList(rows) {
  return rows.map((row) => ({
    name: row.name,
    format: row.format,
    ...scoreCreative({
      ctr: row.ctr,
      cpc: row.cpc,
      cpa: row.cpa,
      fatigue: row.fatigue,
      roas: row.roas,
      qualifiedRate: row.qualifiedRate,
      bookingRate: row.bookingRate,
    }),
  }));
}
