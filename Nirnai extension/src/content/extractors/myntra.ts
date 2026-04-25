// Myntra product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("myntra", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.myntra.com/${encodeURIComponent(p.query.replace(/\s+/g, "-"))}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class MyntraExtractor implements SiteExtractor {
  siteName(): string { return "myntra"; }

  isProductPage(): boolean {
    // Myntra product URLs contain a numeric ID at the end  e.g. /brand/product/buy/12345678
    if (/\/buy\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('.pdp-title, .pdp-name, h1.pdp-title')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") ||
      document.querySelector('.cart-items-container, .itemContainer-base-container') !== null;
  }

  isSearchPage(): boolean {
    // Myntra search: /brand-name?rawQuery=query or category pages
    const hasResults = document.querySelector('.search-searchProductsContainer, .results-base') !== null;
    return hasResults;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('.product-base, li.product-base');
    for (const card of cards) {
      if (listings.length >= maxResults) break;

      const titleEl = card.querySelector('.product-product, .product-brand');
      const nameEl = card.querySelector('.product-product');
      const brandEl = card.querySelector('.product-brand');
      const title = [brandEl?.textContent?.trim(), nameEl?.textContent?.trim()].filter(Boolean).join(" ") || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('a');
      if (!linkEl) continue;
      const url = new URL(linkEl.href, window.location.origin).href;

      const priceEl = card.querySelector('.product-discountedPrice, .product-price');
      const ratingEl = card.querySelector('.product-ratingsCount');
      const imgEl = card.querySelector<HTMLImageElement>('img.img-responsive');

      listings.push({
        title, brand: brandEl?.textContent?.trim() || "",
        price: priceEl?.textContent?.trim() || "",
        currency: "INR",
        rating: "",
        reviewCount: ratingEl?.textContent?.trim() || "",
        seller: "Myntra", fulfiller: "Myntra",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "myntra", page_type: "search",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("rawQuery") || params.get("q") ||
      decodeURIComponent(window.location.pathname.split("/")[1] || "").replace(/-/g, " ");
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const brand = jsonLd?.brand?.name || extractText(['.pdp-title, h1.pdp-title']);
    const name = extractText(['.pdp-name, .pdp-product-name']);
    const title = [brand, name].filter(Boolean).join(" ") || jsonLd?.name || "";
    const price = jsonLd?.offers?.price?.toString() || extractText([
      '.pdp-price strong, .pdp-mrp strong, [class*="pdp-price"]',
    ]);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText([
      '.index-overallRating div, .pdp-ratingsAndReviewsContainer .index-overallRating',
    ]);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText([
      '.pdp-ratingsAndReviewsContainer .index-ratingsCount',
    ]);
    const returnPolicy = extractText(['.return-period, [class*="returnPeriod"]']);
    const delivery = extractText(['.delivery-section .delivery-dateContainer, [class*="delivery"]']);
    const imageUrl = jsonLd?.image?.[0] || jsonLd?.image ||
      document.querySelector<HTMLImageElement>('.image-grid-image, .pdp-image img')?.src || "";
    const category = this.extractCategory();

    return {
      title, brand, price, currency: "INR", rating, reviewCount,
      seller: "Myntra", fulfiller: "Myntra",
      ingredients: "", nutritionInfo: "", returnPolicy, delivery, category,
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "myntra", page_type: "product",
      country_code: "IN", currency_code: "INR", locale: "en-IN",
      tax_included: true, shipping_region: "IN", measurement_system: "metric",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('.itemContainer-base-container, .cart-item').forEach(item => {
      const titleEl = item.querySelector('.itemContainer-base-brand, .itemContainer-base-product');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('.itemContainer-base-finalPrice, [class*="price"]');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "INR",
        rating: "", reviewCount: "", seller: "Myntra", fulfiller: "Myntra",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: window.location.href,
        imageUrl: imgEl?.src || "",
        barcode: "", source_site: "myntra", page_type: "cart",
        country_code: "IN", currency_code: "INR", locale: "en-IN",
        tax_included: true, shipping_region: "IN", measurement_system: "metric",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.breadcrumbs-container a, nav[aria-label="breadcrumb"] a');
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
