"""Domain classifier — single source of truth for scoring domain detection.

Every source_site maps to exactly one scoring domain. Each domain has its own:
  - Review volume calibration (Airbnb 200 reviews = Amazon 10K reviews)
  - Seller/host trust logic
  - Return/cancellation interpretation
  - Delivery/check-in interpretation
  - Quality signal interpretation
  - AI prompt language
  - Price tier ranges

Adding a new site? Add it to the appropriate DOMAIN_* set below.
Everything downstream adapts automatically.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional


class ScoringDomain(str, Enum):
    """Top-level scoring domains. Each gets its own scoring behavior."""
    HOSPITALITY = "hospitality"   # Rentals, hotels, stays
    ELECTRONICS = "electronics"   # Tech products, gadgets
    GROCERY = "grocery"           # Food, supplements, health products
    FASHION = "fashion"           # Clothing, shoes, accessories
    HOME = "home"                 # Furniture, home improvement
    GENERAL = "general"           # Default shopping


# ── Source site → Domain mapping ──────────────────────────────────

DOMAIN_HOSPITALITY = frozenset({
    "airbnb", "booking", "vrbo", "hotels", "agoda",
    "tripadvisor", "expedia", "googletravel",
})

DOMAIN_ELECTRONICS = frozenset({
    "bestbuy", "apple", "samsung", "dyson",
})

DOMAIN_GROCERY = frozenset({
    "walgreens", "cvs",
})

DOMAIN_FASHION = frozenset({
    "nike", "nordstrom", "macys",
})

DOMAIN_HOME = frozenset({
    "homedepot", "lowes", "wayfair",
})

# Everything else (amazon, walmart, target, costco, ebay, generic, etc.)
# → GENERAL


def classify_domain(source_site: str, category: str = "", title: str = "") -> ScoringDomain:
    """Classify a product into its scoring domain.

    Priority:
      1. source_site (most reliable — set by extractor)
      2. category field (fallback for generic extractor)
      3. title keywords (last resort)
    """
    site = (source_site or "").lower().strip()

    # Direct site mapping (fast path)
    if site in DOMAIN_HOSPITALITY:
        return ScoringDomain.HOSPITALITY
    if site in DOMAIN_ELECTRONICS:
        return ScoringDomain.ELECTRONICS
    if site in DOMAIN_GROCERY:
        return ScoringDomain.GROCERY
    if site in DOMAIN_FASHION:
        return ScoringDomain.FASHION
    if site in DOMAIN_HOME:
        return ScoringDomain.HOME

    # For multi-category sites (amazon, walmart, etc.) — use category/title
    cat_lower = category.lower()
    title_lower = title.lower()
    combined = f"{cat_lower} {title_lower}"

    # Hospitality keywords (rare on Amazon but possible)
    if any(kw in combined for kw in ["hotel", "airbnb", "rental", "resort", "vacation stay"]):
        return ScoringDomain.HOSPITALITY

    # Electronics
    if any(kw in combined for kw in [
        "laptop", "phone", "headphone", "earbuds", "speaker", "camera", "tablet",
        "monitor", "keyboard", "mouse", "charger", "cable", "tv", "television",
        "watch", "smartwatch", "console", "gaming", "usb", "bluetooth", "wireless",
        "computer", "printer", "router", "gpu", "cpu", "ssd", "hard drive",
    ]):
        return ScoringDomain.ELECTRONICS

    # Fashion
    if any(kw in combined for kw in [
        "shirt", "pants", "jacket", "shoes", "boots", "dress", "jeans", "sneakers",
        "socks", "underwear", "hoodie", "coat", "sweater", "clothing", "apparel",
    ]):
        return ScoringDomain.FASHION

    # Grocery / health
    if any(kw in combined for kw in [
        "snack", "cereal", "chocolate", "protein", "vitamin", "supplement",
        "organic", "granola", "coffee", "tea", "food", "grocery",
        "shampoo", "toothpaste", "deodorant", "body wash", "sunscreen",
    ]):
        return ScoringDomain.GROCERY

    # Home
    if any(kw in combined for kw in [
        "furniture", "mattress", "pillow", "bedding", "curtain", "rug",
        "lamp", "shelf", "storage", "kitchen", "cookware", "blender",
        "drill", "saw", "paint", "plumbing", "lumber",
    ]):
        return ScoringDomain.HOME

    return ScoringDomain.GENERAL


def is_hospitality(source_site: str) -> bool:
    """Quick check — used where only hospitality distinction matters."""
    return (source_site or "").lower().strip() in DOMAIN_HOSPITALITY


# ── Domain-specific configuration ────────────────────────────────

# Review volume thresholds: what counts as "a lot of reviews" per domain
VOLUME_THRESHOLDS: dict[ScoringDomain, list[tuple[int, int]]] = {
    # (min_count, score) — checked top-down, first match wins
    ScoringDomain.HOSPITALITY: [
        (500, 98), (200, 90), (100, 80), (50, 70), (20, 60), (10, 45),
    ],
    ScoringDomain.ELECTRONICS: [
        (50000, 98), (10000, 90), (5000, 80), (1000, 70), (500, 60), (100, 50),
    ],
    ScoringDomain.FASHION: [
        (10000, 98), (5000, 90), (1000, 80), (500, 70), (100, 55), (30, 40),
    ],
    ScoringDomain.GROCERY: [
        (50000, 98), (10000, 90), (5000, 80), (1000, 70), (500, 60), (100, 50),
    ],
    ScoringDomain.HOME: [
        (10000, 98), (5000, 90), (1000, 80), (500, 70), (100, 55), (30, 40),
    ],
    ScoringDomain.GENERAL: [
        (50000, 98), (10000, 90), (5000, 80), (1000, 70), (500, 60), (100, 50),
    ],
}

# Popularity thresholds (same structure)
POPULARITY_THRESHOLDS: dict[ScoringDomain, list[tuple[int, int]]] = {
    ScoringDomain.HOSPITALITY: [
        (500, 95), (200, 85), (100, 75), (50, 65), (20, 55), (10, 45),
    ],
    ScoringDomain.ELECTRONICS: [
        (50000, 95), (10000, 85), (5000, 75), (1000, 65), (100, 50),
    ],
    ScoringDomain.FASHION: [
        (10000, 95), (5000, 85), (1000, 75), (500, 65), (100, 55),
    ],
    ScoringDomain.GROCERY: [
        (50000, 95), (10000, 85), (5000, 75), (1000, 65), (100, 50),
    ],
    ScoringDomain.HOME: [
        (10000, 95), (5000, 85), (1000, 75), (500, 65), (100, 55),
    ],
    ScoringDomain.GENERAL: [
        (50000, 95), (10000, 85), (5000, 75), (1000, 65), (100, 50),
    ],
}

# Price tier ranges per domain (budget / mid / premium in USD)
PRICE_RANGES: dict[ScoringDomain, dict[str, float]] = {
    ScoringDomain.HOSPITALITY: {"budget": 60, "mid": 180, "premium": 450},
    ScoringDomain.ELECTRONICS: {"budget": 30, "mid": 150, "premium": 600},
    ScoringDomain.FASHION:     {"budget": 15, "mid": 50,  "premium": 150},
    ScoringDomain.GROCERY:     {"budget": 5,  "mid": 15,  "premium": 40},
    ScoringDomain.HOME:        {"budget": 15, "mid": 60,  "premium": 200},
    ScoringDomain.GENERAL:     {"budget": 15, "mid": 60,  "premium": 250},
}

# Domain-specific labels for the decision engine
DOMAIN_LABELS: dict[ScoringDomain, dict[str, str]] = {
    ScoringDomain.HOSPITALITY: {
        "strong_reviews": "Strong guest reviews",
        "high_volume": "Many guest reviews",
        "low_volume": "Few guest reviews",
        "suspicious_reviews": "Suspicious reviews",
        "strong_value": "Great value for the area",
        "fair_value": "Fair price for this type of stay",
        "poor_value": "Pricey for what you get",
        "trusted_seller": "Experienced, trusted host",
        "good_seller": "Good host profile",
        "unknown_seller": "Host has limited track record",
        "easy_returns": "Flexible cancellation",
        "weak_returns": "Strict cancellation policy",
        "fast_delivery": "Easy self check-in",
        "good_quality": "Well-equipped with amenities",
        "poor_quality": "Limited amenities listed",
    },
    ScoringDomain.ELECTRONICS: {
        "strong_reviews": "Strong reviews",
        "high_volume": "High review volume",
        "low_volume": "Low review count",
        "suspicious_reviews": "Suspicious reviews",
        "strong_value": "Strong value for specs",
        "fair_value": "Fair price for category",
        "poor_value": "Overpriced for specs",
        "trusted_seller": "Trusted seller",
        "good_seller": "Known retailer",
        "unknown_seller": "Unknown seller",
        "easy_returns": "Easy returns",
        "weak_returns": "Weak return policy",
        "fast_delivery": "Fast delivery",
        "good_quality": "Reputable brand",
        "poor_quality": "Unknown brand — verify specs",
    },
    ScoringDomain.FASHION: {
        "strong_reviews": "Strong reviews",
        "high_volume": "High review volume",
        "low_volume": "Low review count",
        "suspicious_reviews": "Suspicious reviews",
        "strong_value": "Good value",
        "fair_value": "Fair price",
        "poor_value": "Overpriced",
        "trusted_seller": "Trusted retailer",
        "good_seller": "Known retailer",
        "unknown_seller": "Unknown seller — check authenticity",
        "easy_returns": "Easy returns",
        "weak_returns": "Limited return policy",
        "fast_delivery": "Fast delivery",
        "good_quality": "Reputable brand",
        "poor_quality": "Unrecognized brand",
    },
}

# Default labels (used for GENERAL, GROCERY, HOME, and any missing key)
_DEFAULT_LABELS: dict[str, str] = {
    "strong_reviews": "Strong reviews",
    "high_volume": "High review volume",
    "low_volume": "Low review count",
    "suspicious_reviews": "Suspicious reviews",
    "strong_value": "Strong value",
    "fair_value": "Fair value",
    "poor_value": "Poor value for price",
    "trusted_seller": "Trusted seller",
    "good_seller": "Known seller",
    "unknown_seller": "Unknown seller",
    "easy_returns": "Easy returns",
    "weak_returns": "Weak return policy",
    "fast_delivery": "Fast delivery",
    "good_quality": "Good quality signals",
    "poor_quality": "Limited product info",
}


def get_label(domain: ScoringDomain, key: str) -> str:
    """Get domain-specific label string, falling back to defaults."""
    labels = DOMAIN_LABELS.get(domain, _DEFAULT_LABELS)
    return labels.get(key, _DEFAULT_LABELS.get(key, key))


def get_volume_score(domain: ScoringDomain, count: int) -> int:
    """Get review volume confidence score using domain-specific thresholds."""
    thresholds = VOLUME_THRESHOLDS.get(domain, VOLUME_THRESHOLDS[ScoringDomain.GENERAL])
    for min_count, score in thresholds:
        if count > min_count:
            return score
    return 25  # Very few reviews


def get_popularity_score(domain: ScoringDomain, count: int) -> int:
    """Get popularity score using domain-specific thresholds."""
    thresholds = POPULARITY_THRESHOLDS.get(domain, POPULARITY_THRESHOLDS[ScoringDomain.GENERAL])
    for min_count, score in thresholds:
        if count > min_count:
            return score
    return 30  # Very low for domain


def get_price_range(domain: ScoringDomain) -> dict[str, float]:
    """Get price tier ranges for a domain."""
    return PRICE_RANGES.get(domain, PRICE_RANGES[ScoringDomain.GENERAL])
