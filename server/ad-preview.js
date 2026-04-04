import { state } from "./state.js";
import { getMetaConfig } from "./meta-graph.js";

function displayLink(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return (url || "example.com").replace(/^https?:\/\//, "").split("/")[0] || "example.com";
  }
}

/**
 * Updates persisted in-memory ad preview for dashboard + optional POST /api/preview/render.
 * @param {Record<string, unknown>} body — same fields as pipeline (message, headline, imageUrl, …)
 * @param {{ result?: object, publishResult?: object | null }} [opts]
 */
export function applyAdPreviewFromBody(body, opts = {}) {
  const c = getMetaConfig();
  const link = body.link || c.appBaseUrl;
  const fileUrl = body.file_url || body.fileUrl;
  const cards = Array.isArray(body.carouselCards) ? body.carouselCards.filter(Boolean) : [];
  const isVideo = Boolean(
    body.videoId || body.mode === "video" || (fileUrl && String(fileUrl).match(/\.(mp4|mov|webm)(\?|$)/i))
  );
  const isCarousel = cards.length >= 2 || body.mode === "carousel";
  const mediaUrl = isVideo
    ? String(fileUrl || "")
    : String(body.imageUrl || body.url || "https://picsum.photos/seed/adpreview/1200/630");

  const prevPreview = state.lastAdPreview || {};
  let deliveryStatus = "PAUSED";
  if (opts.publishResult?.status === "ACTIVE") deliveryStatus = "ACTIVE";
  else if (opts.result) deliveryStatus = "PAUSED";
  else deliveryStatus = prevPreview.deliveryStatus || "PAUSED";

  const result = opts.result;
  const prevIds = state.lastAdPreview?.metaIds || {};
  state.lastAdPreview = {
    pageName: body.pageName || process.env.META_PAGE_NAME || "Your Page",
    primaryText:
      body.message ||
      "Explore premium travel packages tailored to your dream destinations.",
    headline: body.headline || "Book Your Dream Trip",
    description: body.description || "Limited-time offers. Qualified leads only.",
    linkUrl: link,
    displayLink: displayLink(link),
    cta: body.cta || "Learn more",
    mediaType: isCarousel ? "carousel" : isVideo ? "video" : "image",
    mediaUrl,
    carouselCards: isCarousel
      ? cards.map((card) => ({
          headline: card.headline || card.name || "",
          description: card.description || "",
          link: card.link || link,
          imageUrl: card.imageUrl || card.url || "",
        }))
      : [],
    deliveryStatus,
    metaIds: result
      ? {
          campaignId: result.campaign?.id,
          adsetId: result.adset?.id,
          adId: result.ad?.id,
          creativeId: result.creative?.id,
        }
      : { ...prevIds },
  };
}

/** After POST /api/meta/upload-image — point feed preview at the same URL (https or data:). */
export function syncAdPreviewFromUploadedImage(body) {
  const url = body?.url || body?.imageUrl;
  if (!url || typeof url !== "string") return;
  const prev = state.lastAdPreview || {};
  const cards = Array.isArray(prev.carouselCards) ? prev.carouselCards.filter(Boolean) : [];
  const keepCarousel = prev.mediaType === "carousel" && cards.length >= 2;

  if (keepCarousel) {
    applyAdPreviewFromBody(
      {
        message: prev.primaryText,
        headline: prev.headline,
        description: prev.description,
        link: prev.linkUrl,
        pageName: prev.pageName,
        cta: prev.cta,
        imageUrl: url,
        url,
        mode: "carousel",
        carouselCards: cards,
      },
      {}
    );
    return;
  }

  applyAdPreviewFromBody(
    {
      message: prev.primaryText,
      headline: prev.headline,
      description: prev.description,
      link: prev.linkUrl,
      pageName: prev.pageName,
      cta: prev.cta,
      imageUrl: url,
      url,
      mode: "image",
    },
    {}
  );
}

/** After POST /api/meta/upload-video — show video in feed preview. */
export function syncAdPreviewFromUploadedVideo(body) {
  const fileUrl = body?.file_url || body?.fileUrl;
  if (!fileUrl || typeof fileUrl !== "string") return;
  const prev = state.lastAdPreview || {};
  applyAdPreviewFromBody(
    {
      message: prev.primaryText,
      headline: prev.headline,
      description: prev.description,
      link: prev.linkUrl,
      pageName: prev.pageName,
      cta: prev.cta,
      file_url: fileUrl,
      mode: "video",
    },
    {}
  );
}
