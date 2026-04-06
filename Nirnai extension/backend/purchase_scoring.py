"""Purchase scoring engine — evaluates product quality, price, seller trust.

Incorporates Review Trust Score per review_data_strategy spec:
- Rating strength
- Review volume / confidence
- Distribution quality (heuristic)
- Authenticity signals
"""

from __future__ import annotations

import re
from typing import Optional
from models import ProductData, PurchaseBreakdown, ReviewTrust


# ── Review Trust Score ───────────────────────────────────────────────────────

def compute_review_trust(product: ProductData) -> ReviewTrust:
    """
    Compute Review Trust Score (0-100) as defined in review_data_strategy.
    Higher rating ≠ better product. Trustworthy rating = better decision.
    """
    rating_strength = _score_rating_strength(product)
    volume_confidence = _score_volume_confidence(product)
    distribution_quality = _score_distribution_quality(product)
    authenticity = _score_authenticity(product)

    # Weighted composite
    trust_score = int(
        rating_strength * 0.30
        + volume_confidence * 0.30
        + distribution_quality * 0.20
        + authenticity * 0.20
    )
    trust_score = max(0, min(100, trust_score))

    return ReviewTrust(
        trust_score=trust_score,
        rating_strength=rating_strength,
        volume_confidence=volume_confidence,
        distribution_quality=distribution_quality,
        authenticity=authenticity,
    )


def _parse_rating(product: ProductData) -> Optional[float]:
    m = re.search(r"(\d+\.?\d*)", product.rating)
    return float(m.group(1)) if m else None


def _parse_review_count(product: ProductData) -> Optional[int]:
    text = product.reviewCount.replace(",", "")
    m = re.search(r"(\d+)", text)
    return int(m.group(1)) if m else None


def _score_rating_strength(product: ProductData) -> int:
    rating = _parse_rating(product)
    if rating is None:
        return 40

    if rating >= 4.5:
        return min(100, 85 + int((rating - 4.5) * 30))
    if rating >= 4.0:
        return 70 + int((rating - 4.0) * 30)
    if rating >= 3.5:
        return 50 + int((rating - 3.5) * 40)
    if rating >= 3.0:
        return 30 + int((rating - 3.0) * 40)
    return max(10, int(rating * 8))


def _score_volume_confidence(product: ProductData) -> int:
    count = _parse_review_count(product)
    if count is None:
        return 30

    if count > 50000:
        return 98
    if count > 10000:
        return 90
    if count > 5000:
        return 80
    if count > 1000:
        return 70
    if count > 500:
        return 60
    if count > 100:
        return 50
    if count > 30:
        return 35
    return 20  # Very low confidence


def _score_distribution_quality(product: ProductData) -> int:
    """
    Heuristic distribution check:
    - Very high rating + very low count = suspicious (possible fake cluster)
    - Moderate rating + high count = stable / healthy
    """
    rating = _parse_rating(product)
    count = _parse_review_count(product)

    if rating is None or count is None:
        return 50

    # Suspicion: 4.8+ with < 100 reviews
    if rating >= 4.8 and count < 100:
        return 25  # Likely inflated

    # Perfect 5.0: suspicious at low volumes, possible at higher ones
    if rating >= 4.95:
        if count >= 500:
            return 55  # Unusual but could be niche product with loyal buyers
        if count >= 100:
            return 35  # Somewhat suspicious
        return 20  # Almost certainly inflated

    # Healthy: 3.8-4.5 with high volume
    if 3.8 <= rating <= 4.5 and count > 500:
        return 85

    # Moderate
    if count > 200 and rating >= 3.5:
        return 70

    return 50


def _score_authenticity(product: ProductData) -> int:
    """
    Authenticity heuristics based on seller + rating patterns.
    """
    score = 60

    # Known trusted sellers boost authenticity
    seller = product.seller.lower()
    trusted = [
        "cloudtail", "appario", "amazon", "cocoblu",
        "official", "authorized", "brand store",
    ]
    if any(t in seller for t in trusted):
        score += 20

    # Unknown / empty seller = risk
    if not seller:
        score -= 15

    # Very high rating with unknown seller = suspicious
    rating = _parse_rating(product)
    if rating and rating >= 4.7 and not any(t in seller for t in trusted):
        score -= 10

    return max(0, min(100, score))


def score_reviews(product: ProductData, review_trust: ReviewTrust) -> int:
    """Score reviews using the trust-weighted approach. The trust score IS the review score."""
    return review_trust.trust_score


def score_price(product: ProductData) -> int:
    """Score price value (0-100). Without price history, use heuristics."""
    if not product.price:
        return 50

    # Parse numeric price
    price_match = re.search(r"[\d,]+\.?\d*", product.price.replace(",", ""))
    if not price_match:
        return 50

    # Without external price data, default to neutral-positive.
    # The AI analysis will provide better price assessment.
    return 65


def score_seller(product: ProductData) -> int:
    """Score seller trustworthiness (0-100)."""
    seller = product.seller.lower()
    fulfiller = getattr(product, 'fulfiller', '').lower()

    if not seller:
        # Even with unknown seller, Amazon fulfillment is a trust boost
        if 'amazon' in fulfiller:
            return 60
        return 40  # Unknown seller

    # Trusted major sellers
    trusted = [
        "cloudtail", "appario", "amazon", "cocoblu",
        "trustful", "retail", "official", "authorized"
    ]
    if any(t in seller for t in trusted):
        return 90

    # Brand store
    if "visit the" in seller and "store" in seller:
        return 80

    # Third-party but fulfilled by Amazon
    if 'amazon' in fulfiller:
        return 70

    return 55  # Unknown third-party


def score_returns(product: ProductData) -> int:
    """Score return policy (0-100)."""
    policy = product.returnPolicy.lower()

    if not policy:
        return 50

    if "no return" in policy or "non-returnable" in policy:
        return 20
    if "replacement" in policy:
        return 70
    if "30" in policy or "return" in policy:
        return 85
    if "10" in policy or "7" in policy:
        return 65

    return 50


def score_popularity(product: ProductData) -> int:
    """Score popularity based on review count (0-100)."""
    count_match = re.search(
        r"([\d,]+)", product.reviewCount.replace(",", "")
    )
    if not count_match:
        return 40

    count = int(count_match.group(1).replace(",", ""))

    if count > 50000:
        return 95
    if count > 10000:
        return 85
    if count > 5000:
        return 75
    if count > 1000:
        return 65
    if count > 100:
        return 50
    return 30


def score_specs(product: ProductData) -> int:
    """Score product specification completeness (0-100)."""
    filled = sum(
        1
        for field in [
            product.title,
            product.rating,
            product.seller,
            product.category,
        ]
        if field
    )
    return min(100, filled * 25)


def score_delivery(product: ProductData) -> int:
    """Score delivery (0-100)."""
    delivery = product.delivery.lower()

    if not delivery:
        return 50

    if "free" in delivery:
        return 90
    if "prime" in delivery:
        return 95
    if "tomorrow" in delivery or "today" in delivery:
        return 85
    if "1" in delivery or "2" in delivery:
        return 75

    return 55


def calculate_purchase_score(product: ProductData) -> tuple[int, PurchaseBreakdown, ReviewTrust]:
    """
    Calculate weighted purchase score.
    Weights from PRD: Reviews 25%, Price 25%, Seller 15%,
    Return 10%, Popularity 10%, Specs 10%, Delivery 5%

    Also returns ReviewTrust for use by decision engine.
    """
    review_trust = compute_review_trust(product)

    breakdown = PurchaseBreakdown(
        reviews=score_reviews(product, review_trust),
        price=score_price(product),
        seller=score_seller(product),
        returns=score_returns(product),
        popularity=score_popularity(product),
        specs=score_specs(product),
        delivery=score_delivery(product),
    )

    total = (
        breakdown.reviews * 0.25
        + breakdown.price * 0.25
        + breakdown.seller * 0.15
        + breakdown.returns * 0.10
        + breakdown.popularity * 0.10
        + breakdown.specs * 0.10
        + breakdown.delivery * 0.05
    )

    return int(total), breakdown, review_trust
