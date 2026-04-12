// Agoda hotel/property page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("agoda", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("textToSearch", p.destination);
  if (p.checkin) sp.set("checkIn", p.checkin);
  if (p.checkout) sp.set("checkOut", p.checkout);
  if (p.adults) sp.set("adults", p.adults);
  if (p.children) sp.set("children", p.children);
  sp.set("rooms", p.rooms || "1");
  return `https://www.agoda.com/search?${sp.toString()}`;
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
        if (type === "Hotel" || type === "LodgingBusiness" || type === "VacationRental" || type === "Product" ||
          (Array.isArray(type) && type.some((t: string) => ["Hotel", "LodgingBusiness", "VacationRental", "Product"].includes(t)))) {
          return item;
        }
      }
      if (items.length === 1 && items[0].name) return items[0];
    } catch {}
  }
  return null;
}

export class AgodaExtractor implements SiteExtractor {
  siteName(): string { return "agoda"; }

  isProductPage(): boolean {
    // Agoda property pages: /hotel-name/{city}...html or /{property-name}/{id}.html
    if (document.querySelector('[data-selenium="hotel-header-name"], [data-element-name="property-name"], h1#property-name')) return true;
    if (/\/hotel\/|\/homes\//.test(window.location.pathname) && document.querySelector('[data-element-name="price-container"]')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search") || window.location.pathname.includes("/city/") || window.location.pathname.includes("/region/")) return true;
    if (document.querySelector('[data-selenium="hotel-item"], [data-element-name="property-card"], .PropertyCard')) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];

    const cardSelectors = [
      '[data-selenium="hotel-item"]',
      '[data-element-name="property-card"]',
      '.PropertyCard',
      '[data-hotelid]',
      '[data-cy="hotel-card"]',
      'li[data-hotel-id]',
      'ol[id="hotel-list-container"] > li',
    ];
    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) { cards = Array.from(found); break; }
    }

    // Generic fallback: find hotel links
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/hotel/"], a[href*="/homes/"], a[href*="propertyId"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (seen.has(key) || href.includes("/city/")) continue;
        seen.add(key);
        const container = link.closest('[class*="card"], [class*="hotel"], [class*="property"], li, article') || link.parentElement?.parentElement;
        if (container && container !== document.body) cards.push(container);
      }
    }

    for (const card of cards.slice(0, maxResults)) {
      try {
        if (card.querySelector('[data-selenium="sponsored-label"], .SponsoredLabel, [class*="sponsor"]')) continue;
        const titleEl = card.querySelector('[data-selenium="hotel-name"], [data-element-name="property-card-hotel-name"], h3, h2, [class*="hotel-name"], [class*="PropertyName"]');
        const title = titleEl?.textContent?.trim() || (card.querySelector('a') as HTMLAnchorElement)?.getAttribute('aria-label') || "";
        if (!title || title.length < 3) continue;
        const linkEl = (card.querySelector('a[href*="/hotel/"], a[href*="/homes/"]') || card.querySelector('a')) as HTMLAnchorElement | null;
        const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
        if (!url || url.includes("/city/") || url.includes("/region/")) continue;

        let price = card.querySelector('[data-selenium="display-price"], [data-element-name="price"], [class*="Price"], [class*="price"]')?.textContent?.trim() || "";
        if (!price) {
          for (const span of card.querySelectorAll('span, strong')) {
            const t = span.textContent?.trim() || "";
            if (/^\$\d+|^\d+$/.test(t.replace(/,/g, "")) && t.length < 15) { price = t; break; }
          }
        }

        const ratingEl = card.querySelector('[data-selenium="review-score"], [data-element-name="review-score"], [class*="ReviewScore"], [class*="review-score"], [class*="rating"]');
        let rating = ratingEl?.textContent?.trim() || "";
        const rMatch = rating.match(/([\d.]+)/);
        rating = rMatch ? rMatch[1] : "";

        const cardText = card.textContent || "";
        const revMatch = cardText.match(/([\d,]+)\s*reviews?/i);
        const reviewCount = revMatch ? revMatch[1] : "";

        const imgEl = card.querySelector('img') as HTMLImageElement | null;
        listings.push({
          title, brand: "", price, currency: "USD", rating, reviewCount,
          seller: "Agoda", fulfiller: "Agoda",
          ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
          url: url.split("?")[0], imageUrl: imgEl?.src || "",
          barcode: "", source_site: "agoda", page_type: "search",
        });
      } catch {}
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = params.get("textToSearch") || params.get("city") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("checkIn") || params.get("check_in") || "",
      checkout: params.get("checkOut") || params.get("check_out") || "",
      adults: params.get("adults") || params.get("numberOfGuests") || "",
      children: params.get("children") || "",
      rooms: params.get("rooms") || "1",
      query: "",
    };
  }

  getSearchCenter(): SearchCenter | null {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("lat") || "");
    const lng = parseFloat(params.get("lng") || params.get("lon") || "");
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("textToSearch") || params.get("city") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title")?.replace(/ \| Agoda$/, "") || jsonLd?.name || extractText(['[data-selenium="hotel-header-name"]', '#property-name', '[data-element-name="property-name"]', 'h1']);

    // ── Price ──
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) price = extractText(['[data-selenium="display-price"]', '[data-element-name="final-price"]', '[class*="Price"]', '[class*="price"]', '.price-text']);
    if (!price) {
      for (const el of document.querySelectorAll('span, strong, div')) {
        const t = el.textContent?.trim() || "";
        if (/^\$\d[\d,]*$/.test(t) && t.length < 15) { price = t; break; }
      }
    }

    // ── Rating ──
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) rating = extractText(['[data-selenium="review-score"]', '[data-element-name="review-score"]', '[class*="ReviewScore"]', '[class*="review-score"]', '[class*="rating"]']);
    if (!rating) {
      const body = document.body.innerText || "";
      const rMatch = body.match(/(\d+\.?\d*)\s*\/\s*10/i);
      if (rMatch) rating = (parseFloat(rMatch[1]) / 2).toFixed(1);
    }

    // ── Review count ──
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    if (!reviewCount) reviewCount = extractText(['[data-selenium="review-count"]', '[data-element-name="review-count"]', '[class*="ReviewCount"]', '.ReviewScore__count']).replace(/[()]/g, "");
    if (!reviewCount) {
      const body = document.body.innerText || "";
      const revMatch = body.match(/([\d,]+)\s*(?:verified )?reviews?/i);
      if (revMatch) reviewCount = revMatch[1];
    }

    // ── Cancellation ──
    let cancellation = extractText(['[data-selenium="cancellation-policy"]', '[class*="cancellation"]', '.cancellation-text']);
    if (!cancellation) {
      const body = document.body.innerText || "";
      const m = body.match(/(Free cancellation[^\n.]*)/i);
      if (m) cancellation = m[1].trim();
    }

    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('[data-selenium="hotel-img"] img, .hotel-gallery img, img[data-element-name]')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Agoda", fulfiller: "Agoda",
      ingredients: "", nutritionInfo: "",
      returnPolicy: cancellation || "",
      delivery: "",
      category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "agoda", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
