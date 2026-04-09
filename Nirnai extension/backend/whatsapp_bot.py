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
    """Scrape URL → analyze → send verdict."""
    from models import ProductData

    await _send_text(sender, "🔍 Analyzing... give me a moment.")

    try:
        # Use existing /analyze/fast endpoint internally (no AI call, instant)
        product = await _scrape_product_from_url(url)
        if not product:
            await _send_text(sender, "❌ Couldn't read that page. Try a direct product link.")
            return

        # Import scoring functions directly (same process, no HTTP round-trip)
        from purchase_scoring import calculate_purchase_score
        from health_scoring import calculate_health_score, is_food_product
        from decision_engine import generate_stamp, compute_confidence

        purchase_score, purchase_breakdown, review_trust = calculate_purchase_score(product)
        health_score, health_breakdown = calculate_health_score(product)
        food = is_food_product(product)
        stamp, decision, reasons, warnings, positives = generate_stamp(
            purchase_score=purchase_score,
            health_score=health_score,
            is_food=food,
            purchase_breakdown=purchase_breakdown,
            health_breakdown=health_breakdown,
            review_trust=review_trust,
        )
        confidence = compute_confidence(product, review_trust, purchase_score)

        # Build verdict message
        verdict = f"{stamp.icon} *{stamp.label}*\n\n"
        verdict += f"🛒 Purchase Score: {purchase_score}/100\n"
        verdict += f"⭐ Trust Score: {review_trust.trust_score}/100\n"
        if health_score > 0:
            verdict += f"🥗 Health Score: {health_score}/100\n"
        verdict += f"📊 Confidence: {round(confidence * 100)}%\n\n"
        verdict += f"_{stamp.reasons[0]}_\n" if stamp.reasons else ""

        if warnings:
            verdict += f"\n⚠️ {warnings[0]}\n"
        if positives:
            verdict += f"✅ {positives[0]}\n"

        verdict += f"\n🔗 {url}"

        await _send_text(sender, verdict)

        # Fire AI enhancement in background (non-blocking)
        # Phase 2: send follow-up message with AI summary when ready

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


# ─── Product scraping (lightweight) ───────────────────────────────


async def _scrape_product_from_url(url: str):
    """Minimal scrape to build a ProductData for scoring."""
    from models import ProductData

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
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

    # Extract title
    title = ""
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    if title_match:
        title = title_match.group(1).strip()[:200]

    # Extract price
    price = ""
    price_patterns = [
        r'"price"\s*:\s*"?\$?([\d,.]+)"?',
        r'class="[^"]*price[^"]*"[^>]*>\s*\$?([\d,.]+)',
        r'\$\s*([\d,]+\.\d{2})',
    ]
    for pat in price_patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            price = m.group(1).replace(",", "")
            break

    # Extract rating
    rating = ""
    rating_match = re.search(r'"ratingValue"\s*:\s*"?([\d.]+)"?', html, re.IGNORECASE)
    if rating_match:
        rating = rating_match.group(1)

    # Extract review count
    review_count = ""
    review_match = re.search(r'"reviewCount"\s*:\s*"?(\d+)"?', html, re.IGNORECASE)
    if review_match:
        review_count = review_match.group(1)

    return ProductData(
        title=title,
        price=price,
        rating=rating,
        reviewCount=review_count,
        url=url,
        source_site=source_site,
        page_type="product",
    )


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
