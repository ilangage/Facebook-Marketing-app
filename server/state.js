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
      { id: "cr_1", name: "Bali Honeymoon UGC", format: "video_30s", ctr: 2.9, cpc: 0.29, cpa: 4.98, fatigue: "Low" },
      { id: "cr_2", name: "Family Dubai Carousel", format: "carousel", ctr: 2.3, cpc: 0.34, cpa: 6.7, fatigue: "Medium" },
      { id: "cr_3", name: "Maldives Luxury Reel", format: "video_15s", ctr: 1.4, cpc: 0.73, cpa: 13.2, fatigue: "High" },
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

function optimizerThresholds() {
  return {
    cpaMax: Number(process.env.OPTIMIZER_CPA_MAX || 6),
    roasMin: Number(process.env.OPTIMIZER_ROAS_MIN || 2.5),
    profitRoasMin: Number(process.env.OPTIMIZER_PROFIT_ROAS_MIN || 1.2),
    minLeadsForScale: Number(process.env.OPTIMIZER_MIN_LEADS_SCALE || 20),
    minImpressionsForScale: Number(process.env.OPTIMIZER_MIN_IMPRESSIONS || 3000),
    marginAware: process.env.MARGIN_AWARE_OPTIMIZER === "true",
  };
}

function scalePercentLabel() {
  const p = state.targeting?.max_daily_budget_jump_percent ?? 20;
  return `SCALE +${p}%`;
}

export function recalculateActions() {
  const t = optimizerThresholds();
  const minLeads = Math.max(t.minLeadsForScale, Number(state.targeting?.no_auto_scale_if_leads_below ?? 0));
  const sig = state.targeting?.require_statistical_significance === true;

  state.optimizerActions = state.campaigns.map((item) => {
    if (item.leads === 0 && item.spend > 12) {
      return { adset: item.adset, action: "PAUSE", reason: "No leads and spend too high", confidence: "High" };
    }
    if (item.cpa > t.cpaMax && item.spend > 6) {
      return { adset: item.adset, action: "PAUSE", reason: "CPA above threshold", confidence: "High" };
    }
    const hasMargin =
      t.marginAware && item.cogs != null && Number(item.cogs) > 0 && item.revenue != null;
    const profitRoas =
      hasMargin && item.spend > 0
        ? (Number(item.revenue) - Number(item.cogs)) / item.spend
        : item.profitRoas != null
          ? item.profitRoas
          : item.roas;
    const scaleMetric = hasMargin ? profitRoas : item.roas;
    const scaleMin = hasMargin ? t.profitRoasMin : t.roasMin;

    if (scaleMetric >= scaleMin && item.leads >= minLeads) {
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
        action: scalePercentLabel(),
        reason: hasMargin ? "Profit ROAS above target" : "ROAS above target",
        confidence: "High",
      };
    }
    return { adset: item.adset, action: "HOLD", reason: "Need more sample", confidence: "Medium" };
  });
}
