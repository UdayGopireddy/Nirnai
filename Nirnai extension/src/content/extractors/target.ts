// Target product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Target search URL builder for cross-site comparison
registerSearchUrlBuilder("target", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  const sp = new URLSearchParams();
  sp.set("searchTerm", p.query);
  return `https://www.target.com/s?${sp.toString()}`;
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

export class TargetExtractor implements SiteExtractor {
  siteName(): string {
    return "target";
  }

  isProductPage(): boolean {
    // Target product pages use /p/ in the URL with /-/A-{id}
    if (/\/p\/.*\/-\/A-\d+/.test(window.location.pathname)) return true;
    // Fallback: check for product title
    if (document.querySelector('[data-test="product-title"], h1[data-test="product-detail-title"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/cart") ||
      document.querySelector('[data-test="cart-page"]') !== null
    );
  }

  isSearchPage(): boolean {
    // Target search: /s?searchTerm=query
    if (window.location.pathname === "/s") {
      return document.querySelector('[data-test="product-grid"], [data-test="resultsGallery"]') !== null;
    }
    // Category pages: /c/{slug}
    if (window.location.pathname.startsWith("/c/")) {
      return document.querySelector('[data-test="product-grid"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    // Target search result cards
    const cards = document.querySelectorAll(
      '[data-test="product-grid"] [data-test="@web/site-top-of-funnel/ProductCardWrapper"], ' +
      '[data-test="resultsGallery"] li, ' +
      '.styles__StyledCol-sc-ct4ii5-0'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;

      // Skip sponsored
      if (card.querySelector('[data-test="sponsored-label"]')) continue;

      const titleEl = card.querySelector('a[data-test="product-title"], [data-test="product-title"] a, a[aria-label]');
      const title = titleEl?.textContent?.trim() || titleEl?.getAttribute("aria-label") || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a[data-test="product-title"], a[href*="/p/"]');
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-test="current-price"] span, [data-test="product-price"]');
      const price = priceEl?.textContent?.trim() || "";

      const ratingEl = card.querySelector('[data-test="ratings"] span, .RatingStars');
      const rating = ratingEl?.textContent?.trim() || ratingEl?.getAttribute("aria-label") || "";

      const reviewEl = card.querySelector('[data-test="rating-count"], [data-test="numberOfRatings"]');
      const reviewCount = reviewEl?.textContent?.trim() || "";

      const imgEl = card.querySelector<HTMLImageElement>('picture img, [data-test="product-image"] img');
      const imageUrl = imgEl?.src || "";

      listings.push({
        title,
        brand: "",
        price,
        currency: "USD",
        rating,
        reviewCount,
        seller: "Target",
        fulfiller: "Target",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl,
        barcode: "",
        source_site: "target",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("searchTerm") || params.get("Ntt") || "";
    if (!query) return null;
    return {
      query,
      destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "",
    };
  }

  extractProduct(): ProductData {
    // Try JSON-LD first (Target uses structured data)
    const jsonLd = this.getJsonLdProduct();

    const title =
      jsonLd?.name ||
      extractText([
        '[data-test="product-title"]',
        'h1[data-test="product-detail-title"]',
        '#pdp-product-title-id',
        'h1',
      ]);

    const brand =
      jsonLd?.brand?.name ||
      extractText([
        '[data-test="product-brand"]',
        'a[data-test="product-brand-link"]',
        '.ProductBrand',
      ]);

    const price =
      jsonLd?.offers?.price?.toString() ||
      extractText([
        '[data-test="product-price"]',
        '[data-test="current-price"]',
        'span[data-test="product-price-sale"]',
        '.styles__CurrentPriceFontSize',
      ]);

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      extractText([
        '[data-test="rating-value"]',
        '[data-test="stars"]',
        '.RatingStars',
      ]);

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      this.extractReviewCount();

    const seller = "Target";

    const delivery = extractText([
      '[data-test="shipping-message"]',
      '[data-test="fulfillment-cell-shipping"]',
      '.FulfillmentSection',
    ]);

    const returnPolicy = extractText([
      '[data-test="return-policy"]',
      '.ReturnPolicy',
    ]);

    const category = this.extractCategory();

    const imageUrl =
      jsonLd?.image ||
      document.querySelector<HTMLImageElement>('[data-test="product-image"] img, [data-test="image-gallery-item-0"] img, picture img')?.src ||
      "";

    return {
      title,
      brand,
      price,
      currency: "USD",
      rating,
      reviewCount,
      seller,
      fulfiller: "Target",
      ingredients: this.extractIngredients(),
      nutritionInfo: this.extractNutritionInfo(),
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "",
      source_site: "target",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    const cartItems = document.querySelectorAll(
      '[data-test="cart-item"], [data-test="cartItem"], .CartItem'
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector('a[data-test="cart-item-title"], .CartItem-title a');
      const priceEl = item.querySelector('[data-test="cart-item-price"], .CartItem-price');
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
        seller: "Target",
        fulfiller: "Target",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url: linkEl?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "target",
        page_type: "cart",
      });
    });
    return products;
  }

  private extractReviewCount(): string {
    const el = document.querySelector(
      '[data-test="rating-count"], [data-test="reviewCount"], .RatingCount'
    );
    return el?.textContent?.trim() || "";
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll(
      '[data-test="breadcrumb"] a, nav[aria-label="Breadcrumb"] a, .Breadcrumb a'
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent?.trim() || "";
    }
    return "";
  }

  private extractIngredients(): string {
    // Target shows product details in expandable sections
    const sections = document.querySelectorAll(
      '[data-test="item-details-description"], [data-test="product-detail-tabs"] div, .ProductDetailSection'
    );
    for (const section of sections) {
      const text = section.textContent?.trim() || "";
      if (text.toLowerCase().includes("ingredient")) return text;
    }

    // Look for headings
    const headings = document.querySelectorAll('h3, h4, b, strong');
    for (const h of headings) {
      if (h.textContent?.toLowerCase().includes("ingredient")) {
        const next = h.nextElementSibling || h.parentElement?.nextElementSibling;
        if (next?.textContent?.trim()) return next.textContent.trim();
      }
    }
    return "";
  }

  private extractNutritionInfo(): string {
    const sections = document.querySelectorAll(
      '[data-test="nutrition-facts"], [data-test="nutritionFacts"], .NutritionFacts'
    );
    for (const section of sections) {
      if (section.textContent?.trim()) return section.textContent.trim();
    }

    const headings = document.querySelectorAll('h3, h4, b, strong');
    for (const h of headings) {
      if (h.textContent?.toLowerCase().includes("nutrition")) {
        const next = h.nextElementSibling || h.parentElement?.nextElementSibling;
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
