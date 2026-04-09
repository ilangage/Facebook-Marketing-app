import "./env-bootstrap.js";
import http from "node:http";
import { state, nextId, recalculateActions, toMoney, getOptimizerThresholds } from "./state.js";
import {
  isMetaConfigured,
  getMetaConfig,
  uploadAdImageFromUrl,
  uploadAdImageFromBase64,
  uploadAdVideoFromFileUrl,
  createLinkAdCreative,
  createCampaignChain,
  normalizeAdsetSpecs,
  getAdAccountInsights,
  copyAdSetDeep,
  updateAdCreativeOnAd,
  getAdsForAdset,
  setObjectStatus,
  updateAdsetDailyBudget,
  extractImageHashFromAdImagesResponse,
  searchTargetingCatalog,
  normalizeTargetingSearchQuery,
  fetchAccessTokenDebugInfo,
  getAccessTokenFingerprint,
  isCampaignBudgetOptimization,
  isCampaignBudgetOptimizationMulti,
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
  recordInsightsSync,
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
import { buildWinnerBoard, buildSplitCompare, buildCreativeRotationHints } from "./dashboard-extras.js";
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

/**
 * Preview carousel cards often only have `imageUrl` (see shared/carousel-template.js).
 * Meta creatives require `imageHash` per card — upload each remote image to the ad account.
 */
async function hydrateLiveCarouselCards(cards) {
  const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (list.length < 2) return list;
  return Promise.all(
    list.map(async (card, idx) => {
      if (card.imageHash && String(card.imageHash).trim()) return card;
      const imageUrl = card.imageUrl || card.url;
      if (!imageUrl) {
        throw new Error(`carouselCards[${idx}] requires imageHash or imageUrl`);
      }
      if (!String(imageUrl).startsWith("http")) {
        throw new Error(`carouselCards[${idx}] imageUrl must be a valid http(s) URL`);
      }
      const raw = await uploadAdImageFromUrl(imageUrl, `carousel-${idx + 1}`);
      const imageHash = extractImageHashFromAdImagesResponse(raw);
      if (!imageHash) throw new Error(`Could not read image hash for carousel card ${idx + 1}`);
      return { ...card, imageHash };
    })
  );
}

/** Extract base64 payload from `data:image/...;base64,...` for Meta `bytes` upload. */
function parseDataUrlToBase64(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:image\/[\w+.-]+;base64,([\s\S]+)$/i);
  return m ? m[1].replace(/\s/g, "") : null;
}

/** Map in-app funnel labels to Meta CAPI standard `event_name`. */
function mapTrackEventToCapiName(eventName) {
  const e = String(eventName || "").toLowerCase();
  if (e.includes("qualified")) return "Lead";
  if (e.includes("lead")) return "Lead";
  if (e.includes("purchase") || e.includes("booking") || e.includes("deal")) return "Purchase";
  if (e.includes("view") || e === "viewcontent") return "ViewContent";
  return "ViewContent";
}

/** Browser + CAPI user_data (fbp/fbc/UA/IP) for better match quality — pair with same eventId as Pixel. */
function buildCapiUserData(body) {
  const base = typeof body.userData === "object" && body.userData && !Array.isArray(body.userData) ? { ...body.userData } : {};
  if (typeof body.fbp === "string" && body.fbp.trim()) base.fbp = body.fbp.trim();
  if (typeof body.fbc === "string" && body.fbc.trim()) base.fbc = body.fbc.trim();
  if (typeof body.clientUserAgent === "string" && body.clientUserAgent.trim()) {
    base.client_user_agent = body.clientUserAgent.trim();
  }
  if (typeof body.clientIpAddress === "string" && body.clientIpAddress.trim()) {
    base.client_ip_address = body.clientIpAddress.trim();
  }
  return Object.keys(base).length ? base : undefined;
}

/** Enrich custom_data so qualified vs raw leads differ in Events Manager. */
function mergeTrackCustomData(eventName, body) {
  const e = String(eventName || "").toLowerCase();
  const base =
    typeof body.customData === "object" && body.customData && !Array.isArray(body.customData)
      ? { ...body.customData }
      : {};
  if (e.includes("qualified")) {
    if (base.lead_status == null) base.lead_status = "qualified";
    if (base.content_category == null) base.content_category = "qualified_lead";
  }
  return Object.keys(base).length ? base : undefined;
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
  recalculateActions();
  const engineSnap = getEngineSnapshot();
  const business = getBusinessSummary();
  const creativeScoresRaw = scoreCreativesList(
    state.creatives.map((c) => ({
      name: c.name,
      format: c.format,
      ctr: c.ctr,
      cpc: c.cpc,
      cpa: c.cpa,
      fatigue: c.fatigue,
      roas: c.roas,
      qualifiedRate: c.qualifiedRate,
      bookingRate: c.bookingRate,
    }))
  );
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
      hasAppId: Boolean(cfg.appId),
      hasAppSecret: Boolean(cfg.appSecret),
      tokenFingerprint: getAccessTokenFingerprint(),
      loopApplyMeta: process.env.LOOP_APPLY_META === "true",
      insightsReconcile: true,
      engineDb: process.env.ENGINE_DB_PATH || "data/bot-engine.db",
      marginAwareOptimizer: process.env.MARGIN_AWARE_OPTIMIZER === "true",
      optimizer: getOptimizerThresholds(),
      optimizerBlockScaleStaleInsights: process.env.OPTIMIZER_BLOCK_SCALE_STALE_INSIGHTS === "true",
      optimizerSplitAutoPause: process.env.OPTIMIZER_SPLIT_AUTO_PAUSE === "true",
      demoSeedData:
        process.env.SEED_DEMO_DATA === "true" ||
        (process.env.SEED_DEMO_DATA !== "false" && process.env.NODE_ENV !== "production"),
    },
    engine: engineSnap,
    policy: evaluatePublishPolicy({
      useMock: useMockMeta(),
      trackingHealth: engineSnap.trackingHealth,
    }),
    creativeScores: creativeScoresRaw,
    creativeRotationHints: buildCreativeRotationHints(creativeScoresRaw),
    winnerBoard: buildWinnerBoard(state.campaigns),
    splitCompare: buildSplitCompare(state.campaigns),
    insightsFreshness: engineSnap.insightsFreshness,
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
      refundVolume: toMoney(business.refundVolume ?? 0),
      grossRevenue: toMoney(business.grossRevenue ?? business.revenue),
      netRevenue: toMoney(business.netRevenue ?? business.revenue),
      grossRoas: `${(business.grossRoas ?? 0).toFixed(2)}x`,
      cancellationRate: `${((business.cancellationRateBookings ?? 0) * 100).toFixed(1)}%`,
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
      const pathname = req.url.split("?")[0] || "";
      if (req.method === "GET" && (pathname === "/" || pathname === "")) {
        sendJson(req, res, 200, { ok: true, service: "facebook-marketing-api" });
        return;
      }

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
        const q = normalizeTargetingSearchQuery(url.searchParams.get("q") || "");
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
                searchStats: {
                  queryNormalized: q,
                  graphRawCount: results.length,
                  afterTypeFilter: results.length,
                  limitType: "cache",
                  countryCode: countryCode || undefined,
                },
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
              searchStats: {
                queryNormalized: q,
                graphRawCount: 1,
                afterTypeFilter: 1,
                limitType: "demo",
                countryCode: countryCode || undefined,
              },
              countryCode: countryCode || undefined,
            });
            return;
          }
          const { results, searchStats } = await searchTargetingCatalog({
            q,
            type,
            limit,
            countryCode: countryCode || undefined,
          });
          upsertTargetingCatalogRows(results, type, q, countryCode);
          const limitTypeEcho =
            { adinterest: "interests", adbehavior: "behaviors", work_title: "work_positions", work_employer: "work_employers" }[
              type
            ] || "interests";
          sendJson(req, res, 200, {
            ok: true,
            metaMode: "live",
            results,
            searchStats,
            requestedType: type,
            limitType: limitTypeEcho,
            countryCode: countryCode || undefined,
          });
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
          hasAppId: Boolean(cfg.appId),
          hasAppSecret: Boolean(cfg.appSecret),
          tokenFingerprint: getAccessTokenFingerprint(),
          placementPreset: process.env.META_PLACEMENT_PRESET || "fb_ig_mobile",
          campaignBudgetOptimization: isCampaignBudgetOptimization(),
          campaignBudgetOptimizationMulti: isCampaignBudgetOptimizationMulti(),
          modeHints: hints,
        });
        return;
      }

      if (req.method === "GET" && req.url === "/api/meta/token-status") {
        try {
          const info = await fetchAccessTokenDebugInfo();
          sendJson(req, res, 200, { ok: true, ...info });
        } catch (error) {
          sendJson(req, res, 500, { ok: false, error: error.message || String(error) });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/track") {
        const body = await parseBody(req);
        const eventId = body.eventId || nextId("evt");
        const item = {
          eventId,
          eventName: body.eventName || "ViewContent",
          destination: body.destination || "Unknown",
          packageType: body.packageType || "travel",
          createdAt: new Date().toISOString(),
        };
        state.tracking.unshift(item);
        await bumpFunnel(item.eventName);
        let capi = null;
        const cfg = getMetaConfig();
        const wantCapi =
          process.env.TRACK_SYNC_CAPI !== "false" &&
          body.syncCapi !== false &&
          !useMockMeta() &&
          Boolean(cfg.pixelId);
        if (wantCapi) {
          try {
            const customData = mergeTrackCustomData(item.eventName, body);
            const userData = buildCapiUserData(body);
            capi = await sendCapiEvent({
              eventName: mapTrackEventToCapiName(item.eventName),
              eventId,
              eventTime: body.eventTime != null ? Number(body.eventTime) : undefined,
              eventSourceUrl: body.eventSourceUrl || cfg.appBaseUrl,
              customData,
              userData,
              actionSource: body.actionSource || "website",
            });
          } catch (err) {
            capi = { ok: false, error: err.message || String(err) };
          }
        }
        sendJson(req, res, 200, { ok: true, item, capi });
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
          const name = body.name || "creative-image";
          const fromDataUrl = typeof body.url === "string" ? parseDataUrlToBase64(body.url) : null;
          const fromBytes =
            typeof body.bytes === "string"
              ? body.bytes.replace(/\s/g, "")
              : typeof body.image_base64 === "string"
                ? body.image_base64.replace(/\s/g, "")
                : null;
          const b64 = fromDataUrl || fromBytes;
          let raw;
          if (b64) {
            raw = await uploadAdImageFromBase64(b64, name);
          } else if (body.url && typeof body.url === "string" && validateUrlMaybe(body.url)) {
            raw = await uploadAdImageFromUrl(body.url, name);
          } else {
            sendJson(req, res, 400, {
              ok: false,
              error:
                "Live mode: send url (https://... public image), or data:image/...;base64,... in url (file picker), or bytes / image_base64 (raw base64)",
            });
            return;
          }
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
          let cardsResolved = carouselCards;
          if (carouselCards.length >= 2) {
            try {
              cardsResolved = await hydrateLiveCarouselCards(carouselCards);
            } catch (e) {
              sendJson(req, res, 400, { ok: false, error: e.message || String(e) });
              return;
            }
          }
          const raw = await createLinkAdCreative({
            name: body.name,
            imageHash: body.imageHash,
            videoId: body.videoId,
            carouselCards: cardsResolved,
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
        let specs;
        try {
          specs = normalizeAdsetSpecs(body);
        } catch (e) {
          sendJson(req, res, 400, { ok: false, error: e.message || String(e) });
          return;
        }
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
          let chainBody = body;
          if (carouselCards.length >= 2) {
            try {
              chainBody = { ...body, carouselCards: await hydrateLiveCarouselCards(carouselCards) };
            } catch (e) {
              sendJson(req, res, 400, { ok: false, error: e.message || String(e) });
              return;
            }
          }
          const result = await createCampaignChain(chainBody);
          const spend = Number(body.dailyBudget || 200);
          const leads = Number(body.expectedLeads || 30);
          const cpa = leads > 0 ? spend / leads : spend;
          const roas = Number(body.expectedRoas || 2.8);
          const campaignName = body.campaignName || "Travel Sales Campaign";
          const campaignId = result.campaign?.id || nextId("cmp");
          const adsetsList = Array.isArray(result.adsets) && result.adsets.length ? result.adsets : [result.adset];
          const adsList = Array.isArray(result.ads) && result.ads.length ? result.ads : [result.ad];
          const rows = adsetsList.map((as, i) => ({
            id: campaignId,
            campaign: campaignName,
            adset: as?.name || specs[i]?.name || `Ad Set ${i + 1}`,
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
          for (let i = 0; i < rows.length; i++) {
            await upsertMetaCampaignRecord({
              campaignName: campaignName,
              adsetName: rows[i].adset,
              metaCampaignId: result.campaign?.id,
              metaAdsetId: rows[i].metaAdsetId,
              metaAdId: rows[i].metaAdId,
              metaCreativeId: result.creative?.id,
            });
            await upsertPerformanceSample({
              metaCampaignId: result.campaign?.id,
              metaAdsetId: rows[i].metaAdsetId,
              campaignName: campaignName,
              adsetName: rows[i].adset,
              spend,
              leads,
              currency: body.currency || "USD",
            });
          }
          sendJson(req, res, 200, {
            ok: true,
            metaMode: "live",
            campaign: result.campaign,
            adset: result.adset,
            adsets: result.adsets,
            ads: result.ads,
            creative: result.creative,
            ad: result.ad,
          });
          return;
        }
        const spend = Number(body.dailyBudget || 200);
        const leads = Number(body.expectedLeads || 30);
        const cpa = leads > 0 ? spend / leads : spend;
        const roas = Number(body.expectedRoas || 2.8);
        const campaignName = body.campaignName || "Travel Sales Campaign";
        const campaignId = nextId("meta_campaign");
        const creativeId = nextId("creative");
        const mockAdsets = specs.map((s, i) => ({
          id: nextId("meta_adset"),
          name: s.name || `Ad Set ${i + 1}`,
        }));
        const mockAds = specs.map(() => ({ id: nextId("meta_ad"), status: "PAUSED" }));
        const rows = mockAdsets.map((as, i) => ({
          id: campaignId,
          campaign: campaignName,
          adset: as.name,
          spend,
          leads,
          cpa,
          roas,
          status: "PAUSED",
          metaCampaignId: campaignId,
          metaAdsetId: as.id,
          metaAdId: mockAds[i].id,
          metaCreativeId: creativeId,
        }));
        state.campaigns.unshift(...rows.slice().reverse());
        recalculateActions();
        sendJson(req, res, 200, {
          ok: true,
          metaMode: "mock",
          campaign: { id: campaignId, name: campaignName, status: "PAUSED" },
          adset: mockAdsets[0],
          adsets: mockAdsets,
          ads: mockAds,
          creative: { id: creativeId, name: body.creativeName || "Travel Creative" },
          ad: mockAds[0],
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

        if (!mock && emails.length === 0) {
          sendJson(req, res, 400, {
            ok: false,
            error:
              "Live mode requires emails[] for Custom Audience upload. Add emails in the UI textarea or POST body, or set VITE_AUDIENCE_SYNC_EMAILS.",
          });
          return;
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
          note: mock
            ? "Mock audience counts are simulated."
            : "Provide emails[] in live mode to create/update a real Custom Audience via Marketing API.",
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
          recordInsightsSync();
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

      if (req.method === "POST" && req.url === "/api/meta/adset/status") {
        const body = await parseBody(req);
        if (useMockMeta()) {
          sendJson(req, res, 200, { ok: true, metaMode: "mock", note: "META_USE_MOCK — no Graph call" });
          return;
        }
        try {
          const id = String(body.metaAdsetId || "").trim();
          const status = String(body.status || "PAUSED").toUpperCase();
          if (!id) throw new Error("metaAdsetId is required");
          if (status !== "ACTIVE" && status !== "PAUSED") throw new Error("status must be ACTIVE or PAUSED");
          const result = await setObjectStatus(id, status);
          sendJson(req, res, 200, { ok: true, metaMode: "live", result });
        } catch (error) {
          sendJson(req, res, 502, { ok: false, error: error.message, meta: error.meta });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/adset/budget") {
        const body = await parseBody(req);
        if (useMockMeta()) {
          sendJson(req, res, 200, { ok: true, metaMode: "mock", note: "META_USE_MOCK — no Graph call" });
          return;
        }
        try {
          const id = String(body.metaAdsetId || "").trim();
          const minor = Number(body.dailyBudgetMinor ?? body.daily_budget_minor);
          if (!id) throw new Error("metaAdsetId is required");
          if (!(minor > 0)) throw new Error("dailyBudgetMinor must be > 0");
          const result = await updateAdsetDailyBudget(id, minor);
          sendJson(req, res, 200, { ok: true, metaMode: "live", result });
        } catch (error) {
          sendJson(req, res, 502, { ok: false, error: error.message, meta: error.meta });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/adset/copy") {
        const body = await parseBody(req);
        if (useMockMeta()) {
          sendJson(req, res, 200, {
            ok: true,
            metaMode: "mock",
            note: "META_USE_MOCK — no Graph call",
            wouldCopy: body.sourceAdsetId,
          });
          return;
        }
        try {
          const sourceAdsetId = String(body.sourceAdsetId || "").trim();
          if (!sourceAdsetId) throw new Error("sourceAdsetId is required");
          const statusOption = String(body.statusOption || "PAUSED").toUpperCase();
          const so = statusOption === "ACTIVE" ? "ACTIVE" : "PAUSED";
          const raw = await copyAdSetDeep(sourceAdsetId, { statusOption: so, deepCopy: body.deepCopy !== false });
          const copiedId = raw.copied_adset_id || raw.copied_ad_set_id || raw.id || raw.adset_id;
          sendJson(req, res, 200, { ok: true, metaMode: "live", raw, copiedAdsetId: copiedId });
        } catch (error) {
          sendJson(req, res, 502, { ok: false, error: error.message, meta: error.meta });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/api/meta/ad/creative") {
        const body = await parseBody(req);
        if (useMockMeta()) {
          sendJson(req, res, 200, { ok: true, metaMode: "mock", note: "META_USE_MOCK — no Graph call" });
          return;
        }
        try {
          const adId = String(body.metaAdId || "").trim();
          const creativeId = String(body.metaCreativeId || "").trim();
          if (!adId || !creativeId) throw new Error("metaAdId and metaCreativeId are required");
          const result = await updateAdCreativeOnAd(adId, creativeId);
          sendJson(req, res, 200, { ok: true, metaMode: "live", result });
        } catch (error) {
          sendJson(req, res, 502, { ok: false, error: error.message, meta: error.meta });
        }
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/api/meta/adset/ads")) {
        const url = new URL(req.url, "http://localhost");
        const adsetId = String(url.searchParams.get("adsetId") || "").trim();
        if (!adsetId) {
          sendJson(req, res, 400, { ok: false, error: "adsetId query param is required" });
          return;
        }
        if (useMockMeta()) {
          sendJson(req, res, 200, { ok: true, metaMode: "mock", data: { data: [] } });
          return;
        }
        try {
          const data = await getAdsForAdset(adsetId);
          sendJson(req, res, 200, { ok: true, metaMode: "live", data });
        } catch (error) {
          sendJson(req, res, 502, { ok: false, error: error.message, meta: error.meta });
        }
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
          sendJson(req, res, 401, {
            ok: false,
            error: "Invalid webhook signature",
            hint:
              CRM_WEBHOOK_SECRET
                ? "Send header X-Webhook-Signature: sha256=<hex> where hex = HMAC-SHA256(secret, raw body)."
                : "Set CRM_WEBHOOK_SECRET in env to enforce signatures; while unset, verification is skipped.",
          });
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
        sendJson(req, res, 200, {
          ok: true,
          received: eventType,
          signatureMode: CRM_WEBHOOK_SECRET ? "enforced" : "skipped (CRM_WEBHOOK_SECRET unset)",
        });
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

/** PaaS (Render, Fly, Railway) must bind 0.0.0.0 for external routing; local dev uses Node default when unset. */
function listenHostForPlatform() {
  if (process.env.BIND_HOST) return process.env.BIND_HOST;
  const cloud =
    process.env.RENDER === "true" ||
    process.env.FLY_APP_NAME ||
    process.env.RAILWAY_ENVIRONMENT === "production";
  if (cloud || process.env.NODE_ENV === "production") return "0.0.0.0";
  return undefined;
}

process.on("unhandledRejection", (reason, p) => {
  console.error("[fatal] unhandledRejection", p, reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException", err);
  process.exit(1);
});

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

  const listenHost = listenHostForPlatform();
  let listenPort = PORT;
  const maxDevPortTries = 10;
  for (let attempt = 0; attempt < maxDevPortTries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const onErr = (err) => {
          server.off("error", onErr);
          reject(err);
        };
        server.once("error", onErr);
        const onListening = () => {
          server.off("error", onErr);
          resolve();
        };
        if (listenHost) {
          server.listen(listenPort, listenHost, onListening);
        } else {
          server.listen(listenPort, onListening);
        }
      });
      break;
    } catch (err) {
      if (
        err?.code === "EADDRINUSE" &&
        process.env.NODE_ENV !== "production" &&
        attempt < maxDevPortTries - 1
      ) {
        await new Promise((resolve) => server.close(() => resolve()));
        console.warn(
          `Port ${listenPort} in use — trying ${listenPort + 1}. If the UI cannot connect, set VITE_API_BASE=http://localhost:${listenPort + 1} in .env`
        );
        listenPort += 1;
        continue;
      }
      if (err?.code === "EADDRINUSE") {
        console.error(
          `\nPort ${listenPort} is already in use.\n\nFix:\n  • Stop the other process, or\n  • Kill: kill $(lsof -ti :${listenPort})\n  • Or set API_PORT=3002 npm run dev:api\n`
        );
      } else {
        console.error(err);
      }
      process.exit(1);
    }
  }

  const hostLabel = listenHost || "default";
  console.log(
    `Bot backend running on port ${listenPort} (host ${hostLabel}) — ${listenHost ? "0.0.0.0 = all interfaces (Render)" : "Node default bind"}`
  );
  console.log(`Meta mode: ${useMockMeta() ? "MOCK (set META_ACCESS_TOKEN + META_AD_ACCOUNT_ID for live)" : "LIVE"}`);
  console.log(`Engine DB: ${process.env.ENGINE_DB_PATH || "data/bot-engine.db"}`);
  if (listenPort !== PORT) {
    console.warn(`Listening on ${listenPort} (requested ${PORT}). Match VITE_API_BASE in .env to http://localhost:${listenPort}`);
  }
  startScheduler();

  const shutdown = (signal) => {
    console.log(`[shutdown] ${signal} — closing HTTP server`);
    server.close(() => {
      console.log("[shutdown] http server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

boot();
