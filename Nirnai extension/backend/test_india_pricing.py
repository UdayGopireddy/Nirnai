"""Tests for india_pricing pure functions."""

from india_pricing import (
    BankOffer,
    best_bank_discount,
    combined_price_score,
    compute_effective_price,
    parse_bank_offer,
    parse_coupon,
    parse_inr,
    parse_shipping,
    price_score_vs_median,
    price_score_vs_mrp,
)


# ── parse_inr ──

class TestParseInr:
    def test_rupee_symbol(self):
        assert parse_inr("₹2,599") == 2599.0

    def test_rs_prefix(self):
        assert parse_inr("Rs. 2,599") == 2599.0

    def test_inr_prefix(self):
        assert parse_inr("INR 2599.50") == 2599.50

    def test_plain_digits(self):
        assert parse_inr("2599") == 2599.0

    def test_empty(self):
        assert parse_inr("") is None

    def test_junk(self):
        assert parse_inr("not a price") is None

    def test_decimal(self):
        assert parse_inr("₹1,234.56") == 1234.56


# ── parse_shipping ──

class TestParseShipping:
    def test_free_explicit(self):
        assert parse_shipping("FREE") == 0.0

    def test_free_lowercase(self):
        assert parse_shipping("free shipping") == 0.0

    def test_explicit_amount(self):
        assert parse_shipping("₹40") == 40.0

    def test_empty(self):
        assert parse_shipping("") == 0.0

    def test_junk_returns_zero(self):
        assert parse_shipping("delivery info") == 0.0


# ── parse_bank_offer ──

class TestParseBankOffer:
    def test_percent_with_cap(self):
        o = parse_bank_offer("10% Instant Discount on HDFC Cards up to ₹500")
        assert o.percent_off == 10.0
        assert o.cap_inr == 500.0
        assert o.flat_off == 0.0

    def test_percent_without_cap(self):
        o = parse_bank_offer("5% off on SBI Credit Cards")
        assert o.percent_off == 5.0
        assert o.cap_inr is None

    def test_flat_off(self):
        o = parse_bank_offer("₹1500 off on Axis Bank Cards")
        assert o.flat_off == 1500.0
        assert o.percent_off == 0.0

    def test_max_synonym(self):
        o = parse_bank_offer("7.5% cashback, max ₹250")
        assert o.percent_off == 7.5
        assert o.cap_inr == 250.0

    def test_empty(self):
        o = parse_bank_offer("")
        assert o.percent_off == 0.0
        assert o.cap_inr is None
        assert o.flat_off == 0.0


# ── BankOffer.discount_on ──

class TestBankOfferDiscount:
    def test_percent_under_cap(self):
        o = BankOffer(raw="", percent_off=10, cap_inr=500)
        assert o.discount_on(2000) == 200.0  # 10% of 2000 < 500 cap

    def test_percent_capped(self):
        o = BankOffer(raw="", percent_off=10, cap_inr=500)
        assert o.discount_on(10_000) == 500.0  # 1000 capped to 500

    def test_no_cap(self):
        o = BankOffer(raw="", percent_off=5, cap_inr=None)
        assert o.discount_on(2000) == 100.0

    def test_flat(self):
        o = BankOffer(raw="", flat_off=1500)
        assert o.discount_on(5000) == 1500.0

    def test_flat_exceeds_sticker(self):
        o = BankOffer(raw="", flat_off=10_000)
        assert o.discount_on(2000) == 2000.0  # never exceeds sticker

    def test_zero_sticker(self):
        o = BankOffer(raw="", percent_off=10, cap_inr=500)
        assert o.discount_on(0) == 0.0


# ── best_bank_discount ──

class TestBestBankDiscount:
    def test_picks_largest(self):
        offers = [
            "5% off, max ₹100",
            "10% off, max ₹500",
            "₹50 off",
        ]
        disc, picked = best_bank_discount(offers, 2000)
        # 5% of 2000 = 100, 10% of 2000 = 200, flat 50.
        assert disc == 200.0
        assert picked is not None and "10%" in picked.raw

    def test_no_offers(self):
        disc, picked = best_bank_discount([], 2000)
        assert disc == 0.0
        assert picked is None

    def test_does_not_stack(self):
        offers = ["5% off, max ₹500", "5% off, max ₹500"]
        disc, _ = best_bank_discount(offers, 2000)
        assert disc == 100.0  # not 200


# ── parse_coupon ──

class TestParseCoupon:
    def test_flat_coupon(self):
        assert parse_coupon("Apply ₹300 coupon", 2000) == 300.0

    def test_percent_coupon(self):
        assert parse_coupon("20% coupon", 2000) == 400.0

    def test_empty(self):
        assert parse_coupon("", 2000) == 0.0

    def test_zero_sticker(self):
        assert parse_coupon("Apply ₹300 coupon", 0) == 0.0

    def test_caps_at_sticker(self):
        assert parse_coupon("₹5000 coupon", 2000) == 2000.0


# ── compute_effective_price ──

class TestComputeEffectivePrice:
    def test_full_stack(self):
        result = compute_effective_price(
            sticker_raw="₹2,599",
            mrp_raw="₹3,999",
            bank_offers=["10% off, max ₹500"],
            coupon_raw="Apply ₹200 coupon",
            shipping_raw="FREE",
        )
        # 10% of 2599 = 259.9, no cap hit. -200 coupon. Free shipping.
        assert result.sticker == 2599.0
        assert round(result.bank_discount, 2) == 259.9
        assert result.coupon_discount == 200.0
        assert result.shipping == 0.0
        assert round(result.effective, 2) == round(2599 - 259.9 - 200, 2)
        assert 30 < result.mrp_discount_pct < 40  # 35% off MRP

    def test_no_offers(self):
        result = compute_effective_price(sticker_raw="₹999")
        assert result.effective == 999.0
        assert result.bank_discount == 0.0
        assert result.mrp_discount_pct == 0.0

    def test_paid_shipping_increases_effective(self):
        result = compute_effective_price(sticker_raw="₹500", shipping_raw="₹40")
        assert result.effective == 540.0

    def test_unparseable_sticker(self):
        result = compute_effective_price(sticker_raw="not a price")
        assert result.sticker == 0.0
        assert result.effective == 0.0

    def test_to_dict(self):
        result = compute_effective_price(
            sticker_raw="₹1000",
            bank_offers=["10% off, max ₹50"],
        )
        d = result.to_dict()
        assert d["sticker"] == 1000.0
        assert d["bank_discount"] == 50.0
        assert d["effective"] == 950.0


# ── price_score_vs_median ──

class TestPriceScoreVsMedian:
    def test_at_median(self):
        assert price_score_vs_median(1000, 1000) == 50

    def test_cheaper_than_median(self):
        assert price_score_vs_median(700, 1000) == 80  # 30% under

    def test_more_expensive(self):
        assert price_score_vs_median(1300, 1000) == 20  # 30% over

    def test_caps_at_extremes(self):
        assert price_score_vs_median(100, 1000) == 80  # capped
        assert price_score_vs_median(10_000, 1000) == 20  # capped

    def test_no_median(self):
        assert price_score_vs_median(500, None) == 50
        assert price_score_vs_median(500, 0) == 50


# ── price_score_vs_mrp ──

class TestPriceScoreVsMrp:
    def test_no_discount(self):
        assert price_score_vs_mrp(0) == 50

    def test_small_discount_neutral(self):
        assert price_score_vs_mrp(8) == 50  # below 10% threshold

    def test_moderate_discount(self):
        assert price_score_vs_mrp(20) == 50 + int(round((20 - 10) * 0.75))  # 57 or 58

    def test_large_discount_capped(self):
        assert price_score_vs_mrp(80) <= 80
        assert price_score_vs_mrp(99) <= 80


# ── combined_price_score ──

class TestCombinedPriceScore:
    def test_with_median(self):
        # Effective 700, median 1000 -> price_score_vs_median = 80
        # MRP 33% off -> ~67
        # Combined: 80*.75 + 67*.25 = 76.75 -> 77
        score = combined_price_score(effective=700, median=1000, mrp_discount_pct=33)
        assert 75 <= score <= 78

    def test_falls_back_to_mrp_when_no_median(self):
        # No median -> just MRP signal
        assert combined_price_score(effective=700, median=None, mrp_discount_pct=20) == price_score_vs_mrp(20)

    def test_neutral_with_nothing(self):
        assert combined_price_score(effective=0, median=None, mrp_discount_pct=0) == 50
