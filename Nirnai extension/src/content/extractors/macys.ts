// Macy's product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("macys", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.macys.com/shop/featured/${encodeURIComponent(p.query)}?keyword=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class MacysExtractor implements SiteExtractor {
  siteName(): string { return "macys"; }

  isProductPage(): boolean {
    if (/\/shop\/product\//.test(window.location.pathname)) return true;
    if (document.querySelector('[data-auto="product-name"], .product-title h1, #productTitle')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/bag") || window.location.pathname.includes("/cart");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/shop/featured/") || window.location.pathname.includes("/shop/search")) {
      return document.querySelector('.productThumbnailList, [data-auto="product-list"], .cell.productThumbnail') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('.cell.productThumbnail, [data-auto="product-thumbnail"], .productThumbnailItem');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-auto="sponsoredLabel"], .sponsored')) continue;

      const titleEl = card.querySelector('[data-auto="product-name"] a, .productDescription a, .prodHdr a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-auto="product-price"], .regular-original-price, .prices');
      const ratingEl = card.querySelector('[data-auto="star-rating"], .rating .stars');
      const reviewEl = card.querySelector('[data-auto="review-count"], .ratingCount');
      const imgEl = card.querySelector<HTMLImageElement>('[data-auto="product-image"] img, .productThumbnailImage img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Macy's", fulfiller: "Macy's",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "macys", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("keyword") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['[data-auto="product-name"]', '.product-title h1', 'h1']);
    const brand = jsonLd?.brand?.name || extractText(['[data-auto="product-brand"]', '.brand-name a', '.productBrand a']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-auto="product-price"]', '.regular-original-price .lowest-sale-price', '.price .regular']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[itemprop="ratingValue"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[itemprop="reviewCount"]', '.ratingCount']);
    const delivery = extractText(['[data-auto="shipping-message"]', '.shipping-return-message']);
    const returnPolicy = extractText(['[data-auto="return-policy"]', '.return-policy']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-auto="main-image"] img, .main-image img')?.src || "";
    return {
      title, brand, price, currency: "USD", rating, reviewCount,
      seller: "Macy's", fulfiller: "Macy's",
      ingredients: "", nutritionInfo: "", returnPolicy, delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "macys", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-auto="bag-item"], .bag-item, .cart-item').forEach(item => {
      const titleEl = item.querySelector('[data-auto="product-name"] a, .product-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-auto="item-price"], .item-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Macy's", fulfiller: "Macy's",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "macys", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.breadcrumbs a, [data-auto="breadcrumb"] a');
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
