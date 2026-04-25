"""Unit tests for canonical_id — the foundation of the product cache.

Run: cd 'Nirnai extension/backend' && python3 -m pytest test_canonical_id.py -v

These tests encode the behavioral contract the cache will rely on. Two
products that *should* be the same product must produce the same
``product_id``; two that should not, must not.
"""
from __future__ import annotations

import pytest

from canonical_id import (
    CanonicalId,
    canonicalize,
    canonicalize_product,
    extract_size,
    is_valid_barcode,
    normalize_barcode,
    normalize_brand,
    normalize_title,
)


# ── normalization primitives ────────────────────────────────────────────────


class TestNormalizeBrand:
    def test_lowercases(self):
        assert normalize_brand("Procter & Gamble") == "procter gamble"

    def test_strips_legal_suffixes(self):
        assert normalize_brand("Acme Inc.") == "acme"
        assert normalize_brand("Acme LLC") == "acme"
        assert normalize_brand("Acme Corporation") == "acme"

    def test_handles_accents(self):
        assert normalize_brand("L'Oréal") == "l oreal"

    def test_blank(self):
        assert normalize_brand("") == ""
        assert normalize_brand("   ") == ""


class TestExtractSize:
    @pytest.mark.parametrize("text, expected", [
        ("Biolage Hydrasource Shampoo 33.8 oz", "33.8oz"),
        ("Lays Chips 500ml Pack",                "500ml"),
        ("Pure Water 1.5L Bottle",               "1.5l"),
        ("Bandages 12 count box",                "12ct"),
        ("Salt 1 kg",                            "1kg"),
        ("USB cable 6 ft",                       ""),  # 'ft' not in unit map
        ("Notebook 8.5 in by 11 in",             "8.5in"),
        ("Lotion 6.7 fl oz pump",                "6.7oz"),
        ("Pasta 16 ounces",                      "16oz"),
        ("Steak 2 pounds",                       "2lb"),
        ("",                                      ""),
        ("No size mentioned",                     ""),
    ])
    def test_extracts(self, text, expected):
        assert extract_size(text) == expected

    def test_decimal_normalization(self):
        # "1.0 oz" should not become "1.0oz" — strip trailing zero.
        assert extract_size("Cream 1.0 oz") == "1oz"
        # European comma decimal
        assert extract_size("Crème 1,5 l") == "1.5l"


class TestNormalizeTitle:
    def test_drops_noise_tokens(self):
        # "New", "Pack", "Best Seller" should all vanish.
        assert "new" not in normalize_title("Acme Cleaner New Pack")
        assert "pack" not in normalize_title("Acme Cleaner New Pack")

    def test_size_removed_from_title(self):
        # Size lives in its own field; don't double-count it.
        out = normalize_title("Biolage Shampoo 33.8 oz")
        assert "33.8" not in out and "oz" not in out

    def test_punctuation_stripped(self):
        assert normalize_title("Hello, World! (Premium)") == "hello world"

    def test_trademark_symbols(self):
        assert normalize_title("Crest® Pro-Health™") == "crest pro-health"


# ── barcodes ────────────────────────────────────────────────────────────────


class TestBarcode:
    @pytest.mark.parametrize("code, valid", [
        ("12345678",         True),    # EAN-8
        ("123456789012",     True),    # UPC-A
        ("1234567890123",    True),    # EAN-13
        ("12345678901234",   True),    # GTIN-14
        ("12345",            False),
        ("ABCDEFGH",         False),
        ("",                 False),
        ("12345 67890 12",   True),    # whitespace ok
    ])
    def test_validity(self, code, valid):
        assert is_valid_barcode(code) is valid

    def test_normalize_strips_whitespace_and_letters(self):
        assert normalize_barcode("  123 456 789 012  ") == "123456789012"
        assert normalize_barcode("UPC: 884486520777") == "884486520777"


# ── core canonicalization behavior ──────────────────────────────────────────


class TestCanonicalize:
    def test_barcode_wins_over_everything(self):
        # Same barcode on Walmart vs Amazon must produce the same ID even
        # if the titles and brands differ slightly.
        a = canonicalize(
            title="Matrix Biolage Hydrasource Shampoo 33.8 oz",
            brand="Matrix",
            barcode="884486520777",
        )
        b = canonicalize(
            title="Biolage Hydrasource Shampoo by Matrix - 33.8oz Salon Size",
            brand="Biolage",  # different brand string
            barcode="884486520777",
        )
        assert a.product_id == b.product_id
        assert a.confidence == "high"
        assert a.source == "barcode"

    def test_asin_used_when_no_barcode(self):
        a = canonicalize(title="Anything", asin="B081KL2QYJ")
        assert a.product_id.startswith("as_")
        assert a.confidence == "high"

    def test_brand_title_size_fingerprint_stable(self):
        a = canonicalize(
            title="Biolage Hydrasource Shampoo 33.8 oz",
            brand="Matrix",
        )
        b = canonicalize(
            title="Biolage Hydrasource Shampoo 33.8oz",  # no space
            brand="Matrix",
        )
        c = canonicalize(
            title="Matrix Biolage Hydrasource Shampoo 33.8 oz NEW PACK",
            brand="Matrix",
        )
        assert a.product_id == b.product_id == c.product_id
        assert a.confidence == "medium"
        assert a.source == "brand_title_size"

    def test_different_size_yields_different_id(self):
        # 13.5 oz and 33.8 oz are *different* SKUs of the same product line.
        small = canonicalize(
            title="Biolage Hydrasource Shampoo 13.5 oz", brand="Matrix",
        )
        large = canonicalize(
            title="Biolage Hydrasource Shampoo 33.8 oz", brand="Matrix",
        )
        assert small.product_id != large.product_id

    def test_different_brand_yields_different_id(self):
        a = canonicalize(title="Anti-Dandruff Shampoo", brand="Nizoral")
        b = canonicalize(title="Anti-Dandruff Shampoo", brand="Head Shoulders")
        assert a.product_id != b.product_id

    def test_title_only_fallback(self):
        # No brand, no barcode, no SKU — degraded but not crashing.
        c = canonicalize(title="Generic Product Name 250ml")
        assert c.confidence == "low"
        assert c.source == "title_only"
        assert c.product_id.startswith("tt_")

    def test_empty_title_does_not_crash(self):
        c = canonicalize(title="")
        # Empty title -> still a stable (if useless) hash; no exception.
        assert c.product_id.startswith("tt_")

    def test_brand_normalization_collapses_punctuation(self):
        a = canonicalize(title="Cleanser 500ml", brand="L'Oréal Paris")
        b = canonicalize(title="Cleanser 500ml", brand="LOreal Paris")
        # Loose match — both end up with normalized "l oreal paris".
        assert a.product_id == b.product_id

    def test_asin_extracted_from_url_when_field_missing(self):
        c = canonicalize_product({
            "title": "Whatever",
            "url": "https://www.amazon.com/dp/B07XYZ1234?tag=foo-20",
        })
        assert c.source == "asin"


# ── real-world regression cases (lifted from sessions we've seen) ───────────


class TestRealWorldCases:
    """Cases drawn from actual NirnAI sessions. If any of these change
    behavior, downstream cache hit/miss rates change too — review carefully."""

    def test_matrix_biolage_walmart_vs_amazon(self):
        # The bug we shipped today: same product, different platforms,
        # different ProductData snapshots → different scores. With a cache
        # they MUST collapse to one canonical ID.
        walmart = canonicalize_product({
            "title": "Matrix Biolage Anti-Dandruff Scalp Sync Shampoo - 33.8 oz",
            "brand": "Matrix",
            "url": "https://www.walmart.com/ip/Matrix-Biolage-.../5333786149",
            "barcode": "884486520777",
        })
        amazon = canonicalize_product({
            "title": "Biolage Scalp Sync Anti-Dandruff Shampoo, 33.8 Fl Oz",
            "brand": "Biolage",
            "url": "https://www.amazon.com/dp/B08XYZ/?tag=nirnai-20",
            "barcode": "884486520777",
        })
        assert walmart.product_id == amazon.product_id

    def test_amazon_ad_panoxyl_extracts_asin(self):
        # PanOxyl page from the earlier screenshot.
        c = canonicalize_product({
            "title": "PanOxyl 10% Benzoyl Peroxide Acne Foaming Wash, 5.5 Oz Tube",
            "brand": "PanOxyl",
            "url": "https://www.amazon.com/PanOxyl-Foaming-.../dp/B081KL2QYJ?pd_rd_w=v5OJK",
        })
        assert c.source == "asin"
        assert c.confidence == "high"

    def test_no_size_in_title_still_canonicalizes(self):
        # Hotels/services don't have sizes — fingerprint should still work.
        c = canonicalize(title="Hotel South Tampa & Suites", brand="")
        assert c.confidence == "low"
        assert c.product_id.startswith("tt_")
