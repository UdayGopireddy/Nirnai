// Hotels.com listing page extractor
// Hotels.com is owned by Expedia Group, shares similar DOM patterns

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("hotels", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("q-destination", p.destination);
  if (p.checkin) sp.set("q-check-in", p.checkin);
  if (p.checkout) sp.set("q-check-out", p.checkout);
  if (p.adults) sp.set("q-room-0-adults", p.adults);
  if (p.children) sp.set("q-room-0-children", p.children);
  sp.set("q-rooms", p.rooms || "1");
  return `https://www.hotels.com/Hotel-Search?${sp.toString()}`;
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
        if (type === "Hotel" || type === "LodgingBusiness" || type === "Product" ||
          (Array.isArray(type) && type.some((t: string) => ["Hotel", "LodgingBusiness", "Product"].includes(t)))) {
          return item;
        }
      }
      if (items.length === 1 && items[0].name) return items[0];
    } catch {}
  }
  return null;
}

export class HotelsExtractor implements SiteExtractor {
  siteName(): string { return "hotels"; }

  isProductPage(): boolean {
    // Hotels.com property pages: /ho{id}/ or /hotel-info.html
    if (/\/ho\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('[data-stid="content-hotel-title"], h1.uitk-heading, [data-stid="property-header"]')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/Hotel-Search") || window.location.pathname.includes("/search")) return true;
    if (document.querySelector('[data-stid="property-listing"], [data-testid="property-card"], .uitk-card')) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];

    // Try known selectors first
    const cardSelectors = [
      '[data-stid="property-listing"]',
      '[data-testid="property-card"]',
      '.property-listing',
      '[data-stid="lodging-card-responsive"]',
      '.uitk-card-has-primary-theme',
    ];
    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) { cards = Array.from(found); break; }
    }

    // Generic fallback: find hotel links and walk up to parent card
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/ho"], a[href*="Hotel"], a[href*="/hotel/"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (seen.has(key)) continue;
        seen.add(key);
        const container = link.closest('[class*="card"], [class*="listing"], [class*="property"], li, article') || link.parentElement?.parentElement;
        if (container && container !== document.body) cards.push(container);
      }
    }

    for (const card of cards.slice(0, maxResults)) {
      try {
        if (card.querySelector('[data-stid="sponsored-listing-label"], [class*="sponsor"]')) continue;
        const titleEl = card.querySelector('[data-stid="content-hotel-title"], h3, h2, [class*="title"] a');
        let title = titleEl?.textContent?.trim() || "";
        if (!title) {
          const ariaEl = card.querySelector('a[aria-label]') as HTMLAnchorElement | null;
          const ariaLabel = ariaEl?.getAttribute('aria-label') || "";
          if (ariaLabel && !ariaLabel.startsWith('Photo gallery')) title = ariaLabel;
        }
        title = title.replace(/^Photo gallery for\s*/i, "");
        if (!title || title.length < 3) continue;
        const linkEl = (card.querySelector('a[href*="/ho"], a[href*="Hotel"]') || card.querySelector('a')) as HTMLAnchorElement | null;
        const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
        if (!url) continue;

        // Price: try known selectors, then generic pattern
        let price = card.querySelector('[data-stid="content-hotel-lead-price"], [data-testid="price-summary"], [class*="price"]')?.textContent?.trim() || "";
        if (!price) {
          for (const span of card.querySelectorAll('span, div')) {
            const t = span.textContent?.trim() || "";
            if (/^\$\d+/.test(t) && t.length < 20) { price = t; break; }
          }
        }

        // Rating
        const ratingEl = card.querySelector('[data-stid="content-hotel-reviews-score"], [class*="rating"], [class*="badge"], [class*="score"]');
        let rating = ratingEl?.textContent?.trim() || "";
        const rMatch = rating.match(/([\d.]+)/);
        rating = rMatch ? rMatch[1] : "";

        // Review count
        const cardText = card.textContent || "";
        const revMatch = cardText.match(/([\d,]+)\s*reviews?/i);
        const reviewCount = revMatch ? revMatch[1] : "";

        const imgEl = card.querySelector('img') as HTMLImageElement | null;
        listings.push({
          title, brand: "", price, currency: "USD", rating, reviewCount,
          seller: "Hotels.com", fulfiller: "Hotels.com",
          ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
          url: url.split("?")[0], imageUrl: imgEl?.src || "",
          barcode: "", source_site: "hotels", page_type: "search",
        });
      } catch {}
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = params.get("q-destination") || params.get("destination") || params.get("q") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("q-check-in") || params.get("startDate") || params.get("checkIn") || "",
      checkout: params.get("q-check-out") || params.get("endDate") || params.get("checkOut") || "",
      adults: params.get("q-room-0-adults") || params.get("adults") || "",
      children: params.get("q-room-0-children") || params.get("children") || "",
      rooms: params.get("q-rooms") || params.get("rooms") || "1",
      query: "",
    };
  }

  getSearchCenter(): SearchCenter | null {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("latitude") || params.get("lat") || "");
    const lng = parseFloat(params.get("longitude") || params.get("lon") || "");
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("q-destination") || params.get("destination") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title")?.replace(/ \| Hotels\.com$/, "") || jsonLd?.name || extractText(['[data-stid="content-hotel-title"]', 'h1.uitk-heading', 'h1']);

    // ── Price ──
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) price = extractText(['[data-stid="content-hotel-lead-price"]', '[data-testid="price-summary"]', '[class*="price-summary"]', '.uitk-text-emphasis-theme .price']);
    if (!price) {
      for (const el of document.querySelectorAll('span, div')) {
        const t = el.textContent?.trim() || "";
        if (/^\$\d[\d,]*$/.test(t) && t.length < 15) { price = t; break; }
      }
    }

    // ── Rating ──
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) rating = extractText(['[data-stid="content-hotel-reviews-score"]', '[class*="reviews-score"]', '[class*="rating"]', '.guest-rating']);
    if (!rating) {
      const body = document.body.innerText || "";
      const rMatch = body.match(/(\d+\.?\d*)\s*\/\s*10/i);
      if (rMatch) rating = (parseFloat(rMatch[1]) / 2).toFixed(1);
    }

    // ── Review count ──
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    if (!reviewCount) reviewCount = extractText(['[data-stid="content-hotel-reviews-total"]', '[class*="reviews-count"]', '.guest-reviews-count']).replace(/[()]/g, "");
    if (!reviewCount) {
      const body = document.body.innerText || "";
      const revMatch = body.match(/(?:See all |all |\()?([\d,]+)\s*(?:guest )?reviews?/i);
      if (revMatch) reviewCount = revMatch[1];
    }

    // ── Cancellation ──
    let cancellation = extractText(['[data-stid="free-cancellation"]', '[class*="cancellation"]', '.cancellation-info']);
    if (!cancellation) {
      const body = document.body.innerText || "";
      const m = body.match(/(Free cancellation[^\n.]*)/i);
      if (m) cancellation = m[1].trim();
    }

    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('[data-stid="hero-image"] img, .gallery-image img, img[data-testid]')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Hotels.com", fulfiller: "Hotels.com",
      ingredients: "", nutritionInfo: "",
      returnPolicy: cancellation || "",
      delivery: "",
      category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "hotels", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
