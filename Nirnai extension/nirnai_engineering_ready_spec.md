
# Nirnai Engineering-Ready Specification
## Version 1.0
## Tagline: Clear decisions. Every purchase.

---

## 1. Purpose

This document translates the Nirnai product vision into an engineering-ready specification for implementation.

Nirnai is a single extension and shared decision engine that works across multiple domains, starting with:
- Shopping: Amazon, Walmart, Target
- Travel: Airbnb / Hotels (experimental after shopping MVP)

The same core engine evaluates:
- trustworthiness of reviews
- current reality vs historical average
- contextual risk
- domain-specific quality signals
- decision output as a stamp:
  - SMART BUY / SMART STAY
  - CHECK
  - AVOID

---

## 2. Scope

## 2.1 MVP Scope
Primary production scope:
- Chrome extension
- Amazon support
- Packaged food health scoring
- Review Trust Score
- Recent Reality / time-aware score
- Decision stamp + explanation

## 2.2 Post-MVP Scope
- Walmart
- Target
- Cart analysis
- Airbnb / hotel support
- Booking support
- Mobile companion app

---

## 3. Core Engineering Principles

1. One extension, one decision engine, many adapters.
2. Deterministic scoring first, AI explanation second.
3. Recent reviews should carry more weight than historical reviews.
4. Explanations must reflect score impact clearly.
5. Every decision must be traceable to concrete signals.
6. Domain adapters should be pluggable and isolated.
7. Ship new signals independently without redesigning the system.

---

## 4. System Architecture

```text
+---------------------+
| Chrome Extension    |
|---------------------|
| Content Script      |
| Site Adapters       |
| UI Widget           |
| Background Worker   |
+----------+----------+
           |
           v
+---------------------+
| Nirnai Backend API  |
|---------------------|
| Extract Normalizer  |
| Product Classifier  |
| Signal Engine       |
| Scoring Engine      |
| Decision Engine     |
| Explanation Builder |
+----------+----------+
           |
           +-------------------+
           |                   |
           v                   v
+------------------+   +----------------------+
| Open Food Facts  |   | LLM (optional)       |
| API Client       |   | extraction cleanup   |
+------------------+   | explanation polish   |
                       +----------------------+
```

---

## 5. Repositories / Project Layout

Recommended monorepo:

```text
nirnai/
  extension/
    manifest.json
    package.json
    src/
      background/
        service-worker.ts
      content/
        main.ts
        adapters/
          amazon.ts
          walmart.ts
          target.ts
          airbnb.ts
          generic.ts
      ui/
        widget.tsx
        badge.tsx
        detail_panel.tsx
      shared/
        types.ts
        messages.ts
        constants.ts
        parser.ts
        storage.ts
      tests/
  backend/
    app/
      main.py
      config.py
      api/
        analyze.py
        health.py
        admin.py
      domain/
        models.py
        schemas.py
      services/
        classifier.py
        signal_engine.py
        review_trust.py
        recent_reality.py
        sentiment_engine.py
        health_scorer.py
        value_scorer.py
        decision_engine.py
        explanation_builder.py
        event_detector.py
        seasonality_engine.py
      clients/
        openfoodfacts.py
        llm_client.py
      db/
        base.py
        session.py
        models.py
      tests/
        unit/
        integration/
  docs/
    product/
    api/
    runbooks/
```

---

## 6. User Experience Requirements

## 6.1 Primary Experience
User lands on a supported page. Nirnai automatically renders a compact badge with:
- stamp
- one or two short reasons
- optional click to expand detail panel

Example:
```text
🟢 SMART BUY
Strong reviews • Good value
```

Example:
```text
🔴 AVOID
Recently declined • High sugar
```

## 6.2 Detailed Panel
Expanded panel must show:
- final score
- trust score
- recent reality summary
- health score if applicable
- key warnings
- positives
- confidence level

## 6.3 Performance
- badge should render in under 1.5 seconds after extractable DOM is ready
- backend roundtrip target under 800ms median
- fallback UI state: "Analyzing..."

---

## 7. Supported Domains and Adapters

## 7.1 Domain Model
Each supported site must implement an adapter that converts page data into a normalized payload.

Adapters:
- AmazonAdapter
- WalmartAdapter
- TargetAdapter
- AirbnbAdapter
- GenericAdapter

## 7.2 Adapter Responsibilities
Each adapter must:
- identify if the page is supported
- determine page type:
  - product
  - cart
  - listing
  - stay detail
- extract normalized fields
- return confidence and missing fields

## 7.3 Adapter Interface

### TypeScript interface
```ts
export interface SiteAdapter {
  canHandle(url: string, document: Document): boolean;
  detectPageType(url: string, document: Document): "product" | "cart" | "listing" | "stay_detail" | "unknown";
  extract(document: Document, url: string): ExtractedPagePayload;
}
```

---

## 8. Shared Data Contracts

## 8.1 Frontend Extracted Payload
```ts
export type DomainType = "shopping" | "travel";

export interface ExtractedPagePayload {
  site: string;
  domain_type: DomainType;
  page_type: "product" | "cart" | "listing" | "stay_detail" | "unknown";
  canonical_url: string;
  extraction_confidence: number;
  item: {
    title?: string;
    brand?: string;
    category?: string;
    price?: number;
    currency?: string;
    rating?: number;
    review_count?: number;
    rating_distribution?: {
      one_star?: number;
      two_star?: number;
      three_star?: number;
      four_star?: number;
      five_star?: number;
    };
    seller?: string;
    return_policy_text?: string;
    delivery_text?: string;
    ingredients_text?: string;
    nutrition_text?: string;
    barcode?: string;
    amenities_text?: string;
    location_text?: string;
    review_snippets?: ReviewSnippet[];
  };
}

export interface ReviewSnippet {
  review_text?: string;
  review_rating?: number;
  review_date?: string;
  reviewer_name?: string;
}
```

## 8.2 Backend Analyze Request
```json
{
  "site": "amazon",
  "domain_type": "shopping",
  "page_type": "product",
  "canonical_url": "https://www.amazon.com/...",
  "extraction_confidence": 0.92,
  "item": {
    "title": "Protein Snack Bar",
    "brand": "Example Brand",
    "category": "packaged_food",
    "price": 2.99,
    "currency": "USD",
    "rating": 4.4,
    "review_count": 1834,
    "rating_distribution": {
      "one_star": 4,
      "two_star": 3,
      "three_star": 8,
      "four_star": 22,
      "five_star": 63
    },
    "seller": "Amazon",
    "return_policy_text": "Eligible for return within 30 days",
    "delivery_text": "Free delivery tomorrow",
    "ingredients_text": "Peanuts, whey protein, sugar, palm oil",
    "nutrition_text": "Calories 220, Sodium 180mg, Sugars 12g, Protein 20g",
    "barcode": "123456789012",
    "review_snippets": [
      {
        "review_text": "Tastes good but too sweet",
        "review_rating": 3,
        "review_date": "2026-03-01"
      }
    ]
  }
}
```

## 8.3 Backend Analyze Response
```json
{
  "decision": "CHECK",
  "stamp_label": "CHECK",
  "score": 67,
  "confidence": 0.84,
  "reasons": [
    "Low review confidence",
    "Moderate health"
  ],
  "positives": [
    "Good protein content",
    "Popular product"
  ],
  "warnings": [
    "Added sugar present",
    "Recent reviews slightly weaker"
  ],
  "subscores": {
    "review_trust_score": 61,
    "recent_reality_score": 58,
    "sentiment_score": 71,
    "health_score": 62,
    "value_score": 74,
    "context_score": 50
  },
  "explanation": {
    "summary": "Strong historical reviews, but more recent reviews are weaker and the nutrition profile is only moderate.",
    "score_impacts": [
      {
        "signal": "recent_reviews_declined",
        "impact": "negative",
        "message": "Recent reviews are weaker than the historical average."
      },
      {
        "signal": "protein_content_positive",
        "impact": "positive",
        "message": "Protein content supports a moderate health score."
      }
    ]
  },
  "metadata": {
    "domain_type": "shopping",
    "site": "amazon",
    "page_type": "product",
    "analyzed_at": "2026-04-02T15:00:00Z"
  }
}
```

---

## 9. Backend Services

## 9.1 Product Classifier
Purpose:
- determine domain subtype
- packaged_food vs electronics vs household item vs stay

Input:
- title
- category
- ingredients presence
- nutrition presence
- site context

Output:
- subtype
- classifier_confidence

## 9.2 Signal Engine
Purpose:
- orchestrate all signal calculations
- standardize signals into a single list of typed outputs

Signal format:
```python
class Signal(BaseModel):
    name: str
    category: str
    impact: str  # positive | negative | neutral
    score_delta: float
    confidence: float
    message: str
    metadata: dict = {}
```

## 9.3 Review Trust Service
Computes review trustworthiness based on:
- average rating
- review count
- distribution shape
- authenticity heuristics

## 9.4 Recent Reality Service
Computes time-aware quality change based on:
- last 25% of reviews OR last 3 months, whichever yields stronger recent coverage
- comparison to older 75%
- trend classification:
  - declining
  - improving
  - stable

## 9.5 Sentiment / Theme Service
Extracts negative and positive themes:
- shopping:
  - taste
  - durability
  - size
  - value
- travel:
  - cleanliness
  - location
  - noise
  - host responsiveness
  - accuracy

## 9.6 Event Detector
Detects:
- new management
- renovation
- decline in service
- ownership changes
- host changes
- quality drift

## 9.7 Seasonality Engine
Detects season-specific issues:
- peak season crowding
- summer AC complaints
- winter heating complaints
- holiday noise

## 9.8 Health Scorer
For packaged food only:
- sugar
- sodium
- saturated fat
- protein
- fiber
- ingredient quality
- processing indicators

## 9.9 Value Scorer
Assesses:
- price fairness
- seller trust
- delivery speed
- return policy

## 9.10 Decision Engine
Maps normalized subscores and weighted signals into:
- final score
- stamp
- confidence
- short reasons
- detailed score impacts

---

## 10. Scoring Model

## 10.1 Shopping Score
For product pages:
```text
Final Score =
  Review Trust Score (25%) +
  Recent Reality Score (20%) +
  Health Score (20%) [if packaged food] +
  Value Score (20%) +
  Sentiment Score (10%) +
  Context Score (5%)
```

For non-food shopping pages:
```text
Final Score =
  Review Trust Score (30%) +
  Recent Reality Score (25%) +
  Value Score (25%) +
  Sentiment Score (15%) +
  Context Score (5%)
```

## 10.2 Travel Score
For hotels / Airbnb:
```text
Final Score =
  Recent Reality Score (30%) +
  Sentiment Score (25%) +
  Review Trust Score (20%) +
  Value Score (15%) +
  Context Score (10%)
```

## 10.3 Stamp Thresholds
```text
80–100  -> SMART BUY / SMART STAY
55–79   -> CHECK
0–54    -> AVOID
```

## 10.4 Confidence Calculation
Confidence should combine:
- extraction confidence
- review count sufficiency
- signal density
- agreement across signals

Suggested formula:
```text
confidence =
  extraction_confidence * 0.35 +
  review_data_completeness * 0.25 +
  signal_density * 0.20 +
  score_stability * 0.20
```

---

## 11. Recent Reality Specification

## 11.1 Intent
Recent reviews should count more than older reviews because current user experience matters more than historical averages.

## 11.2 Rule
Recent review cohort is defined as:
- reviews from the last 3 months
- OR last 25% of total reviews
- whichever gives more representative current-state coverage

Implementation rule:
```python
recent_reviews = select_recent_reviews(
    reviews=all_reviews,
    months=3,
    percentile=0.25
)
```

## 11.3 Weighting
Use:
- recent cohort weight: 0.60
- older cohort weight: 0.40

## 11.4 Trend Logic
Compute:
- recent average rating
- older average rating
- sentiment delta
- issue frequency delta by theme

Classification:
- declining if recent score <= older score - threshold
- improving if recent score >= older score + threshold
- stable otherwise

Suggested threshold:
- 0.30 rating points or equivalent theme deterioration

## 11.5 Explanation Requirement
Every recent reality output must explain score effect in plain language.

Examples:
- "Recent reviews are significantly worse than historical reviews."
- "This place appears to have improved in the last 3 months."
- "Recent reviews are broadly consistent with older reviews."

---

## 12. Review Trust Specification

## 12.1 Inputs
- rating
- review_count
- rating distribution
- review text count
- date spread

## 12.2 Factors
- rating strength
- review volume confidence
- distribution quality
- suspicious skew
- authenticity heuristics

## 12.3 Heuristics
Examples:
- very high rating with very low review count => penalty
- extreme 5-star concentration => penalty
- no recent reviews => penalty
- large review base with consistent distribution => positive

---

## 13. Health Scoring Specification

## 13.1 Inputs
- nutrition text
- ingredients text
- optional Open Food Facts enrichment

## 13.2 Outputs
- health_score
- ingredient flags
- warning reasons
- positive reasons

## 13.3 Example Weights
```text
Nutrition Quality  50%
Ingredient Quality 30%
Processing Level   20%
```

## 13.4 Example Warnings
- high sugar
- high sodium
- ultra-processed
- artificial additives

## 13.5 Example Positives
- high protein
- high fiber
- simple ingredients

---

## 14. Context Scoring Specification

## 14.1 Supported Context Signals
- seasonality
- management change
- renovation
- quality shift
- host responsiveness shift

## 14.2 Impact
Context score should not dominate the final score, but should materially affect it where evidence is strong.

Recommended cap:
- context contribution between -10 and +10 final points

---

## 15. Explanation Builder

## 15.1 Requirements
Must produce:
- short reasons for badge
- one-paragraph summary
- score impact list

## 15.2 Short Reasons Rules
- maximum 2 reasons
- 2–3 words each preferred
- user-facing, plain English

Examples:
- Strong reviews
- Recently declined
- High sugar
- Seasonal issues
- Good value
- Low confidence

## 15.3 Score Impact Format
Each major score-moving signal should include:
- signal name
- positive/negative/neutral
- human-readable explanation

---

## 16. API Specification

## 16.1 POST /analyze
Purpose:
- main endpoint for scoring and decision output

Request body:
- ExtractedPagePayload

Response:
- AnalyzeResponse

Status codes:
- 200 success
- 400 malformed payload
- 422 missing required fields for supported page
- 500 internal scoring error

## 16.2 POST /extract-health
Purpose:
- optional separate parsing endpoint for messy nutrition / ingredient text

## 16.3 GET /health
Purpose:
- health check

## 16.4 GET /version
Purpose:
- service version + scoring config version

---

## 17. Database Schema (Postgres)

## 17.1 Tables

### supported_sites
```sql
CREATE TABLE supported_sites (
  id SERIAL PRIMARY KEY,
  site_key TEXT UNIQUE NOT NULL,
  domain_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
```

### scoring_runs
```sql
CREATE TABLE scoring_runs (
  id BIGSERIAL PRIMARY KEY,
  site_key TEXT NOT NULL,
  domain_type TEXT NOT NULL,
  page_type TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  final_score NUMERIC(5,2) NOT NULL,
  decision TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### extracted_reviews
```sql
CREATE TABLE extracted_reviews (
  id BIGSERIAL PRIMARY KEY,
  scoring_run_id BIGINT REFERENCES scoring_runs(id) ON DELETE CASCADE,
  review_date DATE,
  review_rating NUMERIC(3,2),
  review_text TEXT,
  review_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### detected_signals
```sql
CREATE TABLE detected_signals (
  id BIGSERIAL PRIMARY KEY,
  scoring_run_id BIGINT REFERENCES scoring_runs(id) ON DELETE CASCADE,
  signal_name TEXT NOT NULL,
  category TEXT NOT NULL,
  impact TEXT NOT NULL,
  score_delta NUMERIC(6,2) NOT NULL,
  confidence NUMERIC(5,2) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### health_enrichments
```sql
CREATE TABLE health_enrichments (
  id BIGSERIAL PRIMARY KEY,
  barcode TEXT,
  source TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 18. Extension Implementation Details

## 18.1 Manifest
Use Manifest V3.

Required permissions:
- storage
- activeTab
- scripting

Host permissions:
- amazon domains
- walmart domains
- target domains
- airbnb domains (post-MVP)

## 18.2 Content Script Responsibilities
- detect supported site
- wait for required DOM readiness
- invoke adapter
- send payload to background worker
- render badge and panel

## 18.3 Background Worker Responsibilities
- API requests
- retries
- caching
- telemetry
- feature flag fetch

## 18.4 Frontend Cache
Cache keyed by:
- canonical_url
- hash of extracted page payload

TTL:
- 15 minutes for product pages
- 5 minutes for travel pages if review content likely shifts

---

## 19. Feature Flags

Recommended flags:
- enable_health_score
- enable_recent_reality
- enable_airbnb_adapter
- enable_context_signals
- enable_llm_cleanup
- enable_detail_panel

Store centrally in backend or remote config endpoint.

---

## 20. Telemetry

Capture:
- page analyzed
- adapter used
- extraction confidence
- latency
- decision shown
- panel expanded
- dismissals / errors

Do not capture:
- personal account data
- checkout/payment information
- unnecessary browsing history

---

## 21. Security and Privacy

Rules:
- do not store raw credentials
- do not capture unrelated page data
- only extract product/stay-relevant visible information
- redact PII from stored reviews when possible

Disclosures:
- informational guidance only
- not medical advice
- not financial advice
- no warranty of merchant/platform accuracy

---

## 22. Testing Strategy

## 22.1 Unit Tests
Required for:
- review trust calculations
- recent reality logic
- health scoring
- decision engine
- explanation builder

## 22.2 Integration Tests
Required for:
- adapter -> payload -> backend response flow
- Open Food Facts enrichment
- API error handling
- feature flag behavior

## 22.3 DOM Snapshot Tests
Store sample HTML snapshots for:
- Amazon product pages
- Amazon packaged food pages
- Walmart pages
- Target pages
- Airbnb stay pages

Goal:
- detect extraction breakage when selectors drift

## 22.4 QA Acceptance Tests
Examples:
1. Given a packaged food product with high sugar, the response includes a negative health impact.
2. Given recent reviews weaker than older reviews, the score must drop and explanation must mention recent decline.
3. Given low review count and very high rating, trust score must be penalized.
4. Given strong recent reviews and high value, stamp should be SMART BUY if thresholds are met.

---

## 23. Non-Functional Requirements

- median backend response under 800ms
- p95 backend response under 2s
- extension badge visible under 1.5s after page ready
- graceful degradation if extraction partial
- retries capped at 2
- logs structured JSON in backend

---

## 24. Delivery Plan

## Sprint 1
- extension scaffold
- Amazon adapter
- backend /analyze endpoint
- basic review trust score
- badge UI

## Sprint 2
- health scoring
- Open Food Facts integration
- value scorer
- detail panel

## Sprint 3
- recent reality engine
- explanation builder
- signal logging
- tests

## Sprint 4
- Walmart adapter
- Target adapter
- cart analysis
- feature flags

## Sprint 5 (experimental)
- Airbnb adapter
- travel sentiment themes
- seasonality engine
- event detector

---

## 25. Open Questions

1. Should the extension analyze every page automatically or only when confidence > threshold?
2. How much review text is available reliably on each site without user interaction?
3. Will Airbnb support require a separate DOM loading strategy because of client-side rendering?
4. What threshold should trigger visible "Recently declined" vs a subtler negative impact?
5. When context signals conflict, should recent reality dominate?

---

## 26. Recommended Defaults

- launch with shopping only
- keep one extension
- enable health scoring only for packaged food
- enable recent reality in MVP if review dates are extractable
- keep explanation deterministic first
- add LLM only for cleanup and polish

---

## 27. Engineering Handover Summary

Build Nirnai as:
- one browser extension
- one shared scoring engine
- many site adapters
- one consistent decision UI

The technical moat is:
- recent reality weighting
- trust scoring
- context-aware signals
- human-readable score impacts

This should produce a system where users do not just see ratings.
They see what matters now, why the score moved, and what action to take.

---

## End of Document
