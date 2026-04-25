// Nykaa product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("nykaa", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.nykaa.com/search/result/?q=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class NykaaExtractor implements SiteExtractor {
  siteName(): string { return "nykaa"; }

  isProductPage(): boolean {
    if (/\/p\//.test(window.location.pathname) || /\/buy\//.test(window.location.pathname)) return true;
    if (document.querySelector('[class*="product-name"], [class*="productName"], h1[class*="css"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") ||
      document.querySelector('[class*="cart-item"], [class*="cartItem"]') !== null;
  }

  isSearchPage(): boolean {
    return window.location.pathname.includes("/search") &&
      document.querySelector('[class*="productCard"], [class*="product-card"]') !== null;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[class*="productCard"], [class*="product-card"], [class*="ProductCard"]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('[class*="product-name"], [class*="productName"], [class*="ProductName"]');
      const brandEl = card.querySelector('[class*="brand-name"], [class*="brandName"]');
      const title = [brandEl?.textContent?.trim(), titleEl?.textContent?.trim()].filter(Boolean).join(" ") || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a');
      if (!linkEl) continue;
      const url = new URL(linkEl.href, window.location.origin).href;

      const priceEl = card.querySelector('[class*="price-new"], [class*="priceNew"], [class*="offering-price"]');
      const ratingEl = card.querySelector('[class*="rating-count"], [class*="ratingCount"]');
      const imgEl = card.querySelector<HTMLImageElement>('img');

      listings.push({
        title, brand: brandEl?.textContent?.trim() || "",
        price: priceEl?.textContent?.trim() || "",
        currency: "INR",
        rating: "",
        reviewCount: ratingEl?.textContent?.trim() || "",
        seller: "Nykaa", fulfiller: "Nykaa",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "nykaa", page_type: "search",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") || params.get("query") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText([
      'h1[class*="css"], [class*="product-title"], [class*="productTitle"]',
    ]);
    const brand = jsonLd?.brand?.name || extractText(['[class*="brand-name"], [class*="brandName"]']);
    const price = jsonLd?.offers?.price?.toString() || extractText([
      '[class*="price-new"], span[class*="offering-price"], [class*="priceNew"]',
    ]);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText([
      '[class*="average-rating"], [class*="averageRating"]',
    ]);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText([
      '[class*="rating-count"], [class*="ratingCount"]',
    ]);
    // Nykaa often shows ingredients for beauty products
    const ingredients = extractText(['[class*="ingredient-list"], #ingredients, [class*="ingredients"]']);
    const returnPolicy = extractText(['[class*="return-policy"], [class*="returnPolicy"]']);
    const delivery = extractText(['[class*="delivery"], [class*="shipping"]']);
    const imageUrl = jsonLd?.image?.[0] || jsonLd?.image ||
      document.querySelector<HTMLImageElement>('[class*="product-image"] img, [class*="productImage"] img')?.src || "";
    const category = this.extractCategory();

    return {
      title, brand, price, currency: "INR", rating, reviewCount,
      seller: "Nykaa", fulfiller: "Nykaa",
      ingredients, nutritionInfo: "", returnPolicy, delivery, category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "nykaa", page_type: "product",
      country_code: "IN", currency_code: "INR", locale: "en-IN",
      tax_included: true, shipping_region: "IN", measurement_system: "metric",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[class*="cart-item"], [class*="cartItem"]').forEach(item => {
      const titleEl = item.querySelector('[class*="product-name"], [class*="productName"]');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[class*="price"], [class*="Price"]');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "INR",
        rating: "", reviewCount: "", seller: "Nykaa", fulfiller: "Nykaa",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "nykaa", page_type: "cart",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="breadcrumb"] a');
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
