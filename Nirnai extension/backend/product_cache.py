"""Product knowledge cache — Phase 2 of the canonical product graph.

Sits on top of :mod:`canonical_id`. For each ``product_id`` we persist the
slow-changing facts (brand, ingredients, category, last-known scores) so
later requests for the same product across any retailer can skip GPT
re-scoring and just reuse what we already learned.

Design notes:

* The store is pluggable. Production uses :class:`DynamoBackend`; tests
  use :class:`MemoryBackend` so we can exercise the merge logic without
  touching AWS.
* Merging is pure — :func:`merge_record` takes ``(old, new)`` dicts and
  returns the merged record. No I/O. This is the function that has to be
  bug-free; everything else is plumbing.
* A read-through helper (:meth:`ProductCache.get_or_init`) is provided so
  the scoring pipeline can do one call: "give me what we know, and if we
  know nothing, register the canonical row so future hits work."
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from canonical_id import CanonicalId, canonicalize_product

log = logging.getLogger(__name__)

PRODUCTS_TABLE = os.environ.get("NIRNAI_PRODUCTS_TABLE", "nirnai-products")

# Cache rows live for 90 days after the last touch. Static product data
# changes slowly (formulation reformulations, brand acquisitions). 90 days
# is long enough to absorb burst traffic, short enough that stale rows
# eventually get refreshed.
CACHE_TTL_SECS = 90 * 24 * 3600


# ── Public record shape ────────────────────────────────────────────────────


@dataclass
class ProductRecord:
    """One row in the cache. Mirrors the DynamoDB item layout but is a
    plain Python object so call sites don't depend on AWS SDK types."""

    product_id: str
    confidence: str = "low"
    source: str = "title_only"
    normalized_brand: str = ""
    normalized_title: str = ""
    size_token: str = ""
    barcodes: list[str] = field(default_factory=list)
    asins: list[str] = field(default_factory=list)
    static_features: dict[str, Any] = field(default_factory=dict)
    known_listings: list[dict[str, Any]] = field(default_factory=list)
    score_cache: dict[str, Any] = field(default_factory=dict)
    created_at: int = 0
    updated_at: int = 0

    def to_item(self) -> dict[str, Any]:
        """Serialize to a DynamoDB-friendly dict (str/int/list/map only)."""
        return {
            "product_id": self.product_id,
            "confidence": self.confidence,
            "source": self.source,
            "normalized_brand": self.normalized_brand,
            "normalized_title": self.normalized_title,
            "size_token": self.size_token,
            "barcodes": list(self.barcodes),
            "asins": list(self.asins),
            "static_features": dict(self.static_features),
            "known_listings": list(self.known_listings),
            "score_cache": dict(self.score_cache),
            "created_at": int(self.created_at),
            "updated_at": int(self.updated_at),
            "ttl": int(self.updated_at) + CACHE_TTL_SECS,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "ProductRecord":
        return cls(
            product_id=item["product_id"],
            confidence=item.get("confidence", "low"),
            source=item.get("source", "title_only"),
            normalized_brand=item.get("normalized_brand", ""),
            normalized_title=item.get("normalized_title", ""),
            size_token=item.get("size_token", ""),
            barcodes=list(item.get("barcodes") or []),
            asins=list(item.get("asins") or []),
            static_features=dict(item.get("static_features") or {}),
            known_listings=list(item.get("known_listings") or []),
            score_cache=dict(item.get("score_cache") or {}),
            created_at=int(item.get("created_at") or 0),
            updated_at=int(item.get("updated_at") or 0),
        )


# ── Pure merge logic (the part that must be bug-free) ─────────────────────


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _merge_listings(
    old: list[dict[str, Any]], new: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Merge two ``known_listings`` lists. One entry per (platform, url).
    Newest ``last_seen`` wins on collision."""
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in list(old) + list(new):
        if not entry:
            continue
        key = (entry.get("platform", ""), entry.get("url", ""))
        existing = by_key.get(key)
        if existing is None or int(entry.get("last_seen", 0)) > int(
            existing.get("last_seen", 0)
        ):
            by_key[key] = dict(entry)
    return sorted(by_key.values(), key=lambda e: -int(e.get("last_seen", 0)))


def merge_record(old: ProductRecord, new: ProductRecord) -> ProductRecord:
    """Combine two records for the same ``product_id``.

    Rules:
      * Higher confidence wins for ``confidence``/``source`` and the
        normalized identity fields. Ties keep ``new`` (more recent).
      * ``barcodes`` and ``asins`` are unioned.
      * ``static_features``: ``new`` overrides per-key ONLY when the new
        value is non-empty. We never let a fresh-but-empty field clobber
        a previously cached one.
      * ``known_listings``: merged via :func:`_merge_listings`.
      * ``score_cache``: ``new`` wins iff ``new.scored_at`` is newer.
      * ``created_at`` keeps the older non-zero value; ``updated_at``
        becomes the larger.
    """
    if old.product_id != new.product_id:
        raise ValueError(
            f"merge_record called on different ids: {old.product_id} vs {new.product_id}"
        )

    confidence_rank = {"low": 0, "medium": 1, "high": 2}
    if confidence_rank.get(new.confidence, 0) >= confidence_rank.get(
        old.confidence, 0
    ):
        confidence = new.confidence
        source = new.source
        nb = new.normalized_brand or old.normalized_brand
        nt = new.normalized_title or old.normalized_title
        sz = new.size_token or old.size_token
    else:
        confidence = old.confidence
        source = old.source
        nb = old.normalized_brand or new.normalized_brand
        nt = old.normalized_title or new.normalized_title
        sz = old.size_token or new.size_token

    merged_features = dict(old.static_features)
    for k, v in new.static_features.items():
        if v not in (None, "", [], {}):
            merged_features[k] = v

    if int(new.score_cache.get("scored_at", 0)) >= int(
        old.score_cache.get("scored_at", 0)
    ):
        score = dict(new.score_cache) if new.score_cache else dict(old.score_cache)
    else:
        score = dict(old.score_cache)

    created = old.created_at or new.created_at or int(time.time())

    return ProductRecord(
        product_id=old.product_id,
        confidence=confidence,
        source=source,
        normalized_brand=nb,
        normalized_title=nt,
        size_token=sz,
        barcodes=_dedupe_preserve_order(old.barcodes + new.barcodes),
        asins=_dedupe_preserve_order(old.asins + new.asins),
        static_features=merged_features,
        known_listings=_merge_listings(old.known_listings, new.known_listings),
        score_cache=score,
        created_at=created,
        updated_at=max(old.updated_at, new.updated_at, int(time.time())),
    )


def record_from_canonical(
    canonical: CanonicalId, product: dict[str, Any]
) -> ProductRecord:
    """Build a fresh :class:`ProductRecord` from a canonical id and the
    raw ``ProductData`` dict the extension sent.

    Static features are populated only when present and non-empty; this
    keeps :func:`merge_record` from later overwriting better data with
    blanks.
    """
    now = int(time.time())
    static: dict[str, Any] = {}

    if (brand := product.get("brand")):
        static["brand"] = brand
    if (title := product.get("title")):
        static["title"] = title
    if (category := product.get("category")):
        static["category"] = category
    if (ingredients := product.get("ingredients")):
        # Always JSON-stringify list/dict shapes so DynamoDB doesn't have
        # to know about nested Python types.
        static["ingredients"] = (
            ingredients if isinstance(ingredients, str) else json.dumps(ingredients)
        )
    if (nutrition := product.get("nutritionInfo") or product.get("nutrition_info")):
        static["nutrition_info"] = (
            nutrition if isinstance(nutrition, str) else json.dumps(nutrition)
        )

    barcodes: list[str] = []
    if product.get("barcode"):
        barcodes.append(str(product["barcode"]).strip())

    asins: list[str] = []
    if product.get("asin"):
        asins.append(str(product["asin"]).strip())

    listings: list[dict[str, Any]] = []
    if product.get("url"):
        listings.append(
            {
                "platform": product.get("source_site") or "",
                "url": product["url"],
                "last_seen": now,
            }
        )

    return ProductRecord(
        product_id=canonical.product_id,
        confidence=canonical.confidence,
        source=canonical.source,
        normalized_brand=canonical.normalized_brand,
        normalized_title=canonical.normalized_title,
        size_token=canonical.size_token,
        barcodes=barcodes,
        asins=asins,
        static_features=static,
        known_listings=listings,
        score_cache={},
        created_at=now,
        updated_at=now,
    )


# ── Backend protocol + implementations ────────────────────────────────────


class CacheBackend(Protocol):
    def get(self, product_id: str) -> Optional[dict[str, Any]]: ...
    def put(self, item: dict[str, Any]) -> None: ...


class MemoryBackend:
    """In-process backend for tests and local development."""

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}

    def get(self, product_id: str) -> Optional[dict[str, Any]]:
        item = self._store.get(product_id)
        return None if item is None else dict(item)

    def put(self, item: dict[str, Any]) -> None:
        self._store[item["product_id"]] = dict(item)

    # Test helpers
    def __len__(self) -> int:
        return len(self._store)

    def all(self) -> list[dict[str, Any]]:
        return [dict(v) for v in self._store.values()]


class DynamoBackend:
    """Thin boto3 wrapper. Keeps the cache reads off the request hot path
    by failing soft: any AWS error is logged and treated as a miss."""

    def __init__(self, table_name: str = PRODUCTS_TABLE, region: Optional[str] = None):
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as e:  # pragma: no cover - boto3 is in requirements
            raise RuntimeError("boto3 required for DynamoBackend") from e
        kwargs: dict[str, Any] = {}
        if region:
            kwargs["region_name"] = region
        elif env_region := os.environ.get("AWS_REGION"):
            kwargs["region_name"] = env_region
        self._table = boto3.resource("dynamodb", **kwargs).Table(table_name)

    def get(self, product_id: str) -> Optional[dict[str, Any]]:
        try:
            resp = self._table.get_item(Key={"product_id": product_id})
        except Exception as e:  # noqa: BLE001 — fail soft; cache miss is fine
            log.warning("product_cache get failed for %s: %s", product_id, e)
            return None
        return resp.get("Item")

    def put(self, item: dict[str, Any]) -> None:
        try:
            self._table.put_item(Item=item)
        except Exception as e:  # noqa: BLE001
            log.warning("product_cache put failed for %s: %s", item.get("product_id"), e)


# ── High-level cache API ──────────────────────────────────────────────────


class ProductCache:
    """Read-through cache wrapping a :class:`CacheBackend`."""

    def __init__(self, backend: CacheBackend):
        self.backend = backend

    def get(self, product_id: str) -> Optional[ProductRecord]:
        item = self.backend.get(product_id)
        return None if item is None else ProductRecord.from_item(item)

    def upsert(self, record: ProductRecord) -> ProductRecord:
        """Merge ``record`` with whatever's currently stored and write back.
        Returns the merged record so the caller can use it immediately."""
        existing = self.get(record.product_id)
        merged = merge_record(existing, record) if existing else record
        merged.updated_at = max(merged.updated_at, int(time.time()))
        self.backend.put(merged.to_item())
        return merged

    def remember_product(self, product: dict[str, Any]) -> tuple[ProductRecord, bool]:
        """Convenience: canonicalize + upsert. Returns ``(record, hit)`` so
        the caller knows whether this came from cache or was just created."""
        canonical = canonicalize_product(product)
        existing = self.get(canonical.product_id)
        new_record = record_from_canonical(canonical, product)
        if existing:
            merged = merge_record(existing, new_record)
            merged.updated_at = int(time.time())
            self.backend.put(merged.to_item())
            return merged, True
        self.backend.put(new_record.to_item())
        return new_record, False

    def record_score(
        self,
        product_id: str,
        purchase_score: int,
        health_score: int,
        extras: Optional[dict[str, Any]] = None,
    ) -> Optional[ProductRecord]:
        """Stamp the latest computed scores onto an existing row."""
        rec = self.get(product_id)
        if rec is None:
            return None
        now = int(time.time())
        rec.score_cache = {
            "purchase_score": int(purchase_score),
            "health_score": int(health_score),
            "scored_at": now,
            **(extras or {}),
        }
        rec.updated_at = now
        self.backend.put(rec.to_item())
        return rec


# Cache-key → ProductData-key mappings used for dict enrichment. Centralised
# so any new static field added to the cache only needs registration here.
_ENRICH_FIELDS: tuple[tuple[str, str], ...] = (
    ("brand", "brand"),
    ("ingredients", "ingredients"),
    ("category", "category"),
    ("nutritionInfo", "nutrition_info"),
)


def enrich_dict_from_cache(
    cache: "ProductCache", product: dict[str, Any]
) -> tuple[dict[str, Any], Optional[ProductRecord]]:
    """Read-through helper for the scoring pipeline.

    Returns ``(possibly_enriched_copy, cached_record_or_none)``. Only fields
    that are *currently empty* on the input are filled from the cache — we
    never overwrite live data with cached data, only fill the gaps a flaky
    scraper left behind.
    """
    canonical = canonicalize_product(product)
    rec = cache.get(canonical.product_id)
    if rec is None:
        return product, None
    enriched = dict(product)
    sf = rec.static_features
    for prod_key, cache_key in _ENRICH_FIELDS:
        if not enriched.get(prod_key) and sf.get(cache_key):
            enriched[prod_key] = sf[cache_key]
    return enriched, rec


# ── Recheck-at-checkout logic ────────────────────────────────────────────


@dataclass
class RecheckResult:
    """Outcome of comparing a shown price against the last cached score.

    ``warn_level`` is one of:
      * ``"none"``   — fresh score, price within tolerance, ship it
      * ``"info"``   — score is older than ``stale_secs`` (price likely fine
                       but worth a heads-up)
      * ``"warn"``   — price drift exceeded ``threshold_pct``; surface it
                       before letting the user click through
      * ``"unknown"`` — no cache row, or no price recorded yet (fail-open)
    """

    stable: bool
    warn_level: str
    message: str
    last_price: str
    last_currency: str
    drift_pct: Optional[float]
    scored_secs_ago: Optional[int]


def _parse_money(value: Any) -> Optional[float]:
    """Strip currency symbols/commas and return a float, or None on junk."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    cleaned = "".join(c for c in s if c.isdigit() or c in ".-")
    # Reject lone separators like "." or "-"
    if not cleaned or cleaned in (".", "-", "-."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def compute_recheck(
    record: Optional[ProductRecord],
    shown_price: Any,
    *,
    threshold_pct: float = 10.0,
    stale_secs: int = 24 * 3600,
    now_secs: Optional[int] = None,
) -> RecheckResult:
    """Pure decision: do we need to warn the user before they click BUY?

    Args:
        record: The cached ProductRecord, or None if we never scored this.
        shown_price: The price the user is currently looking at.
        threshold_pct: Drift threshold (in percent) above which we warn.
        stale_secs: Score-age cutoff above which we add an info message.
        now_secs: Override "now" for testing.

    Behaviour matrix:
        | record? | last_price? | drift > thr | age > stale | warn_level |
        |---------|-------------|-------------|-------------|------------|
        | none    | n/a         | n/a         | n/a         | unknown    |
        | yes     | none        | n/a         | n/a         | unknown    |
        | yes     | yes         | no          | no          | none       |
        | yes     | yes         | no          | yes         | info       |
        | yes     | yes         | yes         | any         | warn       |
    """
    now = now_secs if now_secs is not None else int(time.time())

    if record is None:
        return RecheckResult(
            stable=True,
            warn_level="unknown",
            message="No prior score on file — proceeding.",
            last_price="",
            last_currency="",
            drift_pct=None,
            scored_secs_ago=None,
        )

    sc = record.score_cache or {}
    last_price_str = str(sc.get("last_price") or "")
    last_currency = str(sc.get("last_currency") or "")
    scored_at = int(sc.get("scored_at") or 0) or None
    age = (now - scored_at) if scored_at else None

    last_price = _parse_money(last_price_str)
    shown = _parse_money(shown_price)

    if last_price is None or shown is None or last_price <= 0:
        return RecheckResult(
            stable=True,
            warn_level="unknown",
            message="No comparable cached price — proceeding.",
            last_price=last_price_str,
            last_currency=last_currency,
            drift_pct=None,
            scored_secs_ago=age,
        )

    drift_pct = ((shown - last_price) / last_price) * 100.0
    abs_drift = abs(drift_pct)

    if abs_drift >= threshold_pct:
        direction = "up" if drift_pct > 0 else "down"
        return RecheckResult(
            stable=False,
            warn_level="warn",
            message=(
                f"Price moved {direction} {abs_drift:.0f}% since we scored this "
                f"({last_currency}{last_price_str} → now {shown_price}). "
                "Worth re-checking before you buy."
            ),
            last_price=last_price_str,
            last_currency=last_currency,
            drift_pct=drift_pct,
            scored_secs_ago=age,
        )

    if age is not None and age > stale_secs:
        days = age // 86400
        return RecheckResult(
            stable=True,
            warn_level="info",
            message=(
                f"Price looks consistent with our score from "
                f"{days} day{'s' if days != 1 else ''} ago."
            ),
            last_price=last_price_str,
            last_currency=last_currency,
            drift_pct=drift_pct,
            scored_secs_ago=age,
        )

    return RecheckResult(
        stable=True,
        warn_level="none",
        message="Price matches our recent score.",
        last_price=last_price_str,
        last_currency=last_currency,
        drift_pct=drift_pct,
        scored_secs_ago=age,
    )


# ── Module-level default (lazy) ───────────────────────────────────────────

_default_cache: Optional[ProductCache] = None


def get_default_cache() -> ProductCache:
    """Return the process-wide cache, lazily constructing the Dynamo backend
    on first use. Falls back to an in-memory backend if AWS isn't configured
    so local dev keeps working."""
    global _default_cache
    if _default_cache is not None:
        return _default_cache
    try:
        backend: CacheBackend = DynamoBackend()
    except Exception as e:  # noqa: BLE001
        log.warning("product_cache: falling back to MemoryBackend (%s)", e)
        backend = MemoryBackend()
    _default_cache = ProductCache(backend)
    return _default_cache
