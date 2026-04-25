"""Tests for product_cache. No AWS — uses MemoryBackend.

Run: cd 'Nirnai extension/backend' && python3 -m pytest test_product_cache.py -v
"""
from __future__ import annotations

import time

import pytest

from canonical_id import canonicalize_product
from product_cache import (
    MemoryBackend,
    ProductCache,
    ProductRecord,
    merge_record,
    record_from_canonical,
)


# ── Pure merge logic ────────────────────────────────────────────────────────


class TestMergeRecord:
    def _base(self, **kwargs):
        defaults = dict(product_id="bc_abc", confidence="medium", source="brand_title_size")
        defaults.update(kwargs)
        return ProductRecord(**defaults)

    def test_higher_confidence_wins_identity_fields(self):
        old = self._base(
            confidence="medium",
            source="brand_title_size",
            normalized_brand="loose",
            normalized_title="loose title",
        )
        new = self._base(
            confidence="high",
            source="barcode",
            normalized_brand="exact",
            normalized_title="exact title",
        )
        merged = merge_record(old, new)
        assert merged.confidence == "high"
        assert merged.source == "barcode"
        assert merged.normalized_brand == "exact"

    def test_lower_confidence_does_not_overwrite(self):
        old = self._base(confidence="high", source="barcode", normalized_brand="solid")
        new = self._base(confidence="low", source="title_only", normalized_brand="weak")
        merged = merge_record(old, new)
        assert merged.confidence == "high"
        assert merged.source == "barcode"
        assert merged.normalized_brand == "solid"

    def test_barcodes_and_asins_unioned(self):
        old = self._base(barcodes=["111"], asins=["A1"])
        new = self._base(barcodes=["111", "222"], asins=["A2"])
        merged = merge_record(old, new)
        assert merged.barcodes == ["111", "222"]
        assert merged.asins == ["A1", "A2"]

    def test_static_features_blank_does_not_clobber(self):
        # The bug we want to prevent: regex parser fills brand="" and would
        # otherwise wipe a real cached brand.
        old = self._base(static_features={"brand": "Matrix", "ingredients": "[...]"})
        new = self._base(static_features={"brand": "", "category": "personal_care"})
        merged = merge_record(old, new)
        assert merged.static_features["brand"] == "Matrix"
        assert merged.static_features["ingredients"] == "[...]"
        assert merged.static_features["category"] == "personal_care"

    def test_static_features_non_blank_does_overwrite(self):
        old = self._base(static_features={"category": "unknown"})
        new = self._base(static_features={"category": "personal_care"})
        merged = merge_record(old, new)
        assert merged.static_features["category"] == "personal_care"

    def test_score_cache_newer_wins(self):
        old = self._base(
            score_cache={"purchase_score": 40, "health_score": 50, "scored_at": 100}
        )
        new = self._base(
            score_cache={"purchase_score": 57, "health_score": 67, "scored_at": 200}
        )
        merged = merge_record(old, new)
        assert merged.score_cache["purchase_score"] == 57
        assert merged.score_cache["scored_at"] == 200

    def test_score_cache_older_does_not_win(self):
        old = self._base(
            score_cache={"purchase_score": 57, "health_score": 67, "scored_at": 200}
        )
        new = self._base(
            score_cache={"purchase_score": 40, "health_score": 50, "scored_at": 100}
        )
        merged = merge_record(old, new)
        assert merged.score_cache["purchase_score"] == 57

    def test_known_listings_dedupe_by_platform_url(self):
        old = self._base(
            known_listings=[
                {"platform": "walmart", "url": "/a", "last_seen": 100},
                {"platform": "amazon", "url": "/b", "last_seen": 110},
            ]
        )
        new = self._base(
            known_listings=[
                {"platform": "walmart", "url": "/a", "last_seen": 200},  # newer
                {"platform": "target", "url": "/c", "last_seen": 150},
            ]
        )
        merged = merge_record(old, new)
        assert len(merged.known_listings) == 3
        walmart = next(l for l in merged.known_listings if l["platform"] == "walmart")
        assert walmart["last_seen"] == 200  # newer ts kept

    def test_created_at_keeps_oldest_nonzero(self):
        old = self._base(created_at=1000, updated_at=1500)
        new = self._base(created_at=2000, updated_at=2500)
        merged = merge_record(old, new)
        assert merged.created_at == 1000
        assert merged.updated_at >= 2500

    def test_mismatched_ids_raises(self):
        a = ProductRecord(product_id="bc_a")
        b = ProductRecord(product_id="bc_b")
        with pytest.raises(ValueError):
            merge_record(a, b)


# ── record_from_canonical ──────────────────────────────────────────────────


class TestRecordFromCanonical:
    def test_extracts_static_fields(self):
        product = {
            "title": "Matrix Biolage Hydrasource Shampoo - 33.8 oz",
            "brand": "Matrix",
            "barcode": "884486520777",
            "url": "https://www.walmart.com/ip/foo",
            "source_site": "walmart.com",
            "ingredients": ["water", "sodium laureth sulfate"],
            "category": "personal_care",
        }
        canonical = canonicalize_product(product)
        rec = record_from_canonical(canonical, product)
        assert rec.product_id == canonical.product_id
        assert rec.barcodes == ["884486520777"]
        assert rec.static_features["brand"] == "Matrix"
        assert rec.static_features["category"] == "personal_care"
        # Ingredients JSON-serialized for DynamoDB friendliness.
        assert isinstance(rec.static_features["ingredients"], str)
        assert "water" in rec.static_features["ingredients"]
        assert rec.known_listings[0]["platform"] == "walmart.com"

    def test_omits_blank_features(self):
        product = {"title": "Plain Product 250ml"}
        canonical = canonicalize_product(product)
        rec = record_from_canonical(canonical, product)
        # No brand, no category — those keys must not be present (so they
        # can't later overwrite real cached data with empty strings).
        assert "brand" not in rec.static_features
        assert "category" not in rec.static_features
        assert rec.barcodes == []


# ── Read-through cache via MemoryBackend ────────────────────────────────────


@pytest.fixture
def cache():
    return ProductCache(MemoryBackend())


class TestProductCacheRoundTrip:
    def test_first_remember_is_a_miss(self, cache):
        product = {
            "title": "Biolage Hydrasource Shampoo 33.8 oz",
            "brand": "Matrix",
            "barcode": "884486520777",
            "url": "https://www.walmart.com/ip/foo",
            "source_site": "walmart.com",
            "ingredients": ["water"],
        }
        rec, hit = cache.remember_product(product)
        assert hit is False
        assert rec.confidence == "high"
        assert rec.barcodes == ["884486520777"]

    def test_second_remember_hits_and_merges(self, cache):
        # Walmart sees it first with ingredients.
        cache.remember_product({
            "title": "Matrix Biolage Shampoo 33.8 oz",
            "brand": "Matrix",
            "barcode": "884486520777",
            "url": "https://www.walmart.com/ip/foo",
            "source_site": "walmart.com",
            "ingredients": ["water", "sls"],
        })
        # Amazon then sees the same UPC but its scraper missed ingredients.
        rec, hit = cache.remember_product({
            "title": "Biolage Scalp Sync Shampoo 33.8 Fl Oz",
            "brand": "Biolage",
            "barcode": "884486520777",
            "url": "https://www.amazon.com/dp/B08XYZ",
            "source_site": "amazon.com",
            "asin": "B08XYZ1234",
        })
        assert hit is True
        # Ingredients survived even though Amazon didn't supply them.
        assert "water" in rec.static_features["ingredients"]
        # Both platforms now in known_listings.
        platforms = {l["platform"] for l in rec.known_listings}
        assert {"walmart.com", "amazon.com"}.issubset(platforms)
        # ASIN merged in.
        assert "B08XYZ1234" in rec.asins

    def test_record_score_persists(self, cache):
        product = {
            "title": "Test Product 100ml",
            "brand": "Acme",
            "barcode": "123456789012",
        }
        rec, _ = cache.remember_product(product)
        updated = cache.record_score(rec.product_id, purchase_score=57, health_score=67)
        assert updated is not None
        assert updated.score_cache["purchase_score"] == 57
        assert updated.score_cache["health_score"] == 67
        # Verify it's actually in the backend, not just the returned object.
        again = cache.get(rec.product_id)
        assert again.score_cache["purchase_score"] == 57

    def test_record_score_on_unknown_id_returns_none(self, cache):
        assert cache.record_score("bc_does_not_exist", 10, 10) is None

    def test_get_unknown_returns_none(self, cache):
        assert cache.get("bc_does_not_exist") is None

    def test_dynamodb_item_is_serializable(self, cache):
        # The whole point of MemoryBackend storing dicts is to prove our
        # to_item() output is plain JSON-types so DynamoDB will accept it.
        import json
        product = {
            "title": "Foo 100ml",
            "brand": "Acme",
            "barcode": "123456789012",
            "ingredients": ["a", "b"],
        }
        rec, _ = cache.remember_product(product)
        item = rec.to_item()
        # Round-trip through JSON to prove no exotic types snuck in.
        json.dumps(item)


class TestRegressionBiolageBugClass:
    """The specific scenario that motivated this whole cache: same product
    on two platforms, ingredients-bearing payload arrives second. The cache
    must NOT lose the earlier ingredients data."""

    def test_walmart_then_amazon_keeps_ingredients(self, cache):
        cache.remember_product({
            "title": "Matrix Biolage Hydrasource Shampoo 33.8 oz",
            "brand": "Matrix",
            "barcode": "884486520777",
            "ingredients": ["water", "cocamidopropyl betaine"],
            "category": "personal_care",
            "url": "https://walmart.com/ip/x",
            "source_site": "walmart.com",
        })
        # Amazon page — "stripped down" payload like the regex-parser bug.
        rec, _ = cache.remember_product({
            "title": "Biolage Hydrasource Shampoo 33.8 Fl Oz",
            "brand": "",          # missing
            "barcode": "884486520777",
            "ingredients": "",    # missing
            "category": "",       # missing
            "url": "https://amazon.com/dp/B0XYZ",
            "source_site": "amazon.com",
        })
        # All the original Walmart-sourced static data must still be there.
        assert rec.static_features.get("brand") == "Matrix"
        assert rec.static_features.get("category") == "personal_care"
        assert "water" in rec.static_features.get("ingredients", "")
