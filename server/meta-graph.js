/**
 * Meta Marketing API helpers (Graph).
 * Requires: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (act_...)
 * For creatives/ads: META_PAGE_ID, optional META_PIXEL_ID, optional META_INSTAGRAM_ACTOR_ID (IG professional account for IG placements)
 */

import { validateAdCopyForLinkCreative } from "./meta-creative-validate.js";

/** Preset keys merged into ad set `targeting` (unless user already set those keys). */
const PLACEMENT_PRESETS = {
  /** Facebook + Instagram feeds/reels/stories, mobile only */
  fb_ig_mobile: {
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "story", "reels"],
    device_platforms: ["mobile"],
  },
  /** Same placements, mobile + desktop */
  fb_ig_all_devices: {
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "story", "reels"],
    device_platforms: ["mobile", "desktop"],
  },
};

function getPlacementFragmentToMerge() {
  const raw = (process.env.META_PLACEMENT_TARGETING_JSON || "").trim();
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object" && !Array.isArray(o)) return o;
    } catch {
      /* ignore invalid JSON; fall back to preset */
    }
  }
  const preset = (process.env.META_PLACEMENT_PRESET || "fb_ig_mobile").trim();
  if (preset === "auto" || preset === "none") return null;
  return PLACEMENT_PRESETS[preset] || PLACEMENT_PRESETS.fb_ig_mobile;
}

/**
 * Merges placement-related keys into ad set targeting. User/geo/age/locales take precedence when already set.
 * @param {Record<string, unknown>} targeting
 * @param {{ skipPlacementMerge?: boolean, placementTargeting?: Record<string, unknown> }} [body]
 */
export function mergePlacementIntoTargeting(targeting, body = {}) {
  const out = { ...targeting };
  if (body.placementTargeting && typeof body.placementTargeting === "object") {
    return { ...out, ...body.placementTargeting };
  }
  if (body.skipPlacementMerge === true) return out;
  const frag = getPlacementFragmentToMerge();
  if (!frag) return out;
  for (const [k, v] of Object.entries(frag)) {
    if (out[k] === undefined || out[k] === null) {
      out[k] = v;
    }
  }
  return out;
}

export function getMetaConfig() {
  const token = process.env.META_ACCESS_TOKEN || "";
  let adAccountId = process.env.META_AD_ACCOUNT_ID || "";
  if (adAccountId && !adAccountId.startsWith("act_")) {
    adAccountId = `act_${adAccountId}`;
  }
  return {
    token,
    adAccountId,
    pageId: process.env.META_PAGE_ID || "",
    pixelId: process.env.META_PIXEL_ID || "",
    /** Instagram professional account ID — required for many IG placements when using explicit placements */
    instagramActorId: (process.env.META_INSTAGRAM_ACTOR_ID || "").trim(),
    apiVersion: process.env.META_API_VERSION || "v23.0",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",
  };
}

export function isMetaConfigured() {
  const c = getMetaConfig();
  return Boolean(c.token && c.adAccountId);
}

/** Defaults aligned with goal qualified_booking_roas (conversions + revenue), not traffic clicks. */
export function getDefaultCampaignDefaults() {
  return {
    objective: process.env.META_DEFAULT_OBJECTIVE || "OUTCOME_SALES",
    optimizationGoal: process.env.META_DEFAULT_OPTIMIZATION_GOAL || "OFFSITE_CONVERSIONS",
    customEventType: process.env.META_CUSTOM_EVENT_TYPE || "PURCHASE",
  };
}

/**
 * Convert major currency units (e.g. dollars) to Meta minor units for daily_budget.
 * META_CURRENCY_MINOR_EXPONENT: 2 for USD/EUR, 0 for JPY (whole currency).
 */
export function majorCurrencyToMinorUnits(majorAmount) {
  const exp = Number(process.env.META_CURRENCY_MINOR_EXPONENT ?? 2);
  const m = Number(majorAmount || 0);
  if (!Number.isFinite(m) || m <= 0) return exp <= 0 ? 1 : 100;
  if (exp <= 0) return Math.max(1, Math.round(m));
  const factor = 10 ** exp;
  return Math.max(factor, Math.round(m * factor));
}

function toFormBody(token, params) {
  const body = new URLSearchParams();
  body.set("access_token", token);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      body.set(key, JSON.stringify(value));
    } else {
      body.set(key, String(value));
    }
  }
  return body;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Graph request failed (${res.status})`);
      err.meta = data?.error || { status: res.status };
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function graphPostForm(path, params) {
  const c = getMetaConfig();
  if (!c.token) {
    throw new Error("META_ACCESS_TOKEN is missing");
  }
  const url = `https://graph.facebook.com/${c.apiVersion}${path.startsWith("/") ? path : `/${path}`}`;
  const body = toFormBody(c.token, params);
  const data = await fetchJsonWithTimeout(url, { method: "POST", body });
  if (data.error) {
    const err = new Error(data.error.message || JSON.stringify(data.error));
    err.meta = data.error;
    throw err;
  }
  return data;
}

/**
 * Meta targeting search (interests, behaviors, work titles, employers, …).
 * @see https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
 */
export async function searchTargetingCatalog({ q, type, limit = 25, countryCode }) {
  const c = getMetaConfig();
  if (!c.token || !c.adAccountId) {
    throw new Error("META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required for targeting search");
  }
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const query = String(q || "").trim();
  if (!query) {
    throw new Error("Query q is required");
  }
  const t = String(type || "adinterest").trim();
  const cc = String(countryCode || "")
    .trim()
    .toUpperCase();
  const params = {
    q: query,
    type: t,
    limit: lim,
  };
  /** Scopes audience estimates to this country (Meta `country_code` on ad account targetingsearch). */
  if (cc && /^[A-Z]{2}$/.test(cc)) {
    params.country_code = cc;
  }
  const raw = await graphGet(`/${c.adAccountId}/targetingsearch`, params);
  const data = Array.isArray(raw.data) ? raw.data : [];
  return data.map((row) => ({
    id: row.id != null ? String(row.id) : "",
    name: row.name || "",
    type: row.type || t,
    audience_size: row.audience_size != null ? Number(row.audience_size) : null,
    path: Array.isArray(row.path) ? row.path : [],
  }));
}

export async function graphGet(path, query = {}) {
  const c = getMetaConfig();
  if (!c.token) {
    throw new Error("META_ACCESS_TOKEN is missing");
  }
  const url = new URL(`https://graph.facebook.com/${c.apiVersion}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const data = await fetchJsonWithTimeout(url.href, {
    headers: {
      Authorization: `Bearer ${c.token}`,
    },
  });
  if (data.error) {
    const err = new Error(data.error.message || JSON.stringify(data.error));
    err.meta = data.error;
    throw err;
  }
  return data;
}

/** DELETE /{object-id} — best-effort cleanup when campaign chain fails mid-flight */
export async function deleteGraphObject(objectId) {
  if (!objectId) return null;
  const c = getMetaConfig();
  if (!c.token) {
    throw new Error("META_ACCESS_TOKEN is missing");
  }
  const url = `https://graph.facebook.com/${c.apiVersion}/${objectId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${c.token}` },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from Graph DELETE ${objectId}`);
      }
    }
    if (data.error) {
      const err = new Error(data.error.message || JSON.stringify(data.error));
      err.meta = data.error;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Graph DELETE failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function rollbackPartialCampaignChain(partial) {
  const order = [
    partial.ad?.id,
    partial.creative?.id,
    partial.adset?.id,
    partial.campaign?.id,
  ].filter(Boolean);
  for (const id of order) {
    try {
      await deleteGraphObject(id);
    } catch {
      /* best-effort; log only in caller if needed */
    }
  }
}

/** Upload image by public HTTPS URL → returns Graph response (images.{hash}) */
export async function uploadAdImageFromUrl(imageUrl, name) {
  const c = getMetaConfig();
  return graphPostForm(`/${c.adAccountId}/adimages`, {
    url: imageUrl,
    name: name || "image",
  });
}

/** Upload video by public HTTPS URL (file_url) → returns { id: video_id } */
export async function uploadAdVideoFromFileUrl(fileUrl, name) {
  const c = getMetaConfig();
  return graphPostForm(`/${c.adAccountId}/advideos`, {
    file_url: fileUrl,
    name: name || "video",
  });
}

export async function createLinkAdCreative(payload) {
  const c = getMetaConfig();
  if (!c.pageId) {
    throw new Error("META_PAGE_ID is required to create ad creatives");
  }
  const link = payload.link || c.appBaseUrl;
  const message = payload.message || "Explore travel packages";
  const headline = payload.headline || "Travel Deals";
  const description = payload.description || "Book your trip";
  validateAdCopyForLinkCreative({ message, headline, description });

  const rawCards = Array.isArray(payload.carouselCards) ? payload.carouselCards.filter(Boolean) : [];
  let object_story_spec;
  if (rawCards.length >= 2) {
    const child_attachments = rawCards.map((card, idx) => {
      if (!card.imageHash) {
        throw new Error(`carouselCards[${idx}] requires imageHash`);
      }
      const cardLink = card.link || link;
      const cardName = card.headline || card.name || `Card ${idx + 1}`;
      const attachment = {
        link: cardLink,
        name: cardName,
        description: card.description || "",
        image_hash: card.imageHash,
      };
      return attachment;
    });
    object_story_spec = {
      page_id: c.pageId,
      link_data: {
        link,
        message,
        name: headline,
        description,
        child_attachments,
      },
    };
  } else if (payload.videoId) {
    object_story_spec = {
      page_id: c.pageId,
      video_data: {
        video_id: payload.videoId,
        title: headline,
        message,
        call_to_action: {
          type: "LEARN_MORE",
          value: { link },
        },
      },
    };
  } else if (payload.imageHash) {
    object_story_spec = {
      page_id: c.pageId,
      link_data: {
        link,
        message,
        name: headline,
        description,
        image_hash: payload.imageHash,
      },
    };
  } else {
    throw new Error("Provide carouselCards (2+) or imageHash or videoId for creative");
  }

  if (c.instagramActorId) {
    object_story_spec.instagram_actor_id = c.instagramActorId;
  }

  return graphPostForm(`/${c.adAccountId}/adcreatives`, {
    name: payload.name || "Travel Creative",
    object_story_spec,
  });
}

/**
 * Create campaign → ad set → creative → ad (all PAUSED by default).
 * dailyBudget: dollars in request; sent to Meta as minor units (×100 for USD-style accounts).
 */
export async function createCampaignChain(body) {
  const c = getMetaConfig();
  const defs = getDefaultCampaignDefaults();
  const objective = body.objective || defs.objective;
  const optimizationGoal = body.optimizationGoal || defs.optimizationGoal;
  const customEventType = body.customEventType || defs.customEventType;

  const partial = { campaign: null, adset: null, creative: null, ad: null };

  try {
    partial.campaign = await graphPostForm(`/${c.adAccountId}/campaigns`, {
      name: body.campaignName || "Travel Campaign",
      objective,
      status: body.status || "PAUSED",
      special_ad_categories: [],
    });

    const dailyBudgetMinor = majorCurrencyToMinorUnits(Number(body.dailyBudget || 20));
    /** Non-empty `targeting` from UI/API replaces defaults; omit or `{}` keeps legacy demo fallback. */
    let targeting =
      body.targeting && typeof body.targeting === "object" && Object.keys(body.targeting).length > 0
        ? body.targeting
        : {
            geo_locations: { countries: ["LK"] },
            age_min: 21,
            age_max: 55,
            locales: [1000],
          };

    targeting = mergePlacementIntoTargeting(targeting, body);

    const adsetPayload = {
      name: body.adsetName || "Travel Ad Set",
      campaign_id: partial.campaign.id,
      daily_budget: dailyBudgetMinor,
      billing_event: "IMPRESSIONS",
      optimization_goal: optimizationGoal,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      status: "PAUSED",
      start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    if (optimizationGoal === "OFFSITE_CONVERSIONS") {
      if (!c.pixelId) {
        throw new Error(
          "META_PIXEL_ID is required for OFFSITE_CONVERSIONS (sales / ROAS). Set pixel or override optimizationGoal/objective."
        );
      }
      adsetPayload.promoted_object = {
        pixel_id: c.pixelId,
        custom_event_type: customEventType,
      };
    }

    partial.adset = await graphPostForm(`/${c.adAccountId}/adsets`, adsetPayload);

    partial.creative = await createLinkAdCreative({
      name: body.creativeName || "Travel Creative",
      imageHash: body.imageHash,
      videoId: body.videoId,
      carouselCards: body.carouselCards,
      link: body.link,
      message: body.message,
      headline: body.headline,
      description: body.description,
    });

    partial.ad = await graphPostForm(`/${c.adAccountId}/ads`, {
      name: body.adName || "Travel Ad",
      adset_id: partial.adset.id,
      creative: { creative_id: partial.creative.id },
      status: "PAUSED",
    });

    return {
      campaign: partial.campaign,
      adset: partial.adset,
      creative: partial.creative,
      ad: partial.ad,
    };
  } catch (err) {
    await rollbackPartialCampaignChain(partial);
    throw err;
  }
}

export async function getAdAccountInsights() {
  const c = getMetaConfig();
  return graphGet(`/${c.adAccountId}/insights`, {
    fields:
      "campaign_name,adset_name,adset_id,spend,clicks,cpc,ctr,reach,impressions,actions,purchase_roas",
    level: "adset",
    date_preset: "last_7d",
  });
}

/** POST /{object-id} — e.g. activate/pause an ad, ad set, or campaign */
export async function setObjectStatus(objectId, status) {
  if (!objectId) {
    throw new Error("objectId is required");
  }
  return graphPostForm(`/${objectId}`, { status });
}

export async function getAdsetById(adsetId) {
  if (!adsetId) throw new Error("adsetId is required");
  return graphGet(`/${adsetId}`, { fields: "id,name,daily_budget,status" });
}

export async function updateAdsetDailyBudget(adsetId, dailyBudgetMinor) {
  if (!adsetId) throw new Error("adsetId is required");
  const next = Math.max(100, Math.round(Number(dailyBudgetMinor || 0)));
  return graphPostForm(`/${adsetId}`, { daily_budget: next });
}

export function extractImageHashFromAdImagesResponse(data) {
  if (!data?.images) return null;
  const keys = Object.keys(data.images);
  if (!keys.length) return null;
  const first = data.images[keys[0]];
  return first?.hash || keys[0];
}

export async function activateDeliveryChain({ campaignId, adsetId, adId }) {
  await setObjectStatus(campaignId, "ACTIVE");
  await setObjectStatus(adsetId, "ACTIVE");
  await setObjectStatus(adId, "ACTIVE");
}
