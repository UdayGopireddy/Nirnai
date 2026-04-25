from pydantic import BaseModel, field_validator
from typing import Optional


class ProductData(BaseModel):
    """Input from the Chrome extension."""
    title: str
    brand: str = ""
    price: str = ""
    currency: str = "INR"
    rating: str = ""
    reviewCount: str = ""
    seller: str = ""
    fulfiller: str = ""
    ingredients: str = ""
    nutritionInfo: str = ""
    returnPolicy: str = ""
    delivery: str = ""
    category: str = ""
    url: str = ""
    imageUrl: str = ""
    barcode: str = ""
    source_site: str = "amazon"
    page_type: str = "product"

    # ── India / regional pricing extensions ──
    # Inferred from page TLD by the extension (e.g. amazon.in -> "IN").
    # Defaults to empty string so non-India flows are unaffected.
    country: str = ""
    # M.R.P. (Maximum Retail Price) printed on Indian listings, raw string.
    mrp: str = ""
    # Bank/card offer lines as scraped, e.g. ["10% Instant Discount on HDFC Cards up to ₹500"].
    bank_offers: list[str] = []
    # Visible coupon line, e.g. "Apply ₹300 coupon".
    coupon: str = ""
    # Shipping cost as a raw string ("FREE", "₹40").
    shipping_cost: str = ""
    # Whether a "No Cost EMI" badge is present.
    emi_no_cost: bool = False
    # Whether Cash-on-Delivery is offered.
    cod_available: bool = False


class PurchaseBreakdown(BaseModel):
    reviews: int = 0
    price: int = 0
    seller: int = 0
    returns: int = 0
    popularity: int = 0
    specs: int = 0
    delivery: int = 0


class ReviewTrust(BaseModel):
    """Review trust score from review_data_strategy."""
    trust_score: int = 50
    rating_strength: int = 50
    volume_confidence: int = 50
    distribution_quality: int = 50
    authenticity: int = 50


class HealthBreakdown(BaseModel):
    nutrition: int = 0
    ingredients: int = 0
    processing: int = 0


class DecisionStamp(BaseModel):
    """Decision stamp per decision_stamp_badge_system spec."""
    stamp: str  # "SMART_BUY", "CHECK", "AVOID"
    label: str  # Human-readable: "SMART BUY", "CHECK", "AVOID"
    icon: str   # "🟢", "🟡", "🔴"
    reasons: list[str]  # Top 2-3 micro-reasons
    purchase_signal: str  # e.g. "Trusted • Good value"
    health_signal: str    # e.g. "Moderate health" or ""


class AlternativeSuggestion(BaseModel):
    """A better alternative product suggestion."""
    product_name: str
    reason: str  # Why this is better
    search_url: str = ""  # Google Shopping or general search link


class AnalysisResponse(BaseModel):
    purchase_score: int
    health_score: int
    decision: str  # Legacy compat: "BUY", "NEUTRAL", "DON'T BUY"
    stamp: DecisionStamp
    purchase_breakdown: PurchaseBreakdown
    health_breakdown: HealthBreakdown
    review_trust: ReviewTrust
    reasons: list[str]
    warnings: list[str]
    positives: list[str]
    confidence: float  # 0.0 - 1.0
    summary: str = ""
    suggestion: Optional[AlternativeSuggestion] = None
    domain: str = "general"  # "hospitality" | "electronics" | "fashion" | "grocery" | "home" | "general"


class CartItemResult(BaseModel):
    """Analysis result for a single cart item."""
    title: str
    price: str = ""
    image_url: str = ""
    url: str = ""
    purchase_score: int = 0
    health_score: int = 0
    decision: str = "NEUTRAL"
    stamp: DecisionStamp
    warnings: list[str] = []
    positives: list[str] = []
    suggestion: Optional[AlternativeSuggestion] = None


class CartSummary(BaseModel):
    """Aggregate summary of an entire cart."""
    total_items: int
    estimated_total: str = ""
    avg_purchase_score: int = 0
    avg_health_score: int = 0
    items_to_avoid: int = 0
    items_smart_buy: int = 0
    items_check: int = 0
    overall_verdict: str = "CHECK"  # SMART_BUY, CHECK, AVOID
    overall_icon: str = "🟡"
    ai_summary: str = ""
    top_warnings: list[str] = []


class CartAnalysisResponse(BaseModel):
    """Full cart analysis response."""
    summary: CartSummary
    items: list[CartItemResult]


class HealthExtractionRequest(BaseModel):
    title: str
    ingredients_text: str = ""
    nutrition_text: str = ""
    barcode: str = ""


class NormalizedNutrition(BaseModel):
    calories: Optional[float] = None
    fat_g: Optional[float] = None
    saturated_fat_g: Optional[float] = None
    sodium_mg: Optional[float] = None
    sugar_g: Optional[float] = None
    protein_g: Optional[float] = None
    fiber_g: Optional[float] = None


class HealthExtractionResponse(BaseModel):
    normalized_nutrition: NormalizedNutrition
    ingredient_flags: list[str]
    health_score: int
    health_breakdown: HealthBreakdown


# ── Batch comparison / ranking models ──

class RankedListing(BaseModel):
    rank: int
    title: str
    price: str = ""
    url: str = ""
    image_url: str = ""
    purchase_score: int = 0
    health_score: int = 0
    confidence_tier: str = "medium"
    decision: str = "CHECK"
    stamp: DecisionStamp
    review_trust: ReviewTrust
    why_ranked: str = ""
    tradeoffs: list[str] = []
    positives: list[str] = []
    warnings: list[str] = []
    domain: str = "general"  # "hospitality" | "general" etc.

    # ── Dual-track UI enrichment (filled post-ranking by main.py) ──
    # Parsed numeric price (best-effort, in the listing's local currency).
    # 0.0 means "could not parse" — UI must hide price-relative chrome.
    price_value: float = 0.0
    # Percent change vs origin price. Negative = cheaper, positive = pricier.
    # 0 when there is no origin baseline or both prices are unparseable.
    price_delta_pct: int = 0
    # SKU identity confidence vs the user's origin product:
    #   "high"   — same brand + same pack size + strong title overlap
    #   "medium" — same brand + decent title overlap
    #   "low"    — only category/brand match (treat as "similar product")
    #   ""       — no origin to compare against
    sku_match: str = ""
    # Display string for the seller, e.g. "Amazon", "Cloudtail India",
    # "Sold by NIVEA Store". Empty when the source listing carried no seller.
    seller_label: str = ""
    # Coarse trust bucket for the seller, used for the badge color in the UI:
    #   "trusted"    — first-party (Amazon/Flipkart Retail) or known marketplace anchor
    #   "known"      — recognisable third-party with a real storefront name
    #   "unverified" — no seller info OR generic reseller string
    seller_trust: str = ""

    @field_validator("tradeoffs", "positives", "warnings", mode="before")
    @classmethod
    def coerce_to_list(cls, v):
        if isinstance(v, str):
            return [v] if v else []
        return v


class BatchResponse(BaseModel):
    ranked: list[RankedListing]
    comparison_summary: str = ""
    # India dual-track: when the batch is identified as Indian, we ALSO return a
    # parallel ordering by ascending price (Indian shoppers split-screen the
    # \"best quality\" vs \"best deal\" decision). Empty/omitted for other markets.
    ranked_by_price: list[RankedListing] = []
    # Origin product baseline — set when ranking alternatives so the frontend
    # can show "vs your current product" context.
    origin_title: str = ""
    origin_purchase_score: int = 0
    origin_trust_score: int = 0
    origin_url: str = ""
    origin_price: str = ""
    # True when the user's original product beats every alternative we found.
    # Frontend should recommend "stick with your pick" instead of a worse #1.
    origin_is_best: bool = False
    # Headline shown above each tab in the dual-track UI. Computed by the
    # backend so the Rust gateway and any future client render the same copy.
    # Empty string => UI falls back to a default tab title.
    best_pick_headline: str = ""
    best_deal_headline: str = ""


class BatchRankRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    listings: list[ProductData] = []
    # Optional structured original product (alternatives flow). Preferred over
    # regex-parsing the prompt because it carries every ProductData field
    # (ingredients, returnPolicy, seller, etc.) — required for accurate
    # purchase scoring of the original.
    origin_product: ProductData | None = None


# ── Recheck-at-checkout models ──

class RecheckRequest(BaseModel):
    """Sent by the extension just before a SMART_BUY click goes through."""
    product: ProductData
    shown_price: str = ""
    threshold_pct: float = 10.0


class RecheckResponse(BaseModel):
    """Returned to the extension. ``warn_level`` drives the inline UI:
    ``none`` -> open immediately; ``info`` -> small note; ``warn`` -> blocking
    notice with a confirm button; ``unknown`` -> proceed silently."""
    product_id: str
    stable: bool
    warn_level: str  # "none" | "info" | "warn" | "unknown"
    message: str
    last_price: str = ""
    last_currency: str = ""
    drift_pct: float | None = None
    scored_secs_ago: int | None = None
