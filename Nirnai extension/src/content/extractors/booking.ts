// Booking.com hotel/property page extractor
// Uses JSON-LD, meta tags, data-testid attributes, and text pattern matching

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

// Register Booking.com search URL builder for cross-site comparison
registerSearchUrlBuilder("booking", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("ss", p.destination);
  if (p.checkin) sp.set("checkin", p.checkin);
  if (p.checkout) sp.set("checkout", p.checkout);
  if (p.adults) sp.set("group_adults", p.adults);
  if (p.children) sp.set("group_children", p.children);
  sp.set("no_rooms", p.rooms || "1");
  return `https://www.booking.com/searchresults.html?${sp.toString()}`;
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
          type === "VacationRental" ||
          type === "Product" ||
          type === "Accommodation" ||
          (Array.isArray(type) && type.some((t: string) =>
            ["Hotel", "LodgingBusiness", "VacationRental", "Product", "Accommodation"].includes(t)
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

export class BookingExtractor implements SiteExtractor {
  siteName(): string {
    return "booking.com";
  }

  isProductPage(): boolean {
    const path = window.location.pathname;
    // Hotel pages: /hotel/{country}/{hotel-slug}.html
    if (/\/hotel\/[a-z]{2}\//.test(path)) return true;
    // Apartments/vacation rentals
    if (/\/apartment\/|\/hostel\/|\/resort\//.test(path)) return true;
    return false;
  }

  isCartPage(): boolean {
    return false; // Booking.com has no cart
  }

  isSearchPage(): boolean {
    const path = window.location.pathname;
    // /searchresults or /search
    if (path.includes("/searchresults")) return true;
    if (path === "/search" || path.startsWith("/search/")) return true;
    // City pages with listings
    if (document.querySelector('[data-testid="property-card"]')) return true;
    return false;
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();

    // ── Title ──
    const title =
      getMeta("og:title")?.replace(/ - Booking\.com$/, "") ||
      jsonLd?.name ||
      extractText([
        'h2[id="hp_hotel_name"]',
        '[data-testid="header-title"]',
        'h2.pp-header__title',
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

    // ── Category ratings (cleanliness, location, staff, etc.) ──
    const categoryRatings = this.extractCategoryRatings();

    // ── Review snippets ──
    const reviewSnippets = this.extractReviewSnippets();

    // ── Cancellation ──
    const cancellation = this.extractCancellation();

    // ── Check-in/out ──
    const checkInOut = this.extractCheckInOut();

    // ── Image ──
    const imageUrl =
      getMeta("og:image") ||
      jsonLd?.image ||
      (document.querySelector('[data-testid="hero-banner-photo"] img, .bh-photo-grid img') as HTMLImageElement)?.src ||
      "";

    // ── Description ──
    const description = getMeta("og:description") || jsonLd?.description || "";

    return {
      title,
      brand: this.extractHostOrChain(),
      price,
      currency: this.detectCurrency(),
      rating,
      reviewCount,
      seller: this.extractHostOrChain(),
      fulfiller: this.extractBadges(),
      ingredients: amenities,
      nutritionInfo: categoryRatings + (reviewSnippets ? `\n\nRecent reviews:\n${reviewSnippets}` : ""),
      returnPolicy: cancellation,
      delivery: checkInOut,
      category: propertyType + (location ? ` | ${location}` : "") + (description ? ` | ${description}` : ""),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: this.extractSearchContext(),
      source_site: "booking",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    return [];
  }

  extractSearchListings(maxResults: number = 5): ProductData[] {
    const listings: ProductData[] = [];

    // Booking.com search results use [data-testid="property-card"]
    const cardSelectors = [
      '[data-testid="property-card"]',
      '[data-testid="property-card-container"]',
      '.sr_property_block',
      '[data-hotelid]',
    ];

    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    // Fallback: find links to /hotel/ pages
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/hotel/"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (!seen.has(key)) {
          seen.add(key);
          const container = link.closest('[data-testid]') || link.closest('.sr_item') || link.parentElement?.parentElement;
          if (container) cards.push(container);
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
    const linkEl = card.querySelector('a[href*="/hotel/"]') as HTMLAnchorElement | null;
    const url = linkEl?.href || "";
    if (!url) return null;

    // ── Title ──
    const title =
      card.querySelector('[data-testid="title"]')?.textContent?.trim() ||
      card.querySelector('.sr-hotel__name')?.textContent?.trim() ||
      linkEl?.getAttribute("aria-label") ||
      "";

    // ── Price ──
    // Booking.com cards show BOTH per-night and total price.
    // We MUST extract the TOTAL price for consistent comparison.
    // Total price is typically the larger/bolder number; per-night is prefixed
    // with "Per night" text. Strategy: collect all price-like values from the
    // card and pick the LARGEST one (= total stay price).
    let price = "";
    const priceTexts: { value: number; text: string }[] = [];

    // Check known price selectors
    const priceSelectors = [
      '[data-testid="price-and-discounted-price"]',
      '[data-testid="price"]',
      '.bui-price-display__value',
      '.prco-valign-middle-helper',
    ];
    for (const sel of priceSelectors) {
      const el = card.querySelector(sel);
      if (el?.textContent?.trim()) {
        const text = el.textContent.trim();
        const match = text.match(/[\$€£₹¥]?\s*([\d,]+(?:\.\d+)?)/);
        if (match) {
          priceTexts.push({ value: parseFloat(match[1].replace(/,/g, "")), text });
        }
      }
    }

    // Also scan spans for price patterns
    const spans = card.querySelectorAll("span");
    for (const span of spans) {
      const text = span.textContent?.trim() || "";
      const match = text.match(/([\$€£₹¥])\s*([\d,]+(?:\.\d+)?)/);
      if (match) {
        const val = parseFloat(match[2].replace(/,/g, ""));
        priceTexts.push({
          value: val,
          text: `${match[1]}${match[2]}`,
        });
      }
    }

    // Pick the LARGEST price — that's the total stay price.
    // Per-night is always smaller than total.
    if (priceTexts.length > 0) {
      priceTexts.sort((a, b) => b.value - a.value);
      price = priceTexts[0].text;
    }

    // ── Rating ──
    let rating = "";
    const ratingEl = card.querySelector('[data-testid="review-score"]') ||
                     card.querySelector('.bui-review-score__badge');
    if (ratingEl) {
      const text = ratingEl.textContent?.trim() || "";
      const match = text.match(/([\d.]+)/);
      if (match) rating = match[1];
    }
    // Booking uses 1-10 scale; normalize to 5-star for consistency
    if (rating && parseFloat(rating) > 5) {
      rating = (parseFloat(rating) / 2).toFixed(2);
    }

    // ── Review count ──
    let reviewCount = "";
    const cardText = card.textContent || "";
    const revMatch = cardText.match(/([\d,]+)\s*reviews?/i);
    if (revMatch) reviewCount = revMatch[1];

    // ── Image ──
    const imgEl = card.querySelector("img") as HTMLImageElement | null;
    const imageUrl = imgEl?.src || "";

    // ── Property type / subtitle ──
    const subtitle =
      card.querySelector('[data-testid="address"]')?.textContent?.trim() ||
      card.querySelector('[data-testid="distance"]')?.textContent?.trim() ||
      "";

    // ── Badges ──
    let fulfiller = "";
    if (cardText.toLowerCase().includes("genius")) fulfiller = "Genius Property";
    if (cardText.toLowerCase().includes("top pick")) fulfiller = "Top Pick";
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
      source_site: "booking",
      page_type: "search_result",
    };
  }

  // ── Private helpers ──

  private extractPrice(jsonLd: any): string {
    if (jsonLd?.offers?.price) {
      return `${jsonLd.offers.priceCurrency || "$"}${jsonLd.offers.price}`;
    }

    const priceSelectors = [
      '[data-testid="price-and-discounted-price"]',
      '.bui-price-display__value',
      '.prco-valign-middle-helper',
      '[data-testid="price-for-x-nights"]',
    ];
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) {
        const text = el.textContent.trim();
        if (/[\d,]+/.test(text)) return text;
      }
    }

    // Broader search
    const spans = document.querySelectorAll('.hprt-price-price, .bui-f-font-display_two');
    for (const span of spans) {
      const text = span.textContent?.trim() || "";
      if (/[\$€£₹¥]\s*[\d,]+/.test(text)) return text;
    }

    return "";
  }

  private extractRating(): string {
    const selectors = [
      '[data-testid="review-score-component"] [data-testid="review-score-right-component"]',
      '.bui-review-score__badge',
      '[itemprop="ratingValue"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim() || "";
      const match = text.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        // Booking uses 1-10 scale
        return val > 5 ? (val / 2).toFixed(2) : match[1];
      }
    }
    return "";
  }

  private extractReviewCount(): string {
    const body = document.body.textContent || "";
    const match = body.match(/([\d,]+)\s*reviews?/i);
    return match ? match[1] : "";
  }

  private extractPropertyType(): string {
    return extractText([
      '[data-testid="facility-group-icon"]',
      '.hp__hotel-type-badge',
      '.bui-badge',
    ]);
  }

  private extractLocation(jsonLd: any): string {
    if (jsonLd?.address) {
      const a = jsonLd.address;
      const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean);
      return parts.join(", ");
    }
    return extractText([
      '[data-testid="address"]',
      '.hp_address_subtitle',
      '#showMap2 span',
    ]);
  }

  private extractAmenities(): string {
    const amenities: string[] = [];
    const items = document.querySelectorAll(
      '[data-testid="facility-group"] li, .hp-description .facilitiesChecklistSection li, .bui-list__item'
    );
    for (const item of Array.from(items).slice(0, 20)) {
      const text = item.textContent?.trim() || "";
      if (text && text.length < 80) amenities.push(text);
    }
    return amenities.length > 0 ? `[AMENITIES] ${amenities.join(" | ")}` : "";
  }

  private extractCategoryRatings(): string {
    const ratings: string[] = [];
    const items = document.querySelectorAll(
      '[data-testid="review-subscore"], .review_score_name, .c-score-bar'
    );
    for (const item of items) {
      const text = item.textContent?.trim();
      if (text) ratings.push(text);
    }
    return ratings.length > 0 ? `[CATEGORY RATINGS] ${ratings.join(" | ")}` : "";
  }

  private extractReviewSnippets(): string {
    const snippets: string[] = [];
    const reviews = document.querySelectorAll(
      '[data-testid="review-card"], .c-review, .review_item_review_content'
    );
    for (const review of Array.from(reviews).slice(0, 5)) {
      const text = review.textContent?.trim()?.substring(0, 200) || "";
      if (text.length > 20) snippets.push(text);
    }
    return snippets.join("\n---\n");
  }

  private extractCancellation(): string {
    const el = document.querySelector(
      '[data-testid="cancellation-policy"], .mpc-inline-block-maker-helper, [class*="cancellation"]'
    );
    if (el?.textContent?.trim()) return el.textContent.trim().substring(0, 200);

    const body = document.body.textContent || "";
    if (body.toLowerCase().includes("free cancellation")) return "Free cancellation available";
    if (body.toLowerCase().includes("non-refundable")) return "Non-refundable";
    return "";
  }

  private extractCheckInOut(): string {
    const parts: string[] = [];
    const checkIn = extractText(['[data-testid="checkin-date"]', '.bui-date__display']);
    const checkOut = extractText(['[data-testid="checkout-date"]']);
    if (checkIn) parts.push(`Check-in: ${checkIn}`);
    if (checkOut) parts.push(`Check-out: ${checkOut}`);
    return parts.join(" | ");
  }

  private extractHostOrChain(): string {
    return extractText([
      '[data-testid="property-management-company"]',
      '.hp-desc-highlighted',
    ]);
  }

  private extractBadges(): string {
    const badges: string[] = [];
    const body = document.body.textContent?.toLowerCase() || "";
    if (body.includes("genius")) badges.push("Genius Property");
    if (body.includes("top pick")) badges.push("Top Pick");
    if (body.includes("popular choice")) badges.push("Popular Choice");
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
    const dest = params.get("ss") || params.get("dest_id") || "";
    if (dest) parts.push(`destination=${dest}`);
    const checkIn = params.get("checkin") || "";
    const checkOut = params.get("checkout") || "";
    if (checkIn) parts.push(`checkin=${checkIn}`);
    if (checkOut) parts.push(`checkout=${checkOut}`);
    const adults = params.get("group_adults") || "";
    if (adults) parts.push(`adults=${adults}`);

    // Build a working Booking.com search URL for the "Better Alternative" feature
    const searchParams = new URLSearchParams();
    if (dest) searchParams.set("ss", dest);
    if (checkIn) searchParams.set("checkin", checkIn);
    if (checkOut) searchParams.set("checkout", checkOut);
    if (adults) searchParams.set("group_adults", adults);
    const children = params.get("group_children") || "";
    if (children) searchParams.set("group_children", children);
    const rooms = params.get("no_rooms") || "1";
    searchParams.set("no_rooms", rooms);
    const baseSearchUrl = `https://www.booking.com/searchresults.html?${searchParams.toString()}`;
    parts.unshift(`search_base_url=${baseSearchUrl}`);

    return parts.join("&");
  }

  // ── Geo methods for adaptive radius ──

  getMapBounds(): MapBounds | null {
    // Booking URL: ?latitude=X&longitude=Y or map bounds via srepoch/nflt params
    // Sometimes has sw_lat, sw_lng, etc. in URL hash or AJAX params
    // Primary approach: use latitude/longitude as center, estimate bounds from zoom
    return null; // Booking doesn't expose map bounds in URL as cleanly as Airbnb
  }

  getSearchCenter(): SearchCenter | null {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("latitude") || "");
    const lng = parseFloat(params.get("longitude") || "");
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
    // Try map data attributes on the page
    const mapEl = document.querySelector('[data-atlas-latlng]');
    if (mapEl) {
      const latlng = mapEl.getAttribute('data-atlas-latlng');
      if (latlng) {
        const [latStr, lngStr] = latlng.split(',');
        const parsedLat = parseFloat(latStr);
        const parsedLng = parseFloat(lngStr);
        if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
          return { lat: parsedLat, lng: parsedLng };
        }
      }
    }
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("ss") || params.get("dest_id") || "";
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = this.getSearchDestination();
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("checkin") || "",
      checkout: params.get("checkout") || "",
      adults: params.get("group_adults") || "2",
      children: params.get("group_children") || "",
      rooms: params.get("no_rooms") || "1",
    };
  }
}
