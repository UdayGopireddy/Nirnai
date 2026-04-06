// Apple Store DTC product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("apple", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.apple.com/shop/buy-mac?fh=4a2b${encodeURIComponent(p.query)}`;
  // Apple's shop search is limited; we link to the shop landing
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class AppleExtractor implements SiteExtractor {
  siteName(): string { return "apple"; }

  isProductPage(): boolean {
    // Apple product pages: /shop/buy-{category}/..., /shop/product/...
    if (/\/shop\/(buy-|product\/)/.test(window.location.pathname)) return true;
    // Main marketing pages: /macbook-pro, /iphone-16, etc.
    if (document.querySelector('.rf-bfe-producttile, .as-price-currentprice, [data-autom="productTitle"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/shop/bag") || window.location.pathname.includes("/shop/cart");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/shop/buy-") || window.location.pathname.includes("/shop/go/")) {
      return document.querySelector('.rf-serp-productlist, .as-macfilterpage-list, [data-autom="productTile"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-autom="productTile"], .rf-serp-productcard, .as-macfilterpage-list-item');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('[data-autom="productTitle"] a, .rf-serp-productname a, h2 a, h3 a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (titleEl || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-autom="productPrice"], .as-price-currentprice, .rf-serp-productprice');
      const imgEl = card.querySelector<HTMLImageElement>('[data-autom="productImage"] img, .rf-serp-productimage img');

      listings.push({
        title, brand: "Apple",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD", rating: "", reviewCount: "",
        seller: "Apple", fulfiller: "Apple",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "apple", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    // Apple doesn't really have a keyword search — extract from URL path
    const match = window.location.pathname.match(/\/shop\/buy-([^/]+)/);
    const query = match ? match[1].replace(/-/g, " ") : "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['[data-autom="productTitle"]', '.rf-bfe-producttile h1', '.as-productname', 'h1']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-autom="productPrice"]', '.as-price-currentprice', '.rc-prices-fullprice']);
    const delivery = extractText(['[data-autom="deliveryMessage"]', '.rf-bfe-deliverymessage', '.as-delivery-estimation']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-autom="productImage"] img, .as-productimage img, .rf-bfe-productimage img')?.src || "";
    return {
      title, brand: "Apple", price, currency: "USD",
      rating: jsonLd?.aggregateRating?.ratingValue?.toString() || "",
      reviewCount: jsonLd?.aggregateRating?.reviewCount?.toString() || "",
      seller: "Apple", fulfiller: "Apple",
      ingredients: "", nutritionInfo: "",
      returnPolicy: "14-day free returns",
      delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "apple", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-autom="bagItem"], .rs-bag-item, .as-bagitem').forEach(item => {
      const titleEl = item.querySelector('[data-autom="bagItemTitle"] a, .rs-iteminfo-title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-autom="bagItemPrice"], .rs-iteminfo-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "Apple", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Apple", fulfiller: "Apple",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "apple", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.breadcrumbs a, [data-autom="breadcrumb"] a, nav.breadcrumb a');
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
