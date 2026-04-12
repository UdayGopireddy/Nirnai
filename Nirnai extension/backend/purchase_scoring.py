"""Purchase scoring engine — evaluates product quality, price, seller trust.

Scoring philosophy:
  Score = Relative Value + Risk Assessment + Confidence Modulation
  NOT just sum(weighted signals)

Key principles:
  1. Price is RELATIVE to category, not absolute
  2. Confidence modulates the final score toward neutral when data is sparse
  3. Risk flags (manipulation, fakes, mismatches) surface explicitly
  4. Brand is a first-class signal, not ignored

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
from domain_classifier import (
    ScoringDomain, classify_domain, is_hospitality,
    get_volume_score, get_popularity_score, get_price_range,
)


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

    domain = classify_domain(product.source_site, product.category, product.title)
    return get_volume_score(domain, count)
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
    """Score VALUE — not cheapness.

    NirnAI's moat: we don't recommend the cheapest option.
    We recommend the best VALUE — quality you get for what you pay.

    A $300 product with 4.8 stars, 10K reviews, and a known brand
    is BETTER VALUE than a $15 product with 3.2 stars and no brand.

    Value = (quality signals) relative to (price position in category)
    """
    price_val = _parse_price(product.price)
    if price_val is None:
        return 50  # No price → neutral

    score = 55  # Start neutral

    # ── 1. Discount detection (always positive — getting more for less) ──
    discount_pct = _detect_discount(product.price)
    if discount_pct:
        if discount_pct >= 50:
            score += 22
        elif discount_pct >= 30:
            score += 15
        elif discount_pct >= 15:
            score += 8
        elif discount_pct >= 5:
            score += 4

    # ── 2. Value ratio: quality signals relative to price tier ────
    # This is the core judgment: "Is what you GET worth what you PAY?"
    domain = classify_domain(product.source_site, product.category, product.title)
    price_range = get_price_range(domain)
    mid = price_range["mid"]

    rating = _parse_rating(product)
    count = _parse_review_count(product)
    brand = product.brand.strip().lower()
    has_brand = bool(brand) and any(b in brand for b in KNOWN_BRANDS)

    # Build a quality signal (0-100) from review trust + brand + rating
    quality = 40  # baseline
    if rating is not None:
        if rating >= 4.5:
            quality += 30
        elif rating >= 4.0:
            quality += 20
        elif rating >= 3.5:
            quality += 10
        elif rating < 3.0:
            quality -= 15

    if count is not None:
        if count > 5000:
            quality += 15
        elif count > 500:
            quality += 10
        elif count > 50:
            quality += 5
        elif count < 10:
            quality -= 5

    if has_brand:
        quality += 10

    quality = max(0, min(100, quality))

    # Price position in category (0.0 = free, 1.0 = mid, 2.0 = 2x mid)
    price_position = price_val / mid if mid > 0 else 1.0

    # ── The value judgment ────────────────────────────────────────
    # High quality + any price = good value
    # Low quality + high price = poor value
    # High quality + high price = premium but justified
    # Low quality + low price = cheap but risky

    if quality >= 70:
        # Strong product — price matters less
        if price_position <= 0.5:
            score += 20  # Great quality, great price — exceptional value
        elif price_position <= 1.0:
            score += 15  # Great quality, fair price — solid value
        elif price_position <= 1.5:
            score += 8   # Great quality, premium price — justified premium
        elif price_position <= 2.5:
            score += 3   # Great quality, expensive — still defensible
        else:
            score -= 5   # Even great products have a ceiling
    elif quality >= 50:
        # Average product — price sensitivity increases
        if price_position <= 0.5:
            score += 12  # Decent product, cheap — fair deal
        elif price_position <= 1.0:
            score += 5   # Decent product, fair price — expected
        elif price_position <= 1.5:
            score -= 3   # Decent product, premium — needs justification
        else:
            score -= 12  # Average product at premium price — poor value
    else:
        # Weak product — price can't save it
        if price_position <= 0.3:
            score += 3   # Very cheap but low quality — buyer beware
        elif price_position <= 0.7:
            score -= 3   # Cheap and low quality — not worth it
        else:
            score -= 18  # Expensive AND low quality — worst outcome

    return max(0, min(100, score))


def _parse_price(price_str: str) -> Optional[float]:
    """Extract the primary numeric price value from a price string."""
    if not price_str:
        return None
    # Remove currency symbols, commas, whitespace
    cleaned = re.sub(r"[₹$€£¥,\s]", "", price_str)
    # Find first number (the current/sale price is typically first)
    m = re.search(r"(\d+\.?\d*)", cleaned)
    return float(m.group(1)) if m else None


def _detect_discount(price_str: str) -> Optional[float]:
    """Detect discount percentage from price string patterns.

    Handles: "$24.99 $39.99", "was $39.99", "30% off", "Save 25%"
    Returns discount as percentage (0-100) or None.
    """
    if not price_str:
        return None

    # Pattern 1: explicit percentage — "30% off", "Save 25%", "-40%"
    pct_match = re.search(r"(\d+)\s*%\s*(?:off|save|discount)?", price_str, re.IGNORECASE)
    if not pct_match:
        pct_match = re.search(r"(?:save|off|discount)\s*(\d+)\s*%", price_str, re.IGNORECASE)
    if pct_match:
        return float(pct_match.group(1))

    # Pattern 2: two prices — current and original (e.g. "$24.99 $39.99" or "$24.99 was $39.99")
    prices = re.findall(r"[\d,]+\.?\d*", re.sub(r"[₹$€£¥,]", "", price_str))
    if len(prices) >= 2:
        p1, p2 = float(prices[0]), float(prices[1])
        if p2 > p1 and p2 > 0:
            return round((p2 - p1) / p2 * 100, 1)

    return None


def score_seller(product: ProductData) -> int:
    """Score seller trustworthiness (0-100).

    Domain-aware: for hospitality, 'seller' is a host — scored differently.
    """
    domain = classify_domain(product.source_site, product.category, product.title)
    seller = product.seller.lower()
    fulfiller = getattr(product, 'fulfiller', '').lower()

    # ── Hospitality: score HOST trust ────────────────────────────
    if domain == ScoringDomain.HOSPITALITY:
        return _score_host_trust(product)

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


def _score_host_trust(product: ProductData) -> int:
    """Score Airbnb/travel host trust from fulfiller (superhost status) and reviews."""
    score = 50
    fulfiller = getattr(product, 'fulfiller', '').lower()
    host = product.seller.strip()

    # Host exists
    if host:
        score += 10
    else:
        # Host name not extracted — don't penalize heavily since all
        # Airbnb listings require a host. Score neutral and rely on
        # other signals (fulfiller, review quality).
        score += 0

    # Superhost / status signals (stored in fulfiller by Airbnb extractor)
    if 'superhost' in fulfiller:
        score += 20
    if 'response rate' in fulfiller:
        # Try to extract response rate percentage
        m = re.search(r'(\d+)%\s*response', fulfiller)
        if m and int(m.group(1)) >= 90:
            score += 8
        elif m and int(m.group(1)) >= 70:
            score += 4
    if 'year' in fulfiller:
        # Experience: "hosting for X years"
        m = re.search(r'(\d+)\s*year', fulfiller)
        if m:
            years = int(m.group(1))
            if years >= 5:
                score += 8
            elif years >= 2:
                score += 4

    # Strong reviews = trust
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating and rating >= 4.5 and count and count >= 50:
        score += 10
    elif rating and rating >= 4.0 and count and count >= 20:
        score += 5

    return max(0, min(100, score))


def score_returns(product: ProductData) -> int:
    """Score return/cancellation policy (0-100).

    Domain-aware: for hospitality, 'returnPolicy' is the cancellation policy.
    """
    policy = product.returnPolicy.lower()
    domain = classify_domain(product.source_site, product.category, product.title)

    if not policy:
        return 50

    # ── Hospitality: cancellation policy ─────────────────────────
    if domain == ScoringDomain.HOSPITALITY:
        if "free cancellation" in policy or "full refund" in policy:
            return 90
        if "flexible" in policy:
            return 85
        if "moderate" in policy:
            return 65
        if "strict" in policy or "non-refundable" in policy or "no refund" in policy:
            return 25
        if "cancel" in policy:
            return 60  # Some cancellation mentioned
        return 50

    # ── Shopping: return policy ──────────────────────────────────
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
    """Score popularity based on review count (0-100). Domain-aware thresholds."""
    count_match = re.search(
        r"([\d,]+)", product.reviewCount.replace(",", "")
    )
    if not count_match:
        return 40

    count = int(count_match.group(1).replace(",", ""))
    domain = classify_domain(product.source_site, product.category, product.title)
    return get_popularity_score(domain, count)


def score_quality_signals(product: ProductData) -> int:
    """Score product quality from brand, data richness, and brand-seller consistency.

    Domain-aware: for hospitality, evaluates amenities, host quality, and listing completeness.
    """
    domain = classify_domain(product.source_site, product.category, product.title)

    # ── Hospitality: amenity/listing quality ─────────────────────
    if domain == ScoringDomain.HOSPITALITY:
        return _score_travel_quality(product)

    score = 50  # Neutral baseline

    brand = product.brand.strip().lower()
    seller = product.seller.strip().lower()
    title_lower = product.title.lower()

    # ── Brand recognition ─────────────────────────────────────────
    if brand:
        # Known major brands — these have reputations to protect
        if any(b in brand for b in KNOWN_BRANDS):
            score += 20
        else:
            score += 8  # At least they have a brand

        # Brand-seller consistency: brand selling their own product = trustworthy
        if brand and seller:
            if brand in seller or seller in brand:
                score += 10  # Direct brand store
            elif "official" in seller or "authorized" in seller:
                score += 8
            elif any(t in seller for t in ["amazon", "walmart", "target"]):
                score += 5  # Major retailer
            # Risk: premium brand sold by unknown seller
            elif any(b in brand for b in KNOWN_BRANDS):
                score -= 10  # Possible counterfeit risk
    else:
        # No brand info — check if title has any brand signals
        if any(b in title_lower for b in KNOWN_BRANDS):
            score += 10
        else:
            score -= 5  # Truly brandless — higher risk for some categories

    # ── Data richness ─────────────────────────────────────────────
    # More info available = more confident assessment (minor signal)
    data_fields = sum(1 for v in [
        product.rating, product.reviewCount, product.price,
        product.seller, product.delivery, product.returnPolicy,
        product.category, product.brand,
    ] if v)
    if data_fields >= 7:
        score += 5
    elif data_fields <= 3:
        score -= 5

    return max(0, min(100, score))


def _score_travel_quality(product: ProductData) -> int:
    """Score travel listing quality from amenities, property details, and data richness."""
    score = 50

    # Amenities (stored in ingredients field)
    amenities = product.ingredients.lower()
    if amenities:
        # Count meaningful amenities
        amenity_keywords = [
            "wifi", "kitchen", "parking", "pool", "washer", "dryer",
            "air conditioning", "heating", "tv", "workspace",
            "gym", "hot tub", "fireplace", "patio", "balcony",
            "dishwasher", "coffee", "iron", "hair dryer",
        ]
        amenity_count = sum(1 for kw in amenity_keywords if kw in amenities)
        if amenity_count >= 10:
            score += 20
        elif amenity_count >= 6:
            score += 12
        elif amenity_count >= 3:
            score += 6
    else:
        score -= 5

    # Category ratings / detailed reviews (in nutritionInfo)
    nutrition = product.nutritionInfo.lower()
    if nutrition:
        # Airbnb category ratings: cleanliness, accuracy, communication, location, check-in, value
        rating_cats = ["cleanliness", "accuracy", "communication", "location", "check-in", "value"]
        cats_found = sum(1 for c in rating_cats if c in nutrition)
        if cats_found >= 4:
            score += 10
        elif cats_found >= 2:
            score += 5

    # Listing completeness
    data_fields = sum(1 for v in [
        product.title, product.price, product.rating,
        product.reviewCount, product.seller, product.delivery,
        product.returnPolicy, product.category, amenities,
    ] if v)
    if data_fields >= 7:
        score += 8
    elif data_fields <= 3:
        score -= 8

    return max(0, min(100, score))


# Known brands (lowercase) — major brands with reputation stakes
KNOWN_BRANDS = [
    "apple", "samsung", "sony", "lg", "bose", "nike", "adidas", "puma",
    "microsoft", "google", "amazon basics", "anker", "dell", "hp", "lenovo",
    "logitech", "philips", "panasonic", "dyson", "kitchenaid", "instant pot",
    "neutrogena", "dove", "olay", "nivea", "cetaphil", "cerave",
    "tylenol", "advil", "colgate", "oral-b", "gillette",
    "nestle", "kraft", "kellogg", "general mills", "quaker",
    "levi", "ralph lauren", "calvin klein", "tommy hilfiger",
    "north face", "columbia", "patagonia", "under armour",
    "nintendo", "playstation", "xbox", "gopro", "canon", "nikon",
    "bosch", "dewalt", "makita", "stanley", "3m",
]


def score_delivery(product: ProductData) -> int:
    """Score delivery / check-in experience (0-100).

    Domain-aware: for hospitality, 'delivery' is the check-in/property details.
    """
    delivery = product.delivery.lower()
    domain = classify_domain(product.source_site, product.category, product.title)

    if not delivery:
        return 50

    # ── Hospitality: check-in, property details ──────────────────
    if domain == ScoringDomain.HOSPITALITY:
        score = 55  # baseline
        if "self check-in" in delivery or "self-check-in" in delivery:
            score += 12
        if "keypad" in delivery or "lockbox" in delivery or "smart lock" in delivery:
            score += 8
        # Guest capacity / property details
        if re.search(r'\d+\s*guest', delivery):
            score += 5
        if re.search(r'\d+\s*bed', delivery):
            score += 5
        # Early check-in / late checkout
        if "early" in delivery or "flexible" in delivery:
            score += 5
        return max(0, min(100, score))

    # ── Shopping: delivery speed ─────────────────────────────────
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
    Calculate purchase score with confidence modulation.

    Phase 1 scoring model:
      raw_score = weighted sum of 7 components
      final_score = raw_score * confidence + 50 * (1 - confidence)

    When confidence is low (sparse data, suspicious reviews), the score
    regresses toward 50 (neutral). This prevents "BUY" verdicts on
    products we know nothing about.

    Weights: Reviews 25%, Price 25%, Seller 15%,
             Returns 10%, Popularity 10%, Quality 10%, Delivery 5%
    """
    review_trust = compute_review_trust(product)

    breakdown = PurchaseBreakdown(
        reviews=score_reviews(product, review_trust),
        price=score_price(product),
        seller=score_seller(product),
        returns=score_returns(product),
        popularity=score_popularity(product),
        specs=score_quality_signals(product),  # Renamed: now uses brand + quality
        delivery=score_delivery(product),
    )

    raw_score = int(
        breakdown.reviews * 0.25
        + breakdown.price * 0.25
        + breakdown.seller * 0.15
        + breakdown.returns * 0.10
        + breakdown.popularity * 0.10
        + breakdown.specs * 0.10
        + breakdown.delivery * 0.05
    )

    # ── Confidence modulation ─────────────────────────────────────
    # Pull score toward neutral (50) when confidence is low.
    # This prevents high scores on sparse data and low scores on no data.
    confidence = _compute_data_confidence(product, review_trust)
    final_score = int(raw_score * confidence + 50 * (1 - confidence))

    return final_score, breakdown, review_trust


def _compute_data_confidence(product: ProductData, review_trust: ReviewTrust) -> float:
    """How much should we trust this score? (0.0 - 1.0)

    This is NOT the user-facing confidence (that's in decision_engine).
    This is an internal signal that modulates the raw score.

    Low confidence → score pulled toward 50 (we don't know enough to judge).
    High confidence → raw score stands.

    Domain-aware: hospitality has lower review volumes but higher per-review
    trust, and listings don't have "brands" — so we adjust accordingly.
    """
    domain = classify_domain(product.source_site, product.category, product.title)
    conf = 0.5

    # Review volume is the strongest confidence signal
    count = _parse_review_count(product)
    if count is not None:
        if domain == ScoringDomain.HOSPITALITY:
            # Hospitality: 200+ reviews is very high confidence
            if count > 500:
                conf += 0.28
            elif count > 200:
                conf += 0.25
            elif count > 100:
                conf += 0.18
            elif count > 30:
                conf += 0.10
            elif count > 10:
                conf += 0.05
            else:
                conf -= 0.03
        else:
            if count > 1000:
                conf += 0.25
            elif count > 200:
                conf += 0.18
            elif count > 50:
                conf += 0.10
            elif count > 10:
                conf += 0.03
            else:
                conf -= 0.05  # Very few reviews — less confident

    # Rating exists
    rating = _parse_rating(product)
    if rating is not None:
        conf += 0.05
    else:
        conf -= 0.10

    # Price available
    if _parse_price(product.price) is not None:
        conf += 0.05
    else:
        conf -= 0.05

    # Seller known
    if product.seller.strip():
        conf += 0.05

    # Brand known (skip for hospitality — listings don't have brands)
    if domain != ScoringDomain.HOSPITALITY:
        if product.brand.strip():
            conf += 0.03

    # Review trust quality (distribution, authenticity)
    if review_trust.distribution_quality < 30:
        conf -= 0.08  # Suspicious distribution
    if review_trust.authenticity < 40:
        conf -= 0.05

    return max(0.3, min(1.0, conf))  # Floor at 0.3 — never fully ignore the score


# ── Risk detection ────────────────────────────────────────────────

def detect_risk_flags(product: ProductData, review_trust: ReviewTrust) -> list[str]:
    """Detect risk patterns that warrant explicit warnings.

    These go beyond normal scoring — they're red flags that should be
    surfaced directly to users regardless of the score.
    """
    risks: list[str] = []
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    brand = product.brand.strip().lower()
    seller = product.seller.strip().lower()

    # 1. Review manipulation signals
    if rating and count:
        if rating >= 4.8 and count < 50:
            risks.append("Suspiciously high rating with few reviews")
        if rating >= 4.95 and count < 200:
            risks.append("Near-perfect rating — possible fake reviews")

    # 2. Brand-seller mismatch (counterfeit risk)
    if brand and seller:
        is_premium = any(b in brand for b in KNOWN_BRANDS)
        is_known_seller = any(t in seller for t in [
            "amazon", "walmart", "target", "official", "authorized",
            brand,  # Seller matches brand
        ])
        if is_premium and not is_known_seller:
            risks.append(f"Premium brand ({product.brand}) sold by unverified seller")

    # 3. Missing critical data
    domain = classify_domain(product.source_site, product.category, product.title)
    if not product.price:
        if domain == ScoringDomain.HOSPITALITY:
            risks.append("No price information available — select dates for pricing")
        else:
            risks.append("No price information available")
    if not rating and not count:
        risks.append("No reviews or ratings — unverified product")
    if not seller:
        if domain != ScoringDomain.HOSPITALITY:
            # Hospitality always has hosts; empty seller = extraction gap, not a risk
            risks.append("Unknown seller")

    # 4. Distribution quality
    if review_trust.distribution_quality < 25:
        risks.append("Review pattern looks unnatural")

    return risks
