"""NirnAI Backend — FastAPI server for product analysis."""

from __future__ import annotations

import re
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ProductData,
    AnalysisResponse,
    HealthExtractionRequest,
    HealthExtractionResponse,
    NormalizedNutrition,
    CartAnalysisResponse,
    CartItemResult,
    CartSummary,
    AlternativeSuggestion,
)
from typing import List, Optional
from pydantic import BaseModel
from purchase_scoring import calculate_purchase_score, detect_risk_flags
from health_scoring import calculate_health_score, is_food_product
from decision_engine import generate_stamp, compute_confidence
from ai_service import get_ai_summary, get_alternative_suggestion, _generate_fallback_summary

app = FastAPI(
    title="NirnAI API",
    description="Clear decisions. Every purchase. — Product Analysis API",
    version="3.0.0",
)

# CORS — allow Chrome extension origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

# Mount WhatsApp bot (additive — no changes to existing routes)
from whatsapp_bot import router as whatsapp_router
app.include_router(whatsapp_router)


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_product(product: ProductData) -> AnalysisResponse:
    """Analyze a product and return scores, stamp, reasons, and decision."""

    # Calculate scores (purchase scoring now returns ReviewTrust too)
    purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
    health_score, health_breakdown = calculate_health_score(product)

    food = is_food_product(product)
    risk_flags = detect_risk_flags(product, review_trust)

    # Generate decision stamp + reasons/warnings/positives
    stamp, legacy_decision, reasons, warnings, positives = generate_stamp(
        purchase_score=purchase_score,
        health_score=health_score,
        is_food=food,
        purchase_breakdown=purchase_breakdown,
        health_breakdown=health_breakdown,
        review_trust=review_trust,
        risk_flags=risk_flags,
    )

    # Compute confidence
    confidence = compute_confidence(product, review_trust, purchase_score)

    # Get AI summary and alternative suggestion in parallel (with 20s timeout)
    import asyncio
    try:
        summary, suggestion = await asyncio.wait_for(
            asyncio.gather(
                get_ai_summary(product, purchase_score, health_score, legacy_decision),
                get_alternative_suggestion(product, purchase_score, health_score, legacy_decision, warnings),
            ),
            timeout=20.0,
        )
    except asyncio.TimeoutError:
        summary = _generate_fallback_summary(product, purchase_score, health_score, legacy_decision)
        suggestion = None

    return AnalysisResponse(
        purchase_score=purchase_score,
        health_score=health_score,
        decision=legacy_decision,
        stamp=stamp,
        purchase_breakdown=purchase_breakdown,
        health_breakdown=health_breakdown,
        review_trust=review_trust,
        reasons=reasons,
        warnings=warnings,
        positives=positives,
        confidence=confidence,
        summary=summary,
        suggestion=suggestion,
    )


class AiEnhancement(BaseModel):
    summary: str = ""
    suggestion: Optional[AlternativeSuggestion] = None


@app.post("/analyze/fast", response_model=AnalysisResponse)
async def analyze_product_fast(product: ProductData) -> AnalysisResponse:
    """Fast scoring — rule-based only, no AI calls. Returns in <500ms."""

    purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
    health_score, health_breakdown = calculate_health_score(product)

    food = is_food_product(product)
    risk_flags = detect_risk_flags(product, review_trust)

    stamp, legacy_decision, reasons, warnings, positives = generate_stamp(
        purchase_score=purchase_score,
        health_score=health_score,
        is_food=food,
        purchase_breakdown=purchase_breakdown,
        health_breakdown=health_breakdown,
        review_trust=review_trust,
        risk_flags=risk_flags,
    )

    confidence = compute_confidence(product, review_trust, purchase_score)

    return AnalysisResponse(
        purchase_score=purchase_score,
        health_score=health_score,
        decision=legacy_decision,
        stamp=stamp,
        purchase_breakdown=purchase_breakdown,
        health_breakdown=health_breakdown,
        review_trust=review_trust,
        reasons=reasons,
        warnings=warnings,
        positives=positives,
        confidence=confidence,
        summary="",
        suggestion=None,
    )


@app.post("/analyze/ai", response_model=AiEnhancement)
async def analyze_product_ai(product: ProductData) -> AiEnhancement:
    """AI enhancement — returns summary + alternative suggestion. Slow (~10-15s)."""
    import asyncio

    purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
    health_score, health_breakdown = calculate_health_score(product)
    food = is_food_product(product)
    risk_flags = detect_risk_flags(product, review_trust)
    _, legacy_decision, _, warnings, _ = generate_stamp(
        purchase_score=purchase_score,
        health_score=health_score,
        is_food=food,
        purchase_breakdown=purchase_breakdown,
        health_breakdown=health_breakdown,
        review_trust=review_trust,
        risk_flags=risk_flags,
    )

    try:
        summary, suggestion = await asyncio.wait_for(
            asyncio.gather(
                get_ai_summary(product, purchase_score, health_score, legacy_decision),
                get_alternative_suggestion(product, purchase_score, health_score, legacy_decision, warnings),
            ),
            timeout=20.0,
        )
    except asyncio.TimeoutError:
        summary = _generate_fallback_summary(product, purchase_score, health_score, legacy_decision)
        suggestion = None

    return AiEnhancement(summary=summary or "", suggestion=suggestion)


@app.post("/analyze-cart", response_model=CartAnalysisResponse)
async def analyze_cart(products: List[ProductData]) -> CartAnalysisResponse:
    """Analyze all items in a shopping cart and return per-item + aggregate results."""
    import asyncio

    async def analyze_one(product: ProductData) -> CartItemResult:
        purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
        health_score, health_breakdown = calculate_health_score(product)
        food = is_food_product(product)
        risk_flags = detect_risk_flags(product, review_trust)
        stamp, legacy_decision, reasons, warnings, positives = generate_stamp(
            purchase_score=purchase_score,
            health_score=health_score,
            is_food=food,
            purchase_breakdown=purchase_breakdown,
            health_breakdown=health_breakdown,
            review_trust=review_trust,
            risk_flags=risk_flags,
        )
        suggestion = await get_alternative_suggestion(
            product, purchase_score, health_score, legacy_decision, warnings
        )
        return CartItemResult(
            title=product.title,
            price=product.price,
            image_url=product.imageUrl,
            url=product.url,
            purchase_score=purchase_score,
            health_score=health_score,
            decision=legacy_decision,
            stamp=stamp,
            warnings=warnings,
            positives=positives,
            suggestion=suggestion,
        )

    # Analyze all items in parallel
    items = await asyncio.gather(*[analyze_one(p) for p in products])
    items = list(items)

    # Compute aggregate stats
    total = len(items)
    avoid_count = sum(1 for i in items if i.stamp.stamp == "AVOID")
    smart_count = sum(1 for i in items if i.stamp.stamp == "SMART_BUY")
    check_count = sum(1 for i in items if i.stamp.stamp == "CHECK")
    avg_purchase = round(sum(i.purchase_score for i in items) / total) if total else 0
    health_items = [i for i in items if i.health_score > 0]
    avg_health = round(sum(i.health_score for i in health_items) / len(health_items)) if health_items else 0

    # Parse total cost
    total_cost = 0.0
    currency_symbol = "$"
    for item in items:
        price_str = item.price.replace(",", "")
        if "\u20b9" in price_str:
            currency_symbol = "\u20b9"
        m = re.search(r"([\d]+\.?\d*)", price_str)
        if m:
            total_cost += float(m.group(1))
    estimated_total = f"{currency_symbol}{total_cost:,.2f}" if total_cost > 0 else ""

    # Overall verdict
    if avoid_count > total / 2:
        overall_verdict = "AVOID"
        overall_icon = "\U0001f534"
    elif smart_count > total / 2:
        overall_verdict = "SMART_BUY"
        overall_icon = "\U0001f7e2"
    else:
        overall_verdict = "CHECK"
        overall_icon = "\U0001f7e1"

    # Collect top warnings from AVOID items
    top_warnings = []
    for item in items:
        if item.stamp.stamp == "AVOID" and item.warnings:
            top_warnings.append(f"{item.title[:40]}: {item.warnings[0]}")
    top_warnings = top_warnings[:5]

    # Generate AI cart summary
    ai_summary = await _generate_cart_summary(items, avg_purchase, avg_health, overall_verdict)

    summary = CartSummary(
        total_items=total,
        estimated_total=estimated_total,
        avg_purchase_score=avg_purchase,
        avg_health_score=avg_health,
        items_to_avoid=avoid_count,
        items_smart_buy=smart_count,
        items_check=check_count,
        overall_verdict=overall_verdict,
        overall_icon=overall_icon,
        ai_summary=ai_summary,
        top_warnings=top_warnings,
    )

    return CartAnalysisResponse(summary=summary, items=items)


async def _generate_cart_summary(
    items: list, avg_purchase: int, avg_health: int, verdict: str
) -> str:
    """Use AI to generate a brief cart overview."""
    try:
        from ai_service import client
        item_lines = []
        for item in items:
            line = f"- {item.title[:50]} | {item.stamp.stamp} | Purchase:{item.purchase_score}"
            if item.health_score > 0:
                line += f" Health:{item.health_score}"
            if item.warnings:
                line += f" ⚠ {item.warnings[0]}"
            item_lines.append(line)

        prompt = (
            f"You are NirnAI, a shopping advisor. Summarize this shopping cart in 2-3 sentences.\n"
            f"Overall verdict: {verdict}, Avg purchase score: {avg_purchase}/100"
            + (f", Avg health score: {avg_health}/100" if avg_health > 0 else "") + "\n\n"
            f"Cart items:\n" + "\n".join(item_lines) + "\n\n"
            f"Focus on: items to reconsider, overall value, and one key recommendation."
        )

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
            temperature=0.4,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return ""


@app.post("/extract-health", response_model=HealthExtractionResponse)
async def extract_health(req: HealthExtractionRequest) -> HealthExtractionResponse:
    """Separate endpoint for health data extraction and normalization."""
    # Build a minimal ProductData for the health scorer
    product = ProductData(
        title=req.title,
        ingredients=req.ingredients_text,
        nutritionInfo=req.nutrition_text,
        barcode=req.barcode,
    )

    health_score, health_breakdown = calculate_health_score(product)
    nutrition = _parse_nutrition(req.nutrition_text)
    flags = _detect_ingredient_flags(req.ingredients_text)

    return HealthExtractionResponse(
        normalized_nutrition=nutrition,
        ingredient_flags=flags,
        health_score=health_score,
        health_breakdown=health_breakdown,
    )


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "NirnAI API", "version": "3.0.0"}


# ── Helpers for /extract-health ──────────────────────────────────────────────

def _parse_nutrition(text: str) -> NormalizedNutrition:
    """Extract structured nutrition values from raw text."""
    if not text:
        return NormalizedNutrition()

    t = text.lower()

    def _find(pattern: str) -> float | None:
        m = re.search(pattern, t)
        return float(m.group(1)) if m else None

    return NormalizedNutrition(
        calories=_find(r"calories?\s*:?\s*(\d+\.?\d*)"),
        fat_g=_find(r"(?:total\s*)?fat\s*:?\s*(\d+\.?\d*)\s*g"),
        saturated_fat_g=_find(r"saturated\s*fat\s*:?\s*(\d+\.?\d*)\s*g"),
        sodium_mg=_find(r"sodium\s*:?\s*(\d+\.?\d*)\s*mg"),
        sugar_g=_find(r"sugar[s]?\s*:?\s*(\d+\.?\d*)\s*g"),
        protein_g=_find(r"protein\s*:?\s*(\d+\.?\d*)\s*g"),
        fiber_g=_find(r"fibre?\s*:?\s*(\d+\.?\d*)\s*g"),
    )


INGREDIENT_FLAG_MAP = {
    "high fructose corn syrup": "added_sugar",
    "partially hydrogenated": "trans_fat",
    "palm oil": "processed_oil",
    "artificial color": "artificial_additive",
    "artificial flavour": "artificial_additive",
    "artificial flavor": "artificial_additive",
    "sodium nitrite": "preservative",
    "sodium nitrate": "preservative",
    "bha": "preservative",
    "bht": "preservative",
    "red 40": "artificial_color",
    "yellow 5": "artificial_color",
    "maltodextrin": "ultra_processed",
    "modified starch": "ultra_processed",
    "aspartame": "artificial_sweetener",
    "sucralose": "artificial_sweetener",
    "msg": "flavor_enhancer",
    "monosodium glutamate": "flavor_enhancer",
}


def _detect_ingredient_flags(text: str) -> list[str]:
    """Detect ingredient red flags."""
    if not text:
        return []
    t = text.lower()
    flags = set()
    for keyword, flag in INGREDIENT_FLAG_MAP.items():
        if keyword in t:
            flags.add(flag)
    return sorted(flags)
