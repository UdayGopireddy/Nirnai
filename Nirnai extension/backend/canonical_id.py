"""Canonical product identity — Phase 1 of the product knowledge base.

Goal: produce a single stable ID for a product regardless of which retailer
(Walmart, Amazon, Target, …) the user is looking at, so we can cache its
slow-changing attributes (ingredients, specs, brand, category) once and
reuse them across sessions and platforms.

Resolution order (highest confidence first):
    1. Barcode (UPC/EAN/GTIN) — exact match, ~100% confidence.
    2. Platform SKU/ASIN     — exact match within a platform; cross-platform
                                map is built up over time as we observe the
                                same barcode on multiple platforms.
    3. (brand, normalized_title, normalized_size) hash — deterministic
                                fingerprint, ~85% confidence on its own.
    4. (Phase 2 add-on) embedding similarity for the long tail.

This module is pure: no I/O, no DynamoDB, no network. Database wiring lives
in a later phase. Keeping the identity function pure means we can unit-test
it exhaustively and refactor without breaking the cache.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

# ── Regex tables ────────────────────────────────────────────────────────────

# Generic tokens that don't help identify a product. Stripped from titles
# before fingerprinting so "Acme Shampoo 500ml New Pack" and
# "Acme Shampoo 500ml" hash the same.
_NOISE_TOKENS = {
    "new", "pack", "value", "family", "size", "edition", "limited",
    "exclusive", "online", "official", "store", "brand", "genuine",
    "original", "imported", "free", "shipping", "best", "seller",
    "premium", "deluxe", "with", "and", "for", "the", "of",
}

# Words that often appear right before a size and should not be treated
# as the size itself. Helps avoid "Pack of 6" being parsed as a quantity
# we'd hash on (we keep size, but normalize aggressively).
_SIZE_UNITS = {
    "ml": "ml", "milliliter": "ml", "milliliters": "ml",
    "l": "l",   "liter": "l",  "litre": "l",  "liters": "l", "litres": "l",
    "g": "g",   "gram": "g",   "grams": "g",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "oz": "oz", "ounce": "oz", "ounces": "oz", "fl oz": "oz", "fluid oz": "oz",
    "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
    "ct":  "ct", "count": "ct", "pcs": "ct", "pieces": "ct", "pack": "ct",
    "in": "in", "inch": "in", "inches": "in",
    "cm": "cm", "mm": "mm",
}

# UPC-A (12), EAN-13, EAN-8, GTIN-14. We accept anything 8/12/13/14 digits.
_BARCODE_RE = re.compile(r"^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$")

# Capture "<number><unit>" or "<number> <unit>" with optional decimal /
# fraction. Examples: "33.8 oz", "500ml", "1.5L", "12 ct", "2-pack".
_SIZE_RE = re.compile(
    r"(?P<num>\d+(?:[.,]\d+)?)\s*[-]?\s*"
    r"(?P<unit>fl\s*oz|fluid\s*oz|ml|millilit(?:re|er)s?|"
    r"lit(?:re|er)s?|l|kg|kilograms?|g|grams?|oz|ounces?|"
    r"lb|lbs|pounds?|ct|count|pcs|pieces?|pack|in|inch(?:es)?|cm|mm)\b",
    re.IGNORECASE,
)

# Strip URL noise (query strings, tracking params, trailing slashes).
_URL_TRACKING_PARAM = re.compile(
    r"[?&](?:utm_[^=]+|tag|ref|ref_|psc|pf_rd_[^=]+|pd_rd_[^=]+|"
    r"qid|sr|spIA|content-id|sprefix|crid|keywords)=[^&]*",
    re.IGNORECASE,
)


# ── Public dataclass ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CanonicalId:
    """Resolved canonical identity for a product.

    Attributes:
        product_id: Stable string ID (~16 hex chars). Use as DynamoDB PK.
        confidence: "high" (barcode), "medium" (brand+title+size), "low"
            (title-only fallback).
        source: Which signal produced the ID — useful for debugging.
        normalized_brand: Empty if brand was missing.
        normalized_title: Lowercased, noise-stripped, single-spaced.
        size_token: e.g. "33.8oz". Empty if no size could be parsed.
    """

    product_id: str
    confidence: str
    source: str
    normalized_brand: str
    normalized_title: str
    size_token: str


# ── Normalization helpers (pure) ────────────────────────────────────────────


def _strip_accents(s: str) -> str:
    """Drop diacritics so 'Café' and 'Cafe' compare equal.

    NFD (not NFKD) preserves compatibility chars like ™/® as their original
    codepoints — otherwise they'd decompose to ASCII 'TM'/'R' and survive
    the symbol-strip step in :func:`normalize_text`.
    """
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if not unicodedata.combining(c)
    )


def normalize_text(s: str) -> str:
    """Lowercase, strip accents, collapse whitespace, drop punctuation."""
    # Strip trademark/copyright glyphs first so they don't survive any
    # later compatibility decomposition.
    s = re.sub(r"[\u00ae\u00a9\u2122]", "", s or "")
    s = _strip_accents(s).lower()
    s = re.sub(r"[^a-z0-9\s\.\-/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_brand(brand: str) -> str:
    """Brand normalization — strip suffixes like 'Inc', 'LLC' and punctuation."""
    b = normalize_text(brand)
    b = re.sub(r"\b(inc|llc|ltd|co|corp|corporation|company)\b\.?", "", b)
    return re.sub(r"\s+", " ", b).strip()


def extract_size(text: str) -> str:
    """Parse the FIRST size token from text and emit a canonical form.

    Examples:
        "Biolage Shampoo 33.8 oz"   -> "33.8oz"
        "Lays Chips 500ml Pack"      -> "500ml"
        "Bandages 12 count"          -> "12ct"
        "No size here"               -> ""
    """
    if not text:
        return ""
    m = _SIZE_RE.search(text)
    if not m:
        return ""
    num = m.group("num").replace(",", ".")
    unit_raw = re.sub(r"\s+", " ", m.group("unit").lower())
    unit = _SIZE_UNITS.get(unit_raw, unit_raw.replace(" ", ""))
    # Normalize "1.0" -> "1", "33.80" -> "33.8"
    try:
        f = float(num)
        if f.is_integer():
            num = str(int(f))
        else:
            num = ("%g" % f)
    except ValueError:
        pass
    return f"{num}{unit}"


def normalize_title(title: str, brand: str = "") -> str:
    """Lowercase, drop noise tokens and size token, collapse whitespace.

    The size is removed from the title because we hash it as its own field.
    Keeping it in both places would cause "500ml" vs "0.5L" near-duplicates
    to collide unnecessarily.

    If ``brand`` is given (already normalized), its tokens are also stripped
    so that "Matrix Biolage Shampoo" and "Biolage Shampoo" (when brand is
    "Matrix") fingerprint identically.
    """
    t = normalize_text(title)
    # Remove the size span so it doesn't pollute the title fingerprint.
    t = _SIZE_RE.sub(" ", t)
    brand_tokens = set(brand.split()) if brand else set()
    tokens = [
        tok for tok in t.split()
        if tok and tok not in _NOISE_TOKENS and tok not in brand_tokens
    ]
    return " ".join(tokens)


# ── Barcode helpers ─────────────────────────────────────────────────────────


def is_valid_barcode(code: str) -> bool:
    """Check shape only (8/12/13/14 digits). We do not verify the check
    digit — upstream extractors are noisy and a bad check digit is still
    a useful (if weaker) signal."""
    if not code:
        return False
    cleaned = re.sub(r"\s+", "", code)
    return bool(_BARCODE_RE.match(cleaned))


def normalize_barcode(code: str) -> str:
    """Strip whitespace, return digits only."""
    return re.sub(r"\D", "", code or "")


# ── Hashing ─────────────────────────────────────────────────────────────────


def _hash16(payload: str) -> str:
    """Return first 16 hex chars of SHA-256 — collision-resistant enough
    for a product cache (2^64 keyspace). Short enough to be a comfortable
    DynamoDB partition key."""
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# ── Public API ──────────────────────────────────────────────────────────────


def canonicalize(
    title: str,
    brand: str = "",
    barcode: str = "",
    asin: str = "",
    size_hint: str = "",
) -> CanonicalId:
    """Resolve a product to a canonical ID.

    Args:
        title: Required. The product title from the page.
        brand: Optional but strongly preferred. Without brand, fingerprint
            confidence drops to "low".
        barcode: Optional UPC/EAN/GTIN. If valid, we use it directly and
            skip everything else — highest confidence.
        asin: Optional Amazon ASIN (or other platform SKU). Used when we
            have a marketplace-stable ID but no barcode.
        size_hint: Optional explicit size string (e.g. "33.8 oz"). When
            given, we prefer it over whatever we can parse from the title.

    Returns:
        CanonicalId — never raises; falls back to title-only when needed.
    """
    # 1. Barcode wins when it exists and is shaped correctly.
    bc = normalize_barcode(barcode)
    if is_valid_barcode(bc):
        return CanonicalId(
            product_id=f"bc_{_hash16(bc)}",
            confidence="high",
            source="barcode",
            normalized_brand=normalize_brand(brand),
            normalized_title=normalize_title(title),
            size_token=extract_size(size_hint or title),
        )

    # 2. Marketplace SKU / ASIN — second-best stable identifier.
    asin_clean = re.sub(r"[^A-Z0-9]", "", (asin or "").upper())
    if asin_clean and len(asin_clean) >= 8:
        return CanonicalId(
            product_id=f"as_{_hash16(asin_clean)}",
            confidence="high",
            source="asin",
            normalized_brand=normalize_brand(brand),
            normalized_title=normalize_title(title),
            size_token=extract_size(size_hint or title),
        )

    # 3. Brand + title + size fingerprint.
    nb = normalize_brand(brand)
    nt = normalize_title(title, brand=nb)
    sz = extract_size(size_hint or title)

    if nb and nt:
        # Collapse all whitespace in the brand for the hash so that
        # "l oreal" and "loreal" (different spellings of the same brand)
        # produce the same payload. We keep the spaced form in the public
        # ``normalized_brand`` field for human debugging.
        brand_key = re.sub(r"\s+", "", nb)
        payload = f"{brand_key}|{nt}|{sz}"
        return CanonicalId(
            product_id=f"bt_{_hash16(payload)}",
            confidence="medium",
            source="brand_title_size",
            normalized_brand=nb,
            normalized_title=nt,
            size_token=sz,
        )

    # 4. Title-only fallback. Low confidence; downstream code should mark
    #    the cache row for re-resolution as soon as a brand or barcode shows up.
    payload = f"{nt}|{sz}"
    return CanonicalId(
        product_id=f"tt_{_hash16(payload)}",
        confidence="low",
        source="title_only",
        normalized_brand="",
        normalized_title=nt,
        size_token=sz,
    )


def canonicalize_product(product: dict) -> CanonicalId:
    """Convenience wrapper that accepts a ProductData-shaped dict.

    Tolerates missing fields and the camelCase keys the Chrome extension
    sends (e.g. ``imageUrl``, ``reviewCount``).
    """
    return canonicalize(
        title=product.get("title", "") or "",
        brand=product.get("brand", "") or "",
        barcode=product.get("barcode", "") or "",
        asin=product.get("asin", "")
        or product.get("sku", "")
        or _extract_asin_from_url(product.get("url", "") or ""),
        size_hint=product.get("size", "") or "",
    )


def _extract_asin_from_url(url: str) -> str:
    """Pull an Amazon ASIN out of a URL (best effort)."""
    if not url:
        return ""
    m = re.search(
        r"/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})(?:[/?]|$)",
        url,
    )
    return m.group(1) if m else ""
