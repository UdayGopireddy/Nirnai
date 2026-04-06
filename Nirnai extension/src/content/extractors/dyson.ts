// Dyson DTC product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("dyson", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.dyson.com/search#q=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class DysonExtractor implements SiteExtractor {
  siteName(): string { return "dyson"; }

  isProductPage(): boolean {
    // Dyson product pages: /{category}/{product-name}.html or /{category}/{product}
    if (document.querySelector('[data-testid="product-title"], .product-name h1, .pdp-hero__title')) return true;
    if (/\/(vacuum-cleaners|hair-care|air-treatment|lighting|headphones)\//.test(window.location.pathname) && document.querySelector('.price, .pdp-price')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") || window.location.pathname.includes("/basket");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search") || window.location.hash.includes("q=")) {
      return document.querySelector('.search-results, [data-testid="search-results"], .coveo-result-list') !== null;
    }
    // Category list pages
    if (window.location.pathname.match(/\/(vacuum-cleaners|hair-care|air-treatment|lighting|headphones)\/?$/)) {
      return document.querySelector('.product-list, .category-grid, [data-testid="product-card"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-testid="product-card"], .product-card, .coveo-result-list .CoveoResult, .category-grid__item');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('[data-testid="product-title"] a, .product-card__title a, .CoveoResultLink, a.product-card__link');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (titleEl || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-testid="product-price"], .product-card__price, .price');
      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .product-card__image img');

      listings.push({
        title, brand: "Dyson",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD", rating: "", reviewCount: "",
        seller: "Dyson", fulfiller: "Dyson",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "dyson", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    // Check hash for Coveo-style search
    const hashMatch = window.location.hash.match(/q=([^&]+)/);
    if (hashMatch) {
      return { query: decodeURIComponent(hashMatch[1]), destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
    }
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") || params.get("query") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['[data-testid="product-title"]', '.product-name h1', '.pdp-hero__title', 'h1']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-testid="product-price"]', '.pdp-price', '.price--current']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-testid="star-rating"]', '.star-rating__value']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-testid="review-count"]', '.reviews-count']);
    const delivery = extractText(['[data-testid="delivery-info"]', '.delivery-info', '.shipping-info']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .pdp-hero__image img, .product-image img')?.src || "";
    return {
      title, brand: "Dyson", price, currency: "USD", rating, reviewCount,
      seller: "Dyson", fulfiller: "Dyson",
      ingredients: "", nutritionInfo: "",
      returnPolicy: "30-day money back guarantee",
      delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "dyson", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-testid="cart-item"], .cart-item, .basket__item').forEach(item => {
      const titleEl = item.querySelector('[data-testid="product-name"] a, .cart-item__title a, .basket__item-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-testid="product-price"], .cart-item__price, .basket__item-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "Dyson", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Dyson", fulfiller: "Dyson",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "dyson", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.breadcrumb a, [data-testid="breadcrumb"] a');
    return crumbs.length > 0 ? (crumbs[crumbs.length - 1].textContent?.trim() || "") : "";
  }

  private getJsonLd(): any | null {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(script.textContent || "");
        if (d["@type"] === "Product") return d;
        if (Array.isArray(d)) { const p = d.find((x: any) => x["@type"] === "Product"); if (p) return p; }
        if (d["@graph"]) { const p = d["@graph"].find((x: any) => x["@type"] === "Product"); if (p) return p; }
      } catch {}
    }
    return null;
  }
}
