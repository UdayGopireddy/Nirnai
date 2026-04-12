// Tripadvisor hotel/attraction page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("tripadvisor", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("searchNearby", "false");
  if (p.checkin) sp.set("checkin", p.checkin);
  if (p.checkout) sp.set("checkout", p.checkout);
  if (p.adults) sp.set("adults", p.adults);
  if (p.rooms) sp.set("rooms", p.rooms);
  // Tripadvisor search is geo-based; keyword search goes through /Search
  return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(p.destination || "")}&${sp.toString()}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

function getMeta(property: string): string {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`) as HTMLMetaElement | null;
  return el?.content?.trim() || "";
}

function getJsonLd(): any | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || "");
      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const item of items) {
        const type = item["@type"];
        if (type === "Hotel" || type === "LodgingBusiness" || type === "TouristAttraction" || type === "Restaurant" || type === "Product" ||
          (Array.isArray(type) && type.some((t: string) => ["Hotel", "LodgingBusiness", "TouristAttraction", "Restaurant"].includes(t)))) {
          return item;
        }
      }
      if (items.length === 1 && items[0].name) return items[0];
    } catch {}
  }
  return null;
}

export class TripadvisorExtractor implements SiteExtractor {
  siteName(): string { return "tripadvisor"; }

  isProductPage(): boolean {
    // Hotel pages: /Hotel_Review-g{geoId}-d{detailId}-Reviews-...
    if (/\/Hotel_Review-/.test(window.location.pathname)) return true;
    // Vacation rental: /VacationRentalReview-
    if (/\/VacationRentalReview-/.test(window.location.pathname)) return true;
    // Attraction: /Attraction_Review-
    if (/\/Attraction_Review-/.test(window.location.pathname)) return true;
    if (document.querySelector('#HEADING, [data-test-target="hotel-header-name"], h1#HEADING')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    // Hotel search: /Hotels-g{geoId}-...
    if (/\/Hotels-g\d+/.test(window.location.pathname)) return true;
    // Search results: /Search?q=...
    if (window.location.pathname.includes("/Search")) return true;
    // Vacation rentals list
    if (/\/VacationRentals-g\d+/.test(window.location.pathname)) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];

    // Try multiple known selectors in priority order
    const cardSelectors = [
      '[data-test-target="property-card"]',
      '[data-automation="hotel-card"]',
      '.property-card',
      '[data-automation="hotel-card-title"]',
      '.listing_title',
      '.prw_rup.prw_meta_hsx_responsive_listing',
      // Modern TripAdvisor (2025+)
      'div[data-automation="hotel-card-list"] > div',
      'div[class*="resultCard"]',
      'div[class*="PropertyCard"]',
    ];
    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) { cards = Array.from(found); break; }
    }

    // Generic fallback: find hotel links
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="Hotel_Review"], a[href*="/Hotel/"], a[href*="VacationRentalReview"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (seen.has(key) || href.includes("/ShowUserReviews")) continue;
        seen.add(key);
        const container = link.closest('[class*="card"], [class*="listing"], [class*="result"], li, article, [class*="property"]') || link.parentElement?.parentElement;
        if (container && container !== document.body) cards.push(container);
      }
    }

    for (const card of cards.slice(0, maxResults)) {
      try {
        if (card.querySelector('.sponsored-label, [data-test-target="sponsored"], [class*="sponsor"]')) continue;

        const titleEl = card.querySelector('[data-automation="hotel-card-title"] a, [data-test-target="property-link"], a[href*="Hotel_Review"], a[href*="/Hotel/"], h3, h2, [class*="title"] a');
        const title = titleEl?.textContent?.trim() || (card.querySelector('a') as HTMLAnchorElement)?.getAttribute('aria-label') || "";
        if (!title || title.length < 3) continue;
        const linkEl = (card.querySelector('a[href*="Hotel_Review"], a[href*="/Hotel/"]') || titleEl || card.querySelector('a')) as HTMLAnchorElement | null;
        const url = linkEl?.href ? new URL(linkEl.href, window.location.origin).href : "";
        if (!url) continue;

        // Price
        let price = card.querySelector('[data-automation="hotel-card-price"], [data-test-target="property-price"], [class*="price"]')?.textContent?.trim() || "";
        if (!price) {
          for (const span of card.querySelectorAll('span, div')) {
            const t = span.textContent?.trim() || "";
            if (/^\$\d+/.test(t) && t.length < 20) { price = t; break; }
          }
        }

        // Rating — try aria-label, bubble classes, or text
        let rating = "";
        const ratingEl = card.querySelector('[aria-label*="bubble"], [aria-label*="star"], [aria-label*="rating"], [class*="bubble"], svg[aria-label], [class*="rating"], [class*="score"]');
        if (ratingEl) {
          const ariaLabel = ratingEl.getAttribute('aria-label') || "";
          const rMatch = ariaLabel.match(/([\d.]+)/);
          if (rMatch) rating = rMatch[1];
          if (!rating) {
            const classMatch = ratingEl.getAttribute('class')?.match(/bubble_(\d+)/);
            if (classMatch) rating = (parseInt(classMatch[1]) / 10).toFixed(1);
          }
          if (!rating) {
            const textMatch = ratingEl.textContent?.trim()?.match(/([\d.]+)/);
            if (textMatch) rating = textMatch[1];
          }
        }

        // Review count
        const cardText = card.textContent || "";
        const revMatch = cardText.match(/([\d,]+)\s*reviews?/i);
        const reviewCount = revMatch ? revMatch[1] : "";

        const imgEl = card.querySelector('img') as HTMLImageElement | null;
        listings.push({
          title, brand: "", price, currency: "USD", rating, reviewCount,
          seller: "Tripadvisor", fulfiller: "Tripadvisor",
          ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
          url: url.split("?")[0], imageUrl: imgEl?.src || "",
          barcode: "", source_site: "tripadvisor", page_type: "search",
        });
      } catch {}
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    // Try to extract destination from URL pattern: /Hotels-g{geoId}-{destination}-Hotels.html
    const pathMatch = window.location.pathname.match(/\/Hotels-g\d+-([^-]+)-Hotels/);
    const destination = params.get("q") || (pathMatch ? pathMatch[1].replace(/_/g, " ") : "") || getMeta("og:title")?.replace(/ Hotels.*/i, "").replace(/ -.*/, "") || "";
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("checkin") || "",
      checkout: params.get("checkout") || "",
      adults: params.get("adults") || "",
      children: params.get("children") || "",
      rooms: params.get("rooms") || "1",
      query: "",
    };
  }

  getSearchCenter(): SearchCenter | null {
    // Tripadvisor embeds geo in the geoId; not easily extractable from URL
    // Check for map bounds in page data
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(/"latitude":\s*([-\d.]+).*?"longitude":\s*([-\d.]+)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
      }
    }
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/\/Hotels-g\d+-([^-]+)-Hotels/);
    return params.get("q") || (pathMatch ? pathMatch[1].replace(/_/g, " ") : "") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title")?.replace(/ - (?:Prices|Reviews|Updated).*/i, "") || jsonLd?.name || extractText(['#HEADING', '[data-test-target="hotel-header-name"]', 'h1']);

    // ── Price ──
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) price = extractText(['[data-test-target="price-summary"]', '[class*="price"]', '.prw_rup .price']);
    if (!price) {
      for (const el of document.querySelectorAll('span, div')) {
        const t = el.textContent?.trim() || "";
        if (/^\$\d[\d,]*$/.test(t) && t.length < 15) { price = t; break; }
      }
    }

    // ── Rating ──
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) {
      // Try aria-label on bubble/star elements
      const ratingEl = document.querySelector('[aria-label*="bubble"], [aria-label*="star"], [aria-label*="rating"], svg[aria-label], [class*="bubble"], [class*="rating"]');
      if (ratingEl) {
        const ariaLabel = ratingEl.getAttribute('aria-label') || "";
        const rMatch = ariaLabel.match(/([\d.]+)/);
        if (rMatch) rating = rMatch[1];
        if (!rating) {
          const classMatch = ratingEl.getAttribute('class')?.match(/bubble_(\d+)/);
          if (classMatch) rating = (parseInt(classMatch[1]) / 10).toFixed(1);
        }
      }
    }
    if (!rating) {
      const body = document.body.innerText || "";
      const rMatch = body.match(/(\d+\.?\d*)\s*(?:of 5|out of 5|\/ ?5)/i);
      if (rMatch) rating = rMatch[1];
    }

    // ── Review count ──
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    if (!reviewCount) reviewCount = extractText(['[data-test-target="review-count"]', '[class*="reviewCount"]', '.reviewCount']).replace(/[(),reviews ]/gi, "");
    if (!reviewCount) {
      const body = document.body.innerText || "";
      const revMatch = body.match(/([\d,]+)\s*reviews?/i);
      if (revMatch) reviewCount = revMatch[1];
    }

    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('.heroPhoto img, [data-test-target="hero-image"] img, img[data-testid]')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Tripadvisor", fulfiller: "Tripadvisor",
      ingredients: "", nutritionInfo: "",
      returnPolicy: "Free cancellation varies",
      delivery: "",
      category: jsonLd?.["@type"] || "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "tripadvisor", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
