// Service Worker (Background Script)
// Handles API communication, caching, badge updates, and forwards results to content script

import {
  ProductData,
  AnalysisResponse,
  AiEnhancement,
  CartAnalysisResponse,
  BatchResponse,
  DecisionStamp,
  ExtensionMessage,
  CrossSiteSearchParams,
  API_BASE_URL,
} from "../types.js";

// Cache analysis results to reduce API calls
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  data: AnalysisResponse;
  timestamp: number;
}

interface ProductCacheEntry {
  data: ProductData;
  timestamp: number;
}

/**
 * Normalize product URLs to a canonical form so the same product
 * is recognized across different page types (product page vs cart link).
 * Amazon: /gp/product/ASIN and /dp/ASIN → /dp/ASIN
 * Walmart: /ip/slug/ID → /ip/ID
 * Target: /p/slug/-/A-ID → /p/-/A-ID
 */
function normalizeProductUrl(url: string): string {
  try {
    const u = new URL(url);
    // Amazon: extract ASIN from /dp/ASIN or /gp/product/ASIN
    const asinMatch = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch && u.hostname.includes("amazon")) {
      return `https://${u.hostname}/dp/${asinMatch[1]}`;
    }
    // Walmart: extract product ID from /ip/slug/ID or /ip/ID
    const walmartMatch = u.pathname.match(/\/ip\/(?:.*\/)?(\d+)/);
    if (walmartMatch && u.hostname.includes("walmart")) {
      return `https://www.walmart.com/ip/${walmartMatch[1]}`;
    }
    // Target: extract A-number
    const targetMatch = u.pathname.match(/(A-\d+)/);
    if (targetMatch && u.hostname.includes("target")) {
      return `https://www.target.com/p/-/${targetMatch[1]}`;
    }
    return url;
  } catch {
    return url;
  }
}

async function getCachedAnalysis(
  url: string
): Promise<AnalysisResponse | null> {
  const key = normalizeProductUrl(url);
  const result = await chrome.storage.local.get(key);
  const entry = result[key] as CacheEntry | undefined;
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

async function setCachedAnalysis(
  url: string,
  data: AnalysisResponse
): Promise<void> {
  const key = normalizeProductUrl(url);
  const entry: CacheEntry = { data, timestamp: Date.now() };
  await chrome.storage.local.set({ [key]: entry });
}

// Cache full product data so cart items can be enriched with product-page-quality data
async function getCachedProductData(
  url: string
): Promise<ProductData | null> {
  const key = `pd:${normalizeProductUrl(url)}`;
  const result = await chrome.storage.local.get(key);
  const entry = result[key] as ProductCacheEntry | undefined;
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

async function setCachedProductData(
  url: string,
  data: ProductData
): Promise<void> {
  const key = `pd:${normalizeProductUrl(url)}`;
  const entry: ProductCacheEntry = { data, timestamp: Date.now() };
  await chrome.storage.local.set({ [key]: entry });
}

async function analyzeProduct(
  productData: ProductData,
  senderTabId?: number
): Promise<AnalysisResponse> {
  // Cache the full product data for cart enrichment
  if (productData.url && productData.page_type === "product") {
    await setCachedProductData(productData.url, productData);
  }

  // Check cache first
  const cached = await getCachedAnalysis(productData.url);
  if (cached) {
    // Still send to content script for badge
    notifyContentScript(cached, senderTabId);
    return cached;
  }

  // ── Phase 1: Fast scoring (rule-based, <500ms) ──
  const fastController = new AbortController();
  const fastTimeout = setTimeout(() => fastController.abort(), 10_000);

  let fastAnalysis: AnalysisResponse;
  try {
    const fastResponse = await fetch(`${API_BASE_URL}/analyze/fast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productData),
      signal: fastController.signal,
    });
    clearTimeout(fastTimeout);

    if (!fastResponse.ok) throw new Error(`Fast API error: ${fastResponse.status}`);
    fastAnalysis = await fastResponse.json();
  } catch {
    clearTimeout(fastTimeout);
    // Fall back to original /analyze endpoint if /analyze/fast fails
    return analyzeProductLegacy(productData, senderTabId);
  }

  // Show scores immediately
  updateBadge(fastAnalysis.stamp);
  notifyContentScript(fastAnalysis, senderTabId);

  // ── Phase 2: AI enhancement (background, ~10-15s) ──
  fetchAiEnhancement(productData, fastAnalysis, senderTabId);

  return fastAnalysis;
}

/** Background AI fetch — merges summary + suggestion into the cached result. */
async function fetchAiEnhancement(
  productData: ProductData,
  baseAnalysis: AnalysisResponse,
  senderTabId?: number
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const response = await fetch(`${API_BASE_URL}/analyze/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productData),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return;

    const ai: AiEnhancement = await response.json();

    // Merge AI data into analysis
    const enhanced: AnalysisResponse = {
      ...baseAnalysis,
      summary: ai.summary || baseAnalysis.summary,
      suggestion: ai.suggestion ?? baseAnalysis.suggestion,
    };

    // Update cache with full result
    await setCachedAnalysis(productData.url, enhanced);

    // Push AI update to content script
    const targetTabId =
      senderTabId ??
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        action: "ANALYSIS_AI_UPDATE",
        summary: ai.summary,
        suggestion: ai.suggestion,
        analysis: enhanced,
      });
    }
  } catch {
    // AI enhancement failed silently — user already has scores
  }
}

/** Legacy fallback — single /analyze call (used if /analyze/fast fails). */
async function analyzeProductLegacy(
  productData: ProductData,
  senderTabId?: number
): Promise<AnalysisResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productData),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const analysis: AnalysisResponse = await response.json();

  await setCachedAnalysis(productData.url, analysis);
  updateBadge(analysis.stamp);
  notifyContentScript(analysis, senderTabId);

  return analysis;
}

function updateBadge(stamp: DecisionStamp): void {
  const colorMap: Record<string, string> = {
    SMART_BUY: "#22c55e",
    CHECK: "#f59e0b",
    AVOID: "#ef4444",
  };

  const textMap: Record<string, string> = {
    SMART_BUY: "BUY",
    CHECK: "MEH",
    AVOID: "NO!",
  };

  chrome.action.setBadgeBackgroundColor({
    color: colorMap[stamp.stamp] || "#6366f1",
  });
  chrome.action.setBadgeText({
    text: textMap[stamp.stamp] || "",
  });
}

async function notifyContentScript(
  analysis: AnalysisResponse,
  tabId?: number
): Promise<void> {
  try {
    const targetTabId =
      tabId ??
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        action: "ANALYSIS_RESULT",
        analysis,
      });
    }
  } catch {
    // Content script may not be ready yet
  }
}

async function analyzeCart(
  products: ProductData[]
): Promise<CartAnalysisResponse> {
  // Enrich with cached product data (content script handles same-origin fetch for uncached)
  const enriched: ProductData[] = await Promise.all(
    products.map(async (product) => {
      if (product.url && !product.rating) {
        const cached = await getCachedProductData(product.url);
        if (cached) {
          return {
            ...cached,
            price: product.price || cached.price,
            imageUrl: product.imageUrl || cached.imageUrl,
            url: product.url,
            page_type: "cart" as const,
          };
        }
      }
      return product;
    })
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/analyze-cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

async function startCompare(
  listings: ProductData[],
  searchContext: string
): Promise<{ id: string; url: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/compare/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listings, search_context: searchContext }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`/compare/start returned ${response.status}: ${body}`);
  }

  return await response.json();
}

// ── Cross-Site Comparison Orchestration ──────────────────────────────────────

const TRAVEL_SITES = ["airbnb", "booking", "expedia", "hotels", "vrbo", "agoda", "tripadvisor", "googletravel"];
const SHOPPING_SITES = ["amazon", "walmart", "target", "costco", "bestbuy", "homedepot", "lowes", "ebay", "wayfair", "macys", "nordstrom", "cvs", "walgreens", "nike", "apple", "samsung", "dyson"];

// Mapping of site name → function that builds search URL from common params.
// These mirror the registerSearchUrlBuilder calls in the content extractors,
// but duplicated here because the service worker cannot import content modules.
function buildCrossSiteUrl(site: string, params: CrossSiteSearchParams): string {
  const hasGeo = params.lat != null && params.lng != null;
  const hasBounds = params.ne_lat != null && params.sw_lat != null;

  switch (site) {
    case "airbnb": {
      const slug = params.destination.replace(/,\s*/g, "--").replace(/\s+/g, "-");
      const path = slug
        ? `https://www.airbnb.com/s/${encodeURIComponent(slug)}/homes`
        : "https://www.airbnb.com/s/homes";
      const sp = new URLSearchParams();
      if (params.checkin) sp.set("checkin", params.checkin);
      if (params.checkout) sp.set("checkout", params.checkout);
      if (params.adults) sp.set("adults", params.adults);
      if (params.children) sp.set("children", params.children);
      // Airbnb supports bounding box for precise geo search
      if (hasBounds) {
        sp.set("ne_lat", String(params.ne_lat));
        sp.set("ne_lng", String(params.ne_lng));
        sp.set("sw_lat", String(params.sw_lat));
        sp.set("sw_lng", String(params.sw_lng));
        sp.set("search_by_map", "true");
      }
      return `${path}?${sp.toString()}`;
    }
    case "booking": {
      const sp = new URLSearchParams();
      if (params.destination) sp.set("ss", params.destination);
      if (params.checkin) sp.set("checkin", params.checkin);
      if (params.checkout) sp.set("checkout", params.checkout);
      if (params.adults) sp.set("group_adults", params.adults);
      if (params.children) sp.set("group_children", params.children);
      sp.set("no_rooms", params.rooms || "1");
      // Booking.com supports lat/lng center for proximity search
      if (hasGeo) {
        sp.set("latitude", String(params.lat));
        sp.set("longitude", String(params.lng));
      }
      return `https://www.booking.com/searchresults.html?${sp.toString()}`;
    }
    case "expedia": {
      const sp = new URLSearchParams();
      if (params.destination) sp.set("destination", params.destination);
      if (params.checkin) sp.set("startDate", params.checkin);
      if (params.checkout) sp.set("endDate", params.checkout);
      if (params.adults) sp.set("adults", params.adults);
      if (params.children) sp.set("children", params.children);
      // Expedia supports latLong for proximity search
      if (hasGeo) {
        sp.set("latLong", `${params.lat},${params.lng}`);
      }
      return `https://www.expedia.com/Hotel-Search?${sp.toString()}`;
    }
    case "vrbo": {
      const sp = new URLSearchParams();
      if (params.destination) sp.set("destination", params.destination);
      if (params.checkin) sp.set("startDate", params.checkin);
      if (params.checkout) sp.set("endDate", params.checkout);
      if (params.adults) sp.set("adults", params.adults);
      if (params.children) sp.set("children", params.children);
      // VRBO supports lat/long for proximity
      if (hasGeo) {
        sp.set("lat", String(params.lat));
        sp.set("long", String(params.lng));
      }
      return `https://www.vrbo.com/search?${sp.toString()}`;
    }
    case "agoda": {
      const sp = new URLSearchParams();
      if (params.destination) sp.set("textToSearch", params.destination);
      if (params.checkin) sp.set("checkIn", params.checkin);
      if (params.checkout) sp.set("checkOut", params.checkout);
      if (params.adults) sp.set("adults", params.adults);
      if (params.children) sp.set("children", params.children);
      sp.set("rooms", params.rooms || "1");
      // Agoda supports lat/lng
      if (hasGeo) {
        sp.set("lat", String(params.lat));
        sp.set("lng", String(params.lng));
      }
      return `https://www.agoda.com/search?${sp.toString()}`;
    }
    case "hotels": {
      const sp = new URLSearchParams();
      if (params.destination) sp.set("q-destination", params.destination);
      if (params.checkin) sp.set("q-check-in", params.checkin);
      if (params.checkout) sp.set("q-check-out", params.checkout);
      if (params.adults) sp.set("q-room-0-adults", params.adults);
      if (params.children) sp.set("q-room-0-children", params.children);
      sp.set("q-rooms", params.rooms || "1");
      // Hotels.com supports latitude/longitude
      if (hasGeo) {
        sp.set("latitude", String(params.lat));
        sp.set("longitude", String(params.lng));
      }
      return `https://www.hotels.com/Hotel-Search?${sp.toString()}`;
    }
    case "tripadvisor": {
      const sp = new URLSearchParams();
      if (params.checkin) sp.set("checkin", params.checkin);
      if (params.checkout) sp.set("checkout", params.checkout);
      if (params.adults) sp.set("adults", params.adults);
      if (params.rooms) sp.set("rooms", params.rooms);
      // TripAdvisor supports geo= param
      if (hasGeo) {
        sp.set("geo", `${params.lat},${params.lng}`);
      }
      return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(params.destination || "")}&${sp.toString()}`;
    }
    case "googletravel": {
      let url = `https://www.google.com/travel/hotels/${encodeURIComponent(params.destination || "")}`;
      // Google Travel supports @lat,lng in hash
      if (hasGeo) {
        url += `#@${params.lat},${params.lng}`;
      }
      return url;
    }
    // Shopping sites
    case "amazon": {
      if (!params.query) return "";
      return `https://www.amazon.com/s?k=${encodeURIComponent(params.query)}`;
    }
    case "walmart": {
      if (!params.query) return "";
      return `https://www.walmart.com/search?q=${encodeURIComponent(params.query)}`;
    }
    case "target": {
      if (!params.query) return "";
      return `https://www.target.com/s?searchTerm=${encodeURIComponent(params.query)}`;
    }
    case "costco": {
      if (!params.query) return "";
      return `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(params.query)}`;
    }
    case "bestbuy": {
      if (!params.query) return "";
      return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(params.query)}`;
    }
    case "homedepot": {
      if (!params.query) return "";
      return `https://www.homedepot.com/s/${encodeURIComponent(params.query)}`;
    }
    case "lowes": {
      if (!params.query) return "";
      return `https://www.lowes.com/search?searchTerm=${encodeURIComponent(params.query)}`;
    }
    case "ebay": {
      if (!params.query) return "";
      return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(params.query)}`;
    }
    case "wayfair": {
      if (!params.query) return "";
      return `https://www.wayfair.com/keyword.html?keyword=${encodeURIComponent(params.query)}`;
    }
    case "macys": {
      if (!params.query) return "";
      return `https://www.macys.com/shop/featured/${encodeURIComponent(params.query)}?keyword=${encodeURIComponent(params.query)}`;
    }
    case "nordstrom": {
      if (!params.query) return "";
      return `https://www.nordstrom.com/sr?origin=keywordsearch&keyword=${encodeURIComponent(params.query)}`;
    }
    case "cvs": {
      if (!params.query) return "";
      return `https://www.cvs.com/search?searchTerm=${encodeURIComponent(params.query)}`;
    }
    case "walgreens": {
      if (!params.query) return "";
      return `https://www.walgreens.com/search/results.jsp?Ntt=${encodeURIComponent(params.query)}`;
    }
    case "nike": {
      if (!params.query) return "";
      return `https://www.nike.com/w?q=${encodeURIComponent(params.query)}`;
    }
    case "apple": {
      if (!params.query) return "";
      return `https://www.apple.com/shop/buy-mac?fh=4a2b${encodeURIComponent(params.query)}`;
    }
    case "samsung": {
      if (!params.query) return "";
      return `https://www.samsung.com/us/search/searchMain?listType=g&searchTerm=${encodeURIComponent(params.query)}`;
    }
    case "dyson": {
      if (!params.query) return "";
      return `https://www.dyson.com/search#q=${encodeURIComponent(params.query)}`;
    }
    default:
      return "";
  }
}

// Active cross-site collection state
// ═══════════════════════════════════════════════════════════════════════════
// Progressive Collection Architecture
//
// Instead of "collect everything → rank", we use:
//   collect priority sources → build provisional rank → improve if evidence arrives
//
// ═══════════════════════════════════════════════════════════════════════════
// Cross-Site Collection — Simple parallel model:
//   1. Launch ALL sites in parallel immediately
//   2. Collect for up to COLLECTION_WINDOW_MS (25s)
//   3. When timer fires, rank with whatever we have
//   4. If all sites report early, finish early (bonus)
//   5. Per-site timeout (20s) is just cleanup for truly dead tabs
// ═══════════════════════════════════════════════════════════════════════════

const COLLECTION_WINDOW_MS = 25_000; // 25s to gather listings from all sites
const PER_SITE_TIMEOUT_MS  = 20_000; // 20s per site — just cleanup, not the driver

// ── Source Classification ──
// Roles are informational for the ranking prompt context — not for launch ordering.
interface SourceProfile {
  role: "core" | "expander" | "enricher";
  reliabilityWeight: number; // 0-1 — how much this source matters to ranking
}

const TRAVEL_SOURCE_PROFILES: Record<string, SourceProfile> = {
  airbnb:       { role: "core",     reliabilityWeight: 1.0 },
  booking:      { role: "core",     reliabilityWeight: 0.95 },
  expedia:      { role: "core",     reliabilityWeight: 0.85 },
  hotels:       { role: "expander", reliabilityWeight: 0.7 },
  agoda:        { role: "expander", reliabilityWeight: 0.6 },
  vrbo:         { role: "expander", reliabilityWeight: 0.65 },
  tripadvisor:  { role: "enricher", reliabilityWeight: 0.3 },
  googletravel: { role: "enricher", reliabilityWeight: 0.2 },
};

const SHOPPING_SOURCE_PROFILES: Record<string, SourceProfile> = {
  amazon:    { role: "core",     reliabilityWeight: 1.0 },
  walmart:   { role: "core",     reliabilityWeight: 0.9 },
  target:    { role: "core",     reliabilityWeight: 0.85 },
  bestbuy:   { role: "expander", reliabilityWeight: 0.7 },
  costco:    { role: "expander", reliabilityWeight: 0.65 },
  homedepot: { role: "expander", reliabilityWeight: 0.6 },
  lowes:     { role: "expander", reliabilityWeight: 0.55 },
  ebay:      { role: "enricher", reliabilityWeight: 0.4 },
  wayfair:   { role: "enricher", reliabilityWeight: 0.35 },
};

// ── Telemetry (persisted in chrome.storage.local) ──
interface SiteTelemetry {
  attempts: number;
  successes: number;
  timeouts: number;
  totalLatencyMs: number;
  totalListingsReturned: number;
  lastUpdated: number;
}

async function recordSiteTelemetry(site: string, success: boolean, latencyMs: number, listingsCount: number): Promise<void> {
  try {
    const key = `nirnai_telemetry_${site}`;
    const stored = await chrome.storage.local.get(key);
    const t: SiteTelemetry = stored[key] || { attempts: 0, successes: 0, timeouts: 0, totalLatencyMs: 0, totalListingsReturned: 0, lastUpdated: 0 };
    t.attempts++;
    if (success) {
      t.successes++;
      t.totalLatencyMs += latencyMs;
      t.totalListingsReturned += listingsCount;
    } else {
      t.timeouts++;
    }
    t.lastUpdated = Date.now();
    await chrome.storage.local.set({ [key]: t });
  } catch { /* telemetry is best-effort */ }
}

interface CrossSiteSession {
  originSite: string;
  originListings: ProductData[];
  searchContext: string;
  pendingTabs: Map<number, string>;     // tabId → site name
  collectedListings: ProductData[];
  originTabId: number;
  collectionTimer: ReturnType<typeof setTimeout>;  // the 25s collection window
  perSiteTimers: Map<number, ReturnType<typeof setTimeout>>;
  collectionWindowId?: number;
  totalSites: number;
  startTime: number;
  sitesReported: Set<string>;
  sourceProfiles: Record<string, SourceProfile>;
  finishing: boolean;                   // guard against double-finish
}

let activeCrossSite: CrossSiteSession | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// Evaluation — called after each site reports or times out.
// Only finishes early if ALL sites have reported (no pending tabs left).
// Otherwise we wait for the 25s collection window to expire.
// ═══════════════════════════════════════════════════════════════════════════
function evaluateCollection(): void {
  if (!activeCrossSite || activeCrossSite.finishing) return;

  // All tabs done (reported or timed out)? Finish early — no point waiting.
  if (activeCrossSite.pendingTabs.size === 0) {
    const elapsed = ((Date.now() - activeCrossSite.startTime) / 1000).toFixed(1);
    console.log(`NirnAI: All ${activeCrossSite.sitesReported.size} sites done after ${elapsed}s, ` +
      `${activeCrossSite.collectedListings.length} listings. Finishing early.`);
    finishCrossSiteCollection();
  }
  // Otherwise: let the 25s collection timer handle it.
}

// ═══════════════════════════════════════════════════════════════════════════
// Launch sites for a specific tier into the collection window
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// Launch ALL sites into the collection window at once
// ═══════════════════════════════════════════════════════════════════════════
function launchAllSites(siteUrls: { site: string; url: string }[]): void {
  if (!activeCrossSite || activeCrossSite.finishing) return;
  const session = activeCrossSite;

  const siteNames = siteUrls.map(s => s.site).join(", ");
  console.log(`NirnAI: Launching ALL ${siteUrls.length} sites in parallel: [${siteNames}]`);

  for (const { site, url } of siteUrls) {
    const hashFlag = url.includes("#") ? "&nirnai_collect" : "#nirnai_collect";

    const createOpts: chrome.tabs.CreateProperties = {
      url: url + hashFlag,
      active: false,
      ...(session.collectionWindowId != null ? { windowId: session.collectionWindowId } : {}),
    };

    chrome.tabs.create(createOpts).then((tab) => {
      if (tab.id != null && activeCrossSite && !activeCrossSite.finishing) {
        activeCrossSite.pendingTabs.set(tab.id, site);
        // Per-site timeout is just cleanup — kill truly dead tabs
        const siteTimer = setTimeout(() => {
          onSiteTimeout(tab.id!, site);
        }, PER_SITE_TIMEOUT_MS);
        activeCrossSite.perSiteTimers.set(tab.id, siteTimer);
      }
    }).catch((err) => {
      console.warn(`NirnAI: Failed to launch ${site}`, err);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-site timeout handler
// ═══════════════════════════════════════════════════════════════════════════
function onSiteTimeout(tabId: number, site: string): void {
  if (!activeCrossSite || activeCrossSite.finishing) return;
  if (!activeCrossSite.pendingTabs.has(tabId)) return;

  console.warn(`NirnAI: ${site} timed out after ${PER_SITE_TIMEOUT_MS / 1000}s`);

  activeCrossSite.pendingTabs.delete(tabId);
  activeCrossSite.perSiteTimers.delete(tabId);
  chrome.tabs.remove(tabId).catch(() => {});

  // Record timeout telemetry
  recordSiteTelemetry(site, false, PER_SITE_TIMEOUT_MS, 0);

  // Update overlay — show which site was slow
  chrome.tabs.sendMessage(activeCrossSite.originTabId, {
    action: "CROSS_SITE_PROGRESS",
    phase: "collecting",
    detail: `${site} didn't respond, continuing...`,
    totalSites: activeCrossSite.totalSites,
    sitesCollected: activeCrossSite.sitesReported.size,
    totalListings: activeCrossSite.collectedListings.length,
    sourcesReported: [...activeCrossSite.sitesReported],
    skippedSite: site,
  }).catch(() => {});

  evaluateCollection();
}

// ═══════════════════════════════════════════════════════════════════════════
// Finish collection — cleanup and send to ranking
// ═══════════════════════════════════════════════════════════════════════════
function finishCrossSiteCollection(): void {
  if (!activeCrossSite || activeCrossSite.finishing) return;
  activeCrossSite.finishing = true;
  const session = activeCrossSite;
  activeCrossSite = null;

  const elapsed = ((Date.now() - session.startTime) / 1000).toFixed(1);
  console.log(
    `NirnAI: FINISHING collection after ${elapsed}s — ` +
    `${session.collectedListings.length} listings from [${[...session.sitesReported].join(", ")}], ` +
    `${session.pendingTabs.size} tabs still pending`
  );

  // Clear all timers
  clearTimeout(session.collectionTimer);
  for (const t of session.perSiteTimers.values()) clearTimeout(t);

  // Close the entire hidden collection window
  if (session.collectionWindowId != null) {
    chrome.windows.remove(session.collectionWindowId).catch(() => {});
  } else {
    for (const tabId of session.pendingTabs.keys()) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  const rawListings = [...session.originListings, ...session.collectedListings];
  const sourcesUsed = [...session.sitesReported];

  // Classify sources for the summary
  const coreUsed = sourcesUsed.filter(s => session.sourceProfiles[s]?.role === "core");
  const expanderUsed = sourcesUsed.filter(s => session.sourceProfiles[s]?.role === "expander");

  if (rawListings.length === 0) {
    console.warn(
      `NirnAI: No listings collected after ${elapsed}s — ` +
      `${session.sitesReported.size} sites reported, ` +
      `pendingTabs remaining: ${session.pendingTabs.size}. ` +
      `Sites that reported: [${[...session.sitesReported].join(", ")}]`
    );
    chrome.tabs.sendMessage(session.originTabId, {
      action: "CROSS_SITE_DONE",
      success: false,
      error: `No listings found from ${session.sitesReported.size > 0 ? [...session.sitesReported].join(", ") : "any site"} after ${elapsed}s. The search pages may not have loaded properly.`,
    }).catch(() => {});
    return;
  }

  // Cap at 20 listings — server rejects >20, and more would be expensive to rank.
  // Distribute evenly across sources so no single site dominates the ranking.
  let allListings: ProductData[];
  if (rawListings.length <= 20) {
    allListings = rawListings;
  } else {
    // Group by source_site
    const bySite = new Map<string, ProductData[]>();
    for (const l of rawListings) {
      const site = (l as any).source_site || "unknown";
      if (!bySite.has(site)) bySite.set(site, []);
      bySite.get(site)!.push(l);
    }

    // Round-robin: take equal share from each source, then fill remaining
    const siteCount = bySite.size;
    const perSite = Math.floor(20 / siteCount);
    const selected: ProductData[] = [];
    const remainder: ProductData[] = [];
    for (const [, listings] of bySite) {
      selected.push(...listings.slice(0, perSite));
      remainder.push(...listings.slice(perSite));
    }
    // Fill remaining slots with leftover listings
    const remaining = 20 - selected.length;
    if (remaining > 0) {
      selected.push(...remainder.slice(0, remaining));
    }
    allListings = selected;
    console.log(`NirnAI: Distributed ${rawListings.length}→${allListings.length} listings across ${siteCount} sources (${perSite}/site)`);
  }

  // Log source distribution
  const sourceDist: Record<string, number> = {};
  for (const l of allListings) {
    const site = (l as any).source_site || "unknown";
    sourceDist[site] = (sourceDist[site] || 0) + 1;
  }
  console.log(`NirnAI: Ranking ${allListings.length} listings — distribution:`, JSON.stringify(sourceDist));

  // Tell origin tab we're now ranking
  chrome.tabs.sendMessage(session.originTabId, {
    action: "CROSS_SITE_PROGRESS",
    phase: "ranking",
    detail: `Ranking ${allListings.length} listings from ${sourcesUsed.join(", ")} (${elapsed}s)`,
    sourcesReported: sourcesUsed,
    coreSourceCount: coreUsed.length,
  }).catch(() => {});

  const crossSiteContext = session.searchContext +
    `\n\nCROSS-SITE COMPARISON: ${allListings.length} listings from ${sourcesUsed.length} platforms ` +
    `(core: ${coreUsed.join(", ")}${expanderUsed.length ? "; supporting: " + expanderUsed.join(", ") : ""}). ` +
    `Collected in ${elapsed}s. Rank purely by value — do NOT favor any platform. Note the source site for each listing.`;

  console.log(`NirnAI: Sending ${allListings.length} listings to /compare/start...`);

  startCompare(allListings, crossSiteContext)
    .then((result) => {
      const compareUrl = result.url.startsWith("http") ? result.url : `${API_BASE_URL}${result.url}`;
      console.log(`NirnAI: /compare/start returned — navigating to ${compareUrl}`);
      chrome.tabs.update(session.originTabId, { url: compareUrl }).catch(() => {
        chrome.tabs.create({ url: compareUrl });
      });
    })
    .catch((err) => {
      const errorDetail = err instanceof Error ? err.message : String(err);
      console.error("NirnAI: Cross-site compare failed:", errorDetail);
      chrome.tabs.sendMessage(session.originTabId, {
        action: "CROSS_SITE_DONE",
        success: false,
        error: `Ranking failed: ${errorDetail}`,
      }).catch(() => {});
    });
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: AnalysisResponse | CartAnalysisResponse | BatchResponse | null) => void
  ) => {
    if (message.action === "ANALYZE_PRODUCT" && message.data) {
      const senderTabId = _sender.tab?.id;
      analyzeProduct(message.data as ProductData, senderTabId)
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error("NirnAI: Analysis failed", err);
          sendResponse(null);
        });
      return true; // Keep channel open for async
    }

    if (message.action === "ANALYZE_BATCH" && (message as any).listings) {
      startCompare(
        (message as any).listings as ProductData[],
        (message as any).searchContext as string || ""
      )
        .then((result) => {
          // Open the NirnAI compare page in a new tab
          const compareUrl = result.url.startsWith("http") ? result.url : `${API_BASE_URL}${result.url}`;
          chrome.tabs.create({ url: compareUrl });
          sendResponse(null);
        })
        .catch((err) => {
          console.error("NirnAI: Compare start failed", err);
          sendResponse(null);
        });
      return true;
    }

    // Open a search URL in a new tab with auto-rank flag so the content script
    // automatically extracts listings and launches the NirnAI compare page.
    if (message.action === "COMPARE_FROM_URL" && (message as any).searchUrl) {
      const searchUrl = (message as any).searchUrl as string;
      // Append hash flag so content script knows to auto-rank on load
      const url = searchUrl + (searchUrl.includes("#") ? "&" : "#") + "nirnai_autorank";
      chrome.tabs.create({ url });
      sendResponse(null);
      return true;
    }

    if (message.action === "ANALYZE_CART" && (message as any).products) {
      analyzeCart((message as any).products as ProductData[])
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error("NirnAI: Cart analysis failed", err);
          sendResponse(null);
        });
      return true;
    }

    if (message.action === "GET_CACHED_ANALYSIS" && message.data) {
      const productData = message.data as ProductData;
      getCachedAnalysis(productData.url)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse(null));
      return true;
    }

    if (message.action === "PRODUCT_DATA_EXTRACTED" && message.data) {
      const senderTabId = _sender.tab?.id;
      analyzeProduct(message.data as ProductData, senderTabId)
        .then((result) => notifyContentScript(result, senderTabId))
        .catch((err) => console.error("NirnAI: Auto-analysis failed", err));
    }

    // ── Cross-Site Compare: initiated from content script ──
    if (message.action === "CROSS_SITE_COMPARE") {
      const msg = message as any;
      const originSite = msg.originSite as string;
      const originListings = (msg.listings || []) as ProductData[];
      const searchParams = msg.searchParams as CrossSiteSearchParams;
      const searchContext = msg.searchContext as string || "";
      const originTabId = _sender.tab?.id || 0;
      const includeOrigin = !!msg.includeOrigin; // true when triggered from product page
      const siteCategory = msg.siteCategory as string | undefined; // "travel" | "shopping"

      // Determine which sites to query
      const isTravelSite = siteCategory === "travel" || TRAVEL_SITES.includes(originSite);
      const sitePool = isTravelSite ? TRAVEL_SITES : SHOPPING_SITES;
      const sourceProfiles = isTravelSite ? TRAVEL_SOURCE_PROFILES : SHOPPING_SOURCE_PROFILES;
      const otherSites = includeOrigin
        ? sitePool
        : sitePool.filter((s) => s !== originSite);

      // Cancel any active cross-site session
      if (activeCrossSite) {
        activeCrossSite.finishing = true;
        clearTimeout(activeCrossSite.collectionTimer);
        for (const t of activeCrossSite.perSiteTimers.values()) clearTimeout(t);
        if (activeCrossSite.collectionWindowId != null) {
          chrome.windows.remove(activeCrossSite.collectionWindowId).catch(() => {});
        } else {
          for (const tabId of activeCrossSite.pendingTabs.keys()) {
            chrome.tabs.remove(tabId).catch(() => {});
          }
        }
        activeCrossSite = null;
      }

      // Build URLs for ALL sites
      const siteUrls: { site: string; url: string }[] = [];
      for (const site of otherSites) {
        const url = buildCrossSiteUrl(site, searchParams);
        if (url) siteUrls.push({ site, url });
      }

      console.log("NirnAI: Cross-site search params:", JSON.stringify({
        destination: searchParams.destination,
        checkin: searchParams.checkin,
        checkout: searchParams.checkout,
        adults: searchParams.adults,
        lat: searchParams.lat,
        lng: searchParams.lng,
      }));
      for (const { site, url } of siteUrls) {
        console.log(`NirnAI: ${site} URL → ${url.slice(0, 150)}`);
      }

      const allSiteNames = siteUrls.map(s => s.site);
      const coreSources = allSiteNames.filter(s => sourceProfiles[s]?.role === "core");
      const expanderSources = allSiteNames.filter(s => sourceProfiles[s]?.role === "expander");
      const enricherSources = allSiteNames.filter(s => sourceProfiles[s]?.role === "enricher");

      // ── Collection timer: 25s to gather, then rank with whatever we have ──
      const collectionTimer = setTimeout(() => {
        if (activeCrossSite && !activeCrossSite.finishing) {
          const elapsed = ((Date.now() - activeCrossSite.startTime) / 1000).toFixed(1);
          console.log(`NirnAI: Collection window closed at ${elapsed}s. ` +
            `${activeCrossSite.sitesReported.size}/${activeCrossSite.totalSites} sites reported, ` +
            `${activeCrossSite.collectedListings.length} listings collected. Ranking now.`);
          finishCrossSiteCollection();
        }
      }, COLLECTION_WINDOW_MS);

      activeCrossSite = {
        originSite,
        originListings,
        searchContext,
        pendingTabs: new Map(),
        perSiteTimers: new Map(),
        collectedListings: [],
        originTabId,
        collectionTimer,
        totalSites: siteUrls.length,
        startTime: Date.now(),
        sitesReported: new Set(),
        sourceProfiles,
        finishing: false,
      };

      // Tell origin tab to show loading overlay with ALL source names
      chrome.tabs.sendMessage(originTabId, {
        action: "CROSS_SITE_PROGRESS",
        phase: "collecting",
        detail: `Searching ${allSiteNames.join(", ")}...`,
        totalSites: siteUrls.length,
        sitesCollected: 0,
        totalListings: 0,
        sourcesReported: [],
        coreSources,
        expanderSources,
        enricherSources,
      }).catch(() => {});

      // Create off-screen collection window, then launch ALL sites at once
      // IMPORTANT: Do NOT use state: "minimized" — on macOS, minimized windows
      // go into the Dock and Chrome heavily throttles JS execution.  SPAs like
      // Airbnb/Booking never render their search-result DOM, so extractors
      // return 0 listings.  Instead we create a small, off-screen, unfocused
      // window so Chrome still runs JS / renders normally.
      (async () => {
        try {
          const collectionWindow = await chrome.windows.create({
            focused: false,
            type: "normal",
            width: 1024,
            height: 768,
            left: -2000,
            top: -2000,
          });
          if (collectionWindow.id != null && activeCrossSite && !activeCrossSite.finishing) {
            activeCrossSite.collectionWindowId = collectionWindow.id;

            // Remove the blank "new tab" that Chrome creates with the window
            if (collectionWindow.tabs?.[0]?.id) {
              chrome.tabs.remove(collectionWindow.tabs[0].id).catch(() => {});
            }
          }
        } catch (winErr) {
          console.warn("NirnAI: Could not create hidden window, using background tabs", winErr);
        }

        // Launch ALL sites immediately — no waves, no delays
        launchAllSites(siteUrls);
      })();

      sendResponse(null);
      return true;
    }

    // ── Cross-Site Listings: received from a background collection tab ──
    if (message.action === "CROSS_SITE_LISTINGS") {
      const msg = message as any;
      const listings = msg.listings as ProductData[];
      const senderTabId = _sender.tab?.id;

      if (activeCrossSite && !activeCrossSite.finishing && senderTabId != null) {
        const siteName = activeCrossSite.pendingTabs.get(senderTabId) || "unknown";
        const latencyMs = Date.now() - activeCrossSite.startTime;

        console.log(`NirnAI: RECEIVED ${listings.length} listings from ${siteName} (tab ${senderTabId}) after ${(latencyMs/1000).toFixed(1)}s`);

        // Clear this tab's per-site timeout
        const siteTimer = activeCrossSite.perSiteTimers.get(senderTabId);
        if (siteTimer) {
          clearTimeout(siteTimer);
          activeCrossSite.perSiteTimers.delete(senderTabId);
        }

        // Record telemetry
        recordSiteTelemetry(siteName, true, latencyMs, listings.length);

        // Add collected listings
        activeCrossSite.collectedListings.push(...listings);
        activeCrossSite.sitesReported.add(siteName);

        // Remove this tab from pending and close it
        activeCrossSite.pendingTabs.delete(senderTabId);
        chrome.tabs.remove(senderTabId).catch(() => {});

        // Send detailed progress update to origin tab
        const profile = activeCrossSite.sourceProfiles[siteName];
        const elapsed = ((Date.now() - activeCrossSite.startTime) / 1000).toFixed(0);
        chrome.tabs.sendMessage(activeCrossSite.originTabId, {
          action: "CROSS_SITE_PROGRESS",
          phase: "collecting",
          detail: `${listings.length} from ${siteName} (${elapsed}s)`,
          totalSites: activeCrossSite.totalSites,
          sitesCollected: activeCrossSite.sitesReported.size,
          totalListings: activeCrossSite.collectedListings.length,
          sourcesReported: [...activeCrossSite.sitesReported],
          sourceRole: profile?.role ?? "unknown",
        }).catch(() => {});

        // Evaluate: finish, launch more, or wait?
        evaluateCollection();
      }

      sendResponse(null);
      return true;
    }
  }
);

// Clear badge when navigating away from product pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
