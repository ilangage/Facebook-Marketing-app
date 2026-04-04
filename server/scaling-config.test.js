import { describe, it, expect } from "vitest";
import { clampBudgetMinor, getScalingConfig, getEffectiveScaleMultiplier } from "./scaling-config.js";

describe("scaling-config", () => {
  it("clamps budget to min/max", () => {
    const cfg = { minMinor: 500, maxMinor: 10000, scaleMultiplier: 1.2, cooldownMs: 0 };
    expect(clampBudgetMinor(50, cfg)).toBe(500);
    expect(clampBudgetMinor(999999, cfg)).toBe(10000);
    expect(clampBudgetMinor(1000, cfg)).toBe(1000);
  });

  it("reads env-backed config", () => {
    const c = getScalingConfig();
    expect(c.minMinor).toBeGreaterThanOrEqual(100);
    expect(c.maxMinor).toBeGreaterThanOrEqual(c.minMinor);
  });

  it("uses targeting percent for scale multiplier", () => {
    expect(getEffectiveScaleMultiplier({ max_daily_budget_jump_percent: 15 })).toBeCloseTo(1.15);
  });
});
