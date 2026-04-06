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
    const cards = document.querySelectorAll('[data-automation="hotel-card-title"], .listing_title, .prw_rup.prw_meta_hsx_responsive_listing, [data-test-target="property-card"]');

    // Try the more modern card layout first
    const modernCards = document.querySelectorAll('[data-test-target="property-card"], .property-card, [data-automation="hotel-card"]');
    const cardList = modernCards.length > 0 ? modernCards : cards;

    for (const card of cardList) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('.sponsored-label, [data-test-target="sponsored"]')) continue;

      const titleEl = card.querySelector('[data-automation="hotel-card-title"] a, .listing_title a, a[data-test-target="property-link"], .property-name a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (titleEl || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-automation="hotel-card-price"], .price, [data-test-target="property-price"], .prw_rup .price');
      const ratingEl = card.querySelector('[data-automation="hotel-card-rating"], .ui_bubble_rating, [data-test-target="review-rating"], svg[aria-label*="bubble"]');
      const reviewEl = card.querySelector('[data-automation="hotel-card-review-count"], .review_count, [data-test-target="review-count"]');
      const imgEl = card.querySelector<HTMLImageElement>('[data-automation="hotel-card-image"] img, .listing-photo img, img[data-test-target="property-image"]');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.getAttribute("class")?.match(/bubble_(\d+)/)?.[1]?.replace(/(\d)(\d)/, "$1.$2") || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[(),reviews ]/gi, "") || "",
        seller: "Tripadvisor", fulfiller: "Tripadvisor",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "tripadvisor", page_type: "search",
      });
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
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-test-target="price-summary"]', '.price', '.prw_rup .price']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-test-target="review-rating"]', '.ui_bubble_rating']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-test-target="review-count"]', '.reviewCount']);
    const imageUrl = getMeta("og:image") || jsonLd?.image || document.querySelector<HTMLImageElement>('.heroPhoto img, [data-test-target="hero-image"] img')?.src || "";
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
