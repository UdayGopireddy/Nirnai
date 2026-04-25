"""India-specific price intelligence.

Pure functions only. The web layer (main.py / extension) supplies parsed
strings; this module turns them into normalized numeric signals and an
"effective price" — the post-bank-offer / post-coupon / post-shipping price the
shopper actually pays.

Why a dedicated module:
- Indian listings expose MRP, EMI, bank offers, COD, coupons; the US scorer
  doesn't model any of these.
- Effective-price computation is the most asked-for feature: shoppers do this
  math by hand today.

Design notes:
- All functions are total: bad inputs return safe defaults (0.0 / None / 0%).
- Bank-offer caps are honoured ("10% up to ₹500").
- Cashback (Amazon Pay etc.) is intentionally OUT of scope for v1: it requires
  login state we don't have.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional


# ── Currency parsing ──

_INR_PATTERN = re.compile(r"[\d,]+(?:\.\d+)?")


def parse_inr(value: str) -> Optional[float]:
    """Parse an Indian price string into a float.

    Handles "₹2,599", "Rs. 2,599", "INR 2599.50", "2,599", "2599".
    Returns None for empty / unparseable input.
    """
    if not value:
        return None
    # Strip currency symbols and "Rs"/"INR" prefixes; keep digits, comma, dot.
    match = _INR_PATTERN.search(value.replace(",", ","))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def parse_shipping(value: str) -> float:
    """Parse a shipping-cost string. "FREE" / empty / "free shipping" -> 0.0.

    Falls through to ``parse_inr`` for explicit amounts.
    """
    if not value:
        return 0.0
    if "free" in value.lower():
        return 0.0
    parsed = parse_inr(value)
    return parsed if parsed is not None else 0.0


# ── Bank offer parsing ──

# Pattern: "10% Instant Discount up to ₹500"
#          "5% off, max ₹250"
#          "₹500 off on HDFC Credit Card"
_PCT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_CAP_PATTERN = re.compile(r"(?:up to|max(?:imum)?|capped at|cap)\s*(?:₹|Rs\.?|INR)?\s*([\d,]+)", re.IGNORECASE)
_FLAT_PATTERN = re.compile(r"(?:₹|Rs\.?|INR)\s*([\d,]+)\s*(?:off|discount|cashback)", re.IGNORECASE)


@dataclass
class BankOffer:
    """One parsed bank/card offer."""
    raw: str
    percent_off: float = 0.0  # 0–100
    cap_inr: Optional[float] = None  # absolute cap, None = no cap
    flat_off: float = 0.0  # absolute discount (alternative to percent)

    def discount_on(self, sticker: float) -> float:
        """Compute the rupee discount this offer would apply to a given sticker.

        Best of (percent w/ cap) and flat. Never negative, never exceeds sticker.
        """
        if sticker <= 0:
            return 0.0
        pct_disc = sticker * (self.percent_off / 100.0)
        if self.cap_inr is not None:
            pct_disc = min(pct_disc, self.cap_inr)
        best = max(pct_disc, self.flat_off)
        return min(best, sticker)


def parse_bank_offer(raw: str) -> BankOffer:
    """Parse a single bank-offer line into a BankOffer."""
    if not raw:
        return BankOffer(raw="")
    pct = 0.0
    m = _PCT_PATTERN.search(raw)
    if m:
        try:
            pct = float(m.group(1))
        except ValueError:
            pct = 0.0

    cap: Optional[float] = None
    cm = _CAP_PATTERN.search(raw)
    if cm:
        try:
            cap = float(cm.group(1).replace(",", ""))
        except ValueError:
            cap = None

    flat = 0.0
    # Only treat as "flat off" if no percent is mentioned (otherwise the rupee
    # number is usually the cap, not a separate flat discount).
    if pct == 0.0:
        fm = _FLAT_PATTERN.search(raw)
        if fm:
            try:
                flat = float(fm.group(1).replace(",", ""))
            except ValueError:
                flat = 0.0

    return BankOffer(raw=raw, percent_off=pct, cap_inr=cap, flat_off=flat)


def best_bank_discount(offers: Iterable[str], sticker: float) -> tuple[float, Optional[BankOffer]]:
    """Return (best_discount_inr, best_offer) across all parsed offers.

    Picks the single most valuable offer rather than stacking — bank offers in
    India are almost never combinable.
    """
    best_disc = 0.0
    best_offer: Optional[BankOffer] = None
    for raw in offers:
        offer = parse_bank_offer(raw)
        disc = offer.discount_on(sticker)
        if disc > best_disc:
            best_disc = disc
            best_offer = offer
    return best_disc, best_offer


# ── Coupon parsing ──

_COUPON_PCT = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*coupon", re.IGNORECASE)
_COUPON_FLAT = re.compile(r"(?:₹|Rs\.?|INR)\s*([\d,]+)\s*coupon", re.IGNORECASE)


def parse_coupon(raw: str, sticker: float) -> float:
    """Parse a coupon line ("Apply ₹300 coupon" / "20% coupon") into rupees off."""
    if not raw or sticker <= 0:
        return 0.0
    m_pct = _COUPON_PCT.search(raw)
    if m_pct:
        try:
            return min(sticker * float(m_pct.group(1)) / 100.0, sticker)
        except ValueError:
            pass
    m_flat = _COUPON_FLAT.search(raw)
    if m_flat:
        try:
            return min(float(m_flat.group(1).replace(",", "")), sticker)
        except ValueError:
            pass
    return 0.0


# ── Effective price ──

@dataclass
class EffectivePrice:
    """Result of effective-price computation."""
    sticker: float
    effective: float
    mrp: Optional[float]
    mrp_discount_pct: float  # 0 if MRP missing
    best_bank_offer: Optional[BankOffer]
    bank_discount: float
    coupon_discount: float
    shipping: float
    savings_vs_sticker: float

    def to_dict(self) -> dict:
        return {
            "sticker": round(self.sticker, 2),
            "effective": round(self.effective, 2),
            "mrp": round(self.mrp, 2) if self.mrp is not None else None,
            "mrp_discount_pct": round(self.mrp_discount_pct, 1),
            "bank_discount": round(self.bank_discount, 2),
            "best_bank_offer": self.best_bank_offer.raw if self.best_bank_offer else "",
            "coupon_discount": round(self.coupon_discount, 2),
            "shipping": round(self.shipping, 2),
            "savings_vs_sticker": round(self.savings_vs_sticker, 2),
        }


def compute_effective_price(
    *,
    sticker_raw: str,
    mrp_raw: str = "",
    bank_offers: Iterable[str] = (),
    coupon_raw: str = "",
    shipping_raw: str = "",
) -> EffectivePrice:
    """Compute the post-everything price the shopper actually pays.

    Order of operations:
      effective = sticker - bank_discount - coupon + shipping

    `mrp_discount_pct` is informational only — MRP is often inflated and is a
    weak signal. Use price-vs-cross-retailer-median (computed elsewhere) as the
    primary "is this cheap" signal.
    """
    sticker = parse_inr(sticker_raw) or 0.0
    mrp = parse_inr(mrp_raw)

    bank_disc, best_offer = best_bank_discount(bank_offers, sticker)
    coupon_disc = parse_coupon(coupon_raw, sticker)
    shipping = parse_shipping(shipping_raw)

    effective = max(sticker - bank_disc - coupon_disc + shipping, 0.0)
    savings = max(sticker - effective + shipping, 0.0)  # net savings vs paying sticker w/ shipping

    mrp_disc_pct = 0.0
    if mrp and mrp > sticker > 0:
        mrp_disc_pct = (1.0 - sticker / mrp) * 100.0

    return EffectivePrice(
        sticker=sticker,
        effective=effective,
        mrp=mrp,
        mrp_discount_pct=mrp_disc_pct,
        best_bank_offer=best_offer,
        bank_discount=bank_disc,
        coupon_discount=coupon_disc,
        shipping=shipping,
        savings_vs_sticker=savings,
    )


# ── Price score (vs market) ──

def price_score_vs_median(effective: float, median: Optional[float]) -> int:
    """Score 0–100 of effective price vs cross-retailer median.

    Below median -> >50 (cheaper than market).  Above median -> <50.
    Caps at +/-30% from median to avoid runaway scores.

    If `median` is None or zero (no comparison data yet), returns a neutral 50
    so the upstream scorer can fall back to other signals.
    """
    if not median or median <= 0 or effective <= 0:
        return 50
    ratio = effective / median  # <1 cheaper, >1 pricier
    # Linear map: ratio 0.7 -> 80, 1.0 -> 50, 1.3 -> 20.
    score = 50 + int(round((1.0 - ratio) * 100.0))
    return max(20, min(80, score))


def price_score_vs_mrp(mrp_discount_pct: float) -> int:
    """Score 0–100 of MRP discount %.

    MRP is theatre, so we flatten this aggressively:
      0–10% off  -> 50 (treat as no signal)
      10–30% off -> 50–65
      30–50% off -> 65–75
      50%+ off   -> 75–80 (capped — extreme MRP discounts are usually fake)
    """
    p = max(0.0, mrp_discount_pct)
    if p < 10.0:
        return 50
    if p < 30.0:
        return 50 + int(round((p - 10.0) * 0.75))  # 50..65
    if p < 50.0:
        return 65 + int(round((p - 30.0) * 0.5))   # 65..75
    return min(80, 75 + int(round((p - 50.0) * 0.1)))


def combined_price_score(
    effective: float,
    median: Optional[float],
    mrp_discount_pct: float,
) -> int:
    """Combine market-relative and MRP-relative signals.

    Market-vs-median dominates (weight 0.75) when median is available; MRP is a
    tiebreaker (weight 0.25). When median is missing we fall back to MRP alone.
    """
    if median and median > 0:
        a = price_score_vs_median(effective, median)
        b = price_score_vs_mrp(mrp_discount_pct)
        return int(round(a * 0.75 + b * 0.25))
    return price_score_vs_mrp(mrp_discount_pct)
