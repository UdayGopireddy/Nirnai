"""
NirnAI WhatsApp Bot — Mounted as a sub-router on the main FastAPI app.

Handles:
  1. Meta webhook verification (GET /whatsapp/webhook)
  2. Incoming messages (POST /whatsapp/webhook)
     - Product URL → full analysis verdict
     - "Is this a good deal?" / price questions → quick deal judgment
     - Text fallback → helpful reply

Requires env vars:
  WHATSAPP_VERIFY_TOKEN  — arbitrary string you set in Meta dashboard
  WHATSAPP_ACCESS_TOKEN  — from Meta Cloud API (Business > System Users)
  WHATSAPP_PHONE_ID      — phone number ID from Meta dashboard

No changes to existing endpoints or modules.
"""

from __future__ import annotations

import os
import re
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Request, Response, Query

logger = logging.getLogger("nirnai.whatsapp")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")
ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "")

META_API = "https://graph.facebook.com/v25.0"

# ── URL extraction regex ───────────────────────────────────────────
URL_PATTERN = re.compile(
    r"https?://(?:www\.)?(?:amazon|walmart|target|bestbuy|costco|homedepot|lowes|"
    r"ebay|wayfair|macys|nordstrom|nike|samsung|dyson|flipkart|"
    r"airbnb|booking|expedia|vrbo|agoda|hotels|tripadvisor)"
    r"[^\s]*",
    re.IGNORECASE,
)

# ── Deal-or-not trigger phrases ────────────────────────────────────
DEAL_PHRASES = re.compile(
    r"good deal|worth it|fair price|overpriced|is this deal|deal or not|is \$?\d+.*good",
    re.IGNORECASE,
)


# ─── Webhook verification (Meta handshake) ────────────────────────
@router.get("/webhook")
async def verify_webhook(
    mode: Optional[str] = Query(None, alias="hub.mode"),
    token: Optional[str] = Query(None, alias="hub.verify_token"),
    challenge: Optional[str] = Query(None, alias="hub.challenge"),
) -> Response:
    """Meta sends GET with hub.mode, hub.verify_token, hub.challenge."""
    if mode == "subscribe" and token == VERIFY_TOKEN and challenge:
        return Response(content=challenge, media_type="text/plain")
    return Response(content="Forbidden", status_code=403)


# ─── Incoming messages ─────────────────────────────────────────────
@router.post("/webhook")
async def receive_message(request: Request) -> dict:
    """Process incoming WhatsApp messages. Always return 200 to Meta."""
    body = await request.json()

    # Meta sends various event types — only process messages
    try:
        entry = body.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [])
    except (IndexError, AttributeError):
        return {"status": "ok"}

    for msg in messages:
        sender = msg.get("from", "")
        msg_type = msg.get("type", "")
        text = ""

        if msg_type == "text":
            text = msg.get("text", {}).get("body", "").strip()
        else:
            # Image support (screenshot → decision) will be added in phase 2
            await _send_text(
                sender,
                "🛡️ NirnAI — Send me a product link and I'll give you the verdict!\n\n"
                "Example: paste any Amazon, Walmart, Airbnb, or Booking.com link.",
            )
            continue

        if not text:
            continue

        # 1️⃣ Check for product URL
        url_match = URL_PATTERN.search(text)
        if url_match:
            await _handle_url_analysis(sender, url_match.group(0))
            continue

        # 2️⃣ Check for deal/price question
        if DEAL_PHRASES.search(text):
            await _handle_deal_question(sender, text)
            continue

        # 3️⃣ Fallback
        await _send_text(
            sender,
            "🛡️ NirnAI — I analyze products for you!\n\n"
            "Send me:\n"
            "• A product link (Amazon, Walmart, Airbnb, etc.)\n"
            "• \"Is $89 a good deal for wireless earbuds?\"\n\n"
            "I'll give you the verdict instantly.",
        )

    return {"status": "ok"}


# ─── Handlers ──────────────────────────────────────────────────────


async def _handle_url_analysis(sender: str, url: str) -> None:
    """Scrape URL → score with the SAME rule-based engine the extension uses → send verdict.
    
    The Chrome extension calls /analyze/fast which runs purchase_scoring + health_scoring
    + decision_engine. Since the WhatsApp bot lives in the same Python process, we import
    those modules directly — zero HTTP overhead, guaranteed scoring parity.
    """
    await _send_text(sender, "🔍 Analyzing... give me a moment.")

    try:
        product = await _scrape_product_from_url(url)
        if not product:
            await _send_text(sender, "❌ Couldn't read that page. Try a direct product link.")
            return

        # Same scoring functions that /analyze/fast calls — identical results, no HTTP roundtrip
        from purchase_scoring import calculate_purchase_score, detect_risk_flags
        from health_scoring import calculate_health_score, is_food_product
        from decision_engine import generate_stamp, compute_confidence

        purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
        health_score, health_breakdown = calculate_health_score(product)
        food = is_food_product(product)
        risk_flags = detect_risk_flags(product, review_trust)
        stamp, decision, reasons, warnings, positives = generate_stamp(
            purchase_score=purchase_score,
            health_score=health_score,
            is_food=food,
            purchase_breakdown=purchase_breakdown,
            health_breakdown=health_breakdown,
            review_trust=review_trust,
            risk_flags=risk_flags,
        )
        confidence = compute_confidence(product, review_trust, purchase_score)

        has_price = bool(product.price)
        has_rating = bool(product.rating)
        has_reviews = bool(product.reviewCount)
        data_completeness = sum([has_price, has_rating, has_reviews])

        if data_completeness < 2:
            verdict = "🛡️ *NirnAI Product Check*\n\n"
            verdict += f"📦 _{product.title[:80]}_\n\n" if product.title else ""
            if has_price:
                verdict += f"💰 Price: ${product.price}\n"
            if has_rating:
                verdict += f"⭐ Rating: {product.rating}\n"
            if has_reviews:
                verdict += f"📝 Reviews: {product.reviewCount}\n"
            verdict += "\n⚠️ I couldn't extract enough data from this page for a full verdict.\n\n"
            verdict += "👉 *Install the NirnAI Chrome extension* for instant, "
            verdict += "accurate analysis directly on the product page.\n"
            verdict += "🔗 Works on Amazon, Walmart, Target, and 20+ sites.\n\n"
            verdict += f"🔗 {url}"
        else:
            verdict = f"{stamp.icon} *{stamp.label}*\n\n"
            verdict += f"📦 _{product.title[:80]}_\n\n" if product.title else ""
            if has_price:
                verdict += f"💰 Price: ${product.price}\n"
            verdict += f"🛒 Purchase Score: {purchase_score}/100\n"
            verdict += f"⭐ Trust Score: {review_trust.trust_score}/100\n"
            if health_score > 0:
                verdict += f"🥗 Health Score: {health_score}/100\n"
            verdict += f"📊 Confidence: {round(confidence * 100)}%\n\n"

            if stamp.reasons:
                verdict += f"_{stamp.reasons[0]}_\n"

            if positives:
                verdict += f"\n✅ {positives[0]}\n"
            if warnings:
                verdict += f"⚠️ {warnings[0]}\n"

            verdict += f"\n🔗 {url}"
            verdict += "\n\n🛡️ _NirnAI — Clear decisions. Every purchase._"

        await _send_text(sender, verdict)

    except Exception as e:
        logger.exception("URL analysis failed: %s", e)
        await _send_text(sender, "⚠️ Something went wrong analyzing that link. Please try again.")


async def _handle_deal_question(sender: str, text: str) -> None:
    """Handle 'is $X a good deal?' style questions."""
    # Extract price from text
    price_match = re.search(r"\$\s?(\d+(?:[.,]\d+)?)", text)

    if not price_match:
        await _send_text(
            sender,
            "🤔 I'd love to help! Send me the product link and I'll tell you if it's a good deal.",
        )
        return

    price = price_match.group(1).replace(",", "")
    price_val = float(price)

    # Extract what they're asking about
    product_desc = re.sub(r"\$\s?\d+(?:[.,]\d+)?", "", text)
    product_desc = re.sub(r"(?i)is|good deal|worth it|fair price|overpriced|for|a|the|deal or not", "", product_desc).strip()

    if not product_desc:
        await _send_text(
            sender,
            f"💰 *${price}* — send me the product link and I'll give you a proper verdict with trust scores and alternatives!",
        )
        return

    reply = f"💰 *Quick take on ${price} for {product_desc}:*\n\n"
    reply += "For an accurate verdict with trust scores, alternatives, and breakdown — "
    reply += "paste the product link here!\n\n"
    reply += "🛡️ _NirnAI — Clear decisions. Every purchase._"

    await _send_text(sender, reply)


# ─── Product scraping (matching Chrome extension quality) ─────────


async def _scrape_product_from_url(url: str):
    """Scrape product data to match Chrome extension extraction quality.
    
    Uses JSON-LD structured data first (most reliable), then HTML patterns
    as fallback. This ensures scoring parity with the extension.
    """
    from models import ProductData

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                },
            )
            if resp.status_code != 200:
                return None
            html = resp.text
    except Exception:
        return None

    # Detect site
    domain = url.lower()
    source_site = "unknown"
    for site in ["amazon", "walmart", "target", "bestbuy", "costco", "homedepot",
                 "lowes", "ebay", "flipkart", "airbnb", "booking", "expedia"]:
        if site in domain:
            source_site = site
            break

    # ── 1. JSON-LD structured data (most reliable, works across sites) ──
    title, price, rating, review_count, brand, seller = "", "", "", "", "", ""
    ingredients, delivery, return_policy = "", "", ""

    import json as _json
    jsonld_blocks = re.findall(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE,
    )
    for block in jsonld_blocks:
        try:
            data = _json.loads(block.strip())
            items = data if isinstance(data, list) else [data]
            for item in items:
                t = item.get("@type", "")
                if t == "Product" or (isinstance(t, list) and "Product" in t):
                    title = title or item.get("name", "")
                    brand = brand or _extract_nested(item, "brand", "name")

                    # Offers
                    offers = item.get("offers", {})
                    if isinstance(offers, list):
                        offers = offers[0] if offers else {}
                    price = price or str(offers.get("price", ""))
                    seller = seller or _extract_nested(offers, "seller", "name")

                    # AggregateRating
                    agg = item.get("aggregateRating", {})
                    rating = rating or str(agg.get("ratingValue", ""))
                    review_count = review_count or str(agg.get("reviewCount", agg.get("ratingCount", "")))
        except (_json.JSONDecodeError, TypeError, KeyError):
            continue

    # ── 2. HTML pattern fallbacks (site-specific) ──

    # Title
    if not title:
        for pat in [
            r'id="productTitle"[^>]*>\s*([^<]+)',        # Amazon
            r'<h1[^>]*itemprop="name"[^>]*>([^<]+)',     # Generic
            r'<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>([^<]+)',
            r'<title[^>]*>([^<|]+)',                       # Fallback: <title>
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                title = m.group(1).strip()[:200]
                break

    # Price — aggressive multi-pattern extraction
    if not price:
        for pat in [
            # Amazon specific
            r'class="a-offscreen"[^>]*>\s*\$?([\d,]+\.\d{2})',
            r'id="priceblock_ourprice"[^>]*>\s*\$?([\d,]+\.\d{2})',
            r'id="priceblock_dealprice"[^>]*>\s*\$?([\d,]+\.\d{2})',
            r'"priceAmount"\s*:\s*"?([\d.]+)"?',
            r'data-a-color="price".*?>\s*\$?([\d,]+\.\d{2})',
            r'class="[^"]*price-characteristic[^"]*"[^>]*value="(\d+)"',
            # Generic patterns
            r'"price"\s*:\s*"?\$?([\d,.]+)"?',
            r'itemprop="price"[^>]*content="([\d.]+)"',
            r'class="[^"]*price[^"]*"[^>]*>\s*\$?([\d,]+\.\d{2})',
            r'\$\s*([\d,]+\.\d{2})',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                price = m.group(1).replace(",", "")
                break

    # Rating
    if not rating:
        for pat in [
            r'"ratingValue"\s*:\s*"?([\d.]+)"?',
            r'(\d\.\d)\s+out\s+of\s+5\s+stars?',        # Amazon "4.6 out of 5 stars"
            r'class="a-icon-alt"[^>]*>\s*(\d\.\d)\s',
            r'itemprop="ratingValue"[^>]*content="([\d.]+)"',
            r'data-rating="([\d.]+)"',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                rating = m.group(1)
                break

    # Review count
    if not review_count:
        for pat in [
            r'"reviewCount"\s*:\s*"?(\d+)"?',
            r'"ratingCount"\s*:\s*"?(\d+)"?',
            r'([\d,]+)\s+(?:global\s+)?ratings?',         # Amazon "109,524 ratings"
            r'([\d,]+)\s+(?:customer\s+)?reviews?',
            r'id="acrCustomerReviewText"[^>]*>\s*([\d,]+)',
            r'itemprop="reviewCount"[^>]*content="(\d+)"',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                review_count = m.group(1).replace(",", "")
                break

    # Brand
    if not brand:
        for pat in [
            r'id="bylineInfo"[^>]*>[^<]*(?:Visit the|Brand:)\s*([^<]+)',
            r'itemprop="brand"[^>]*content="([^"]+)"',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                brand = m.group(1).strip().rstrip(" Store")
                break

    # Seller
    if not seller:
        m = re.search(r'id="sellerProfileTriggerId"[^>]*>([^<]+)', html, re.IGNORECASE)
        if m:
            seller = m.group(1).strip()

    # Return policy
    if not return_policy:
        m = re.search(r'(?:return|refund)\s+policy[^"]*"[^>]*>([^<]{5,80})', html, re.IGNORECASE)
        if m:
            return_policy = m.group(1).strip()
        elif re.search(r'free\s+returns?', html, re.IGNORECASE):
            return_policy = "Free Returns"

    # Delivery
    if not delivery:
        for pat in [
            r'(FREE\s+delivery[^<]{0,40})',
            r'(Prime\s+(?:FREE\s+)?(?:Same-Day|One-Day|Two-Day))',
            r'(Get it\s+[^<]{5,40})',
            r'(Arrives?\s+[^<]{5,40})',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                delivery = re.sub(r'<[^>]+>', '', m.group(1)).strip()[:60]
                break

    return ProductData(
        title=title,
        brand=brand,
        price=price,
        rating=rating,
        reviewCount=review_count,
        seller=seller,
        returnPolicy=return_policy,
        delivery=delivery,
        url=url,
        source_site=source_site,
        page_type="product",
    )


def _extract_nested(obj: dict, key: str, subkey: str) -> str:
    """Extract from nested dicts like {"brand": {"name": "X"}} or {"brand": "X"}."""
    val = obj.get(key, "")
    if isinstance(val, dict):
        return str(val.get(subkey, ""))
    return str(val) if val else ""


# ─── WhatsApp send helper ─────────────────────────────────────────


async def _send_text(to: str, body: str) -> None:
    """Send a WhatsApp text message via Meta Cloud API."""
    if not ACCESS_TOKEN or not PHONE_ID:
        logger.warning("WhatsApp credentials not configured — skipping send to %s", to)
        return

    url = f"{META_API}/{PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": body},
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code >= 400:
                logger.error("WhatsApp send failed [%d]: %s", resp.status_code, resp.text)
    except Exception as e:
        logger.exception("WhatsApp send error: %s", e)
