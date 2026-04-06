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
    if (window.location.pathname.includes("/search")) {
      return document.querySelector('[data-stid="property-listing"], .ResultContainer, [data-testid="property-card"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-stid="property-listing"], [data-testid="property-card"], .PropertyCard');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-stid="sponsored-label"]')) continue;

      const titleEl = card.querySelector('[data-stid="content-hotel-title"], h3, .property-name a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (card.querySelector('a[data-stid="open-hotel-information"], a.property-name') || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-stid="content-hotel-lead-price"], .price-summary .price, [data-testid="price-summary"]');
      const ratingEl = card.querySelector('[data-stid="content-hotel-reviews-score"], .guest-reviews-badge, [data-testid="review-score"]');
      const reviewEl = card.querySelector('[data-stid="content-hotel-reviews-total"], .guest-reviews-count');
      const imgEl = card.querySelector<HTMLImageElement>('[data-stid="property-card-image"] img, .property-image img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Vrbo", fulfiller: "Vrbo",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Vacation Rental",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "vrbo", page_type: "search",
      });
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
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-stid="content-hotel-lead-price"]', '.price-summary .price', '[data-testid="price-summary"] span']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-stid="content-hotel-reviews-score"]', '.reviews-score']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-stid="content-hotel-reviews-total"]', '.reviews-count']);
    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('[data-stid="hero-image"] img, .gallery-image img')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Vrbo", fulfiller: "Vrbo",
      ingredients: "", nutritionInfo: "", returnPolicy: "Free cancellation varies by property",
      delivery: extractText(['[data-stid="free-cancellation"]', '.cancellation-policy']),
      category: "Vacation Rental",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "vrbo", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
