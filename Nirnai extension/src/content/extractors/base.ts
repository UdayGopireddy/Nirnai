// Site extractor interface — adapter pattern per technical blueprint Section 15

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

// ── Geo-Context Detection ─────────────────────────────────────────────────────
// Auto-detects country, currency, locale, tax policy, and measurement system
// from the page's hostname, lang attribute, and price symbols.

export interface GeoContext {
  country_code: string;
  currency_code: string;
  locale: string;
  tax_included: boolean;
  shipping_region: string;
  measurement_system: string;
}

// TLD / hostname → country mapping (covers major e-commerce regions)
const HOSTNAME_COUNTRY_MAP: Record<string, string> = {
  ".in": "IN", ".co.in": "IN",
  ".com.au": "AU", ".co.uk": "UK", ".co.jp": "JP",
  ".de": "DE", ".fr": "FR", ".it": "IT", ".es": "ES", ".nl": "NL",
  ".ca": "CA", ".com.mx": "MX", ".com.br": "BR",
  ".sg": "SG", ".co.th": "TH", ".com.my": "MY", ".co.id": "ID", ".com.ph": "PH", ".vn": "VN",
  ".kr": "KR", ".tw": "TW", ".cn": "CN", ".hk": "HK",
  ".ae": "AE", ".sa": "SA",
  ".co.za": "ZA", ".com.ng": "NG",
};

// Country → currency code
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", IN: "INR", UK: "GBP", AU: "AUD", CA: "CAD", JP: "JPY",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR",
  SG: "SGD", TH: "THB", MY: "MYR", ID: "IDR", PH: "PHP", VN: "VND",
  KR: "KRW", TW: "TWD", CN: "CNY", HK: "HKD",
  MX: "MXN", BR: "BRL",
  AE: "AED", SA: "SAR",
  ZA: "ZAR", NG: "NGN",
};

// Countries where listed prices include VAT/GST (most of the world except US/CA)
const TAX_INCLUSIVE_COUNTRIES = new Set([
  "IN", "UK", "AU", "DE", "FR", "IT", "ES", "NL", "JP",
  "SG", "TH", "MY", "ID", "PH", "VN", "KR", "TW", "CN", "HK",
  "MX", "BR", "AE", "SA", "ZA", "NG",
]);

// Countries that use imperial measurement (US, Liberia, Myanmar)
const IMPERIAL_COUNTRIES = new Set(["US"]);

/**
 * Detect geo context from the current page's hostname, lang attribute,
 * and price symbols. Every extractor calls this to populate ProductData
 * geo fields — no per-extractor currency detection needed.
 */
export function detectGeoContext(): GeoContext {
  const hostname = window.location.hostname.toLowerCase();

  // 1. Detect country from hostname TLD (most specific first)
  let country = "US"; // default
  const sortedTlds = Object.keys(HOSTNAME_COUNTRY_MAP).sort((a, b) => b.length - a.length);
  for (const tld of sortedTlds) {
    if (hostname.endsWith(tld)) {
      country = HOSTNAME_COUNTRY_MAP[tld];
      break;
    }
  }

  // Special cases: global .com domains with region in path or subdomain
  if (country === "US" && hostname.endsWith(".com")) {
    const path = window.location.pathname.toLowerCase();
    // samsung.com/in/, nike.com/in/, apple.com/in/ etc.
    const regionMatch = path.match(/^\/([a-z]{2})\//);
    if (regionMatch) {
      const pathRegion = regionMatch[1].toUpperCase();
      if (COUNTRY_CURRENCY[pathRegion]) {
        country = pathRegion;
      }
    }
  }

  // 2. Currency from country (can be overridden by price symbol detection)
  const currency = COUNTRY_CURRENCY[country] || "USD";

  // 3. Locale from document lang or derived from country
  const docLang = document.documentElement.lang?.trim() || "";
  let locale = docLang || `en-${country}`;
  // Normalize bare language codes
  if (locale.length === 2) {
    locale = `${locale}-${country}`;
  }

  // 4. Tax included
  const taxIncluded = TAX_INCLUSIVE_COUNTRIES.has(country);

  // 5. Measurement system
  const measurement = IMPERIAL_COUNTRIES.has(country) ? "imperial" : "metric";

  return {
    country_code: country,
    currency_code: currency,
    locale,
    tax_included: taxIncluded,
    shipping_region: "domestic", // default; cross-site comparison may override
    measurement_system: measurement,
  };
}

/**
 * Merge geo context into a ProductData object, filling in the geo fields.
 * Call this at the end of every extractProduct / extractSearchListings / extractCartProducts.
 */
export function applyGeoContext(product: ProductData, geo?: GeoContext): ProductData {
  const g = geo || detectGeoContext();
  product.country_code = g.country_code;
  product.currency_code = g.currency_code;
  product.locale = g.locale;
  product.tax_included = g.tax_included;
  product.shipping_region = g.shipping_region;
  product.measurement_system = g.measurement_system;
  // Mirror country_code into the backend's `country` field so the India
  // scoring path is selected for IN-region payloads.
  product.country = g.country_code;
  // Also normalize the legacy currency field to ISO code
  if (!product.currency || product.currency === "USD") {
    product.currency = g.currency_code;
  }
  return product;
}

export interface SiteExtractor {
  /** Check if the current page is a product page */
  isProductPage(): boolean;
  /** Check if the current page is a cart page */
  isCartPage(): boolean;
  /** Check if the current page is a search results page */
  isSearchPage?(): boolean;
  /** Extract product data from the DOM */
  extractProduct(): ProductData;
  /** Extract products from the cart */
  extractCartProducts(): ProductData[];
  /** Extract top N listing cards from search results */
  extractSearchListings?(maxResults?: number): ProductData[];
  /** Return the source site identifier */
  siteName(): string;
  /** Return map bounds from the current search URL (if available) */
  getMapBounds?(): MapBounds | null;
  /** Return search center point (midpoint of bounds or explicit param) */
  getSearchCenter?(): SearchCenter | null;
  /** Return the destination/location name from the search URL */
  getSearchDestination?(): string;
  /** Extract common search parameters from the current page URL */
  getSearchParams?(): CrossSiteSearchParams | null;
}

/** Build a search URL for a travel platform from common search parameters */
export type SearchUrlBuilder = (params: CrossSiteSearchParams) => string;

export const TRAVEL_SEARCH_URL_BUILDERS: Record<string, SearchUrlBuilder> = {};

export function registerSearchUrlBuilder(site: string, builder: SearchUrlBuilder): void {
  TRAVEL_SEARCH_URL_BUILDERS[site] = builder;
}

/**
 * Detect the correct site extractor for the current page.
 * Returns null if no supported site is detected.
 */
export function detectSiteExtractor(
  extractors: SiteExtractor[]
): SiteExtractor | null {
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  for (const extractor of extractors) {
    const name = extractor.siteName();
    // Special case: Google Travel lives at google.com/travel/*
    if (name === "googletravel") {
      if (hostname.includes("google.com") && pathname.startsWith("/travel")) {
        return extractor;
      }
      continue;
    }
    if (hostname.includes(name)) {
      return extractor;
    }
  }
  return null;
}
