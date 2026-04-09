/**
 * Meta feed / link creative pixel targets (design-time). Preview CSS matches these ratios.
 * @see https://www.facebook.com/business/help (image specs vary by placement)
 */

export const META_FEED_LINK = {
  id: "feed-link",
  label: "Feed / link — single image or carousel hero",
  width: 1200,
  height: 628,
  aspect: "1.91:1",
};

export const META_CAROUSEL_PORTRAIT = {
  id: "carousel-4-5",
  label: "Carousel card (portrait, matches this preview)",
  width: 1080,
  height: 1350,
  aspect: "4:5",
};

export const META_CAROUSEL_SQUARE = {
  id: "carousel-1-1",
  label: "Carousel card (square, alternative)",
  width: 1080,
  height: 1080,
  aspect: "1:1",
};

export const META_CREATIVE_SPECS = [META_FEED_LINK, META_CAROUSEL_PORTRAIT, META_CAROUSEL_SQUARE];

/**
 * HTML fragment for Creatives → Ad preview panel (static copy).
 */
export function creativeSpecsPanelHtml() {
  const rows = META_CREATIVE_SPECS.map(
    (s) =>
      `<tr>
        <td>${escapeSpecsHtml(s.label)}</td>
        <td><code>${s.width}×${s.height}</code></td>
        <td>${escapeSpecsHtml(s.aspect)}</td>
      </tr>`
  ).join("");
  return `<div class="creative-specs-panel" role="region" aria-label="Meta recommended image sizes">
    <h4 class="creative-specs-title">Recommended image sizes (Meta feed / link)</h4>
    <p class="creative-specs-note">Export assets at these pixel dimensions for clearest delivery. The live preview uses a <strong>360px</strong>-wide frame: hero at <strong>1200×628</strong> (1.91:1), strip cards at <strong>4:5</strong> (~<strong>140px</strong> wide, <strong>10px</strong> gap, <strong>16px</strong> side padding).</p>
    <table class="creative-specs-table">
      <thead><tr><th scope="col">Use</th><th scope="col">Pixels</th><th scope="col">Ratio</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function escapeSpecsHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
