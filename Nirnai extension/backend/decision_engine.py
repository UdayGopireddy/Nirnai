"""Decision engine — generates stamps, reasons, warnings, positives, confidence."""

from __future__ import annotations

from models import (
    ProductData,
    PurchaseBreakdown,
    HealthBreakdown,
    ReviewTrust,
    DecisionStamp,
)


def compute_confidence(
    product: ProductData,
    review_trust: ReviewTrust,
    purchase_score: int,
) -> float:
    """Compute confidence level (0.0 - 1.0) based on data completeness and trust."""
    score = 0.5

    # Review trust strongly influences confidence
    score += (review_trust.trust_score - 50) * 0.004  # ±0.20

    # More data fields filled = higher confidence
    filled = sum(
        1
        for v in [
            product.title, product.price, product.rating,
            product.reviewCount, product.seller, product.delivery,
            product.returnPolicy, product.category,
        ]
        if v
    )
    score += filled * 0.03  # up to +0.24

    # Extreme scores are more confident
    if purchase_score > 85 or purchase_score < 30:
        score += 0.05

    return max(0.0, min(1.0, round(score, 2)))


def _build_purchase_reasons(
    breakdown: PurchaseBreakdown,
    review_trust: ReviewTrust,
) -> tuple[list[str], list[str]]:
    """Build positives and warnings from purchase breakdown."""
    positives = []
    warnings = []

    # Reviews
    if review_trust.volume_confidence <= 20:
        warnings.append("Low review count")
    elif review_trust.trust_score >= 75:
        positives.append("Strong reviews")
    elif review_trust.trust_score < 40:
        warnings.append("Suspicious reviews")

    if review_trust.volume_confidence >= 75:
        positives.append("High review volume")
    elif review_trust.volume_confidence < 35 and review_trust.volume_confidence > 20:
        warnings.append("Low review count")

    # Price
    if breakdown.price >= 75:
        positives.append("Good value")
    elif breakdown.price < 40:
        warnings.append("Overpriced")

    # Seller
    if breakdown.seller >= 80:
        positives.append("Trusted seller")
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
) -> tuple[DecisionStamp, str, list[str], list[str], list[str]]:
    """
    Generate the decision stamp per decision_stamp_badge_system spec.

    Returns: (stamp, legacy_decision, reasons, warnings, positives)
    """
    # Gather reasons
    purchase_positives, purchase_warnings = _build_purchase_reasons(
        purchase_breakdown, review_trust
    )

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
        if purchase_score >= 80:
            stamp_type = "SMART_BUY"
            legacy = "BUY"
        elif purchase_score < 50:
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
