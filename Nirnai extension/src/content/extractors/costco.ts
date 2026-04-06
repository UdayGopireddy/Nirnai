// Costco product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Costco search URL builder for cross-site comparison
registerSearchUrlBuilder("costco", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(p.query)}`;
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

export class CostcoExtractor implements SiteExtractor {
  siteName(): string {
    return "costco";
  }

  isProductPage(): boolean {
    // Costco product pages: /product-name.product.ITEM_ID.html
    if (/\.product\.\d+\.html/.test(window.location.pathname)) return true;
    if (document.querySelector('#product-page, .product-info, [automation-id="productName"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/cart") ||
      window.location.pathname.includes("/OrderCalculatePage") ||
      document.querySelector('#cart-items, .cart-page') !== null
    );
  }

  isSearchPage(): boolean {
    // Costco search: /CatalogSearch?dept=All&keyword=... or /s?keyword=...
    if (window.location.pathname.includes("CatalogSearch") || window.location.pathname === "/s") {
      return document.querySelector('.product-list, #search-results, [automation-id="searchResults"]') !== null;
    }
    // Category browse pages
    if (window.location.pathname.match(/\/c\/\d+/)) {
      return document.querySelector('.product-list') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll(
      '.product-list .product, .product-tile, [automation-id="productList"] .product, .product-tile-set .product'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;

      // Skip sponsored/ad cards
      if (card.querySelector('.sponsored, [data-ad]')) continue;

      const titleEl = card.querySelector('.description a, .product-title a, [automation-id="productDescriptionLink"]');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('.price, [automation-id="itemPrice"]');
      const price = priceEl?.textContent?.trim() || "";

      const ratingEl = card.querySelector('.stars, .review-stars, [automation-id="starRating"]');
      const rating = ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "";

      const reviewEl = card.querySelector('.reviews, .review-count, [automation-id="reviewCount"]');
      const reviewCount = reviewEl?.textContent?.trim() || "";

      const imgEl = card.querySelector<HTMLImageElement>('img.product-image, img[automation-id="productImage"], .product-img-holder img');
      const imageUrl = imgEl?.src || "";

      listings.push({
        title,
        brand: "",
        price,
        currency: "USD",
        rating,
        reviewCount,
        seller: "Costco",
        fulfiller: "Costco",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl,
        barcode: "",
        source_site: "costco",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("keyword") || params.get("currentQuery") || "";
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
        '[automation-id="productName"]',
        '#product-title',
        'h1.product-name',
        'h1',
      ]);

    const brand =
      jsonLd?.brand?.name ||
      extractText([
        '[automation-id="productBrand"]',
        '.product-brand',
        '[itemprop="brand"]',
      ]);

    const price =
      jsonLd?.offers?.price?.toString() ||
      extractText([
        '[automation-id="productPrice"]',
        '.price-applied .value',
        '#pull-right-price .value',
        '.your-price .value',
      ]);

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      extractText([
        '[itemprop="ratingValue"]',
        '.review-stars .stars',
      ]);

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      extractText([
        '[itemprop="reviewCount"]',
        '.review-count',
        '#reviews-header .count',
      ]);

    const delivery = extractText([
      '.delivery-info',
      '[automation-id="shippingSection"]',
      '.fulfillment-option',
    ]);

    const returnPolicy = extractText([
      '.return-policy',
      '[automation-id="returnPolicy"]',
    ]);

    const category = this.extractCategory();

    const imageUrl =
      jsonLd?.image ||
      document.querySelector<HTMLImageElement>('#RICHFXViewerContainer img, .product-image img, [automation-id="productImageLink"] img')?.src ||
      "";

    return {
      title,
      brand,
      price,
      currency: "USD",
      rating,
      reviewCount,
      seller: "Costco",
      fulfiller: "Costco",
      ingredients: this.extractIngredients(),
      nutritionInfo: this.extractNutritionInfo(),
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "",
      source_site: "costco",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    const cartItems = document.querySelectorAll(
      '#cart-items .cart-item, .order-item, [automation-id="cartItem"]'
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector('a.cart-item-title, .item-description a, [automation-id="itemDescription"] a');
      const priceEl = item.querySelector('.item-price, [automation-id="itemPrice"]');
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
        seller: "Costco",
        fulfiller: "Costco",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url: linkEl?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "costco",
        page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll(
      '.crumbs a, nav[aria-label="breadcrumb"] a, .breadcrumb a'
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent?.trim() || "";
    }
    return "";
  }

  private extractIngredients(): string {
    const sections = document.querySelectorAll(
      '.product-info-description, .product-features, [automation-id="productDescription"]'
    );
    for (const section of sections) {
      const text = section.textContent?.trim() || "";
      if (text.toLowerCase().includes("ingredient")) return text;
    }
    return "";
  }

  private extractNutritionInfo(): string {
    const sections = document.querySelectorAll(
      '.nutrition-facts, .product-info-description'
    );
    for (const section of sections) {
      const text = section.textContent?.trim() || "";
      if (text.toLowerCase().includes("nutrition")) return text;
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
      } catch { /* skip */ }
    }
    return null;
  }
}
