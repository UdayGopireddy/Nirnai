"""Retail scoring engine — THE TRUSTED ADVISOR for shopping products.

Scoring philosophy:
  NirnAI is the customer's trusted friend, expert dad, guru.
  When we say BUY, it IS a buy. When we say SKIP, we're protecting you.

  We use GATES, not averages. One fatal flaw kills the deal.
  Missing information = suspicion, not neutral.
  A product must earn endorsement — it's not the default.

  GATE 1 — TRUST: "Is this thing even legit?"
  GATE 2 — QUALITY: "Do people who bought it actually like it?"
  GATE 3 — SAFETY: "Is it safe?" (food/personal care)
  GATE 4 — ABSENCE: "Do I have enough info to recommend?"
  GATE 5 — RED FLAGS: Single critical flag can kill the deal.

  AFTER gates pass, the composite score determines tier:
    BEST PICK: ≥ 75, trust ≥ 65 — "Absolutely, excellent choice."
    BUY:       ≥ 65, trust ≥ 55 — "Go for it, I've checked it."
    CONSIDER:  ≥ 50, trust ≥ 42 — "Probably fine, but check [these]."
    CAUTION:   gate failure / borderline — "I'd hold off."
    SKIP:      hard-gate fail — "Don't buy this."

Component weights (for composite score):
  Reviews/Trust  25%  — review quality + volume
  Value          25%  — price relative to quality
  Seller Trust   15%  — seller reputation + fulfillment
  Returns        10%  — return policy strength
  Popularity     10%  — demand signal
  Brand/Quality  10%  — brand recognition + data richness
  Delivery        5%  — shipping speed
"""

from __future__ import annotations

import re
from typing import Optional
from models import ProductData, PurchaseBreakdown, ReviewTrust, DecisionStamp
from domain_classifier import (
    ScoringDomain, classify_domain, get_volume_score, get_popularity_score, get_price_range,
)


# Known brands (lowercase)
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


# ── Review Trust ─────────────────────────────────────────────────

def compute_review_trust(product: ProductData) -> ReviewTrust:
    rating_strength = _score_rating_strength(product)
    volume_confidence = _score_volume_confidence(product)
    distribution_quality = _score_distribution_quality(product)
    authenticity = _score_authenticity(product)

    trust_score = int(
        rating_strength * 0.30
        + volume_confidence * 0.30
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


def _score_distribution_quality(product: ProductData) -> int:
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    if rating is None or count is None:
        return 50

    if rating >= 4.8 and count < 100:
        return 25
    if rating >= 4.95:
        if count >= 500:
            return 55
        if count >= 100:
            return 35
        return 20
    if 3.8 <= rating <= 4.5 and count > 500:
        return 85
    if count > 200 and rating >= 3.5:
        return 70
    return 50


def _score_authenticity(product: ProductData) -> int:
    score = 60
    seller = product.seller.lower()
    trusted = [
        "cloudtail", "appario", "amazon", "cocoblu",
        "official", "authorized", "brand store",
    ]
    if any(t in seller for t in trusted):
        score += 20
    if not seller:
        score -= 15
    rating = _parse_rating(product)
    if rating and rating >= 4.7 and not any(t in seller for t in trusted):
        score -= 10
    return max(0, min(100, score))


# ── Component scorers ────────────────────────────────────────────

def score_reviews(product: ProductData, review_trust: ReviewTrust) -> int:
    return review_trust.trust_score


def score_value(product: ProductData) -> int:
    """Score VALUE — not cheapness. Quality relative to price in category."""
    price_val = _parse_price(product.price)
    if price_val is None:
        return 50

    score = 55
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

    domain = classify_domain(product.source_site, product.category, product.title)
    price_range = get_price_range(domain)
    mid = price_range["mid"]

    rating = _parse_rating(product)
    count = _parse_review_count(product)
    brand = product.brand.strip().lower()
    has_brand = bool(brand) and any(b in brand for b in KNOWN_BRANDS)

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

    price_position = price_val / mid if mid > 0 else 1.0

    if quality >= 70:
        if price_position <= 0.5:
            score += 20
        elif price_position <= 1.0:
            score += 15
        elif price_position <= 1.5:
            score += 8
        elif price_position <= 2.5:
            score += 3
        else:
            score -= 5
    elif quality >= 50:
        if price_position <= 0.5:
            score += 12
        elif price_position <= 1.0:
            score += 5
        elif price_position <= 1.5:
            score -= 3
        else:
            score -= 12
    else:
        if price_position <= 0.3:
            score += 3
        elif price_position <= 0.7:
            score -= 3
        else:
            score -= 18

    return max(0, min(100, score))


def score_seller(product: ProductData) -> int:
    seller = product.seller.lower()
    fulfiller = getattr(product, 'fulfiller', '').lower()

    if not seller:
        if 'amazon' in fulfiller:
            return 60
        return 40

    trusted = [
        "cloudtail", "appario", "amazon", "cocoblu",
        "trustful", "retail", "official", "authorized"
    ]
    if any(t in seller for t in trusted):
        return 90
    if "visit the" in seller and "store" in seller:
        return 80
    if 'amazon' in fulfiller:
        return 70
    return 55


def score_returns(product: ProductData) -> int:
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
    count = _parse_review_count(product)
    if count is None:
        return 40
    domain = classify_domain(product.source_site, product.category, product.title)
    return get_popularity_score(domain, count)


def score_brand_quality(product: ProductData) -> int:
    """Score brand recognition + data richness."""
    score = 50
    brand = product.brand.strip().lower()
    seller = product.seller.strip().lower()
    title_lower = product.title.lower()

    if brand:
        if any(b in brand for b in KNOWN_BRANDS):
            score += 20
        else:
            score += 8
        if brand and seller:
            if brand in seller or seller in brand:
                score += 10
            elif "official" in seller or "authorized" in seller:
                score += 8
            elif any(t in seller for t in ["amazon", "walmart", "target"]):
                score += 5
            elif any(b in brand for b in KNOWN_BRANDS):
                score -= 10
    else:
        if any(b in title_lower for b in KNOWN_BRANDS):
            score += 10
        else:
            score -= 5

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


def score_delivery(product: ProductData) -> int:
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


# ── Main scoring function ────────────────────────────────────────

def calculate_retail_score(product: ProductData) -> tuple[int, PurchaseBreakdown, ReviewTrust]:
    """Calculate retail score with confidence modulation.

    Weights (retail):
      Reviews/Trust  25%
      Value          25%
      Seller Trust   15%
      Returns        10%
      Popularity     10%
      Brand/Quality  10%
      Delivery        5%
    """
    review_trust = compute_review_trust(product)

    breakdown = PurchaseBreakdown(
        reviews=score_reviews(product, review_trust),
        price=score_value(product),
        seller=score_seller(product),
        returns=score_returns(product),
        popularity=score_popularity(product),
        specs=score_brand_quality(product),
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

    confidence = _compute_data_confidence(product, review_trust)
    # Low confidence pulls score toward 42 (CAUTION range), not 50 (endorsement range).
    # If we don't have enough data, we should NOT endorse.
    UNCERTAINTY_ANCHOR = 42
    final_score = int(raw_score * confidence + UNCERTAINTY_ANCHOR * (1 - confidence))

    return final_score, breakdown, review_trust


def _compute_data_confidence(product: ProductData, review_trust: ReviewTrust) -> float:
    """Retail-specific confidence — missing price/brand penalized more."""
    domain = classify_domain(product.source_site, product.category, product.title)
    conf = 0.5

    count = _parse_review_count(product)
    if count is not None:
        if count > 1000:
            conf += 0.25
        elif count > 200:
            conf += 0.18
        elif count > 50:
            conf += 0.10
        elif count > 10:
            conf += 0.03
        else:
            conf -= 0.05
    else:
        conf -= 0.08

    rating = _parse_rating(product)
    if rating is not None:
        conf += 0.05
    else:
        conf -= 0.10

    if _parse_price(product.price) is not None:
        conf += 0.05
    else:
        conf -= 0.05  # Retail: missing price is a real gap

    if product.seller.strip():
        conf += 0.05

    if product.brand.strip():
        conf += 0.03

    if review_trust.distribution_quality < 30:
        conf -= 0.08
    if review_trust.authenticity < 40:
        conf -= 0.05

    return max(0.3, min(1.0, conf))


def _parse_price(price_str: str) -> Optional[float]:
    if not price_str:
        return None
    cleaned = re.sub(r"[₹$€£¥,\s]", "", price_str)
    m = re.search(r"(\d+\.?\d*)", cleaned)
    return float(m.group(1)) if m else None


def _detect_discount(price_str: str) -> Optional[float]:
    if not price_str:
        return None
    pct_match = re.search(r"(\d+)\s*%\s*(?:off|save|discount)?", price_str, re.IGNORECASE)
    if not pct_match:
        pct_match = re.search(r"(?:save|off|discount)\s*(\d+)\s*%", price_str, re.IGNORECASE)
    if pct_match:
        return float(pct_match.group(1))
    prices = re.findall(r"[\d,]+\.?\d*", re.sub(r"[₹$€£¥,]", "", price_str))
    if len(prices) >= 2:
        p1, p2 = float(prices[0]), float(prices[1])
        if p2 > p1 and p2 > 0:
            return round((p2 - p1) / p2 * 100, 1)
    return None


# ── Risk flags ────────────────────────────────────────────────────

def detect_risk_flags(product: ProductData, review_trust: ReviewTrust) -> list[str]:
    """Retail-specific risk flags."""
    risks: list[str] = []
    rating = _parse_rating(product)
    count = _parse_review_count(product)
    brand = product.brand.strip().lower()
    seller = product.seller.strip().lower()

    if rating and count:
        if rating >= 4.8 and count < 50:
            risks.append("Suspiciously high rating with few reviews")
        if rating >= 4.95 and count < 200:
            risks.append("Near-perfect rating — possible fake reviews")

    if brand and seller:
        is_premium = any(b in brand for b in KNOWN_BRANDS)
        is_known_seller = any(t in seller for t in [
            "amazon", "walmart", "target", "official", "authorized", brand,
        ])
        if is_premium and not is_known_seller:
            risks.append(f"Premium brand ({product.brand}) sold by unverified seller")

    if not product.price:
        risks.append("No price information available")
    if not rating and not count:
        risks.append("No reviews or ratings — unverified product")
    if not seller:
        risks.append("Unknown seller")

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
    """THE TRUSTED ADVISOR — gate-based decision system.

    NirnAI's promise: "If we say BUY, it IS a buy."

    How a trusted advisor thinks — sequential gates, not averages.
    One fatal flaw kills the deal. Missing data = suspicion, not neutral.

    ── HARD GATES (any failure → immediate ceiling) ───────────────
    GATE 1 — TRUST: "Is this thing even legit?"
      trust < 30 → SKIP (can't verify, don't risk it)
      trust < 45 → ceiling: CAUTION (too much doubt)

    GATE 2 — QUALITY: "Do people who bought it actually like it?"
      rating < 3.0 with reviews → SKIP (people say it's bad)
      no reviews at all → ceiling: CAUTION (unproven)

    GATE 3 — SAFETY: "Is it safe?" (food/personal care only)
      health < 30 → SKIP (harmful)
      health < 45 → ceiling: CAUTION

    GATE 4 — ABSENCE: "Do I have enough info to recommend?"
      no brand + no seller + low reviews → ceiling: CONSIDER
      If too much is missing, an advisor says "I can't vouch for this"

    ── AFTER GATES: score determines tier within ceiling ──────────
    BEST PICK : score ≥ 75, trust ≥ 65, all gates pass, ≤ 1 flag
    BUY       : score ≥ 65, trust ≥ 55, all gates pass, ≤ 1 flag
    CONSIDER  : score ≥ 50, trust ≥ 42
    CAUTION   : score 40-49, or soft-gate failure
    SKIP      : score < 40, or hard-gate failure
    """
    positives, warnings = _build_reasons(purchase_breakdown, review_trust, product)
    health_positives = []
    health_warnings = []
    health_signal = ""

    risks = list(risk_flags) if risk_flags else []
    risk_count = len(risks)

    # Food: health score matters
    if is_food and health_score > 0:
        health_positives, health_warnings, health_signal = _build_health_reasons(
            health_score, health_breakdown
        )

    # Personal care: health score matters
    is_personal_care = False
    if product:
        from health_scoring import is_personal_care_product
        is_personal_care = is_personal_care_product(product)
    if is_personal_care and health_score > 0:
        health_positives, health_warnings, health_signal = _build_health_reasons(
            health_score, health_breakdown
        )
        if health_score >= 80:
            health_positives.append("Premium ingredient quality")
            health_signal = "Premium ingredients justify the price"

    all_positives = positives + health_positives
    all_warnings = risks + warnings + health_warnings

    trust = review_trust.trust_score

    # ═══════════════════════════════════════════════════════════════
    #  HARD GATES — a trusted advisor stops here if these fail
    # ═══════════════════════════════════════════════════════════════

    TIER_ORDER = ["SKIP", "CAUTION", "CONSIDER", "BUY", "BEST PICK"]
    ceiling = "BEST PICK"  # Start optimistic, gates pull it down

    def lower_ceiling(new_cap: str, reason: str):
        nonlocal ceiling
        if TIER_ORDER.index(new_cap) < TIER_ORDER.index(ceiling):
            ceiling = new_cap
            if reason not in all_warnings:
                all_warnings.insert(0, reason)

    # ── GATE 1: TRUST — "Is this thing even legit?" ──
    if trust < 30:
        lower_ceiling("SKIP", "Cannot verify — reviews appear untrustworthy")
    elif trust < 45:
        lower_ceiling("CAUTION", "Low review trust — not enough to recommend")

    # ── GATE 2: QUALITY — "Do people who bought it actually like it?" ──
    # Use product data if available, otherwise infer from review_trust
    rating = _parse_rating(product) if product else None
    count = _parse_review_count(product) if product else None

    if product is not None:
        # We have raw data — use it directly
        if rating is not None and rating < 3.0 and count is not None and count > 10:
            lower_ceiling("SKIP", "Poor rating — buyers report problems")
        elif rating is not None and rating < 3.5 and count is not None and count > 50:
            lower_ceiling("CAUTION", "Below-average rating from many buyers")
        elif count is None or count == 0:
            lower_ceiling("CAUTION", "No reviews — unproven product")
        elif count < 5:
            lower_ceiling("CAUTION", "Too few reviews to judge")
    else:
        # No product object — infer from review_trust sub-scores
        if review_trust.rating_strength < 20:
            lower_ceiling("SKIP", "Poor rating — buyers report problems")
        elif review_trust.volume_confidence <= 15:
            lower_ceiling("CAUTION", "Very few reviews")

    # ── GATE 3: SAFETY — "Is it safe?" (food / personal care) ──
    if (is_food or is_personal_care) and health_score > 0:
        if health_score < 30:
            lower_ceiling("SKIP", "Harmful ingredients detected")
        elif health_score < 45:
            lower_ceiling("CAUTION", "Health concerns with ingredients")
        elif health_score < 55:
            lower_ceiling("CONSIDER", "Moderate ingredient concerns")

    # ── GATE 4: ABSENCE — "Do I have enough info to recommend?" ──
    if product is not None:
        has_brand = bool(product.brand.strip())
        has_seller = bool(product.seller.strip())
        has_price = bool(product.price.strip())

        absence_count = sum([
            not has_brand,
            not has_seller,
            not has_price,
            count is None or count < 10,
            rating is None,
        ])
        if absence_count >= 4:
            lower_ceiling("CAUTION", "Too little information to recommend")
        elif absence_count >= 3:
            lower_ceiling("CONSIDER", "Missing key product details")

    # ── GATE 5: RED FLAGS — single critical flag can kill the deal ──
    if risk_count >= 3:
        lower_ceiling("CAUTION", "Multiple risk signals detected")
    elif risk_count >= 2:
        lower_ceiling("CONSIDER", "Several concerns noted")

    # ═══════════════════════════════════════════════════════════════
    #  DECISION — score determines tier WITHIN the gate-allowed ceiling
    # ═══════════════════════════════════════════════════════════════

    if purchase_score >= 75 and trust >= 65 and risk_count <= 1:
        verdict = "BEST PICK"
    elif purchase_score >= 65 and trust >= 55 and risk_count <= 1:
        verdict = "BUY"
    elif purchase_score >= 50 and trust >= 42:
        verdict = "CONSIDER"
    elif purchase_score < 40 or trust < 25:
        verdict = "SKIP"
    else:
        verdict = "CAUTION"

    # Apply ceiling — gates can only LOWER, never raise
    if TIER_ORDER.index(verdict) > TIER_ORDER.index(ceiling):
        verdict = ceiling

    # Map verdict to stamp internals
    label = verdict
    if verdict in ("BEST PICK", "BUY"):
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

    # ── Micro-reasons: the advisor's one-line explanation ──
    if verdict == "SKIP":
        micro_reasons = (all_warnings or ["Too many concerns"])[:2]
    elif verdict == "BEST PICK":
        micro_reasons = (all_positives or ["Excellent across the board"])[:2]
    elif verdict == "BUY":
        micro_reasons = (all_positives or ["Vetted — solid choice"])[:2]
    elif verdict == "CAUTION":
        micro_reasons = (all_warnings or ["Proceed carefully"])[:2]
    else:  # CONSIDER
        micro_reasons = (all_positives[:1] + all_warnings[:1]) or ["Worth a look — check details"]

    # Signals
    purchase_signal_parts = all_positives[:2] if stamp_type == "SMART_BUY" else all_warnings[:1] + all_positives[:1]
    purchase_signal = " • ".join(purchase_signal_parts) if purchase_signal_parts else "Average value"

    stamp = DecisionStamp(
        stamp=stamp_type,
        label=label,
        icon=icon,
        reasons=micro_reasons,
        purchase_signal=purchase_signal,
        health_signal=health_signal,
    )

    return stamp, legacy, micro_reasons, all_warnings, all_positives


def _build_reasons(
    breakdown: PurchaseBreakdown,
    review_trust: ReviewTrust,
    product: ProductData | None = None,
) -> tuple[list[str], list[str]]:
    """Build retail-specific positives and warnings."""
    positives = []
    warnings = []

    domain = ScoringDomain.GENERAL
    if product:
        domain = classify_domain(
            getattr(product, 'source_site', ''),
            getattr(product, 'category', ''),
            getattr(product, 'title', ''),
        )

    # Reviews
    if review_trust.volume_confidence <= 20:
        warnings.append("Low review count")
    elif review_trust.trust_score >= 75:
        positives.append("Strong reviews")
    elif review_trust.trust_score < 40:
        warnings.append("Suspicious reviews")

    if review_trust.volume_confidence >= 75:
        positives.append("High review volume")

    # Value
    if breakdown.price >= 75:
        positives.append("Exceptional value for money")
    elif breakdown.price >= 60:
        positives.append("Fair price for category")
    elif breakdown.price < 40:
        warnings.append("Overpriced for what you get")

    # Seller
    if breakdown.seller >= 80:
        positives.append("Trusted seller")
    elif breakdown.seller >= 65:
        positives.append("Known retailer")
    elif breakdown.seller < 45:
        warnings.append("Unknown seller")

    # Returns
    if breakdown.returns >= 80:
        positives.append("Easy returns")
    elif breakdown.returns < 35:
        warnings.append("Weak return policy")

    # Delivery
    if breakdown.delivery >= 80:
        positives.append("Fast delivery")

    # Brand / Quality
    if breakdown.specs >= 75:
        positives.append("Reputable brand")
    elif breakdown.specs < 35:
        warnings.append("Unknown brand — verify quality")

    return positives, warnings


def _build_health_reasons(
    health_score: int,
    breakdown,
) -> tuple[list[str], list[str], str]:
    positives = []
    warnings = []

    if breakdown.nutrition >= 75:
        positives.append("Good nutrition")
    elif breakdown.nutrition < 40:
        warnings.append("Poor nutrition")

    if breakdown.ingredients >= 75:
        positives.append("Clean ingredients")
    elif breakdown.ingredients < 40:
        warnings.append("Harmful ingredients")

    if breakdown.processing >= 75:
        positives.append("Minimally processed")
    elif breakdown.processing < 40:
        warnings.append("Ultra-processed")

    if health_score >= 70:
        signal = "Healthy choice"
    elif health_score >= 50:
        signal = "Moderate health"
    elif health_score > 0:
        signal = "Health concern"
    else:
        signal = ""

    return positives, warnings, signal
