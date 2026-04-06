// Nordstrom product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("nordstrom", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.nordstrom.com/sr?origin=keywordsearch&keyword=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class NordstromExtractor implements SiteExtractor {
  siteName(): string { return "nordstrom"; }

  isProductPage(): boolean {
    // /s/{brand}-{product}/id
    if (/\/s\/[^/]+\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('[data-element="product-title"], #product-title, article[data-product]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/shopping-bag") || window.location.pathname.includes("/cart");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/sr") || window.location.pathname.includes("/browse/")) {
      return document.querySelector('[data-element="product-module"], article[data-product], .product-results-view_productCard') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-element="product-module"], article[data-product], .product-results-view_productCard');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-element="sponsored"]')) continue;

      const titleEl = card.querySelector('[data-element="product-module-title"] a, a[data-element="product-title"], .product-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-element="product-module-price"], .product-price, .price');
      const ratingEl = card.querySelector('[data-element="product-module-rating"], .product-rating');
      const reviewEl = card.querySelector('[data-element="product-module-review-count"], .review-count');
      const imgEl = card.querySelector<HTMLImageElement>('img[data-element="product-module-image"], .product-photo img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Nordstrom", fulfiller: "Nordstrom",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "nordstrom", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("keyword") || params.get("q") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['[data-element="product-title"]', '#product-title', 'h1']);
    const brand = jsonLd?.brand?.name || extractText(['[data-element="product-brand"]', '.product-brand a', '[itemprop="brand"]']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-element="product-price"]', '.product-price .sale-price', '.product-price']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[itemprop="ratingValue"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[itemprop="reviewCount"]']);
    const delivery = extractText(['[data-element="shipping-info"]', '.shipping-info']);
    const returnPolicy = "Free returns";
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-element="product-image"] img, .product-media img')?.src || "";
    return {
      title, brand, price, currency: "USD", rating, reviewCount,
      seller: "Nordstrom", fulfiller: "Nordstrom",
      ingredients: "", nutritionInfo: "", returnPolicy, delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "nordstrom", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-element="bag-item"], .shopping-bag-item, .bag-item').forEach(item => {
      const titleEl = item.querySelector('[data-element="item-title"] a, .item-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-element="item-price"], .item-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Nordstrom", fulfiller: "Nordstrom",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "nordstrom", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('[data-element="breadcrumb"] a, .breadcrumb a');
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
