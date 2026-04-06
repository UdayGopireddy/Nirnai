// Best Buy product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Best Buy search URL builder for cross-site comparison
registerSearchUrlBuilder("bestbuy", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(p.query)}`;
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

export class BestBuyExtractor implements SiteExtractor {
  siteName(): string {
    return "bestbuy";
  }

  isProductPage(): boolean {
    // Best Buy product pages: /site/{product-name}/{skuId}.p
    if (/\/site\/.*\/\d+\.p/.test(window.location.pathname)) return true;
    if (document.querySelector('.sku-title h1, [data-testid="product-title"], .shop-product-title')) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/cart") ||
      document.querySelector('.cart-page, [data-testid="cart-page"]') !== null
    );
  }

  isSearchPage(): boolean {
    // Best Buy search: /site/searchpage.jsp?st=query or /site/shop/category
    if (window.location.pathname.includes("searchpage.jsp")) {
      return document.querySelector('.sku-item-list, [data-testid="search-results"], .list-items') !== null;
    }
    // Category pages
    if (window.location.pathname.match(/\/site\/(?:shop|promo)\//)) {
      return document.querySelector('.sku-item-list, .list-items') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll(
      '.sku-item, [data-testid="sku-item"], .list-item, .sku-item-list > li'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;

      // Skip sponsored/ad cards
      if (card.querySelector('.sponsored-product, [data-testid="ad-badge"]')) continue;

      const titleEl = card.querySelector('.sku-title a, [data-testid="sku-title"] a, h4.sku-header a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-testid="customer-price"] span, .priceView-customer-price span, .pricing-price .sr-only');
      const price = priceEl?.textContent?.trim() || "";

      const ratingEl = card.querySelector('.c-ratings-reviews [aria-label], .customer-ratings .c-stars');
      const rating = ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "";

      const reviewEl = card.querySelector('.c-ratings-reviews .c-reviews, .customer-ratings .count');
      const reviewCount = reviewEl?.textContent?.trim() || "";

      const imgEl = card.querySelector<HTMLImageElement>('.product-image img, [data-testid="product-image"] img, img.product-image');
      const imageUrl = imgEl?.src || "";

      listings.push({
        title,
        brand: "",
        price,
        currency: "USD",
        rating,
        reviewCount,
        seller: "Best Buy",
        fulfiller: "Best Buy",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl,
        barcode: "",
        source_site: "bestbuy",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("st") || params.get("qp") || "";
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
        '.sku-title h1',
        '[data-testid="product-title"]',
        '.shop-product-title',
        'h1',
      ]);

    const brand =
      jsonLd?.brand?.name ||
      extractText([
        '[data-testid="product-brand"]',
        '.brand a',
        'a.brand-link',
      ]);

    const price =
      jsonLd?.offers?.price?.toString() ||
      extractText([
        '[data-testid="customer-price"] span',
        '.priceView-customer-price span',
        '.pricing-price__regular-price .sr-only',
      ]);

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      extractText([
        '[itemprop="ratingValue"]',
        '.c-ratings-reviews .ugc-rating',
      ]);

    const reviewEl = document.querySelector('[itemprop="reviewCount"], .c-ratings-reviews .ugc-count');
    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      reviewEl?.textContent?.trim() || "";

    const seller = "Best Buy";

    const delivery = extractText([
      '[data-testid="fulfillment-fulfillment-summary"]',
      '.fulfillment-fulfillment-summary',
      '.shipping-delivery-date',
    ]);

    const returnPolicy = extractText([
      '.return-exchange-policy',
      '[data-testid="return-policy"]',
    ]);

    const category = this.extractCategory();

    const imageUrl =
      jsonLd?.image ||
      document.querySelector<HTMLImageElement>('.primary-image img, [data-testid="image-gallery-image"] img, .shop-media-gallery img')?.src ||
      "";

    const sku = this.extractSku();

    return {
      title,
      brand,
      price,
      currency: "USD",
      rating,
      reviewCount,
      seller,
      fulfiller: "Best Buy",
      ingredients: "",
      nutritionInfo: "",
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: sku ? `sku=${sku}` : "",
      source_site: "bestbuy",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    const cartItems = document.querySelectorAll(
      '.cart-item, [data-testid="cart-item"], .fluid-large-view__line-item'
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector('a.cart-item__title, [data-testid="cart-item-title"] a, .line-item-description a');
      const priceEl = item.querySelector('.cart-item__price, [data-testid="cart-item-price"]');
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
        seller: "Best Buy",
        fulfiller: "Best Buy",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url: linkEl?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "bestbuy",
        page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll(
      '.breadcrumb a, nav[aria-label="breadcrumb"] a, .breadcrumb-list a'
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent?.trim() || "";
    }
    return "";
  }

  private extractSku(): string {
    // Best Buy SKU from URL: /site/{name}/{skuId}.p
    const match = window.location.pathname.match(/\/(\d+)\.p/);
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
