"""Decision engine — generates stamps, reasons, warnings, positives, confidence.

Phase 1 upgrade: confidence is now a PRIMARY signal, not an afterthought.
Risk flags from purchase_scoring are surfaced directly to users.
"""

from __future__ import annotations

from models import (
    ProductData,
    PurchaseBreakdown,
    HealthBreakdown,
    ReviewTrust,
    DecisionStamp,
)
from purchase_scoring import detect_risk_flags
from domain_classifier import ScoringDomain, classify_domain, get_label


def compute_confidence(
    product: ProductData,
    review_trust: ReviewTrust,
    purchase_score: int,
) -> float:
    """Compute user-facing confidence level (0.0 - 1.0).

    This tells the user: "How much should you trust this verdict?"

    Factors:
      - Review volume + trust quality (dominant — 40%)
      - Data completeness (30%)
      - Score extremity (10%)
      - Risk flag count (20%)
    """
    score = 0.0

    # ── Review trust (40% of confidence) ──────────────────────────
    # Trust score 0-100 → 0.0-0.40
    score += (review_trust.trust_score / 100) * 0.40

    # ── Data completeness (30%) ───────────────────────────────────
    fields = [
        product.title, product.price, product.rating,
        product.reviewCount, product.seller, product.brand,
        product.delivery, product.returnPolicy, product.category,
    ]
    filled = sum(1 for v in fields if v)
    score += (filled / len(fields)) * 0.30

    # ── Score extremity (10%) ─────────────────────────────────────
    # Extreme scores (very high or very low) are more definitive
    distance_from_neutral = abs(purchase_score - 50) / 50  # 0.0-1.0
    score += distance_from_neutral * 0.10

    # ── Risk penalty (20%) ────────────────────────────────────────
    risks = detect_risk_flags(product, review_trust)
    risk_penalty = min(len(risks) * 0.05, 0.20)  # Each risk costs 5%, cap at 20%
    score += (0.20 - risk_penalty)

    return max(0.0, min(1.0, round(score, 2)))


def _build_purchase_reasons(
    breakdown: PurchaseBreakdown,
    review_trust: ReviewTrust,
    product: ProductData | None = None,
) -> tuple[list[str], list[str]]:
    """Build positives and warnings from purchase breakdown.

    Domain-aware: uses domain_classifier for context-specific labels.
    """
    positives = []
    warnings = []

    # Detect domain
    domain = ScoringDomain.GENERAL
    if product:
        domain = classify_domain(
            getattr(product, 'source_site', ''),
            getattr(product, 'category', ''),
            getattr(product, 'title', ''),
        )

    # Reviews
    if review_trust.volume_confidence <= 20:
        warnings.append(get_label(domain, "low_volume"))
    elif review_trust.trust_score >= 75:
        positives.append(get_label(domain, "strong_reviews"))
    elif review_trust.trust_score < 40:
        warnings.append(get_label(domain, "suspicious_reviews"))

    if review_trust.volume_confidence >= 75:
        positives.append(get_label(domain, "high_volume"))
    elif review_trust.volume_confidence < 35 and review_trust.volume_confidence > 20:
        warnings.append(get_label(domain, "low_volume"))

    # Price
    if breakdown.price >= 75:
        positives.append(get_label(domain, "strong_value"))
    elif breakdown.price >= 60:
        positives.append(get_label(domain, "fair_value"))
    elif breakdown.price < 40:
        warnings.append(get_label(domain, "poor_value"))

    # Seller
    if breakdown.seller >= 80:
        positives.append(get_label(domain, "trusted_seller"))
    elif breakdown.seller >= 65:
        if domain == ScoringDomain.HOSPITALITY:
            positives.append(get_label(domain, "good_seller"))
    elif breakdown.seller < 45:
        warnings.append(get_label(domain, "unknown_seller"))

    # Returns
    if breakdown.returns >= 80:
        positives.append(get_label(domain, "easy_returns"))
    elif breakdown.returns < 35:
        warnings.append(get_label(domain, "weak_returns"))

    # Delivery
    if breakdown.delivery >= 80:
        positives.append(get_label(domain, "fast_delivery"))

    # Quality
    if domain == ScoringDomain.HOSPITALITY:
        if breakdown.specs >= 75:
            positives.append(get_label(domain, "good_quality"))
        elif breakdown.specs < 35:
            warnings.append(get_label(domain, "poor_quality"))

    return positives, warnings


def _build_health_reasons(
    health_score: int,
    breakdown: HealthBreakdown,
) -> tuple[list[str], list[str], str]:
    """Build health positives, warnings, and signal string."""
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

    # Build signal string
    if health_score >= 70:
        signal = "Healthy choice"
    elif health_score >= 50:
        signal = "Moderate health"
    elif health_score > 0:
        signal = "Health concern"
    else:
        signal = ""

    return positives, warnings, signal


def generate_stamp(
    purchase_score: int,
    health_score: int,
    is_food: bool,
    purchase_breakdown: PurchaseBreakdown,
    health_breakdown: HealthBreakdown,
    review_trust: ReviewTrust,
    risk_flags: list[str] | None = None,
    product: ProductData | None = None,
) -> tuple[DecisionStamp, str, list[str], list[str], list[str]]:
    """
    Generate the decision stamp per decision_stamp_badge_system spec.

    Phase 1 upgrade: risk_flags are surfaced directly in warnings.
    Domain-aware: uses travel-specific language for travel listings.

    Returns: (stamp, legacy_decision, reasons, warnings, positives)
    """
    # Gather reasons
    purchase_positives, purchase_warnings = _build_purchase_reasons(
        purchase_breakdown, review_trust, product
    )

    # Add risk flags to warnings (these bypass normal threshold logic)
    if risk_flags:
        purchase_warnings = list(risk_flags) + purchase_warnings

    health_positives = []
    health_warnings = []
    health_signal = ""

    if is_food and health_score > 0:
        health_positives, health_warnings, health_signal = _build_health_reasons(
            health_score, health_breakdown
        )

    all_positives = purchase_positives + health_positives
    all_warnings = purchase_warnings + health_warnings

    # --- Decision logic (from technical blueprint Section 14) ---
    if is_food and health_score > 0:
        if health_score < 40:
            stamp_type = "AVOID"
            legacy = "DON'T BUY"
        elif purchase_score > 80 and health_score > 70:
            stamp_type = "SMART_BUY"
            legacy = "BUY"
        elif purchase_score < 50:
            stamp_type = "AVOID"
            legacy = "DON'T BUY"
        elif purchase_score >= 65 and health_score >= 55:
            stamp_type = "SMART_BUY"
            legacy = "BUY"
        else:
            stamp_type = "CHECK"
            legacy = "NEUTRAL"
    else:
        # Domain-aware thresholds: hospitality has inherently sparser data
        # (price requires dates, brand doesn't exist, etc.)
        domain = ScoringDomain.GENERAL
        if product:
            domain = classify_domain(
                getattr(product, 'source_site', ''),
                getattr(product, 'category', ''),
                getattr(product, 'title', ''),
            )
        buy_threshold = 70 if domain == ScoringDomain.HOSPITALITY else 75
        avoid_threshold = 40 if domain == ScoringDomain.HOSPITALITY else 45

        if purchase_score >= buy_threshold:
            stamp_type = "SMART_BUY"
            legacy = "BUY"
        elif purchase_score < avoid_threshold:
            stamp_type = "AVOID"
            legacy = "DON'T BUY"
        else:
            stamp_type = "CHECK"
            legacy = "NEUTRAL"

    # Build stamp
    stamp_map = {
        "SMART_BUY": ("BUY", "🟢"),
        "CHECK": ("THINK ABOUT IT", "🟡"),
        "AVOID": ("DON'T BUY", "🔴"),
    }
    label, icon = stamp_map[stamp_type]

    # Pick top 2 micro-reasons
    if stamp_type == "AVOID":
        micro_reasons = (all_warnings or ["Review carefully"])[:2]
    elif stamp_type == "SMART_BUY":
        micro_reasons = (all_positives or ["Looks good"])[:2]
    else:
        # CHECK — mix of both
        micro_reasons = (all_warnings[:1] + all_positives[:1]) or ["Mixed signals"]

    # Build purchase signal
    purchase_signal_parts = purchase_positives[:2] if stamp_type == "SMART_BUY" else purchase_warnings[:1] + purchase_positives[:1]
    purchase_signal = " • ".join(purchase_signal_parts) if purchase_signal_parts else "Average value"

    stamp = DecisionStamp(
        stamp=stamp_type,
        label=label,
        icon=icon,
        reasons=micro_reasons,
        purchase_signal=purchase_signal,
        health_signal=health_signal,
    )

    # Top reasons for the full response
    reasons = micro_reasons

    return stamp, legacy, reasons, all_warnings, all_positives
