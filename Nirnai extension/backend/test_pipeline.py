"""Quick test of the full scoring pipeline."""

from models import ProductData
from purchase_scoring import calculate_purchase_score
from health_scoring import calculate_health_score, is_food_product
from decision_engine import generate_stamp, compute_confidence

product = ProductData(
    title="Protein Bar Chocolate",
    price="₹299",
    rating="4.3 out of 5 stars",
    reviewCount="1,842 ratings",
    seller="Cloudtail India",
    ingredients="Peanuts, whey protein, chicory root fiber, sugar, palm oil",
    nutritionInfo="Calories 220, Total Fat 9g, Sodium 180mg, Total Sugars 12g, Protein 20g",
    returnPolicy="30-day return",
    delivery="Free delivery tomorrow",
    category="Grocery",
    url="https://www.amazon.in/dp/B123",
    source_site="amazon",
)

purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
health_score, health_breakdown = calculate_health_score(product)
food = is_food_product(product)
stamp, legacy, reasons, warnings, positives = generate_stamp(
    purchase_score, health_score, food, purchase_breakdown, health_breakdown, review_trust
)
confidence = compute_confidence(product, review_trust, purchase_score)

print(f"Purchase Score: {purchase_score}")
print(f"Health Score: {health_score}")
print(f"Review Trust: {review_trust.trust_score}")
print(f"  - Rating: {review_trust.rating_strength}")
print(f"  - Volume: {review_trust.volume_confidence}")
print(f"  - Distribution: {review_trust.distribution_quality}")
print(f"  - Authenticity: {review_trust.authenticity}")
print(f"Decision: {legacy}")
print(f"Stamp: {stamp.icon} {stamp.label}")
print(f"Reasons: {' • '.join(stamp.reasons)}")
print(f"Purchase Signal: {stamp.purchase_signal}")
print(f"Health Signal: {stamp.health_signal}")
print(f"Warnings: {warnings}")
print(f"Positives: {positives}")
print(f"Confidence: {confidence}")
