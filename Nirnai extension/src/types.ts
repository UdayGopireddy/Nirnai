// Types shared across the extension

export interface ProductData {
  title: string;
  brand: string;
  price: string;
  currency: string;
  rating: string;
  reviewCount: string;
  seller: string;
  fulfiller: string;
  ingredients: string;
  nutritionInfo: string;
  returnPolicy: string;
  delivery: string;
  category: string;
  url: string;
  imageUrl: string;
  barcode: string;
  source_site: string;
  page_type: string;
  // ── Geo-context fields (auto-populated by applyGeoContext) ──
  country_code?: string;       // ISO 3166-1 alpha-2: "US", "IN", "JP", "SG"
  currency_code?: string;      // ISO 4217: "USD", "INR", "JPY"
  locale?: string;             // BCP 47: "en-US", "en-IN", "ja-JP"
  tax_included?: boolean;      // true for VAT/GST regions (EU, IN, JP), false for US
  shipping_region?: string;    // "domestic" | "cross-border" | "unknown"
  measurement_system?: string; // "metric" | "imperial"
}

export interface PurchaseBreakdown {
  reviews: number;
  price: number;
  seller: number;
  returns: number;
  popularity: number;
  specs: number;
  delivery: number;
}

export interface ReviewTrust {
  trust_score: number;
  rating_strength: number;
  volume_confidence: number;
  distribution_quality: number;
  authenticity: number;
}

export interface HealthBreakdown {
  nutrition: number;
  ingredients: number;
  processing: number;
}

export interface DecisionStamp {
  stamp: "SMART_BUY" | "CHECK" | "AVOID";
  label: string;
  icon: string;
  reasons: string[];
  purchase_signal: string;
  health_signal: string;
}

export interface AlternativeSuggestion {
  product_name: string;
  reason: string;
  search_url: string;
}

export interface CartItemResult {
  title: string;
  price: string;
  image_url: string;
  url: string;
  purchase_score: number;
  health_score: number;
  decision: string;
  stamp: DecisionStamp;
  warnings: string[];
  positives: string[];
  suggestion?: AlternativeSuggestion | null;
}

export interface CartSummary {
  total_items: number;
  estimated_total: string;
  avg_purchase_score: number;
  avg_health_score: number;
  items_to_avoid: number;
  items_smart_buy: number;
  items_check: number;
  overall_verdict: string;
  overall_icon: string;
  ai_summary: string;
  top_warnings: string[];
}

export interface CartAnalysisResponse {
  summary: CartSummary;
  items: CartItemResult[];
}

// ── Batch comparison types ──

export interface RankedListing {
  rank: number;
  title: string;
  price: string;
  url: string;
  image_url: string;
  purchase_score: number;
  health_score: number;
  confidence_tier: "high" | "medium" | "low";
  decision: string;
  stamp: DecisionStamp;
  review_trust: ReviewTrust;
  why_ranked: string;
  tradeoffs: string[];
  positives: string[];
  warnings: string[];
  domain: string;
}

export interface BatchResponse {
  ranked: RankedListing[];
  comparison_summary: string;
}

export interface AnalysisResponse {
  purchase_score: number;
  health_score: number;
  decision: string;
  stamp: DecisionStamp;
  purchase_breakdown: PurchaseBreakdown;
  health_breakdown: HealthBreakdown;
  review_trust: ReviewTrust;
  reasons: string[];
  warnings: string[];
  positives: string[];
  confidence: number;
  summary: string;
  suggestion?: AlternativeSuggestion | null;
  domain: string;
}

export interface AiEnhancement {
  summary: string;
  suggestion?: AlternativeSuggestion | null;
}

export type MessageAction =
  | "EXTRACT_PRODUCT_DATA"
  | "ANALYZE_PRODUCT"
  | "ANALYZE_CART"
  | "ANALYZE_BATCH"
  | "COMPARE_FROM_URL"
  | "GET_CACHED_ANALYSIS"
  | "PRODUCT_DATA_EXTRACTED"
  | "CROSS_SITE_COMPARE"
  | "CROSS_SITE_COLLECT"
  | "CROSS_SITE_LISTINGS"
  | "ANALYSIS_AI_UPDATE";

// Search parameters extracted from the current page, shared across platforms
export interface CrossSiteSearchParams {
  destination: string;
  checkin: string;
  checkout: string;
  adults: string;
  children: string;
  rooms: string;
  // Shopping cross-site
  query: string;
  // Geo-context for regional URL routing (populated by content.ts at call time)
  country_code?: string;
  currency_code?: string;
  // Precise geo-location for radius-based cross-site search
  lat?: number;          // listing or search center latitude
  lng?: number;          // listing or search center longitude
  // Bounding box (computed from center + adaptive radius)
  ne_lat?: number;       // northeast corner
  ne_lng?: number;
  sw_lat?: number;       // southwest corner
  sw_lng?: number;
  // Area classification for the service worker
  area_type?: "dense_urban" | "urban" | "suburban" | "resort" | "rural";
  radius_miles?: number; // adaptive radius based on area density
}

export interface ExtensionMessage {
  action: MessageAction;
  data?: ProductData | AnalysisResponse;
}

declare const __API_BASE_URL__: string;
export const API_BASE_URL = __API_BASE_URL__;
