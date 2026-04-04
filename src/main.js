import "./style.css";

/** First ISO2 from comma/space-separated list; fallback LK (matches ad set geo fallback). */
function firstCountryFromCsv(csv) {
  const codes = String(csv || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return codes[0] || "LK";
}

const appState = {
  activeView: "overview",
  segment: "all",
  period: "30d",
  projectLabel: "travel-roi-super-bot",
  loading: true,
  error: "",
  videoScriptText: "",
  /** Daily budget in major currency units (e.g. USD) — sent as Meta ad set daily_budget. */
  budgets: {
    campaign: 300,
    pipelineImage: 25,
    pipelineCarousel: 35,
  },
  /** Maps to Meta ad set `targeting` (Graph). Editable on Campaigns tab. */
  targetingDraft: {
    countries: "LK",
    ageMin: 21,
    ageMax: 55,
    locales: "1000",
    flexibleSpecJson: "",
  },
  /** When false, locales auto-update from countries; when true, user controls locales. */
  targetingLocalesManual: false,
  /** Meta `targetingsearch` type param per tab */
  targetingSearchTab: "adinterest",
  targetingSearchQuery: "",
  targetingSearchResults: [],
  /** { id, name, apiType } for flexible_spec merge */
  targetingSearchPicks: [],
  /** ISO2 for Meta targetingsearch `country_code` (audience scope). Syncs from first Audience targeting country on change. */
  targetingSearchCountry: "LK",
};

const TARGETING_SEARCH_TABS = [
  { type: "adinterest", label: "Interests" },
  { type: "adbehavior", label: "Behaviors" },
  { type: "work_title", label: "Job titles" },
  { type: "work_employer", label: "Employers" },
];

/** Maps targetingsearch `type` → flexible_spec key (Meta ad set targeting). */
const TARGETING_FLEX_KEYS = {
  adinterest: "interests",
  adbehavior: "behaviors",
  work_title: "work_positions",
  work_employer: "work_employers",
};

/** ISO2 list for Meta `geo_locations.countries` — grouped multi-select (reduces typos). */
const TARGETING_COUNTRY_GROUPS = [
  {
    label: "Europe",
    countries: [
      ["AL", "Albania"],
      ["AD", "Andorra"],
      ["AT", "Austria"],
      ["BY", "Belarus"],
      ["BE", "Belgium"],
      ["BA", "Bosnia and Herzegovina"],
      ["BG", "Bulgaria"],
      ["HR", "Croatia"],
      ["CY", "Cyprus"],
      ["CZ", "Czech Republic"],
      ["DK", "Denmark"],
      ["EE", "Estonia"],
      ["FI", "Finland"],
      ["FR", "France"],
      ["DE", "Germany"],
      ["GR", "Greece"],
      ["HU", "Hungary"],
      ["IS", "Iceland"],
      ["IE", "Ireland"],
      ["IT", "Italy"],
      ["LV", "Latvia"],
      ["LI", "Liechtenstein"],
      ["LT", "Lithuania"],
      ["LU", "Luxembourg"],
      ["MT", "Malta"],
      ["MD", "Moldova"],
      ["MC", "Monaco"],
      ["ME", "Montenegro"],
      ["NL", "Netherlands"],
      ["MK", "North Macedonia"],
      ["NO", "Norway"],
      ["PL", "Poland"],
      ["PT", "Portugal"],
      ["RO", "Romania"],
      ["RU", "Russia"],
      ["SM", "San Marino"],
      ["RS", "Serbia"],
      ["SK", "Slovakia"],
      ["SI", "Slovenia"],
      ["ES", "Spain"],
      ["SE", "Sweden"],
      ["CH", "Switzerland"],
      ["UA", "Ukraine"],
      ["GB", "United Kingdom"],
      ["VA", "Vatican City"],
    ],
  },
  {
    label: "Australia & Pacific",
    countries: [
      ["AU", "Australia"],
      ["NZ", "New Zealand"],
      ["FJ", "Fiji"],
      ["PG", "Papua New Guinea"],
    ],
  },
  {
    label: "Asia & Middle East",
    countries: [
      ["LK", "Sri Lanka"],
      ["IN", "India"],
      ["AE", "United Arab Emirates"],
      ["SG", "Singapore"],
      ["MY", "Malaysia"],
      ["TH", "Thailand"],
      ["JP", "Japan"],
      ["KR", "South Korea"],
      ["ID", "Indonesia"],
      ["PH", "Philippines"],
      ["VN", "Vietnam"],
    ],
  },
  {
    label: "Americas",
    countries: [
      ["US", "United States"],
      ["CA", "Canada"],
      ["MX", "Mexico"],
      ["BR", "Brazil"],
    ],
  },
];

/**
 * Primary Meta `locales` ID per ISO2 country (heuristic; multi-locale countries are simplified).
 * Unlisted codes fall back to 1000 (English).
 */
const COUNTRY_TO_PRIMARY_LOCALE = {
  US: 1000,
  GB: 1000,
  IE: 1000,
  AU: 1000,
  NZ: 1000,
  CA: 1000,
  LK: 1000,
  IN: 1000,
  SG: 1000,
  AE: 1000,
  CY: 1000,
  MT: 1000,
  MY: 1000,
  FJ: 1000,
  PG: 1000,
  DE: 5,
  AT: 5,
  CH: 5,
  LI: 5,
  FR: 6,
  BE: 6,
  LU: 6,
  MC: 6,
  AD: 6,
  ES: 24,
  MX: 24,
  IT: 7,
  SM: 7,
  VA: 7,
  PT: 16,
  BR: 16,
  NL: 11,
  RU: 28,
  BY: 28,
  UA: 28,
  MD: 28,
  PL: 15,
  SE: 17,
  NO: 18,
  DK: 8,
  FI: 10,
  IS: 19,
  CZ: 14,
  SK: 14,
  HU: 23,
  RO: 22,
  BG: 21,
  GR: 25,
  JP: 12,
  KR: 13,
  TH: 35,
  VN: 37,
  ID: 41,
  PH: 31,
  HR: 24,
  SI: 24,
  BA: 24,
  RS: 28,
  ME: 24,
  MK: 24,
  AL: 24,
  EE: 17,
  LV: 17,
  LT: 17,
};

function localeIdsFromCountries(countryCsv) {
  const codes = String(countryCsv || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  const effective = codes.length ? codes : ["LK"];
  const ids = new Set();
  for (const code of effective) {
    ids.add(COUNTRY_TO_PRIMARY_LOCALE[code] ?? 1000);
  }
  return Array.from(ids)
    .sort((a, b) => a - b)
    .join(", ");
}

function applyAutoLocalesFromCountries() {
  if (appState.targetingLocalesManual) return;
  appState.targetingDraft.locales = localeIdsFromCountries(appState.targetingDraft.countries);
}

function syncLocalesInputFromState() {
  const loc = document.querySelector("#targetingLocales");
  if (loc) loc.value = String(appState.targetingDraft.locales || "");
}

function targetingCountriesSelectHtml() {
  const selected = new Set(
    String(appState.targetingDraft.countries || "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((code) => /^[A-Z]{2}$/.test(code))
  );
  const blocks = [];
  for (const group of TARGETING_COUNTRY_GROUPS) {
    const opts = group.countries
      .map(([code, name]) => {
        const sel = selected.has(code) ? " selected" : "";
        return `<option value="${escapeAttr(code)}"${sel}>${escapeHtml(`${name} (${code})`)}</option>`;
      })
      .join("");
    blocks.push(`<optgroup label="${escapeAttr(group.label)}">${opts}</optgroup>`);
  }
  return `<select id="targetingCountries" class="targeting-countries-select" multiple size="12" title="Select one or more countries">${blocks.join("")}</select>`;
}

function targetingSearchCountrySelectHtml() {
  const selected = String(appState.targetingSearchCountry || "LK").toUpperCase();
  const blocks = [];
  for (const group of TARGETING_COUNTRY_GROUPS) {
    const opts = group.countries
      .map(([code, name]) => {
        const sel = code === selected ? " selected" : "";
        return `<option value="${escapeAttr(code)}"${sel}>${escapeHtml(`${name} (${code})`)}</option>`;
      })
      .join("");
    blocks.push(`<optgroup label="${escapeAttr(group.label)}">${opts}</optgroup>`);
  }
  return `<select id="targetingSearchCountry" class="targeting-search-country-select" aria-label="Country for Meta targeting search">${blocks.join("")}</select>`;
}

function parsePositiveBudget(value, fallback) {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function clampTargetingAge(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(13, Math.min(65, Math.round(v)));
}

function syncTargetingDraftFromDom() {
  const c = document.querySelector("#targetingCountries");
  const a1 = document.querySelector("#targetingAgeMin");
  const a2 = document.querySelector("#targetingAgeMax");
  const loc = document.querySelector("#targetingLocales");
  const flex = document.querySelector("#targetingFlexibleJson");
  if (c) {
    if (c.multiple) {
      appState.targetingDraft.countries = Array.from(c.selectedOptions)
        .map((o) => o.value)
        .join(", ");
    } else {
      appState.targetingDraft.countries = c.value;
    }
  }
  if (a1) appState.targetingDraft.ageMin = clampTargetingAge(a1.value, appState.targetingDraft.ageMin);
  if (a2) appState.targetingDraft.ageMax = clampTargetingAge(a2.value, appState.targetingDraft.ageMax);
  if (loc) appState.targetingDraft.locales = loc.value;
  const locManual = document.querySelector("#targetingLocalesManual");
  if (locManual) appState.targetingLocalesManual = locManual.checked;
  if (flex) appState.targetingDraft.flexibleSpecJson = flex.value;
}

/** Builds Meta Marketing API ad set targeting from the Campaigns form (also used by Automation pipelines). */
function buildMetaTargetingFromDraft() {
  const d = appState.targetingDraft;
  const countries = String(d.countries || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  let ageMin = clampTargetingAge(d.ageMin, 21);
  let ageMax = clampTargetingAge(d.ageMax, 55);
  if (ageMax < ageMin) ageMax = ageMin;

  const targeting = {
    geo_locations: { countries: countries.length ? countries : ["LK"] },
    age_min: ageMin,
    age_max: ageMax,
  };

  const localeParts = String(d.locales || "")
    .split(/[\s,]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  if (localeParts.length) targeting.locales = localeParts;

  const raw = String(d.flexibleSpecJson || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) targeting.flexible_spec = parsed;
      else if (parsed && typeof parsed === "object") targeting.flexible_spec = [parsed];
    } catch {
      /* invalid JSON — server would fail; user can fix in form */
    }
  }

  return targeting;
}

function mergePicksIntoFlexibleSpecJson(picks, currentJson) {
  const list = Array.isArray(picks) ? picks : [];
  let base = [{}];
  try {
    const t = String(currentJson || "").trim();
    if (t) {
      const p = JSON.parse(t);
      base = Array.isArray(p) ? p : [p];
    }
  } catch {
    base = [{}];
  }
  const first = { ...(base[0] && typeof base[0] === "object" ? base[0] : {}) };
  for (const pick of list) {
    const flexKey = TARGETING_FLEX_KEYS[pick.apiType] || "interests";
    if (!first[flexKey]) first[flexKey] = [];
    const arr = first[flexKey];
    const exists = arr.some((x) => String(x.id) === String(pick.id));
    if (!exists) arr.push({ id: pick.id, name: pick.name || "" });
  }
  base[0] = first;
  return JSON.stringify(base, null, 2);
}

function targetingSearchTabsHtml() {
  return TARGETING_SEARCH_TABS.map(
    (t) =>
      `<button type="button" class="targeting-tab ${appState.targetingSearchTab === t.type ? "active" : ""}" data-targeting-tab="${escapeAttr(t.type)}">${escapeHtml(t.label)}</button>`
  ).join("");
}

function targetingSearchRowsHtml() {
  const rows = appState.targetingSearchResults || [];
  if (!rows.length) {
    return `<tr><td colspan="4" class="targeting-search-empty">No results yet — pick a tab, enter a keyword, Search.</td></tr>`;
  }
  return rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td><code>${escapeHtml(String(r.id))}</code></td>
        <td>${r.audience_size != null ? escapeHtml(String(r.audience_size)) : "—"}</td>
        <td><button type="button" class="btn-ghost targeting-add-row" data-id="${escapeAttr(String(r.id))}" data-name="${escapeAttr(r.name || "")}">Add</button></td>
      </tr>`
    )
    .join("");
}

function targetingPicksHtml() {
  const picks = appState.targetingSearchPicks || [];
  if (!picks.length) {
    return `<span class="muted">None — click Add on a result row.</span>`;
  }
  return picks
    .map(
      (p, i) =>
        `<span class="targeting-pick-chip">${escapeHtml(p.name)} <button type="button" class="targeting-pick-remove" data-pick-index="${i}">×</button></span>`
    )
    .join(" ");
}

const endpoints = [
  "/api/dashboard/state",
  "/api/preview/render",
  "/api/pipeline/run",
  "/api/loop/tick",
  "/api/policy",
  "/api/content/video-script",
  "/api/meta/health",
  "/api/meta/targeting-search",
  "/api/meta/track",
  "/api/meta/upload-image",
  "/api/meta/upload-video",
  "/api/meta/create-creative",
  "/api/meta/sync-audience",
  "/api/meta/create-campaign",
  "/api/meta/insights",
  "/api/meta/optimize",
  "/api/crm/webhook",
  "/api/crm/quality",
  "/api/revenue/record",
  "/api/business/summary",
];

const dashboard = {
  kpis: [],
  campaigns: [],
  creatives: [],
  audiences: [],
  crm: [],
  actions: [],
  targeting: null,
  cronJobs: [],
  meta: null,
  engine: null,
  policy: null,
  creativeScores: [],
  hooks: [],
  adPreview: null,
  business: null,
  assets: { images: [], videos: [], adcreatives: [] },
};

const app = document.querySelector("#app");
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

/** Short blob: URL for local file preview (avoids huge data: URLs in DOM / JSON). */
let previewImageBlobUrl = null;

function revokePreviewImageBlob() {
  if (previewImageBlobUrl) {
    try {
      URL.revokeObjectURL(previewImageBlobUrl);
    } catch {
      /* ignore */
    }
    previewImageBlobUrl = null;
  }
}

function applyLocalPreviewImageBlob() {
  if (previewImageBlobUrl && dashboard.adPreview) {
    dashboard.adPreview = {
      ...dashboard.adPreview,
      mediaUrl: previewImageBlobUrl,
    };
  }
}
/** Must match server API_KEY when POST auth is enabled (never commit real secrets). */
const CLIENT_API_KEY = import.meta.env.VITE_API_KEY || "";
/** Comma/space-separated emails appended to Sync Hot/Warm POST body for live Custom Audience upload. */
function audienceSyncEmailsFromEnv() {
  const raw = import.meta.env.VITE_AUDIENCE_SYNC_EMAILS || "";
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSyncAudienceBody(segment) {
  const body = { segment };
  const emails = audienceSyncEmailsFromEnv();
  if (emails.length) body.emails = emails;
  return body;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function isVideoUrlForPreview(url) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(String(url || ""));
}

function adPreviewMarkup(preview) {
  const p = preview || {};
  const status = p.deliveryStatus === "ACTIVE" ? "ACTIVE" : "PAUSED";
  const cards = Array.isArray(p.carouselCards) ? p.carouselCards.filter(Boolean) : [];
  const hasCarousel = p.mediaType === "carousel" && cards.length >= 2;
  const hasVideo = p.mediaType === "video" && p.mediaUrl;
  const hasImage = Boolean(p.mediaUrl) && !hasVideo && !hasCarousel;

  const carouselStripHtml = cards
    .map(
      (card) => `<article class="ad-preview-card-item">
        <img class="ad-preview-card-media" src="${escapeAttr(card.imageUrl || "https://picsum.photos/seed/card/1200/630")}" alt="" />
        <div class="ad-preview-card-body">
          <p class="ad-preview-card-title">${escapeHtml(card.headline || "Travel package")}</p>
          <p class="ad-preview-card-text">${escapeHtml(card.description || "")}</p>
        </div>
      </article>`
    )
    .join("");

  let media;
  if (hasCarousel) {
    const heroRaw =
      (p.mediaUrl && String(p.mediaUrl).trim()) ||
      cards[0]?.imageUrl ||
      cards[0]?.url ||
      "https://picsum.photos/seed/carousel-hero/1200/630";
    const heroUrl = String(heroRaw);
    const heroIsVideo = isVideoUrlForPreview(heroUrl);
    const heroBlock = heroIsVideo
      ? `<video class="ad-preview-media ad-preview-carousel-hero-media" src="${escapeAttr(heroUrl)}" controls muted playsinline loop></video>`
      : `<img class="ad-preview-media ad-preview-carousel-hero-media" src="${escapeAttr(heroUrl)}" alt="" />`;
    media = `<div class="ad-preview-carousel-stack">
      <div class="ad-preview-carousel-hero">${heroBlock}</div>
      <p class="ad-preview-carousel-strip-title">More packages — swipe</p>
      <div class="ad-preview-carousel">${carouselStripHtml}</div>
    </div>`;
  } else if (hasVideo) {
    media = `<video class="ad-preview-media" src="${escapeAttr(p.mediaUrl)}" controls muted playsinline loop></video>`;
  } else if (hasImage) {
    media = `<img class="ad-preview-media" src="${escapeAttr(p.mediaUrl)}" alt="" />`;
  } else {
    media = `<div class="ad-preview-media ad-preview-placeholder">Add image or video URL</div>`;
  }

  const ids = p.metaIds || {};
  const idLine =
    ids.adId || ids.campaignId
      ? `<p class="ad-preview-metaids">${escapeHtml([ids.adId && `Ad ${ids.adId}`, ids.campaignId && `Campaign ${ids.campaignId}`].filter(Boolean).join(" · "))}</p>`
      : "";

  return `
    <div class="ad-preview-device">
      <div class="ad-preview-chrome">
        <span class="ad-preview-dot"></span><span class="ad-preview-dot"></span><span class="ad-preview-dot"></span>
      </div>
      <div class="ad-preview-surface">
        <div class="ad-preview-card">
          <div class="ad-preview-header">
            <div class="ad-preview-avatar" aria-hidden="true">${escapeHtml((p.pageName || "P").slice(0, 1).toUpperCase())}</div>
            <div class="ad-preview-headmeta">
              <div class="ad-preview-pagename">${escapeHtml(p.pageName || "Your Page")}</div>
              <div class="ad-preview-sponsored">Sponsored · <span class="ad-preview-status ad-preview-status--${status === "ACTIVE" ? "on" : "off"}">${status}</span></div>
            </div>
          </div>
          <p class="ad-preview-primary">${escapeHtml(p.primaryText || "")}</p>
          ${media}
          <a class="ad-preview-linkbox" href="${escapeAttr(p.linkUrl || "#")}" target="_blank" rel="noopener noreferrer">
            <div class="ad-preview-linkcol">
              <div class="ad-preview-linkheadline">${escapeHtml(p.headline || "")}</div>
              <div class="ad-preview-linkdesc">${escapeHtml(p.description || "")}</div>
              <div class="ad-preview-domain">${escapeHtml(p.displayLink || "")}</div>
            </div>
            <span class="ad-preview-cta">${escapeHtml(p.cta || "Learn more")}</span>
          </a>
        </div>
        ${idLine}
      </div>
    </div>
  `;
}

function tableRows(rows, keys) {
  if (!rows.length) return `<tr><td colspan="${keys.length}">No data</td></tr>`;
  return rows
    .map(
      (row) =>
        `<tr>${keys
          .map((key) => `<td>${escapeHtml(row[key])}</td>`)
          .join("")}</tr>`
    )
    .join("");
}

/** Rows for Meta upload-image / upload-video results (dashboard.assets). */
function uploadAssetsRows() {
  const a = dashboard.assets || { images: [], videos: [], adcreatives: [] };
  const rows = [];
  for (const img of a.images || []) {
    rows.push({
      type: "Image",
      name: img.name || "—",
      id: img.imageHash || img.id || "—",
      status: img.status || "—",
    });
  }
  for (const vid of a.videos || []) {
    rows.push({
      type: "Video",
      name: vid.name || "—",
      id: vid.videoId || vid.id || "—",
      status: vid.status || "—",
    });
  }
  for (const cr of a.adcreatives || []) {
    rows.push({
      type: "Creative",
      name: cr.name || "—",
      id: cr.id || "—",
      status: cr.status || "—",
    });
  }
  if (!rows.length) {
    return `<tr><td colspan="4">No uploads yet — click Upload Image or Upload Video.</td></tr>`;
  }
  return tableRows(rows, ["type", "name", "id", "status"]);
}

function render() {
  if (appState.loading) {
    app.innerHTML = `<div class="loading">Loading backend data from ${API_BASE}...</div>`;
    return;
  }

  if (appState.error) {
    app.innerHTML = `<div class="loading error">${escapeHtml(appState.error)}</div>`;
    return;
  }

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <h1>Bot Ops</h1>
        <p class="sub">${appState.projectLabel}</p>
        <nav class="nav">
          <button type="button" class="nav-item ${appState.activeView === "overview" ? "active" : ""}" data-view="overview">Overview</button>
          <button type="button" class="nav-item ${appState.activeView === "campaigns" ? "active" : ""}" data-view="campaigns">Campaigns</button>
          <button type="button" class="nav-item ${appState.activeView === "creatives" ? "active" : ""}" data-view="creatives">Creatives</button>
          <button type="button" class="nav-item ${appState.activeView === "audience" ? "active" : ""}" data-view="audience">Audience</button>
          <button type="button" class="nav-item ${appState.activeView === "crm" ? "active" : ""}" data-view="crm">CRM</button>
          <button type="button" class="nav-item ${appState.activeView === "optimizer" ? "active" : ""}" data-view="optimizer">Optimizer</button>
          <button type="button" class="nav-item ${appState.activeView === "automation" ? "active" : ""}" data-view="automation">Automation</button>
        </nav>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div>
            <h2>Qualified Booking ROAS Console</h2>
            <p>Goal locked: qualified_booking_roas</p>
            <p class="meta-pill">
              Meta API:
              <strong>${dashboard.meta?.mode === "live" ? "LIVE (Graph)" : "MOCK / test"}</strong>
              ${dashboard.meta?.metaUseMockEnv ? " · META_USE_MOCK=true" : ""}
              · token: ${dashboard.meta?.hasAccessToken ? "set" : "missing"}
              · ad account: ${dashboard.meta?.adAccountConfigured ? "set" : "missing"}
            </p>
            <ul class="funnel meta-mode-hints">
              ${(dashboard.meta?.modeHints || [])
                .map((h) => `<li><span>${escapeHtml(h)}</span></li>`)
                .join("")}
            </ul>
            ${
              dashboard.meta?.demoSeedData
                ? `<p class="meta-pill warn">Demo seed rows active (non-production default). Set SEED_DEMO_DATA=false for empty dashboard.</p>`
                : ""
            }
            <p class="meta-pill">Tracking: POST /api/meta/track updates funnel in-app; Meta CAPI uses POST /api/meta/capi/event (separate).</p>
          </div>
          <div class="filters">
            <label>
              Segment
              <select id="segmentFilter">
                <option value="all" ${appState.segment === "all" ? "selected" : ""}>All</option>
                <option value="honeymoon" ${appState.segment === "honeymoon" ? "selected" : ""}>Honeymoon</option>
                <option value="family" ${appState.segment === "family" ? "selected" : ""}>Family</option>
                <option value="luxury" ${appState.segment === "luxury" ? "selected" : ""}>Luxury</option>
              </select>
            </label>
            <label>
              Period
              <select id="periodFilter">
                <option value="7d" ${appState.period === "7d" ? "selected" : ""}>7D</option>
                <option value="30d" ${appState.period === "30d" ? "selected" : ""}>30D</option>
                <option value="90d" ${appState.period === "90d" ? "selected" : ""}>90D</option>
              </select>
            </label>
            <button type="button" id="refreshButton">Refresh</button>
          </div>
        </header>

        <section class="kpi-grid">
          ${dashboard.kpis
            .map(
              (kpi) => `
            <article class="card">
              <p class="eyebrow">${escapeHtml(kpi.label)}</p>
              <p class="value">${escapeHtml(kpi.value)}</p>
              <p class="delta ${kpi.positive ? "positive" : "negative"}">${escapeHtml(kpi.delta)}</p>
            </article>
          `
            )
            .join("")}
        </section>

        <section class="view ${appState.activeView === "overview" ? "show" : ""}" id="overview">
          <div class="split">
            <article class="card">
              <h3>Funnel Snapshot</h3>
              <ul class="funnel">
                <li><span>ViewContent</span><strong>${dashboard.engine?.funnel?.viewContent ?? 0}</strong></li>
                <li><span>Leads</span><strong>${dashboard.engine?.funnel?.lead ?? 0}</strong></li>
                <li><span>Qualified</span><strong>${dashboard.engine?.funnel?.qualified ?? 0}</strong></li>
                <li><span>Bookings</span><strong>${dashboard.engine?.funnel?.booking ?? 0}</strong></li>
              </ul>
            </article>
            <article class="card">
              <h3>Business ROI (real feed)</h3>
              <ul class="funnel">
                <li><span>Spend</span><strong>${dashboard.business?.spend || "$0.00"}</strong></li>
                <li><span>Revenue</span><strong>${dashboard.business?.revenue || "$0.00"}</strong></li>
                <li><span>ROAS</span><strong>${dashboard.business?.roas || "0.00x"}</strong></li>
                <li><span>Qualified rate</span><strong>${dashboard.business?.qualifiedRate || "0.0%"}</strong></li>
                <li><span>Booking rate</span><strong>${dashboard.business?.bookingRate || "0.0%"}</strong></li>
              </ul>
            </article>
            <article class="card">
              <h3>Critical Alerts</h3>
              <ul class="alerts">
                <li class="ok">Goal locked: qualified_booking_roas</li>
                <li class="${dashboard.policy?.allowed ? "ok" : "warn"}">Publish policy: ${dashboard.policy?.allowed ? "ready" : "blocked"}</li>
                <li class="ok">Cron loop: every 5m (server)</li>
              </ul>
            </article>
          </div>
          <article class="card">
            <h3>Ready API Routes</h3>
            <div class="chips">${endpoints.map((path) => `<span class="chip">${path}</span>`).join("")}</div>
          </article>
        </section>

        <section class="view ${appState.activeView === "campaigns" ? "show" : ""}" id="campaigns">
          <article class="card audience-research-card">
            <h3>Audience research</h3>
            <p class="meta-pill">
              Calls <code>GET /api/meta/targeting-search</code> (Graph <code>targetingsearch</code>). Pick a category, search, then
              <strong>Add</strong> rows and <strong>Insert into flexible spec JSON</strong> below (countries/ages stay in the next card).
              <strong>Search scope:</strong> country below is sent as <code>country_code</code> for audience estimates. Live Meta required for
              real IDs; mock uses a demo row or SQLite cache from past live searches.
            </p>
            <div class="targeting-search-country-row">
              <label class="budget-field targeting-search-country-label">
                Search scope (country)
                ${targetingSearchCountrySelectHtml()}
              </label>
              <span class="targeting-countries-hint"
                >Updates to <strong>Audience targeting → Countries</strong> set this to the <strong>first</strong> selected country; you can
                change it here for a different search scope.</span
              >
            </div>
            <div class="targeting-search-tabs" role="tablist">${targetingSearchTabsHtml()}</div>
            <div class="targeting-search-row">
              <input
                type="search"
                id="targetingSearchQuery"
                placeholder="Keyword (e.g. travel, honeymoon)"
                autocomplete="off"
                value="${escapeAttr(appState.targetingSearchQuery)}"
              />
              <button type="button" id="targetingSearchRun">Search</button>
            </div>
            <table class="targeting-search-table">
              <thead>
                <tr><th>Name</th><th>ID</th><th>Audience size</th><th></th></tr>
              </thead>
              <tbody>${targetingSearchRowsHtml()}</tbody>
            </table>
            <p class="targeting-picks-label">Selected for flexible spec:</p>
            <div class="targeting-picks-chips">${targetingPicksHtml()}</div>
            <div class="targeting-search-actions">
              <button type="button" id="targetingApplyFlexible">Insert selected into flexible spec JSON</button>
              <button type="button" class="btn-ghost" id="targetingPicksClear">Clear selection</button>
            </div>
          </article>
          <article class="card">
            <h3>Campaign Health</h3>
            <table>
              <thead>
                <tr><th>Campaign</th><th>Adset</th><th>Spend</th><th>Leads</th><th>CPA</th><th>ROAS</th><th>Status</th></tr>
              </thead>
              <tbody>${tableRows(dashboard.campaigns, ["campaign", "adset", "spend", "leads", "cpa", "roas", "status"])}</tbody>
            </table>
          </article>
          <article class="card targeting-card">
            <h3>Audience targeting (Meta ad set)</h3>
            <p class="meta-pill">
              Sent as <code>targeting</code> on <strong>Create Test Campaign</strong> and <strong>Automation → Pipeline</strong>.
              <strong>Countries:</strong> pick ISO codes below (Ctrl/⌘+click for multiple). <strong>Locales</strong> use Meta
              locale IDs and are auto-filled from countries unless you enable manual override. Optional
              <code>flexible_spec</code> for interests/behaviors.
            </p>
            <div class="targeting-grid">
              <label class="budget-field targeting-field-wide targeting-countries-label">
                Countries (Meta <code>geo_locations.countries</code>)
                ${targetingCountriesSelectHtml()}
                <span class="targeting-countries-hint">Ctrl+click (Windows) or ⌘+click (Mac) for multiple. If none selected, the builder falls back to LK.</span>
              </label>
              <label class="budget-field">
                Age min
                <input
                  type="number"
                  id="targetingAgeMin"
                  min="13"
                  max="65"
                  step="1"
                  value="${escapeAttr(String(appState.targetingDraft.ageMin))}"
                />
              </label>
              <label class="budget-field">
                Age max
                <input
                  type="number"
                  id="targetingAgeMax"
                  min="13"
                  max="65"
                  step="1"
                  value="${escapeAttr(String(appState.targetingDraft.ageMax))}"
                />
              </label>
              <label class="budget-field targeting-field-wide">
                Locales (comma-separated Meta IDs)
                <div class="targeting-locales-row">
                  <input
                    type="text"
                    id="targetingLocales"
                    class="targeting-locales-input"
                    placeholder="1000"
                    value="${escapeAttr(appState.targetingDraft.locales)}"
                  />
                  <label class="targeting-locales-manual">
                    <input
                      type="checkbox"
                      id="targetingLocalesManual"
                      ${appState.targetingLocalesManual ? "checked" : ""}
                    />
                    Manual override
                  </label>
                  <button type="button" class="btn-ghost" id="targetingLocalesSync">Sync from countries</button>
                </div>
                <span class="targeting-countries-hint"
                  >When override is off, changing countries updates locales. Use Sync to re-apply after editing manually.</span
                >
              </label>
              <label class="budget-field targeting-field-full">
                Flexible spec JSON (optional)
                <textarea
                  id="targetingFlexibleJson"
                  rows="4"
                  spellcheck="false"
                  placeholder='[{"interests":[{"id":"6003139266461","name":"Travel"}],"behaviors":[]}]'
                >${escapeHtml(appState.targetingDraft.flexibleSpecJson)}</textarea>
              </label>
            </div>
          </article>
          <article class="card">
            <h3>Actions</h3>
            <label class="budget-field">
              Daily budget (ad set, major currency)
              <input
                type="number"
                id="campaignDailyBudget"
                min="0.01"
                step="0.01"
                value="${escapeAttr(String(appState.budgets.campaign))}"
              />
            </label>
            <button type="button" id="optimizeButton">Run Optimizer</button>
            <button type="button" id="campaignButton">Create Test Campaign</button>
          </article>
        </section>

        <section class="view ${appState.activeView === "creatives" ? "show" : ""}" id="creatives">
          <article class="card creatives-delivery-note">
            <h3>Publish &amp; delivery need an ad set</h3>
            <p>
              On Meta, delivery is <strong>Campaign → Ad set (budget) → Ad → Creative</strong>. This tab is for
              <strong>creative assets + copy + preview</strong> only. “Create ad creative from last upload”
              makes a <strong>creative</strong> in Meta — it does not attach an ad to an ad set or turn on
              delivery by itself.
            </p>
            <p class="meta-pill">To create an ad set, set budget, and optionally publish: use <strong>Campaigns</strong> or <strong>Automation → Pipeline</strong>.</p>
            <div class="creatives-jump-row">
              <button type="button" class="btn-ghost jump-view-btn" data-view="campaigns">Go to Campaigns</button>
              <button type="button" class="btn-ghost jump-view-btn" data-view="automation">Go to Automation</button>
            </div>
          </article>
          <article class="card ad-preview-hero">
            <h3>Ad preview (Meta feed style)</h3>
            <p class="meta-pill">Edit copy below or upload an image in “Upload &amp; build” — preview updates. “Update preview” saves form-only changes. Pipeline runs also refresh this.</p>
            <div class="ad-preview-layout">
              ${adPreviewMarkup(dashboard.adPreview)}
              <div class="ad-preview-form">
                <label>Page name <input type="text" id="previewPageName" value="${escapeAttr(dashboard.adPreview?.pageName || "")}" /></label>
                <label>Primary text <textarea id="previewMessage" rows="3">${escapeHtml(dashboard.adPreview?.primaryText || "")}</textarea></label>
                <label>Headline <input type="text" id="previewHeadline" value="${escapeAttr(dashboard.adPreview?.headline || "")}" /></label>
                <label>Description <input type="text" id="previewDescription" value="${escapeAttr(dashboard.adPreview?.description || "")}" /></label>
                <label>Destination URL <input type="url" id="previewLink" value="${escapeAttr(dashboard.adPreview?.linkUrl || "")}" /></label>
                <label>CTA label <input type="text" id="previewCta" value="${escapeAttr(dashboard.adPreview?.cta || "")}" placeholder="Learn more" /></label>
                <label>Hero image or video URL <input type="url" id="previewMediaUrl" value="${escapeAttr(dashboard.adPreview?.mediaUrl || "")}" placeholder="https://… (carousel: large creative on top)" /></label>
                <label>Carousel cards (JSON array)</label>
                <textarea id="previewCarouselCards" rows="6" placeholder='[{"headline":"Bali","description":"5 nights","imageUrl":"https://...","link":"https://..."}]'>${escapeHtml(JSON.stringify(dashboard.adPreview?.carouselCards || [], null, 2))}</textarea>
                <label class="ad-preview-row">
                  <span>Media type</span>
                  <select id="previewMediaType">
                    <option value="image" ${dashboard.adPreview?.mediaType === "image" ? "selected" : ""}>Image</option>
                    <option value="video" ${dashboard.adPreview?.mediaType === "video" ? "selected" : ""}>Video</option>
                    <option value="carousel" ${dashboard.adPreview?.mediaType === "carousel" ? "selected" : ""}>Carousel</option>
                  </select>
                </label>
                <button type="button" id="previewUpdateButton" class="ad-preview-btn">Update preview</button>
              </div>
            </div>
          </article>
          <article class="card">
            <h3>Creative Performance</h3>
            <table>
              <thead>
                <tr><th>Name</th><th>Format</th><th>CTR</th><th>CPC</th><th>CPA</th><th>Fatigue</th></tr>
              </thead>
              <tbody>${tableRows(dashboard.creatives, ["name", "format", "ctr", "cpc", "cpa", "fatigue"])}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Creative scores (heuristic)</h3>
            <table>
              <thead>
                <tr><th>Name</th><th>Score</th><th>Tier</th></tr>
              </thead>
              <tbody>${tableRows(
                (dashboard.creativeScores || []).map((r) => ({ name: r.name, score: r.score, tier: r.tier })),
                ["name", "score", "tier"]
              )}</tbody>
            </table>
          </article>
          <article class="card ad-build-card">
            <h3>Upload &amp; build</h3>
            <p class="ad-build-lead">Hook + Problem + Offer + Proof + CTA — uploads here sync the <strong>preview above</strong> and Meta asset list.</p>
            <p class="meta-pill">Mock: choose a file or sample URL. Live: public https image URL for Graph <code>adimages</code>.</p>
            <input type="file" id="imageFileInput" accept="image/*" hidden aria-hidden="true" />
            <div class="ad-build-row">
              <button type="button" id="imageButton">Choose image file…</button>
              <button type="button" id="imageDemoUrlButton" class="btn-ghost">Sample URL (demo)</button>
              <button type="button" id="videoButton">Upload video (sample URL)</button>
            </div>
            <h4 class="assets-heading">Session uploads (library)</h4>
            <table class="assets-table">
              <thead>
                <tr><th>Type</th><th>Name</th><th>Hash / ID</th><th>Status</th></tr>
              </thead>
              <tbody>${uploadAssetsRows()}</tbody>
            </table>
            <h4 class="assets-heading">Creative only (not full delivery)</h4>
            <p class="meta-pill">
              Creates a Meta <strong>ad creative</strong> from the latest <code>imageHash</code> and preview copy.
              For live delivery you still need an <strong>ad set + ad</strong> — see the note at the top of this tab or
              <button type="button" class="btn-ghost jump-view-btn" data-view="automation">Automation</button>.
            </p>
            <button type="button" id="createCreativeFromUploadButton">Create ad creative from last upload</button>
          </article>
        </section>

        <section class="view ${appState.activeView === "audience" ? "show" : ""}" id="audience">
          <article class="card">
            <h3>Audience Sync</h3>
            <table>
              <thead>
                <tr><th>Segment</th><th>Users</th><th>Last Sync</th><th>Retries</th><th>Status</th></tr>
              </thead>
              <tbody>${tableRows(dashboard.audiences, ["segment", "users", "sync", "retries", "status"])}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Audience Jobs</h3>
            <p class="meta-pill">Live mode: real Custom Audience upload needs <code>emails[]</code>. Set <code>VITE_AUDIENCE_SYNC_EMAILS</code> (comma-separated) in env for these buttons, or POST emails from your CRM.</p>
            <button type="button" id="syncHotButton">Sync Hot Audience</button>
            <button type="button" id="syncWarmButton">Sync Warm Audience</button>
          </article>
        </section>

        <section class="view ${appState.activeView === "crm" ? "show" : ""}" id="crm">
          <article class="card">
            <h3>CRM Webhook Timeline</h3>
            <table>
              <thead>
                <tr><th>Event</th><th>Count</th><th>SLA</th><th>Status</th></tr>
              </thead>
              <tbody>${tableRows(dashboard.crm, ["event", "count", "sla", "status"])}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Webhook</h3>
            <button type="button" id="crmButton">Send lead.created Webhook</button>
            <button type="button" id="crmQualityButton">Record CRM quality (demo)</button>
            <button type="button" id="revenueButton">Record revenue (demo)</button>
          </article>
        </section>

        <section class="view ${appState.activeView === "automation" ? "show" : ""}" id="automation">
          <article class="card ad-preview-card-wrap">
            <h3>Ad preview</h3>
            <p class="meta-pill">Same card as Creatives — updates when you run the pipeline or use Preview fields.</p>
            ${adPreviewMarkup(dashboard.adPreview)}
          </article>
          <article class="card">
            <h3>Publish policy</h3>
            <p>Auto-publish: ${dashboard.policy?.allowed ? "allowed" : "blocked"}</p>
            <ul class="funnel">
              ${(dashboard.policy?.reasons || [])
                .map((r) => `<li><span>${escapeHtml(r)}</span></li>`)
                .join("")}
            </ul>
          </article>
          <article class="card">
            <h3>Pipeline (upload → campaign → optional publish)</h3>
            <p class="meta-pill">
              Audience targeting (countries, age, interests) is set on the
              <button type="button" class="btn-ghost jump-view-btn" data-view="campaigns">Campaigns</button> tab — same
              payload is sent here.
            </p>
            <div class="budget-row">
              <label class="budget-field">
                Image pipeline — daily budget
                <input
                  type="number"
                  id="pipelineImageDailyBudget"
                  min="0.01"
                  step="0.01"
                  value="${escapeAttr(String(appState.budgets.pipelineImage))}"
                />
              </label>
              <label class="budget-field">
                Carousel pipeline — daily budget
                <input
                  type="number"
                  id="pipelineCarouselDailyBudget"
                  min="0.01"
                  step="0.01"
                  value="${escapeAttr(String(appState.budgets.pipelineCarousel))}"
                />
              </label>
            </div>
            <button type="button" id="pipelineButton">Run image pipeline (mock)</button>
            <button type="button" id="carouselPipelineButton">Run carousel pipeline (mock)</button>
            <button type="button" id="loopTickButton">Run loop tick now</button>
            <p class="meta-pill">
              No separate publish CLI. Run the stack with <code>npm run dev:all</code>. Pipeline is
              <code>POST ${API_BASE}/api/pipeline/run</code> (JSON). Use <code>"autoPublish": true</code> to
              request activation — the image button sends that; carousel demo uses <code>false</code>. Real
              Meta activation only if <strong>Publish policy</strong> is allowed and
              <code>META_AUTO_PUBLISH=true</code> (live, not mock). Cron calls <code>POST /api/loop/tick</code>.
            </p>
          </article>
          <article class="card">
            <h3>Cron jobs</h3>
            <table>
              <thead>
                <tr><th>Name</th><th>Schedule</th><th>Last run</th></tr>
              </thead>
              <tbody>${tableRows(
                (dashboard.cronJobs || []).map((j) => ({
                  name: j.name,
                  schedule: j.schedule,
                  lastRunAt: (j.lastRunAt || "").slice(0, 19).replace("T", " "),
                })),
                ["name", "schedule", "lastRunAt"]
              )}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Recent jobs</h3>
            <table>
              <thead>
                <tr><th>ID</th><th>Status</th><th>Mode</th></tr>
              </thead>
              <tbody>${tableRows(
                (dashboard.engine?.jobs || []).slice(0, 8).map((j) => ({
                  id: (j.id || "").slice(0, 22),
                  status: j.status,
                  mode: j.mode || "-",
                })),
                ["id", "status", "mode"]
              )}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Recent loop decisions</h3>
            <table>
              <thead>
                <tr><th>Type</th><th>Actions</th><th>At</th></tr>
              </thead>
              <tbody>${tableRows(
                (dashboard.engine?.decisions || []).slice(0, 8).map((d) => ({
                  type: d.type || "-",
                  actions: Array.isArray(d.actions) ? d.actions.length : 0,
                  at: (d.at || "").slice(0, 19).replace("T", " "),
                })),
                ["type", "actions", "at"]
              )}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Hook matrix (sample)</h3>
            <table>
              <thead>
                <tr><th>Persona</th><th>Hook</th></tr>
              </thead>
              <tbody>${tableRows(
                (dashboard.hooks || []).slice(0, 8).map((h) => ({ persona: h.persona, text: (h.text || "").slice(0, 60) })),
                ["persona", "text"]
              )}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Video script generator</h3>
            <button type="button" id="videoScriptButton">Generate script (honeymoon / Bali)</button>
            <pre class="json-box">${appState.videoScriptText || "No script generated yet."}</pre>
          </article>
        </section>

        <section class="view ${appState.activeView === "optimizer" ? "show" : ""}" id="optimizer">
          <article class="card">
            <h3>Optimizer Actions</h3>
            <table>
              <thead>
                <tr><th>Adset</th><th>Action</th><th>Reason</th><th>Confidence</th></tr>
              </thead>
              <tbody>${tableRows(dashboard.actions, ["adset", "action", "reason", "confidence"])}</tbody>
            </table>
          </article>
          <article class="card">
            <h3>Scaling Policy</h3>
            <ul class="funnel">
              <li><span>Vertical Scale</span><strong>+15% to +20% / 24h</strong></li>
              <li><span>Horizontal Scale</span><strong>New audience + creative</strong></li>
              <li><span>Safety Rule</span><strong>No scale below ${dashboard.targeting?.no_auto_scale_if_leads_below || 20} leads</strong></li>
            </ul>
          </article>
        </section>
      </main>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  const refreshButton = document.querySelector("#refreshButton");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => loadDashboard({ soft: true }));
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      appState.activeView = button.dataset.view;
      render();
    });
  });

  document.querySelectorAll(".jump-view-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const v = button.dataset.view;
      if (v) {
        appState.activeView = v;
        render();
      }
    });
  });

  document.querySelectorAll(".targeting-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.targetingTab;
      if (t) {
        appState.targetingSearchTab = t;
        render();
      }
    });
  });

  document.querySelector("#targetingSearchQuery")?.addEventListener("input", (e) => {
    appState.targetingSearchQuery = e.target.value;
  });

  document.querySelector("#targetingSearchRun")?.addEventListener("click", async () => {
    const q = (document.querySelector("#targetingSearchQuery")?.value || "").trim();
    appState.targetingSearchQuery = q;
    if (!q) {
      appState.error = "Enter a search keyword.";
      render();
      return;
    }
    try {
      const type = appState.targetingSearchTab;
      const params = new URLSearchParams({ q, type, limit: "25" });
      const cc = String(appState.targetingSearchCountry || "LK")
        .trim()
        .toUpperCase();
      if (/^[A-Z]{2}$/.test(cc)) {
        params.set("country_code", cc);
      }
      const data = await apiFetch(`/api/meta/targeting-search?${params.toString()}`, { method: "GET" });
      appState.targetingSearchResults = Array.isArray(data.results) ? data.results : [];
      appState.error = "";
      render();
    } catch (error) {
      appState.error = error.message || String(error);
      render();
    }
  });

  document.querySelector("#targetingApplyFlexible")?.addEventListener("click", () => {
    syncTargetingDraftFromDom();
    appState.targetingDraft.flexibleSpecJson = mergePicksIntoFlexibleSpecJson(
      appState.targetingSearchPicks,
      appState.targetingDraft.flexibleSpecJson
    );
    render();
  });

  document.querySelector("#targetingPicksClear")?.addEventListener("click", () => {
    appState.targetingSearchPicks = [];
    render();
  });

  document.querySelector(".audience-research-card")?.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".targeting-add-row");
    if (addBtn) {
      const id = addBtn.dataset.id;
      const name = addBtn.dataset.name || "";
      const apiType = appState.targetingSearchTab;
      if (!id) return;
      const dup = appState.targetingSearchPicks.some((p) => String(p.id) === String(id));
      if (!dup) appState.targetingSearchPicks.push({ id, name, apiType });
      render();
      return;
    }
    const rm = e.target.closest(".targeting-pick-remove");
    if (rm && rm.dataset.pickIndex !== undefined) {
      const i = Number(rm.dataset.pickIndex);
      if (!Number.isNaN(i)) {
        appState.targetingSearchPicks = appState.targetingSearchPicks.filter((_, idx) => idx !== i);
        render();
      }
    }
  });

  document.querySelector("#segmentFilter").addEventListener("change", (event) => {
    appState.segment = event.target.value;
  });

  document.querySelector("#periodFilter").addEventListener("change", (event) => {
    appState.period = event.target.value;
  });

  const optimizeButton = document.querySelector("#optimizeButton");
  if (optimizeButton) optimizeButton.addEventListener("click", () => runAction("/api/meta/optimize", {}));

  const campaignButton = document.querySelector("#campaignButton");
  if (campaignButton) {
    campaignButton.addEventListener("click", () => {
      syncTargetingDraftFromDom();
      const raw = document.querySelector("#campaignDailyBudget")?.value;
      const dailyBudget = parsePositiveBudget(raw, appState.budgets.campaign);
      appState.budgets.campaign = dailyBudget;
      runAction("/api/meta/create-campaign", {
        campaignName: "Travel Sales - Auto",
        adsetName: "Auto Generated",
        dailyBudget,
        targeting: buildMetaTargetingFromDraft(),
        expectedLeads: 40,
        expectedRoas: 3.1,
      });
    });
  }
  const campaignDailyBudgetEl = document.querySelector("#campaignDailyBudget");
  if (campaignDailyBudgetEl) {
    campaignDailyBudgetEl.addEventListener("input", () => {
      appState.budgets.campaign = parsePositiveBudget(campaignDailyBudgetEl.value, appState.budgets.campaign);
    });
  }

  document.querySelector("#targetingCountries")?.addEventListener("change", (e) => {
    const el = e.target;
    if (el.multiple) {
      appState.targetingDraft.countries = Array.from(el.selectedOptions)
        .map((o) => o.value)
        .join(", ");
    } else {
      appState.targetingDraft.countries = el.value;
    }
    const codes = String(appState.targetingDraft.countries || "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    appState.targetingSearchCountry = codes.length ? codes[0] : "LK";
    const searchCountryEl = document.querySelector("#targetingSearchCountry");
    if (searchCountryEl) searchCountryEl.value = appState.targetingSearchCountry;
    applyAutoLocalesFromCountries();
    syncLocalesInputFromState();
  });
  document.querySelector("#targetingSearchCountry")?.addEventListener("change", (e) => {
    const v = (e.target.value || "LK").trim().toUpperCase();
    appState.targetingSearchCountry = /^[A-Z]{2}$/.test(v) ? v : "LK";
  });
  document.querySelector("#targetingAgeMin")?.addEventListener("input", (e) => {
    appState.targetingDraft.ageMin = clampTargetingAge(e.target.value, appState.targetingDraft.ageMin);
  });
  document.querySelector("#targetingAgeMax")?.addEventListener("input", (e) => {
    appState.targetingDraft.ageMax = clampTargetingAge(e.target.value, appState.targetingDraft.ageMax);
  });
  document.querySelector("#targetingLocales")?.addEventListener("input", (e) => {
    appState.targetingDraft.locales = e.target.value;
    appState.targetingLocalesManual = true;
    const manualCb = document.querySelector("#targetingLocalesManual");
    if (manualCb) manualCb.checked = true;
  });
  document.querySelector("#targetingLocalesManual")?.addEventListener("change", (e) => {
    appState.targetingLocalesManual = e.target.checked;
    if (!appState.targetingLocalesManual) {
      applyAutoLocalesFromCountries();
      syncLocalesInputFromState();
    }
  });
  document.querySelector("#targetingLocalesSync")?.addEventListener("click", () => {
    appState.targetingLocalesManual = false;
    const manualCb = document.querySelector("#targetingLocalesManual");
    if (manualCb) manualCb.checked = false;
    applyAutoLocalesFromCountries();
    syncLocalesInputFromState();
  });
  document.querySelector("#targetingFlexibleJson")?.addEventListener("input", (e) => {
    appState.targetingDraft.flexibleSpecJson = e.target.value;
  });

  const imageFileInput = document.querySelector("#imageFileInput");
  const imageButton = document.querySelector("#imageButton");
  if (imageButton && imageFileInput) {
    imageButton.addEventListener("click", () => imageFileInput.click());
  }
  if (imageFileInput) {
    imageFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        if (typeof dataUrl === "string" && dataUrl.length > 900_000) {
          appState.error = "Image too large for JSON upload (~max 600KB). Compress or use “Sample URL (demo)”.";
          render();
          return;
        }
        revokePreviewImageBlob();
        previewImageBlobUrl = URL.createObjectURL(file);
        try {
          const result = await apiFetch("/api/meta/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name.replace(/[^\w.\-]+/g, "_") || "creative-hero",
              url: dataUrl,
            }),
          });
          dashboard.assets = dashboard.assets || { images: [], videos: [], adcreatives: [] };
          if (result?.ok && result.image) {
            dashboard.assets.images.unshift({
              id: result.image.id,
              name: result.image.name,
              imageHash: result.image.imageHash,
              status: result.image.status,
            });
          }
          if (result?.adPreview) {
            dashboard.adPreview = {
              ...result.adPreview,
              mediaUrl: previewImageBlobUrl,
            };
          }
          await loadDashboard({ soft: true });
          applyLocalPreviewImageBlob();
        } catch (err) {
          revokePreviewImageBlob();
          appState.error = err.message || String(err);
          render();
        }
      };
      reader.onerror = () => {
        appState.error = "Could not read file.";
        render();
      };
      reader.readAsDataURL(file);
    });
  }
  const imageDemoUrlButton = document.querySelector("#imageDemoUrlButton");
  if (imageDemoUrlButton) {
    imageDemoUrlButton.addEventListener("click", () =>
      runAction("/api/meta/upload-image", {
        name: "creative-hero",
        url: "https://picsum.photos/seed/travelads/1200/630",
      })
    );
  }

  const createCreativeFromUploadButton = document.querySelector("#createCreativeFromUploadButton");
  if (createCreativeFromUploadButton) {
    createCreativeFromUploadButton.addEventListener("click", () => {
      const img = dashboard.assets?.images?.[0];
      if (!img?.imageHash) {
        appState.error = "Upload an image first — session library is empty.";
        render();
        return;
      }
      const prev = dashboard.adPreview || {};
      runAction("/api/meta/create-creative", {
        name: `Creative — ${img.name || "upload"}`,
        imageHash: img.imageHash,
        link: prev.linkUrl || "https://example.com/travel-offer",
        message: prev.primaryText,
        headline: prev.headline,
        description: prev.description,
      });
    });
  }

  const videoButton = document.querySelector("#videoButton");
  if (videoButton) {
    videoButton.addEventListener("click", () =>
      runAction("/api/meta/upload-video", {
        name: "creative-reel",
        file_url: "https://download.samplelib.com/mp4/sample-5s.mp4",
      })
    );
  }

  const syncHotButton = document.querySelector("#syncHotButton");
  if (syncHotButton)
    syncHotButton.addEventListener("click", () => runAction("/api/meta/sync-audience", buildSyncAudienceBody("hot")));

  const syncWarmButton = document.querySelector("#syncWarmButton");
  if (syncWarmButton)
    syncWarmButton.addEventListener("click", () => runAction("/api/meta/sync-audience", buildSyncAudienceBody("warm")));

  const crmButton = document.querySelector("#crmButton");
  if (crmButton) crmButton.addEventListener("click", () => runAction("/api/crm/webhook", { eventType: "lead.created" }));
  const crmQualityButton = document.querySelector("#crmQualityButton");
  if (crmQualityButton) {
    crmQualityButton.addEventListener("click", () => {
      const first = dashboard.campaigns[0] || {};
      runAction("/api/crm/quality", {
        leadId: `lead_${Date.now()}`,
        quality: "hot",
        qualified: true,
        campaignName: first.campaign,
        adsetName: first.adset,
        metaAdsetId: first.metaAdsetId || first.id,
      });
    });
  }
  const revenueButton = document.querySelector("#revenueButton");
  if (revenueButton) {
    revenueButton.addEventListener("click", () => {
      const first = dashboard.campaigns[0] || {};
      runAction("/api/revenue/record", {
        orderId: `order_${Date.now()}`,
        revenue: 420,
        currency: "USD",
        campaignName: first.campaign,
        adsetName: first.adset,
        metaAdsetId: first.metaAdsetId || first.id,
      });
    });
  }

  const pipelineButton = document.querySelector("#pipelineButton");
  if (pipelineButton) {
    pipelineButton.addEventListener("click", () => {
      syncTargetingDraftFromDom();
      const raw = document.querySelector("#pipelineImageDailyBudget")?.value;
      const dailyBudget = parsePositiveBudget(raw, appState.budgets.pipelineImage);
      appState.budgets.pipelineImage = dailyBudget;
      runAction("/api/pipeline/run", {
        imageUrl: "https://picsum.photos/seed/pipeline/1200/630",
        message: "Dream Bali honeymoon — limited suites left. Tap to see packages & pricing.",
        headline: "Bali Honeymoon — 40% off",
        description: "5★ resorts · airport transfers included",
        link: "https://example.com/bali-honeymoon",
        campaignName: "Auto Pipeline",
        adsetName: "LK Broad",
        dailyBudget,
        targeting: buildMetaTargetingFromDraft(),
        autoPublish: true,
        expectedLeads: 30,
        expectedRoas: 2.8,
      });
    });
  }
  const pipelineImageDailyBudgetEl = document.querySelector("#pipelineImageDailyBudget");
  if (pipelineImageDailyBudgetEl) {
    pipelineImageDailyBudgetEl.addEventListener("input", () => {
      appState.budgets.pipelineImage = parsePositiveBudget(
        pipelineImageDailyBudgetEl.value,
        appState.budgets.pipelineImage
      );
    });
  }
  const carouselPipelineButton = document.querySelector("#carouselPipelineButton");
  if (carouselPipelineButton) {
    carouselPipelineButton.addEventListener("click", () => {
      syncTargetingDraftFromDom();
      const raw = document.querySelector("#pipelineCarouselDailyBudget")?.value;
      const dailyBudget = parsePositiveBudget(raw, appState.budgets.pipelineCarousel);
      appState.budgets.pipelineCarousel = dailyBudget;
      runAction("/api/pipeline/run", {
        mode: "carousel",
        message: "Pick your dream package from top destinations this week.",
        headline: "Travel Deals Carousel",
        description: "Swipe cards to see offers",
        link: "https://example.com/travel-deals",
        campaignName: "Carousel Pipeline",
        adsetName: "LK Carousel Broad",
        dailyBudget,
        targeting: buildMetaTargetingFromDraft(),
        autoPublish: false,
        expectedLeads: 28,
        expectedRoas: 2.9,
        carouselCards: [
          {
            headline: "Bali Honeymoon",
            description: "4N/5D with spa and transfers",
            imageUrl: "https://picsum.photos/seed/bali-carousel/1200/630",
            link: "https://example.com/bali-honeymoon",
          },
          {
            headline: "Dubai Family Trip",
            description: "Theme parks + city tour bundle",
            imageUrl: "https://picsum.photos/seed/dubai-carousel/1200/630",
            link: "https://example.com/dubai-family",
          },
          {
            headline: "Maldives Luxury",
            description: "Water villa + premium dining",
            imageUrl: "https://picsum.photos/seed/maldives-carousel/1200/630",
            link: "https://example.com/maldives-luxury",
          },
        ],
      });
    });
  }
  const pipelineCarouselDailyBudgetEl = document.querySelector("#pipelineCarouselDailyBudget");
  if (pipelineCarouselDailyBudgetEl) {
    pipelineCarouselDailyBudgetEl.addEventListener("input", () => {
      appState.budgets.pipelineCarousel = parsePositiveBudget(
        pipelineCarouselDailyBudgetEl.value,
        appState.budgets.pipelineCarousel
      );
    });
  }

  const loopTickButton = document.querySelector("#loopTickButton");
  if (loopTickButton) {
    loopTickButton.addEventListener("click", () => runAction("/api/loop/tick", {}));
  }

  const previewUpdateButton = document.querySelector("#previewUpdateButton");
  if (previewUpdateButton) {
    previewUpdateButton.addEventListener("click", async () => {
      const pageName = document.querySelector("#previewPageName")?.value || "";
      const message = document.querySelector("#previewMessage")?.value || "";
      const headline = document.querySelector("#previewHeadline")?.value || "";
      const description = document.querySelector("#previewDescription")?.value || "";
      const link = document.querySelector("#previewLink")?.value || "";
      const cta = document.querySelector("#previewCta")?.value || "";
      const mediaUrl = document.querySelector("#previewMediaUrl")?.value || "";
      const mediaType = document.querySelector("#previewMediaType")?.value || "image";
      const cardsRaw = document.querySelector("#previewCarouselCards")?.value || "[]";
      let carouselCards = [];
      try {
        const parsed = JSON.parse(cardsRaw);
        carouselCards = Array.isArray(parsed) ? parsed : [];
      } catch {
        appState.error = "Carousel cards must be valid JSON array.";
        render();
        return;
      }
      try {
        const data = await apiFetch("/api/preview/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageName,
            message,
            headline,
            description,
            link,
            cta,
            imageUrl: mediaType === "image" ? mediaUrl : undefined,
            file_url: mediaType === "video" ? mediaUrl : undefined,
            mode: mediaType === "carousel" ? "carousel" : mediaType === "video" ? "video" : undefined,
            carouselCards: mediaType === "carousel" ? carouselCards : undefined,
          }),
        });
        dashboard.adPreview = data.adPreview || dashboard.adPreview;
        applyLocalPreviewImageBlob();
        render();
      } catch (error) {
        appState.error = error.message;
        render();
      }
    });
  }

  const videoScriptButton = document.querySelector("#videoScriptButton");
  if (videoScriptButton) {
    videoScriptButton.addEventListener("click", async () => {
      try {
        const data = await apiFetch("/api/content/video-script?persona=honeymoon&destination=Bali");
        appState.videoScriptText = JSON.stringify(data.script || {}, null, 2);
        render();
      } catch (error) {
        appState.error = error.message;
        render();
      }
    });
  }
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (CLIENT_API_KEY) headers["X-API-Key"] = CLIENT_API_KEY;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${path}`);
  }
  return data;
}

async function runAction(path, body) {
  try {
    if (path === "/api/meta/upload-image" && typeof body?.url === "string" && body.url.startsWith("http")) {
      revokePreviewImageBlob();
    }
    if (path === "/api/meta/upload-video") {
      revokePreviewImageBlob();
    }
    const result = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Show upload rows immediately; also works if GET /dashboard/state omits `assets` (old API process).
    dashboard.assets = dashboard.assets || { images: [], videos: [], adcreatives: [] };
    if (result?.ok && result.image) {
      dashboard.assets.images.unshift({
        id: result.image.id,
        name: result.image.name,
        imageHash: result.image.imageHash,
        status: result.image.status,
      });
    }
    if (result?.ok && result.video) {
      dashboard.assets.videos.unshift({
        id: result.video.id,
        name: result.video.name,
        videoId: result.video.videoId,
        status: result.video.status,
      });
    }
    if (result?.adPreview) {
      dashboard.adPreview = result.adPreview;
    }
    await loadDashboard({ soft: true });
  } catch (error) {
    appState.error = error.message;
    render();
  }
}

async function loadDashboard(opts = {}) {
  const soft = Boolean(opts.soft);
  if (!soft) {
    appState.loading = true;
    appState.error = "";
    render();
  }
  try {
    const data = await apiFetch("/api/dashboard/state");
    appState.error = "";
    dashboard.kpis = data.kpis || [];
    dashboard.campaigns = data.campaigns || [];
    dashboard.creatives = data.creatives || [];
    dashboard.audiences = data.audiences || [];
    dashboard.crm = data.crm || [];
    dashboard.actions = data.actions || [];
    dashboard.targeting = data.targeting || null;
    dashboard.cronJobs = data.cronJobs || [];
    dashboard.meta = data.meta || null;
    dashboard.engine = data.engine || null;
    dashboard.policy = data.policy || null;
    dashboard.creativeScores = data.creativeScores || [];
    dashboard.hooks = data.hooks || [];
    dashboard.adPreview = data.adPreview || dashboard.adPreview;
    applyLocalPreviewImageBlob();
    dashboard.business = data.business || dashboard.business;
    // Keep prior uploads if API response omits `assets` (stale server) or merge server truth when present.
    dashboard.assets =
      data.assets ??
      dashboard.assets ?? { images: [], videos: [], adcreatives: [] };
    appState.projectLabel = data.project?.name || appState.projectLabel;
    appState.loading = false;
    render();
  } catch (error) {
    appState.loading = false;
    appState.error = soft
      ? error.message || String(error)
      : `Backend unavailable at ${API_BASE}. Start API using "npm run dev:api".`;
    render();
  }
}

loadDashboard();
