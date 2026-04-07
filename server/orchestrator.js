import { state, nextId, recalculateActions } from "./state.js";
import {
  isMetaConfigured,
  uploadAdImageFromUrl,
  uploadAdVideoFromFileUrl,
  createCampaignChain,
  extractImageHashFromAdImagesResponse,
  getDefaultCampaignDefaults,
  normalizeAdsetSpecs,
  setObjectStatus,
} from "./meta-graph.js";
import { evaluatePublishPolicy } from "./policy.js";
import {
  pushJob,
  persisted,
  findCompletedJobByIdempotencyKey,
  upsertMetaCampaignRecord,
  upsertPerformanceSample,
} from "./engine-store.js";
import { applyAdPreviewFromBody } from "./ad-preview.js";

function useMockMeta() {
  return process.env.META_USE_MOCK === "true" || !isMetaConfigured();
}

/**
 * Full pipeline: upload asset → create campaign/adset/creative/ad → optional publish.
 */
export async function runAdPipeline(body) {
  const mock = useMockMeta();
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : null;
  if (idempotencyKey) {
    const existing = findCompletedJobByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { ok: true, duplicate: true, ...existing };
    }
  }
  const jobId = typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : nextId("job");
  const startedAt = new Date().toISOString();

  try {
    if (Number(body.dailyBudget || 25) <= 0) {
      throw new Error("dailyBudget must be > 0");
    }
    let imageHash = body.imageHash;
    let videoId = body.videoId;
    let carouselCards = Array.isArray(body.carouselCards) ? body.carouselCards.filter(Boolean) : [];
    if (carouselCards.length === 1) {
      throw new Error("carouselCards must contain at least 2 cards");
    }

    if (carouselCards.length >= 2) {
      carouselCards = await Promise.all(
        carouselCards.map(async (card, idx) => {
          if (card.imageHash) return card;
          const imageUrl = card.imageUrl || card.url;
          if (!imageUrl) {
            throw new Error(`carouselCards[${idx}] requires imageHash or imageUrl`);
          }
          if (!String(imageUrl).startsWith("http")) {
            throw new Error(`carouselCards[${idx}] imageUrl must be a valid http(s) URL`);
          }
          if (mock) {
            return { ...card, imageHash: `hash_${Math.random().toString(36).slice(2, 10)}` };
          }
          const raw = await uploadAdImageFromUrl(imageUrl, `carousel-${idx + 1}`);
          const uploadedHash = extractImageHashFromAdImagesResponse(raw);
          if (!uploadedHash) throw new Error(`Could not read image hash for carousel card ${idx + 1}`);
          return { ...card, imageHash: uploadedHash };
        })
      );
    }

    if (!body.imageHash && !body.videoId && carouselCards.length < 2) {
      if (body.mode === "video" || body.file_url || body.fileUrl) {
        const fileUrl = body.file_url || body.fileUrl;
        if (!fileUrl) throw new Error("file_url required for video pipeline");
        if (mock) {
          videoId = nextId("meta_video");
        } else {
          const raw = await uploadAdVideoFromFileUrl(fileUrl, body.name);
          videoId = raw.id;
        }
      } else {
        const imageUrl = body.imageUrl || body.url;
        if (!imageUrl) throw new Error("imageUrl (or imageHash) required for image pipeline");
        if (mock) {
          imageHash = `hash_${Math.random().toString(36).slice(2, 10)}`;
        } else {
          const raw = await uploadAdImageFromUrl(imageUrl, body.name);
          imageHash = extractImageHashFromAdImagesResponse(raw);
          if (!imageHash) throw new Error("Could not read image hash from Meta response");
        }
      }
    }

    const defs = getDefaultCampaignDefaults();
    const campaignPayload = {
      campaignName: body.campaignName || "Travel Sales Campaign",
      adsetName: body.adsetName || "Travel Ad Set",
      dailyBudget: Number(body.dailyBudget || 25),
      targeting: body.targeting,
      skipPlacementMerge: body.skipPlacementMerge,
      placementTargeting: body.placementTargeting,
      objective: body.objective || defs.objective,
      optimizationGoal: body.optimizationGoal || defs.optimizationGoal,
      customEventType: body.customEventType || defs.customEventType,
      message: body.message,
      headline: body.headline,
      description: body.description,
      link: body.link,
      imageHash,
      videoId,
      carouselCards,
    };

    let result;
    const specs = normalizeAdsetSpecs(campaignPayload);
    if (mock) {
      const spend = Number(campaignPayload.dailyBudget || 200);
      const leads = Number(body.expectedLeads || 30);
      const cpa = leads > 0 ? spend / leads : spend;
      const roas = Number(body.expectedRoas || 2.8);
      const campaign = { id: nextId("meta_campaign"), name: campaignPayload.campaignName, status: "PAUSED" };
      const creative = { id: nextId("creative"), name: body.creativeName || "Creative" };
      const adsets = specs.map((s) => ({ id: nextId("meta_adset"), name: s.name }));
      const ads = specs.map(() => ({ id: nextId("meta_ad"), status: "PAUSED" }));
      result = {
        campaign,
        adset: adsets[0],
        adsets,
        ads,
        creative,
        ad: ads[0],
        mock: true,
      };
      const rows = adsets.map((as, i) => ({
        id: campaign.id,
        campaign: campaignPayload.campaignName,
        adset: as.name,
        spend,
        leads,
        cpa,
        roas,
        status: "PAUSED",
        metaCampaignId: campaign.id,
        metaAdsetId: as.id,
        metaAdId: ads[i].id,
        metaCreativeId: creative.id,
      }));
      state.campaigns.unshift(...rows.slice().reverse());
      recalculateActions();
    } else {
      result = await createCampaignChain(campaignPayload);
      const spend = Number(campaignPayload.dailyBudget || 200);
      const leads = Number(body.expectedLeads || 30);
      const cpa = leads > 0 ? spend / leads : spend;
      const roas = Number(body.expectedRoas || 2.8);
      const adsetsList = Array.isArray(result.adsets) && result.adsets.length ? result.adsets : [result.adset];
      const adsList = Array.isArray(result.ads) && result.ads.length ? result.ads : [result.ad];
      const rows = adsetsList.map((as, i) => ({
        id: result.campaign?.id || nextId("cmp"),
        campaign: campaignPayload.campaignName,
        adset: as?.name || specs[i]?.name,
        spend,
        leads,
        cpa,
        roas,
        status: "PAUSED",
        metaCampaignId: result.campaign?.id,
        metaAdsetId: as?.id,
        metaAdId: adsList[i]?.id,
        metaCreativeId: result.creative?.id,
      }));
      state.campaigns.unshift(...rows.slice().reverse());
      recalculateActions();
    }

    for (let i = 0; i < specs.length; i++) {
      const as = Array.isArray(result.adsets) && result.adsets[i] ? result.adsets[i] : result.adset;
      const ad = Array.isArray(result.ads) && result.ads[i] ? result.ads[i] : result.ad;
      await upsertMetaCampaignRecord({
        campaignName: campaignPayload.campaignName,
        adsetName: as?.name || specs[i].name,
        metaCampaignId: result.campaign?.id,
        metaAdsetId: as?.id,
        metaAdId: ad?.id,
        metaCreativeId: result.creative?.id,
      });
      await upsertPerformanceSample({
        metaCampaignId: result.campaign?.id,
        metaAdsetId: as?.id || specs[i].name,
        campaignName: campaignPayload.campaignName,
        adsetName: as?.name || specs[i].name,
        spend: Number(campaignPayload.dailyBudget || 0),
        leads: Number(body.expectedLeads || 0),
        revenue: Number(body.expectedLeads || 0) * Number(body.expectedRevenuePerLead || 0),
        currency: body.currency || "USD",
      });
    }

    let publishResult = null;
    const policy = evaluatePublishPolicy({
      useMock: mock,
      trackingHealth: persisted.trackingHealth,
    });

    if (body.autoPublish && policy.allowed) {
      if (!mock) {
        const adsetsPub = Array.isArray(result.adsets) && result.adsets.length ? result.adsets : [result.adset];
        const adsPub = Array.isArray(result.ads) && result.ads.length ? result.ads : [result.ad];
        await setObjectStatus(result.campaign.id, "ACTIVE");
        for (let i = 0; i < adsetsPub.length; i++) {
          await setObjectStatus(adsetsPub[i].id, "ACTIVE");
          if (adsPub[i]?.id) await setObjectStatus(adsPub[i].id, "ACTIVE");
        }
        publishResult = {
          status: "ACTIVE",
          objects: ["campaign", ...adsetsPub.map(() => "adset"), ...adsPub.map(() => "ad")],
        };
        for (const row of state.campaigns.filter((c) => c.campaign === campaignPayload.campaignName)) {
          row.status = "ACTIVE";
        }
      } else {
        publishResult = { status: "ACTIVE", note: "mock activation — no Meta call" };
        const row = state.campaigns.find((c) => c.campaign === campaignPayload.campaignName);
        if (row) row.status = "ACTIVE";
      }
    } else if (body.autoPublish) {
      publishResult = { skipped: true, policy };
    }

    applyAdPreviewFromBody(body, { result, publishResult });

    const done = {
      id: jobId,
      idempotencyKey: idempotencyKey || undefined,
      type: "ad_pipeline",
      status: "done",
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: mock ? "mock" : "live",
      result: { ...result, publishResult, policy },
    };
    await pushJob(done);
    return { ok: true, ...done };
  } catch (error) {
    await pushJob({
      id: jobId,
      idempotencyKey: idempotencyKey || undefined,
      type: "ad_pipeline",
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  }
}
