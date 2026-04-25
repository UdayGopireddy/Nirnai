"""Test the Trusted Advisor gate system — does NirnAI decide like a human expert?

Each scenario represents a real product archetype. The expected label is what
a trusted friend/expert would say if you showed them this product.
"""

from models import ProductData
from purchase_scoring import calculate_purchase_score
from health_scoring import calculate_health_score, is_food_product
from decision_engine import generate_stamp, compute_confidence

from typing import Optional


PASS = 0
FAIL = 0


def test(name: str, product: ProductData, expected_label: str, should_warn: Optional[str] = None):
    global PASS, FAIL
    purchase_score, breakdown, review_trust = calculate_purchase_score(product)
    health_score, health_breakdown = calculate_health_score(product)
    food = is_food_product(product)

    from purchase_scoring import detect_risk_flags
    risks = detect_risk_flags(product, review_trust)

    stamp, legacy, reasons, warnings, positives = generate_stamp(
        purchase_score, health_score, food, breakdown, health_breakdown,
        review_trust, risk_flags=risks, product=product,
    )

    status = "✅" if stamp.label == expected_label else "❌"
    if status == "✅":
        PASS += 1
    else:
        FAIL += 1

    print(f"{status} {name}")
    print(f"   Score: {purchase_score} | Trust: {review_trust.trust_score} | Label: {stamp.label} (expected: {expected_label})")
    if warnings:
        print(f"   Warnings: {warnings[:3]}")
    if positives:
        print(f"   Positives: {positives[:3]}")
    if should_warn and not any(should_warn.lower() in w.lower() for w in warnings):
        print(f"   ⚠️  Expected warning containing '{should_warn}' not found!")
    print()


# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 1: THE CLEAR BUY — trusted advisor says "absolutely"
#  Well-known brand, great reviews, trusted seller, fair price
# ═══════════════════════════════════════════════════════════════════
test(
    "BEST PICK — Samsung earbuds, great reviews, Amazon seller",
    ProductData(
        title="Samsung Galaxy Buds2 Pro",
        price="$149.99",
        rating="4.5 out of 5 stars",
        reviewCount="12,847 ratings",
        seller="Amazon.com",
        brand="Samsung",
        delivery="Free Prime delivery tomorrow",
        returnPolicy="30-day return",
        category="Electronics",
        url="https://www.amazon.com/dp/B09",
        source_site="amazon",
    ),
    expected_label="BEST PICK",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 2: THE BEST PICK — top-tier product
# ═══════════════════════════════════════════════════════════════════
test(
    "BEST PICK — Anker charger, massive reviews, great price",
    ProductData(
        title="Anker PowerPort III Nano 20W USB-C Charger",
        price="$15.99 $19.99",
        rating="4.7 out of 5 stars",
        reviewCount="85,432 ratings",
        seller="AnkerDirect",
        brand="Anker",
        delivery="Free Prime delivery",
        returnPolicy="30-day return",
        category="Electronics",
        url="https://www.amazon.com/dp/B08",
        source_site="amazon",
    ),
    expected_label="BEST PICK",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 3: SCORE 50, BAD TRUST — old system said "BUY", human says "no"
#  This is THE scenario that was broken. Score ~50 but suspicious reviews.
# ═══════════════════════════════════════════════════════════════════
test(
    "CAUTION — Score ~50 with suspicious reviews (old bug: was 'BUY')",
    ProductData(
        title="Generic Wireless Earbuds TWS",
        price="$12.99",
        rating="4.9 out of 5 stars",
        reviewCount="37 ratings",
        seller="",
        brand="",
        delivery="Ships in 2-3 weeks",
        returnPolicy="",
        category="Electronics",
        url="https://www.amazon.com/dp/B0X",
        source_site="amazon",
    ),
    expected_label="CAUTION",
    should_warn="suspiciously",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 4: NO REVIEWS AT ALL — completely unproven
#  Human says: "Nobody has tried this, I can't recommend it"
# ═══════════════════════════════════════════════════════════════════
test(
    "CAUTION — No reviews, unknown brand, unknown seller",
    ProductData(
        title="SuperMax Ultra Blender 3000",
        price="$45.00",
        rating="",
        reviewCount="",
        seller="SuperMax Store",
        brand="SuperMax",
        delivery="Free delivery",
        returnPolicy="No returns",
        category="Kitchen",
        url="https://www.amazon.com/dp/B0Y",
        source_site="amazon",
    ),
    expected_label="CAUTION",
    should_warn="no reviews",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 5: BAD RATING WITH VOLUME — people tried it and hate it
#  Human says: "Don't buy this, buyers say it's bad"
# ═══════════════════════════════════════════════════════════════════
test(
    "SKIP — Bad rating (2.1) with high volume, people hate it",
    ProductData(
        title="CheapPhone X100 Smartphone",
        price="$89.00",
        rating="2.1 out of 5 stars",
        reviewCount="3,420 ratings",
        seller="CheapPhone Official",
        brand="CheapPhone",
        delivery="Free delivery",
        returnPolicy="15-day return",
        category="Electronics",
        url="https://www.amazon.com/dp/B0Z",
        source_site="amazon",
    ),
    expected_label="SKIP",
    should_warn="poor rating",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 6: PREMIUM BRAND, SHADY SELLER — counterfeit risk
#  Human says: "Be careful, this could be fake"
# ═══════════════════════════════════════════════════════════════════
test(
    "CONSIDER — Nike shoes from unknown seller (counterfeit risk)",
    ProductData(
        title="Nike Air Max 270 Men's Shoes",
        price="$89.99",
        rating="4.3 out of 5 stars",
        reviewCount="245 ratings",
        seller="FastShip Global Trading",
        brand="Nike",
        delivery="Ships in 5-7 days",
        returnPolicy="30-day return",
        category="Shoes",
        url="https://www.amazon.com/dp/B0A",
        source_site="amazon",
    ),
    expected_label="CONSIDER",
    should_warn="unverified seller",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 7: FOOD WITH BAD HEALTH SCORE — bad ingredients
#  Human says: "Don't eat this, look at those ingredients"
# ═══════════════════════════════════════════════════════════════════
test(
    "CAUTION — Food with harmful ingredients (health gate)",
    ProductData(
        title="Mega Energy Drink Sugar Blast",
        price="$2.99",
        rating="4.4 out of 5 stars",
        reviewCount="5,600 ratings",
        seller="Amazon.com",
        brand="Mega",
        ingredients="High fructose corn syrup, artificial colors (Red 40, Yellow 5), sodium benzoate, caffeine, taurine",
        nutritionInfo="Calories 280, Total Sugars 65g, Sodium 200mg, Caffeine 300mg",
        delivery="Free Prime delivery",
        returnPolicy="30-day return",
        category="Grocery",
        url="https://www.amazon.com/dp/B0B",
        source_site="amazon",
    ),
    expected_label="CAUTION",
    should_warn="health",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 8: HEALTHY FOOD, GREAT PRODUCT — advisor says buy
# ═══════════════════════════════════════════════════════════════════
test(
    "BUY — Healthy protein bar, great reviews, trusted seller",
    ProductData(
        title="RXBAR Protein Bar Chocolate Sea Salt",
        price="$24.99",
        rating="4.5 out of 5 stars",
        reviewCount="28,000 ratings",
        seller="Amazon.com",
        brand="RXBAR",
        ingredients="egg whites, dates, cashews, almonds, chocolate, cocoa, sea salt, natural flavors",
        nutritionInfo="Calories 210, Protein 12g, Total Fat 9g, Total Sugars 13g, Fiber 5g",
        delivery="Free Prime delivery",
        returnPolicy="30-day return",
        category="Grocery",
        url="https://www.amazon.com/dp/B0C",
        source_site="amazon",
    ),
    expected_label="BUY",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 9: SKINCARE — personal care with ingredient check
# ═══════════════════════════════════════════════════════════════════
test(
    "BEST PICK — CeraVe moisturizer, 142K reviews, clean ingredients",
    ProductData(
        title="CeraVe Moisturizing Cream for Normal to Dry Skin",
        price="$16.99",
        rating="4.7 out of 5 stars",
        reviewCount="142,000 ratings",
        seller="Amazon.com",
        brand="CeraVe",
        ingredients="ceramides, hyaluronic acid, glycerin, petrolatum, dimethicone",
        nutritionInfo="",
        delivery="Free Prime delivery",
        returnPolicy="30-day return",
        category="Beauty",
        url="https://www.amazon.com/dp/B0D",
        source_site="amazon",
    ),
    expected_label="BEST PICK",
)

# ═══════════════════════════════════════════════════════════════════
#  SCENARIO 10: MEDIOCRE PRODUCT — decent but not endorsable
#  Human says: "It's OK, but I'd look around more"
# ═══════════════════════════════════════════════════════════════════
test(
    "CONSIDER — Average product, nothing special, nothing terrible",
    ProductData(
        title="BasicHome 3-Pack Kitchen Towels",
        price="$8.99",
        rating="3.8 out of 5 stars",
        reviewCount="320 ratings",
        seller="BasicHome Store",
        brand="BasicHome",
        delivery="Free delivery in 3 days",
        returnPolicy="15-day return",
        category="Home",
        url="https://www.amazon.com/dp/B0E",
        source_site="amazon",
    ),
    expected_label="CONSIDER",
)

# ═══════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════
print("=" * 60)
print(f"RESULTS: {PASS} passed, {FAIL} failed out of {PASS + FAIL}")
if FAIL == 0:
    print("🎉 All scenarios match expert human judgment!")
else:
    print("⚠️  Some scenarios need tuning.")
print("=" * 60)
