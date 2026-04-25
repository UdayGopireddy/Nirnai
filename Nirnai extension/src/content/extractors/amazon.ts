// Amazon product page extractor

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";

// Register Amazon search URL builder for cross-site comparison
registerSearchUrlBuilder("amazon", (p: CrossSiteSearchParams): string => {
  if (!p.query) return "";
  const sp = new URLSearchParams();
  sp.set("k", p.query);
  return `https://www.amazon.com/s?${sp.toString()}`;
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

export class AmazonExtractor implements SiteExtractor {
  siteName(): string {
    return "amazon";
  }

  isProductPage(): boolean {
    // Standard product pages
    if (document.querySelector("#productTitle") || document.querySelector("#title")) return true;
    // Amazon Luxury / alternative layouts
    if (document.querySelector('[data-testid="product-title"]') || document.querySelector("h1.product-title-word-break")) return true;
    // URL-based fallback: any /dp/ page is a product page
    if (/\/dp\/[A-Z0-9]{10}/i.test(window.location.pathname)) return true;
    return false;
  }

  isCartPage(): boolean {
    return (
      window.location.pathname.includes("/cart") ||
      window.location.pathname.includes("/gp/cart") ||
      document.querySelector("#sc-active-cart") !== null
    );
  }

  isSearchPage(): boolean {
    // Amazon search: /s?k=query or /s/ref=... with search results
    if (window.location.pathname === "/s" || window.location.pathname.startsWith("/s/")) {
      return document.querySelector('.s-search-results, [data-component-type="s-search-results"]') !== null;
    }
    return false;
  }

  extractSearchListings(maxResults: number = 20): ProductData[] {
    const listings: ProductData[] = [];
    // Amazon search result cards
    const cards = document.querySelectorAll(
      '[data-component-type="s-search-result"], .s-result-item[data-asin]:not(.AdHolder)'
    );

    for (const card of cards) {
      if (listings.length >= maxResults) break;
      const asin = card.getAttribute("data-asin");
      if (!asin) continue;

      // Skip sponsored/ad cards
      if (card.querySelector('.s-label-popover-default, [data-component-type="sp-sponsored-result"]')) continue;

      const titleEl = card.querySelector('h2 a span, h2 span a span, [data-cy="title-recipe"] a span');
      const title = titleEl?.textContent?.trim() || "";
      if (!title) continue;

      const linkEl = card.querySelector<HTMLAnchorElement>('h2 a, [data-cy="title-recipe"] a');
      const url = linkEl ? new URL(linkEl.href, window.location.origin).href : `https://www.amazon.com/dp/${asin}`;

      const priceWhole = card.querySelector('.a-price:not(.a-text-price) .a-offscreen, .a-price:not(.a-text-price) span[aria-hidden="true"]');
      const price = priceWhole?.textContent?.trim() || "";

      const ratingEl = card.querySelector('.a-icon-alt, [aria-label*="out of"]');
      const rating = ratingEl?.textContent?.trim() || ratingEl?.getAttribute("aria-label") || "";

      const reviewEl = card.querySelector('a [aria-label*="star"], .a-size-base.s-underline-text, a .a-size-base');
      let reviewCount = "";
      if (reviewEl) {
        const ariaLabel = reviewEl.getAttribute("aria-label");
        reviewCount = ariaLabel || reviewEl.textContent?.trim() || "";
      }

      const imgEl = card.querySelector<HTMLImageElement>('img.s-image');
      const imageUrl = imgEl?.src || "";

      const brandEl = card.querySelector('.a-size-base-plus.a-color-base, .s-line-clamp-1 span, [data-cy="reviews-ratings-count"]');
      const brand = card.querySelector('.a-row .a-size-base-plus')?.textContent?.trim() || "";

      listings.push({
        title,
        brand,
        price,
        currency: this.detectCurrency(),
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
        source_site: "amazon",
        page_type: "search",
      });
    }
    return listings;
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("k") || params.get("field-keywords") || "";
    if (!query) return null;
    return {
      query,
      destination: "", checkin: "", checkout: "", adults: "", children: "", rooms: "",
    };
  }

  extractProduct(): ProductData {
    const title = extractText([
      "#productTitle",
      "#title span",
      "h1.product-title-word-break",
      '[data-testid="product-title"]',
      ".product-title-word-break",
      "h1",
    ]);

    const brand = extractText([
      "#bylineInfo",
      "#brand",
      '[data-testid="brand-link"]',
      ".luxury-brand-name",
    ]);

    const price = extractText([
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".a-price-whole",
      "#price_inside_buybox",
      "#newBuyBoxPrice",
      '[data-testid="price-value"]',
      ".a-price span[aria-hidden=true]",
      ".reinventPricePriceToPayMargin .a-offscreen",
    ]);

    const rating = extractText([
      "#acrPopover .a-icon-alt",
      "span.a-icon-alt",
      "#averageCustomerReviews .a-icon-alt",
    ]);

    const reviewCount = extractText([
      "#acrCustomerReviewText",
      "#acrCustomerReviewLink span",
      "#reviews-medley-footer a span",
      "#averageCustomerReviews_feature_div #acrCustomerReviewLink",
      "[data-hook='total-review-count'] span",
      "#reviewsMedley [data-hook='total-review-count']",
      ".averageStarRatingNumerical",
      "#acrCustomerReviewLink",
    ]);

    let seller = extractText([
      "#sellerProfileTriggerId",
      "#merchant-info a",
      '#tabular-buybox .tabular-buybox-text a',
      '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"] span',
      "#shipsFromSoldByInsideBuyBox_feature_div .a-link-normal",
    ]);

    // Fallback: derive seller from brand byline (e.g. "Visit the French Toast Store")
    if (!seller && brand) {
      const cleaned = brand
        .replace(/^Visit the\s+/i, "")
        .replace(/\s+Store$/i, "")
        .replace(/^Brand:\s*/i, "")
        .trim();
      if (cleaned) seller = cleaned;
    }

    // Extract fulfiller ("Ships from" info, often Amazon)
    const fulfiller = extractText([
      '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Ships from"] span',
      '#shipsFromSoldByInsideBuyBox_feature_div span:first-of-type',
      '#fulfillment-fulfiller-message span',
    ]);

    const returnPolicy = extractText([
      "#mir-layout-RETURNS_POLICY .a-text-bold",
    ]);

    const delivery = extractText([
      "#mir-layout-DELIVERY_BLOCK .a-text-bold",
      "#deliveryBlockMessage .a-text-bold",
      "#delivery-message .a-text-bold",
    ]);

    const category = extractText([
      "#wayfinding-breadcrumbs_feature_div ul li:last-child a",
      ".a-breadcrumb li:last-child a",
    ]);

    const imageUrl =
      document.querySelector<HTMLImageElement>("#landingImage")?.src ||
      document.querySelector<HTMLImageElement>("#imgBlkFront")?.src ||
      document.querySelector<HTMLImageElement>('[data-testid="image-block-main-image"]')?.src ||
      document.querySelector<HTMLImageElement>(".a-dynamic-image")?.src ||
      "";

    const base: ProductData = {
      title,
      brand,
      price,
      currency: this.detectCurrency(),
      rating,
      reviewCount,
      seller,
      fulfiller,
      ingredients: this.extractIngredients(),
      nutritionInfo: this.extractNutritionInfo(),
      returnPolicy,
      delivery,
      category,
      url: window.location.href,
      imageUrl,
      barcode: "",
      source_site: "amazon",
      page_type: "product",
    };

    // Layer India-specific fields on top when on amazon.in. Other regions are
    // unaffected — the backend only consults these when country === "IN".
    if (window.location.hostname.includes("amazon.in")) {
      Object.assign(base, this.extractIndiaFields());
    }
    return base;
  }

  /**
   * Pull India-only signals (MRP, bank offers, coupon, shipping, EMI, COD) from
   * an amazon.in product page. All fields are best-effort: missing data just
   * means the scorer falls back to its default behavior.
   */
  private extractIndiaFields(): Partial<ProductData> {
    // MRP — usually shown as "M.R.P.: ₹X,XXX" struck through above the price.
    const mrp = extractText([
      ".a-price.a-text-price[data-a-strike='true'] .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-text-strike",
      "#priceblock_listprice",
      ".basisPrice .a-text-strike",
      "#listPrice",
    ]);

    // Bank offers — Amazon renders these as a horizontal carousel of small cards.
    const bankNodes = document.querySelectorAll(
      "#itembox-InstantBankDiscount .a-box, #vsxoffers_feature_div .a-carousel-card, #applicablePromotionList_feature_div .a-list-item"
    );
    const bank_offers: string[] = [];
    bankNodes.forEach((n) => {
      const txt = n.textContent?.replace(/\s+/g, " ").trim() || "";
      // Filter to entries that actually look like bank/card offers.
      if (txt && /bank|card|emi|credit|debit/i.test(txt) && bank_offers.length < 6) {
        bank_offers.push(txt.slice(0, 240));
      }
    });

    // Coupon — small green "Apply ₹X coupon" badge under the price.
    const coupon = extractText([
      "#promoPriceBlockMessage_feature_div .a-color-success",
      "#applicablePromotionList_feature_div .a-color-success",
      "#vpcSubstitutionTitle_feature_div .a-color-success",
    ]);

    // Shipping cost — Amazon shows "FREE delivery" or a numeric charge.
    const deliveryText = extractText([
      "#mir-layout-DELIVERY_BLOCK",
      "#deliveryBlockMessage",
      "#delivery-message",
      "#contextualIngressPtLabel_deliveryShortLine",
    ]);
    let shipping_cost = "";
    if (deliveryText) {
      if (/free/i.test(deliveryText)) {
        shipping_cost = "FREE";
      } else {
        const m = deliveryText.match(/₹\s?([\d,]+)/);
        if (m) shipping_cost = `₹${m[1]}`;
      }
    }

    // No-cost EMI badge.
    const emiText = extractText([
      "#emi_feature_div",
      "#vsxoffers_feature_div",
    ]);
    const emi_no_cost = /no\s*cost\s*emi/i.test(emiText);

    // Cash on Delivery — Amazon mentions it in the "Payment" or returns block.
    const codText = extractText([
      "#paymentInformation_feature_div",
      "#mir-layout-PAYMENT",
      "#paymentSection",
    ]);
    const cod_available = /cash\s*on\s*delivery|pay\s*on\s*delivery/i.test(
      codText + " " + deliveryText
    );

    return { mrp, bank_offers, coupon, shipping_cost, emi_no_cost, cod_available };
  }

  extractCartProducts(): ProductData[] {
    const products: ProductData[] = [];
    // Amazon cart items — each item is in a div with data-asin or class sc-list-item
    const cartItems = document.querySelectorAll(
      "[data-asin].sc-list-item, .sc-list-item[data-asin], .a-list-item .sc-item-content-group"
    );
    cartItems.forEach((item) => {
      const titleEl = item.querySelector(".sc-product-title, .a-truncate-cut, a.sc-product-link");
      const priceEl = item.querySelector(".sc-product-price, .sc-item-price-block .a-price .a-offscreen");
      const imgEl = item.querySelector<HTMLImageElement>("img.sc-product-image, .sc-item-image img");
      const linkEl = item.querySelector<HTMLAnchorElement>("a.sc-product-link, a[href*='/dp/']");

      const title = titleEl?.textContent?.trim() || "";
      if (!title) return;

      const url = linkEl?.href || window.location.href;

      products.push({
        title,
        brand: "",
        price: priceEl?.textContent?.trim() || "",
        currency: this.detectCurrency(),
        rating: "",
        reviewCount: "",
        seller: "",
        fulfiller: "",
        ingredients: "",
        nutritionInfo: "",
        returnPolicy: "",
        delivery: "",
        category: "",
        url,
        imageUrl: imgEl?.src || "",
        barcode: "",
        source_site: "amazon",
        page_type: "cart",
      });
    });
    return products;
  }

  private detectCurrency(): string {
    const hostname = window.location.hostname;
    if (hostname.includes("amazon.in")) return "INR";
    if (hostname.includes("amazon.co.uk")) return "GBP";
    return "USD";
  }

  private extractIngredients(): string {
    // Check "Important information" section
    const importantInfoSection = document.querySelector("#important-information");
    if (importantInfoSection) {
      const sections = importantInfoSection.querySelectorAll(".a-section");
      for (const section of sections) {
        const heading = section.querySelector("h4, .a-text-bold");
        if (heading?.textContent?.toLowerCase().includes("ingredient")) {
          const content = section.querySelector("p, .a-section div");
          if (content?.textContent?.trim()) {
            return content.textContent.trim();
          }
        }
      }
    }

    // Check bullet points
    const bulletPoints = document.querySelectorAll("#feature-bullets ul li span");
    for (const bp of bulletPoints) {
      const text = bp.textContent?.trim() || "";
      if (text.toLowerCase().includes("ingredient")) {
        return text;
      }
    }

    // Check product detail tables
    const detailRows = document.querySelectorAll(
      "#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li"
    );
    for (const row of detailRows) {
      const text = row.textContent?.trim() || "";
      if (text.toLowerCase().includes("ingredient")) {
        return text;
      }
    }

    return "";
  }

  private extractNutritionInfo(): string {
    const nutritionSelectors = [
      "#nutritionFacts",
      "#nutrition-information",
      ".nutrition-facts",
    ];

    for (const selector of nutritionSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim()) {
        return el.textContent.trim();
      }
    }

    // Check important information section
    const importantInfoSection = document.querySelector("#important-information");
    if (importantInfoSection) {
      const sections = importantInfoSection.querySelectorAll(".a-section");
      for (const section of sections) {
        const heading = section.querySelector("h4, .a-text-bold");
        if (heading?.textContent?.toLowerCase().includes("nutrition")) {
          const content = section.querySelector("p, .a-section div");
          if (content?.textContent?.trim()) {
            return content.textContent.trim();
          }
        }
      }
    }

    return "";
  }
}
