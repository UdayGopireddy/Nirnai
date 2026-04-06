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
    if (window.location.pathname.includes("/Hotel-Search") || window.location.pathname.includes("/search")) {
      return document.querySelector('[data-stid="property-listing"], [data-testid="property-card"], .uitk-card') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-stid="property-listing"], [data-testid="property-card"], .property-listing');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-stid="sponsored-listing-label"]')) continue;

      const titleEl = card.querySelector('[data-stid="content-hotel-title"], h3.uitk-heading, .property-name');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (card.querySelector('a[data-stid="open-hotel-information"]') || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-stid="content-hotel-lead-price"], .uitk-text-emphasis-theme .price, [data-testid="price-summary"]');
      const ratingEl = card.querySelector('[data-stid="content-hotel-reviews-score"], .uitk-badge-base-text, .guest-rating');
      const reviewEl = card.querySelector('[data-stid="content-hotel-reviews-total"], .guest-reviews-count');
      const imgEl = card.querySelector<HTMLImageElement>('[data-stid="property-card-image"] img, .uitk-image img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Hotels.com", fulfiller: "Hotels.com",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "hotels", page_type: "search",
      });
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
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-stid="content-hotel-lead-price"]', '.uitk-text-emphasis-theme .price']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-stid="content-hotel-reviews-score"]', '.guest-rating']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-stid="content-hotel-reviews-total"]', '.guest-reviews-count']);
    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('[data-stid="hero-image"] img, .gallery-image img')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Hotels.com", fulfiller: "Hotels.com",
      ingredients: "", nutritionInfo: "",
      returnPolicy: extractText(['[data-stid="free-cancellation"]', '.cancellation-info']),
      delivery: "",
      category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "hotels", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
