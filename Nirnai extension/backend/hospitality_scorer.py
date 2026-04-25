"""Hospitality scoring engine — independent pipeline for travel/stays.

Scoring philosophy for NirnAI Travel:
  Properties that make it to rankings are vetted. Scores guide rank order.
  Key differences from retail:
    - No brands — host trust replaces brand trust
    - Cancellation policy >> return policy
    - Amenities >> specs/brand
    - Review volume thresholds are MUCH lower (200 = excellent)
    - Price is per-night, not per-unit
    - "Delivery" = check-in experience
    - Data sparsity is normal (no dates = no price = acceptable)

Weights:
  Reviews/Trust  25%  — travelers rely heavily on guest reviews
  Value          25%  — price-to-quality ratio is critical
  Host Trust     15%  — host quality predicts experience
  Cancellation   15%  — flexibility for travel planning
  Amenities      10%  — what the property offers
  Popularity     10%  — booking volume / demand signal
"""

from __future__ import annotations

import re
from typing import Optional
from models import ProductData, PurchaseBreakdown, ReviewTrust, DecisionStamp
from domain_classifier import (
    ScoringDomain, classify_domain, get_volume_score, get_popularity_score, get_price_range,
)


# ── Review Trust (same core logic, hospitality-tuned thresholds) ──────────

def compute_review_trust(product: ProductData) -> ReviewTrust:
    rating_strength = _score_rating_strength(product)
    volume_confidence = _score_volume_confidence(product)
    distribution_quality = _score_distribution_quality(product)
    authenticity = _score_authenticity(product)

    trust_score = int(
        rating_strength * 0.25
        + volume_confidence * 0.35  # Volume matters more for hospitality
        + distribution_quality * 0.20
        + authenticity * 0.20
    )
    return ReviewTrust(
        trust_score=max(0, min(100, trust_score)),
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

    # Hospitality ratings: Booking.com uses 1-10, Airbnb uses 1-5
    # Normalize to 5-star scale
    if rating > 5:
        rating = rating / 2

    if rating >= 4.8:
        return 95
    if rating >= 4.5:
        return 85
    if rating >= 4.0:
        return 70
    if rating >= 3.5:
        return 55
    if rating >= 3.0:
        return 40
    return max(10, int(rating * 8))


def _score_volume_confidence(product: ProductData) -> int:
    count = _parse_review_count(product)
    if count is None:
        return 30
    # Hospitality-specific: 200 reviews is excellent
    return get_volume_score(ScoringDomain.HOSPITALITY, count)


def _score_distribution_quality(product: ProductData) -> int:
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating is None or count is None:
        return 50

    # Normalize Booking.com 1-10 scale
    if rating > 5:
        rating = rating / 2

    # Suspicion: near-perfect with few reviews
    if rating >= 4.9 and count < 30:
        return 20
    if rating >= 4.8 and count < 50:
        return 30
    # Healthy: 4.0-4.6 with decent volume
    if 4.0 <= rating <= 4.6 and count > 100:
        return 85
    if count > 50 and rating >= 3.5:
        return 70
    return 50


def _score_authenticity(product: ProductData) -> int:
    """Hospitality authenticity — platform-verified listings are generally trustworthy."""
    score = 65  # Baseline higher than retail — platforms verify listings
    fulfiller = getattr(product, 'fulfiller', '').lower()

    if 'superhost' in fulfiller:
        score += 15
    if 'response rate' in fulfiller:
        m = re.search(r'(\d+)%\s*response', fulfiller)
        if m and int(m.group(1)) >= 90:
            score += 10

    # Rating-volume cross-check
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating and rating > 5:
        rating = rating / 2
    if rating and count:
        if rating >= 4.8 and count < 20:
            score -= 15  # Suspicious
        elif rating >= 4.0 and count >= 50:
            score += 10  # Healthy

    return max(0, min(100, score))


# ── Component scorers ────────────────────────────────────────────

def score_reviews(product: ProductData, review_trust: ReviewTrust) -> int:
    return review_trust.trust_score


def score_cancellation(product: ProductData) -> int:
    """Score cancellation policy (0-100). THE critical travel signal."""
    policy = product.returnPolicy.lower()
    if not policy:
        return 50  # Unknown — neutral

    if "free cancellation" in policy or "full refund" in policy:
        return 95
    if "flexible" in policy:
        return 90
    if "free cancel" in policy:
        return 88
    if "moderate" in policy:
        return 65
    if "partial refund" in policy:
        return 55
    if "strict" in policy or "non-refundable" in policy or "no refund" in policy:
        return 20
    if "cancel" in policy:
        return 60  # Some mention of cancellation
    return 50


def score_host_trust(product: ProductData) -> int:
    """Score host/property manager trust (0-100)."""
    score = 50
    fulfiller = getattr(product, 'fulfiller', '').lower()
    host = product.seller.strip()

    # Host exists
    if host:
        score += 10

    # Superhost / Premier Host
    if 'superhost' in fulfiller or 'premier' in fulfiller:
        score += 20

    # Response rate
    if 'response rate' in fulfiller:
        m = re.search(r'(\d+)%\s*response', fulfiller)
        if m and int(m.group(1)) >= 90:
            score += 10
        elif m and int(m.group(1)) >= 70:
            score += 5

    # Experience
    if 'year' in fulfiller:
        m = re.search(r'(\d+)\s*year', fulfiller)
        if m:
            years = int(m.group(1))
            if years >= 5:
                score += 10
            elif years >= 2:
                score += 5

    # Strong reviews = host trust
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating and rating > 5:
        rating = rating / 2
    if rating and rating >= 4.5 and count and count >= 50:
        score += 10
    elif rating and rating >= 4.0 and count and count >= 20:
        score += 5

    return max(0, min(100, score))


def score_value(product: ProductData, mid_override: float | None = None) -> int:
    """Score price VALUE relative to quality for the area (0-100).

    Not about cheapness — about what you get for what you pay.

    mid_override: if provided, use this as the reference mid-price instead
    of the fixed domain default. In batch comparisons, this should be the
    median price of all listings — handles total-stay pricing, different
    markets, and currency differences automatically.
    """
    price_val = _parse_price(product.price)
    if price_val is None:
        return 50  # No price → neutral (dates not selected is common)

    score = 55
    if mid_override and mid_override > 0:
        mid = mid_override
    else:
        price_range = get_price_range(ScoringDomain.HOSPITALITY)
        mid = price_range["mid"]

    # Quality signals for value judgment
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating and rating > 5:
        rating = rating / 2

    quality = 40
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
        if count > 200:
            quality += 15
        elif count > 50:
            quality += 10
        elif count > 10:
            quality += 5
    quality = max(0, min(100, quality))

    price_position = price_val / mid if mid > 0 else 1.0

    # Continuous value scoring — price differences matter proportionally.
    # A hotel at half the price of another, with same quality, should score
    # meaningfully higher. Use inverse price_position scaled by quality.
    #
    # Base idea: value = quality / price_position (quality-adjusted bang-for-buck)
    # Scaled to 0-100 range with reasonable bounds.
    if quality >= 50:
        # Good quality: reward lower prices aggressively
        # price_position 0.5 → +30, 1.0 → +12, 1.5 → +3, 2.0 → -5, 3.0 → -15
        value_delta = int(30 - 24 * (price_position - 0.5))
        value_delta = max(-20, min(35, value_delta))
        score += value_delta
    else:
        # Low quality: even cheap is suspicious
        value_delta = int(10 - 15 * (price_position - 0.5))
        value_delta = max(-25, min(15, value_delta))
        score += value_delta

    return max(0, min(100, score))


def score_amenities(product: ProductData) -> int:
    """Score property amenities/quality (0-100)."""
    score = 50
    amenities = product.ingredients.lower()

    if amenities:
        keywords = [
            "wifi", "kitchen", "parking", "pool", "washer", "dryer",
            "air conditioning", "heating", "tv", "workspace",
            "gym", "hot tub", "fireplace", "patio", "balcony",
            "dishwasher", "coffee", "iron", "hair dryer",
        ]
        count = sum(1 for kw in keywords if kw in amenities)
        if count >= 10:
            score += 20
        elif count >= 6:
            score += 12
        elif count >= 3:
            score += 6
    else:
        score -= 5

    # Category ratings (in nutritionInfo)
    nutrition = product.nutritionInfo.lower()
    if nutrition:
        cats = ["cleanliness", "accuracy", "communication", "location", "check-in", "value"]
        cats_found = sum(1 for c in cats if c in nutrition)
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


def score_popularity(product: ProductData) -> int:
    count = _parse_review_count(product)
    if count is None:
        return 40
    return get_popularity_score(ScoringDomain.HOSPITALITY, count)


# ── Main scoring function ────────────────────────────────────────

def calculate_hospitality_score(
    product: ProductData,
    mid_price_override: float | None = None,
) -> tuple[int, PurchaseBreakdown, ReviewTrust]:
    """Calculate hospitality score with confidence modulation.

    Weights (hospitality-specific):
      Reviews/Trust  25%  — travelers rely heavily on guest reviews
      Value          25%  — price-to-quality ratio is critical
      Host Trust     15%  — host quality predicts experience
      Cancellation   15%  — flexibility for travel planning
      Amenities      10%  — what the property offers
      Popularity     10%  — booking volume / demand signal

    mid_price_override: when scoring in batch context, pass the median
    price of all listings so value scoring uses relative pricing instead
    of the fixed $180/night reference (which breaks for total-stay prices).
    """
    review_trust = compute_review_trust(product)

    reviews = score_reviews(product, review_trust)
    cancellation = score_cancellation(product)
    host = score_host_trust(product)
    value = score_value(product, mid_override=mid_price_override)
    amenities = score_amenities(product)
    popularity = score_popularity(product)

    # Map to PurchaseBreakdown for compatibility
    breakdown = PurchaseBreakdown(
        reviews=reviews,
        price=value,
        seller=host,
        returns=cancellation,
        popularity=popularity,
        specs=amenities,
        delivery=0,  # Not used — merged into other components
    )

    raw_score = int(
        reviews * 0.25
        + value * 0.25
        + host * 0.15
        + cancellation * 0.15
        + amenities * 0.10
        + popularity * 0.10
    )

    confidence = _compute_data_confidence(product, review_trust)
    # Low confidence pulls toward 42 (caution zone), not 50 (endorsement zone).
    UNCERTAINTY_ANCHOR = 42
    final_score = int(raw_score * confidence + UNCERTAINTY_ANCHOR * (1 - confidence))

    return final_score, breakdown, review_trust


def _compute_data_confidence(product: ProductData, review_trust: ReviewTrust) -> float:
    """Hospitality-specific confidence. Missing price is OK (no dates selected)."""
    conf = 0.5

    count = _parse_review_count(product)
    if count is not None:
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
        conf -= 0.05

    rating = _parse_rating(product)
    if rating is not None:
        conf += 0.05
    else:
        conf -= 0.10

    # Price is OPTIONAL for hospitality (dates may not be set)
    if _parse_price(product.price) is not None:
        conf += 0.03
    # No penalty for missing price

    # Host / seller
    if product.seller.strip():
        conf += 0.05

    # Review quality
    if review_trust.distribution_quality < 30:
        conf -= 0.08
    if review_trust.authenticity < 40:
        conf -= 0.05

    return max(0.35, min(1.0, conf))


def _parse_price(price_str: str) -> Optional[float]:
    if not price_str:
        return None
    cleaned = re.sub(r"[₹$€£¥,\s]", "", price_str)
    m = re.search(r"(\d+\.?\d*)", cleaned)
    return float(m.group(1)) if m else None


# ── Risk flags ────────────────────────────────────────────────────

def detect_risk_flags(product: ProductData, review_trust: ReviewTrust) -> list[str]:
    """Hospitality-specific risk flags."""
    risks: list[str] = []
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating and rating > 5:
        rating = rating / 2

    if rating and count:
        if rating >= 4.9 and count < 20:
            risks.append("Near-perfect rating with very few reviews")
        if rating >= 4.8 and count < 50:
            risks.append("Suspiciously high rating with few reviews")

    if not product.price:
        risks.append("No price information — select dates for pricing")

    if not rating and not count:
        risks.append("No guest reviews — new or unreviewed listing")

    policy = product.returnPolicy.lower()
    if policy and ("strict" in policy or "non-refundable" in policy):
        risks.append("Strict cancellation — no refund if plans change")

    if review_trust.distribution_quality < 25:
        risks.append("Review pattern looks unnatural")

    return risks


# ── Stamp generation ─────────────────────────────────────────────

def generate_stamp(
    purchase_score: int,
    health_score: int,
    is_food: bool,
    purchase_breakdown: PurchaseBreakdown,
    health_breakdown,
    review_trust: ReviewTrust,
    risk_flags: list[str] | None = None,
    product: ProductData | None = None,
) -> tuple[DecisionStamp, str, list[str], list[str], list[str]]:
    """THE TRUSTED ADVISOR — hospitality gate-based decision system.

    Same philosophy as retail: "If we say BOOK, it IS a book."
    Sequential gates, not averages. One fatal flaw kills the deal.

    Hospitality-specific tuning:
      - Missing price is OK (dates not selected)
      - Review volumes are naturally lower (200 = excellent)
      - Cancellation policy is a gate (strict = risk)
      - No "brands" — host trust replaces brand trust

    ── HARD GATES ─────────────────────────────────────────────────
    GATE 1 — TRUST: "Are the reviews legit?"
      trust < 30 → SKIP. trust < 42 → ceiling: CAUTION.

    GATE 2 — QUALITY: "Do guests like this place?"
      rating < 3.0 (normalized) w/ reviews → SKIP.
      no reviews → ceiling: CAUTION.

    GATE 3 — CANCELLATION: "Can I cancel if plans change?"
      strict/non-refundable → warning (not hard gate, but impacts confidence)

    GATE 4 — ABSENCE: "Do I have enough info?"
      no reviews + no host + no cancellation info → ceiling: CONSIDER.

    ── AFTER GATES ────────────────────────────────────────────────
    BEST PICK : score ≥ 72, trust ≥ 60, all gates pass
    BOOK      : score ≥ 58, trust ≥ 50, all gates pass
    CONSIDER  : score ≥ 45, trust ≥ 38
    CAUTION   : gate failure, or borderline
    SKIP      : hard-gate failure
    """
    positives, warnings = _build_reasons(purchase_breakdown, review_trust, product)

    risks = list(risk_flags) if risk_flags else []
    risk_count = len(risks)

    all_positives = positives
    all_warnings = risks + warnings

    trust = review_trust.trust_score

    # ═══════════════════════════════════════════════════════════════
    #  HARD GATES
    # ═══════════════════════════════════════════════════════════════

    TIER_ORDER = ["SKIP", "CAUTION", "CONSIDER", "BOOK", "BEST PICK"]
    ceiling = "BEST PICK"

    def lower_ceiling(new_cap: str, reason: str):
        nonlocal ceiling
        if TIER_ORDER.index(new_cap) < TIER_ORDER.index(ceiling):
            ceiling = new_cap
            if reason not in all_warnings:
                all_warnings.insert(0, reason)

    # ── GATE 1: TRUST ──
    if trust < 30:
        lower_ceiling("SKIP", "Cannot verify — reviews appear untrustworthy")
    elif trust < 42:
        lower_ceiling("CAUTION", "Low review trust — not enough to recommend")

    # ── GATE 2: QUALITY ──
    rating = _parse_rating(product) if product else None
    count = _parse_review_count(product) if product else None
    if rating is not None and rating > 5:
        rating = rating / 2  # Normalize Booking.com 1-10 scale

    if product is not None:
        if rating is not None and rating < 3.0 and count is not None and count > 5:
            lower_ceiling("SKIP", "Poor guest rating — travelers report problems")
        elif rating is not None and rating < 3.5 and count is not None and count > 20:
            lower_ceiling("CAUTION", "Below-average guest rating")
        elif count is None or count == 0:
            lower_ceiling("CAUTION", "No guest reviews — unproven listing")
        elif count < 3:
            lower_ceiling("CAUTION", "Too few reviews to judge")
    else:
        if review_trust.rating_strength < 20:
            lower_ceiling("SKIP", "Poor guest rating")
        elif review_trust.volume_confidence <= 15:
            lower_ceiling("CAUTION", "Very few guest reviews")

    # ── GATE 3: CANCELLATION (soft gate — warns, doesn't hard-block) ──
    policy = product.returnPolicy.lower() if product else ""
    if policy and ("strict" in policy or "non-refundable" in policy or "no refund" in policy):
        lower_ceiling("CONSIDER", "Strict cancellation — no refund if plans change")

    # ── GATE 4: ABSENCE ──
    if product is not None:
        has_host = bool(product.seller.strip())

        absence_count = sum([
            not has_host,
            count is None or count < 3,
            rating is None,
        ])
        if absence_count >= 3:
            lower_ceiling("CAUTION", "Too little information to recommend")
        elif absence_count >= 2:
            lower_ceiling("CONSIDER", "Missing key listing details")

    # ── GATE 5: RED FLAGS ──
    if risk_count >= 3:
        lower_ceiling("CAUTION", "Multiple risk signals detected")
    elif risk_count >= 2:
        lower_ceiling("CONSIDER", "Several concerns noted")

    # ═══════════════════════════════════════════════════════════════
    #  DECISION
    # ═══════════════════════════════════════════════════════════════

    if purchase_score >= 72 and trust >= 60 and risk_count <= 1:
        verdict = "BEST PICK"
    elif purchase_score >= 58 and trust >= 50 and risk_count <= 1:
        verdict = "BOOK"
    elif purchase_score >= 45 and trust >= 38:
        verdict = "CONSIDER"
    elif purchase_score < 38 or trust < 25:
        verdict = "SKIP"
    else:
        verdict = "CAUTION"

    # Apply ceiling
    if TIER_ORDER.index(verdict) > TIER_ORDER.index(ceiling):
        verdict = ceiling

    # Map verdict to stamp internals
    label = verdict
    if verdict in ("BEST PICK", "BOOK"):
        stamp_type = "SMART_BUY"
        icon = "🟢"
        legacy = "BUY"
    elif verdict == "SKIP":
        stamp_type = "AVOID"
        icon = "🔴"
        legacy = "DON'T BUY"
    else:
        stamp_type = "CHECK"
        icon = "🟡"
        legacy = "NEUTRAL"

    # Micro-reasons
    if verdict == "SKIP":
        micro_reasons = (all_warnings or ["Too many concerns"])[:2]
    elif verdict == "BEST PICK":
        micro_reasons = (all_positives or ["Excellent stay — highly rated"])[:2]
    elif verdict == "BOOK":
        micro_reasons = (all_positives or ["Vetted — good option"])[:2]
    elif verdict == "CAUTION":
        micro_reasons = (all_warnings or ["Verify before booking"])[:2]
    else:  # CONSIDER
        micro_reasons = (all_positives[:1] + all_warnings[:1]) or ["Worth a look — check details"]

    # Signals
    purchase_signal_parts = all_positives[:2] if stamp_type == "SMART_BUY" else all_warnings[:1] + all_positives[:1]
    purchase_signal = " · ".join(purchase_signal_parts) if purchase_signal_parts else "Average value"

    stamp = DecisionStamp(
        stamp=stamp_type,
        label=label,
        icon=icon,
        reasons=micro_reasons,
        purchase_signal=purchase_signal,
        health_signal="",
    )

    return stamp, legacy, micro_reasons, all_warnings, all_positives


def _build_reasons(
    breakdown: PurchaseBreakdown,
    review_trust: ReviewTrust,
    product: ProductData | None = None,
) -> tuple[list[str], list[str]]:
    """Build hospitality-specific positives and warnings."""
    positives = []
    warnings = []

    # Reviews
    if review_trust.volume_confidence <= 20:
        warnings.append("Few guest reviews")
    elif review_trust.trust_score >= 75:
        positives.append("Strong guest reviews")
    elif review_trust.trust_score < 40:
        warnings.append("Suspicious review pattern")

    if review_trust.volume_confidence >= 75:
        positives.append("Many guest reviews")

    # Value (mapped to price in breakdown)
    if breakdown.price >= 75:
        positives.append("Great value for the area")
    elif breakdown.price >= 60:
        positives.append("Fair price for this type of stay")
    elif breakdown.price < 40:
        warnings.append("Pricey for what you get")

    # Host (mapped to seller in breakdown)
    if breakdown.seller >= 80:
        positives.append("Experienced, trusted host")
    elif breakdown.seller >= 65:
        positives.append("Good host profile")
    elif breakdown.seller < 45:
        warnings.append("Host has limited track record")

    # Cancellation (mapped to returns in breakdown)
    if breakdown.returns >= 80:
        positives.append("Flexible cancellation")
    elif breakdown.returns < 35:
        warnings.append("Strict cancellation policy")

    # Amenities (mapped to specs in breakdown)
    if breakdown.specs >= 75:
        positives.append("Well-equipped with amenities")
    elif breakdown.specs < 35:
        warnings.append("Limited amenities listed")

    return positives, warnings
