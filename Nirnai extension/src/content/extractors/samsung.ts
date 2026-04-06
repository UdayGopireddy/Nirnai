// Samsung DTC product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("samsung", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.samsung.com/us/search/searchMain?listType=g&searchTerm=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class SamsungExtractor implements SiteExtractor {
  siteName(): string { return "samsung"; }

  isProductPage(): boolean {
    // Samsung product pages: /us/{category}/{product}/
    if (/\/us\/[^/]+\/[^/]+\/[^/]+\//.test(window.location.pathname)) return true;
    if (document.querySelector('[data-testid="product-name"], .product-detail__name, .pd-header__title')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") || window.location.pathname.includes("/configurator/cart");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search/")) {
      return document.querySelector('.search-result__list, [data-testid="search-results"], .product-list') !== null;
    }
    // Category pages
    if (window.location.pathname.match(/\/us\/[^/]+\/all-/)) {
      return document.querySelector('.product-list, [data-testid="product-card"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-testid="product-card"], .product-card, .product-list__item');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('[data-testid="product-name"] a, .product-card__title a, a.product-card__link');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (titleEl || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-testid="product-price"], .product-card__price, .price');
      const ratingEl = card.querySelector('[data-testid="star-rating"], .star-rating');
      const reviewEl = card.querySelector('[data-testid="review-count"], .review-count');
      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .product-card__image img');

      listings.push({
        title, brand: "Samsung",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Samsung", fulfiller: "Samsung",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "samsung", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("searchTerm") || params.get("keyword") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['[data-testid="product-name"]', '.product-detail__name', '.pd-header__title', 'h1']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-testid="product-price"]', '.product-detail__price', '.pd-price__current']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-testid="star-rating"]', '.star-rating__value']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-testid="review-count"]', '.review-count']);
    const delivery = extractText(['[data-testid="delivery-info"]', '.delivery-info', '.shipping-message']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .product-detail__image img, .pd-gallery img')?.src || "";
    return {
      title, brand: "Samsung", price, currency: "USD", rating, reviewCount,
      seller: "Samsung", fulfiller: "Samsung",
      ingredients: "", nutritionInfo: "",
      returnPolicy: "15-day free returns",
      delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "samsung", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-testid="cart-item"], .cart-item, .cart__product').forEach(item => {
      const titleEl = item.querySelector('[data-testid="product-name"] a, .cart-item__title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-testid="product-price"], .cart-item__price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "Samsung", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Samsung", fulfiller: "Samsung",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "samsung", page_type: "cart",
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
