/**
 * Heuristic creative score 0–100 (ROAS-oriented, not CTR-only).
 * Pass numeric ctr (%), cpc, cpa, fatigue string.
 */
export function scoreCreative({ ctr = 0, cpc = 0, cpa = 0, fatigue = "Low" }) {
  const ctrN = Number(String(ctr).replace("%", "")) || 0;
  const cpcN = Number(String(cpc).replace(/[^0-9.]/g, "")) || 0;
  const cpaN = Number(String(cpa).replace(/[^0-9.]/g, "")) || 0;

  let score = 50;
  score += Math.min(20, ctrN * 2);
  score -= Math.min(15, cpcN * 10);
  score -= Math.min(20, Math.max(0, cpaN - 5) * 2);
  if (fatigue === "High") score -= 15;
  if (fatigue === "Medium") score -= 7;
  if (fatigue === "Low") score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  let tier = "test";
  if (score >= 75) tier = "winner";
  else if (score >= 55) tier = "keep";
  else tier = "cut";

  return { score, tier, signals: { ctr: ctrN, cpc: cpcN, cpa: cpaN, fatigue } };
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
    }),
  }));
}
