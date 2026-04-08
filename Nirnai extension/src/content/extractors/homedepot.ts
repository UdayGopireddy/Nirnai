// Home Depot product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Home Depot search URL builder for cross-site comparison
registerSearchUrlBuilder("homedepot", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.homedepot.com/s/${encodeURIComponent(p.query)}`;
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

export class HomeDepotExtractor implements SiteExtractor {
  siteName(): string {
    return "homedepot";
  }

  isProductPage(): boolean {
    // Home Depot product pages: /p/{product-name}/{skuId}
    if (/\/p\/[^/]+\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('.product-details__badge-title--wrapper, [data-testid="product-title"], .mainTitle')) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/mycart") ||
      window.location.pathname.includes("/cart") ||
      document.querySelector('.cart-page, [data-testid="cart-container"]') !== null
    );
  }

  isSearchPage(): boolean {
    // Home Depot search: /s/{query} or /b/{category}/{N-id}
    if (window.location.pathname.startsWith("/s/")) {
      return document.querySelector('.results-wrapped, [data-testid="product-pod"], .browse-search__pod') !== null;
    }
    // Category browse pages
    if (window.location.pathname.startsWith("/b/")) {
      return document.querySelector('[data-testid="product-pod"], .browse-search__pod') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll(
      '[data-testid="product-pod"], .browse-search__pod, .plp-pod, .product-pod'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;

      // Skip sponsored
      if (card.querySelector('[data-testid="sponsored-badge"], .sponsored')) continue;

      const titleEl = card.querySelector('[data-testid="product-header"] a, .product-pod--title a, a.product-title');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector(
        '[data-testid="product-pod-price-value"], .price-format__main-price, [data-price], ' +
        '[data-testid="standard-price"], .price-detailed__main-price, ' +
        '.price-format__large--strong, .price-format__dollars, ' +
        '[data-automation-id="standardPrice"], .pod-plp__price span'
      );
      let price = priceEl?.textContent?.trim() || "";
      // If selector-based extraction fails, try data-price attribute
      if (!price) {
        const dataPriceEl = card.querySelector('[data-price]');
        if (dataPriceEl) {
          const dp = dataPriceEl.getAttribute('data-price');
          if (dp) price = `$${dp}`;
        }
      }

      const ratingEl = card.querySelector('[data-testid="product-pod-ratings"] .stars, .stars-reviews-count__stars');
      const rating = ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "";

      const reviewEl = card.querySelector('[data-testid="product-pod-ratings"] .ratings-count, .stars-reviews-count__count');
      const reviewCount = reviewEl?.textContent?.trim().replace(/[()]/g, "") || "";

      const imgEl = card.querySelector<HTMLImageElement>('[data-testid="product-pod-image"] img, .product-image img, img.stretchy');
      const imageUrl = imgEl?.src || "";

      listings.push({
        title,
        brand: "",
        price,
        currency: "USD",
        rating,
        reviewCount,
        seller: "Home Depot",
        fulfiller: "Home Depot",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl,
        barcode: "",
        source_site: "homedepot",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    // /s/{query}
    const match = window.location.pathname.match(/^\/s\/(.+)/);
    const query = match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
    if (!query) {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("keyword") || params.get("NCNI-5") || "";
      if (!q) return null;
      return { query: q, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
    }
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
        '[data-testid="product-title"]',
        '.product-details__badge-title--wrapper h1',
        '.mainTitle',
        'h1',
      ]);

    const brand =
      jsonLd?.brand?.name ||
      extractText([
        '.product-details__brand--link',
        '[data-testid="product-brand"]',
        '.brand-link',
      ]);

    let price =
      jsonLd?.offers?.price?.toString() ||
      extractText([
        '[data-testid="price-value"]',
        '.price-format__main-price',
        '.price .price-format__large',
        '[data-testid="standard-price"]',
        '.price-detailed__main-price',
        '.price-format__large--strong',
        '.price-format__dollars',
        '[data-automation-id="standardPrice"]',
        '#standard-price',
        '.buybox__price',
      ]);
    // Fallback: extract price from any data-price attribute on the page
    if (!price) {
      const dataPriceEl = document.querySelector('[data-price]');
      if (dataPriceEl) {
        const dp = dataPriceEl.getAttribute('data-price');
        if (dp) price = `$${dp}`;
      }
    }
    // Fallback: regex scan visible price containers
    if (!price) {
      const priceContainers = document.querySelectorAll('.price, .price-format, [class*="price"]');
      for (const el of priceContainers) {
        const text = el.textContent?.trim() || "";
        const match = text.match(/\$[\d,]+\.?\d{0,2}/);
        if (match) { price = match[0]; break; }
      }
    }

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      extractText([
        '[itemprop="ratingValue"]',
        '.ratings-and-reviews__stars--num',
      ]);

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      extractText([
        '[itemprop="reviewCount"]',
        '.ratings-and-reviews__count',
      ]);

    const delivery = extractText([
      '[data-testid="fulfillment-messaging"]',
      '.fulfillment__text',
      '.delivery-text',
    ]);

    const returnPolicy = extractText([
      '.return-policy',
      '[data-testid="return-policy"]',
    ]);

    const category = this.extractCategory();

    const imageUrl =
      jsonLd?.image ||
      document.querySelector<HTMLImageElement>('[data-testid="media-gallery-image"] img, .mediagallery__mainimage img, #mainImage img')?.src ||
      "";

    const sku = this.extractSku();

    return {
      title,
      brand,
      price,
      currency: "USD",
      rating,
      reviewCount,
      seller: "Home Depot",
      fulfiller: "Home Depot",
      ingredients: "",
      nutritionInfo: "",
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: sku ? `sku=${sku}` : "",
      source_site: "homedepot",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    const cartItems = document.querySelectorAll(
      '[data-testid="cart-item"], .cart-item, .cart__item'
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector('[data-testid="cart-item-title"] a, .cart-item__description a, .product-name a');
      const priceEl = item.querySelector('[data-testid="cart-item-price"], .cart-item__price, .price');
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
        seller: "Home Depot",
        fulfiller: "Home Depot",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url: linkEl?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "homedepot",
        page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll(
      '.breadcrumb__item a, [data-testid="breadcrumb"] a, nav[aria-label="breadcrumb"] a'
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent?.trim() || "";
    }
    return "";
  }

  private extractSku(): string {
    // /p/{name}/{skuId}
    const match = window.location.pathname.match(/\/p\/[^/]+\/(\d+)/);
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
