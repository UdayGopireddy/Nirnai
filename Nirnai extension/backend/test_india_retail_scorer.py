"""Tests for india_retail_scorer."""

from india_retail_scorer import (
    convenience_score,
    score_india_retail,
    trust_score,
)
from models import ProductData


# ── trust_score ──

class TestTrustScore:
    def test_amazon_fulfiller(self):
        p = ProductData(
            title="x", country="IN", price="₹999",
            fulfiller="Amazon", seller="ThirdPartyShop", reviewCount="500",
        )
        assert trust_score(p) >= 65

    def test_cloudtail_seller(self):
        p = ProductData(
            title="x", country="IN", price="₹999",
            seller="Cloudtail India", reviewCount="500",
        )
        assert trust_score(p) >= 65

    def test_low_reviews_penalty(self):
        p = ProductData(title="x", country="IN", price="₹999", reviewCount="5")
        assert trust_score(p) < 50

    def test_high_reviews_bonus(self):
        p = ProductData(title="x", country="IN", price="₹999", reviewCount="50000")
        assert trust_score(p) >= 60


# ── convenience_score ──

class TestConvenienceScore:
    def test_full_convenience(self):
        p = ProductData(
            title="x", country="IN", price="₹999",
            cod_available=True, emi_no_cost=True,
            shipping_cost="FREE", delivery="Get it tomorrow",
        )
        # 50 + 15 + 15 + 10 + 10 = 100
        assert convenience_score(p) == 100

    def test_paid_shipping_penalty(self):
        p = ProductData(title="x", country="IN", price="₹999", shipping_cost="₹40")
        assert convenience_score(p) < 50

    def test_no_signals_neutral(self):
        p = ProductData(title="x", country="IN", price="₹999")
        # +10 for empty shipping (treated as "free / unknown")
        assert convenience_score(p) == 60


# ── score_india_retail ──

class TestScoreIndiaRetail:
    def test_great_deal(self):
        """Cheap vs market, trusted seller, full convenience -> high score."""
        p = ProductData(
            title="Hitachi 1.5 Ton Inverter AC",
            brand="Hitachi",
            country="IN",
            price="₹39,999",
            mrp="₹65,000",
            bank_offers=["10% off on HDFC Cards up to ₹1500"],
            coupon="",
            shipping_cost="FREE",
            cod_available=True,
            emi_no_cost=True,
            seller="Cloudtail India",
            fulfiller="Amazon",
            reviewCount="12000",
            rating="4.3 out of 5",
        )
        result = score_india_retail(p, median_effective_price=42_000.0)
        assert result.purchase_score >= 70
        assert result.pricing.effective < result.pricing.sticker
        assert result.pricing.bank_discount > 0
        assert any("save" in r.lower() for r in result.reasons)

    def test_terrible_price(self):
        """Effective price way above median -> low score even with trust."""
        p = ProductData(
            title="x",
            country="IN",
            price="₹50,000",
            mrp="₹50,000",
            seller="Cloudtail India",
            fulfiller="Amazon",
            reviewCount="12000",
            cod_available=True,
            emi_no_cost=True,
        )
        result = score_india_retail(p, median_effective_price=30_000.0)
        # Multiplicative: bad price drags down trust + convenience.
        assert result.purchase_score < 60

    def test_no_median_falls_back_to_mrp(self):
        p = ProductData(
            title="x",
            country="IN",
            price="₹500",
            mrp="₹1000",  # 50% off MRP
            cod_available=True,
            shipping_cost="FREE",
        )
        result = score_india_retail(p, median_effective_price=None)
        # MRP path should give some lift
        assert result.purchase_score >= 40

    def test_breakdown_shape(self):
        p = ProductData(title="x", country="IN", price="₹999")
        result = score_india_retail(p, median_effective_price=None)
        assert hasattr(result.breakdown, "price")
        assert hasattr(result.breakdown, "seller")
        assert hasattr(result.breakdown, "delivery")

    def test_empty_price_doesnt_crash(self):
        p = ProductData(title="x", country="IN", price="")
        result = score_india_retail(p, median_effective_price=None)
        assert 0 <= result.purchase_score <= 100
