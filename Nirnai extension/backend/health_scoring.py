"""Health scoring engine — evaluates nutritional value and ingredient safety."""

from __future__ import annotations

import re
from models import ProductData, HealthBreakdown

# Common harmful/concerning ingredients
HARMFUL_INGREDIENTS = [
    "high fructose corn syrup", "hfcs", "partially hydrogenated",
    "trans fat", "sodium nitrite", "sodium nitrate",
    "bha", "bht", "potassium bromate",
    "artificial color", "artificial flavour", "artificial flavor",
    "red 40", "yellow 5", "yellow 6", "blue 1",
    "aspartame", "acesulfame", "sucralose",
    "monosodium glutamate", "msg",
    "carrageenan", "sodium benzoate",
    "tbhq", "propyl gallate",
]

# Ingredients suggesting high processing
HIGH_PROCESSING_MARKERS = [
    "maltodextrin", "dextrose", "modified starch",
    "emulsifier", "stabilizer", "thickener",
    "flavouring", "flavoring", "colour", "color",
    "preservative", "anti-caking", "acidity regulator",
    "humectant", "glazing agent",
]

# Categories that are food-related
FOOD_CATEGORIES = [
    "grocery", "food", "snack", "beverage", "drink",
    "chocolate", "biscuit", "cereal", "dairy", "meat",
    "fruit", "vegetable", "organic", "health", "nutrition",
    "supplement", "protein", "vitamin",
]

# Categories that are personal care
# Keywords that must match as whole words (avoid false positives like
# "conditioner" inside "air conditioner", "cream" inside "ice cream maker", etc.)
PERSONAL_CARE_WORD_MATCH = {
    "cream", "lip", "nail", "bath", "soap", "bond",
    "repair", "restore", "maintenance",
}

PERSONAL_CARE_CATEGORIES = [
    "shampoo", "skincare", "skin care",
    "hair conditioner",
    "lotion", "moisturizer", "sunscreen", "toothpaste", "deodorant",
    "cosmetic", "makeup", "hair care", "haircare", "body wash",
    "face wash", "cleanser", "serum", "beauty",
    "personal care", "hair color", "hair dye",
    "fragrance", "perfume", "cologne",
    # word-match only (listed in PERSONAL_CARE_WORD_MATCH):
    "cream", "lip", "nail", "bath", "soap", "bond",
    "repair", "restore", "maintenance",
]


def is_food_product(product: ProductData) -> bool:
    """Determine if product is food/consumable. Hospitality listings are never food."""
    # Hospitality sites never have food products
    from domain_classifier import classify_domain, ScoringDomain
    domain = classify_domain(
        getattr(product, 'source_site', ''),
        getattr(product, 'category', ''),
        getattr(product, 'title', ''),
    )
    # Only grocery/general domains can contain food in this pipeline.
    # Home/electronics items often carry spec text in `ingredients`.
    if domain in (ScoringDomain.HOSPITALITY, ScoringDomain.ELECTRONICS, ScoringDomain.HOME, ScoringDomain.FASHION):
        return False

    if domain == ScoringDomain.GROCERY:
        return True

    if product.ingredients or product.nutritionInfo:
        category_lower = product.category.lower()
        title_lower = product.title.lower()
        return any(
            kw in category_lower or kw in title_lower
            for kw in FOOD_CATEGORIES
        )

    category_lower = product.category.lower()
    title_lower = product.title.lower()

    return any(
        kw in category_lower or kw in title_lower
        for kw in FOOD_CATEGORIES
    )


def is_personal_care_product(product: ProductData) -> bool:
    """Determine if product is personal care (shampoo, skincare, cosmetics, etc.)."""
    from domain_classifier import classify_domain, ScoringDomain
    domain = classify_domain(
        getattr(product, 'source_site', ''),
        getattr(product, 'category', ''),
        getattr(product, 'title', ''),
    )
    if domain in (ScoringDomain.HOSPITALITY, ScoringDomain.ELECTRONICS, ScoringDomain.HOME, ScoringDomain.FASHION):
        return False

    category_lower = product.category.lower()
    title_lower = product.title.lower()
    combined = f"{category_lower} {title_lower}"

    for kw in PERSONAL_CARE_CATEGORIES:
        if kw in PERSONAL_CARE_WORD_MATCH:
            # Word-boundary matching avoids partial-word false positives.
            if re.search(r'\b' + re.escape(kw) + r'\b', combined):
                return True
        else:
            if kw in combined:
                return True
    return False


def score_nutrition(product: ProductData) -> int:
    """Score nutritional information (0-100)."""
    if not product.nutritionInfo:
        return 50  # Neutral when no info available

    info = product.nutritionInfo.lower()
    score = 60  # Start neutral-positive

    # Penalize high sugar
    sugar_match = re.search(r"sugar[s]?\s*:?\s*(\d+\.?\d*)\s*g", info)
    if sugar_match:
        sugar_g = float(sugar_match.group(1))
        if sugar_g > 20:
            score -= 25
        elif sugar_g > 12:
            score -= 15
        elif sugar_g < 5:
            score += 10

    # Penalize high sodium
    sodium_match = re.search(r"sodium\s*:?\s*(\d+\.?\d*)\s*mg", info)
    if sodium_match:
        sodium_mg = float(sodium_match.group(1))
        if sodium_mg > 600:
            score -= 20
        elif sodium_mg > 400:
            score -= 10
        elif sodium_mg < 140:
            score += 10

    # Penalize high saturated fat
    sat_fat_match = re.search(
        r"saturated\s*fat\s*:?\s*(\d+\.?\d*)\s*g", info
    )
    if sat_fat_match:
        sat_fat_g = float(sat_fat_match.group(1))
        if sat_fat_g > 10:
            score -= 20
        elif sat_fat_g > 5:
            score -= 10

    # Bonus for protein
    protein_match = re.search(r"protein\s*:?\s*(\d+\.?\d*)\s*g", info)
    if protein_match:
        protein_g = float(protein_match.group(1))
        if protein_g > 10:
            score += 15
        elif protein_g > 5:
            score += 8

    # Bonus for fiber
    fiber_match = re.search(r"fibre?\s*:?\s*(\d+\.?\d*)\s*g", info)
    if fiber_match:
        fiber_g = float(fiber_match.group(1))
        if fiber_g > 5:
            score += 10

    return max(0, min(100, score))


def score_ingredients(product: ProductData) -> int:
    """Score ingredient safety (0-100)."""
    if not product.ingredients:
        return 50  # Neutral when no info

    ingredients_lower = product.ingredients.lower()
    score = 80  # Start positive

    # Check for harmful ingredients
    harmful_found = 0
    for ingredient in HARMFUL_INGREDIENTS:
        if ingredient in ingredients_lower:
            harmful_found += 1

    if harmful_found >= 4:
        score -= 40
    elif harmful_found >= 2:
        score -= 25
    elif harmful_found >= 1:
        score -= 15

    # Count total ingredients (more = more processed)
    # Rough heuristic: split by comma
    ingredient_count = len(
        [i.strip() for i in product.ingredients.split(",") if i.strip()]
    )
    if ingredient_count > 20:
        score -= 15
    elif ingredient_count > 15:
        score -= 10
    elif ingredient_count < 5:
        score += 10

    return max(0, min(100, score))


def score_processing(product: ProductData) -> int:
    """Score processing level (0-100, higher = less processed = better)."""
    if not product.ingredients:
        return 50

    ingredients_lower = product.ingredients.lower()
    score = 70

    processing_markers_found = 0
    for marker in HIGH_PROCESSING_MARKERS:
        if marker in ingredients_lower:
            processing_markers_found += 1

    if processing_markers_found >= 5:
        score -= 35
    elif processing_markers_found >= 3:
        score -= 20
    elif processing_markers_found >= 1:
        score -= 10

    # Check title for organic/natural indicators
    title_lower = product.title.lower()
    if "organic" in title_lower:
        score += 15
    if "natural" in title_lower:
        score += 5
    if "no preservative" in title_lower or "preservative free" in title_lower:
        score += 10

    return max(0, min(100, score))


def calculate_health_score(
    product: ProductData,
) -> tuple[int, HealthBreakdown]:
    """
    Calculate weighted health score.
    Food: Nutrition 50%, Ingredients 30%, Processing 20%
    Personal care: Ingredients 60%, Processing 25%, Nutrition 15% (as safety proxy)
    Returns 0 for non-food AND non-personal-care products.
    """
    if is_food_product(product):
        # Food: nutrition-heavy weights
        breakdown = HealthBreakdown(
            nutrition=score_nutrition(product),
            ingredients=score_ingredients(product),
            processing=score_processing(product),
        )

        total = (
            breakdown.nutrition * 0.50
            + breakdown.ingredients * 0.30
            + breakdown.processing * 0.20
        )

        return int(total), breakdown

    if is_personal_care_product(product):
        # Personal care: ingredient safety is the primary concern
        breakdown = HealthBreakdown(
            nutrition=50,  # neutral — not relevant for personal care
            ingredients=score_ingredients(product),
            processing=score_processing(product),
        )
        # For personal care without ingredient data, give a premium brand benefit
        title_lower = product.title.lower()
        brand_lower = (product.brand or "").lower()
        premium_brands = [
            "oribe", "kerastase", "kérastase", "olaplex", "moroccanoil",
            "bumble and bumble", "aveda", "redken", "pureology", "living proof",
            "ouai", "briogeo", "drunk elephant", "la mer", "sk-ii",
            "estee lauder", "clinique", "sunday riley", "tatcha", "fresh",
        ]
        is_premium = any(b in title_lower or b in brand_lower for b in premium_brands)
        if is_premium and not product.ingredients:
            # Premium brands known for ingredient quality
            breakdown.ingredients = 82
            breakdown.processing = 75

        total = (
            breakdown.ingredients * 0.60
            + breakdown.processing * 0.25
            + breakdown.nutrition * 0.15
        )
        return int(total), breakdown

    # Not food, not personal care
    return 0, HealthBreakdown()
