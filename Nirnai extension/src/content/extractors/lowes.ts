// Lowe's product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Lowe's search URL builder for cross-site comparison
registerSearchUrlBuilder("lowes", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.lowes.com/search?searchTerm=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return "";
}

export class LowesExtractor implements SiteExtractor {
  siteName(): string {
    return "lowes";
  }

  isProductPage(): boolean {
    // Lowe's product pages: /pd/{product-name}/{itemId}
    if (/\/pd\/[^/]+\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('[data-selector="splp-prd-title"], .product-title h1, #productTitle')) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/cart") ||
      document.querySelector('.cart-page, [data-selector="cart-container"]') !== null
    );
  }

  isSearchPage(): boolean {
    // Lowe's search: /search?searchTerm=... or /pl/{category}/...
    if (window.location.pathname === "/search" && window.location.search.includes("searchTerm")) {
      return document.querySelector('[data-selector="splp-prd-tile"], .nwm-product-tile, [data-testid="product-tile"]') !== null;
    }
    // Category list pages
    if (window.location.pathname.startsWith("/pl/")) {
      return document.querySelector('[data-selector="splp-prd-tile"], .nwm-product-tile') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll(
      '[data-selector="splp-prd-tile"], .nwm-product-tile, [data-testid="product-tile"]'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;

      // Skip sponsored
      if (card.querySelector('[data-selector="sponsored"], .sponsored-badge')) continue;

      const titleEl = card.querySelector('[data-selector="splp-prd-tile-p-a"], .nwm-product-tile__description a, a[data-selector="product-title"]');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-selector="splp-prd-actual-price"], .nwm-product-tile__price, [data-testid="product-price"]');
      const price = priceEl?.textContent?.trim() || "";

      const ratingEl = card.querySelector('.ratings__stars, [data-selector="splp-prd-star-rating"]');
      const rating = ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "";

      const reviewEl = card.querySelector('.ratings__count, [data-selector="splp-prd-num-reviews"]');
      const reviewCount = reviewEl?.textContent?.trim().replace(/[()]/g, "") || "";

      const imgEl = card.querySelector<HTMLImageElement>('[data-selector="splp-prd-image"] img, .nwm-product-tile__image img, img.product-image');
      const imageUrl = imgEl?.src || "";

      listings.push({
        title,
        brand: "",
        price,
        currency: "USD",
        rating,
        reviewCount,
        seller: "Lowe's",
        fulfiller: "Lowe's",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl,
        barcode: "",
        source_site: "lowes",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("searchTerm") || "";
    if (!query) return null;
    return {
      query,
      destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "",
    };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLdProduct();

    const title =
      jsonLd?.name ||
      extractText([
        '[data-selector="splp-prd-title"]',
        '.product-title h1',
        '#productTitle',
        'h1',
      ]);

    const brand =
      jsonLd?.brand?.name ||
      extractText([
        '[data-selector="splp-prd-brand"]',
        '.product-brand a',
        '.brand-name',
      ]);

    const price =
      jsonLd?.offers?.price?.toString() ||
      extractText([
        '[data-selector="splp-prd-actual-price"]',
        '.art-pd-price .main-price .item-align',
        '[data-testid="product-price"]',
      ]);

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      extractText([
        '[itemprop="ratingValue"]',
        '.ratings__stars .hidden-xs',
      ]);

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      extractText([
        '[itemprop="reviewCount"]',
        '.ratings__count',
      ]);

    const delivery = extractText([
      '[data-selector="fulfillment"]',
      '.fulfillment-text',
      '.delivery-message',
    ]);

    const returnPolicy = extractText([
      '.return-policy',
      '[data-selector="return-policy"]',
    ]);

    const category = this.extractCategory();

    const imageUrl =
      jsonLd?.image ||
      document.querySelector<HTMLImageElement>('.media-gallery img, [data-selector="product-image"] img, .product-image img')?.src ||
      "";

    const itemId = this.extractItemId();

    return {
      title,
      brand,
      price,
      currency: "USD",
      rating,
      reviewCount,
      seller: "Lowe's",
      fulfiller: "Lowe's",
      ingredients: "",
      nutritionInfo: "",
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: itemId ? `item=${itemId}` : "",
      source_site: "lowes",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    const cartItems = document.querySelectorAll(
      '.cart-item, [data-selector="cart-item"], .cart-product'
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector('a.cart-item-title, [data-selector="cart-item-title"] a, .product-description a');
      const priceEl = item.querySelector('.cart-item-price, [data-selector="cart-item-price"], .price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;

      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;

      products.push({
        title,
        brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: "",
        reviewCount: "",
        seller: "Lowe's",
        fulfiller: "Lowe's",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url: linkEl?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "lowes",
        page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll(
      '.breadcrumb a, [data-selector="breadcrumb"] a, nav[aria-label="breadcrumb"] a'
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent?.trim() || "";
    }
    return "";
  }

  private extractItemId(): string {
    // /pd/{name}/{itemId}
    const match = window.location.pathname.match(/\/pd\/[^/]+\/(\d+)/);
    return match ? match[1] : "";
  }

  private getJsonLdProduct(): any | null {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || "");
        if (data["@type"] === "Product") return data;
        if (Array.isArray(data)) {
          const product = data.find((d: any) => d["@type"] === "Product");
          if (product) return product;
        }
        if (data["@graph"]) {
          const product = data["@graph"].find((d: any) => d["@type"] === "Product");
          if (product) return product;
        }
      } catch { /* skip */ }
    }
    return null;
  }
}
