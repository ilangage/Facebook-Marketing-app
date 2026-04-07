import { describe, it, expect } from "vitest";
import { computeOptimizerActionForRow } from "./state.js";

const baseT = () => ({
  cpaMax: 6,
  roasMin: 2.5,
  profitRoasMin: 1.2,
  minLeadsForScale: 20,
  minImpressionsForScale: 3000,
  marginAware: false,
  wasteSpendNoLead: 12,
  cpaPauseMinSpend: 6,
  useQualifiedCpa: false,
  useQualifiedMetrics: false,
  minQualifiedRate: 0.12,
  minLeadsForQualifiedCheck: 15,
  noQualifiedPauseLeads: 12,
  noQualifiedPauseSpend: 45,
  minQualifiedLeadsScale: 0,
});

describe("computeOptimizerActionForRow", () => {
  it("pauses waste spend with no leads", () => {
    const t = baseT();
    const a = computeOptimizerActionForRow(
      { adset: "A", spend: 20, leads: 0, roas: 0 },
      t,
      { require_statistical_significance: false }
    );
    expect(a.action).toBe("PAUSE");
    expect(a.reason).toContain("No leads");
  });

  it("pauses when qualified rate is too low", () => {
    const t = { ...baseT(), useQualifiedMetrics: true, minQualifiedRate: 0.12 };
    const a = computeOptimizerActionForRow(
      { adset: "A", spend: 200, leads: 20, qualifiedLeads: 1, roas: 3 },
      t,
      { require_statistical_significance: false }
    );
    expect(a.action).toBe("PAUSE");
    expect(a.reason).toContain("Qualified rate");
  });

  it("scales when ROAS and leads meet bar", () => {
    const t = baseT();
    const a = computeOptimizerActionForRow(
      { adset: "A", spend: 120, leads: 25, roas: 3, metaAdsetId: "x", impressions: 4000 },
      t,
      { require_statistical_significance: true, no_auto_scale_if_leads_below: 20, max_daily_budget_jump_percent: 20 }
    );
    expect(a.action.startsWith("SCALE")).toBe(true);
  });

  it("requires qualified leads for scale when minQualifiedLeadsScale set", () => {
    const t = { ...baseT(), minQualifiedLeadsScale: 8 };
    const hold = computeOptimizerActionForRow(
      { adset: "A", spend: 150, leads: 30, qualifiedLeads: 3, roas: 3, metaAdsetId: "x", impressions: 4000 },
      t,
      { require_statistical_significance: true, no_auto_scale_if_leads_below: 20 }
    );
    expect(hold.action).toBe("HOLD");
    expect(hold.reason).toContain("qualified");

    const scale = computeOptimizerActionForRow(
      { adset: "A", spend: 150, leads: 30, qualifiedLeads: 25, roas: 3, metaAdsetId: "x", impressions: 4000 },
      t,
      { require_statistical_significance: true, no_auto_scale_if_leads_below: 20 }
    );
    expect(scale.action.startsWith("SCALE")).toBe(true);
  });

  it("uses qualified CPA when enabled", () => {
    const t = { ...baseT(), useQualifiedCpa: true, cpaMax: 10 };
    const a = computeOptimizerActionForRow(
      { adset: "A", spend: 200, leads: 40, qualifiedLeads: 10, roas: 2, metaAdsetId: "x", impressions: 4000 },
      t,
      { require_statistical_significance: false }
    );
    expect(a.action).toBe("PAUSE");
    expect(a.reason).toContain("qualified CPA");
  });
});
