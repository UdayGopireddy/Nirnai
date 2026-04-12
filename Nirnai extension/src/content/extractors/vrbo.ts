// Vrbo (Vacation Rentals by Owner) listing page extractor
// Vrbo is owned by Expedia Group, uses similar URL patterns

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("vrbo", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("destination", p.destination);
  if (p.checkin) sp.set("startDate", p.checkin);
  if (p.checkout) sp.set("endDate", p.checkout);
  if (p.adults) sp.set("adults", p.adults);
  if (p.children) sp.set("children", p.children);
  return `https://www.vrbo.com/search?${sp.toString()}`;
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
        if (type === "VacationRental" || type === "LodgingBusiness" || type === "Hotel" || type === "Product" ||
          (Array.isArray(type) && type.some((t: string) => ["VacationRental", "LodgingBusiness", "Hotel", "Product"].includes(t)))) {
          return item;
        }
      }
      if (items.length === 1 && items[0].name) return items[0];
    } catch {}
  }
  return null;
}

export class VrboExtractor implements SiteExtractor {
  siteName(): string { return "vrbo"; }

  isProductPage(): boolean {
    // Vrbo property pages: /unitId or /vacation-rentals/{location}/{unitId}
    if (/\/\d{4,}/.test(window.location.pathname) && !window.location.pathname.includes("/search")) return true;
    if (document.querySelector('[data-stid="content-hotel-title"], h1.uitk-heading')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search")) return true;
    if (document.querySelector('[data-stid="property-listing"], .ResultContainer, [data-testid="property-card"]')) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];

    const cardSelectors = [
      '[data-stid="property-listing"]',
      '[data-testid="property-card"]',
      '.PropertyCard',
      '[data-stid="lodging-card-responsive"]',
      '.ResultContainer li',
    ];
    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) { cards = Array.from(found); break; }
    }

    // Generic fallback: find property links
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/vacation-rental"], a[href*="/search/"], a[href*="unitId"]');
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
        if (card.querySelector('[data-stid="sponsored-label"], [class*="sponsor"]')) continue;
        const titleEl = card.querySelector('[data-stid="content-hotel-title"], h3, h2, [class*="title"] a');
        let title = titleEl?.textContent?.trim() || "";
        if (!title) {
          const ariaEl = card.querySelector('a[aria-label]') as HTMLAnchorElement | null;
          const ariaLabel = ariaEl?.getAttribute('aria-label') || "";
          if (ariaLabel && !ariaLabel.startsWith('Photo gallery')) title = ariaLabel;
        }
        title = title.replace(/^Photo gallery for\s*/i, "");
        if (!title || title.length < 3) continue;
        const linkEl = (card.querySelector('a[href*="/vacation-rental"], a[href*="unitId"]') || card.querySelector('a')) as HTMLAnchorElement | null;
        const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
        if (!url) continue;

        let price = card.querySelector('[data-stid="content-hotel-lead-price"], [data-testid="price-summary"], [class*="price"]')?.textContent?.trim() || "";
        if (!price) {
          for (const span of card.querySelectorAll('span, div')) {
            const t = span.textContent?.trim() || "";
            if (/^\$\d+/.test(t) && t.length < 20) { price = t; break; }
          }
        }

        const ratingEl = card.querySelector('[data-stid="content-hotel-reviews-score"], [class*="rating"], [class*="score"]');
        let rating = ratingEl?.textContent?.trim() || "";
        const rMatch = rating.match(/([\d.]+)/);
        rating = rMatch ? rMatch[1] : "";

        const cardText = card.textContent || "";
        const revMatch = cardText.match(/([\d,]+)\s*reviews?/i);
        const reviewCount = revMatch ? revMatch[1] : "";

        const imgEl = card.querySelector('img') as HTMLImageElement | null;
        listings.push({
          title, brand: "", price, currency: "USD", rating, reviewCount,
          seller: "Vrbo", fulfiller: "Vrbo",
          ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Vacation Rental",
          url: url.split("?")[0], imageUrl: imgEl?.src || "",
          barcode: "", source_site: "vrbo", page_type: "search",
        });
      } catch {}
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = params.get("destination") || params.get("q") || getMeta("og:title")?.replace(/ vacation rentals.*/i, "") || "";
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("startDate") || params.get("checkin") || "",
      checkout: params.get("endDate") || params.get("checkout") || "",
      adults: params.get("adults") || "",
      children: params.get("children") || "",
      rooms: params.get("rooms") || "1",
      query: "",
    };
  }

  getSearchCenter(): SearchCenter | null {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get("lat") || params.get("latitude") || "");
    const lng = parseFloat(params.get("long") || params.get("longitude") || "");
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("destination") || params.get("q") || getMeta("og:title")?.replace(/ vacation rentals.*/i, "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title")?.replace(/ \| Vrbo$/, "") || jsonLd?.name || extractText(['[data-stid="content-hotel-title"]', 'h1.uitk-heading', 'h1']);

    // ── Price ──
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) {
      price = extractText([
        '[data-stid="content-hotel-lead-price"]',
        '[data-testid="price-summary"] span',
        '[class*="price-summary"] span',
        '.price-summary .price',
      ]);
    }
    if (!price) {
      // Generic: scan for $XXX pattern near "per night" or "total"
      for (const el of document.querySelectorAll('span, div, h3, h2')) {
        const t = el.textContent?.trim() || "";
        if (/^\$\d[\d,]*$/.test(t) && t.length < 15) { price = t; break; }
      }
    }

    // ── Rating ──
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) {
      rating = extractText([
        '[data-stid="content-hotel-reviews-score"]',
        '[class*="reviews-score"]',
        '[class*="ReviewScore"]',
        '[class*="rating-badge"]',
      ]);
    }
    if (!rating) {
      // Generic: look for "X.X/10" or "X.X out of" pattern in page text
      const body = document.body.innerText || "";
      const rMatch = body.match(/([\d.]+)\s*\/\s*10\s*(Loved|Exceptional|Wonderful|Very|Good|Pleasant)?/i);
      if (rMatch) {
        // Convert X.X/10 to 5-star scale
        const val = parseFloat(rMatch[1]);
        rating = (val / 2).toFixed(1);
      }
    }

    // ── Review count ──
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    if (!reviewCount) {
      reviewCount = extractText([
        '[data-stid="content-hotel-reviews-total"]',
        '[class*="reviews-count"]',
        '[class*="ReviewCount"]',
      ]).replace(/[()]/g, "");
    }
    if (!reviewCount) {
      // Generic: "See all 285 reviews" or "(285 reviews)" or "285 reviews"
      const body = document.body.innerText || "";
      const revMatch = body.match(/(?:See all |all |\()([\d,]+)\s*reviews?/i) || body.match(/([\d,]+)\s*(?:guest )?reviews?/i);
      if (revMatch) reviewCount = revMatch[1];
    }

    // ── Cancellation ──
    let cancellation = extractText(['[data-stid="free-cancellation"]', '[class*="cancellation"]']);
    if (!cancellation) {
      const body = document.body.innerText || "";
      const cancelMatch = body.match(/(Free cancellation[^\n.]*)/i);
      if (cancelMatch) cancellation = cancelMatch[1].trim();
    }

    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('[data-stid="hero-image"] img, .gallery-image img, img[data-testid]')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Vrbo", fulfiller: "Vrbo",
      ingredients: "", nutritionInfo: "", returnPolicy: cancellation || "Free cancellation varies by property",
      delivery: cancellation,
      category: "Vacation Rental",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "vrbo", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
