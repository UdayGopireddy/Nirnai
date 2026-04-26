// Content script — auto-analyzes products and shows results on-page

import { ProductData, ExtensionMessage, AnalysisResponse, DecisionStamp, CartAnalysisResponse, CartItemResult, CartSummary, API_BASE_URL } from "../types.js";
import { SiteExtractor, detectSiteExtractor, applyGeoContext, detectGeoContext } from "./extractors/base.js";
import { AmazonExtractor } from "./extractors/amazon.js";
import { WalmartExtractor } from "./extractors/walmart.js";
import { TargetExtractor } from "./extractors/target.js";
import { AirbnbExtractor } from "./extractors/airbnb.js";
import { BookingExtractor } from "./extractors/booking.js";
import { ExpediaExtractor } from "./extractors/expedia.js";
import { CostcoExtractor } from "./extractors/costco.js";
import { BestBuyExtractor } from "./extractors/bestbuy.js";
import { HomeDepotExtractor } from "./extractors/homedepot.js";
import { LowesExtractor } from "./extractors/lowes.js";
import { EbayExtractor } from "./extractors/ebay.js";
import { WayfairExtractor } from "./extractors/wayfair.js";
import { MacysExtractor } from "./extractors/macys.js";
import { NordstromExtractor } from "./extractors/nordstrom.js";
import { CvsExtractor } from "./extractors/cvs.js";
import { WalgreensExtractor } from "./extractors/walgreens.js";
import { NikeExtractor } from "./extractors/nike.js";
import { AppleExtractor } from "./extractors/apple.js";
import { SamsungExtractor } from "./extractors/samsung.js";
import { DysonExtractor } from "./extractors/dyson.js";
import { VrboExtractor } from "./extractors/vrbo.js";
import { AgodaExtractor } from "./extractors/agoda.js";
import { HotelsExtractor } from "./extractors/hotels.js";
import { TripadvisorExtractor } from "./extractors/tripadvisor.js";
import { GoogleTravelExtractor } from "./extractors/googletravel.js";
import { MakeMyTripExtractor } from "./extractors/makemytrip.js";
import { IxigoExtractor } from "./extractors/ixigo.js";
import { GoibiboExtractor } from "./extractors/goibibo.js";
import { CleartripExtractor } from "./extractors/cleartrip.js";
import { YatraExtractor } from "./extractors/yatra.js";
import { EaseMyTripExtractor } from "./extractors/easemytrip.js";
import { FlipkartExtractor } from "./extractors/flipkart.js";
import { MyntraExtractor } from "./extractors/myntra.js";
import { NykaaExtractor } from "./extractors/nykaa.js";
import { MeeshoExtractor } from "./extractors/meesho.js";
import { AjioExtractor } from "./extractors/ajio.js";
import { GenericExtractor } from "./extractors/generic.js";
import { collectListings, SearchProfile, classifySearch, haversineDistance } from "./extractors/area-classifier.js";

const EXTRACTORS: SiteExtractor[] = [
  new AmazonExtractor(),
  new WalmartExtractor(),
  new TargetExtractor(),
  new AirbnbExtractor(),
  new BookingExtractor(),
  new ExpediaExtractor(),
  new CostcoExtractor(),
  new BestBuyExtractor(),
  new HomeDepotExtractor(),
  new LowesExtractor(),
  new EbayExtractor(),
  new WayfairExtractor(),
  new MacysExtractor(),
  new NordstromExtractor(),
  new CvsExtractor(),
  new WalgreensExtractor(),
  new NikeExtractor(),
  new AppleExtractor(),
  new SamsungExtractor(),
  new DysonExtractor(),
  new VrboExtractor(),
  new AgodaExtractor(),
  new HotelsExtractor(),
  new TripadvisorExtractor(),
  new GoogleTravelExtractor(),
  new MakeMyTripExtractor(),
  new IxigoExtractor(),
  new GoibiboExtractor(),
  new CleartripExtractor(),
  new YatraExtractor(),
  new EaseMyTripExtractor(),
  new FlipkartExtractor(),
  new MyntraExtractor(),
  new NykaaExtractor(),
  new MeeshoExtractor(),
  new AjioExtractor(),
  new GenericExtractor(),
];

const extractor = detectSiteExtractor(EXTRACTORS);

// ── On-Page Panel ───────────────────────────────────────────────────────────

const PANEL_ID = "nirnai-panel";
const BADGE_ID = "nirnai-decision-badge";

// ── Amazon Associate (affiliate) — BUY CTA ──────────────────────────────────
// Replace with your approved Associate tag for each marketplace.
// Amazon only credits clicks that originate from a *new* navigation we
// initiate (a clearly labelled CTA), not from rewriting Amazon's own DOM.
const AMAZON_ASSOC_TAGS: Record<string, string> = {
  "amazon.com":    "nirnai-20",
  "amazon.in":     "nirnai-21",
  "amazon.co.uk":  "nirnai-21",
  "amazon.ca":     "nirnai-20",
  "amazon.com.au": "nirnai-22",
  "amazon.de":     "nirnai-21",
};

function amazonHostKey(host: string): string | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (!h.includes("amazon.")) return null;
  // Match the longest known suffix (handles smile.amazon.com, www., etc.)
  const known = Object.keys(AMAZON_ASSOC_TAGS).sort((a, b) => b.length - a.length);
  for (const k of known) if (h.endsWith(k)) return k;
  return null;
}

function extractAsin(url: string): string | null {
  // Standard Amazon ASIN forms: /dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/);
  return m ? m[1] : null;
}

function buildAmazonAffiliateUrl(currentUrl: string): string | null {
  try {
    const u = new URL(currentUrl);
    const host = amazonHostKey(u.hostname);
    if (!host) return null;
    const tag = AMAZON_ASSOC_TAGS[host];
    if (!tag) return null;
    const asin = extractAsin(u.pathname + u.search);
    if (!asin) return null;
    // Brand-new clean URL → fresh Amazon session attribution
    return `https://www.${host}/dp/${asin}?tag=${encodeURIComponent(tag)}`;
  } catch {
    return null;
  }
}

// ── Pre-checkout price recheck ────────────────────────────────────────────
// Snapshot the bare-minimum product fields needed for /products/recheck.
// We don't have the full ProductData here without a re-extract, but title +
// brand + url + price is enough for the canonical_id resolver and the price
// drift comparison. Failures fall back to {} (recheck will return "unknown").
function productSnapshotForRecheck(): Record<string, string> {
  try {
    const ext = (window as any).__nirnai_extractor;
    if (ext && typeof ext.extractProduct === "function") {
      const p = ext.extractProduct();
      return {
        title: p.title || "",
        brand: p.brand || "",
        price: p.price || "",
        currency: p.currency || "",
        url: p.url || window.location.href,
        source_site: p.source_site || window.location.hostname,
        barcode: p.barcode || "",
      };
    }
  } catch { /* ignore */ }
  return { url: window.location.href, source_site: window.location.hostname };
}

/** Hook the SMART_BUY affiliate link: short price-drift check before redirect.
 *  Fail-open in every branch — we never block a sale on our own bug. */
function attachAffiliateRecheck(productSnapshot: Record<string, string>): void {
  const link = document.getElementById("nirnai-affiliate-buy") as HTMLAnchorElement | null;
  if (!link) return;

  let proceeded = false;
  link.addEventListener("click", (ev) => {
    if (proceeded) return; // second click after we re-enabled the link
    ev.preventDefault();

    const href = link.href;
    const restoreLabel = link.innerHTML;
    link.innerHTML = "🔍 Checking price…";
    (link.style as any).pointerEvents = "none";

    // Hard 2.5s timeout — never make the user wait longer than that for a
    // recheck; if the network is slow, just open the link.
    const proceed = (warning?: { level: string; message: string }) => {
      link.innerHTML = restoreLabel;
      (link.style as any).pointerEvents = "auto";
      proceeded = true;
      if (warning && warning.level === "warn") {
        showRecheckWarning(link, warning.message, href);
      } else {
        window.open(href, "_blank", "noopener,nofollow");
      }
    };

    const timeoutId = window.setTimeout(() => proceed(), 2500);

    fetch(`${API_BASE_URL}/products/recheck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: productSnapshot,
        shown_price: productSnapshot.price || "",
        threshold_pct: 10.0,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        window.clearTimeout(timeoutId);
        if (!json) return proceed();
        proceed({ level: json.warn_level || "unknown", message: json.message || "" });
      })
      .catch(() => {
        window.clearTimeout(timeoutId);
        proceed();
      });
  });
}

/** Inline drift-warning UI. Shows the message and a confirm button that
 *  opens the affiliate URL. Auto-removes itself on dismiss. */
function showRecheckWarning(anchor: HTMLAnchorElement, message: string, href: string): void {
  const existing = document.getElementById("nirnai-recheck-warning");
  if (existing) existing.remove();
  const box = document.createElement("div");
  box.id = "nirnai-recheck-warning";
  box.style.cssText =
    "margin-top:10px;padding:10px 12px;background:rgba(217,119,6,0.12);" +
    "border:1px solid #d97706;border-radius:8px;font-size:11px;color:#fbbf24;" +
    "line-height:1.4;text-align:left;";
  box.innerHTML =
    `<div style="font-weight:800;margin-bottom:4px;">⚠ Price changed since we scored this</div>` +
    `<div style="opacity:0.85;">${message}</div>` +
    `<div style="margin-top:8px;display:flex;gap:6px;">` +
      `<button id="nirnai-recheck-go" style="flex:1;padding:6px;font-size:11px;font-weight:700;color:#fff;background:#d97706;border:none;border-radius:6px;cursor:pointer;">Continue anyway</button>` +
      `<button id="nirnai-recheck-cancel" style="flex:1;padding:6px;font-size:11px;font-weight:700;color:#94a3b8;background:transparent;border:1px solid #334155;border-radius:6px;cursor:pointer;">Cancel</button>` +
    `</div>`;
  anchor.insertAdjacentElement("afterend", box);
  document.getElementById("nirnai-recheck-go")?.addEventListener("click", () => {
    box.remove();
    window.open(href, "_blank", "noopener,nofollow");
  });
  document.getElementById("nirnai-recheck-cancel")?.addEventListener("click", () => {
    box.remove();
  });
}

// ── Affiliate URL rewriting ─────────────────────────────────────────────────
// Uncomment and replace placeholder IDs once signed up at impact.com
//
// const AFFILIATE_CONFIG = {
//   airbnb:  { network: "impact", publisherId: "YOUR_IMPACT_PUBLISHER_ID", programId: "435530", adId: "7299" },
//   amazon:  { network: "amazon", tag: "YOUR_AMAZON_ASSOCIATE_TAG" },
//   walmart: { network: "impact", publisherId: "YOUR_IMPACT_PUBLISHER_ID", programId: "566993", adId: "7301" },
//   target:  { network: "impact", publisherId: "YOUR_IMPACT_PUBLISHER_ID", programId: "481087", adId: "7300" },
// };
//
// function affiliateUrl(url: string): string {
//   try {
//     const u = new URL(url);
//     const host = u.hostname.toLowerCase();
//
//     // Amazon Associates — append tag param
//     if (host.includes("amazon")) {
//       u.searchParams.set("tag", AFFILIATE_CONFIG.amazon.tag);
//       return u.toString();
//     }
//
//     // Impact.com redirect for Airbnb, Walmart, Target
//     let cfg: { publisherId: string; programId: string; adId: string } | null = null;
//     if (host.includes("airbnb"))  cfg = AFFILIATE_CONFIG.airbnb;
//     if (host.includes("walmart")) cfg = AFFILIATE_CONFIG.walmart;
//     if (host.includes("target"))  cfg = AFFILIATE_CONFIG.target;
//
//     if (cfg) {
//       const encoded = encodeURIComponent(url);
//       // Impact.com deep link format — base domain varies per merchant:
//       // Airbnb:  https://airbnb.pxf.io/c/...
//       // Walmart: https://goto.walmart.com/c/...
//       // Target:  https://goto.target.com/c/...
//       const bases: Record<string, string> = {
//         airbnb:  "https://airbnb.pxf.io",
//         walmart: "https://goto.walmart.com",
//         target:  "https://goto.target.com",
//       };
//       const site = host.includes("airbnb") ? "airbnb" : host.includes("walmart") ? "walmart" : "target";
//       return `${bases[site]}/c/${cfg.publisherId}/${cfg.programId}/${cfg.adId}?u=${encoded}`;
//     }
//
//     return url;
//   } catch {
//     return url;
//   }
// }
//
// To activate: replace raw URLs in showResultPanel() suggestion link and
// showCartResultPanel() suggestion/product links with affiliateUrl(url).
// Specifically:
//   - analysis.suggestion.search_url  → affiliateUrl(analysis.suggestion.search_url)
//   - item.suggestion.search_url      → affiliateUrl(item.suggestion.search_url)
//   - item.url                        → affiliateUrl(item.url)
// ─────────────────────────────────────────────────────────────────────────────

// ── Platform search URL builder ──────────────────────────────────────────────
// Ensures we always open a search on a platform where our content script has
// an extractor, so autoRankListings can collect real listings.

const PLATFORM_SEARCH_TEMPLATES: Record<string, (query: string) => string> = {
  "airbnb.com":       q => `https://www.airbnb.com/s/${encodeURIComponent(q)}/homes`,
  "booking.com":      q => `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`,
  "expedia.com":      q => `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(q)}`,
  "vrbo.com":         q => `https://www.vrbo.com/search?destination=${encodeURIComponent(q)}`,
  "hotels.com":       q => `https://www.hotels.com/search.do?q-destination=${encodeURIComponent(q)}`,
  "amazon.com":       q => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  "walmart.com":      q => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  "target.com":       q => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,
  "bestbuy.com":      q => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,
  "ebay.com":         q => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  "costco.com":       q => `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(q)}`,
  "homedepot.com":    q => `https://www.homedepot.com/s/${encodeURIComponent(q)}`,
  "lowes.com":        q => `https://www.lowes.com/search?searchTerm=${encodeURIComponent(q)}`,
  "nordstrom.com":    q => `https://www.nordstrom.com/sr?keyword=${encodeURIComponent(q)}`,
  "sephora.com":      q => `https://www.sephora.com/search?keyword=${encodeURIComponent(q)}`,
  "etsy.com":         q => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
  "wayfair.com":      q => `https://www.wayfair.com/keyword.php?keyword=${encodeURIComponent(q)}`,
  "newegg.com":       q => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}`,
  "zappos.com":       q => `https://www.zappos.com/search?term=${encodeURIComponent(q)}`,
};

/** Supported platform domains where our content script can extract listings */
const SUPPORTED_PLATFORMS = new Set(Object.keys(PLATFORM_SEARCH_TEMPLATES));

function hostMatchesPlatform(hostname: string): string | null {
  for (const platform of SUPPORTED_PLATFORMS) {
    if (hostname.includes(platform.replace("www.", ""))) return platform;
  }
  return null;
}

/**
 * Ensures the search URL is on a platform where our content script works.
 * If the AI generated a URL on the RIGHT platform → use it.
 * If it generated a Google Shopping or wrong-platform URL → build one on the current platform.
 */
function ensurePlatformSearchUrl(aiUrl: string, productName: string, currentHost: string): string {
  // What platform is the user currently on?
  const currentPlatform = hostMatchesPlatform(currentHost);

  try {
    if (aiUrl) {
      const aiHost = new URL(aiUrl).hostname.toLowerCase();
      const aiPlatform = hostMatchesPlatform(aiHost);

      // AI URL is on a supported platform → use it (even if different from current)
      if (aiPlatform) return aiUrl;
    }
  } catch { /* invalid URL */ }

  // AI URL is on an unsupported site (Google Shopping, etc.)
  // Build a search URL on the platform the user is currently browsing
  if (currentPlatform && productName) {
    const builder = PLATFORM_SEARCH_TEMPLATES[currentPlatform];
    if (builder) return builder(productName);
  }

  // Last resort: use the Google Shopping URL with udm=28 for product extraction
  if (productName) {
    return `https://www.google.com/search?q=${encodeURIComponent(productName)}&udm=28`;
  }

  return aiUrl || "";
}
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return "#34d399";
  if (score >= 50) return "#fbbf24";
  return "#f87171";
}

// Shared design tokens for all on-page panels
const PANEL_BASE_STYLE = `
  position: fixed; top: 80px; right: 20px; z-index: 999999;
  width: 340px; border-radius: 20px; overflow: hidden;
  background: #0c1017; border: 1px solid #1e293b; color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  box-shadow: 0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(99,102,241,0.06);
  animation: nirnai-slide-in 0.3s ease-out;
`;

const PANEL_SHARED_STYLES = `
  <style>
    @keyframes nirnai-slide-in { from { transform: translateX(360px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes nirnai-spin { to { transform: rotate(360deg); } }
    @keyframes nirnai-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  </style>
`;

function showLoadingPanel(): void {
  removePanel();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = PANEL_BASE_STYLE + `padding: 0;`;
  panel.innerHTML = `
    ${PANEL_SHARED_STYLES}
    <div style="display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #1e293b;">
      <span style="font-size:18px;">🛡️</span>
      <span style="font-size:15px;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NirnAI</span>
      <span style="font-size:10px;color:#475569;margin-left:auto;letter-spacing:0.3px;">Clear decisions.</span>
    </div>
    <div id="nirnai-loading-body" style="display:flex;flex-direction:column;align-items:center;padding:28px 18px;">
      <div style="width:32px;height:32px;border:3px solid #1e293b;border-top-color:#818cf8;border-radius:50%;animation:nirnai-spin 0.7s linear infinite;"></div>
      <p id="nirnai-loading-status" style="margin:14px 0 4px;font-size:13px;font-weight:600;color:#f1f5f9;">Analyzing product...</p>
      <p id="nirnai-loading-sub" style="font-size:11px;color:#475569;animation:nirnai-pulse 1.5s ease-in-out infinite;">Trust · Value · Quality</p>
      <div style="width:100%;margin-top:16px;height:3px;background:#1e293b;border-radius:2px;overflow:hidden;">
        <div id="nirnai-loading-bar" style="height:100%;width:10%;background:linear-gradient(90deg,#818cf8,#a78bfa);border-radius:2px;transition:width 1s ease;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Animate progress stages to give feedback during the ~15s wait
  const stages = [
    { pct: "30%", text: "Scoring trust & value...", delay: 2000 },
    { pct: "55%", text: "Checking seller reliability...", delay: 5000 },
    { pct: "75%", text: "Generating realtime insights...", delay: 9000 },
    { pct: "90%", text: "Almost ready...", delay: 14000 },
  ];
  for (const s of stages) {
    setTimeout(() => {
      const bar = document.getElementById("nirnai-loading-bar");
      const status = document.getElementById("nirnai-loading-status");
      if (bar) bar.style.width = s.pct;
      if (status) status.textContent = s.text;
    }, s.delay);
  }
}

/** Build shareable text from analysis results. */
function buildShareText(analysis: AnalysisResponse): string {
  const s = analysis.stamp;
  const url = window.location.href;
  let text = `${s.icon} ${s.label} — NirnAI Verdict\n\n`;
  text += `🛒 Purchase Score: ${analysis.purchase_score}/100\n`;
  text += `⭐ Review Trust: ${analysis.review_trust.trust_score}/100\n`;
  if (analysis.health_score > 0) text += `🥗 Health Score: ${analysis.health_score}/100\n`;
  text += `\n${s.reasons.join(" · ")}\n`;
  if (analysis.warnings.length > 0) text += `\n⚠ ${analysis.warnings[0]}\n`;
  if (analysis.summary) text += `\n${analysis.summary}\n`;
  text += `\n🔗 ${url}\n\nAnalyzed by NirnAI — Send any product link to get a verdict`;
  return text;
}

/** Dynamically inject AI summary & suggestion into an existing result panel. */
function injectAiSections(
  panel: HTMLElement,
  summary: string,
  suggestion: { product_name: string; reason: string; search_url?: string } | null,
  fullAnalysis: AnalysisResponse | null,
): void {
  // Remove existing AI sections if present (idempotent)
  panel.querySelector("#nirnai-ai-summary")?.remove();
  panel.querySelector("#nirnai-ai-suggestion")?.remove();

  // Find the footer to insert before it
  const footer = panel.querySelector("[data-nirnai-footer]");
  if (!footer) return;

  if (summary) {
    const summaryDiv = document.createElement("div");
    summaryDiv.id = "nirnai-ai-summary";
    summaryDiv.style.cssText = "padding:0 18px 14px;border-top:1px solid #1e293b;padding-top:12px;opacity:0;transition:opacity 0.4s ease;";
    summaryDiv.innerHTML = `<div style="font-size:9px;font-weight:800;color:#475569;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">Summary</div><div style="font-size:11px;line-height:1.55;color:#94a3b8;">${summary}</div>`;
    footer.insertAdjacentElement("beforebegin", summaryDiv);
    // Fade in
    requestAnimationFrame(() => { summaryDiv.style.opacity = "1"; });
  }

  const stampType = fullAnalysis?.stamp?.stamp;
  if (suggestion && stampType !== "SMART_BUY") {
    const suggDiv = document.createElement("div");
    suggDiv.id = "nirnai-ai-suggestion";
    suggDiv.style.cssText = "padding:0 18px 14px;border-top:1px solid #1e293b;padding-top:12px;opacity:0;transition:opacity 0.4s ease;";
    suggDiv.innerHTML = `
      <div style="font-size:9px;font-weight:800;color:#475569;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Better Alternative</div>
      <div style="background:#111827;border-radius:12px;padding:12px 14px;border:1px solid #1e293b;">
        <div style="font-size:12px;font-weight:700;color:#818cf8;margin-bottom:4px;">${suggestion.product_name}</div>
        <div style="font-size:10px;line-height:1.45;color:#94a3b8;margin-bottom:10px;">${suggestion.reason}</div>
        ${rankAlternativesButtonsHtml(suggestion.product_name, suggestion.search_url || "", fullAnalysis?.domain || "")}
      </div>
    `;
    footer.insertAdjacentElement("beforebegin", suggDiv);
    requestAnimationFrame(() => { suggDiv.style.opacity = "1"; });
  }

  // Attach the click handler for the newly injected rank button
  attachRankAlternativesHandler();
}

function showResultPanel(analysis: AnalysisResponse): void {
  removePanel();

  const stamp = analysis.stamp;
  // Backend is single source of truth for labels (BEST PICK / BUY / CONSIDER / CAUTION / SKIP)
  const displayLabel = stamp.label;
  // Green for endorsement (BEST PICK, BUY, BOOK), yellow for CONSIDER/CAUTION, red for SKIP
  const stampColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    SMART_BUY: { bg: "rgba(5,150,105,0.12)", border: "#059669", text: "#34d399", glow: "rgba(52,211,153,0.08)" },
    CHECK:     { bg: "rgba(217,119,6,0.12)", border: "#d97706", text: "#fbbf24", glow: "rgba(251,191,36,0.08)" },
    CAUTION:   { bg: "rgba(217,119,6,0.12)", border: "#d97706", text: "#fbbf24", glow: "rgba(251,191,36,0.08)" },
    AVOID:     { bg: "rgba(220,38,38,0.12)", border: "#dc2626", text: "#f87171", glow: "rgba(248,113,113,0.08)" },
  };
  const sc = stampColors[stamp.stamp] || stampColors.CAUTION;

  // Affiliate CTA: only when we actively endorse the product AND it's an
  // Amazon product page where we can extract an ASIN. Opens a brand-new
  // Amazon tab with our Associate tag (clean session, no DOM rewriting).
  const affiliateBuyUrl = stamp.stamp === "SMART_BUY"
    ? buildAmazonAffiliateUrl(window.location.href)
    : null;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = PANEL_BASE_STYLE + `max-height: 85vh; overflow-y: auto;`;

  const purchaseColor = scoreColor(analysis.purchase_score);
  const healthColor = scoreColor(analysis.health_score);
  const trustColor = scoreColor(analysis.review_trust.trust_score);
  const confPct = Math.round(analysis.confidence * 100);

  const positivesHtml = analysis.positives.length > 0
    ? analysis.positives.map(p => `<div style="font-size:11px;padding:3px 0;color:#34d399;">✓ ${p}</div>`).join("")
    : "";
  const warningsHtml = analysis.warnings.length > 0
    ? analysis.warnings.map(w => `<div style="font-size:11px;padding:3px 0;color:#f87171;">⚠ ${w}</div>`).join("")
    : "";

  const scoreBar = (label: string, emoji: string, score: number, color: string) => `
    <div style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:4px;">
        <span style="color:#94a3b8;">${emoji} ${label}</span>
        <span style="font-weight:800;color:${color};font-size:12px;">${score}</span>
      </div>
      <div style="height:5px;background:#111827;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${score}%;background:${color};border-radius:3px;transition:width 0.6s ease;"></div>
      </div>
    </div>
  `;

  const healthSection = analysis.health_score > 0 ? scoreBar("Health", "🥗", analysis.health_score, healthColor) : "";

  panel.innerHTML = `
    ${PANEL_SHARED_STYLES}
    <style>
      #${PANEL_ID}::-webkit-scrollbar { width: 3px; }
      #${PANEL_ID}::-webkit-scrollbar-track { background: transparent; }
      #${PANEL_ID}::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
    </style>
    <div style="display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #1e293b;">
      <span style="font-size:18px;">🛡️</span>
      <span style="font-size:15px;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NirnAI</span>
      <span style="font-size:10px;color:#475569;margin-left:auto;">${confPct}% confidence</span>
      <button id="nirnai-close" style="background:none;border:none;color:#475569;font-size:16px;cursor:pointer;padding:0 0 0 6px;line-height:1;transition:color 0.2s;" onmouseover="this.style.color='#f1f5f9'" onmouseout="this.style.color='#475569'">✕</button>
    </div>
    <div style="background:${sc.bg};border-bottom:1px solid ${sc.border};padding:16px 18px;text-align:center;">
      <div style="font-size:26px;">${stamp.icon}</div>
      <div style="font-size:17px;font-weight:800;color:${sc.text};margin-top:6px;letter-spacing:0.3px;">${displayLabel}</div>
      <div style="font-size:10px;color:${sc.text};opacity:0.7;margin-top:5px;line-height:1.4;">${stamp.reasons.join(" · ")}</div>
      ${affiliateBuyUrl ? `
      <a id="nirnai-affiliate-buy" href="${affiliateBuyUrl}" target="_blank" rel="noopener nofollow sponsored"
         style="display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;padding:9px 18px;font-size:12px;font-weight:800;color:#fff;background:${sc.border};border-radius:8px;text-decoration:none;letter-spacing:0.4px;box-shadow:0 4px 14px ${sc.glow};transition:transform 0.15s,box-shadow 0.15s;"
         onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 18px ${sc.glow}'"
         onmouseout="this.style.transform='none';this.style.boxShadow='0 4px 14px ${sc.glow}'">
        🛒 Buy on Amazon →
      </a>
      <div style="font-size:9px;color:${sc.text};opacity:0.6;margin-top:6px;line-height:1.3;">Affiliate link · As an Amazon Associate we may earn a commission</div>
      ` : ""}
    </div>
    <div style="padding:14px 18px;">
      ${scoreBar("Purchase Score", "🛒", analysis.purchase_score, purchaseColor)}
      ${scoreBar("Review Trust", "⭐", analysis.review_trust.trust_score, trustColor)}
      ${healthSection}
    </div>
    ${positivesHtml || warningsHtml ? `<div style="padding:0 18px 14px;border-top:1px solid #1e293b;padding-top:12px;">${warningsHtml}${positivesHtml}</div>` : ""}
    ${analysis.summary ? `<div id="nirnai-ai-summary" style="padding:0 18px 14px;border-top:1px solid #1e293b;padding-top:12px;"><div style="font-size:9px;font-weight:800;color:#475569;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">Summary</div><div style="font-size:11px;line-height:1.55;color:#94a3b8;">${analysis.summary}</div></div>` : ""}
    ${analysis.suggestion && stamp.stamp !== "SMART_BUY" ? `
    <div id="nirnai-ai-suggestion" style="padding:0 18px 14px;border-top:1px solid #1e293b;padding-top:12px;">
      <div style="font-size:9px;font-weight:800;color:#475569;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Better Alternative</div>
      <div style="background:#111827;border-radius:12px;padding:12px 14px;border:1px solid #1e293b;">
        <div style="font-size:12px;font-weight:700;color:#818cf8;margin-bottom:4px;">${analysis.suggestion.product_name}</div>
        <div style="font-size:10px;line-height:1.45;color:#94a3b8;margin-bottom:10px;">${analysis.suggestion.reason}</div>
        ${rankAlternativesButtonsHtml(analysis.suggestion.product_name, analysis.suggestion.search_url, analysis.domain || "")}
      </div>
    </div>` : ""}
    <div style="padding:10px 18px;border-top:1px solid #1e293b;display:flex;align-items:center;gap:8px;">
      <div id="nirnai-share-whatsapp" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:#fff;background:#25D366;padding:6px 12px;border-radius:6px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 2px 8px rgba(37,211,102,0.3);flex:1;justify-content:center;" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(37,211,102,0.4)'" onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 8px rgba(37,211,102,0.3)'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.553 4.12 1.522 5.857L.06 23.5l5.793-1.42A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82c-1.88 0-3.63-.517-5.13-1.412l-.368-.218-3.81.935.978-3.7-.24-.382A9.81 9.81 0 012.18 12c0-5.422 4.398-9.82 9.82-9.82 5.422 0 9.82 4.398 9.82 9.82 0 5.422-4.398 9.82-9.82 9.82z"/></svg>
        Share verdict
      </div>
      <div id="nirnai-share-copy" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:#94a3b8;background:#1e293b;padding:6px 12px;border-radius:6px;cursor:pointer;transition:transform 0.15s,background 0.15s;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='#1e293b'">📋 Copy</div>
    </div>
    <div data-nirnai-footer style="padding:8px 18px;border-top:1px solid #1e293b;text-align:center;">
      <span style="font-size:9px;color:#334155;letter-spacing:0.3px;">NirnAI · Clear decisions. Every purchase.</span>
      ${new URLSearchParams(window.location.search).get("utm_source") === "nirnai" ? '<div style="font-size:8px;color:#475569;margin-top:4px;">Standalone analysis — scores may differ from ranking page</div>' : ""}
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById("nirnai-close")?.addEventListener("click", () => {
    removePanel();
    showCollapsedBadge(analysis);
  });

  // ── Share on WhatsApp ──
  document.getElementById("nirnai-share-whatsapp")?.addEventListener("click", () => {
    const text = buildShareText(analysis);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  });

  // ── Copy verdict to clipboard ──
  document.getElementById("nirnai-share-copy")?.addEventListener("click", () => {
    const text = buildShareText(analysis);
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("nirnai-share-copy");
      if (btn) { btn.textContent = "✓ Copied!"; setTimeout(() => { btn.innerHTML = "📋 Copy"; }, 2000); }
    });
  });

  // ── Pre-checkout price recheck on the BUY CTA ──
  // Goal: don't let an affiliate redirect happen if the price the user is
  // looking at has drifted >10% from when we scored it. Fail-open — any
  // network error or unknown product just lets the click proceed.
  attachAffiliateRecheck(productSnapshotForRecheck());

  // "Rank alternatives" button → triggers cross-site comparison across ALL platforms
  attachRankAlternativesHandler();
}

/**
 * Build a CATEGORY-based search query for finding ALTERNATIVES.
 * The goal is NOT to find the same product — it's to find COMPETING products
 * in the same category from different brands.
 *
 * Strategy:
 * 1. Use the page's breadcrumb category if available (most reliable)
 * 2. Extract product TYPE keywords from the title (strip brand, model, size, quantity)
 * 3. Keep only category-descriptive words: "acne patches", "wireless earbuds", "running shoes"
 *
 * "PanOxyl PM Overnight Spot Patches, Advanced Hydrocolloid Healing Technology, Fragrance Free, 40 Count Pack of 1"
 *   → "hydrocolloid acne spot patches"
 * "SEKKISEI Emulsion 2 Bottles Set 4.7oz & 2.3oz"
 *   → "facial emulsion moisturizer"
 */
function buildCategorySearchQuery(productName: string, originalTitle?: string, category?: string): string {
  // Strategy 1: Use breadcrumb category if it's descriptive enough
  if (category) {
    const catWords = category.toLowerCase()
      .replace(/[&>]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !BRAND_WORDS.has(w) && !FILLER_WORDS.has(w));
    if (catWords.length >= 2) {
      return catWords.slice(0, 4).join(" ");
    }
  }

  // Strategy 2: Extract product TYPE from title — strip brand, sizes, quantities
  const title = originalTitle || productName;
  const words = title
    .replace(/['"()[\]{}]/g, "")
    .replace(/,/g, " ")
    .split(/[\s/\-–—]+/)
    .map(w => w.replace(/[^a-zA-Z]/g, "").toLowerCase())
    .filter(w => w.length > 2);

  // Skip brand (first 1-2 words), strip sizes/quantities/filler
  const typeWords: string[] = [];
  let skippedBrand = false;
  for (const w of words) {
    // Skip brand-like words at the start
    if (!skippedBrand && (BRAND_WORDS.has(w) || /^[A-Z]{2,}$/.test(w))) continue;
    skippedBrand = true;

    // Skip size, quantity, model number patterns
    if (FILLER_WORDS.has(w)) continue;
    if (SIZE_PATTERN.test(w)) continue;
    if (/^\d+$/.test(w)) continue;

    typeWords.push(w);
    if (typeWords.length >= 5) break;
  }

  if (typeWords.length >= 2) {
    return typeWords.join(" ");
  }

  // Strategy 3: Fallback — just remove first word (brand) and take a few words
  return words.slice(1, 5).join(" ") || words.join(" ");
}

const BRAND_WORDS = new Set([
  "visit", "store", "brand", "official", "authentic", "genuine",
]);
const FILLER_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "its",
  "new", "best", "top", "premium", "deluxe", "original", "official",
  "pack", "set", "piece", "count", "size", "each", "total",
  "free", "includes", "included", "bonus", "bundle",
  "oz", "ounce", "ml", "liter", "gram", "lb", "kg",
  "inch", "inches", "cm", "mm", "ft",
  "qty", "quantity",
]);
const SIZE_PATTERN = /^(\d+\.?\d*)(oz|ml|mg|g|kg|lb|ct|pk|pc|in|cm|mm|fl)$/i;

// ── Dual-track entry point ────────────────────────────────────────────────
// The compare page renders two tabs (Best Pick / Best Deal) for India batches.
// Surfacing the choice BEFORE we run the cross-site search lets the user tell
// us their intent up front and lands them directly on the right tab. For
// non-India hosts we keep the single "Rank alternatives" button — there's
// nothing to choose between.
function isIndiaHost(): boolean {
  const h = window.location.hostname.toLowerCase();
  return h.endsWith(".in") || h.includes("flipkart.com") || h.includes("nykaa.com")
      || h.includes("myntra.com") || h.includes("tatacliq.com") || h.includes("snapdeal.com")
      || h.includes("ajio.com") || h.includes("meesho.com") || h.includes("bigbasket.com");
}

/**
 * US host detection — mirror of isIndiaHost(). Used to lock the cross-site
 * pool to US-only retailers when the user is shopping on a US marketplace,
 * so we don't surface flipkart/nykaa listings in INR they can't buy.
 *
 * Conservative: .com TLD on a known US-only retailer (walmart/target/...) is
 * unambiguous. Plain amazon.com is US. We don't try to localize amazon.co.uk
 * or amazon.de here — those would need their own pool.
 */
function isUSHost(): boolean {
  const h = window.location.hostname.toLowerCase();
  if (isIndiaHost()) return false;
  // amazon.com (and subdomains) — but not amazon.in / .co.uk / .de etc.
  if (/(^|\.)amazon\.com$/.test(h)) return true;
  return h.includes("walmart.com") || h.includes("target.com") || h.includes("bestbuy.com")
      || h.includes("costco.com") || h.includes("homedepot.com") || h.includes("lowes.com")
      || h.includes("ebay.com") || h.includes("wayfair.com") || h.includes("macys.com")
      || h.includes("nordstrom.com") || h.includes("sephora.com") || h.includes("cvs.com")
      || h.includes("walgreens.com") || h.includes("etsy.com") || h.includes("newegg.com");
}

/**
 * Renders either the single legacy "Rank alternatives" button or, on India
 * platforms, a pair of pills letting the user choose Best Pick vs Best Deal.
 * Both pills share the existing #nirnai-suggestion-rank handler — `data-mode`
 * carries the user's intent through to the compare page.
 */
function rankAlternativesButtonsHtml(productName: string, searchUrl: string, domain: string): string {
  const baseAttrs = `data-url="${searchUrl}" data-name="${productName}" data-domain="${domain}"`;
  const baseStyle = "display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;";

  if (!isIndiaHost()) {
    return `<div id="nirnai-suggestion-rank" ${baseAttrs} data-mode="quality"
      style="${baseStyle}background:#6366f1;box-shadow:0 2px 8px rgba(99,102,241,0.3);"
      onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(99,102,241,0.4)'"
      onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 8px rgba(99,102,241,0.3)'">
      🏆 Rank alternatives</div>`;
  }

  // India: two pills. Same id on the first so existing handler attaches; the
  // second gets a sibling id and shares the click flow via querySelectorAll.
  return `
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <div id="nirnai-suggestion-rank" class="nirnai-rank-btn" ${baseAttrs} data-mode="quality"
        style="${baseStyle}background:#6366f1;box-shadow:0 2px 8px rgba(99,102,241,0.3);"
        onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(99,102,241,0.4)'"
        onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 8px rgba(99,102,241,0.3)'"
        title="Find higher-scoring alternatives across platforms">🏆 Best Pick</div>
      <div id="nirnai-suggestion-rank-price" class="nirnai-rank-btn" ${baseAttrs} data-mode="price"
        style="${baseStyle}background:#16a34a;box-shadow:0 2px 8px rgba(22,163,74,0.3);"
        onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(22,163,74,0.4)'"
        onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 8px rgba(22,163,74,0.3)'"
        title="Find the same product at the best price across platforms">💰 Best Deal</div>
    </div>`;
}

/** Attach click handler to #nirnai-suggestion-rank. Safe to call multiple times — idempotent. */
function attachRankAlternativesHandler(): void {
  // Both India pills share the same handler — we just read data-mode off the
  // clicked element to know which tab to land on.
  const els = Array.from(document.querySelectorAll<HTMLElement>(".nirnai-rank-btn, #nirnai-suggestion-rank"));
  for (const el of els) {
    if ((el as any).__nirnaiHandlerAttached) continue;
    (el as any).__nirnaiHandlerAttached = true;
    el.addEventListener("click", onRankAlternativesClick);
  }
}

function onRankAlternativesClick(e: Event): void {
    const btn = e.currentTarget as HTMLElement;
    const productName = btn.dataset.name || "";
    if (!productName) return;
    btn.innerHTML = `<div style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:nirnai-spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></div> Searching…`;
    btn.style.cursor = "default";
    btn.style.opacity = "0.6";

    // Show fullscreen NirnAI overlay — user sees this instead of background tabs
    showCrossSiteOverlay();

    const currentHost = window.location.hostname.toLowerCase();

    // Detect whether we're on a travel or shopping site — prefer backend domain
    const backendDomain = btn.dataset.domain || "";
    const TRAVEL_HOSTS = ["airbnb", "booking", "expedia", "vrbo", "agoda", "hotels", "tripadvisor", "google.com/travel", "makemytrip", "goibibo", "ixigo", "cleartrip", "yatra", "easemytrip"];
    const isTravelSite = backendDomain === "hospitality" || TRAVEL_HOSTS.some(h => currentHost.includes(h));
    const siteCategory = isTravelSite ? "travel" : "shopping";

    // Detect origin site name from hostname
    const SITE_HOST_MAP: Record<string, string> = {
      "airbnb": "airbnb", "booking": "booking", "expedia": "expedia", "vrbo": "vrbo",
      "agoda": "agoda", "hotels.com": "hotels", "tripadvisor": "tripadvisor",
      "amazon": "amazon", "walmart": "walmart", "target.com": "target",
      "costco": "costco", "bestbuy": "bestbuy", "homedepot": "homedepot",
      "lowes": "lowes", "ebay": "ebay", "wayfair": "wayfair", "macys": "macys",
      "nordstrom": "nordstrom", "cvs": "cvs", "walgreens": "walgreens",
      "nike": "nike", "apple.com/shop": "apple", "samsung": "samsung", "dyson": "dyson",
      "makemytrip": "makemytrip", "goibibo": "goibibo", "ixigo": "ixigo",
      "cleartrip": "cleartrip", "yatra": "yatra", "easemytrip": "easemytrip",
    };
    let originSite = "";
    for (const [hostFragment, siteName] of Object.entries(SITE_HOST_MAP)) {
      if (currentHost.includes(hostFragment)) { originSite = siteName; break; }
    }

    // ── Extract REAL search parameters from the page ──
    let destination = "";
    let query = "";
    let checkin = "", checkout = "", adults = "2", children = "", rooms = "1";
    // Geo coordinates for precise cross-site search
    let centerLat: number | undefined;
    let centerLng: number | undefined;
    let neLat: number | undefined, neLng: number | undefined;
    let swLat: number | undefined, swLng: number | undefined;
    let areaType: "dense_urban" | "urban" | "suburban" | "resort" | "rural" | undefined;
    let radiusMiles: number | undefined;
    let originProductData: ProductData | null = null;

    if (isTravelSite && extractor) {
      // 1. Extract product data from page — barcode has location, dates, guests
      try {
        const productData = extractor.extractProduct();
        originProductData = productData;
        const ctx = productData.barcode || "";
        const ctxParams = new URLSearchParams(ctx.replace(/^search_base_url=[^&]*&?/, ""));
        destination = ctxParams.get("location") || "";
        checkin = ctxParams.get("checkin") || "";
        checkout = ctxParams.get("checkout") || "";
        adults = ctxParams.get("adults") || "2";
        children = ctxParams.get("children") || "";
      } catch { /* ignore extraction errors */ }

      // 2. Extract precise coordinates from the listing page
      //    getSearchCenter() returns lat/lng from URL params, DOM, meta tags, or JSON-LD
      try {
        const center = extractor.getSearchCenter?.() || null;
        if (center) {
          centerLat = center.lat;
          centerLng = center.lng;
        }
        // Also try map bounds (mainly Airbnb search pages → stored in session)
        const bounds = extractor.getMapBounds?.() || null;
        if (bounds) {
          neLat = bounds.ne.lat;
          neLng = bounds.ne.lng;
          swLat = bounds.sw.lat;
          swLng = bounds.sw.lng;
          // Derive center from bounds if not already set
          if (centerLat == null) {
            centerLat = (bounds.ne.lat + bounds.sw.lat) / 2;
            centerLng = (bounds.ne.lng + bounds.sw.lng) / 2;
          }
        }
      } catch { /* ignore */ }

      // 3. URL params (product pages often carry dates/guests)
      const urlParams = new URLSearchParams(window.location.search);
      if (!checkin) checkin = urlParams.get("checkin") || urlParams.get("check_in") || urlParams.get("d1") || "";
      if (!checkout) checkout = urlParams.get("checkout") || urlParams.get("check_out") || urlParams.get("d2") || "";
      if (adults === "2") adults = urlParams.get("adults") || urlParams.get("group_adults") || "2";
      if (!children) children = urlParams.get("children") || urlParams.get("group_children") || "";
      if (!destination) destination = urlParams.get("ss") || urlParams.get("query") || urlParams.get("destination") || "";

      // 4. Fall back to last search session for dates/guests/location/bounds
      try {
        const lastSearch = sessionStorage.getItem("nirnai_last_search");
        if (lastSearch) {
          const lastUrl = new URL(lastSearch);
          const lp = lastUrl.searchParams;
          if (!checkin) checkin = lp.get("checkin") || lp.get("check_in") || lp.get("d1") || lp.get("startDate") || "";
          if (!checkout) checkout = lp.get("checkout") || lp.get("check_out") || lp.get("d2") || lp.get("endDate") || "";
          if (adults === "2") adults = lp.get("adults") || lp.get("group_adults") || "2";
          if (!children) children = lp.get("children") || lp.get("group_children") || "";
          if (!rooms || rooms === "1") rooms = lp.get("no_rooms") || lp.get("rooms") || "1";
          // Location from last search URL
          if (!destination) {
            destination = lp.get("query") || lp.get("ss") || lp.get("destination") || lp.get("textToSearch") || "";
            if (!destination) {
              const pathMatch = lastUrl.pathname.match(/\/s\/([^/]+)\/homes/);
              if (pathMatch) destination = decodeURIComponent(pathMatch[1]).replace(/--/g, ", ").replace(/-/g, " ");
            }
          }
          // Map bounds from last search (Airbnb stores ne_lat/sw_lat in URL)
          if (neLat == null) {
            const ne_lat = parseFloat(lp.get("ne_lat") || "");
            const ne_lng = parseFloat(lp.get("ne_lng") || "");
            const sw_lat = parseFloat(lp.get("sw_lat") || "");
            const sw_lng = parseFloat(lp.get("sw_lng") || "");
            if (!isNaN(ne_lat) && !isNaN(sw_lat)) {
              neLat = ne_lat; neLng = ne_lng; swLat = sw_lat; swLng = sw_lng;
              if (centerLat == null) {
                centerLat = (ne_lat + sw_lat) / 2;
                centerLng = (ne_lng + sw_lng) / 2;
              }
            }
          }
        }
      } catch { /* ignore */ }

      // 5. Last resort: try getSearchParams() (works if user came from search)
      if (!destination && extractor.getSearchParams) {
        const sp = extractor.getSearchParams();
        if (sp) {
          destination = sp.destination || destination;
          if (!checkin) checkin = sp.checkin;
          if (!checkout) checkout = sp.checkout;
          adults = sp.adults || adults;
          children = sp.children || children;
          rooms = sp.rooms || rooms;
        }
      }

      // ── Compute adaptive radius based on area density ──
      // Manhattan downtown = 0.5-1mi, Tampa suburbs = 5-10mi, Maui resort = 10-15mi
      const profile = classifySearch(originSite, destination, 0,
        (neLat != null && swLat != null) ? { ne: { lat: neLat!, lng: neLng! }, sw: { lat: swLat!, lng: swLng! } } : undefined
      );
      areaType = profile.areaType;
      radiusMiles = profile.radiusMiles;

      // If we have a center point but no bounds, compute bounding box from radius
      if (centerLat != null && centerLng != null && neLat == null) {
        // Convert radius miles to approximate lat/lng deltas
        // 1 degree latitude ≈ 69 miles, 1 degree longitude ≈ 69 * cos(lat) miles
        const latDelta = radiusMiles / 69;
        const lngDelta = radiusMiles / (69 * Math.cos(centerLat * Math.PI / 180));
        neLat = centerLat + latDelta;
        neLng = centerLng! + lngDelta;
        swLat = centerLat - latDelta;
        swLng = centerLng! - lngDelta;
      }
    } else {
      // Shopping: extract product data first so we have the original title
      if (extractor) {
        try { originProductData = extractor.extractProduct(); } catch { /* ignore */ }
      }
      // Build a CATEGORY search query — find competing products, NOT the same product
      // "PanOxyl PM Overnight Spot Patches..." → "hydrocolloid acne spot patches"
      query = buildCategorySearchQuery(productName, originProductData?.title, originProductData?.category);
      console.log(`NirnAI: Category search query: "${productName}" → "${query}"`);
    }

    const geo = detectGeoContext();
    const searchParams = {
      destination,
      checkin,
      checkout,
      adults,
      children,
      rooms,
      query,
      country_code: geo.country_code,
      currency_code: geo.currency_code,
      // Precise geo for radius-based cross-site search
      lat: centerLat,
      lng: centerLng,
      ne_lat: neLat,
      ne_lng: neLng,
      sw_lat: swLat,
      sw_lng: swLng,
      area_type: areaType,
      radius_miles: radiusMiles,
    };

    console.log("NirnAI: Cross-site search params from product page:", JSON.stringify({
      destination, checkin, checkout, adults, children,
      lat: centerLat, lng: centerLng,
      ne_lat: neLat, sw_lat: swLat,
    }));

    // Send cross-site compare — searches ALL platforms with geo bounds
    chrome.runtime.sendMessage({
      action: "CROSS_SITE_COMPARE",
      originSite,
      listings: originProductData ? [originProductData] : [],
      searchParams,
      searchContext: isTravelSite
        ? `Cross-site search for ${destination || "this area"}${areaType ? ` (${areaType.replace("_", " ")}, ~${radiusMiles}mi radius)` : ""}. Dates: ${checkin || "flexible"} to ${checkout || "flexible"}. Guests: ${adults} adults${children ? `, ${children} children` : ""}. Coordinates: ${centerLat != null ? `${centerLat!.toFixed(4)},${centerLng!.toFixed(4)}` : "unknown"}. User wants alternatives to current listing.`
        : `FIND ALTERNATIVES: User is viewing "${productName}" and wants to discover BETTER options in the same category from DIFFERENT brands. The original product is included as a baseline — rank it fairly but prioritize finding genuinely different alternatives. Category search: "${query}"`,
      includeOrigin: true,
      siteCategory,
      productDomain: backendDomain || "",
      // "quality" → land on Best Pick tab; "price" → land on Best Deal tab.
      // Backend / Rust gateway use this only as a UI hint (compare URL gets
      // a #tab=price hash); ranking computation is unaffected.
      rankMode: (btn.dataset.mode === "price") ? "price" : "quality",
      // When the origin is an India host, restrict the cross-site pool to
      // India-only marketplaces (amazon.in, flipkart, nykaa, myntra, ajio,
      // tatacliq, meesho). Otherwise the user gets US listings in USD that
      // they can't actually buy from India.
      isIndia: isIndiaHost(),
      // Symmetric guard for US hosts — locks the pool to US retailers and
      // forces amazon → amazon.com so we don't surface flipkart/nykaa INR
      // listings to a US shopper.
      isUS: isUSHost(),
    } as any);
}

function showCollapsedBadge(analysis: AnalysisResponse): void {
  document.getElementById(BADGE_ID)?.remove();
  const stamp = analysis.stamp;
  // Backend is single source of truth for labels
  const displayLabel = stamp.label;
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    SMART_BUY: { bg: "rgba(5,150,105,0.15)", border: "#059669", text: "#34d399" },
    CHECK:     { bg: "rgba(5,150,105,0.15)", border: "#059669", text: "#34d399" },
    AVOID:     { bg: "rgba(220,38,38,0.15)", border: "#dc2626", text: "#f87171" },
  };
  const c = colors[stamp.stamp] || colors.CHECK;

  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    display: flex; align-items: center; gap: 6px;
    padding: 10px 16px; border-radius: 12px;
    background: ${c.bg}; border: 1px solid ${c.border}; color: ${c.text};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    cursor: pointer; font-size: 13px; font-weight: 700;
    transition: transform 0.2s, box-shadow 0.2s;
    backdrop-filter: blur(12px);
  `;
  badge.textContent = `${stamp.icon} ${displayLabel}`;
  badge.title = "Click to expand NirnAI analysis";
  badge.addEventListener("mouseenter", () => { badge.style.transform = "scale(1.05)"; });
  badge.addEventListener("mouseleave", () => { badge.style.transform = "scale(1)"; });
  badge.addEventListener("click", () => {
    badge.remove();
    showResultPanel(analysis);
  });
  document.body.appendChild(badge);
}

function removePanel(): void {
  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(BADGE_ID)?.remove();
}

// ── Cart Page Panel ─────────────────────────────────────────────────────────

const CART_PANEL_ID = "nirnai-cart-panel";

function showCartLoadingPanel(count: number): void {
  document.getElementById(CART_PANEL_ID)?.remove();
  const panel = document.createElement("div");
  panel.id = CART_PANEL_ID;
  panel.style.cssText = PANEL_BASE_STYLE + `padding: 0;`;
  panel.innerHTML = `
    ${PANEL_SHARED_STYLES}
    <div style="display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #1e293b;">
      <span style="font-size:18px;">🛡️</span>
      <span style="font-size:15px;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NirnAI</span>
      <span style="font-size:10px;color:#475569;margin-left:auto;">Cart Analysis</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;padding:36px 0;">
      <div style="width:32px;height:32px;border:3px solid #1e293b;border-top-color:#818cf8;border-radius:50%;animation:nirnai-spin 0.7s linear infinite;"></div>
      <p style="margin:14px 0 4px;font-size:13px;font-weight:600;color:#f1f5f9;">Analyzing ${count} cart item${count > 1 ? "s" : ""}...</p>
      <p style="font-size:11px;color:#475569;animation:nirnai-pulse 1.5s ease-in-out infinite;">Checking every item</p>
    </div>
  `;
  document.body.appendChild(panel);
}

function showCartResultPanel(cartResponse: CartAnalysisResponse, limitedDataUrls?: Set<string>): void {
  document.getElementById(CART_PANEL_ID)?.remove();
  removePanel();

  const { summary, items } = cartResponse;

  const panel = document.createElement("div");
  panel.id = CART_PANEL_ID;
  panel.style.cssText = PANEL_BASE_STYLE + `max-height: 85vh; overflow-y: auto;`;

  // Overall verdict colors
  const verdictColors: Record<string, { bg: string; border: string; text: string }> = {
    SMART_BUY: { bg: "rgba(5,150,105,0.12)", border: "#059669", text: "#34d399" },
    CHECK:     { bg: "rgba(217,119,6,0.12)", border: "#d97706", text: "#fbbf24" },
    AVOID:     { bg: "rgba(220,38,38,0.12)", border: "#dc2626", text: "#f87171" },
  };
  const vc = verdictColors[summary.overall_verdict] || verdictColors.CHECK;

  const verdictLabel: Record<string, string> = {
    SMART_BUY: "GOOD CART",
    CHECK: "REVIEW CART",
    AVOID: "RECONSIDER",
  };

  // Summary stats
  const purchaseColor = scoreColor(summary.avg_purchase_score);
  const healthColor = scoreColor(summary.avg_health_score);

  // Check if any items have limited data
  const hasLimitedData = limitedDataUrls && limitedDataUrls.size > 0;

  // Per-item HTML
  let itemsHtml = "";
  for (const item of items) {
    const stampColors: Record<string, { bg: string; text: string }> = {
      SMART_BUY: { bg: "rgba(52,211,153,0.1)", text: "#34d399" },
      CHECK:     { bg: "rgba(251,191,36,0.1)", text: "#fbbf24" },
      AVOID:     { bg: "rgba(248,113,113,0.1)", text: "#f87171" },
    };
    const sc = stampColors[item.stamp.stamp] || stampColors.CHECK;
    // Backend is single source of truth for labels
    const cartLabel = item.stamp.label;
    const shortTitle = item.title.length > 55 ? item.title.slice(0, 52) + "..." : item.title;
    const priceStr = item.price ? ` \u2022 ${item.price}` : "";
    const isLimited = limitedDataUrls?.has(item.url || "") ?? false;

    itemsHtml += `
      <div style="padding:12px 16px;border-bottom:1px solid #1e293b;display:flex;gap:10px;align-items:flex-start;">
        ${item.image_url ? `<img src="${item.image_url}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;">` : ""}
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;line-height:1.3;margin-bottom:5px;">${shortTitle}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="background:${sc.bg};color:${sc.text};padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">${item.stamp.icon} ${cartLabel}</span>
            <span style="font-size:10px;opacity:0.5;">Score: ${item.purchase_score}${priceStr}</span>
            ${isLimited ? `<span style="font-size:9px;color:#94a3b8;background:#1e293b;padding:1px 6px;border-radius:4px;">Limited data</span>` : ""}
          </div>
          ${isLimited ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">📄 <a href="${item.url}" target="_blank" rel="noopener" style="color:#93c5fd;text-decoration:underline;font-size:10px;">View product page</a> for accurate score</div>` : ""}
          ${!isLimited && item.warnings.length > 0 ? `<div style="font-size:10px;color:#fca5a5;margin-top:3px;">\u26A0\uFE0F ${item.warnings[0]}</div>` : ""}
          ${item.suggestion ? `<div style="font-size:10px;color:#93c5fd;margin-top:3px;">💡 Try: <span class="nirnai-cart-rank" data-url="${item.suggestion.search_url}" data-name="${item.suggestion.product_name}" style="color:#93c5fd;text-decoration:underline;cursor:pointer;">${item.suggestion.product_name}</span></div>` : ""}
        </div>
      </div>
    `;
  }

  panel.innerHTML = `
    ${PANEL_SHARED_STYLES}
    <style>
      #${CART_PANEL_ID}::-webkit-scrollbar { width: 3px; }
      #${CART_PANEL_ID}::-webkit-scrollbar-track { background: transparent; }
      #${CART_PANEL_ID}::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
    </style>
    <div style="display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #1e293b;">
      <span style="font-size:18px;">🛒</span>
      <span style="font-size:15px;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Cart Analysis</span>
      <span style="font-size:10px;color:#475569;margin-left:auto;">${summary.total_items} item${summary.total_items > 1 ? "s" : ""}</span>
      <button id="nirnai-cart-close" style="background:none;border:none;color:#475569;font-size:16px;cursor:pointer;padding:0 0 0 6px;line-height:1;transition:color 0.2s;" onmouseover="this.style.color='#f1f5f9'" onmouseout="this.style.color='#475569'">✕</button>
    </div>

    <!-- Overall Verdict Banner -->
    <div style="background:${vc.bg};border-bottom:1px solid ${vc.border};padding:14px 16px;text-align:center;">
      <div style="font-size:24px;">${summary.overall_icon}</div>
      <div style="font-size:16px;font-weight:800;color:${vc.text};margin-top:4px;">${verdictLabel[summary.overall_verdict] || summary.overall_verdict}</div>
      ${summary.estimated_total ? `<div style="font-size:12px;color:${vc.text};opacity:0.8;margin-top:4px;">Cart Total: ${summary.estimated_total}</div>` : ""}
    </div>

    <!-- Aggregate Scores -->
    <div style="padding:14px 16px;display:flex;gap:12px;">
      <div style="flex:1;">
        <div style="font-size:10px;opacity:0.5;margin-bottom:4px;">Avg Purchase</div>
        <div style="font-size:18px;font-weight:700;color:${purchaseColor};">${summary.avg_purchase_score}<span style="font-size:11px;opacity:0.5;">/100</span></div>
        <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;margin-top:4px;">
          <div style="height:100%;width:${summary.avg_purchase_score}%;background:${purchaseColor};border-radius:2px;"></div>
        </div>
      </div>
      ${summary.avg_health_score > 0 ? `
      <div style="flex:1;">
        <div style="font-size:10px;opacity:0.5;margin-bottom:4px;">Avg Health</div>
        <div style="font-size:18px;font-weight:700;color:${healthColor};">${summary.avg_health_score}<span style="font-size:11px;opacity:0.5;">/100</span></div>
        <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;margin-top:4px;">
          <div style="height:100%;width:${summary.avg_health_score}%;background:${healthColor};border-radius:2px;"></div>
        </div>
      </div>` : ""}
      <div style="display:flex;flex-direction:column;gap:3px;font-size:10px;justify-content:center;">
        ${summary.items_smart_buy > 0 ? `<span>\uD83D\uDFE2 ${summary.items_smart_buy} Smart Buy</span>` : ""}
        ${summary.items_check > 0 ? `<span>\uD83D\uDFE1 ${summary.items_check} Check</span>` : ""}
        ${summary.items_to_avoid > 0 ? `<span>\uD83D\uDD34 ${summary.items_to_avoid} Avoid</span>` : ""}
      </div>
    </div>

    <!-- AI Summary -->
    ${summary.ai_summary ? `
    <div style="padding:0 16px 12px;border-top:1px solid #1e293b;padding-top:12px;">
      <div style="font-size:11px;font-weight:600;opacity:0.5;margin-bottom:6px;">NirnAI CART SUMMARY</div>
      <div style="font-size:12px;line-height:1.5;opacity:0.85;">${summary.ai_summary}</div>
    </div>` : ""}

    <!-- Top Warnings -->
    ${summary.top_warnings.length > 0 ? `
    <div style="padding:0 16px 12px;border-top:1px solid #1e293b;padding-top:12px;">
      ${summary.top_warnings.map(w => `<div style="font-size:11px;padding:2px 0;color:#fca5a5;">\u26A0\uFE0F ${w}</div>`).join("")}
    </div>` : ""}

    <!-- Limited Data Notice -->
    ${hasLimitedData ? `
    <div style="padding:10px 16px;border-top:1px solid #1e293b;background:#1e293b;">
      <div style="font-size:11px;color:#94a3b8;line-height:1.4;">ℹ️ Some items have <strong style="color:#e2e8f0;">limited data</strong> from the cart page. For accurate scores, click on individual product links below.</div>
    </div>` : ""}

    <!-- Per-Item Results -->
    <div style="border-top:1px solid #1e293b;">
      <div style="padding:10px 16px;font-size:11px;font-weight:600;opacity:0.5;">ITEM DETAILS</div>
      ${itemsHtml}
    </div>

    <div style="padding:8px 16px;text-align:center;">
      <span style="font-size:10px;opacity:0.3;">NirnAI \u2014 Clear decisions. Every purchase.</span>
    </div>
  `;

  document.body.appendChild(panel);
  document.getElementById("nirnai-cart-close")?.addEventListener("click", () => {
    panel.remove();
  });

  // Cart item suggestion links → open search on correct platform with auto-rank
  panel.querySelectorAll<HTMLElement>(".nirnai-cart-rank").forEach(el => {
    el.addEventListener("click", () => {
      const rawUrl = el.dataset.url || "";
      const productName = el.dataset.name || "";
      if (!rawUrl && !productName) return;
      el.textContent = "Opening NirnAI…";
      el.style.cursor = "default";
      const currentHost = window.location.hostname.toLowerCase();
      const searchUrl = ensurePlatformSearchUrl(rawUrl, productName, currentHost);
      chrome.runtime.sendMessage({ action: "COMPARE_FROM_URL", searchUrl } as any);
    });
  });
}

// ── Message Handling ────────────────────────────────────────────────────────

// ── Compare Button (search results page — opens NirnAI website) ─────────────

const COMPARE_BTN_ID = "nirnai-compare-btn";
const CROSS_SITE_BTN_ID = "nirnai-crosssite-btn";
const CROSS_SITE_OVERLAY_ID = "nirnai-crosssite-overlay";
let compareInProgress = false;

/**
 * Show a fullscreen NirnAI overlay while cross-site collection runs in background.
 * Progressive design: shows which source tiers are active, completed, or pending.
 */
function showCrossSiteOverlay(): void {
  document.getElementById(CROSS_SITE_OVERLAY_ID)?.remove();
  const overlay = document.createElement("div");
  overlay.id = CROSS_SITE_OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(6,8,15,0.95); color: #f1f5f9;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    backdrop-filter: blur(8px);
  `;
  overlay.innerHTML = `
    <style>
      @keyframes nirnai-spin { to { transform: rotate(360deg); } }
      @keyframes nirnai-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      .nirnai-source-pill {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;
        transition: all 0.3s ease;
      }
      .nirnai-source-pending { background: #1e293b; color: #64748b; }
      .nirnai-source-active { background: #1e1b4b; color: #818cf8; border: 1px solid #4338ca; }
      .nirnai-source-done { background: #052e16; color: #4ade80; }
      .nirnai-source-skipped { background: #1c1917; color: #78716c; text-decoration: line-through; opacity: 0.6; }
    </style>
    <div style="font-size:32px;">🛡️</div>
    <div style="font-size:22px;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NirnAI</div>
    <div style="width:40px;height:40px;border:3px solid #1e293b;border-top-color:#818cf8;border-radius:50%;animation:nirnai-spin 0.7s linear infinite;margin:8px 0;" id="nirnai-cs-spinner"></div>
    <div id="nirnai-cs-status" style="color:#e2e8f0;font-size:16px;font-weight:600;">Finding the best options across travel sites...</div>
    <div id="nirnai-cs-detail" style="color:#94a3b8;font-size:13px;max-width:440px;text-align:center;line-height:1.5;">Searching core sources first, then expanding if needed.</div>
    <div id="nirnai-cs-sources" style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:450px;"></div>
    <div id="nirnai-cs-stats" style="margin-top:8px;font-size:12px;color:#64748b;"></div>
    <div style="margin-top:20px;font-size:11px;color:#475569;">Searching all sites — typically 20-30 seconds</div>
  `;
  document.body.appendChild(overlay);
}

/** Update the cross-site overlay with progressive source-aware feedback */
function updateCrossSiteOverlay(
  phase: string,
  detail: string,
  totalSites?: number,
  sitesCollected?: number,
  totalListings?: number,
  extra?: Record<string, any>,
): void {
  const statusEl = document.getElementById("nirnai-cs-status");
  const detailEl = document.getElementById("nirnai-cs-detail");
  const sourcesEl = document.getElementById("nirnai-cs-sources");
  const statsEl = document.getElementById("nirnai-cs-stats");

  if (phase === "collecting") {
    const sourcesReported: string[] = extra?.sourcesReported ?? [];
    const coreSources: string[] = extra?.coreSources ?? [];
    const expanderSources: string[] = extra?.expanderSources ?? [];
    const enricherSources: string[] = extra?.enricherSources ?? [];
    const skippedSite: string | undefined = extra?.skippedSite;
    const tier: number | undefined = extra?.tier;

    // Update status text based on what we know
    if (statusEl) {
      if (sourcesReported.length === 0) {
        statusEl.textContent = "Searching core travel sites...";
      } else if (sourcesReported.length >= 2) {
        statusEl.textContent = `Best results from ${sourcesReported.join(", ")}`;
      } else {
        statusEl.textContent = `Found listings from ${sourcesReported.join(", ")}`;
      }
    }

    if (detailEl) {
      if (totalListings && totalListings > 0) {
        const remaining = (totalSites ?? 0) - (sitesCollected ?? 0);
        detailEl.textContent = remaining > 0
          ? `${totalListings} listings collected. Checking ${remaining} more site${remaining > 1 ? "s" : ""}...`
          : `${totalListings} listings collected. Preparing to rank...`;
      } else if (detail) {
        detailEl.textContent = detail;
      }
    }

    // Build source pills if we have source info
    if (sourcesEl && (coreSources.length > 0 || sourcesReported.length > 0)) {
      // Build a pill for each known source
      const allSources = [...new Set([...coreSources, ...expanderSources, ...enricherSources])];
      if (allSources.length > 0) {
        sourcesEl.innerHTML = allSources.map(site => {
          const isDone = sourcesReported.includes(site);
          const isSkipped = site === skippedSite;
          const cls = isSkipped ? "nirnai-source-skipped"
            : isDone ? "nirnai-source-done"
            : coreSources.includes(site) ? "nirnai-source-active"
            : "nirnai-source-pending";
          const icon = isSkipped ? "✕" : isDone ? "✓" : coreSources.includes(site) ? "◯" : "·";
          return `<span class="nirnai-source-pill ${cls}">${icon} ${site}</span>`;
        }).join("");
      }
    }

    // Stats line
    if (statsEl && totalListings && totalListings > 0) {
      statsEl.textContent = `${totalListings} listings from ${sitesCollected ?? 0} sources`;
    }

  } else if (phase === "ranking" && statusEl) {
    statusEl.textContent = "Ranking all listings with AI...";
    if (detailEl) detailEl.textContent = detail || "Analyzing value, trust, and quality across all platforms.";
    // Hide spinner and replace with ranking indicator
    const spinner = document.getElementById("nirnai-cs-spinner");
    if (spinner) spinner.style.borderTopColor = "#4ade80";
    if (statsEl) {
      const sourcesReported: string[] = extra?.sourcesReported ?? [];
      const coreCount = extra?.coreSourceCount ?? 0;
      statsEl.textContent = `${coreCount} core + ${Math.max(0, sourcesReported.length - coreCount)} supporting sources`;
    }
  }
}

/** Remove the cross-site overlay */
function removeCrossSiteOverlay(): void {
  document.getElementById(CROSS_SITE_OVERLAY_ID)?.remove();
}

/**
 * Background collection mode for cross-site comparison.
 * The service worker opened this tab silently — extract listings and send back FAST.
 *
 * CRITICAL: This must complete well within the per-site timeout budget (6-8s).
 * Unlike the user-facing collectListings() which scrolls for comprehensive results,
 * this does a single-pass extraction of whatever is already rendered.
 * Even 3-5 listings from a reliable source is enough for ranking.
 */
async function crossSiteCollect(ext: SiteExtractor): Promise<void> {
  const site = window.location.hostname.replace(/^www\./, "");
  console.log(`NirnAI [collect] START on ${site} — ${window.location.href}`);

  // Poll for search page readiness: wait until extractable DOM elements appear
  // or we hit a time limit. Budget: 18s to handle heavy SPAs (Booking, Expedia)
  // that render slowly in off-screen windows.
  const pollStart = Date.now();
  const POLL_LIMIT_MS = 18_000;
  const POLL_INTERVAL_MS = 1000;

  let hasListings = false;
  let pollCount = 0;
  let isSearchDetected = false;
  while (Date.now() - pollStart < POLL_LIMIT_MS) {
    pollCount++;
    // Try a quick extraction — if we get any listings, DOM is ready
    const quick = ext.extractSearchListings?.(20) || [];
    if (quick.length > 0) {
      hasListings = true;
      console.log(`NirnAI [collect] ${site}: found ${quick.length} listings after ${pollCount} polls (${Date.now() - pollStart}ms)`);
      break;
    }
    // Also check isSearchPage as a signal the page loaded
    const isSearch = ext.isSearchPage?.();
    if (isSearch && !isSearchDetected) {
      isSearchDetected = true;
      console.log(`NirnAI [collect] ${site}: isSearchPage=true after ${pollCount} polls (${Date.now() - pollStart}ms), waiting for cards…`);
      // Page structure loaded but no listings yet — give SPA time to render cards
      // Don't break — keep polling for actual listing cards
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // If we haven't found listings yet, give one more generous wait for SPAs
  if (!hasListings) {
    console.log(`NirnAI [collect] ${site}: no listings yet after poll phase (${Date.now() - pollStart}ms), isSearchPage=${isSearchDetected}, final wait…`);
    await new Promise(r => setTimeout(r, 3000));
  }

  try {
    // Single-pass extraction — NO scrolling, NO geo filtering, NO slow processing
    // Just grab what's on the page right now
    const listings = ext.extractSearchListings?.(20) || [];
    console.log(`NirnAI [collect] ${site}: FINAL extraction → ${listings.length} listings (total ${Date.now() - pollStart}ms)`);
    if (listings.length > 0) {
      console.log(`NirnAI [collect] ${site}: sample listing →`, JSON.stringify({ title: listings[0].title, price: listings[0].price, rating: listings[0].rating }));
    } else {
      // Log DOM debug info to help fix extractors
      console.log(`NirnAI [collect] ${site}: DEBUG — URL=${window.location.href}, links with /hotel/=${document.querySelectorAll('a[href*="/hotel/"]').length}, links with Hotel=${document.querySelectorAll('a[href*="Hotel"]').length}, total <a>=${document.querySelectorAll('a').length}, total <li>=${document.querySelectorAll('li').length}`);
    }

    // Apply geo context (fast — just reads navigator.language)
    const geo = detectGeoContext();
    const enriched = listings.map(l => applyGeoContext(l, geo));

    chrome.runtime.sendMessage({
      action: "CROSS_SITE_LISTINGS",
      listings: enriched,
    });
    console.log(`NirnAI [collect] ${site}: sent ${enriched.length} listings to service worker`);
  } catch (err) {
    console.error(`NirnAI [collect] ${site}: extraction FAILED`, err);
    chrome.runtime.sendMessage({
      action: "CROSS_SITE_LISTINGS",
      listings: [],
    });
  }
}

/**
 * Auto-extract listings from the current search page and immediately launch
 * the NirnAI compare page.  Called when the page was opened via a "Better
 * Alternative" suggestion link (detected by #nirnai_autorank hash flag).
 *
 * Uses the universal collectListings() pipeline — works across all adapters
 * (travel: geo-aware radius; shopping: density-aware collection).
 */
async function autoRankListings(ext: SiteExtractor): Promise<void> {
  if (compareInProgress) return;
  compareInProgress = true;

  // Show a full-screen NirnAI loading overlay
  const overlay = document.createElement("div");
  overlay.id = "nirnai-autorank-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: #06080f; color: #f1f5f9;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  `;
  overlay.innerHTML = `
    <style>@keyframes nirnai-spin { to { transform: rotate(360deg); } }</style>
    <div style="font-size:26px;">🛡️</div>
    <div style="font-size:18px;font-weight:800;background:linear-gradient(135deg,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NirnAI</div>
    <div style="width:36px;height:36px;border:3px solid #1e293b;border-top-color:#818cf8;border-radius:50%;animation:nirnai-spin 0.7s linear infinite;"></div>
    <div id="nirnai-scan-status" style="color:#94a3b8;font-size:14px;font-weight:500;">Scanning for best options...</div>
    <div id="nirnai-scan-detail" style="color:#475569;font-size:12px;">Collecting and analyzing listings.</div>
  `;
  document.body.appendChild(overlay);

  // Give the search page DOM time to render initial results
  await new Promise(r => setTimeout(r, 2000));

  const statusEl = overlay.querySelector("#nirnai-scan-status");
  const detailEl = overlay.querySelector("#nirnai-scan-detail");

  try {
    const { listings, profile, searchContext } = await collectListings(ext, (count, label) => {
      if (statusEl) statusEl.textContent = `Found ${count} listings in ${label}...`;
      if (detailEl) detailEl.textContent = `Scanning ${label}.`;
    });

    if (listings.length < 2) {
      overlay.remove();
      compareInProgress = false;
      showCompareButton(ext);
      return;
    }

    if (statusEl) statusEl.textContent = `Analyzing ${listings.length} listings...`;

    const res = await fetch(`${API_BASE_URL}/compare/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listings, search_context: searchContext }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const result = await res.json();
    const compareUrl = result.url.startsWith("http") ? result.url : `${API_BASE_URL}${result.url}`;
    window.location.href = compareUrl;
  } catch (err) {
    console.error("NirnAI: auto-rank failed", err);
    overlay.remove();
    compareInProgress = false;
    showCompareButton(ext);
  }
}

function showCompareButton(ext: SiteExtractor): void {
  // Don't duplicate the button
  if (document.getElementById(COMPARE_BTN_ID)) return;

  const btn = document.createElement("div");
  btn.id = COMPARE_BTN_ID;
  btn.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    display: flex; align-items: center; gap: 8px;
    padding: 12px 22px; border-radius: 12px;
    background: #6366f1; border: none; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    box-shadow: 0 8px 28px rgba(99,102,241,0.35);
    cursor: pointer; font-size: 13px; font-weight: 700;
    transition: transform 0.2s, box-shadow 0.2s;
    user-select: none;
  `;
  btn.innerHTML = `🏆 <span>Rank these listings</span>`;
  btn.title = "NirnAI — Compare and rank the top listings on this page";
  btn.addEventListener("mouseenter", () => { btn.style.transform = "translateY(-2px)"; btn.style.boxShadow = "0 12px 36px rgba(99,102,241,0.5)"; });
  btn.addEventListener("mouseleave", () => { btn.style.transform = "none"; btn.style.boxShadow = "0 8px 28px rgba(99,102,241,0.35)"; });

  btn.addEventListener("click", async () => {
    if (compareInProgress) return;
    compareInProgress = true;

    btn.innerHTML = `<div style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:nirnai-spin 0.7s linear infinite;"></div> <span>Scanning...</span>`;
    btn.style.cursor = "default";
    btn.style.opacity = "0.8";

    try {
      const { listings, profile, searchContext } = await collectListings(ext, (count, label) => {
        const span = btn.querySelector("span");
        if (span) span.textContent = `Found ${count} in ${label}...`;
      });

      if (listings.length < 2) {
        compareInProgress = false;
        btn.remove();
        showCompareButton(ext);
        return;
      }

      const span = btn.querySelector("span");
      if (span) span.textContent = `Analyzing ${listings.length} listings...`;

      const res = await fetch(`${API_BASE_URL}/compare/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listings, search_context: searchContext }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const result = await res.json();
      const compareUrl = result.url.startsWith("http") ? result.url : `${API_BASE_URL}${result.url}`;
      window.location.href = compareUrl;
    } catch (err) {
      console.error("NirnAI: compare start failed", err);
      compareInProgress = false;
      btn.remove();
      showCompareButton(ext);
    }
  });

  document.body.appendChild(btn);

  // ── Cross-Site Button (travel + shopping sites) ──
  const TRAVEL_SITES = ["airbnb", "booking", "expedia", "vrbo", "agoda", "hotels", "tripadvisor", "googletravel"];
  const SHOPPING_SITES = ["amazon", "walmart", "target", "costco", "bestbuy", "homedepot", "lowes", "ebay", "wayfair", "macys", "nordstrom", "cvs", "walgreens", "nike", "apple", "samsung", "dyson"];
  const siteName = ext.siteName();
  const allCrossSites = [...TRAVEL_SITES, ...SHOPPING_SITES];
  if (allCrossSites.includes(siteName) && ext.getSearchParams) {
    if (document.getElementById(CROSS_SITE_BTN_ID)) return;

    const isTravelSite = TRAVEL_SITES.includes(siteName);
    const otherSitesLabel = isTravelSite
      ? "Airbnb, Booking.com, Expedia, Vrbo & more"
      : "Amazon, Walmart, Target & more";

    const crossBtn = document.createElement("div");
    crossBtn.id = CROSS_SITE_BTN_ID;
    crossBtn.style.cssText = `
      position: fixed; bottom: 70px; right: 20px; z-index: 999999;
      display: flex; align-items: center; gap: 8px;
      padding: 10px 18px; border-radius: 12px;
      background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); color: #818cf8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      box-shadow: 0 6px 20px rgba(99,102,241,0.15);
      cursor: pointer; font-size: 12px; font-weight: 700;
      transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
      user-select: none;
      backdrop-filter: blur(8px);
    `;
    crossBtn.innerHTML = `\uD83C\uDF10 <span>Compare across sites</span>`;
    crossBtn.title = `NirnAI — Rank listings from ${otherSitesLabel} together`;
    crossBtn.addEventListener("mouseenter", () => { crossBtn.style.transform = "scale(1.05)"; crossBtn.style.boxShadow = "0 8px 32px rgba(139,92,246,0.4)"; });
    crossBtn.addEventListener("mouseleave", () => { crossBtn.style.transform = "scale(1)"; crossBtn.style.boxShadow = "0 6px 24px rgba(139,92,246,0.25)"; });

    crossBtn.addEventListener("click", async () => {
      if (compareInProgress) return;
      compareInProgress = true;

      crossBtn.innerHTML = `<div style="width:16px;height:16px;border:2px solid #334155;border-top-color:#8b5cf6;border-radius:50%;animation:nirnai-spin 0.8s linear infinite;"></div> <span>Collecting from this site...</span>`;
      crossBtn.style.cursor = "default";
      crossBtn.style.opacity = "0.7";

      try {
        const searchParams = ext.getSearchParams!();
        if (!searchParams) {
          compareInProgress = false;
          crossBtn.innerHTML = `\uD83C\uDF10 <span>Compare across sites</span>`;
          crossBtn.style.cursor = "pointer";
          crossBtn.style.opacity = "1";
          return;
        }

        // Enrich search params with geo context for regional URL routing
        const geo = detectGeoContext();
        searchParams.country_code = geo.country_code;
        searchParams.currency_code = geo.currency_code;

        // ── Extract precise geo coordinates & compute adaptive bounds ──
        try {
          const center = ext.getSearchCenter?.() || null;
          const bounds = ext.getMapBounds?.() || null;

          let cLat = center?.lat;
          let cLng = center?.lng;
          let neL = bounds?.ne.lat;
          let neN = bounds?.ne.lng;
          let swL = bounds?.sw.lat;
          let swN = bounds?.sw.lng;

          if (cLat == null && neL != null) {
            cLat = (neL + swL!) / 2;
            cLng = (neN! + swN!) / 2;
          }

          const profile = classifySearch(siteName, searchParams.destination || "", 0,
            (neL != null && swL != null) ? { ne: { lat: neL, lng: neN! }, sw: { lat: swL, lng: swN! } } : undefined
          );
          searchParams.area_type = profile.areaType;
          searchParams.radius_miles = profile.radiusMiles;

          if (cLat != null && cLng != null) {
            searchParams.lat = cLat;
            searchParams.lng = cLng;
            if (neL == null) {
              const latD = profile.radiusMiles / 69;
              const lngD = profile.radiusMiles / (69 * Math.cos(cLat * Math.PI / 180));
              neL = cLat + latD; neN = cLng + lngD;
              swL = cLat - latD; swN = cLng - lngD;
            }
            searchParams.ne_lat = neL;
            searchParams.ne_lng = neN;
            searchParams.sw_lat = swL;
            searchParams.sw_lng = swN;
          }
        } catch { /* geo extraction is best-effort */ }

        // Collect current-site listings first
        const { listings, searchContext } = await collectListings(ext, (count, label) => {
          const span = crossBtn.querySelector("span");
          if (span) span.textContent = `Found ${count} on ${siteName}...`;
        });

        const span = crossBtn.querySelector("span");
        if (span) span.textContent = `Searching other platforms...`;

        // Show fullscreen overlay while cross-site collection happens in hidden window
        showCrossSiteOverlay();

        // Send to service worker for cross-site orchestration with geo bounds
        chrome.runtime.sendMessage({
          action: "CROSS_SITE_COMPARE",
          originSite: siteName,
          listings,
          searchParams,
          searchContext,
        });
      } catch (err) {
        console.error("NirnAI: cross-site compare failed", err);
        compareInProgress = false;
        crossBtn.innerHTML = `\uD83C\uDF10 <span>Compare across sites</span>`;
        crossBtn.style.cursor = "pointer";
        crossBtn.style.opacity = "1";
      }
    });

    document.body.appendChild(crossBtn);
  }
}

// ── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage & { analysis?: AnalysisResponse },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ProductData | null) => void
  ) => {
    if (message.action === "EXTRACT_PRODUCT_DATA") {
      if (extractor && extractor.isProductPage()) {
        sendResponse(extractor.extractProduct());
      } else {
        sendResponse(null);
      }
      return true;
    }

    if ((message as any).action === "ANALYSIS_RESULT" && (message as any).analysis) {
      // Handled by intent-based listener below — only show if panel already visible
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        showResultPanel((message as any).analysis);
      }
    }

    if ((message as any).action === "ANALYSIS_AI_UPDATE") {
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        injectAiSections(
          panel,
          (message as any).summary || "",
          (message as any).suggestion || null,
          (message as any).analysis || null,
        );
      }
    }

    // Cross-site comparison finished (failure case — success navigates directly)
    if ((message as any).action === "CROSS_SITE_DONE") {
      compareInProgress = false;

      const errorMsg = (message as any).error as string | undefined;
      if (errorMsg) {
        // Show error in the overlay instead of silently removing it
        const overlay = document.getElementById(CROSS_SITE_OVERLAY_ID);
        if (overlay) {
          const box = overlay.querySelector("div") as HTMLElement | null;
          if (box) {
            box.innerHTML = `
              <div style="text-align:center;padding:24px 20px;">
                <div style="font-size:28px;margin-bottom:12px;">⚠️</div>
                <div style="color:#fff;font-size:16px;font-weight:600;margin-bottom:8px;">Collection failed</div>
                <div style="color:#ccc;font-size:13px;line-height:1.5;max-width:340px;margin:0 auto 16px;">${errorMsg}</div>
                <button id="nirnai-dismiss-error" style="
                  background:#fff;color:#111;border:none;padding:8px 20px;
                  border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;
                ">Dismiss</button>
              </div>
            `;
            const dismissBtn = box.querySelector("#nirnai-dismiss-error");
            dismissBtn?.addEventListener("click", () => removeCrossSiteOverlay());
            // Auto-dismiss after 8 seconds
            setTimeout(() => removeCrossSiteOverlay(), 8000);
          } else {
            removeCrossSiteOverlay();
          }
        }
      } else {
        removeCrossSiteOverlay();
      }

      const crossBtn = document.getElementById(CROSS_SITE_BTN_ID);
      if (crossBtn) {
        crossBtn.innerHTML = `\uD83C\uDF10 <span>Compare across sites</span>`;
        crossBtn.style.cursor = "pointer";
        crossBtn.style.opacity = "1";
      }
      // Also reset the "Rank alternatives" button if it was the trigger
      const rankBtn = document.getElementById("nirnai-suggestion-rank");
      if (rankBtn) {
        rankBtn.textContent = "🏆 Rank alternatives";
        rankBtn.style.cursor = "pointer";
        rankBtn.style.opacity = "1";
      }
    }

    // Cross-site progress updates — update the fullscreen overlay
    if ((message as any).action === "CROSS_SITE_PROGRESS") {
      const msg = message as any;
      updateCrossSiteOverlay(
        msg.phase,
        msg.detail,
        msg.totalSites,
        msg.sitesCollected,
        msg.totalListings,
        {
          sourcesReported: msg.sourcesReported,
          coreSources: msg.coreSources,
          expanderSources: msg.expanderSources,
          enricherSources: msg.enricherSources,
          skippedSite: msg.skippedSite,
          tier: msg.tier,
          coreSourceCount: msg.coreSourceCount,
        },
      );
    }

    return false;
  }
);

// ── Intent-Based Auto-Analysis ──────────────────────────────────────────────
// Pre-analyze silently on page load, then reveal when user shows intent:
//   1. Scrolls to reviews section (IntersectionObserver)
//   2. Clicks "Add to Cart" / "Buy Now"
//   3. Stays on page longer than DWELL_THRESHOLD_MS

const DWELL_THRESHOLD_MS = 0; // Show immediately

let currentAnalysisUrl = ""; // Track which URL we last analyzed

/**
 * Fetch a product page (same-origin, with cookies) and extract key data.
 * This runs in the content script context so Amazon/Walmart/Target allow it.
 */
async function fetchAndParseProductPage(url: string): Promise<Partial<ProductData> | null> {
  try {
    const resp = await fetch(url, {
      credentials: "same-origin",
      headers: { "Accept": "text/html" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 1) Try JSON-LD structured data
    let jsonLd: any = null;
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || "");
        const items = parsed["@graph"] || (Array.isArray(parsed) ? parsed : [parsed]);
        for (const item of items) {
          if (item["@type"] === "Product" || item["@type"]?.includes?.("Product")) {
            jsonLd = item;
            break;
          }
        }
        if (jsonLd) break;
      } catch { /* skip bad JSON */ }
    }

    // 2) Extract from JSON-LD + DOM fallback
    const getText = (selectors: string[]): string => {
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
      }
      return "";
    };

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      getText(["#acrPopover .a-icon-alt", "span.a-icon-alt", '[itemprop="ratingValue"]']);

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      jsonLd?.aggregateRating?.ratingCount?.toString() ||
      getText(["#acrCustomerReviewText", '[itemprop="ratingCount"]']);

    const brand =
      jsonLd?.brand?.name || jsonLd?.brand ||
      getText(["#bylineInfo", "#brand", '[itemprop="brand"] [itemprop="name"]']);

    const seller = getText([
      "#sellerProfileTriggerId",
      "#merchant-info a",
      '#tabular-buybox .tabular-buybox-text a',
      '[data-testid="sold-shipped-by"] a',
    ]);

    const category = getText([
      "#wayfinding-breadcrumbs_feature_div ul li:last-child a",
      '[data-testid="breadcrumb"] a:last-child',
      'nav[aria-label="Breadcrumb"] a:last-child',
    ]);

    // Ingredients (food products)
    let ingredients = "";
    const importantInfo = doc.querySelector("#important-information");
    if (importantInfo) {
      const sections = importantInfo.querySelectorAll(".a-section");
      for (const sec of sections) {
        const text = sec.textContent?.trim() || "";
        if (text.toLowerCase().includes("ingredient")) {
          ingredients = text;
          break;
        }
      }
    }
    if (!ingredients) {
      // Walmart/Target pattern
      const headings = doc.querySelectorAll("h2, h3, h4, b, strong");
      for (const h of headings) {
        if (h.textContent?.toLowerCase().includes("ingredient")) {
          const next = h.nextElementSibling;
          if (next?.textContent?.trim()) { ingredients = next.textContent.trim(); break; }
        }
      }
    }

    // Nutrition info
    let nutritionInfo = "";
    const nutritionEl = doc.querySelector("#nutritionFactsLabelComponent, .nutrition-facts, [data-testid='nutrition-facts']");
    if (nutritionEl) nutritionInfo = nutritionEl.textContent?.trim() || "";

    // Only return if we actually found useful data
    if (!rating && !reviewCount && !brand && !seller) return null;

    return { rating, reviewCount, brand, seller, category, ingredients, nutritionInfo };
  } catch {
    return null;
  }
}

/**
 * Enrich sparse cart items by fetching each product page in parallel.
 */
interface EnrichedCartResult {
  products: ProductData[];
  /** URLs of items that still have limited data after enrichment */
  limitedDataUrls: Set<string>;
}

async function enrichCartProducts(products: ProductData[]): Promise<EnrichedCartResult> {
  const limitedDataUrls = new Set<string>();

  const enriched = await Promise.all(
    products.map(async (product) => {
      // Already has rating data — fully enriched
      if (product.rating || !product.url || product.url === window.location.href) {
        return product;
      }

      const extra = await fetchAndParseProductPage(product.url);
      const merged = extra ? {
        ...product,
        rating: extra.rating || product.rating,
        reviewCount: extra.reviewCount || product.reviewCount,
        brand: extra.brand || product.brand,
        seller: extra.seller || product.seller,
        category: extra.category || product.category,
        ingredients: extra.ingredients || product.ingredients,
        nutritionInfo: extra.nutritionInfo || product.nutritionInfo,
      } : product;

      // Still no rating after enrichment → limited data
      if (!merged.rating) {
        limitedDataUrls.add(product.url);
      }

      return merged;
    })
  );
  return { products: enriched, limitedDataUrls };
}

async function runAnalysis(): Promise<void> {
  const ext = detectSiteExtractor(EXTRACTORS);
  if (!ext) return;

  // ── Cross-site background collection mode (must be checked FIRST) ──
  // The service worker opened this tab silently with #nirnai_collect to gather listings.
  // We check this BEFORE isSearchPage() because some extractors require DOM elements
  // that may not exist yet (SPAs in hidden/minimized windows render lazily).
  // The crossSiteCollect function has its own DOM wait.
  if (window.location.hash.includes("nirnai_collect") && ext.extractSearchListings) {
    history.replaceState(null, "", window.location.href.replace(/[#&]nirnai_collect/g, ""));
    crossSiteCollect(ext);
    return;
  }

  // ─── Search Results Page (Phase 0 comparison) ─────────────────────
  // Show a small floating button instead of auto-analyzing.
  // Airbnb changes URL params constantly (filters, map, etc.) — auto-trigger is too noisy.
  if (ext.isSearchPage?.() && ext.extractSearchListings) {
    // Remember the search URL + filters so "Rank alternatives" from product
    // pages can reuse them (guests, dates, price range, superhost, etc.)
    try { sessionStorage.setItem("nirnai_last_search", window.location.href); } catch {}

    // If we arrived here via a "Better Alternative" suggestion link,
    // auto-extract and launch the NirnAI compare page immediately.
    if (window.location.hash.includes("nirnai_autorank")) {
      // Clean up the hash flag so refreshes don't re-trigger
      history.replaceState(null, "", window.location.href.replace(/#.*nirnai_autorank/, ""));
      autoRankListings(ext);
      return;
    }
    showCompareButton(ext);
    return;
  }

  if (ext.isProductPage()) {
    const url = window.location.href;
    // Don't re-analyze the same URL
    if (url === currentAnalysisUrl) return;
    currentAnalysisUrl = url;

    // Clear any existing panels from previous page
    removePanel();

    let cachedAnalysis: AnalysisResponse | null = null;
    let panelShown = false;

    const data = applyGeoContext(ext.extractProduct());

    // Fire analysis in background
    function sendForAnalysis(productData: ProductData): void {
      chrome.runtime.sendMessage(
        { action: "ANALYZE_PRODUCT", data: productData } as ExtensionMessage,
        (analysis: AnalysisResponse | null) => {
          if (analysis) {
            cachedAnalysis = analysis;
            if (panelShown && document.getElementById(PANEL_ID)) {
              showResultPanel(analysis);
            }
          }
        }
      );
    }
    sendForAnalysis(data);

    // ── Price retry: Airbnb/Booking render price widgets asynchronously ──
    // If initial extraction has no price, poll until it appears, then re-analyze.
    if (!data.price && ext.isProductPage()) {
      let priceRetries = 0;
      const maxPriceRetries = 8;
      const priceRetryInterval = 1500; // 1.5s between retries (up to 12s total)
      const pricePoller = setInterval(() => {
        priceRetries++;
        const freshData = applyGeoContext(ext.extractProduct());
        if (freshData.price) {
          clearInterval(pricePoller);
          console.log(`NirnAI: Price found on retry #${priceRetries}: ${freshData.price}`);
          sendForAnalysis(freshData);
        } else if (priceRetries >= maxPriceRetries) {
          clearInterval(pricePoller);
          console.log("NirnAI: Price not found after retries — keeping original analysis");
        }
      }, priceRetryInterval);
    }

    function revealAnalysis(): void {
      if (panelShown) return;
      panelShown = true;
      cleanupIntentListeners();

      if (cachedAnalysis) {
        showResultPanel(cachedAnalysis);
      } else {
        showLoadingPanel();
        // Auto-dismiss loading panel after 25s if no result arrives
        setTimeout(() => {
          if (!cachedAnalysis && document.getElementById(PANEL_ID)) {
            const panel = document.getElementById(PANEL_ID);
            if (panel) {
              const inner = panel.querySelector("div:last-child") as HTMLElement;
              if (inner) {
                inner.innerHTML = `
                  <p style="margin:14px 0 4px;font-size:13px;font-weight:600;color:#f87171;">Analysis timed out</p>
                  <p style="font-size:11px;color:#94a3b8;margin-top:4px;">Try refreshing the page.</p>
                `;
              }
            }
          }
        }, 25_000);
      }
    }

    // ─── Signal 1: Scroll to reviews ────────────────────────────────
    const REVIEW_SELECTORS = [
      "#customer-reviews",           // Amazon main reviews section
      "#reviews-medley-footer",      // Amazon "See all reviews" link area
      "#cr-dp-review-sort-type",     // Amazon review sort bar
      '[data-hook="review-section"]', // Amazon review hook
      '[data-testid="reviews"]',     // Walmart reviews
      '[data-test="ratings-and-reviews"]', // Target reviews
    ];

    let reviewObserver: IntersectionObserver | null = null;

    function setupReviewObserver(): void {
      for (const sel of REVIEW_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) {
          reviewObserver = new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) {
                revealAnalysis();
              }
            },
            { threshold: 0.1 }
          );
          reviewObserver.observe(el);
          return;
        }
      }
    }

    setupReviewObserver();
    const retryReviewTimer = setTimeout(setupReviewObserver, 3000);

    // ─── Signal 2: Add to Cart / Buy Now click ──────────────────────
    const CART_BUTTON_SELECTORS = [
      "#add-to-cart-button",         // Amazon
      "#buy-now-button",             // Amazon
      '[name="submit.add-to-cart"]', // Amazon
      "#submitOrderButtonId",        // Amazon
      '[data-testid="add-to-cart"]', // Walmart
      'button[data-tl-id="ProductPrimaryCTA-add_to_cart"]', // Walmart
      '[data-test="shipItButton"]',  // Target
      '[data-test="addToCartButton"]', // Target
      'button[id="addToCartButtonOrTextIdFor"]', // Target
    ];

    function onCartButtonClick(e: Event): void {
      revealAnalysis();
    }

    const cartButtons: Element[] = [];
    for (const sel of CART_BUTTON_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.addEventListener("click", onCartButtonClick, { once: true });
        cartButtons.push(btn);
      }
    }

    // ─── Signal 3: Time on page (dwell) ─────────────────────────────
    const dwellTimer = setTimeout(revealAnalysis, DWELL_THRESHOLD_MS);

    // ─── Cleanup helper ─────────────────────────────────────────────
    function cleanupIntentListeners(): void {
      clearTimeout(dwellTimer);
      clearTimeout(retryReviewTimer);
      reviewObserver?.disconnect();
      for (const btn of cartButtons) {
        btn.removeEventListener("click", onCartButtonClick);
      }
    }

    // Listen for ANALYSIS_RESULT from service worker
    chrome.runtime.onMessage.addListener(
      (msg: any) => {
        if (msg.action === "ANALYSIS_RESULT" && msg.analysis && panelShown && !cachedAnalysis) {
          cachedAnalysis = msg.analysis;
          showResultPanel(msg.analysis);
        }
        if (msg.action === "ANALYSIS_AI_UPDATE") {
          // Update cached analysis with AI data
          if (cachedAnalysis) {
            cachedAnalysis = { ...cachedAnalysis, summary: msg.summary || "", suggestion: msg.suggestion || null };
          }
          const panel = document.getElementById(PANEL_ID);
          if (panel) {
            injectAiSections(panel, msg.summary || "", msg.suggestion || null, msg.analysis || null);
          }
        }
      }
    );

  } else if (ext.isCartPage()) {
    const cartProducts = ext.extractCartProducts().map(p => applyGeoContext(p));
    if (cartProducts.length > 0) {
      showCartLoadingPanel(cartProducts.length);

      // Enrich cart items by fetching product pages (same-origin, has cookies)
      const { products: enrichedProducts, limitedDataUrls } = await enrichCartProducts(cartProducts);

      chrome.runtime.sendMessage(
        { action: "ANALYZE_CART", products: enrichedProducts },
        (cartResponse: CartAnalysisResponse | null) => {
          if (cartResponse && cartResponse.items.length > 0) {
            showCartResultPanel(cartResponse, limitedDataUrls);
          } else {
            document.getElementById(CART_PANEL_ID)?.remove();
          }
        }
      );
    }
  }
}

// ── SPA Navigation Detection ────────────────────────────────────────────────
// Walmart and Target use client-side routing — URL changes without full reload.
// Detect navigation and re-run analysis.

let lastUrl = window.location.href;

/**
 * Normalize URL for navigation comparison.
 * For Airbnb search pages, strip query params so filter/map changes don't
 * trigger re-analysis. For product pages, keep the full URL.
 */
function normalizeForNavCheck(url: string): string {
  try {
    const u = new URL(url);
    // Airbnb search pages: only compare pathname
    if (u.hostname.includes("airbnb") && /\/s\//.test(u.pathname)) {
      return u.origin + u.pathname;
    }
    return url;
  } catch {
    return url;
  }
}

function checkForNavigation(): void {
  const currentUrl = window.location.href;
  if (normalizeForNavCheck(currentUrl) !== normalizeForNavCheck(lastUrl)) {
    lastUrl = currentUrl;
    // Small delay to let the SPA render the new page content
    setTimeout(runAnalysis, 1000);
  }
}

// Poll for URL changes (most reliable across all SPA frameworks)
setInterval(checkForNavigation, 500);

// Also listen for popstate (back/forward navigation)
window.addEventListener("popstate", () => {
  setTimeout(runAnalysis, 1000);
});

// Run on initial page load
runAnalysis();
