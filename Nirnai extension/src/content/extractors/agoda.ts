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
    if (window.location.pathname.includes("/search") || window.location.pathname.includes("/city/") || window.location.pathname.includes("/region/")) {
      return document.querySelector('[data-selenium="hotel-item"], [data-element-name="property-card"], .PropertyCard') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-selenium="hotel-item"], [data-element-name="property-card"], .PropertyCard, [data-hotelid]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-selenium="sponsored-label"], .SponsoredLabel')) continue;

      const titleEl = card.querySelector('[data-selenium="hotel-name"], [data-element-name="property-card-hotel-name"], .hotel-name a, h3 a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (card.querySelector('a[data-selenium="hotel-name-link"], a.hotel-name') || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-selenium="display-price"], [data-element-name="price"], .price-text');
      const ratingEl = card.querySelector('[data-selenium="review-score"], [data-element-name="review-score"], .ReviewScore');
      const reviewEl = card.querySelector('[data-selenium="review-count"], [data-element-name="review-count"]');
      const imgEl = card.querySelector<HTMLImageElement>('[data-selenium="hotel-img"] img, .hotel-image img, img[data-element-name="property-card-image"]');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Agoda", fulfiller: "Agoda",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "agoda", page_type: "search",
      });
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
    const title = getMeta("og:title")?.replace(/ \| Agoda$/, "") || jsonLd?.name || extractText(['[data-selenium="hotel-header-name"]', '#property-name', 'h1']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-selenium="display-price"]', '[data-element-name="final-price"]', '.price-text']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-selenium="review-score"]', '.ReviewScore__score']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-selenium="review-count"]', '.ReviewScore__count']);
    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('[data-selenium="hotel-img"] img, .hotel-gallery img')?.src || "";
    return {
      title, brand: "", price, currency: "USD", rating, reviewCount,
      seller: "Agoda", fulfiller: "Agoda",
      ingredients: "", nutritionInfo: "",
      returnPolicy: extractText(['[data-selenium="cancellation-policy"]', '.cancellation-text']),
      delivery: "",
      category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "agoda", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
