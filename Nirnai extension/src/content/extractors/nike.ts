// Nike DTC product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("nike", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.nike.com/w?q=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class NikeExtractor implements SiteExtractor {
  siteName(): string { return "nike"; }

  isProductPage(): boolean {
    if (/\/t\/[^/]+-[A-Z0-9]+/.test(window.location.pathname)) return true;
    if (document.querySelector('[data-testid="product_title"], #pdp_product_title, .product-info h1')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") || window.location.pathname.includes("/bag");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/w") && window.location.search.includes("q=")) {
      return document.querySelector('[data-testid="product-card"], .product-card, .product-grid__items') !== null;
    }
    // Category pages
    if (window.location.pathname.match(/\/w\//)) {
      return document.querySelector('[data-testid="product-card"], .product-card') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-testid="product-card"], .product-card');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('[data-testid="product-card__title"] a, .product-card__title a, a.product-card__link-overlay');
      const subtitleEl = card.querySelector('[data-testid="product-card__subtitle"], .product-card__subtitle');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = (titleEl || card.querySelector('a')) as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-testid="product-card__price"], .product-price, .product-card__price');
      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="product-card__hero-image"] img, .product-card__hero-image img');

      listings.push({
        title: `${title}${subtitleEl ? " - " + subtitleEl.textContent?.trim() : ""}`,
        brand: "Nike",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD", rating: "", reviewCount: "",
        seller: "Nike", fulfiller: "Nike",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "nike", page_type: "search",
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
    const title = jsonLd?.name || extractText(['[data-testid="product_title"]', '#pdp_product_title', 'h1']);
    const subtitle = extractText(['[data-testid="product_sub_title"]', '.product-sub-title']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-testid="currentPrice-container"]', '.product-price', '[data-testid="product-price"]']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[data-testid="reviews-rating"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[data-testid="reviews-count"]']);
    const delivery = extractText(['[data-testid="shipping-returns"]', '.shipping-section']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-testid="HeroPDP"] img, #hero-image img, .css-1d6rmkf img')?.src || "";
    return {
      title: subtitle ? `${title} - ${subtitle}` : title,
      brand: "Nike", price, currency: "USD", rating, reviewCount,
      seller: "Nike", fulfiller: "Nike",
      ingredients: "", nutritionInfo: "",
      returnPolicy: "60-day free returns",
      delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "nike", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-testid="cart-item"], .cart-item').forEach(item => {
      const titleEl = item.querySelector('[data-testid="product-title"] a, .cart-item__title a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-testid="product-price"], .cart-item__price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "Nike", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Nike", fulfiller: "Nike",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "nike", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('[data-testid="breadcrumb"] a, .breadcrumb a');
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
