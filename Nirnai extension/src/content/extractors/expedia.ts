// Expedia hotel/property page extractor
// Uses JSON-LD, meta tags, UITK data attributes, and text pattern matching

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

// Register Expedia search URL builder for cross-site comparison
registerSearchUrlBuilder("expedia", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("destination", p.destination);
  if (p.checkin) sp.set("startDate", p.checkin);
  if (p.checkout) sp.set("endDate", p.checkout);
  if (p.adults) sp.set("adults", p.adults);
  if (p.children) sp.set("children", p.children);
  return `https://www.expedia.com/Hotel-Search?${sp.toString()}`;
});

function extractText(selectors: string[]): string {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return "";
}

function getMeta(property: string): string {
  const el = document.querySelector(
    `meta[property="${property}"], meta[name="${property}"]`
  ) as HTMLMetaElement | null;
  return el?.content?.trim() || "";
}

function getJsonLd(): any | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const type = item["@type"];
        if (
          type === "Hotel" ||
          type === "LodgingBusiness" ||
          type === "Product" ||
          type === "VacationRental" ||
          (Array.isArray(type) && type.some((t: string) =>
            ["Hotel", "LodgingBusiness", "Product", "VacationRental"].includes(t)
          ))
        ) {
          return item;
        }
      }
      if (items.length === 1 && items[0].name) return items[0];
    } catch { /* skip */ }
  }
  return null;
}

export class ExpediaExtractor implements SiteExtractor {
  siteName(): string {
    return "expedia.com";
  }

  isProductPage(): boolean {
    const path = window.location.pathname;
    // Hotel info pages: /Hotel-Information, /h<id>.Hotel-Information
    if (/\.Hotel-Information/i.test(path)) return true;
    // /h followed by digits: /h12345678
    if (/\/h\d+/i.test(path)) return true;
    // Vacation rental detail pages
    if (path.includes("/Vacation-Rental/")) return true;
    return false;
  }

  isCartPage(): boolean {
    return false;
  }

  isSearchPage(): boolean {
    const path = window.location.pathname;
    // /Hotel-Search, /-Hotels, Search results
    if (/Hotel-Search|Hotels?\b/i.test(path)) return true;
    if (path.includes("/search")) return true;
    // Check for listing cards on page
    if (document.querySelector('[data-stid="property-listing"]')) return true;
    return false;
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();

    // ── Title ──
    const title =
      getMeta("og:title")?.replace(/\s*\|.*$/, "")?.replace(/ - Expedia$/, "") ||
      jsonLd?.name ||
      extractText([
        'h1[data-stid="content-hotel-title"]',
        'h1[itemprop="name"]',
        'h1',
      ]);

    // ── Price ──
    const price = this.extractPrice(jsonLd);

    // ── Rating ──
    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      this.extractRating();

    // ── Review count ──
    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      this.extractReviewCount();

    // ── Property type ──
    const propertyType = this.extractPropertyType();

    // ── Location ──
    const location = this.extractLocation(jsonLd);

    // ── Amenities ──
    const amenities = this.extractAmenities();

    // ── Category ratings ──
    const categoryRatings = this.extractCategoryRatings();

    // ── Review snippets ──
    const reviewSnippets = this.extractReviewSnippets();

    // ── Cancellation ──
    const cancellation = this.extractCancellation();

    // ── Image ──
    const imageUrl =
      getMeta("og:image") ||
      jsonLd?.image ||
      (document.querySelector('[data-stid="hero-image"] img, .uitk-image img') as HTMLImageElement)?.src ||
      "";

    // ── Description ──
    const description = getMeta("og:description") || jsonLd?.description || "";

    // ── Star class (hotel star rating, not guest) ──
    const starClass = this.extractStarClass();

    return {
      title,
      brand: this.extractChainOrHost(),
      price,
      currency: this.detectCurrency(),
      rating,
      reviewCount,
      seller: this.extractChainOrHost(),
      fulfiller: this.extractBadges(),
      ingredients: amenities,
      nutritionInfo: categoryRatings + (reviewSnippets ? `\n\nRecent reviews:\n${reviewSnippets}` : ""),
      returnPolicy: cancellation,
      delivery: starClass ? `${starClass} star property` : "",
      category: propertyType + (location ? ` | ${location}` : "") + (description ? ` | ${description}` : ""),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: this.extractSearchContext(),
      source_site: "expedia",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    return [];
  }

  extractSearchListings(maxResults: number = 5): ProductData[] {
    const listings: ProductData[] = [];

    const cardSelectors = [
      '[data-stid="property-listing"]',
      '[data-stid="lodging-card-responsive"]',
      '.uitk-card-has-primary-theme',
      '[data-testid="property-card"]',
      '[data-stid="property-card"]',
    ];

    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) {
        cards = Array.from(found);
        break;
      }
    }

    // Generic fallback: find hotel links and walk up to parent card
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/h"][href*="Hotel"], a[href*=".Hotel-Information"], a[href*="/ho"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (!seen.has(key)) {
          seen.add(key);
          const container = link.closest('[data-stid], [class*="card"], [class*="listing"], li, article') || link.parentElement?.parentElement;
          if (container && container !== document.body) cards.push(container);
        }
      }
    }

    for (const card of cards.slice(0, maxResults)) {
      try {
        const listing = this.extractSearchCard(card);
        if (listing?.title && listing?.url) {
          listings.push(listing);
        }
      } catch { /* skip */ }
    }

    return listings;
  }

  private extractSearchCard(card: Element): ProductData | null {
    // ── URL ──
    const linkEl = (card.querySelector('a[href*="/h"], a[href*="Hotel"], a[href*="/ho"]') || card.querySelector('a')) as HTMLAnchorElement | null;
    const url = linkEl?.href || "";
    if (!url) return null;

    // ── Title ──
    const title =
      card.querySelector('[data-stid="content-hotel-title"]')?.textContent?.trim() ||
      card.querySelector('h3, h2')?.textContent?.trim() ||
      linkEl?.getAttribute("aria-label") ||
      "";

    // ── Price ──
    let price = "";
    const priceEl = card.querySelector('[data-stid="content-hotel-lead-price"], [class*="price"], .uitk-type-500');
    if (priceEl) {
      price = priceEl.textContent?.trim() || "";
    }
    if (!price) {
      const spans = card.querySelectorAll("span, div");
      for (const span of spans) {
        const text = span.textContent?.trim() || "";
        if (/^\$\d+/.test(text) && text.length < 20) { price = text; break; }
      }
    }

    // ── Rating ──
    let rating = "";
    const ratingEl = card.querySelector('[data-stid="content-hotel-review-total"], [class*="rating"], [class*="badge"], [class*="score"]');
    if (ratingEl) {
      const text = ratingEl.textContent?.trim() || "";
      const match = text.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        // Expedia uses 1-10 scale
        rating = val > 5 ? (val / 2).toFixed(2) : match[1];
      }
    }

    // ── Review count ──
    let reviewCount = "";
    const cardText = card.textContent || "";
    const revMatch = cardText.match(/([\d,]+)\s*reviews?/i);
    if (revMatch) reviewCount = revMatch[1];

    // ── Image ──
    const imgEl = card.querySelector("img") as HTMLImageElement | null;
    const imageUrl = imgEl?.src || "";

    // ── Neighborhood / subtitle ──
    const subtitle =
      card.querySelector('[data-stid="content-hotel-neighborhood"]')?.textContent?.trim() ||
      "";

    // ── Badges ──
    let fulfiller = "";
    if (cardText.toLowerCase().includes("vip")) fulfiller = "VIP Access";
    if (cardText.toLowerCase().includes("member price")) {
      fulfiller += (fulfiller ? " | " : "") + "Member Price";
    }
    if (cardText.toLowerCase().includes("free cancellation")) {
      fulfiller += (fulfiller ? " | " : "") + "Free cancellation";
    }

    return {
      title,
      brand: "",
      price,
      currency: this.detectCurrency(),
      rating,
      reviewCount,
      seller: "",
      fulfiller,
      ingredients: "",
      nutritionInfo: "",
      returnPolicy: "",
      delivery: "",
      category: subtitle,
      url: url.split("?")[0],
      imageUrl,
      barcode: "",
      source_site: "expedia",
      page_type: "search_result",
    };
  }

  // ── Private helpers ──

  private extractPrice(jsonLd: any): string {
    if (jsonLd?.offers?.price) {
      return `${jsonLd.offers.priceCurrency || "$"}${jsonLd.offers.price}`;
    }

    const priceSelectors = [
      '[data-stid="content-hotel-lead-price"]',
      '[data-stid="price-lockup-text"]',
      '.uitk-type-500.uitk-type-bold',
    ];
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) {
        const text = el.textContent.trim();
        if (/[\d,]+/.test(text)) return text;
      }
    }

    // Broader search for price patterns
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent?.trim() || "";
      if (/[\$€£₹¥]\s*[\d,]+/.test(text) && text.toLowerCase().includes("night")) {
        return text;
      }
    }

    return "";
  }

  private extractRating(): string {
    const selectors = [
      '[data-stid="content-hotel-review-total"]',
      '[itemprop="ratingValue"]',
      '.uitk-badge-base-text',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim() || "";
      const match = text.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        return val > 5 ? (val / 2).toFixed(2) : match[1];
      }
    }
    return "";
  }

  private extractReviewCount(): string {
    const selectors = [
      '[data-stid="content-hotel-review-total"]',
      '[itemprop="reviewCount"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent || "";
      const match = text.match(/([\d,]+)\s*reviews?/i);
      if (match) return match[1];
    }
    const body = document.body.textContent || "";
    const match = body.match(/([\d,]+)\s*(?:verified\s+)?reviews?/i);
    return match ? match[1] : "";
  }

  private extractPropertyType(): string {
    return extractText([
      '[data-stid="content-hotel-star-rating"]',
      '.uitk-badge',
    ]);
  }

  private extractLocation(jsonLd: any): string {
    if (jsonLd?.address) {
      const a = jsonLd.address;
      const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean);
      return parts.join(", ");
    }
    return (
      getMeta("geo.placename") ||
      extractText([
        '[data-stid="content-hotel-address"]',
        '.uitk-text.uitk-type-200',
      ])
    );
  }

  private extractAmenities(): string {
    const amenities: string[] = [];
    const items = document.querySelectorAll(
      '[data-stid="section-room-amenities"] li, [data-stid="hotel-amenities"] li, .uitk-layout-flex-item .uitk-text'
    );
    for (const item of Array.from(items).slice(0, 20)) {
      const text = item.textContent?.trim() || "";
      if (text && text.length < 80 && !text.includes("Show more")) amenities.push(text);
    }
    return amenities.length > 0 ? `[AMENITIES] ${amenities.join(" | ")}` : "";
  }

  private extractCategoryRatings(): string {
    const ratings: string[] = [];
    const items = document.querySelectorAll(
      '[data-stid="review-score-bar"], .uitk-progress-bar'
    );
    for (const item of items) {
      const label = item.getAttribute("aria-label") || item.textContent?.trim();
      if (label) ratings.push(label);
    }
    return ratings.length > 0 ? `[CATEGORY RATINGS] ${ratings.join(" | ")}` : "";
  }

  private extractReviewSnippets(): string {
    const snippets: string[] = [];
    const reviews = document.querySelectorAll(
      '[data-stid="review-card"], [itemprop="review"]'
    );
    for (const review of Array.from(reviews).slice(0, 5)) {
      const text = review.textContent?.trim()?.substring(0, 200) || "";
      if (text.length > 20) snippets.push(text);
    }
    return snippets.join("\n---\n");
  }

  private extractCancellation(): string {
    const el = document.querySelector(
      '[data-stid="free-cancellation-message"], [data-stid="cancellation-messaging"]'
    );
    if (el?.textContent?.trim()) return el.textContent.trim().substring(0, 200);

    const body = document.body.textContent || "";
    if (body.toLowerCase().includes("free cancellation")) return "Free cancellation available";
    if (body.toLowerCase().includes("non-refundable")) return "Non-refundable";
    return "";
  }

  private extractStarClass(): string {
    const el = document.querySelector('[data-stid="content-hotel-star-rating"]');
    if (el) {
      const match = el.textContent?.match(/(\d+(\.\d+)?)/);
      if (match) return match[1];
    }
    // Check aria-label
    const stars = document.querySelector('[aria-label*="star"]');
    if (stars) {
      const match = stars.getAttribute("aria-label")?.match(/(\d+(\.\d+)?)/);
      if (match) return match[1];
    }
    return "";
  }

  private extractChainOrHost(): string {
    return extractText([
      '[data-stid="content-hotel-brand"]',
      '.uitk-text.uitk-type-200[data-stid="content-hotel-brand"]',
    ]);
  }

  private extractBadges(): string {
    const badges: string[] = [];
    const body = document.body.textContent?.toLowerCase() || "";
    if (body.includes("vip access")) badges.push("VIP Access");
    if (body.includes("member price")) badges.push("Member Price");
    if (body.includes("top rated")) badges.push("Top Rated");
    if (body.includes("free cancellation")) badges.push("Free Cancellation");
    if (body.includes("breakfast included")) badges.push("Breakfast Included");
    return badges.join(" | ");
  }

  private detectCurrency(): string {
    const body = document.body.textContent || "";
    if (body.includes("€")) return "EUR";
    if (body.includes("£")) return "GBP";
    if (body.includes("₹")) return "INR";
    return "USD";
  }

  private extractSearchContext(): string {
    const params = new URLSearchParams(window.location.search);
    const parts: string[] = [];
    const dest = params.get("destination") || params.get("q") || "";
    if (dest) parts.push(`destination=${dest}`);
    const checkIn = params.get("startDate") || params.get("d1") || "";
    const checkOut = params.get("endDate") || params.get("d2") || "";
    if (checkIn) parts.push(`checkin=${checkIn}`);
    if (checkOut) parts.push(`checkout=${checkOut}`);
    const adults = params.get("adults") || "";
    if (adults) parts.push(`adults=${adults}`);

    // Build a working Expedia search URL for the "Better Alternative" feature
    const searchParams = new URLSearchParams();
    if (dest) searchParams.set("destination", dest);
    if (checkIn) searchParams.set("startDate", checkIn);
    if (checkOut) searchParams.set("endDate", checkOut);
    if (adults) searchParams.set("adults", adults);
    const children = params.get("children") || "";
    if (children) searchParams.set("children", children);
    const baseSearchUrl = `https://www.expedia.com/Hotel-Search?${searchParams.toString()}`;
    parts.unshift(`search_base_url=${baseSearchUrl}`);

    return parts.join("&");
  }

  // ── Geo methods for adaptive radius ──

  getMapBounds(): MapBounds | null {
    return null; // Expedia doesn't expose map bounds in URL params
  }

  getSearchCenter(): SearchCenter | null {
    const params = new URLSearchParams(window.location.search);
    // Expedia uses latLong param like "27.950575,-82.45717"
    const latLong = params.get("latLong") || "";
    if (latLong) {
      const [latStr, lngStr] = latLong.split(",");
      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("destination") || params.get("q") || "";
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = this.getSearchDestination();
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("startDate") || params.get("d1") || "",
      checkout: params.get("endDate") || params.get("d2") || "",
      adults: params.get("adults") || "2",
      children: params.get("children") || "",
      rooms: "1",
    };
  }
}
