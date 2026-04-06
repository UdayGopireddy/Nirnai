// Walgreens product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("walgreens", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.walgreens.com/search/results.jsp?Ntt=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class WalgreensExtractor implements SiteExtractor {
  siteName(): string { return "walgreens"; }

  isProductPage(): boolean {
    if (/\/store\/c\//.test(window.location.pathname) && /\/ID=/.test(window.location.pathname)) return true;
    if (document.querySelector('#productTitle, [data-testid="product-title"], .product__title')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") || window.location.pathname.includes("/store/checkout/cart");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search/results")) {
      return document.querySelector('#search-results, [data-testid="search-results"], .search__grid') !== null;
    }
    // Category/browse pages
    if (window.location.pathname.includes("/store/c/")) {
      return document.querySelector('.product__grid, .product-container, [data-testid="product-list"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('#search-results .card, [data-testid="product-card"], .product__card, .card__product');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-testid="sponsored"], .sponsored-flag')) continue;

      const titleEl = card.querySelector('[data-testid="product-title"] a, .card__heading a, .product__title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-testid="product-price"], .product__price, .card__price, .price__amount');
      const ratingEl = card.querySelector('[data-testid="star-rating"], .wag-star-rating, .star-rating');
      const reviewEl = card.querySelector('[data-testid="review-count"], .review-count, .rating__count');
      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .card__img img, .product__image img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Walgreens", fulfiller: "Walgreens",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "walgreens", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("Ntt") || params.get("query") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['#productTitle', '[data-testid="product-title"]', '.product__title', 'h1']);
    const brand = jsonLd?.brand?.name || extractText(['[data-testid="product-brand"]', '.product__brand', '[itemprop="brand"]']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-testid="product-price"]', '.product__price', '#regular-price']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[itemprop="ratingValue"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[itemprop="reviewCount"]']);
    const delivery = extractText(['[data-testid="shipping-info"]', '.shipping-message', '.fulfillment-toggle']);
    const returnPolicy = extractText(['[data-testid="return-policy"]', '.return-policy']);
    const ingredients = this.extractSection("ingredient");
    const nutrition = this.extractSection("nutrition");
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .product__image img, #productImg')?.src || "";
    return {
      title, brand, price, currency: "USD", rating, reviewCount,
      seller: "Walgreens", fulfiller: "Walgreens",
      ingredients, nutritionInfo: nutrition, returnPolicy, delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "walgreens", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-testid="cart-item"], .cart-item, .cart__product').forEach(item => {
      const titleEl = item.querySelector('[data-testid="item-name"] a, .item-title a, .product-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-testid="item-price"], .item-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Walgreens", fulfiller: "Walgreens",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "walgreens", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.breadcrumb a, [data-testid="breadcrumb"] a, nav[aria-label="breadcrumbs"] a');
    return crumbs.length > 0 ? (crumbs[crumbs.length - 1].textContent?.trim() || "") : "";
  }

  private extractSection(keyword: string): string {
    const sections = document.querySelectorAll('[data-testid="product-details"] section, .product-info-section, .pdp-description-section');
    for (const sec of sections) {
      const text = sec.textContent?.trim() || "";
      if (text.toLowerCase().includes(keyword)) return text;
    }
    return "";
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
