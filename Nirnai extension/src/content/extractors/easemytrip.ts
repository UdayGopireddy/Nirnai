// EaseMyTrip hotel/property page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("easemytrip", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("city", p.destination);
  if (p.checkin) sp.set("checkin", p.checkin);
  if (p.checkout) sp.set("checkout", p.checkout);
  if (p.adults) sp.set("adults", p.adults);
  if (p.rooms) sp.set("rooms", p.rooms || "1");
  return `https://www.easemytrip.com/hotels/search?${sp.toString()}`;
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

export class EaseMyTripExtractor implements SiteExtractor {
  siteName(): string { return "easemytrip"; }

  isProductPage(): boolean {
    if (window.location.pathname.includes("/hotels/hotel-")) return true;
    if (/\/hotels\/[^/]+\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('[class*="hotel-detail"], #hotelDetail')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    if (this.isProductPage()) return false;
    if (window.location.pathname.includes("/hotels/search")) return true;
    if (window.location.pathname.includes("/hotels/listing")) return true;
    if (document.querySelector('[class*="hotel-card"], [class*="hotel_listing"]')) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cardSelectors = [
      '[class*="hotel-card"]',
      '[class*="hotel_listing"]',
      '.hotel-list-card',
      '[class*="htl-card"]',
    ];
    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) { cards = Array.from(found); break; }
    }
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/hotels/hotel-"], a[href*="/hotels/"][href*="/"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (seen.has(key) || href.includes("/search") || href.includes("/listing")) continue;
        seen.add(key);
        const container = link.closest('[class*="card"], [class*="hotel"], li, article') || link.parentElement?.parentElement;
        if (container && container !== document.body) cards.push(container);
      }
    }
    for (const card of cards.slice(0, maxResults)) {
      try {
        if (card.querySelector('[class*="sponsor"], [class*="promoted"]')) continue;
        const titleEl = card.querySelector('h3, h2, [class*="hotel-name"], [class*="hotelName"]');
        const title = titleEl?.textContent?.trim() || "";
        if (!title || title.length < 3) continue;
        const linkEl = (card.querySelector('a[href*="/hotels/"]') || card.querySelector('a')) as HTMLAnchorElement | null;
        const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
        let price = card.querySelector('[class*="Price"], [class*="price"]')?.textContent?.trim() || "";
        if (!price) {
          for (const span of card.querySelectorAll('span, strong')) {
            const t = span.textContent?.trim() || "";
            if (/^₹[\d,]+$/.test(t.replace(/\s/g, "")) && t.length < 15) { price = t; break; }
          }
        }
        const ratingEl = card.querySelector('[class*="rating"], [class*="Rating"]');
        let rating = ratingEl?.textContent?.trim() || "";
        const rMatch = rating.match(/([\d.]+)/);
        rating = rMatch ? rMatch[1] : "";
        const cardText = card.textContent || "";
        const revMatch = cardText.match(/([\d,]+)\s*(?:rating|review)/i);
        const reviewCount = revMatch ? revMatch[1] : "";
        const imgEl = card.querySelector('img') as HTMLImageElement | null;
        listings.push({
          title, brand: "", price, currency: "INR", rating, reviewCount,
          seller: "EaseMyTrip", fulfiller: "EaseMyTrip",
          ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
          url: url.split("?")[0], imageUrl: imgEl?.src || "",
          barcode: "", source_site: "easemytrip", page_type: "search",
        });
      } catch {}
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = params.get("city") || params.get("destination") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
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

  getSearchCenter(): SearchCenter | null { return null; }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("city") || params.get("destination") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title")?.replace(/ - EaseMyTrip$/i, "") || jsonLd?.name || extractText(['h1', '[class*="hotel-name"]']);
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) price = extractText(['[class*="Price"], [class*="price"]']);
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) rating = extractText(['[class*="rating"], [class*="Rating"]']);
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    const imageUrl = getMeta("og:image") || jsonLd?.image || "";
    return {
      title, brand: "", price, currency: "INR", rating, reviewCount,
      seller: "EaseMyTrip", fulfiller: "EaseMyTrip",
      ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "easemytrip", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
