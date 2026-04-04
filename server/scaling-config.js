/**
 * Safe budget scaling limits (minor currency units, e.g. cents).
 * Meta adset daily_budget is stored in minor units for most accounts.
 */
export function getScalingConfig() {
  return {
    minMinor: Math.max(100, Number(process.env.LOOP_SCALE_MIN_MINOR || 100)),
    maxMinor: Math.max(100, Number(process.env.LOOP_SCALE_MAX_MINOR || 50_000_000)),
    scaleMultiplier: 1 + Number(process.env.LOOP_SCALE_PERCENT || 20) / 100,
    cooldownMs: Math.max(0, Number(process.env.LOOP_SCALE_COOLDOWN_MS || 86_400_000)),
  };
}

export function clampBudgetMinor(next, cfg) {
  const n = Math.round(Number(next || 0));
  return Math.min(cfg.maxMinor, Math.max(cfg.minMinor, n));
}

/** Effective scale multiplier: state.targeting.max_daily_budget_jump_percent overrides LOOP_SCALE_PERCENT when provided. */
export function getEffectiveScaleMultiplier(targeting) {
  const fromState = targeting?.max_daily_budget_jump_percent;
  const pct =
    fromState != null && !Number.isNaN(Number(fromState))
      ? Number(fromState)
      : Number(process.env.LOOP_SCALE_PERCENT || 20);
  return 1 + pct / 100;
}
