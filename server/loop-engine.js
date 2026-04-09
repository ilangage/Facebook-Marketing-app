import { state, recalculateActions } from "./state.js";
import {
  pushDecision,
  applyPersistedPerformanceToState,
  getLastScaleAt,
  recordScaleHistory,
  getInsightsFreshness,
} from "./engine-store.js";
import {
  isMetaConfigured,
  setObjectStatus,
  getAdsetById,
  getCampaignById,
  updateAdsetDailyBudget,
  updateCampaignDailyBudget,
  isCampaignBudgetOptimization,
} from "./meta-graph.js";
import { getScalingConfig, clampBudgetMinor, getEffectiveScaleMultiplier } from "./scaling-config.js";

function useMockMeta() {
  return process.env.META_USE_MOCK === "true" || !isMetaConfigured();
}

function loopApplyMeta() {
  return process.env.LOOP_APPLY_META === "true";
}

function loopApplyScale() {
  return process.env.LOOP_APPLY_SCALE === "true";
}

/**
 * Analyze → decide → act (in-memory) + persist decision log.
 * When LOOP_APPLY_META=true and Meta IDs exist on a row, PAUSE actions call Graph (live only).
 */
export async function runLoopTick() {
  applyPersistedPerformanceToState();
  recalculateActions();
  const actions = state.optimizerActions.map((a) => ({
    ...a,
    at: new Date().toISOString(),
  }));

  const live = !useMockMeta();
  const applyMeta = loopApplyMeta();
  const applyScale = loopApplyScale();
  const metaResults = [];

  for (const action of actions) {
    const row = state.campaigns.find((c) => c.adset === action.adset);
    if (!row) continue;
    if (action.action.startsWith("PAUSE")) {
      row.status = "PAUSED";
      if (live && applyMeta && row.metaAdsetId) {
        try {
          await setObjectStatus(row.metaAdsetId, "PAUSED");
          if (row.metaCampaignId) {
            await setObjectStatus(row.metaCampaignId, "PAUSED");
          }
          metaResults.push({ adset: action.adset, ok: true, meta: "paused adset+campaign" });
        } catch (e) {
          metaResults.push({ adset: action.adset, ok: false, error: e.message });
        }
      }
    }
    if (action.action.startsWith("SCALE")) {
      row.status = "SCALE";
      if (live && applyScale && row.metaAdsetId) {
        try {
          if (blockScaleOnStaleInsights() && getInsightsFreshness().stale) {
            const fr = getInsightsFreshness();
            metaResults.push({
              adset: action.adset,
              ok: false,
              skipped: "stale_insights",
              error: `Insights older than ${fr.maxAgeMs}ms — refresh GET /api/meta/insights before scale`,
            });
            continue;
          }
          const cfg = getScalingConfig();
          const last = getLastScaleAt(row.metaAdsetId);
          if (cfg.cooldownMs > 0 && last && Date.now() - last < cfg.cooldownMs) {
            metaResults.push({
              adset: action.adset,
              ok: false,
              skipped: "cooldown",
              error: `Scale cooldown active (${Math.ceil(cfg.cooldownMs / 3600000)}h)`,
            });
          } else {
            const useCbo = isCampaignBudgetOptimization();
            const mult = getEffectiveScaleMultiplier(state.targeting);
            let currentMinor = 0;
            let nextMinor = 0;
            if (useCbo && row.metaCampaignId) {
              const camp = await getCampaignById(row.metaCampaignId);
              currentMinor = Number(camp.daily_budget || 0);
              const rawNext = Math.round(currentMinor * mult);
              nextMinor = clampBudgetMinor(rawNext, cfg);
              await updateCampaignDailyBudget(row.metaCampaignId, nextMinor);
            } else {
              const adset = await getAdsetById(row.metaAdsetId);
              currentMinor = Number(adset.daily_budget || 0);
              const rawNext = Math.round(currentMinor * mult);
              nextMinor = clampBudgetMinor(rawNext, cfg);
              await updateAdsetDailyBudget(row.metaAdsetId, nextMinor);
            }
            recordScaleHistory(row.metaAdsetId, nextMinor);
            metaResults.push({
              adset: action.adset,
              ok: true,
              meta:
                useCbo && row.metaCampaignId
                  ? `scaled campaign budget ${currentMinor}→${nextMinor} (CBO, min ${cfg.minMinor} max ${cfg.maxMinor})`
                  : `scaled adset budget ${currentMinor}→${nextMinor} (min ${cfg.minMinor} max ${cfg.maxMinor})`,
            });
          }
        } catch (e) {
          metaResults.push({ adset: action.adset, ok: false, error: e.message });
        }
      }
    }
  }

  await pushDecision({
    type: "loop_tick",
    at: new Date().toISOString(),
    actions,
    goal: state.project.goal,
    liveMeta: live,
    loopApplyMeta: applyMeta,
    loopApplyScale: applyScale,
    metaApi: metaResults.length ? metaResults : undefined,
  });

  return { ok: true, actions, liveMeta: live, loopApplyMeta: applyMeta, loopApplyScale: applyScale, metaApi: metaResults };
}
