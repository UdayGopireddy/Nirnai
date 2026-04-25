"""Tests for compute_recheck — the pure decision function behind
POST /products/recheck."""
from __future__ import annotations

import time

import pytest

from product_cache import (
    MemoryBackend,
    ProductCache,
    ProductRecord,
    compute_recheck,
)


def _record_with(price: str, currency: str = "$", scored_at: int | None = None) -> ProductRecord:
    return ProductRecord(
        product_id="bc_test",
        confidence="high",
        source="barcode",
        score_cache={
            "purchase_score": 60,
            "health_score": 70,
            "scored_at": scored_at if scored_at is not None else int(time.time()),
            "last_price": price,
            "last_currency": currency,
        },
    )


class TestComputeRecheckMissingData:
    def test_no_record_is_unknown(self):
        r = compute_recheck(None, "$10")
        assert r.warn_level == "unknown"
        assert r.stable is True
        assert r.last_price == ""

    def test_record_without_price_is_unknown(self):
        rec = ProductRecord(product_id="bc_x", score_cache={"scored_at": 1})
        r = compute_recheck(rec, "$10")
        assert r.warn_level == "unknown"

    def test_unparseable_shown_price_is_unknown(self):
        rec = _record_with("$10.00")
        r = compute_recheck(rec, "see price in cart")
        assert r.warn_level == "unknown"


class TestComputeRecheckDriftThreshold:
    def test_zero_drift_is_stable(self):
        rec = _record_with("$10.00")
        r = compute_recheck(rec, "$10.00")
        assert r.warn_level == "none"
        assert r.stable is True
        assert r.drift_pct == pytest.approx(0.0)

    def test_below_threshold_is_stable(self):
        rec = _record_with("$10.00")
        r = compute_recheck(rec, "$10.50", threshold_pct=10.0)  # +5%
        assert r.warn_level == "none"
        assert r.stable is True

    def test_at_threshold_warns(self):
        rec = _record_with("$10.00")
        r = compute_recheck(rec, "$11.00", threshold_pct=10.0)  # +10%
        assert r.warn_level == "warn"
        assert r.stable is False
        assert "up" in r.message

    def test_above_threshold_down_warns(self):
        rec = _record_with("$10.00")
        r = compute_recheck(rec, "$8.00", threshold_pct=10.0)  # -20%
        assert r.warn_level == "warn"
        assert r.stable is False
        assert "down" in r.message

    def test_currency_symbol_stripped(self):
        rec = _record_with("$1,299.00")
        r = compute_recheck(rec, "$1,300.00")
        assert r.warn_level == "none"

    def test_custom_threshold(self):
        rec = _record_with("$100")
        # 3% drift, threshold 2% → warn
        r = compute_recheck(rec, "$103", threshold_pct=2.0)
        assert r.warn_level == "warn"


class TestComputeRecheckStaleness:
    def test_fresh_score_no_info(self):
        # scored 1 minute ago, no drift
        rec = _record_with("$10", scored_at=int(time.time()) - 60)
        r = compute_recheck(rec, "$10")
        assert r.warn_level == "none"

    def test_stale_score_with_no_drift_emits_info(self):
        # scored 3 days ago, no drift
        rec = _record_with("$10", scored_at=int(time.time()) - 3 * 86400)
        r = compute_recheck(rec, "$10")
        assert r.warn_level == "info"
        assert r.stable is True
        assert "day" in r.message

    def test_stale_AND_drifted_still_warns(self):
        rec = _record_with("$10", scored_at=int(time.time()) - 3 * 86400)
        r = compute_recheck(rec, "$15", threshold_pct=10.0)
        # Drift wins over staleness — warn level is the stronger signal.
        assert r.warn_level == "warn"
        assert r.stable is False

    def test_now_secs_override_for_determinism(self):
        # Use explicit now to avoid wall-clock flakiness.
        rec = _record_with("$10", scored_at=1_000)
        r = compute_recheck(rec, "$10", stale_secs=100, now_secs=2_000)
        assert r.warn_level == "info"
        assert r.scored_secs_ago == 1_000


class TestComputeRecheckEndToEnd:
    """Round-trip: write via cache, read via recheck."""

    def test_write_then_recheck_stable(self):
        cache = ProductCache(MemoryBackend())
        product = {
            "title": "Acme Cleanser 500ml",
            "brand": "Acme",
            "barcode": "123456789012",
            "price": "$12.99",
            "currency": "$",
        }
        rec, _ = cache.remember_product(product)
        cache.record_score(
            rec.product_id, 65, 70,
            extras={"last_price": "$12.99", "last_currency": "$"},
        )

        # Same price → stable
        fresh = cache.get(rec.product_id)
        r = compute_recheck(fresh, "$12.99")
        assert r.warn_level == "none"

        # Big price jump → warn
        r2 = compute_recheck(fresh, "$18.50")
        assert r2.warn_level == "warn"
        assert r2.drift_pct > 10
