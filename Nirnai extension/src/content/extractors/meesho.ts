// Meesho product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("meesho", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.meesho.com/search?q=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class MeeshoExtractor implements SiteExtractor {
  siteName(): string { return "meesho"; }

  isProductPage(): boolean {
    // Meesho product URLs: /product-name/p/ID
    if (/\/p\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('[class*="ProductDescription"], [class*="product-description"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") ||
      document.querySelector('[class*="CartItem"], [class*="cart-item"]') !== null;
  }

  isSearchPage(): boolean {
    return window.location.pathname.includes("/search") &&
      document.querySelector('[class*="ProductCard"], [class*="product-card"]') !== null;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[class*="ProductCard"], [class*="product-card"]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('[class*="product-title"], [class*="ProductTitle"], p');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a');
      if (!linkEl) continue;
      const url = new URL(linkEl.href, window.location.origin).href;

      const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
      const ratingEl = card.querySelector('[class*="rating"], [class*="Rating"]');
      const imgEl = card.querySelector<HTMLImageElement>('img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "INR",
        rating: ratingEl?.textContent?.trim() || "",
        reviewCount: "",
        seller: "Meesho", fulfiller: "Meesho",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "meesho", page_type: "search",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText([
      'h1[class*="css"], [class*="product-title"], [class*="ProductTitle"]',
    ]);
    const price = jsonLd?.offers?.price?.toString() || extractText([
      '[class*="discounted-price"], [class*="DiscountedPrice"], [class*="price"]',
    ]);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText([
      '[class*="rating-count"], [class*="RatingCount"]',
    ]);
    const reviewCount = extractText(['[class*="review-count"], [class*="ReviewCount"]']);
    const returnPolicy = extractText(['[class*="return"], [class*="Return"]']);
    const delivery = extractText(['[class*="delivery"], [class*="Delivery"]']);
    const imageUrl = jsonLd?.image?.[0] || jsonLd?.image ||
      document.querySelector<HTMLImageElement>('[class*="product-image"] img, [class*="ProductImage"] img')?.src || "";

    return {
      title, brand: "", price, currency: "INR", rating, reviewCount,
      seller: "Meesho", fulfiller: "Meesho",
      ingredients: "", nutritionInfo: "", returnPolicy, delivery, category: "",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "meesho", page_type: "product",
      country_code: "IN", currency_code: "INR", locale: "en-IN",
      tax_included: true, shipping_region: "IN", measurement_system: "metric",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[class*="CartItem"], [class*="cart-item"]').forEach(item => {
      const titleEl = item.querySelector('[class*="title"], p');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[class*="price"]');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "INR",
        rating: "", reviewCount: "", seller: "Meesho", fulfiller: "Meesho",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "meesho", page_type: "cart",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    });
    return products;
  }

  private getJsonLd(): any | null {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(script.textContent || "");
        if (d["@type"] === "Product") return d;
        if (Array.isArray(d)) { const p = d.find((x: any) => x["@type"] === "Product"); if (p) return p; }
      } catch {}
    }
    return null;
  }
}
