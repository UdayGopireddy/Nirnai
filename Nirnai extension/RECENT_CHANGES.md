# Nirnai — Recent Changes & Roadmap

_Last updated: April 23, 2026_

This document captures the work shipped over the last sprint (canonical product
cache + checkout re-score + dual-column recents) and the proposed next surface
(`/recent` Slickdeals-style browse page) that we've parked for now.

---

## 1. Canonical Product Cache (Phases 1–3)

### Goal
Stop re-scoring the same product on every visit. Build a write-through cache
keyed by a stable `product_id` so subsequent rankings are instant and so we can
detect price drift later.

### Phase 1 — `canonical_id`
**File:** `Nirnai extension/backend/canonical_id.py` (+ `test_canonical_id.py`, 42 tests)

- Pure function `canonical_product_id(product) -> str` that produces a stable id
  from the strongest available signal in this priority order:
  1. `barcode` (UPC/EAN normalized, leading-zero tolerant)
  2. `asin` for Amazon
  3. `(brand, normalized_title, size)` for branded retail
  4. `sha1(source_site + slug(url))` fallback
- All inputs lowercased, whitespace-collapsed, punctuation stripped.

### Phase 2 — DynamoDB table + cache helpers
**Table:** `nirnai-products` (us-east-1)
- PK `product_id` (string), TTL on `ttl` attribute, **90-day** row lifetime.
- IAM: role `nirnai-python-instance` granted `nirnai-products-rw` policy
  (CRUD restricted to this single table).

**File:** `Nirnai extension/backend/product_cache.py` (+ `test_product_cache.py`, 19 tests)

- `MemoryBackend` for tests; `DynamoBackend` for prod (boto3, lazy client).
- API surface:
  - `remember_product(product)` — upsert minimal product record.
  - `get(product_id)` — read.
  - `record_score(product_id, purchase_score, health_score, *, extras=None)` —
    append a scored snapshot (now also stores `last_price`, `last_currency`).

### Phase 3 — Read-through cache wired into `/compare/rank`
**File:** `Nirnai extension/backend/main.py`

- `/compare/rank` now:
  1. Canonicalises each input listing.
  2. Reads the cache; skips re-scoring when a fresh entry exists.
  3. Writes back `purchase_score`, `health_score`, and price snapshot for
     fresh scores.
- Behaviour is fail-soft: cache misses or DynamoDB outages fall through to a
  full live score.

**Test totals after Phase 3:** 61 passing.

---

## 2. Phase 4 — Re-score at Checkout (Price Drift Guard)

### Goal
When a user clicks the SMART_BUY Amazon affiliate CTA we surfaced, verify the
displayed price hasn't drifted >10% from when we scored the product. If it has,
warn before redirecting.

### Layer 1 — Pure recheck logic
**File:** `Nirnai extension/backend/product_cache.py`

- `RecheckResult` dataclass: `stable, warn_level, message, last_price,
  last_currency, drift_pct, scored_secs_ago`.
- `compute_recheck(record, shown_price, *, threshold_pct=10.0,
  stale_secs=86400, now_secs=None)` — pure decision function.

**Behaviour matrix:**
| Cache state | Drift | Age | `warn_level` |
|---|---|---|---|
| missing | — | — | `unknown` |
| no `last_price` | — | — | `unknown` |
| present | < threshold | fresh | `none` |
| present | < threshold | stale | `info` |
| present | ≥ threshold | any | `warn` |

Drift wins over staleness.

### Layer 2 — FastAPI endpoint
**File:** `Nirnai extension/backend/main.py`

- `RecheckRequest(product, shown_price, threshold_pct=10.0)` /
  `RecheckResponse(...)` Pydantic models in `models.py`.
- `POST /products/recheck` — canonicalise → cache.get → `compute_recheck` →
  return `RecheckResponse`. Fully **fail-open** (returns
  `warn_level="unknown"` on any exception so a backend hiccup never blocks a
  purchase).
- `/analyze` and both `record_score` calls in `/compare/rank` now persist
  `extras={"last_price", "last_currency"}` so the recheck has data to compare
  against.

**Tests:** `test_recheck.py` — 14 new tests across 4 classes
(missing data, drift threshold, staleness, end-to-end via `MemoryBackend`).
Total backend test suite: **75 / 75 passing**.

### Layer 3 — Rust gateway proxy route
**File:** `rust/crates/server/src/main.rs`

- Added `.route("/products/recheck", post(proxy::proxy))` so requests from the
  extension reach the Python service via `nirnai.app`.

### Layer 4 — Extension click hook
**File:** `Nirnai extension/src/content/content.ts`

- `productSnapshotForRecheck()` — gathers minimal `{title, brand, price,
  currency, url, source_site, barcode}` from the page extractor.
- `attachAffiliateRecheck(productSnapshot)` — intercepts click on
  `#nirnai-affiliate-buy`:
  1. `preventDefault`, show `🔍 Checking price…` inline.
  2. POST to `${API_BASE_URL}/products/recheck` with **2.5 s timeout**.
  3. On `warn` → render inline drift warning UI; otherwise open Amazon in a
     new tab (`noopener,nofollow`).
  4. `proceeded` flag allows second-click bypass.
- `showRecheckWarning(anchor, message, href)` — inserts amber-bordered
  `#nirnai-recheck-warning` box with **Continue anyway** / **Cancel** buttons.

### Deployment
- ECR images: `nirnai-python:latest` (Python FastAPI), `nirnai-backend:latest`
  (Rust gateway).
- App Runner services:
  - `nirnai-python` — `arn:.../d2260d3154a044d78a4493a731c7ad20`
  - `nirnai-api` — `arn:.../a36a8faf22514b46b3951558bb1a85d7`
- Build pattern:
  ```bash
  docker buildx build --platform linux/amd64 \
    -t 206600846246.dkr.ecr.us-east-1.amazonaws.com/<repo>:latest --push .
  aws apprunner start-deployment --service-arn <ARN> --region us-east-1
  ```

---

## 3. Recent Searches — Dual Column Layout

### Problem
The book's right page mixed accommodations (Tampa, Seattle hotels) with retail
products (Olaplex, Oribe shampoo). Users couldn't quickly find what they
recognized.

### Iteration 1 (parked) — Tabs
First pass added `🏨 Stays` / `🛒 Shopping` toggle tabs. Functional but hid
half the catalog by default.

### Iteration 2 (shipped) — Side-by-side columns
**File:** `rust/crates/server/src/homepage.rs`

- Two columns side-by-side on the right page, both visible at all times.
- Client-side classifier (`isStaySearch`) bins items by keyword match against
  title + destination:
  `hotel|inn|suites|resort|lodge|motel|apartment|hostel|villa|cabin|guesthouse|airbnb|vrbo|booking.com`
  → Stays. Everything else → Shopping.
- Each column has its own header, scroll area, and empty state.
- Mobile (≤720 px) collapses to a single column.

### API
**Endpoint:** `GET /api/recent-searches` (handled in
`rust/crates/server/src/compare.rs::recent_searches`)

- Merges two sources because writes don't always reach both tables:
  - `nirnai-inventory` — geo-keyed accommodation rankings.
  - `nirnai-sessions` — retail / cross-site comparisons.
- Dedupes by session id, sorts newest-first, **caps at 20 items total**.

---

## 4. Parked — Proposed `/recent` Slickdeals-Style Page

### Why park it
Current data volume is small (≤20 visible recents per user). Building a full
browse page now would be premature; the dual-column layout buys us time.

### When to revive
- When recent-searches volume regularly exceeds 20 per active user.
- When we want a public "deals/picks" surface for SEO.
- When extension attribution (`Found by …`) becomes meaningful.

### Proposed shape

#### Backend
- Extend `/api/recent-searches` with query params:
  - `?limit=N` (default 20, max 50)
  - `?offset=N` for pagination
  - `?kind=stays|shop|all` (default `all`)
  - `?since=<iso8601>` for "Today / Yesterday / This Week" grouping
- OR add a dedicated `/api/recent-searches/page` endpoint if the contract
  diverges too much from the homepage one.

#### Page route
- `GET /recent` (new handler in `rust/crates/server/src/`).
- Server-rendered shell + client-side infinite scroll (or paginated, simpler).

#### Visual layout (per Slickdeals reference)
- Grid of cards (~5 across desktop, 2 across tablet, 1 mobile).
- Each card: thumbnail, title, **was → is** price, source site badge,
  decision badge (Smart Buy / Think / Skip), affiliate CTA.
- Time-grouped headers: **Today**, **Yesterday**, **This Week**, **Earlier**.
- Filter chips above the grid: `All · Stays · Shopping · by Site`.
- Optional: "Found by extension" or "Found by user (anon)" attribution if we
  begin capturing that signal.
- Click on card → existing `/compare/:id` page.

#### Build order when revived
1. API params + tests.
2. Static `/recent` page rendering first 20 items, no filters.
3. Filters + grouping.
4. Infinite scroll or pagination.
5. Optional: thumbnails (need to start storing them at score time).

---

## 5. Current Test & Deployment Status

| Area | Status |
|---|---|
| Backend tests | 75 / 75 passing |
| Extension build | Clean (esbuild, content.js ~424 kb) |
| Python image | Pushed `sha256:c8d8350a7d56…` |
| Rust image | Pushed `sha256:e7ed3063816f…` (latest, dual-column) |
| Python App Runner | Deployed |
| Rust App Runner | Deployment triggered (`f5f4fa3b38524cfc…`) |
| `/products/recheck` live | Yes (via `nirnai.app`) |
| Dual-column recents live | Yes (after current Rust deploy completes) |

---

## 6. File Index (Quick Reference)

**Python backend** (`Nirnai extension/backend/`)
- `canonical_id.py` — stable product id derivation
- `product_cache.py` — cache backend + `compute_recheck`
- `models.py` — Pydantic schemas including `RecheckRequest/Response`
- `main.py` — FastAPI routes (`/analyze`, `/compare/rank`, `/products/recheck`)
- `test_canonical_id.py`, `test_product_cache.py`, `test_recheck.py`

**Rust gateway** (`rust/crates/server/src/`)
- `main.rs` — route registry
- `compare.rs` — `recent_searches` handler, merge logic
- `homepage.rs` — homepage HTML/CSS/JS, dual-column recents
- `inventory.rs` — `nirnai-inventory` DynamoDB access

**Extension** (`Nirnai extension/src/`)
- `content/content.ts` — affiliate CTA + recheck hook + warning UI
