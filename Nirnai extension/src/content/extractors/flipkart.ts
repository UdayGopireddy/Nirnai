// Flipkart product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("flipkart", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.flipkart.com/search?q=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class FlipkartExtractor implements SiteExtractor {
  siteName(): string { return "flipkart"; }

  isProductPage(): boolean {
    // Flipkart product pages have /p/ in the URL path
    if (/\/p\//.test(window.location.pathname)) return true;
    if (document.querySelector('span[class*="B_NuCI"], h1[class*="yhB1nd"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") ||
      document.querySelector('[class*="cart-item"], [class*="cartItem"]') !== null;
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/search") || window.location.search.includes("q=")) {
      return document.querySelector('[data-id], ._1AtVbE, ._13oc-S') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    // Flipkart search grid cards
    const cards = document.querySelectorAll('._1AtVbE, [data-id]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('._4rR01T, .s1Q9rs, .IRpwTa, [class*="title"]');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a._1fQZEK, a.s1Q9rs, a[href*="/p/"]');
      if (!linkEl) continue;
      const url = new URL(linkEl.href, window.location.origin).href;

      const priceEl = card.querySelector('._30jeq3, [class*="price"]');
      const ratingEl = card.querySelector('._3LWZlK, [class*="rating"]');
      const reviewEl = card.querySelector('._2_R_DZ span, [class*="review"]');
      const imgEl = card.querySelector<HTMLImageElement>('img._396cs4, img._2r_T1I, img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "INR",
        rating: ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim() || "",
        seller: "Flipkart", fulfiller: "Flipkart",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "flipkart", page_type: "search",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
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
    const title = jsonLd?.name || extractText([
      'span.B_NuCI', 'h1[class*="yhB1nd"]', 'span[class*="B_NuCI"]', 'h1',
    ]);
    const brand = jsonLd?.brand?.name || extractText(['._2S61XT a, ._2S61XT span']);
    const price = jsonLd?.offers?.price?.toString() || extractText([
      '._30jeq3._16Jk6d', '._30jeq3', 'div[class*="CEmiEU"] .Nx9bqj',
    ]);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText([
      'div._3LWZlK', 'div[class*="_3LWZlK"]',
    ]);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText([
      'span._2_R_DZ span', 'span[class*="count"]',
    ]);
    const seller = extractText(['#sellerName span, [class*="sellerName"] span, ._3I9_wc._2p6lqe']) || "Flipkart";
    const delivery = extractText(['._2Tpdn3, [class*="delivery"]']);
    const returnPolicy = extractText(['._2Tpdn3:last-child, [class*="return"]']);
    const imageUrl = jsonLd?.image?.[0] || jsonLd?.image ||
      document.querySelector<HTMLImageElement>('._396cs4, img._2r_T1I, ._3kidJX img')?.src || "";
    const category = this.extractCategory();

    return {
      title, brand, price, currency: "INR", rating, reviewCount,
      seller, fulfiller: seller,
      ingredients: "", nutritionInfo: "", returnPolicy, delivery, category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "flipkart", page_type: "product",
      country_code: "IN", currency_code: "INR", locale: "en-IN",
      tax_included: true, shipping_region: "IN", measurement_system: "metric",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('div[class*="cart-item"], ._3GfSO5').forEach(item => {
      const titleEl = item.querySelector('a[class*="title"], ._3GfSO5 a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('._30jeq3, [class*="price"]');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "INR",
        rating: "", reviewCount: "", seller: "Flipkart", fulfiller: "Flipkart",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: (titleEl as HTMLAnchorElement)?.href || window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "", source_site: "flipkart", page_type: "cart",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('._1MR4o5 a, .ow3fGO a, nav a');
    return crumbs.length > 0 ? (crumbs[crumbs.length - 1].textContent?.trim() || "") : "";
  }

  private getJsonLd(): any | null {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(script.textContent || "");
        if (d["@type"] === "Product") return d;
        if (Array.isArray(d)) { const p = d.find((x: any) => x["@type"] === "Product"); if (p) return p; }
      } catch {}
    }
    return null;
  }
}
