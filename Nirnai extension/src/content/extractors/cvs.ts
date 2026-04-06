// CVS product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("cvs", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.cvs.com/search?searchTerm=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class CvsExtractor implements SiteExtractor {
  siteName(): string { return "cvs"; }

  isProductPage(): boolean {
    if (/\/shop\//.test(window.location.pathname) && document.querySelector('.product-detail-page, [data-testid="product-detail"]')) return true;
    if (document.querySelector('#pdp-product-title, .pdp-product-title, [data-testid="pdp-title"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") || document.querySelector('[data-testid="cart-page"]') !== null;
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search")) {
      return document.querySelector('[data-testid="search-results"], .search-results, .product-grid') !== null;
    }
    if (window.location.pathname.includes("/shop/")) {
      return document.querySelector('.product-grid, [data-testid="product-list"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-testid="product-card"], .product-card, .product-tile');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-testid="sponsored"]')) continue;

      const titleEl = card.querySelector('[data-testid="product-name"] a, .product-name a, .product-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-testid="product-price"], .product-price, .price');
      const ratingEl = card.querySelector('[data-testid="star-rating"], .star-rating');
      const reviewEl = card.querySelector('[data-testid="review-count"], .review-count');
      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="product-image"] img, .product-image img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "CVS", fulfiller: "CVS",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "cvs", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("searchTerm") || params.get("query") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['#pdp-product-title', '[data-testid="pdp-title"]', 'h1']);
    const brand = jsonLd?.brand?.name || extractText(['[data-testid="product-brand"]', '.product-brand', '[itemprop="brand"]']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-testid="product-price"]', '.product-price .price-value', '.price']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[itemprop="ratingValue"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[itemprop="reviewCount"]']);
    const delivery = extractText(['[data-testid="shipping-info"]', '.shipping-message', '.fulfillment-options']);
    const returnPolicy = extractText(['[data-testid="return-policy"]', '.return-policy']);
    const ingredients = this.extractSection("ingredient");
    const nutrition = this.extractSection("nutrition");
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-testid="pdp-image"] img, .pdp-image img, #mainImage img')?.src || "";
    return {
      title, brand, price, currency: "USD", rating, reviewCount,
      seller: "CVS", fulfiller: "CVS",
      ingredients, nutritionInfo: nutrition, returnPolicy, delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "cvs", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-testid="cart-item"], .cart-item').forEach(item => {
      const titleEl = item.querySelector('[data-testid="item-name"] a, .item-name a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-testid="item-price"], .item-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "CVS", fulfiller: "CVS",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "cvs", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.breadcrumb a, nav[aria-label="breadcrumb"] a');
    return crumbs.length > 0 ? (crumbs[crumbs.length - 1].textContent?.trim() || "") : "";
  }

  private extractSection(keyword: string): string {
    const sections = document.querySelectorAll('[data-testid="product-details"] section, .product-details section, .product-info-section');
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
