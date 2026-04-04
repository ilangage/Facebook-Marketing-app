import "dotenv/config";
import http from "node:http";
import { state, nextId, recalculateActions, toMoney } from "./state.js";
import {
  isMetaConfigured,
  getMetaConfig,
  uploadAdImageFromUrl,
  uploadAdVideoFromFileUrl,
  createLinkAdCreative,
  createCampaignChain,
  getAdAccountInsights,
  extractImageHashFromAdImagesResponse,
  searchTargetingCatalog,
} from "./meta-graph.js";
import { upsertTargetingCatalogRows, listCachedTargetingSearch } from "./targeting-catalog.js";
import {
  initEngineStore,
  getEngineSnapshot,
  appendCrmLog,
  bumpFunnel,
  hydrateMetaStateFromPersisted,
  upsertMetaCampaignRecord,
  upsertPerformanceSample,
  recordRevenueEvent,
  recordCrmQualityEvent,
  applyPersistedPerformanceToState,
  getBusinessSummary,
  logAudienceSync,
  recordRevenueRefund,
} from "./engine-store.js";
import { mergeInsightsIntoCampaignRows } from "./insights-sync.js";
import { evaluatePublishPolicy } from "./policy.js";
import { runAdPipeline } from "./orchestrator.js";
import {
  applyAdPreviewFromBody,
  syncAdPreviewFromUploadedImage,
  syncAdPreviewFromUploadedVideo,
} from "./ad-preview.js";
import { runLoopTick } from "./loop-engine.js";
import { scoreCreativesList } from "./creative-score.js";
import { buildHookMatrix, generateVideoScript } from "./content-templates.js";
import { startScheduler } from "./scheduler.js";
import { createCustomAudience, addUsersToCustomAudience } from "./meta-audience.js";
import { sendCapiEvent, listRecentCapiEvents } from "./meta-capi.js";
import { rateLimitCheck, clientKeyFromReq } from "./rate-limit.js";
import { verifyCrmWebhookSignature } from "./webhook-verify.js";

/** Render/Fly/etc. inject `PORT`; local dev often uses `API_PORT` (default 3001). */
const PORT = Number(process.env.PORT || process.env.API_PORT || 3001);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const API_KEY = process.env.API_KEY || "";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET || "";
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX_PER_MIN || 120);

function useMockMeta() {
  return process.env.META_USE_MOCK === "true" || !isMetaConfigured();
}

/** Why mock vs live — safe booleans only (no token values). */
function getMetaModeHints() {
  const mockForced = process.env.META_USE_MOCK === "true";
  const cfg = getMetaConfig();
  const hasToken = Boolean(cfg.token);
  const hasAdAccount = Boolean(cfg.adAccountId);
  const useMock = mockForced || !hasToken || !hasAdAccount;
  if (!useMock) {
    return {
      hints: [
        "Live: META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are set, and META_USE_MOCK is not true — Graph API is used.",
      ],
    };
  }
  const hints = [];
  if (mockForced) {
    hints.push('META_USE_MOCK=true — mock/test mode is forced. Set to false or unset for live Graph API.');
  }
  if (!hasToken) hints.push("META_ACCESS_TOKEN is missing — required for live mode.");
  if (!hasAdAccount) hints.push("META_AD_ACCOUNT_ID is missing — use act_… for live mode.");
  return { hints };
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return CORS_ORIGINS[0] || "*";
  return CORS_ORIGINS.includes(origin) ? origin : "";
}

function sendJson(req, res, statusCode, payload) {
  const allowedOrigin = getAllowedOrigin(req);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    ...(allowedOrigin ? { Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
  });
  res.end(JSON.stringify(payload));
}

function requireApiKey(req) {
  if (!API_KEY) return true;
  const provided = req.headers["x-api-key"];
  return typeof provided === "string" && provided === API_KEY;
}

function validateUrlMaybe(url) {
  if (!url) return true;
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error(`Request body too large (max ${MAX_BODY_BYTES} bytes)`));
        req.destroy();
        return;
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseBodyWithRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      const len = chunks.reduce((a, c) => a + c.length, 0);
      if (len > MAX_BODY_BYTES) {
        reject(new Error(`Request body too large (max ${MAX_BODY_BYTES} bytes)`));
        req.destroy();
        return;
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({ raw: "", json: {} });
        return;
      }
      try {
        resolve({ raw, json: JSON.parse(raw) });
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function dashboardPayload() {
  const cfg = getMetaConfig();
  applyPersistedPerformanceToState();
  const engineSnap = getEngineSnapshot();
  const business = getBusinessSummary();
  return {
    project: state.project,
    kpis: state.kpis,
    campaigns: state.campaigns.map((item) => ({
      ...item,
      spend: toMoney(item.spend),
      cpa: toMoney(item.cpa),
      roas: `${item.roas.toFixed(1)}x`,
    })),
    creatives: state.creatives.map((item) => ({
      ...item,
      ctr: `${item.ctr.toFixed(1)}%`,
      cpc: toMoney(item.cpc),
      cpa: toMoney(item.cpa),
    })),
    audiences: state.audiences,
    crm: state.crmEvents,
    actions: state.optimizerActions,
    cronJobs: state.cronJobs.map((job) => ({ ...job, lastRunAt: new Date(job.lastRunAt).toISOString() })),
    targeting: state.targeting,
    meta: {
      mode: useMockMeta() ? "mock" : "live",
      modeHints: getMetaModeHints().hints,
      metaUseMockEnv: process.env.META_USE_MOCK === "true",
      hasAccessToken: Boolean(cfg.token),
      adAccountConfigured: Boolean(cfg.adAccountId),
      pageConfigured: Boolean(cfg.pageId),
      pixelConfigured: Boolean(cfg.pixelId),
      loopApplyMeta: process.env.LOOP_APPLY_META === "true",
      insightsReconcile: true,
      engineDb: process.env.ENGINE_DB_PATH || "data/bot-engine.db",
      marginAwareOptimizer: process.env.MARGIN_AWARE_OPTIMIZER === "true",
      demoSeedData:
        process.env.SEED_DEMO_DATA === "true" ||
        (process.env.SEED_DEMO_DATA !== "false" && process.env.NODE_ENV !== "production"),
    },
    engine: engineSnap,
    policy: evaluatePublishPolicy({
      useMock: useMockMeta(),
      trackingHealth: engineSnap.trackingHealth,
    }),
    creativeScores: scoreCreativesList(
      state.creatives.map((c) => ({
        name: c.name,
        format: c.format,
        ctr: c.ctr,
        cpc: c.cpc,
        cpa: c.cpa,
        fatigue: c.fatigue,
      }))
    ),
    hooks: buildHookMatrix().slice(0, 12),
    adPreview: state.lastAdPreview,
    assets: {
      images: (state.assets?.images || []).map((i) => ({
        id: i.id,
        name: i.name,
        imageHash: i.imageHash,
        status: i.status,
      })),
      videos: (state.assets?.videos || []).map((v) => ({
        id: v.id,
        name: v.name,
        videoId: v.videoId,
        status: v.status,
      })),
      adcreatives: (state.assets?.adcreatives || []).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      })),
    },
    business: {
      ...business,
      spend: toMoney(business.spend),
      revenue: toMoney(business.revenue),
      cogs: toMoney(business.cogs ?? 0),
      grossProfit: toMoney(business.grossProfit ?? 0),
      roas: `${business.roas.toFixed(2)}x`,
      profitRoas: `${(business.profitRoas ?? 0).toFixed(2)}x`,
      qualifiedRate: `${(business.qualifiedRate * 100).toFixed(1)}%`,
      bookingRate: `${(business.bookingRate * 100).toFixed(1)}%`,
    },
  };
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (!req.url) {
      sendJson(req, res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, {});
      return;
    }

    try {
      const isWrite = req.method === "POST";
      if (isWrite) {
        const rl = rateLimitCheck(clientKeyFromReq(req), RATE_LIMIT_MAX, 60_000);
        if (!rl.ok) {
          sendJson(req, res, 429, { ok: false, error: "Too many requests", retryAfterSec: rl.retryAfterSec });
          return;
        }
      }
      if (isWrite && !requireApiKey(req)) {
        sendJson(req, res, 401, { ok: false, error: "Unauthorized (invalid or missing X-API-Key)" });
        return;
      }

      if (req.method === "GET" && req.url === "/api/dashboard/state") {
        sendJson(req, res, 200, { ok: true, ...dashboardPayload() });
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/api/meta/targeting-search")) {
        const url = new URL(req.url, "http://localhost");
        const q = (url.searchParams.get("q") || "").trim();
        const type = (url.searchParams.get("type") || "adinterest").trim();
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
        const rawCc = (url.searchParams.get("country_code") || "").trim().toUpperCase();
        const countryCode = /^[A-Z]{2}$/.test(rawCc) ? rawCc : "";
        if (!q) {
          sendJson(req, res, 400, { ok: false, error: "q is required" });
          return;
        }
        try {
          if (useMockMeta()) {
            const cached = listCachedTargetingSearch(type, q, limit, countryCode);
            if (cached.length) {
              const results = cached.map((row) => ({
                id: row.id,
                name: row.name,
                type: row.type,
                audience_size: row.audience_size,
                path: row.path,
              }));
              sendJson(req, res, 200, {
                ok: true,
                metaMode: "mock",
                results,
                source: "sqlite_cache",
                countryCode: countryCode || undefined,
              });
              return;
            }
            sendJson(req, res, 200, {
              ok: true,
              metaMode: "mock",
              results: [
                {
                  id: `mock_${type}_1`,
                  name: `Demo (${type}${countryCode ? `, ${countryCode}` : ""}): ${q.slice(0, 48)}`,
                  type,
                  audience_size: 125000,
                  path: ["Mock", "Connect live Meta + run search to query Graph"],
                },
              ],
              note: "Mock mode — demo row. Live calls cache results in meta_targeting_catalog (SQLite).",
              countryCode: countryCode || undefined,
            });
            return;
          }
          const results = await searchTargetingCatalog({ q, type, limit, countryCode: countryCode || undefined });
          upsertTargetingCatalogRows(results, type, q, countryCode);
          sendJson(req, res, 200, { ok: true, metaMode: "live", results, countryCode: countryCode || undefined });
        } catch (error) {
          sendJson(req, res, 400, { ok: false, error: error.message });
        }
        return;
      }

      if (req.method === "GET" && req.url === "/api/meta/health") {
        const cfg = getMetaConfig();
        const { hints } = getMetaModeHints();
        sendJson(req, res, 200, {
          ok: true,
          appBaseUrl: cfg.appBaseUrl,
          apiVersion: cfg.apiVersion,
          goal: state.project.goal,
          metaMode: useMockMeta() ? "mock" : "live",
          metaConfigured: isMetaConfigured(),
          metaUseMockEnv: process.env.META_USE_MOCK === "true",
          hasAccessToken: Boolean(cfg.token),
          hasAdAccountId: Boolean(cfg.adAccountId),
          hasPageId: Boolean(cfg.pageId),
          hasPixelId: Boolean(cfg.pixelId),
          hasInstagramActorId: Boolean(cfg.instagramActorId),
          placementPreset: process.env.META_PLACEMENT_PRESET || "fb_ig_mobile",
          modeHints: hints,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/track") {
        const body = await parseBody(req);
        const item = {
          eventId: nextId("evt"),
          eventName: body.eventName || "ViewContent",
          destination: body.destination || "Unknown",
          packageType: body.packageType || "travel",
          createdAt: new Date().toISOString(),
        };
        state.tracking.unshift(item);
        await bumpFunnel(item.eventName);
        sendJson(req, res, 200, { ok: true, item });
        return;
      }

      if (req.method === "POST" && req.url === "/api/pipeline/run") {
        const body = await parseBody(req);
        const result = await runAdPipeline(body);
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && req.url === "/api/preview/render") {
        const body = await parseBody(req);
        applyAdPreviewFromBody(body, {});
        sendJson(req, res, 200, { ok: true, adPreview: state.lastAdPreview });
        return;
      }

      if (req.method === "POST" && req.url === "/api/loop/tick") {
        const result = await runLoopTick();
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/api/content/video-script")) {
        const url = new URL(req.url, "http://localhost");
        const persona = url.searchParams.get("persona") || "honeymoon";
        const destination = url.searchParams.get("destination") || "Bali";
        const offer = url.searchParams.get("offer") || undefined;
        sendJson(req, res, 200, { ok: true, script: generateVideoScript({ persona, destination, offer }) });
        return;
      }

      if (req.method === "GET" && req.url === "/api/policy") {
        sendJson(req, res, 200, {
          ok: true,
          ...evaluatePublishPolicy({
            useMock: useMockMeta(),
            trackingHealth: getEngineSnapshot().trackingHealth,
          }),
        });
        return;
      }

      if (req.method === "GET" && req.url === "/api/business/summary") {
        const b = getBusinessSummary();
        sendJson(req, res, 200, { ok: true, ...b });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/upload-image") {
        const body = await parseBody(req);
        if (!useMockMeta()) {
          if (!body.url || typeof body.url !== "string") {
            sendJson(req, res, 400, {
              ok: false,
              error: "Live mode requires JSON body: { url: \"https://...\" } (public image URL)",
            });
            return;
          }
          if (!validateUrlMaybe(body.url)) {
            sendJson(req, res, 400, { ok: false, error: "url must be a valid http(s) URL" });
            return;
          }
          const raw = await uploadAdImageFromUrl(body.url, body.name);
          const imageHash = extractImageHashFromAdImagesResponse(raw);
          const image = {
            id: nextId("img"),
            imageHash: imageHash || "unknown",
            name: body.name || "creative-image",
            status: "READY",
            meta: raw,
          };
          state.assets.images.unshift(image);
          syncAdPreviewFromUploadedImage(body);
          sendJson(req, res, 200, {
            ok: true,
            image,
            raw,
            adPreview: state.lastAdPreview,
          });
          return;
        }
        const image = {
          id: nextId("img"),
          imageHash: `hash_${Math.random().toString(36).slice(2, 10)}`,
          name: body.name || "creative-image",
          status: "READY",
        };
        state.assets.images.unshift(image);
        syncAdPreviewFromUploadedImage(body);
        sendJson(req, res, 200, {
          ok: true,
          image,
          metaMode: "mock",
          adPreview: state.lastAdPreview,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/upload-video") {
        const body = await parseBody(req);
        if (!useMockMeta()) {
          const fileUrl = body.file_url || body.fileUrl;
          if (!fileUrl || typeof fileUrl !== "string") {
            sendJson(req, res, 400, {
              ok: false,
              error:
                "Live mode requires JSON body: { file_url: \"https://...\" } (public video URL supported by Meta file_url)",
            });
            return;
          }
          if (!validateUrlMaybe(fileUrl)) {
            sendJson(req, res, 400, { ok: false, error: "file_url must be a valid http(s) URL" });
            return;
          }
          const raw = await uploadAdVideoFromFileUrl(fileUrl, body.name);
          const video = {
            id: nextId("vid"),
            videoId: raw.id,
            name: body.name || "creative-video",
            status: raw.status || "READY",
            meta: raw,
          };
          state.assets.videos.unshift(video);
          syncAdPreviewFromUploadedVideo(body);
          sendJson(req, res, 200, {
            ok: true,
            video,
            raw,
            adPreview: state.lastAdPreview,
          });
          return;
        }
        const video = {
          id: nextId("vid"),
          videoId: nextId("meta_video"),
          name: body.name || "creative-video",
          status: "READY",
        };
        state.assets.videos.unshift(video);
        syncAdPreviewFromUploadedVideo(body);
        sendJson(req, res, 200, {
          ok: true,
          video,
          metaMode: "mock",
          adPreview: state.lastAdPreview,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/create-creative") {
        const body = await parseBody(req);
        const carouselCards = Array.isArray(body.carouselCards) ? body.carouselCards.filter(Boolean) : [];
        if (!body.imageHash && !body.videoId && carouselCards.length < 2) {
          sendJson(req, res, 400, { ok: false, error: "Provide carouselCards (2+) or imageHash or videoId" });
          return;
        }
        if (!useMockMeta()) {
          if (!body.link || !validateUrlMaybe(body.link)) {
            sendJson(req, res, 400, { ok: false, error: "link must be a valid http(s) URL" });
            return;
          }
          const raw = await createLinkAdCreative({
            name: body.name,
            imageHash: body.imageHash,
            videoId: body.videoId,
            carouselCards,
            link: body.link,
            message: body.message,
            headline: body.headline,
            description: body.description,
          });
          const creative = {
            id: raw.id,
            name: body.name || "Travel Creative",
            format: carouselCards.length >= 2 ? "carousel" : body.videoId ? "video_30s" : "static_square",
            source: carouselCards.length >= 2 ? `${carouselCards.length} cards` : body.videoId || body.imageHash,
            meta: raw,
          };
          state.assets.adcreatives.unshift(creative);
          sendJson(req, res, 200, { ok: true, creative, raw });
          return;
        }
        const creative = {
          id: nextId("creative"),
          name: body.name || "Travel Creative",
          format: carouselCards.length >= 2 ? "carousel" : body.videoId ? "video_30s" : "static_square",
          source: carouselCards.length >= 2 ? `${carouselCards.length} cards` : body.videoId || body.imageHash,
        };
        state.assets.adcreatives.unshift(creative);
        sendJson(req, res, 200, { ok: true, creative, metaMode: "mock" });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/create-campaign") {
        const body = await parseBody(req);
        const carouselCards = Array.isArray(body.carouselCards) ? body.carouselCards.filter(Boolean) : [];
        if (!useMockMeta()) {
          if (!body.imageHash && !body.videoId && carouselCards.length < 2) {
            sendJson(req, res, 400, {
              ok: false,
              error: "Live mode requires carouselCards (2+) or imageHash (upload-image) or videoId (upload-video)",
            });
            return;
          }
          if (Number(body.dailyBudget || 0) <= 0) {
            sendJson(req, res, 400, { ok: false, error: "dailyBudget must be > 0" });
            return;
          }
          const result = await createCampaignChain(body);
          const spend = Number(body.dailyBudget || 200);
          const leads = Number(body.expectedLeads || 30);
          const cpa = leads > 0 ? spend / leads : spend;
          const roas = Number(body.expectedRoas || 2.8);
          const item = {
            id: result.campaign?.id || nextId("cmp"),
            campaign: body.campaignName || "Travel Sales Campaign",
            adset: body.adsetName || "Travel Adset",
            spend,
            leads,
            cpa,
            roas,
            status: "PAUSED",
          };
          state.campaigns.unshift({
            ...item,
            metaCampaignId: result.campaign?.id,
            metaAdsetId: result.adset?.id,
            metaAdId: result.ad?.id,
            metaCreativeId: result.creative?.id,
          });
          recalculateActions();
          await upsertMetaCampaignRecord({
            campaignName: item.campaign,
            adsetName: item.adset,
            metaCampaignId: result.campaign?.id,
            metaAdsetId: result.adset?.id,
            metaAdId: result.ad?.id,
            metaCreativeId: result.creative?.id,
          });
          await upsertPerformanceSample({
            metaCampaignId: result.campaign?.id,
            metaAdsetId: result.adset?.id,
            campaignName: item.campaign,
            adsetName: item.adset,
            spend,
            leads,
            currency: body.currency || "USD",
          });
          sendJson(req, res, 200, {
            ok: true,
            metaMode: "live",
            campaign: result.campaign,
            adset: result.adset,
            creative: result.creative,
            ad: result.ad,
          });
          return;
        }
        const spend = Number(body.dailyBudget || 200);
        const leads = Number(body.expectedLeads || 30);
        const cpa = leads > 0 ? spend / leads : spend;
        const roas = Number(body.expectedRoas || 2.8);
        const item = {
          id: nextId("cmp"),
          campaign: body.campaignName || "Travel Sales Campaign",
          adset: body.adsetName || "Travel Adset",
          spend,
          leads,
          cpa,
          roas,
          status: "PAUSED",
        };
        state.campaigns.unshift(item);
        recalculateActions();
        sendJson(req, res, 200, {
          ok: true,
          metaMode: "mock",
          campaign: { id: nextId("meta_campaign"), name: item.campaign, status: item.status },
          adset: { id: nextId("meta_adset"), name: item.adset },
          ad: { id: nextId("meta_ad"), status: "PAUSED" },
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/sync-audience") {
        const body = await parseBody(req);
        const segment = body.segment || "hot";
        const emails = Array.isArray(body.emails) ? body.emails.filter((e) => typeof e === "string" && e.trim()) : [];
        const mock = useMockMeta();

        if (!mock && emails.length > 0) {
          try {
            let audienceId = body.audienceId;
            if (!audienceId) {
              const created = await createCustomAudience(body.audienceName || `Travel Audience - ${segment}`);
              audienceId = created.id;
            }
            const graphResult = await addUsersToCustomAudience(audienceId, emails);
            logAudienceSync(segment, audienceId, emails.length, { graphResult });
            const existing = state.audiences.find((a) => a.segment === segment);
            if (existing) {
              existing.users = emails.length;
              existing.sync = "just now";
              existing.retries = 0;
              existing.status = "Healthy";
            } else {
              state.audiences.unshift({
                segment,
                users: emails.length,
                sync: "just now",
                retries: 0,
                status: "Healthy",
              });
            }
            sendJson(req, res, 200, {
              ok: true,
              metaMode: "live",
              audienceId,
              audienceName: body.audienceName || `Travel Audience - ${segment}`,
              matchedUsers: emails.length,
              graphResult,
            });
            return;
          } catch (error) {
            sendJson(req, res, 502, {
              ok: false,
              error: error.message || "Audience sync failed",
              meta: error.meta,
            });
            return;
          }
        }

        const matchedUsers = emails.length > 0 ? emails.length : Math.floor(Math.random() * 800) + 150;
        const existing = state.audiences.find((a) => a.segment === segment);
        if (existing) {
          existing.users = matchedUsers;
          existing.sync = "just now";
          existing.retries = 0;
          existing.status = "Healthy";
        } else {
          state.audiences.unshift({
            segment,
            users: matchedUsers,
            sync: "just now",
            retries: 0,
            status: "Healthy",
          });
        }
        sendJson(req, res, 200, {
          ok: true,
          metaMode: mock ? "mock" : "live",
          audienceId: nextId("aud"),
          audienceName: body.audienceName || `Travel Audience - ${segment}`,
          matchedUsers,
          note:
            mock || !emails.length
              ? "Provide emails[] in live mode to create/update a real Custom Audience via Marketing API."
              : undefined,
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/capi/event") {
        const body = await parseBody(req);
        if (useMockMeta()) {
          sendJson(req, res, 200, {
            ok: true,
            metaMode: "mock",
            note: "META_USE_MOCK or missing token — CAPI not sent",
            wouldSend: body,
          });
          return;
        }
        try {
          const result = await sendCapiEvent({
            eventName: body.eventName || "Purchase",
            eventId: body.eventId,
            eventTime: body.eventTime,
            eventSourceUrl: body.eventSourceUrl,
            customData: body.customData,
            userData: body.userData,
            actionSource: body.actionSource,
          });
          sendJson(req, res, 200, { ok: true, metaMode: "live", ...result });
        } catch (error) {
          sendJson(req, res, 502, { ok: false, error: error.message, meta: error.meta });
        }
        return;
      }

      if (req.method === "GET" && req.url === "/api/meta/capi/log") {
        const url = new URL(req.url, "http://localhost");
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 40)));
        sendJson(req, res, 200, { ok: true, events: listRecentCapiEvents(limit) });
        return;
      }

      if (req.method === "GET" && req.url === "/api/meta/insights") {
        if (!useMockMeta()) {
          const raw = await getAdAccountInsights();
          const reconcile = mergeInsightsIntoCampaignRows(raw);
          for (const sample of reconcile.samples || []) {
            await upsertPerformanceSample(sample);
          }
          sendJson(req, res, 200, { ok: true, metaMode: "live", raw, reconcile });
          return;
        }
        sendJson(req, res, 200, {
          ok: true,
          metaMode: "mock",
          summary: state.campaigns.map((item) => ({
            campaign: item.campaign,
            adset: item.adset,
            spend: item.spend,
            leads: item.leads,
            cpa: item.cpa,
            roas: item.roas,
            status: item.status,
          })),
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/optimize") {
        const out = await runLoopTick();
        sendJson(req, res, 200, { ok: true, ...out, metaMode: useMockMeta() ? "mock" : "live" });
        return;
      }

      if (req.method === "POST" && req.url === "/api/crm/webhook") {
        const { raw, json: body } = await parseBodyWithRaw(req);
        if (!verifyCrmWebhookSignature(raw, req.headers["x-webhook-signature"], CRM_WEBHOOK_SECRET)) {
          sendJson(req, res, 401, { ok: false, error: "Invalid webhook signature" });
          return;
        }
        const eventType = body.eventType || "lead.created";
        const row = state.crmEvents.find((event) => event.event === eventType);
        if (row) {
          row.count += 1;
        } else {
          state.crmEvents.unshift({ event: eventType, count: 1, sla: "n/a", status: "Good" });
        }
        await appendCrmLog({ eventType, payload: body });
        await bumpFunnel(eventType);
        sendJson(req, res, 200, { ok: true, received: eventType });
        return;
      }

      if (req.method === "POST" && req.url === "/api/crm/quality") {
        const body = await parseBody(req);
        const result = await recordCrmQualityEvent({
          leadId: body.leadId,
          quality: body.quality,
          qualified: body.qualified,
          metaCampaignId: body.metaCampaignId,
          metaAdsetId: body.metaAdsetId,
          campaignName: body.campaignName,
          adsetName: body.adsetName,
          at: body.at,
        });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && req.url === "/api/revenue/record") {
        const body = await parseBody(req);
        const result = await recordRevenueEvent({
          orderId: body.orderId,
          revenue: body.revenue,
          cogs: body.cogs,
          currency: body.currency,
          leadId: body.leadId,
          metaCampaignId: body.metaCampaignId,
          metaAdsetId: body.metaAdsetId,
          campaignName: body.campaignName,
          adsetName: body.adsetName,
          source: body.source,
          bookedAt: body.bookedAt,
        });
        sendJson(req, res, 200, result);
        return;
      }

      if (req.method === "POST" && req.url === "/api/revenue/refund") {
        const body = await parseBody(req);
        try {
          const result = await recordRevenueRefund({
            orderId: body.orderId,
            refundAmount: body.refundAmount ?? body.amount,
            refundCogs: body.refundCogs,
            cancelBooking: body.cancelBooking,
          });
          sendJson(req, res, 200, result);
        } catch (error) {
          sendJson(req, res, 400, { ok: false, error: error.message });
        }
        return;
      }

      sendJson(req, res, 404, { ok: false, error: "Route not found" });
    } catch (error) {
      const status = error.code === "AD_COPY_VALIDATION" ? 400 : 500;
      sendJson(req, res, status, {
        ok: false,
        error: error.message || "Internal server error",
        meta: error.meta || undefined,
      });
    }
  });
}

const server = createServer();

async function boot() {
  const prodNeedsKey =
    process.env.NODE_ENV === "production" &&
    !API_KEY &&
    process.env.ALLOW_UNAUTHENTICATED_POSTS !== "true";
  /** Render sets RENDER=true; allow first deploy without API_KEY but warn (set API_KEY in dashboard for real traffic). */
  const onRender = process.env.RENDER === "true";
  if (prodNeedsKey && !onRender) {
    console.error(
      "Refusing to start: NODE_ENV=production requires API_KEY. Set API_KEY or ALLOW_UNAUTHENTICATED_POSTS=true (not recommended)."
    );
    process.exit(1);
  }
  if (prodNeedsKey && onRender) {
    console.warn(
      "Render: API_KEY not set — POST routes accept requests without X-API-Key. Set API_KEY in Environment for production."
    );
  }
  await initEngineStore();
  hydrateMetaStateFromPersisted();
  if (process.env.NODE_ENV !== "production" && !API_KEY) {
    console.warn("Dev mode: API_KEY unset — POST routes are open.");
  }
  server.listen(PORT, () => {
    console.log(`Bot backend running on http://localhost:${PORT}`);
    console.log(`Meta mode: ${useMockMeta() ? "MOCK (set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for live)" : "LIVE"}`);
    console.log(`Engine DB: ${process.env.ENGINE_DB_PATH || "data/bot-engine.db"}`);
    startScheduler();
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\nPort ${PORT} is already in use (another dev:api is probably running).\n\nFix:\n  • Stop the other terminal, or\n  • Kill it: kill $(lsof -ti :${PORT})\n  • Or use another port: API_PORT=3002 npm run dev:api\n`
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

boot();
