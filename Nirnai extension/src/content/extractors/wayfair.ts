// Wayfair product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

registerSearchUrlBuilder("wayfair", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  return `https://www.wayfair.com/keyword.html?keyword=${encodeURIComponent(p.query)}`;
});

function extractText(selectors: string[]): string {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

export class WayfairExtractor implements SiteExtractor {
  siteName(): string { return "wayfair"; }

  isProductPage(): boolean {
    // Wayfair product pages: /keyword-{sku}.html or /{product}.html with sku param
    if (document.querySelector('[data-cypress="titleBlock"], [data-hb-id="ProductDetailTitle"], .ProductDetailInfoBlock')) return true;
    if (/\.html$/.test(window.location.pathname) && document.querySelector('[data-enzyme-id="PriceBlock"]')) return true;
    return false;
  }

  isCartPage(): boolean {
    return window.location.pathname.includes("/cart") || document.querySelector('[data-hb-id="CartPage"]') !== null;
  }

  isSearchPage(): boolean {
    if (window.location.pathname.includes("/keyword.html") || window.location.pathname.includes("/sb/")) {
      return document.querySelector('[data-hb-id="BrowseGrid"], .BrowseGrid, [data-enzyme-id="BrowseGrid"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    const cards = document.querySelectorAll('[data-hb-id="ProductCard"], .ProductCard, [data-enzyme-id="ProductCard"]');
    for (const card of cards) {
      if (listings.length >= maxResults) break;
      if (card.querySelector('[data-hb-id="SponsoredLabel"]')) continue;

      const titleEl = card.querySelector('[data-hb-id="ProductCardName"] a, .ProductCard-name a, a[data-enzyme-id="ProductCardLink"]');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;
      const linkEl = titleEl as HTMLAnchorElement | null;
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : "";
      if (!url) continue;

      const priceEl = card.querySelector('[data-hb-id="PriceDisplay"], .ProductCard-price, [data-enzyme-id="PriceDisplay"]');
      const ratingEl = card.querySelector('[data-hb-id="ProductRating"], .ProductCard-rating');
      const reviewEl = card.querySelector('[data-hb-id="ReviewCount"], .ProductCard-reviewCount');
      const imgEl = card.querySelector<HTMLImageElement>('img[data-hb-id="ProductCardImage"], .ProductCard-image img');

      listings.push({
        title, brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: "USD",
        rating: ratingEl?.getAttribute("aria-label") || ratingEl?.textContent?.trim() || "",
        reviewCount: reviewEl?.textContent?.trim().replace(/[()]/g, "") || "",
        seller: "Wayfair", fulfiller: "Wayfair",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "wayfair", page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("keyword") || params.get("request_term") || "";
    if (!query) return null;
    return { query, destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "" };
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLd();
    const title = jsonLd?.name || extractText(['[data-cypress="titleBlock"] h1', '[data-hb-id="ProductDetailTitle"]', 'h1']);
    const brand = jsonLd?.brand?.name || extractText(['[data-cypress="manufacturerLink"]', '[data-hb-id="ProductBrand"]']);
    const price = jsonLd?.offers?.price?.toString() || extractText(['[data-enzyme-id="PriceBlock"] .PriceBlock-price', '[data-hb-id="PriceDisplay"]']);
    const rating = jsonLd?.aggregateRating?.ratingValue?.toString() || extractText(['[itemprop="ratingValue"]']);
    const reviewCount = jsonLd?.aggregateRating?.reviewCount?.toString() || extractText(['[itemprop="reviewCount"]']);
    const delivery = extractText(['[data-hb-id="DeliveryBlock"]', '.DeliveryBlock', '[data-cypress="deliveryBlock"]']);
    const returnPolicy = extractText(['[data-hb-id="ReturnPolicy"]', '.ReturnPolicy']);
    const imageUrl = jsonLd?.image || document.querySelector<HTMLImageElement>('[data-hb-id="ProductDetailImage"] img, .ProductDetailImageCarousel img')?.src || "";
    return {
      title, brand, price, currency: "USD", rating, reviewCount,
      seller: "Wayfair", fulfiller: "Wayfair",
      ingredients: "", nutritionInfo: "", returnPolicy, delivery,
      category: this.extractCategory(),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "", source_site: "wayfair", page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    document.querySelectorAll('[data-hb-id="CartItem"], .CartItem, [data-enzyme-id="CartItem"]').forEach(item => {
      const titleEl = item.querySelector('a[data-hb-id="CartItemName"], .CartItem-name a');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;
      const priceEl = item.querySelector('[data-hb-id="CartItemPrice"], .CartItem-price');
      const imgEl = item.querySelector<HTMLImageElement>('img');
      const linkEl = titleEl as HTMLAnchorElement | null;
      products.push({
        title, brand: "", price: priceEl?.textContent?.trim() || "", currency: "USD",
        rating: "", reviewCount: "", seller: "Wayfair", fulfiller: "Wayfair",
        ingredients: "", nutritionInfo: "", returnPolicy: "", delivery: "", category: "",
        url: linkEl?.href || window.location.href, imageUrl: imgEl?.src || "",
        barcode: "", source_site: "wayfair", page_type: "cart",
      });
    });
    return products;
  }

  private extractCategory(): string {
    const crumbs = document.querySelectorAll('[data-hb-id="Breadcrumb"] a, .Breadcrumbs a');
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
