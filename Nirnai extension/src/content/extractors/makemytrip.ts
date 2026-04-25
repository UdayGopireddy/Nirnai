// MakeMyTrip hotel/property page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

registerSearchUrlBuilder("makemytrip", (p: CrossSiteSearchParams): string => {
  const sp = new URLSearchParams();
  if (p.destination) sp.set("searchText", p.destination);
  if (p.checkin) sp.set("checkin", p.checkin.replace(/-/g, ""));
  if (p.checkout) sp.set("checkout", p.checkout.replace(/-/g, ""));
  if (p.adults) sp.set("roomStayQualifier", `${p.adults}e0e`);
  return `https://www.makemytrip.com/hotels/hotel-listing/?${sp.toString()}`;
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

export class MakeMyTripExtractor implements SiteExtractor {
  siteName(): string { return "makemytrip"; }

  isProductPage(): boolean {
    if (window.location.pathname.includes("/hotel-details")) return true;
    if (document.querySelector('#hotel-detail, [data-testid="hotel-detail"], .hotelDetailsCont')) return true;
    return false;
  }

  isCartPage(): boolean { return false; }

  isSearchPage(): boolean {
    if (this.isProductPage()) return false;
    if (window.location.pathname.includes("/hotel-listing")) return true;
    if (window.location.pathname.includes("/hotels-in-")) return true;
    if (document.querySelector('[data-testid="hotel-card"], .listingCard, #hotelListingContainer')) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cardSelectors = [
      '[data-testid="hotel-card"]',
      '.listingCard',
      '#listing_hotel_card',
      '.makeFlex.hrtlCenter.appendBottom12',
    ];
    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 1) { cards = Array.from(found); break; }
    }
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/hotel-details"]');
      const seen = new Set<string>();
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;
        const key = href.split("?")[0];
        if (seen.has(key)) continue;
        seen.add(key);
        const container = link.closest('[class*="card"], [class*="listing"], li, article') || link.parentElement?.parentElement;
        if (container && container !== document.body) cards.push(container);
      }
    }
    for (const card of cards.slice(0, maxResults)) {
      try {
        if (card.querySelector('[class*="sponsor"], [class*="promoted"]')) continue;
        const titleEl = card.querySelector('p[class*="hotelName"], h3, h2, [class*="hotel-name"], [data-testid="hotel-name"]');
        const title = titleEl?.textContent?.trim() || (card.querySelector('a') as HTMLAnchorElement)?.getAttribute('aria-label') || "";
        if (!title || title.length < 3) continue;
        const linkEl = (card.querySelector('a[href*="/hotel-details"]') || card.querySelector('a')) as HTMLAnchorElement | null;
        const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
        let price = card.querySelector('[class*="Price"], [class*="price"], [data-testid="price"]')?.textContent?.trim() || "";
        if (!price) {
          for (const span of card.querySelectorAll('span, strong, p')) {
            const t = span.textContent?.trim() || "";
            if (/^₹[\d,]+$|^[\d,]+$/.test(t.replace(/\s/g, "")) && t.length < 15) { price = t; break; }
          }
        }
        const ratingEl = card.querySelector('[class*="rating"], [class*="Rating"], [data-testid="rating"]');
        let rating = ratingEl?.textContent?.trim() || "";
        const rMatch = rating.match(/([\d.]+)/);
        rating = rMatch ? rMatch[1] : "";
        const cardText = card.textContent || "";
        const revMatch = cardText.match(/([\d,]+)\s*(?:rating|review)/i);
        const reviewCount = revMatch ? revMatch[1] : "";
        const imgEl = card.querySelector('img') as HTMLImageElement | null;
        listings.push({
          title, brand: "", price, currency: "INR", rating, reviewCount,
          seller: "MakeMyTrip", fulfiller: "MakeMyTrip",
          ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "Hotel",
          url: url.split("?")[0], imageUrl: imgEl?.src || "",
          barcode: "", source_site: "makemytrip", page_type: "search",
        });
      } catch {}
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = params.get("searchText") || params.get("city") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
    if (!destination) return null;
    const ci = params.get("checkin") || "";
    const co = params.get("checkout") || "";
    const checkin = ci.length === 8 ? `${ci.slice(0,4)}-${ci.slice(4,6)}-${ci.slice(6,8)}` : ci;
    const checkout = co.length === 8 ? `${co.slice(0,4)}-${co.slice(4,6)}-${co.slice(6,8)}` : co;
    const rsq = params.get("roomStayQualifier") || "";
    const adultsMatch = rsq.match(/^(\d+)e/);
    return {
      destination,
      checkin,
      checkout,
      adults: adultsMatch ? adultsMatch[1] : "",
      children: "",
      rooms: "1",
      query: "",
    };
  }

  getSearchCenter(): SearchCenter | null { return null; }

  getSearchDestination(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("searchText") || params.get("city") || getMeta("og:title")?.replace(/ Hotels.*/i, "") || "";
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();
    const title = getMeta("og:title")?.replace(/ - MakeMyTrip$/i, "") || jsonLd?.name || extractText(['h1', '#hotel-name', '[data-testid="hotel-name"]']);
    let price = jsonLd?.offers?.price?.toString() || "";
    if (!price) price = extractText(['[class*="tariff"], [class*="Price"], [class*="price"], [data-testid="price"]']);
    // MakeMyTrip .global uses different DOM — look for "Per Night" pattern and grab the price near it
    if (!price) {
      const body = document.body.innerText || "";
      // Match patterns like "$ 52", "$52", "₹ 3,500", "₹3500" near "Per Night" or "per night"
      const perNightMatch = body.match(/Per\s*Night[:\s]*[₹$€£]?\s*([\d,]+)/i);
      if (perNightMatch) price = perNightMatch[1];
    }
    if (!price) {
      // Broader search: find prominent price elements on the page
      const pricePatterns = [
        'span[class*="amt"], span[class*="Amt"]',
        'div[class*="tariff"], div[class*="Tariff"]', 
        'p[class*="offer"], p[class*="Offer"]',
        'span[class*="roomPrice"], span[class*="RoomPrice"]',
        'span[class*="finalPrice"], span[class*="FinalPrice"]',
      ];
      for (const sel of pricePatterns) {
        const el = document.querySelector(sel);
        const t = el?.textContent?.trim() || "";
        if (/[₹$€£]\s*[\d,]+|[\d,]+/.test(t) && t.length < 20) { price = t; break; }
      }
    }
    if (!price) {
      // Last resort: scan all elements for currency + number near "night"
      for (const el of document.querySelectorAll('span, strong, b, h2, h3')) {
        const t = el.textContent?.trim() || "";
        if (/^[₹$€£]\s*[\d,]+$/.test(t) && t.length < 15) {
          // Check if a sibling or parent mentions "night"
          const context = el.parentElement?.textContent || "";
          if (/night/i.test(context)) { price = t; break; }
        }
      }
    }
    // Clean up price: if it's just digits, add $ for USD pages
    if (price && /^\d[\d,]*$/.test(price.trim())) {
      const currParam = new URLSearchParams(window.location.search).get("_uCurrency");
      const sym = currParam === "INR" ? "₹" : currParam === "EUR" ? "€" : currParam === "GBP" ? "£" : "$";
      price = sym + price.trim();
    }
    let rating = jsonLd?.aggregateRating?.ratingValue?.toString() || "";
    if (!rating) rating = extractText(['[class*="rating"], [class*="Rating"]']);
    let reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || "";
    if (!reviewCount) {
      const body = document.body.innerText || "";
      const revMatch = body.match(/([\d,]+)\s*(?:rating|review)/i);
      if (revMatch) reviewCount = revMatch[1];
    }
    let cancellation = extractText(['[class*="cancellation"], [class*="refund"]']);
    const imageUrl = getMeta("og:image") || jsonLd?.image || "";
    // Detect currency from URL param or page content
    const currParam = new URLSearchParams(window.location.search).get("_uCurrency");
    const detectedCurrency = currParam || (price.includes("₹") ? "INR" : price.includes("€") ? "EUR" : price.includes("£") ? "GBP" : "USD");
    return {
      title, brand: "", price, currency: detectedCurrency, rating, reviewCount,
      seller: "MakeMyTrip", fulfiller: "MakeMyTrip",
      ingredients: "", nutritionInfo: "",
      returnPolicy: cancellation || "",
      delivery: "", category: "Hotel",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "makemytrip", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] { return []; }
}
