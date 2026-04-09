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
    : String(body.imageUrl || body.url || "https://picsum.photos/seed/adpreview/1200/628");

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
      ? cards.map((raw) => {
          const card = raw && typeof raw === "object" ? raw : {};
          /** Spread first so template/extra keys round-trip; then normalize known fields for preview + Meta. */
          const merged = {
            ...card,
            headline: String(card.headline ?? card.name ?? ""),
            description: card.description != null ? String(card.description) : "",
            link: card.link != null && String(card.link).trim() !== "" ? String(card.link) : link,
            imageUrl: String(card.imageUrl || card.url || ""),
            priceLabel: card.priceLabel != null ? String(card.priceLabel) : "",
            price: card.price != null ? String(card.price) : "",
          };
          if (Object.prototype.hasOwnProperty.call(card, "badge")) {
            merged.badge = card.badge == null || card.badge === "" ? "" : String(card.badge);
          }
          if (card.tourType != null) merged.tourType = String(card.tourType);
          else if (card.category != null && merged.tourType == null) merged.tourType = String(card.category);
          if (card.travelersLine != null) merged.travelersLine = String(card.travelersLine);
          else if (card.travelers != null && merged.travelersLine == null) merged.travelersLine = String(card.travelers);
          return merged;
        })
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

/** After POST /api/meta/upload-image — hero + 3 carousel cards use the same image (Upload & build sync). */
export function syncAdPreviewFromUploadedImage(body) {
  const url = body?.url || body?.imageUrl;
  if (!url || typeof url !== "string") return;
  const prev = state.lastAdPreview || {};
  const c = getMetaConfig();
  const link = prev.linkUrl || c.appBaseUrl;
  const carouselCards = [1, 2, 3].map((n) => ({
    headline: `Package ${n}`,
    imageUrl: url,
    url,
    link,
    priceLabel: "",
  }));

  applyAdPreviewFromBody(
    {
      message: prev.primaryText,
      headline: prev.headline,
      description: prev.description,
      link,
      pageName: prev.pageName,
      cta: prev.cta,
      imageUrl: url,
      url,
      mode: "carousel",
      carouselCards,
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
