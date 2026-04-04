import { getMetaConfig, isMetaConfigured } from "./meta-graph.js";

/**
 * Publish / activate gates — conservative defaults.
 * Set META_AUTO_PUBLISH=true to allow auto-activation when checks pass.
 * trackingHealth is persisted (0–1) and updated from recent CAPI success rate when events are sent.
 */
export function evaluatePublishPolicy({ useMock, trackingHealth }) {
  const cfg = getMetaConfig();
  const reasons = [];

  if (!useMock) {
    if (process.env.META_AUTO_PUBLISH !== "true") {
      reasons.push("META_AUTO_PUBLISH is not true (set to enable auto-activate)");
    }
    if (!isMetaConfigured()) {
      reasons.push("Meta token/ad account not configured");
    }
    if (!cfg.pageId) {
      reasons.push("META_PAGE_ID required for live creatives");
    }
  }

  const th = Number(trackingHealth ?? 0.85);
  if (th < 0.65) {
    reasons.push(`tracking health ${th} below 0.65`);
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    reasons: allowed ? ["ready for auto-publish"] : reasons,
    config: {
      metaAutoPublish: process.env.META_AUTO_PUBLISH === "true",
      hasPage: Boolean(cfg.pageId),
      mockRelaxed: useMock,
    },
  };
}
