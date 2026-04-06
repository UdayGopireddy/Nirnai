// Popup script — communicates with content script and service worker

declare const __API_BASE_URL__: string;

// ── Platform search URL builder (mirrors content.ts logic) ──
const POPUP_SEARCH_TEMPLATES: Record<string, (q: string) => string> = {
  "airbnb.com":    q => `https://www.airbnb.com/s/${encodeURIComponent(q)}/homes`,
  "booking.com":   q => `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`,
  "expedia.com":   q => `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(q)}`,
  "vrbo.com":      q => `https://www.vrbo.com/search?destination=${encodeURIComponent(q)}`,
  "hotels.com":    q => `https://www.hotels.com/search.do?q-destination=${encodeURIComponent(q)}`,
  "amazon.com":    q => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  "walmart.com":   q => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  "target.com":    q => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,
  "bestbuy.com":   q => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,
  "ebay.com":      q => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  "etsy.com":      q => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
};

function buildPlatformSearchUrl(aiUrl: string, productName: string, currentHost: string): string {
  // Check if AI URL is on a supported platform
  try {
    if (aiUrl) {
      const aiHost = new URL(aiUrl).hostname.toLowerCase();
      for (const p of Object.keys(POPUP_SEARCH_TEMPLATES)) {
        if (aiHost.includes(p.replace("www.", ""))) return aiUrl;
      }
    }
  } catch {}
  // Build search on current platform
  for (const [platform, builder] of Object.entries(POPUP_SEARCH_TEMPLATES)) {
    if (currentHost.includes(platform.replace("www.", "")) && productName) {
      return builder(productName);
    }
  }
  // Fallback to Google Shopping
  if (productName) return `https://www.google.com/search?q=${encodeURIComponent(productName)}&udm=28`;
  return aiUrl || "";
}

interface ProductData {
  title: string;
  brand: string;
  price: string;
  currency: string;
  rating: string;
  reviewCount: string;
  seller: string;
  fulfiller: string;
  ingredients: string;
  nutritionInfo: string;
  returnPolicy: string;
  delivery: string;
  category: string;
  url: string;
  imageUrl: string;
  barcode: string;
  source_site: string;
  page_type: string;
}

interface DecisionStamp {
  stamp: "SMART_BUY" | "CHECK" | "AVOID";
  label: string;
  icon: string;
  reasons: string[];
  purchase_signal: string;
  health_signal: string;
}

interface ReviewTrust {
  trust_score: number;
  rating_strength: number;
  volume_confidence: number;
  distribution_quality: number;
  authenticity: number;
}

interface AnalysisResponse {
  purchase_score: number;
  health_score: number;
  decision: string;
  stamp: DecisionStamp;
  purchase_breakdown: Record<string, number>;
  health_breakdown: Record<string, number>;
  review_trust: ReviewTrust;
  reasons: string[];
  warnings: string[];
  positives: string[];
  confidence: number;
  summary: string;
  suggestion?: { product_name: string; reason: string; search_url: string } | null;
}

// DOM elements
const loadingEl = document.getElementById("loading")!;
const notProductEl = document.getElementById("not-product")!;
const errorEl = document.getElementById("error")!;
const errorMsgEl = document.getElementById("error-message")!;
const resultsEl = document.getElementById("results")!;
const retryBtn = document.getElementById("retry-btn")!;

function showState(state: "loading" | "not-product" | "error" | "results") {
  loadingEl.classList.toggle("hidden", state !== "loading");
  notProductEl.classList.toggle("hidden", state !== "not-product");
  errorEl.classList.toggle("hidden", state !== "error");
  resultsEl.classList.toggle("hidden", state !== "results");
}

function getScoreColor(score: number): string {
  if (score >= 70) return "green";
  if (score >= 50) return "amber";
  return "red";
}

function renderStamp(analysis: AnalysisResponse) {
  const banner = document.getElementById("stamp-banner")!;
  const icon = document.getElementById("stamp-icon")!;
  const label = document.getElementById("stamp-label")!;
  const reasons = document.getElementById("stamp-reasons")!;
  const purchaseSignal = document.getElementById("stamp-purchase-signal")!;
  const healthSignal = document.getElementById("stamp-health-signal")!;
  const confidenceFill = document.getElementById("confidence-fill")!;
  const confidenceValue = document.getElementById("confidence-value")!;

  const stamp = analysis.stamp;
  banner.className = "stamp-banner";

  const classMap: Record<string, string> = {
    SMART_BUY: "smart-buy",
    CHECK: "check",
    AVOID: "avoid",
  };
  banner.classList.add(classMap[stamp.stamp] || "check");

  icon.textContent = stamp.icon;
  label.textContent = stamp.label;
  reasons.textContent = stamp.reasons.join(" • ");

  purchaseSignal.textContent = stamp.purchase_signal ? `🛒 ${stamp.purchase_signal}` : "";
  healthSignal.textContent = stamp.health_signal ? `🥗 ${stamp.health_signal}` : "";

  // Confidence bar
  const confPct = Math.round(analysis.confidence * 100);
  confidenceFill.style.width = `${confPct}%`;
  confidenceValue.textContent = `${confPct}%`;
}

function renderProduct(data: ProductData) {
  const img = document.getElementById("product-image") as HTMLImageElement;
  const title = document.getElementById("product-title")!;
  const price = document.getElementById("product-price")!;

  if (data.imageUrl) {
    img.src = data.imageUrl;
  } else {
    img.style.display = "none";
  }
  title.textContent = data.title || "Unknown Product";
  price.textContent = data.price || "";
}

function renderBreakdown(containerId: string, data: Record<string, number>) {
  const container = document.getElementById(containerId)!;
  container.innerHTML = "";
  for (const [key, val] of Object.entries(data)) {
    const item = document.createElement("div");
    item.className = "breakdown-item";
    item.innerHTML = `<span class="label">${key}</span><span class="value">${val}/100</span>`;
    container.appendChild(item);
  }
}

function renderScores(analysis: AnalysisResponse) {
  // Purchase score
  const purchaseScore = document.getElementById("purchase-score")!;
  const purchaseBar = document.getElementById("purchase-bar")!;
  purchaseScore.textContent = String(analysis.purchase_score);
  purchaseBar.style.width = `${analysis.purchase_score}%`;
  purchaseBar.className = `score-fill ${getScoreColor(analysis.purchase_score)}`;
  renderBreakdown("purchase-breakdown", analysis.purchase_breakdown);

  // Review trust
  const trustScore = document.getElementById("trust-score")!;
  const trustBar = document.getElementById("trust-bar")!;
  const trust = analysis.review_trust;
  trustScore.textContent = String(trust.trust_score);
  trustBar.style.width = `${trust.trust_score}%`;
  trustBar.className = `score-fill ${getScoreColor(trust.trust_score)}`;
  renderBreakdown("trust-breakdown", {
    "Rating": trust.rating_strength,
    "Volume": trust.volume_confidence,
    "Distribution": trust.distribution_quality,
    "Authenticity": trust.authenticity,
  });

  // Health score (show only for food)
  const healthCard = document.getElementById("health-card")!;
  if (analysis.health_score > 0) {
    healthCard.classList.remove("hidden");
    const healthScore = document.getElementById("health-score")!;
    const healthBar = document.getElementById("health-bar")!;
    healthScore.textContent = String(analysis.health_score);
    healthBar.style.width = `${analysis.health_score}%`;
    healthBar.className = `score-fill ${getScoreColor(analysis.health_score)}`;
    renderBreakdown("health-breakdown", analysis.health_breakdown);
  } else {
    healthCard.classList.add("hidden");
  }

  // Warnings & Positives
  const warningsList = document.getElementById("warnings-list")!;
  const warningsUl = document.getElementById("warnings-ul")!;
  const positivesList = document.getElementById("positives-list")!;
  const positivesUl = document.getElementById("positives-ul")!;

  if (analysis.warnings.length > 0) {
    warningsList.classList.remove("hidden");
    warningsUl.innerHTML = analysis.warnings.map(w => `<li>${w}</li>`).join("");
  } else {
    warningsList.classList.add("hidden");
  }

  if (analysis.positives.length > 0) {
    positivesList.classList.remove("hidden");
    positivesUl.innerHTML = analysis.positives.map(p => `<li>${p}</li>`).join("");
  } else {
    positivesList.classList.add("hidden");
  }

  // Summary
  document.getElementById("summary-text")!.textContent =
    analysis.summary || "No summary available.";

  // Alternative Suggestion
  const suggestionCard = document.getElementById("suggestion-card")!;
  if (analysis.suggestion) {
    suggestionCard.classList.remove("hidden");
    document.getElementById("suggestion-name")!.textContent = analysis.suggestion.product_name;
    document.getElementById("suggestion-reason")!.textContent = analysis.suggestion.reason;
    const link = document.getElementById("suggestion-link") as HTMLAnchorElement;
    link.href = "#";
    link.textContent = "🏆 Rank alternatives";
    const productName = analysis.suggestion.product_name;
    const rawUrl = analysis.suggestion.search_url;
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      link.textContent = "⏳ Searching across sites…";
      link.style.opacity = "0.6";
      // Ask the active tab for its hostname so we know the origin platform
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabHost = tab?.url ? new URL(tab.url).hostname.toLowerCase() : "";

      // Detect whether the user is on a travel or shopping site
      const TRAVEL_HOSTS = ["airbnb", "booking", "expedia", "vrbo", "agoda", "hotels", "tripadvisor", "google.com/travel"];
      const isTravelSite = TRAVEL_HOSTS.some(h => tabHost.includes(h));
      const siteCategory = isTravelSite ? "travel" : "shopping";

      // Detect origin site name
      const SITE_HOST_MAP: Record<string, string> = {
        "airbnb": "airbnb", "booking": "booking", "expedia": "expedia", "vrbo": "vrbo",
        "agoda": "agoda", "hotels.com": "hotels", "tripadvisor": "tripadvisor",
        "amazon": "amazon", "walmart": "walmart", "target.com": "target",
        "costco": "costco", "bestbuy": "bestbuy", "homedepot": "homedepot",
        "lowes": "lowes", "ebay": "ebay", "wayfair": "wayfair", "macys": "macys",
        "nordstrom": "nordstrom", "cvs": "cvs", "walgreens": "walgreens",
        "nike": "nike", "apple.com/shop": "apple", "samsung": "samsung", "dyson": "dyson",
      };
      let originSite = "";
      for (const [hostFragment, siteName] of Object.entries(SITE_HOST_MAP)) {
        if (tabHost.includes(hostFragment)) { originSite = siteName; break; }
      }

      // Build cross-site search params
      const searchParams = {
        destination: isTravelSite ? productName : "",
        checkin: "", checkout: "", adults: "2", children: "", rooms: "1",
        query: isTravelSite ? "" : productName,
      };

      // Send cross-site compare — searches ALL platforms
      chrome.runtime.sendMessage({
        action: "CROSS_SITE_COMPARE",
        originSite,
        listings: [],
        searchParams,
        searchContext: `User wants cross-site alternatives: "${productName}"`,
        includeOrigin: true,
        siteCategory,
      });
    });
  } else {
    suggestionCard.classList.add("hidden");
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "PING" });
  } catch {
    // Content script not loaded — inject it programmatically
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"],
    });
    // Give it a moment to initialize
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function analyzeCurrentPage() {
  showState("loading");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id || !tab.url) {
      showState("not-product");
      return;
    }

    // Only work on supported sites
    const supportedSites = ["amazon.", "walmart.com", "target.com"];
    if (!supportedSites.some(site => tab.url!.includes(site))) {
      showState("not-product");
      notProductEl.innerHTML = `<p>Navigate to a supported shopping site to get analysis.</p><p style="font-size:11px;opacity:0.6;margin-top:8px;">Supported: Amazon, Walmart, Target</p>`;
      return;
    }

    // Cart page — auto-panel handles it
    if (tab.url.includes("/cart") || tab.url.includes("/gp/cart")) {
      showState("not-product");
      notProductEl.innerHTML = `<p>🛒 Cart analysis is showing on the page.<br><small style="opacity:0.6;">Check the panel on the right side of the page.</small></p>`;
      return;
    }

    // Ensure content script is injected
    await ensureContentScript(tab.id!);

    // Ask content script to extract product data
    let productData: ProductData | null = null;
    try {
      productData = await chrome.tabs.sendMessage(
        tab.id,
        { action: "EXTRACT_PRODUCT_DATA" }
      );
    } catch (msgErr) {
      console.error("NirnAI: Content script communication failed", msgErr);
      showState("error");
      errorMsgEl.textContent = "Cannot connect to page. Try refreshing the page.";
      return;
    }

    if (!productData || !productData.title) {
      showState("not-product");
      notProductEl.innerHTML = `<p>Navigate to a product page to get analysis.</p><p style="font-size:11px;opacity:0.6;margin-top:8px;">Supported: Amazon, Walmart, Target</p>`;
      return;
    }

    renderProduct(productData);

    // Send to service worker for analysis
    const analysis: AnalysisResponse | null = await chrome.runtime.sendMessage(
      { action: "ANALYZE_PRODUCT", data: productData }
    );

    if (!analysis) {
      showState("error");
      errorMsgEl.textContent = "Analysis failed. The backend may be temporarily unavailable.";
      return;
    }

    renderStamp(analysis);
    renderScores(analysis);
    showState("results");
  } catch (err: any) {
    console.error("NirnAI popup error:", err);
    showState("error");
    errorMsgEl.textContent = err?.message || "Could not analyze this page. Please try again.";
  }
}

retryBtn.addEventListener("click", analyzeCurrentPage);

// Start analysis when popup opens
analyzeCurrentPage();
