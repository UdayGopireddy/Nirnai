"""AI analysis service — uses OpenAI for deeper product insights."""

import os
import json
import urllib.parse
from typing import Optional
from openai import AsyncOpenAI
from models import ProductData, AlternativeSuggestion
from domain_classifier import ScoringDomain, classify_domain

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    timeout=15.0,
    max_retries=1,
)
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


async def get_ai_summary(
    product: ProductData,
    purchase_score: int,
    health_score: int,
    decision: str,
) -> str:
    """Get an AI-generated summary of the product analysis. Domain-aware."""

    # Detect domain for context-appropriate prompts
    domain = classify_domain(
        getattr(product, 'source_site', ''),
        getattr(product, 'category', ''),
        getattr(product, 'title', ''),
    )
    is_travel = domain == ScoringDomain.HOSPITALITY

    if is_travel:
        system_msg = "You are NirnAI, a trusted travel advisor. Give concise, clear assessments of accommodations that help travelers decide with confidence."
        prompt = f"""You are a smart travel advisor. Analyze this listing and provide a brief,
actionable summary (2-3 sentences) explaining the decision.

Listing: {product.title}
Price: {product.price}
Rating: {product.rating} ({product.reviewCount} reviews)
Host: {product.seller}
Host Status: {product.fulfiller or 'Unknown'}
Property Type: {product.category}
Amenities: {product.ingredients or 'Not listed'}
Category Ratings: {product.nutritionInfo or 'Not available'}
Cancellation: {product.returnPolicy or 'Unknown'}
Check-in: {product.delivery or 'Unknown'}
Platform: {product.source_site}

Scores:
- Purchase Score: {purchase_score}/100
- Decision: {decision}

Explain why this listing received this decision. Be specific about:
- Host reliability (superhost status, experience, response rate)
- Value for the area and property type
- Any concerns (cancellation policy, limited reviews, etc.)
Keep it under 3 sentences. NEVER mention "purchase score" — say "our score" or "rated"."""
    else:
        system_msg = "You are NirnAI, a trusted product advisor. Give concise, clear assessments that help users decide with confidence."
        prompt = f"""You are a smart shopping advisor. Analyze this product and provide a brief, 
actionable summary (2-3 sentences) explaining the decision.

Product: {product.title}
Price: {product.price}
Rating: {product.rating} ({product.reviewCount} reviews)
Seller: {product.seller}
Fulfilled by: {product.fulfiller or 'Unknown'}
Category: {product.category}
Delivery: {product.delivery}
Return Policy: {product.returnPolicy}
{"Ingredients: " + product.ingredients if product.ingredients else ""}
{"Nutrition: " + product.nutritionInfo if product.nutritionInfo else ""}

Scores:
- Purchase Score: {purchase_score}/100
- Health Score: {health_score}/100
- Decision: {decision}

Provide a concise summary explaining why this product received this decision. 
Be specific about strengths and concerns.
If fulfilled by Amazon, mention that as a trust signal.
Keep it under 3 sentences."""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            max_tokens=200,
            temperature=0.3,
        )

        return response.choices[0].message.content or "Analysis complete."
    except Exception as e:
        return _generate_fallback_summary(
            product, purchase_score, health_score, decision
        )


async def get_ai_enhanced_scores(product: ProductData) -> dict:
    """
    Use AI to better assess price fairness and seller trust
    when we have limited data from the page.
    """
    prompt = f"""Analyze this product and return JSON with enhanced scoring factors.

Product: {product.title}
Price: {product.price}
Rating: {product.rating}
Seller: {product.seller}

Return a JSON object with:
- price_assessment: number 0-100 (how fair is this price for this product type)
- seller_trust: number 0-100 (how trustworthy does this seller seem)
- concerns: list of strings (any red flags)

Only return valid JSON, no other text."""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
            temperature=0.2,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        if content:
            return json.loads(content)
    except Exception:
        pass

    return {}


def _generate_fallback_summary(
    product: ProductData,
    purchase_score: int,
    health_score: int,
    decision: str,
) -> str:
    """Generate a rule-based summary when AI is unavailable. Domain-aware."""
    source = getattr(product, 'source_site', '') or ''
    domain = classify_domain(source, product.category, product.title)
    is_travel = domain == ScoringDomain.HOSPITALITY
    parts = []

    if is_travel:
        if decision == "BUY":
            parts.append(
                f"This listing scores well at {purchase_score}/100, suggesting a reliable stay."
            )
        elif decision == "DON'T BUY":
            parts.append(
                f"This listing has concerns with a score of only {purchase_score}/100."
            )
        else:
            parts.append(
                f"This listing has a mixed score of {purchase_score}/100 — review the details before booking."
            )
    else:
        if decision == "BUY":
            parts.append(
                f"This product scores well with a purchase score of {purchase_score}/100."
            )
        elif decision == "DON'T BUY":
            parts.append(
                f"This product has concerns with a purchase score of only {purchase_score}/100."
            )
        else:
            parts.append(
                f"This product has a mixed score of {purchase_score}/100."
            )

    if health_score > 0:
        if health_score >= 70:
            parts.append(f"Health-wise, it looks good ({health_score}/100).")
        elif health_score < 40:
            parts.append(
                f"Health concern: score is only {health_score}/100 — check ingredients carefully."
            )

    return " ".join(parts)


async def get_alternative_suggestion(
    product: ProductData,
    purchase_score: int,
    health_score: int,
    decision: str,
    warnings: list[str],
) -> Optional[AlternativeSuggestion]:
    """Suggest a better alternative when the decision is DON'T BUY or NEUTRAL. Domain-aware."""
    if decision == "BUY":
        return None

    domain = classify_domain(
        getattr(product, 'source_site', ''),
        getattr(product, 'category', ''),
        getattr(product, 'title', ''),
    )
    is_travel = domain == ScoringDomain.HOSPITALITY

    if is_travel:
        prompt = f"""You are a travel advisor. The user is looking at an accommodation that received a "{decision}" verdict.
Suggest ONE specific, actionable alternative approach or platform.

Listing: {product.title}
Platform: {product.source_site}
Price: {product.price}
Host: {product.seller}
Host Status: {product.fulfiller or 'Unknown'}
Issues: {', '.join(warnings) if warnings else 'Low overall score'}
Score: {purchase_score}/100

Return a JSON object with:
- "product_name": A specific alternative (e.g., "Vrbo listings in Tampa" or "Hotels.com Tampa beachfront"). Include the location from the listing title.
- "reason": One sentence explaining why this alternative may be better (e.g., address cancellation, host trust, value concerns).

Only return valid JSON, no other text."""
    else:
        prompt = f"""You are a product advisor. The user is looking at a product that received a "{decision}" verdict.
Suggest ONE specific, well-known alternative product that is better quality in the same category.

Product: {product.title}
Category: {product.category}
Price: {product.price}
Issues: {', '.join(warnings) if warnings else 'Low overall score'}
Purchase Score: {purchase_score}/100
Health Score: {health_score}/100

Return a JSON object with:
- "product_name": The specific product name (brand + model). Be specific, not generic.
- "reason": One sentence explaining why this is better (address the original product's weaknesses).

The suggestion does NOT need to be from Amazon. Suggest the genuinely best alternative regardless of where it's sold.
Only return valid JSON, no other text."""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are NirnAI, a trusted advisor. Suggest genuinely better alternatives.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=150,
            temperature=0.4,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        if content:
            data = json.loads(content)
            product_name = data.get("product_name", "").strip()
            reason = data.get("reason", "").strip()
            if product_name and reason:
                search_query = urllib.parse.quote_plus(product_name)
                if is_travel:
                    # Link to Google search for travel alternatives (not Google Shopping)
                    search_url = f"https://www.google.com/search?q={search_query}"
                else:
                    search_url = f"https://www.google.com/search?q={search_query}&tbm=shop"
                return AlternativeSuggestion(
                    product_name=product_name,
                    reason=reason,
                    search_url=search_url,
                )
    except Exception:
        pass

    return None

    return None
