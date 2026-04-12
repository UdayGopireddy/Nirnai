from pydantic import BaseModel
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


class BatchResponse(BaseModel):
    ranked: list[RankedListing]
    comparison_summary: str = ""


class BatchRankRequest(BaseModel):
    system_prompt: str
    user_prompt: str
    listings: list[ProductData] = []
