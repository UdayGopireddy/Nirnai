// Generic fallback extractor — uses JSON-LD, meta tags, and common patterns

import { ProductData } from "../../types.js";
import { SiteExtractor } from "./base.js";

export class GenericExtractor implements SiteExtractor {
  siteName(): string {
    return ""; // Matches any site as fallback
  }

  isCartPage(): boolean {
    return false;
  }

  extractCartProducts(): ProductData[] {
    return [];
  }

  isProductPage(): boolean {
    // Check for JSON-LD Product schema
    const jsonLd = this.getJsonLdProduct();
    if (jsonLd) return true;

    // Check for common product page indicators
    const hasPrice = document.querySelector("[itemprop='price'], .price, .product-price") !== null;
    const hasTitle = document.querySelector("[itemprop='name'], .product-title, h1") !== null;
    return hasPrice && hasTitle;
  }

  extractProduct(): ProductData {
    const jsonLd = this.getJsonLdProduct();

    const title =
      jsonLd?.name ||
      this.getMeta("og:title") ||
      document.querySelector("h1")?.textContent?.trim() ||
      "";

    const price =
      jsonLd?.offers?.price?.toString() ||
      this.getMeta("product:price:amount") ||
      document.querySelector("[itemprop='price']")?.textContent?.trim() ||
      "";

    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      document.querySelector("[itemprop='ratingValue']")?.textContent?.trim() ||
      "";

    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      document.querySelector("[itemprop='reviewCount']")?.textContent?.trim() ||
      "";

    const brand =
      jsonLd?.brand?.name ||
      this.getMeta("product:brand") ||
      document.querySelector("[itemprop='brand']")?.textContent?.trim() ||
      "";

    const imageUrl =
      jsonLd?.image ||
      this.getMeta("og:image") ||
      "";

    return {
      title,
      brand,
      price,
      currency: this.getMeta("product:price:currency") || "USD",
      rating,
      reviewCount,
      seller: "",
      fulfiller: "",
      ingredients: "",
      nutritionInfo: "",
      returnPolicy: "",
      delivery: "",
      category: "",
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: "",
      source_site: window.location.hostname.replace("www.", "").split(".")[0],
      page_type: "product",
    };
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

  private getMeta(property: string): string {
    const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
    return el?.getAttribute("content") || "";
  }
}
