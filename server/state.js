const now = Date.now();

function useDemoSeed() {
  if (process.env.SEED_DEMO_DATA === "false") return false;
  if (process.env.SEED_DEMO_DATA === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function buildDemoState() {
  return {
    project: {
      name: "travel-roi-super-bot",
      goal: "qualified_booking_roas",
    },
    kpis: [
      { label: "Qualified Booking ROAS", value: "3.8x", delta: "+22%", positive: true },
      { label: "Qualified CPL", value: "$5.90", delta: "-18%", positive: true },
      { label: "Booking Rate", value: "14.7%", delta: "+3.1%", positive: true },
      { label: "Revenue per Lead", value: "$84", delta: "+11%", positive: true },
    ],
    campaigns: [
      { id: "cmp_1", campaign: "TOF Broad LK", adset: "Broad 21-55", spend: 480, leads: 71, cpa: 6.76, roas: 3.2, status: "ACTIVE" },
      { id: "cmp_2", campaign: "MOF Engagers 30D", adset: "Retarget 30D", spend: 220, leads: 49, cpa: 4.48, roas: 4.6, status: "SCALE" },
      { id: "cmp_3", campaign: "BOF Hot Leads", adset: "Hot 14D", spend: 145, leads: 31, cpa: 4.67, roas: 5.1, status: "ACTIVE" },
      { id: "cmp_4", campaign: "TOF Luxury", adset: "Luxury LK", spend: 310, leads: 22, cpa: 14.09, roas: 1.8, status: "REVIEW" },
    ],
    creatives: [
      {
        id: "cr_1",
        name: "Bali Honeymoon UGC",
        format: "video_30s",
        ctr: 2.9,
        cpc: 0.29,
        cpa: 4.98,
        fatigue: "Low",
        roas: 3.2,
        qualifiedRate: 0.22,
        bookingRate: 0.06,
      },
      {
        id: "cr_2",
        name: "Family Dubai Carousel",
        format: "carousel",
        ctr: 2.3,
        cpc: 0.34,
        cpa: 6.7,
        fatigue: "Medium",
        roas: 2.9,
        qualifiedRate: 0.14,
        bookingRate: 0.04,
      },
      {
        id: "cr_3",
        name: "Maldives Luxury Reel",
        format: "video_15s",
        ctr: 1.4,
        cpc: 0.73,
        cpa: 13.2,
        fatigue: "High",
        roas: 1.8,
        qualifiedRate: 0.08,
        bookingRate: 0.01,
      },
    ],
    audiences: [
      { segment: "hot", users: 1280, sync: "2h ago", retries: 0, status: "Healthy" },
      { segment: "warm", users: 4430, sync: "5h ago", retries: 1, status: "Healthy" },
      { segment: "abandoned", users: 930, sync: "1d ago", retries: 2, status: "Warning" },
    ],
    crmEvents: [
      { event: "lead.created", count: 148, sla: "4m 12s", status: "Good" },
      { event: "lead.qualified", count: 63, sla: "6m 08s", status: "Watch" },
      { event: "deal.won", count: 18, sla: "n/a", status: "Good" },
      { event: "deal.lost", count: 29, sla: "n/a", status: "Good" },
    ],
    optimizerActions: [
      { adset: "Luxury LK", action: "PAUSE", reason: "CPA above threshold", confidence: "High" },
      { adset: "Retarget 30D", action: "SCALE +20%", reason: "ROAS above target", confidence: "High" },
      { adset: "Broad 21-55", action: "HOLD", reason: "Need more sample", confidence: "Medium" },
    ],
    tracking: [],
    assets: {
      images: [],
      videos: [],
      adcreatives: [],
    },
    cronJobs: [
      { name: "sync_hot", schedule: "0 */6 * * *", lastRunAt: now - 2 * 3600000 },
      { name: "sync_warm", schedule: "30 */12 * * *", lastRunAt: now - 5 * 3600000 },
      { name: "pull_insights", schedule: "15 */4 * * *", lastRunAt: now - 60 * 60000 },
      { name: "run_optimizer", schedule: "0 2 * * *", lastRunAt: now - 7 * 3600000 },
    ],
    targeting: {
      strategy: "hybrid_vertical_horizontal",
      no_auto_scale_if_leads_below: 20,
      max_daily_budget_jump_percent: 20,
      require_statistical_significance: true,
    },
    lastAdPreview: {
      pageName: "Your Page",
      primaryText:
        "Explore premium travel packages tailored to your dream destinations — honeymoons, family trips, and luxury escapes.",
      headline: "Book Your Dream Trip",
      description: "Limited-time offers. Tap to see destinations and pricing.",
      linkUrl: "http://localhost:5173",
      displayLink: "localhost",
      cta: "Learn more",
      mediaType: "image",
      mediaUrl: "https://picsum.photos/seed/adpreview/1200/630",
      carouselCards: [],
      deliveryStatus: "PAUSED",
      metaIds: {},
    },
  };
}

function buildMinimalState() {
  return {
    project: {
      name: "travel-roi-super-bot",
      goal: "qualified_booking_roas",
    },
    kpis: [{ label: "Status", value: "Connect Meta + ingest data", delta: "", positive: true }],
    campaigns: [],
    creatives: [],
    audiences: [],
    crmEvents: [],
    optimizerActions: [],
    tracking: [],
    assets: {
      images: [],
      videos: [],
      adcreatives: [],
    },
    cronJobs: [],
    targeting: {
      strategy: "data_driven",
      no_auto_scale_if_leads_below: 20,
      max_daily_budget_jump_percent: Number(process.env.LOOP_SCALE_PERCENT || 20),
      require_statistical_significance: true,
    },
    lastAdPreview: {
      pageName: "Your Page",
      primaryText: "Connect campaigns to see live previews.",
      headline: "Travel ROI Bot",
      description: "",
      linkUrl: "http://localhost:5173",
      displayLink: "localhost",
      cta: "Learn more",
      mediaType: "image",
      mediaUrl: "https://picsum.photos/seed/adpreview/1200/630",
      carouselCards: [],
      deliveryStatus: "PAUSED",
      metaIds: {},
    },
  };
}

export const state = useDemoSeed() ? buildDemoState() : buildMinimalState();

export function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function toMoney(value) {
  return `$${Number(value).toFixed(2)}`;
}

/**
 * Optimizer tuning (env). Use getOptimizerThresholds() for dashboard + tests.
 */
export function getOptimizerThresholds() {
  return {
    cpaMax: Number(process.env.OPTIMIZER_CPA_MAX || 6),
    roasMin: Number(process.env.OPTIMIZER_ROAS_MIN || 2.5),
    profitRoasMin: Number(process.env.OPTIMIZER_PROFIT_ROAS_MIN || 1.2),
    minLeadsForScale: Number(process.env.OPTIMIZER_MIN_LEADS_SCALE || 20),
    minImpressionsForScale: Number(process.env.OPTIMIZER_MIN_IMPRESSIONS || 3000),
    marginAware: process.env.MARGIN_AWARE_OPTIMIZER === "true",
    /** Spend cap with zero leads before PAUSE (waste reduction). */
    wasteSpendNoLead: Number(process.env.OPTIMIZER_WASTE_SPEND_NO_LEAD || 12),
    /** Min spend before CPA-based PAUSE. */
    cpaPauseMinSpend: Number(process.env.OPTIMIZER_CPA_PAUSE_MIN_SPEND || 6),
    /** Use spend/qualified for CPA when true and qualifiedLeads > 0. */
    useQualifiedCpa: process.env.OPTIMIZER_USE_QUALIFIED_CPA === "true",
    /** Pause low-quality lead sources when rate is below this (needs CRM quality ingested). */
    useQualifiedMetrics: process.env.OPTIMIZER_USE_QUALIFIED_METRICS === "true",
    minQualifiedRate: Number(process.env.OPTIMIZER_MIN_QUALIFIED_RATE || 0.12),
    minLeadsForQualifiedCheck: Number(process.env.OPTIMIZER_MIN_LEADS_FOR_QUALIFIED_CHECK || 15),
    /** Pause when many raw leads but zero qualified (signal breakage). */
    noQualifiedPauseLeads: Number(process.env.OPTIMIZER_NO_QUALIFIED_PAUSE_LEADS || 12),
    noQualifiedPauseSpend: Number(process.env.OPTIMIZER_NO_QUALIFIED_PAUSE_SPEND || 45),
    /** When >0, SCALE requires at least this many qualified leads (stronger booking funnel signal). */
    minQualifiedLeadsScale: Number(process.env.OPTIMIZER_MIN_QUALIFIED_LEADS_SCALE || 0),
  };
}

function scalePercentLabelFromTargeting(targeting = state.targeting) {
  const p = targeting?.max_daily_budget_jump_percent ?? 20;
  return `SCALE +${p}%`;
}

/**
 * Pure decision for one campaign row (used by recalculateActions + unit tests).
 * @param {object} item — campaign row with spend, leads, optional qualifiedLeads, bookings, revenue, cogs, roas, profitRoas, impressions
 * @param {ReturnType<typeof getOptimizerThresholds>} t
 * @param {object} [targeting] — state.targeting
 */
export function computeOptimizerActionForRow(item, t, targeting = {}) {
  const minLeads = Math.max(t.minLeadsForScale, Number(targeting?.no_auto_scale_if_leads_below ?? 0));
  const sig = targeting?.require_statistical_significance === true;

  const spend = Number(item.spend ?? 0);
  const leads = Number(item.leads ?? 0);
  const qualifiedLeads = Number(item.qualifiedLeads ?? 0);
  const qualifiedRate = leads > 0 ? qualifiedLeads / leads : 0;

  if (leads === 0 && spend > t.wasteSpendNoLead) {
    return {
      adset: item.adset,
      action: "PAUSE",
      reason: `No leads and spend above $${t.wasteSpendNoLead}`,
      confidence: "High",
    };
  }

  if (
    t.useQualifiedMetrics &&
    leads >= t.minLeadsForQualifiedCheck &&
    qualifiedRate < t.minQualifiedRate
  ) {
    return {
      adset: item.adset,
      action: "PAUSE",
      reason: `Qualified rate ${(qualifiedRate * 100).toFixed(1)}% below ${(t.minQualifiedRate * 100).toFixed(0)}%`,
      confidence: "High",
    };
  }

  if (t.useQualifiedMetrics && qualifiedLeads === 0 && leads >= t.noQualifiedPauseLeads && spend >= t.noQualifiedPauseSpend) {
    return {
      adset: item.adset,
      action: "PAUSE",
      reason: "Spend with leads but no qualified signal (check tracking/CRM)",
      confidence: "High",
    };
  }

  let effectiveCpa = 0;
  if (t.useQualifiedCpa && qualifiedLeads > 0) {
    effectiveCpa = spend / qualifiedLeads;
  } else if (leads > 0) {
    effectiveCpa = spend / leads;
  }
  const cpaLabel = t.useQualifiedCpa && qualifiedLeads > 0 ? "qualified CPA" : "CPA";
  if (effectiveCpa > t.cpaMax && spend > t.cpaPauseMinSpend && (leads > 0 || qualifiedLeads > 0)) {
    return {
      adset: item.adset,
      action: "PAUSE",
      reason: `${cpaLabel} above threshold`,
      confidence: "High",
    };
  }

  const hasMargin =
    t.marginAware && item.cogs != null && Number(item.cogs) > 0 && item.revenue != null;
  const profitRoas =
    hasMargin && spend > 0
      ? (Number(item.revenue) - Number(item.cogs)) / spend
      : item.profitRoas != null
        ? Number(item.profitRoas)
        : Number(item.roas ?? 0);
  const scaleMetric = hasMargin ? profitRoas : Number(item.roas ?? 0);
  const scaleMin = hasMargin ? t.profitRoasMin : t.roasMin;

  const scaleLeadOk =
    t.minQualifiedLeadsScale > 0
      ? qualifiedLeads >= Math.max(minLeads, t.minQualifiedLeadsScale)
      : leads >= minLeads;

  if (scaleMetric >= scaleMin && scaleLeadOk) {
    const liveAdset = Boolean(item.metaAdsetId);
    const impressions = Number(item.impressions ?? 0);
    if (sig && liveAdset && impressions < t.minImpressionsForScale) {
      return {
        adset: item.adset,
        action: "HOLD",
        reason: `Sample too small for scale (${impressions} imps / ${t.minImpressionsForScale} min)`,
        confidence: "Medium",
      };
    }
    return {
      adset: item.adset,
      action: scalePercentLabelFromTargeting(targeting),
      reason: hasMargin ? "Profit ROAS above target" : "ROAS above target",
      confidence: "High",
    };
  }

  if (scaleMetric >= scaleMin && !scaleLeadOk) {
    const need =
      t.minQualifiedLeadsScale > 0
        ? `${Math.max(minLeads, t.minQualifiedLeadsScale)}+ qualified`
        : `${minLeads}+ leads`;
    return {
      adset: item.adset,
      action: "HOLD",
      reason: `ROAS ok but need ${need} for scale`,
      confidence: "Medium",
    };
  }

  return { adset: item.adset, action: "HOLD", reason: "Need more sample", confidence: "Medium" };
}

/**
 * When OPTIMIZER_SPLIT_AUTO_PAUSE=true, mark clear split-test losers for PAUSE (same metaCampaignId, ROAS gap).
 */
function applySplitLoserPause(actions, campaigns) {
  if (process.env.OPTIMIZER_SPLIT_AUTO_PAUSE !== "true") return;
  const gap = Number(process.env.OPTIMIZER_SPLIT_PAUSE_ROAS_GAP || 0.6);
  const maxRoas = Number(process.env.OPTIMIZER_SPLIT_PAUSE_MAX_ROAS || 2);
  const byCamp = new Map();
  for (const c of campaigns) {
    const mid = c.metaCampaignId && String(c.metaCampaignId).trim();
    if (!mid) continue;
    if (!byCamp.has(mid)) byCamp.set(mid, []);
    byCamp.get(mid).push({ roas: Number(c.roas ?? 0), adset: c.adset });
  }
  for (const [, list] of byCamp) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.roas - a.roas);
    const best = list[0].roas;
    for (const x of list.slice(1)) {
      if (best - x.roas < gap || x.roas >= maxRoas) continue;
      const idx = actions.findIndex((a) => a.adset === x.adset);
      if (idx < 0 || actions[idx].action.startsWith("PAUSE")) continue;
      actions[idx] = {
        ...actions[idx],
        action: "PAUSE",
        reason: `Split underperformer vs sibling (ΔROAS ${(best - x.roas).toFixed(2)})`,
        confidence: "Medium",
      };
    }
  }
}

export function recalculateActions() {
  const t = getOptimizerThresholds();
  const actions = state.campaigns.map((item) => computeOptimizerActionForRow(item, t, state.targeting));
  applySplitLoserPause(actions, state.campaigns);
  state.optimizerActions = actions;
}
