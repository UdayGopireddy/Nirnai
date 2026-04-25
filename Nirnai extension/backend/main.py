"""NirnAI Backend — FastAPI server for product analysis."""

from __future__ import annotations

import re
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from models import (
    ProductData,
    AnalysisResponse,
    DecisionStamp,
    HealthExtractionRequest,
    HealthExtractionResponse,
    NormalizedNutrition,
    CartAnalysisResponse,
    CartItemResult,
    CartSummary,
    AlternativeSuggestion,
    BatchResponse,
    BatchRankRequest,
    RecheckRequest,
    RecheckResponse,
)
from typing import List, Optional
from pydantic import BaseModel
from purchase_scoring import calculate_purchase_score, detect_risk_flags
from health_scoring import calculate_health_score, is_food_product, is_personal_care_product
from decision_engine import generate_stamp, compute_confidence
from ai_service import get_ai_summary, get_alternative_suggestion, _generate_fallback_summary
from domain_classifier import classify_domain

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


@app.get("/", response_class=HTMLResponse)
async def homepage() -> str:
        """Simple landing page for browser visits to the API domain."""
        return """
<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>NirnAI API</title>
        <style>
            :root { color-scheme: light dark; }
            body {
                margin: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: #0b1020;
                color: #e2e8f0;
                display: grid;
                place-items: center;
                min-height: 100vh;
            }
            .card {
                width: min(720px, 92vw);
                background: rgba(15, 23, 42, 0.85);
                border: 1px solid #334155;
                border-radius: 16px;
                padding: 28px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
            }
            h1 { margin: 0 0 8px; font-size: 28px; color: #93c5fd; }
            p { margin: 0 0 14px; line-height: 1.5; color: #cbd5e1; }
            a { color: #60a5fa; text-decoration: none; }
            a:hover { text-decoration: underline; }
            code { color: #f8fafc; background: #1e293b; padding: 2px 6px; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>NirnAI API is running</h1>
            <p>This domain serves NirnAI backend endpoints used by the extension and web clients.</p>
            <p>Try <a href="/docs">/docs</a> for interactive API docs, or check health at <code>/healthz</code>.</p>
        </div>
    </body>
</html>
        """


@app.get("/healthz")
async def healthz() -> dict[str, str]:
        """Lightweight health endpoint for uptime checks."""
        return {"status": "ok"}


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
        product=product,
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

    # Write-back to product cache so a later /products/recheck has a baseline
    # price + score to compare against. Fail-soft: cache outage must not
    # break the analyze response.
    try:
        from product_cache import get_default_cache as _get_cache
        _cache = _get_cache()
        _rec, _hit = _cache.remember_product(product.model_dump())
        _cache.record_score(
            _rec.product_id,
            purchase_score,
            health_score,
            extras={
                "last_price": product.price or "",
                "last_currency": product.currency or "",
            },
        )
    except Exception as _e:  # noqa: BLE001
        import logging as _log
        _log.getLogger("analyze").debug("cache write skipped: %s", _e)

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
        domain=classify_domain(product.source_site, product.category, product.title).value,
    )


@app.post("/products/recheck", response_model=RecheckResponse)
async def products_recheck(req: RecheckRequest) -> RecheckResponse:
    """Pre-checkout sanity check. Called by the extension just before a
    SMART_BUY click goes through. We compare the price the user is currently
    looking at against the last cached price for this canonical product. If
    drift exceeds ``threshold_pct``, we surface a warning so the user has a
    chance to re-evaluate before getting redirected via affiliate.

    This endpoint is fail-open: any internal error returns ``warn_level=
    "unknown"`` and lets the click proceed. We never block a sale on a bug.
    """
    import logging as _log
    from canonical_id import canonicalize_product
    from product_cache import compute_recheck, get_default_cache

    _logger = _log.getLogger("products_recheck")
    canonical = canonicalize_product(req.product.model_dump())

    try:
        cache = get_default_cache()
        record = cache.get(canonical.product_id)
        result = compute_recheck(
            record,
            req.shown_price or req.product.price,
            threshold_pct=req.threshold_pct,
        )
    except Exception as e:  # noqa: BLE001 - fail open
        _logger.warning("recheck failed for %s: %s", canonical.product_id, e)
        return RecheckResponse(
            product_id=canonical.product_id,
            stable=True,
            warn_level="unknown",
            message="Recheck unavailable.",
        )

    return RecheckResponse(
        product_id=canonical.product_id,
        stable=result.stable,
        warn_level=result.warn_level,
        message=result.message,
        last_price=result.last_price,
        last_currency=result.last_currency,
        drift_pct=result.drift_pct,
        scored_secs_ago=result.scored_secs_ago,
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
        product=product,
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
        domain=classify_domain(product.source_site, product.category, product.title).value,
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
        product=product,
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
            product=product,
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


def _repair_json(raw: str) -> str:
    """Fix common LLM JSON issues: trailing commas, single quotes, unquoted keys."""
    import re as _re
    # Remove trailing commas before } or ]
    fixed = _re.sub(r',\s*([}\]])', r'\1', raw)
    return fixed


@app.post("/compare/rank", response_model=BatchResponse)
async def compare_rank(req: BatchRankRequest) -> BatchResponse:
    """Batch ranking via OpenAI — called by Rust gateway's compare flow."""
    import json as _json
    import logging
    from openai import AsyncOpenAI
    from ai_service import MODEL as openai_model

    logger = logging.getLogger("compare_rank")

    # ── Pre-score listings with rule-based engine ──
    # Give GPT our deterministic scores so it ranks informed, not blind.
    # Compute batch median price so value scoring uses relative pricing.
    # Keep this FAST — App Runner has 120s request timeout.
    batch_median_price: float | None = None
    pre_score_lines = []
    if req.listings:
        from hospitality_scorer import _parse_price
        import statistics as _stats

        prices = []
        for l in req.listings:
            p = _parse_price(l.price)
            if p and p > 0:
                prices.append(p)
        if len(prices) >= 2:
            batch_median_price = _stats.median(prices)
            logger.info("Batch median price: %.0f (from %d listings)", batch_median_price, len(prices))

        # Quick pre-score: run scoring synchronously but catch/skip failures
        from purchase_scoring import calculate_purchase_score as _pre_calc
        scored: list[tuple[str, int]] = []
        for listing in req.listings:
            try:
                score, breakdown, trust = _pre_calc(listing, mid_price_override=batch_median_price)
                scored.append((listing.title[:60], score))
            except Exception:
                pass

        if scored:
            pre_score_lines.append(
                "\n\nNirnAI SCORES (use as primary ranking signal — "
                "factors in reviews, value, trust, data quality):"
            )
            for title, sc in scored:
                pre_score_lines.append(f"  {title}: {sc}/100")
            pre_score_lines.append("")

    enriched_prompt = req.user_prompt + "\n".join(pre_score_lines)

    # Use a dedicated client with timeout that fits within App Runner's 120s limit
    rank_client = AsyncOpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
        timeout=90.0,
        max_retries=1,
    )

    try:
        response = await rank_client.chat.completions.create(
            model=openai_model,
            messages=[
                {"role": "system", "content": req.system_prompt},
                {"role": "user", "content": enriched_prompt},
            ],
            max_tokens=8000,
            temperature=0.3,
        )
    except Exception as e:
        logger.error("OpenAI API call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"OpenAI API error: {e}")

    raw = (response.choices[0].message.content or "").strip()
    finish_reason = response.choices[0].finish_reason

    if finish_reason == "length":
        logger.warning("OpenAI response truncated (finish_reason=length), %d chars", len(raw))

    # Strip markdown fences if present
    if raw.startswith("```json"):
        raw = raw[7:]
    if raw.startswith("```"):
        raw = raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    # If truncated, try to repair JSON by closing open structures
    if finish_reason == "length" and raw:
        # Find last complete object in the ranked array
        last_brace = raw.rfind("}")
        if last_brace > 0:
            # Try progressively trimming to find valid JSON
            for end in [len(raw), last_brace + 1]:
                attempt = _repair_json(raw[:end])
                # Count open brackets/braces and close them
                open_brackets = attempt.count("[") - attempt.count("]")
                open_braces = attempt.count("{") - attempt.count("}")
                repaired = attempt + "}" * open_braces + "]" * open_brackets + "}"
                try:
                    data = _json.loads(repaired)
                    logger.info("Repaired truncated JSON (trimmed to %d chars)", end)
                    return BatchResponse(**data)
                except (ValueError, Exception):
                    continue

    # First try raw, then try with repair
    try:
        data = _json.loads(raw)
    except _json.JSONDecodeError:
        repaired = _repair_json(raw)
        try:
            data = _json.loads(repaired)
            logger.info("Repaired malformed JSON (trailing commas etc)")
        except _json.JSONDecodeError as e:
            logger.error("JSON parse failed after repair: %s | raw (first 500): %s", e, raw[:500])
            raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        batch = BatchResponse(**data)
    except Exception as e:
        logger.error("BatchResponse validation failed: %s | keys: %s", e, list(data.keys()) if isinstance(data, dict) else type(data))
        raise HTTPException(status_code=502, detail=f"Response schema mismatch: {e}")

    # ── Re-score with deterministic Python engine ──
    # GPT assigns arbitrary purchase_score / review_trust based on rank position.
    # Replace them with the same rule-based scores used on product pages for consistency.
    # Pass batch_median_price so value scoring uses relative pricing within this comparison.
    #
    # CRITICAL: also override price/image from original listings — GPT often
    # mangles decimals (e.g. "$170.98" → "$17098", "$11.88" → "$1,188").
    #
    # ORIGIN BASELINE: if this is an alternatives search, parse the original product
    # from the prompt context and score it.  Alternatives that score worse than the
    # original on BOTH purchase_score and trust get their stamp capped — we should
    # never tell a user "Best Pick" for something worse than what they already have.

    # ── Parse & score the original product (alternatives flow only) ──
    # Preferred path: structured `origin_product` from the client. This
    # carries every ProductData field (ingredients, returnPolicy, seller, …)
    # so the score matches what the standalone analyzer produced.
    # Fallback: regex-parse the prompt (older clients) — known to lose
    # sub-scores because most fields end up empty.
    origin_score: int = 0
    origin_trust: int = 0
    origin_title: str = ""
    origin_url: str = ""
    origin_price: str = ""

    if req.origin_product is not None:
        from purchase_scoring import calculate_purchase_score as _origin_calc
        from product_cache import enrich_dict_from_cache, get_default_cache

        cache = get_default_cache()
        op = req.origin_product

        # Read-through: backfill missing static fields (ingredients, brand,
        # category) from any prior observation of this product on any
        # platform. Empty-only fill — never clobbers live data.
        try:
            enriched_dict, cached = enrich_dict_from_cache(cache, op.model_dump())
            if cached is not None:
                op = ProductData(**enriched_dict)
                logger.info(
                    "origin enriched from cache id=%s confidence=%s",
                    cached.product_id, cached.confidence,
                )
        except Exception as e:
            logger.warning("origin cache enrichment failed: %s", e)

        origin_title = op.title or ""
        origin_price = op.price or ""
        origin_url = op.url or ""
        try:
            o_score, _o_bd, o_trust = _origin_calc(op, mid_price_override=batch_median_price)
            origin_score = o_score
            origin_trust = o_trust.trust_score
            logger.info(
                "Origin baseline (structured): '%s' purchase=%d, trust=%d",
                origin_title[:40], origin_score, origin_trust,
            )
            # Write-back: cache the (possibly enriched) origin product and
            # stamp the latest score so future cross-platform requests can
            # converge to the same number.
            try:
                rec, _hit = cache.remember_product(op.model_dump())
                cache.record_score(
                    rec.product_id,
                    origin_score,
                    0,
                    extras={
                        "last_price": op.price or "",
                        "last_currency": op.currency or "",
                    },
                )
            except Exception as e:
                logger.warning("origin cache write failed: %s", e)
        except Exception as e:
            logger.warning("Failed to score structured origin product: %s", e)
    else:
        import re as _re
        origin_match = _re.search(
            r"ORIGINAL PRODUCT[^\n]*\n"
            r"Title:\s*(.+?)\n"
            r"Price:\s*(.+?)\n"
            r"Rating:\s*(.+?)\n"
            r"Reviews:\s*(.+?)\n"
            r"Source:\s*(.+?)\n"
            r"(?:URL:\s*(.+?)\n)?",
            req.user_prompt,
        )
        if origin_match:
            from purchase_scoring import calculate_purchase_score as _origin_calc
            origin_title = origin_match.group(1).strip()
            origin_price = origin_match.group(2).strip()
            origin_url = (origin_match.group(6) or "").strip()
            origin_product = ProductData(
                title=origin_title,
                price=origin_price,
                rating=origin_match.group(3).strip(),
                reviewCount=origin_match.group(4).strip(),
                source_site=origin_match.group(5).strip(),
                brand="",
                seller="",
                delivery="",
                returnPolicy="",
                category="",
                url=origin_url,
                imageUrl="",
                ingredients="",
                nutritionLabel="",
            )
            try:
                o_score, _o_bd, o_trust = _origin_calc(origin_product, mid_price_override=batch_median_price)
                origin_score = o_score
                origin_trust = o_trust.trust_score
                logger.info(
                    "Origin baseline (regex fallback): '%s' purchase=%d, trust=%d",
                    origin_title[:40], origin_score, origin_trust,
                )
            except Exception as e:
                logger.warning("Failed to score origin product: %s", e)
    if req.listings:
        from purchase_scoring import calculate_purchase_score

        # Build multiple lookup strategies for matching ranked items to originals
        listing_by_url: dict[str, ProductData] = {}
        listing_by_title: dict[str, ProductData] = {}
        listing_by_title_prefix: list[tuple[str, ProductData]] = []
        for listing in req.listings:
            if listing.url:
                clean_url = listing.url.split("?")[0].rstrip("/").lower()
                listing_by_url[clean_url] = listing
            if listing.title:
                key = listing.title.lower().strip()
                listing_by_title[key] = listing
                listing_by_title_prefix.append((key, listing))

        def _match_listing(item) -> ProductData | None:
            """Match a ranked item back to original listing data."""
            # Strategy 1: URL match (most reliable)
            if item.url:
                clean_url = item.url.split("?")[0].rstrip("/").lower()
                m = listing_by_url.get(clean_url)
                if m:
                    return m
            # Strategy 2: exact title match
            if item.title:
                m = listing_by_title.get(item.title.lower().strip())
                if m:
                    return m
            # Strategy 3: substring match (GPT often truncates titles)
            if item.title:
                item_lower = item.title.lower().strip()
                for key, val in listing_by_title_prefix:
                    if item_lower in key or key in item_lower:
                        return val
                # Strategy 4: first-N-chars match (handles GPT adding suffixes)
                if len(item_lower) > 20:
                    prefix = item_lower[:20]
                    for key, val in listing_by_title_prefix:
                        if key.startswith(prefix):
                            return val
            return None

        for item in batch.ranked:
            matched = _match_listing(item)
            if matched:
                # Read-through: backfill missing static fields from cache so
                # cross-platform listings score consistently with the origin.
                try:
                    from product_cache import enrich_dict_from_cache, get_default_cache
                    _cache = get_default_cache()
                    enriched_dict, _cached = enrich_dict_from_cache(_cache, matched.model_dump())
                    if _cached is not None:
                        matched = ProductData(**enriched_dict)
                except Exception as _e:
                    logger.debug("listing cache enrichment skipped: %s", _e)

                score, breakdown, trust = calculate_purchase_score(
                    matched, mid_price_override=batch_median_price
                )
                item.purchase_score = score
                item.review_trust = trust

                # Override price with original listing price — GPT often
                # mangles decimals (e.g. "$11.88" → "$1,188")
                if matched.price:
                    item.price = matched.price

                # Override image_url with original if GPT's is empty/wrong
                if matched.imageUrl and not item.image_url:
                    item.image_url = matched.imageUrl

                # Use the domain-specific stamp generator (same as single-product path)
                from purchase_scoring import detect_risk_flags
                risk_flags = detect_risk_flags(matched, trust)
                from decision_engine import generate_stamp
                from models import HealthBreakdown

                # Calculate actual health score (food/personal care need safety gates)
                from health_scoring import calculate_health_score, is_food_product, is_personal_care_product
                h_score, h_breakdown = calculate_health_score(matched)
                food = is_food_product(matched)
                personal_care = is_personal_care_product(matched)

                stamp, legacy, _reasons, warnings, positives = generate_stamp(
                    purchase_score=score,
                    health_score=h_score,
                    is_food=food,
                    purchase_breakdown=breakdown,
                    health_breakdown=h_breakdown,
                    review_trust=trust,
                    risk_flags=risk_flags,
                    product=matched,
                )
                if h_score > 0:
                    item.health_score = h_score
                item.decision = legacy
                item.stamp = stamp
                item.domain = classify_domain(matched.source_site, matched.category, matched.title).value
                # Merge generated reasons with AI reasons
                if positives and not item.positives:
                    item.positives = positives
                if warnings and not item.warnings:
                    item.warnings = warnings
                logger.info("Re-scored '%s': purchase=%d, trust=%d, decision=%s",
                            item.title[:40], score, trust.trust_score, item.decision)

                # Write-back: persist the (enriched) listing + final scores
                # so the next user looking at this product on any platform
                # gets the same answer.
                try:
                    rec, _hit = _cache.remember_product(matched.model_dump())
                    _cache.record_score(
                        rec.product_id,
                        score,
                        h_score,
                        extras={
                            "last_price": matched.price or item.price or "",
                            "last_currency": matched.currency or "",
                        },
                    )
                except Exception as _e:
                    logger.debug("listing cache write skipped: %s", _e)
            else:
                logger.warning("Could not match ranked item to listing: '%s'", item.title[:60])

        # Safety net: fix prices that look like missing decimals.
        # Walmart (and some other sites) render dollars+cents in separate DOM
        # elements → textContent concatenates them without a period.
        # E.g. "$17098" should be "$170.98", "$1188" → "$11.88"
        import re as _re
        for item in batch.ranked:
            if not item.price:
                continue
            # Extract the numeric portion
            m = _re.search(r'([\$€£₹¥]?\s*)([\d,]+)(\.(\d+))?', item.price)
            if not m:
                continue
            prefix = m.group(1) or ""
            digits = m.group(2).replace(",", "")
            has_decimal = m.group(3) is not None
            # If no decimal and digits are 3+ chars, likely missing cents separator
            # Heuristic: prices > $999 are possible, so only fix when the original
            # listing's price (if available) also has no decimal — i.e., always fix
            # prices that are suspiciously large integers by checking the listings.
            if not has_decimal and len(digits) >= 4:
                # Check if this numeric value exists in original listings with a decimal
                # If we see e.g. 17098 but original had "170.98", the override should have
                # already fixed it. This catches cases where the override didn't apply.
                # Insert decimal before last 2 digits
                dollars = digits[:-2]
                cents = digits[-2:]
                if dollars and cents != "00":
                    fixed = f"{prefix}{dollars}.{cents}"
                    logger.info("Price sanitizer: '%s' → '%s' for '%s'",
                                item.price, fixed, item.title[:40])
                    item.price = fixed

    # Re-rank by rule-based purchase_score (descending) to correct AI misjudgments.
    # This ensures value-for-money and trust signals override any AI brand bias.
    if batch.ranked:
        batch.ranked.sort(key=lambda x: x.purchase_score, reverse=True)
        for i, item in enumerate(batch.ranked):
            item.rank = i + 1

    # ── Origin-gating: cap alternatives that are WORSE than the original ──
    # If the user is browsing a product with Trust 79 / Purchase 68, an alternative
    # with Trust 40 / Purchase 43 should NEVER get BEST PICK or BUY — that's not
    # a "better alternative", it's a downgrade.
    if origin_score > 0 and origin_trust > 0 and batch.ranked:
        TIER_ORDER = ["SKIP", "CAUTION", "CONSIDER", "BUY", "BEST PICK"]
        import logging as _log
        _logger = _log.getLogger("compare_rank")
        for item in batch.ranked:
            alt_score = item.purchase_score
            alt_trust = item.review_trust.trust_score if item.review_trust else 0
            alt_label = (item.stamp.label or "").upper()

            # If the alternative is worse on BOTH purchase_score and trust,
            # it can't be higher than CONSIDER — it's not a genuine upgrade.
            if alt_score < origin_score and alt_trust < origin_trust:
                cap = "CONSIDER"
                if alt_label in TIER_ORDER and TIER_ORDER.index(alt_label) > TIER_ORDER.index(cap):
                    _logger.info(
                        "Origin-gate: '%s' capped %s→%s (alt %d/%d < origin %d/%d)",
                        item.title[:40], alt_label, cap,
                        alt_score, alt_trust, origin_score, origin_trust,
                    )
                    item.stamp.label = cap
                    item.stamp.stamp = "CHECK"
                    item.decision = "NEUTRAL"

            # If the alternative loses on trust by a wide margin (>15 pts),
            # cap at CONSIDER even if purchase_score is close.
            elif alt_trust < origin_trust - 15:
                cap = "CONSIDER"
                if alt_label in TIER_ORDER and TIER_ORDER.index(alt_label) > TIER_ORDER.index(cap):
                    _logger.info(
                        "Origin-gate (trust gap): '%s' capped %s→%s (trust %d vs origin %d)",
                        item.title[:40], alt_label, cap,
                        alt_trust, origin_trust,
                    )
                    item.stamp.label = cap
                    item.stamp.stamp = "CHECK"
                    item.decision = "NEUTRAL"

        # Attach origin baseline to response for frontend reference
        batch.origin_title = origin_title
        batch.origin_purchase_score = origin_score
        batch.origin_trust_score = origin_trust
        batch.origin_url = origin_url
        batch.origin_price = origin_price

        # ── "Your pick is the best" detection ──
        # If the user's original product beats EVERY alternative on purchase_score
        # (or ties on score but wins on trust), none of our alternatives are a
        # genuine upgrade — tell the user to stick with their original choice.
        top_alt = batch.ranked[0] if batch.ranked else None
        if top_alt:
            top_alt_score = top_alt.purchase_score
            top_alt_trust = top_alt.review_trust.trust_score if top_alt.review_trust else 0
            # Origin is "best" if it beats the top alternative on score,
            # OR ties on score but has meaningfully better trust (>10 pts)
            if (origin_score > top_alt_score) or \
               (origin_score == top_alt_score and origin_trust > top_alt_trust + 10):
                batch.origin_is_best = True
                _logger.info(
                    "Origin is best: '%s' (%d/%d) beats top alt '%s' (%d/%d)",
                    origin_title[:40], origin_score, origin_trust,
                    top_alt.title[:40], top_alt_score, top_alt_trust,
                )

    # Sanitize prices in comparison_summary too (GPT text may contain mangled prices)
    if batch.comparison_summary:
        import re as _re
        def _fix_summary_price(m):
            prefix = m.group(1) or ""
            digits = m.group(2).replace(",", "")
            decimal = m.group(3) or ""
            suffix = m.group(4) or ""
            if not decimal and len(digits) >= 4:
                dollars = digits[:-2]
                cents = digits[-2:]
                if cents != "00":
                    return f"{prefix}{dollars}.{cents}{suffix}"
            return m.group(0)
        batch.comparison_summary = _re.sub(
            r'([\$€£₹¥])([\d,]+)(\.\d+)?(\s|[^.\d]|$)',
            _fix_summary_price,
            batch.comparison_summary,
        )

    return batch


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
