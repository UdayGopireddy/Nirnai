// Google Travel / Google Hotels page extractor
// Strategic aggregator layer — not a direct booking site

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("googletravel", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("q", p.destination);
  if (p.checkin) sp.set("g2lb", ""); // Google uses encoded params
  return `https://www.google.com/travel/hotels/${encodeURIComponent(p.destination || "")}?${sp.toString()}`;
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

export class GoogleTravelExtractor implements SiteExtractor {
  siteName(): string { return "googletravel"; }

  isProductPage(): boolean {
    // Google Travel hotel detail: /travel/hotels/entity/{id} or hotel detail overlay
    if (/\/travel\/hotels\/.*\/entity\//.test(window.location.pathname)) return true;
    if (document.querySelector('[data-hotel-id], .hotel-details, [jsname="CJlqef"]')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    if (/\/travel\/hotels/.test(window.location.pathname) && !this.isProductPage()) {
      return document.querySelector('[data-hotel-id], .hotel-card, [jsname="mutHjb"], .property-card') !== null;
    }
    if (/\/travel\/search/.test(window.location.pathname)) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    // Google Hotels uses dynamic rendering; cards have data-hotel-id or similar markers
    const cards = document.querySelectorAll('[data-hotel-id], .hotel-card, [jsname="mutHjb"], [data-result-id]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-is-ad="true"], .sponsored')) continue;

      const titleEl = card.querySelector('h2, h3, [aria-label], .hotel-name, [jsname="Xi8eDc"]');
      const title = titleEl?.textContent?.trim() || titleEl?.getAttribute("aria-label") || "";
      if (!title) continue;
      const linkEl = (card.querySelector('a[href*="/travel/hotels/"]') || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";

      const priceEl = card.querySelector('[data-price], .price, [jsname="TjNFJd"], .hotel-price');
      const ratingEl = card.querySelector('[aria-label*="star"], [aria-label*="rating"], .rating, [jsname="GiLjY"]');
      const reviewEl = card.querySelector('[aria-label*="review"], .review-count');
      const imgEl = card.querySelector<HTMLImageElement>('img[data-src], img.hotel-image, img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || priceEl?.getAttribute("data-price") || "",
        currency: "USD",
        rating: ratingEl?.textContent?.trim() || ratingEl?.getAttribute("aria-label")?.match(/([\d.]+)/)?.[1] || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[(),reviews ]/gi, "") || "",
        seller: "Google Travel", fulfiller: "Google Travel",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
        url: url || window.location.href, imageUrl: imgEl?.src || imgEl?.getAttribute("data-src") || "",
        barcode: "", source_site: "googletravel", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    // Google Travel puts destination in the URL path or q param
    const pathMatch = window.location.pathname.match(/\/travel\/hotels\/([^/]+)/);
    const destination = params.get("q") || (pathMatch ? decodeURIComponent(pathMatch[1]).replace(/_/g, " ") : "") || "";
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
    // Google Travel embeds coordinates in URL hash or encoded params
    const hash = window.location.hash;
    const match = hash.match(/@([-\d.]+),([-\d.]+)/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    return null;
  }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/\/travel\/hotels\/([^/]+)/);
    return params.get("q") || (pathMatch ? decodeURIComponent(pathMatch[1]).replace(/_/g, " ") : "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title") || jsonLd?.name || extractText(['h1', 'h2', '[role="heading"]']);

    // ── Price ──
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) price = extractText(['[data-price]', '[class*="price"]']);
    if (!price) {
      for (const el of document.querySelectorAll('span, div')) {
        const t = el.textContent?.trim() || "";
        if (/^\$\d[\d,]*$/.test(t) && t.length < 15) { price = t; break; }
      }
    }

    // ── Rating ──
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) {
      // Google Travel uses aria-label on star elements
      const ratingEl = document.querySelector('[aria-label*="star"], [aria-label*="rating"], [aria-label*="rated"]');
      if (ratingEl) {
        const ariaLabel = ratingEl.getAttribute('aria-label') || "";
        const rMatch = ariaLabel.match(/([\d.]+)/);
        if (rMatch) rating = rMatch[1];
      }
    }
    if (!rating) {
      const body = document.body.innerText || "";
      const rMatch = body.match(/(\d+\.?\d*)\s*(?:\/\s*5|out of 5|stars?)/i);
      if (rMatch) rating = rMatch[1];
    }

    // ── Review count ──
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    if (!reviewCount) {
      const ratingEl = document.querySelector('[aria-label*="review"]');
      if (ratingEl) {
        const ariaLabel = ratingEl.getAttribute('aria-label') || "";
        const revMatch = ariaLabel.match(/([\d,]+)\s*reviews?/i);
        if (revMatch) reviewCount = revMatch[1];
      }
    }
    if (!reviewCount) {
      const body = document.body.innerText || "";
      const revMatch = body.match(/([\d,]+)\s*(?:Google )?reviews?/i);
      if (revMatch) reviewCount = revMatch[1];
    }

    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('img[src*="lh"], img[src*="photo"], .gallery img')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Google Travel", fulfiller: "Google Travel",
      ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "",
      category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "googletravel", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
