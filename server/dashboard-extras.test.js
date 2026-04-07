import { describe, it, expect } from "vitest";
import { buildWinnerBoard, buildSplitCompare, buildCreativeRotationHints } from "./dashboard-extras.js";

describe("dashboard-extras", () => {
  it("buildWinnerBoard ranks by roas and rates", () => {
    const rows = [
      { adset: "A", spend: 10, roas: 2, leads: 10, qualifiedLeads: 2, bookings: 1 },
      { adset: "B", spend: 10, roas: 4, leads: 10, qualifiedLeads: 5, bookings: 2 },
    ];
    const wb = buildWinnerBoard(rows);
    expect(wb.topRoas[0].adset).toBe("B");
    expect(wb.topQualifiedRate[0].adset).toBe("B");
  });

  it("buildSplitCompare groups by meta campaign id", () => {
    const rows = [
      { metaCampaignId: "c1", adset: "s1", roas: 3, spend: 5, leads: 3 },
      { metaCampaignId: "c1", adset: "s2", roas: 1.5, spend: 5, leads: 3 },
    ];
    const g = buildSplitCompare(rows);

    expect(g.length).toBe(1);
    expect(g[0].rows.length).toBe(2);
    expect(g[0].rows[0].rank).toBe(1);
    expect(g[0].rows[1].worstInGroup).toBe(true);
  });

  it("buildCreativeRotationHints filters cut / high fatigue", () => {
    const hints = buildCreativeRotationHints([
      { name: "X", tier: "cut", fatigue: "Low" },
      { name: "Y", tier: "winner", fatigue: "High" },
    ]);
    expect(hints.some((h) => h.name === "X")).toBe(true);
    expect(hints.some((h) => h.name === "Y")).toBe(true);
  });
});
