import { describe, it, expect } from "vitest";
import { scoreCreative, scoreCreativesList } from "./creative-score.js";

describe("scoreCreative", () => {
  it("boosts score with strong ROAS and funnel rates", () => {
    const base = scoreCreative({ ctr: 2, cpc: 0.4, cpa: 5, fatigue: "Low" });
    const rich = scoreCreative({
      ctr: 2,
      cpc: 0.4,
      cpa: 5,
      fatigue: "Low",
      roas: 3.5,
      qualifiedRate: 0.2,
      bookingRate: 0.06,
    });
    expect(rich.score).toBeGreaterThan(base.score);
  });

  it("labels winner faster when strong signal (lower cut)", () => {
    const s = scoreCreative({
      ctr: 2.5,
      cpc: 0.35,
      cpa: 5,
      fatigue: "Low",
      roas: 3.2,
      qualifiedRate: 0.18,
      bookingRate: 0.05,
    });
    expect(s.tier).toBe("winner");
  });

  it("scoreCreativesList passes through optional fields", () => {
    const list = scoreCreativesList([
      { name: "A", format: "video", ctr: 2, cpc: 0.3, cpa: 5, fatigue: "Low", roas: 4, qualifiedRate: 0.25 },
    ]);
    expect(list[0].tier).toBe("winner");
    expect(list[0].signals.roas).toBe(4);
  });
});
