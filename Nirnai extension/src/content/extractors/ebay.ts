// eBay product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("ebay", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class EbayExtractor implements SiteExtractor {
  siteName(): string { return "ebay"; }

  isProductPage(): boolean {
    if (/\/itm\/\d+/.test(window.location.pathname) || /\/itm\/[^/]+\/\d+/.test(window.location.pathname)) return true;
    if (document.querySelector('#mainContent .x-item-title, [data-testid="x-item-title"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/sc/") || window.location.hostname.includes("cart.ebay");
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/sch/")) {
      return document.querySelector('.srp-results, .s-item, [data-testid="srp-river-results"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('.s-item, [data-testid="srp-river-results"] .s-item');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('.s-item__ad-badge')) continue;

      const titleEl = card.querySelector('.s-item__title, .s-item__title span');
      const title = titleEl?.textContent?.trim() || "";
      if (!title || title === "Shop on eBay") continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('.s-item__link, a.s-item__link');
      const url = linkEl?.href || "";
      if (!url) continue;

      const priceEl = card.querySelector('.s-item__price');
      const ratingEl = card.querySelector('.x-star-rating span, .b-starrating__star');
      const reviewEl = card.querySelector('.s-item__reviews-count span, .s-item__reviews-count');
      const imgEl = card.querySelector<HTMLImageElement>('.s-item__image-img, img.s-item__image-img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "eBay", fulfiller: "eBay",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "ebay", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("_nkw") || params.get("_keyword") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['#mainContent .x-item-title__mainTitle span', '[data-testid="x-item-title"] span', 'h1.x-item-title__mainTitle', 'h1']);
    const brand = jsonLd?.brand?.name || extractText(['.x-item-title__mainTitle .ux-textspans--SECONDARY', '[itemprop="brand"]']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['.x-price-primary span', '[data-testid="x-price-primary"]', '#prcIsum']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['.x-star-rating .clipped', '[itemprop="ratingValue"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['.ux-seller-section__item--reviewCount span', '[itemprop="reviewCount"]']);
    const seller = extractText(['.x-sellercard-atf__info__about-seller a span', '.ux-seller-section__item--seller a span']) || "eBay Seller";
    const delivery = extractText(['.ux-labels-values--deliverto .ux-textspans', '[data-testid="d-shipping-txt"]']);
    const returnPolicy = extractText(['.ux-labels-values--returns .ux-textspans--BOLD']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('#icImg, .ux-image-carousel-item img, [data-testid="ux-image-carousel"] img')?.src || "";
    return {
      title, brand, price, currency: "USD", rating, reviewCount, seller, fulfiller: seller,
      ingredients: "", nutritionInfo: "", returnPolicy, delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "ebay", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('.cart-bucket-lineitem, .item-row, [data-testid="cart-item"]').forEach(item => {
      const titleEl = item.querySelector('a.cart-item-link, .item-title a, [data-testid="item-title"] a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('.item-price, [data-testid="item-price"]');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "eBay", fulfiller: "eBay",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "ebay", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('.seo-breadcrumb-text span, nav.breadcrumbs a');
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
