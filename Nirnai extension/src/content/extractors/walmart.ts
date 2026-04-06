// Walmart product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Walmart search URL builder for cross-site comparison
registerSearchUrlBuilder("walmart", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  const sp = new URLSearchParams();
  sp.set("q", p.query);
  return `https://www.walmart.com/search?${sp.toString()}`;
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

export class WalmartExtractor implements SiteExtractor {
  siteName(): string {
    return "walmart";
  }

  isProductPage(): boolean {
    // Walmart product pages use /ip/ in the URL
    if (/\/ip\//.test(window.location.pathname)) return true;
    // Fallback: check for product title element
    if (document.querySelector('[itemprop="name"], h1[id*="main-title"], [data-testid="product-title"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/cart") ||
      document.querySelector('[data-testid="cart-page"]') !== null
    );
  }

  isSearchPage(): boolean {
    // Walmart search: /search?q=query
    if (window.location.pathname.includes("/search")) {
      return document.querySelector('[data-testid="search-result-list"], [data-testid="item-stack"]') !== null;
    }
    // Also category browse pages
    if (window.location.pathname.startsWith("/browse/") || window.location.pathname.startsWith("/cp/")) {
      return document.querySelector('[data-testid="item-stack"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    // Walmart search result cards
    const cards = document.querySelectorAll(
      '[data-testid="list-view"] [data-item-id], [data-testid="item-stack"] [data-item-id], .search-result-gridview-item'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;

      // Skip sponsored
      if (card.querySelector('[data-testid="spn-label"], .sponsored-badge')) continue;

      const titleEl = card.querySelector('[data-automation-id="product-title"], a[link-identifier="itemName"] span, [data-testid="list-view"]  span.f6');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a[link-identifier="itemName"], a[href*="/ip/"]');
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-automation-id="product-price"] [aria-hidden="true"], [itemprop="price"], .f2');
      const price = priceEl?.textContent?.trim() || "";

      const ratingEl = card.querySelector('[data-testid="product-ratings"] .w_iUH7, .stars-container .visuallyhidden');
      const rating = ratingEl?.textContent?.trim() || "";

      const reviewEl = card.querySelector('[data-testid="product-reviews"] .w_iUH7, .stars-reviews-count-node');
      const reviewCount = reviewEl?.textContent?.trim() || "";

      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="productTileImage"] img, img[data-testid="product-image"]');
      const imageUrl = imgEl?.src || "";

      listings.push({
        title,
        brand: "",
        price,
        currency: "USD",
        rating,
        reviewCount,
        seller: "",
        fulfiller: "",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl,
        barcode: "",
        source_site: "walmart",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") || params.get("query") || "";
    if (!query) return null;
    return {
      query,
      destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "",
    };
  }

  extractProduct(): ProductData {
    // Try JSON-LD first (Walmart uses rich structured data)
    const jsonLd = this.getJsonLdProduct();

    const title =
      jsonLd?.name ||
      extractText([
        '[itemprop="name"]',
        'h1[id*="main-title"]',
        '[data-testid="product-title"]',
        'h1',
      ]);

    const brand =
      jsonLd?.brand?.name ||
      extractText([
        '[itemprop="brand"] [itemprop="name"]',
        '[data-testid="product-brand"]',
        'a[link-identifier="brand"]',
        '.prod-brandName a',
      ]);

    const price =
      jsonLd?.offers?.price?.toString() ||
      extractText([
        '[itemprop="price"]',
        '[data-testid="price-wrap"] [aria-hidden="true"]',
        'span[data-testid="current-price"]',
        '.price-characteristic',
        'span.inline-flex [aria-hidden="true"]',
      ]);

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      extractText([
        '[itemprop="ratingValue"]',
        '[data-testid="reviews-star-rating"]',
        '.stars-reviews-count-node .f7',
      ]);

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      this.extractReviewCount();

    const seller = extractText([
      '[data-testid="sold-shipped-by"] a',
      '[link-identifier="sellerName"]',
      '.seller-name',
    ]) || "Walmart.com";

    const delivery = extractText([
      '[data-testid="fulfillment-badge"]',
      '[data-testid="shipping-message"]',
      '.fulfillment-shipping-text',
    ]);

    const returnPolicy = extractText([
      '[data-testid="return-policy"]',
      '.returns-value',
    ]);

    const category = this.extractCategory();

    const imageUrl =
      jsonLd?.image ||
      document.querySelector<HTMLImageElement>('[data-testid="hero-image"] img, [data-testid="media-thumbnail"] img, .hover-zoom-hero-image img')?.src ||
      "";

    return {
      title,
      brand,
      price,
      currency: "USD",
      rating,
      reviewCount,
      seller,
      fulfiller: seller.toLowerCase().includes("walmart") ? "Walmart" : "",
      ingredients: this.extractIngredients(),
      nutritionInfo: this.extractNutritionInfo(),
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "",
      source_site: "walmart",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    const cartItems = document.querySelectorAll(
      '[data-testid="cart-item"], .cart-item, [data-automation-id="cart-item"]'
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector('a[data-testid="cart-item-title"], .cart-item-name a, a[link-identifier="itemName"]');
      const priceEl = item.querySelector('[data-testid="cart-item-price"], .cart-item-price');
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
        seller: "",
        fulfiller: "",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url: linkEl?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "walmart",
        page_type: "cart",
      });
    });
    return products;
  }

  private extractReviewCount(): string {
    // Walmart shows ratings like "160K ratings" or "(2,106)"
    const el = document.querySelector(
      '[itemprop="ratingCount"], [data-testid="reviews-count"], .stars-reviews-count-node a'
    );
    return el?.textContent?.trim() || "";
  }

  private extractCategory(): string {
    // Breadcrumbs
    const crumbs = document.querySelectorAll(
      '[data-testid="breadcrumb"] a, .breadcrumb a, nav[aria-label="breadcrumb"] a'
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent?.trim() || "";
    }
    return "";
  }

  private extractIngredients(): string {
    // Walmart puts ingredients in a dedicated section or module
    const sections = document.querySelectorAll(
      '[data-testid="ingredients-section"], .ingredients-section, .about-desc'
    );
    for (const section of sections) {
      const text = section.textContent?.trim() || "";
      if (text.toLowerCase().includes("ingredient")) return text;
    }

    // Fallback: look for heading + content pattern
    const headings = document.querySelectorAll('h2, h3, [role="heading"]');
    for (const h of headings) {
      if (h.textContent?.toLowerCase().includes("ingredient")) {
        const next = h.nextElementSibling;
        if (next?.textContent?.trim()) return next.textContent.trim();
        // Or content within same parent
        const parent = h.parentElement;
        if (parent) {
          const content = parent.querySelector('div, p, .dangerous-html');
          if (content?.textContent?.trim()) return content.textContent.trim();
        }
      }
    }
    return "";
  }

  private extractNutritionInfo(): string {
    const sections = document.querySelectorAll(
      '[data-testid="nutrition-facts"], .nutrition-facts, .nutrition-information'
    );
    for (const section of sections) {
      if (section.textContent?.trim()) return section.textContent.trim();
    }

    const headings = document.querySelectorAll('h2, h3, [role="heading"]');
    for (const h of headings) {
      if (h.textContent?.toLowerCase().includes("nutrition")) {
        const next = h.nextElementSibling;
        if (next?.textContent?.trim()) return next.textContent.trim();
      }
    }
    return "";
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
      } catch {
        // Skip invalid JSON-LD
      }
    }
    return null;
  }
}
