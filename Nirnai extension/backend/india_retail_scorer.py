"""India retail purchase scorer — parallel track to purchase_scoring.py.

Lives alongside the US scorer, never inside it. Routed by `product.country`
in main.py so the existing flow is untouched for non-India shoppers.

Scoring philosophy (multiplicative, price-dominant):
    final = price_score * trust_multiplier * convenience_multiplier

Indian shoppers will switch retailers for ₹50. Price is the spine; trust and
convenience scale it up or down but cannot rescue a bad price.

Inputs come from the extension (DOM extraction). Outputs match the existing
PurchaseBreakdown / AnalysisResponse shapes so the UI doesn't need a new path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from india_pricing import (
    EffectivePrice,
    combined_price_score,
    compute_effective_price,
)
from models import ProductData, PurchaseBreakdown


# ── Trust signals (Amazon.in / Flipkart specific) ──

_TRUSTED_FULFILLERS = {
    "amazon",
    "amazon.in",
    "fulfilled by amazon",
    "amazon retail",
    "cloudtail",
    "appario",
    "flipkart",
    "f-assured",
    "flipkart assured",
    "supermart",
}

_TRUSTED_SELLER_KEYWORDS = (
    "cloudtail",
    "appario",
    "amazon retail",
    "rk world",  # frequent appario reseller
    "supercomnet",
    "official",
    "brand",
)


def trust_score(product: ProductData) -> int:
    """0–100. Combines fulfiller, seller pattern, and review volume."""
    score = 50

    fulfiller_blob = (product.fulfiller or "").lower()
    seller_blob = (product.seller or "").lower()

    if any(t in fulfiller_blob for t in _TRUSTED_FULFILLERS):
        score += 20
    elif any(t in seller_blob for t in _TRUSTED_FULFILLERS):
        score += 15

    if any(k in seller_blob for k in _TRUSTED_SELLER_KEYWORDS):
        score += 5

    # Review volume bump (very rough; the full review_data_strategy fires later
    # in the main flow if we want richer trust).
    try:
        rv = int("".join(ch for ch in product.reviewCount if ch.isdigit()) or "0")
    except ValueError:
        rv = 0
    if rv >= 10_000:
        score += 15
    elif rv >= 1_000:
        score += 10
    elif rv >= 100:
        score += 5
    elif rv > 0 and rv < 20:
        score -= 10  # very low review count is a red flag

    return max(0, min(100, score))


# ── Convenience signals ──

def convenience_score(product: ProductData) -> int:
    """0–100. COD + EMI + free shipping presence."""
    score = 50
    if product.cod_available:
        score += 15
    if product.emi_no_cost:
        score += 15
    shipping_blob = (product.shipping_cost or "").lower()
    if not shipping_blob or "free" in shipping_blob:
        score += 10
    elif shipping_blob:
        # Explicit non-free shipping is a small negative.
        score -= 5
    delivery_blob = (product.delivery or "").lower()
    if "today" in delivery_blob or "tomorrow" in delivery_blob or "1 day" in delivery_blob:
        score += 10
    return max(0, min(100, score))


# ── Main entry point ──

@dataclass
class IndiaScoreResult:
    """Result of the India scorer.

    `breakdown` matches the shape of the existing PurchaseBreakdown so the UI
    code path stays unchanged. We borrow fields liberally:
        price       -> our combined_price_score
        seller      -> our trust_score
        delivery    -> our convenience_score
        reviews     -> review-volume sub-score (already inside trust)
        returns     -> 50 placeholder (returns policy parsed later)
        popularity  -> review-volume mirror
        specs       -> 50 placeholder
    """
    purchase_score: int
    breakdown: PurchaseBreakdown
    pricing: EffectivePrice
    reasons: list[str]


def score_india_retail(
    product: ProductData,
    *,
    median_effective_price: Optional[float] = None,
) -> IndiaScoreResult:
    """Compute the India retail purchase score.

    `median_effective_price` is the cross-retailer median for the same canonical
    product, supplied by the caller (looked up from product_cache). Pass None
    if not yet known — the scorer falls back to MRP-only signal.
    """
    pricing = compute_effective_price(
        sticker_raw=product.price,
        mrp_raw=product.mrp,
        bank_offers=product.bank_offers,
        coupon_raw=product.coupon,
        shipping_raw=product.shipping_cost,
    )

    price_pts = combined_price_score(
        effective=pricing.effective,
        median=median_effective_price,
        mrp_discount_pct=pricing.mrp_discount_pct,
    )
    trust_pts = trust_score(product)
    conv_pts = convenience_score(product)

    # Multiplicative, price-dominant: square the price ratio so a bad price
    # hurts twice as much as bad trust or bad convenience. Indian shoppers
    # genuinely will switch retailers for ₹50.
    p = price_pts / 100
    t = trust_pts / 100
    c = conv_pts / 100
    final = (p * p) * t * c
    # Fourth-root pull so a perfect 1.0 stays 100 and middle (0.0625) -> 50.
    final = final ** (1 / 4)
    purchase_score = max(0, min(100, int(round(final * 100))))

    reasons: list[str] = []
    if pricing.savings_vs_sticker > 0:
        reasons.append(
            f"You save ₹{int(pricing.savings_vs_sticker)} after offers — "
            f"effective ₹{int(pricing.effective)}"
        )
    if pricing.mrp_discount_pct >= 25:
        reasons.append(f"{int(pricing.mrp_discount_pct)}% off M.R.P.")
    if median_effective_price and pricing.effective and pricing.effective < median_effective_price:
        diff = int(median_effective_price - pricing.effective)
        reasons.append(f"₹{diff} below typical market price")
    if product.cod_available:
        reasons.append("Cash on Delivery available")
    if product.emi_no_cost:
        reasons.append("No-Cost EMI available")
    if trust_pts >= 70:
        reasons.append("Sold by a trusted seller")

    breakdown = PurchaseBreakdown(
        reviews=trust_pts,
        price=price_pts,
        seller=trust_pts,
        returns=50,  # filled in later from returnPolicy parsing
        popularity=trust_pts,
        specs=50,
        delivery=conv_pts,
    )
    return IndiaScoreResult(
        purchase_score=purchase_score,
        breakdown=breakdown,
        pricing=pricing,
        reasons=reasons[:3],  # top 3 for the stamp
    )
