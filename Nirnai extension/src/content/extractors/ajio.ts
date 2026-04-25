// AJIO product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("ajio", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.ajio.com/search/?text=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class AjioExtractor implements SiteExtractor {
  siteName(): string { return "ajio"; }

  isProductPage(): boolean {
    // AJIO product URLs: /brand/product/p/ID
    if (/\/p\/[A-Z0-9]+/.test(window.location.pathname)) return true;
    if (document.querySelector('.prod-name, .brand-name, [class*="prod-name"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") ||
      document.querySelector('[class*="cart-item"], [class*="cartItem"]') !== null;
  }

  isSearchPage(): boolean {
    return (window.location.pathname.includes("/search") || window.location.pathname.includes("/cat/")) &&
      document.querySelector('[class*="item"], .item-content, [class*="plp-card"]') !== null;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[class*="plp-card"], .item, [class*="item-content"]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const brandEl = card.querySelector('[class*="brand"], .brand-name');
      const nameEl = card.querySelector('[class*="name"], .prod-name');
      const title = [brandEl?.textContent?.trim(), nameEl?.textContent?.trim()].filter(Boolean).join(" ") || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a');
      if (!linkEl) continue;
      const url = new URL(linkEl.href, window.location.origin).href;

      const priceEl = card.querySelector('[class*="price-value"], .price, [class*="discount-price"]');
      const ratingEl = card.querySelector('[class*="rating"], .rating');
      const imgEl = card.querySelector<HTMLImageElement>('img');

      listings.push({
        title, brand: brandEl?.textContent?.trim() || "",
        price: priceEl?.textContent?.trim() || "",
        currency: "INR",
        rating: ratingEl?.textContent?.trim() || "",
        reviewCount: "",
        seller: "AJIO", fulfiller: "AJIO",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "ajio", page_type: "search",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("text") || params.get("q") ||
      decodeURIComponent(window.location.pathname.split("/").pop() || "").replace(/-/g, " ");
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const brand = jsonLd?.brand?.name || extractText(['.brand-name, [class*="brand-name"]']);
    const name = extractText(['.prod-name, [class*="prod-name"]']) || jsonLd?.name || "";
    const title = [brand, name].filter(Boolean).join(" ");
    const price = jsonLd?.offers?.price?.toString() || extractText([
      '.product-discout-price, [class*="price-value"], .original-price',
    ]);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText([
      '[class*="rating-count"], .rating-count',
    ]);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText([
      '[class*="review-count"], .review-count',
    ]);
    const returnPolicy = extractText(['[class*="return"], .return-policy']);
    const delivery = extractText(['[class*="delivery"], .delivery-info']);
    const imageUrl = jsonLd?.image?.[0] || jsonLd?.image ||
      document.querySelector<HTMLImageElement>('.product-image img, [class*="product-image"] img')?.src || "";
    const category = this.extractCategory();

    return {
      title, brand, price, currency: "INR", rating, reviewCount,
      seller: "AJIO", fulfiller: "AJIO",
      ingredients: "", nutritionInfo: "", returnPolicy, delivery, category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "ajio", page_type: "product",
      country_code: "IN", currency_code: "INR", locale: "en-IN",
      tax_included: true, shipping_region: "IN", measurement_system: "metric",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[class*="cart-item"], [class*="cartItem"]').forEach(item => {
      const titleEl = item.querySelector('[class*="brand"], [class*="name"]');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[class*="price"]');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "INR",
        rating: "", reviewCount: "", seller: "AJIO", fulfiller: "AJIO",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "ajio", page_type: "cart",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('[class*="breadcrumb"] a, nav a');
    return crumbs.length > 0 ? (crumbs[crumbs.length - 1].textContent?.trim() || "") : "";
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
