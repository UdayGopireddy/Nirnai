    # NirnAI v1.1 — Product & Implementation Document

    **Version:** 1.1
    **Date:** April 3, 2026
    **Status:** Active Development
    **Tagline:** *Clear decisions. Every purchase.*
    **Positioning:** *Ranks outcomes, not listings.*

    ---

    ## Table of Contents

    1. [Executive Summary](#1-executive-summary)
    2. [Why Users Should Trust NirnAI](#2-why-users-should-trust-nirnai)
    3. [What We Built (Current State)](#3-what-we-built)
    4. [Architecture Overview](#4-architecture-overview)
    5. [AI Model Cost Analysis](#5-ai-model-cost-analysis)
    6. [Model Strategy & Recommendation](#6-model-strategy)
    7. [Cross-Platform Decision Engine Vision](#7-cross-platform-vision)
    8. [Scoring Engine Specification](#8-scoring-engine)
    9. [Confidence UX](#9-confidence-ux)
    10. [Implementation Phases (Revised)](#10-implementation-phases)
    11. [Phase 0: Same-Platform Comparison (Minimal)](#11-phase-0)
    12. [Phase 1: Booking.com Extractor](#12-phase-1)
    13. [Phase 2: Cross-Platform Ranking API](#13-phase-2)
    14. [Phase 3: Monetization & Conversion Validation](#14-phase-3)
    15. [Phase 4+: Property Identity Layer (Deferred)](#15-phase-4)
    16. [Cost Projections Per Phase](#16-cost-projections)
    17. [Competitive Landscape](#17-competitive-landscape)
    18. [Risk Register](#18-risks)
    19. [Decision Log](#19-decision-log)

    ---

    ## 1. Executive Summary

    **Clear decisions. Every purchase.** NirnAI scores listings on trust, recency, quality, and value — then **ranks outcomes, not listings.** It tells you whether what you're looking at is worth it, and surfaces better alternatives you'd miss.

    **What exists today:**
    - Chrome extension with extractors for Amazon, Walmart, Target, Airbnb
    - Rust-based agent server (Axum + Claude) that scores individual listings
    - Travel-specific scoring with Recent Reality Signal (recency-weighted reviews)
    - On-page overlay UI with decision stamps (BOOK IT / THINK TWICE / SKIP)
    - Filtered alternative suggestions with pre-built Airbnb search URLs

    **What's next (deliberately minimal):**
    - Comparison page — **Top 5 only**, same platform, no cross-platform yet
    - Confidence UX — users see *why* NirnAI trusts (or doesn't trust) a listing
    - Booking.com support (second data source)
    - Prove users click, trust, and convert **before** building cross-platform dedup
    - Affiliate monetization with conversion tracking

    ---

    ## 2. Why Users Should Trust NirnAI

    This is the single most important question in the product. If users don't trust NirnAI's judgment more than Airbnb's native sorting, nothing else matters.

    ### 2.1 The Trust Problem

    Users already have Airbnb's rating, Superhost badges, and sort-by-relevance. **Why should they trust a third-party overlay?**

    They shouldn't — blindly. NirnAI earns trust by **showing its work.**

    ### 2.2 NirnAI's Trust Contract (Shown in Every Analysis)

    Every NirnAI result must explicitly communicate what NirnAI did that the platform didn't:

    ```
    ┌─────────────────────────────────────────────────┐
    │  WHY NIRNAI SCORED THIS 82/100                  │
    │                                                  │
    │  ✔ Removed 3 listings with weak recent reviews   │
    │  ✔ Filtered 2 with misleading perfect ratings    │
    │  ✔ Weighted 47 reviews from last 90 days (3x)    │
    │  ✔ Penalized strict cancellation policy (-10)    │
    │  ✔ Found better-value alternatives nearby        │
    │                                                  │
    │  Confidence: 🟢 HIGH (298 reviews, 4.93 rating)  │
    └─────────────────────────────────────────────────┘
    ```

    ### 2.3 What NirnAI Does That Platforms Don't

    | Platform Shows | NirnAI Adds |
    |---------------|-------------|
    | 4.93 rating | **Effective rating** after recency weighting (may differ) |
    | "298 reviews" | **Review velocity** — 10/month recent vs 2/month historical |
    | Superhost badge | Superhost **with declining recent reviews** = warning |
    | Sort by price | **Value score** = quality/price ratio, not just cheapest |
    | No cross-listing context | **"Top 3 alternatives in same area, better value"** |

    ### 2.4 User Psychology at Decision Moment

    The user is about to spend $500+ on a booking. Their mental model:

    1. **"Is this listing as good as it looks?"** → NirnAI answers with review_trust + recency signal
    2. **"Am I overpaying?"** → NirnAI answers with value_score vs alternatives
    3. **"What am I missing?"** → NirnAI surfaces warnings the platform hides
    4. **"Should I keep looking?"** → NirnAI shows ranked alternatives with **visible tradeoffs**

    **This is not just UX — it's conversion logic.** A user who understands *why* NirnAI recommends something will click through and book.

    ### 2.5 Trust Killers (What We Must NOT Do)

    | Anti-pattern | Why It Kills Trust |
    |-------------|-------------------|
    | Wrong deduplication (showing "same property" when it's not) | Instant credibility death |
    | Ranking without explanation | "Why should I believe this?" |
    | Hiding tradeoffs | "This feels like an ad" |
    | Overriding user preferences | "I wanted beachfront, why show me downtown?" |
    | Confident scores on thin data | "82/100 based on 4 reviews?" |

    ---

    ## 3. What We Built (Current State)

    ### 3.1 Chrome Extension (Manifest V3)

    | Component | File | Purpose |
    |-----------|------|---------|
    | Content Script | `src/content/content.ts` | Auto-detects pages, extracts data, shows overlay panel |
    | Service Worker | `src/background/service-worker.ts` | Routes API calls, caches results, manages badge |
    | Popup | `src/popup/popup.html` | Extension popup UI |
    | Extractors | `src/content/extractors/*.ts` | Per-site DOM extraction adapters |

    **Supported Sites:**

    | Site | Extractor | Product Page | Cart Page | Status |
    |------|-----------|-------------|-----------|--------|
    | Amazon (.com, .in) | `amazon.ts` | Yes | Yes | Production |
    | Walmart | `walmart.ts` | Yes | Yes | Production |
    | Target | `target.ts` | Yes | Yes | Production |
    | Airbnb | `airbnb.ts` | Yes | N/A | Production |
    | Generic | `generic.ts` | Fallback | Fallback | Production |

    **Airbnb Extractor Capabilities:**
    - Title, price/night, rating, review count
    - Host info + Superhost status + response rate
    - Amenities, category ratings (cleanliness, accuracy, etc.)
    - Cancellation policy, check-in/checkout, property specs
    - Review snippets with dates + Review Timeline summary
    - Search context (dates, guests, location, bedrooms) for filtered alternatives
    - Location extraction from 7 DOM sources (handles custom listing names)

    ### 3.2 Agent Server (Rust/Axum)

    | Binary | Port | Endpoints |
    |--------|------|-----------|
    | `nirnai-server` | 8000 | `POST /analyze`, `POST /analyze-cart`, `GET /health` |

    **Architecture:**
    ```
    Extension → POST /analyze (ProductData JSON)
    → Server selects prompt (shopping vs travel based on source_site)
    → Creates ConversationRuntime with system prompt
    → Sends to Claude via ClawApiClient
    → Parses JSON response (strips markdown fences)
    → Returns AnalysisResponse to extension
    ```

    **Key Design Decisions:**
    - No tool use in analysis — pure reasoning (faster, cheaper)
    - max_iterations=1 — single-turn analysis, no conversation loops
    - Travel prompt auto-selected for source_site: airbnb, booking, vrbo, hotels
    - Search context passed in barcode field for filtered alternative URLs

    ### 3.3 Scoring Prompts

    **Shopping Prompt** — Standard product analysis:
    - purchase_score: reviews (25%), price (20%), seller (15%), returns (10%), popularity (10%), specs (10%), delivery (10%)
    - health_score: nutrition (40%), ingredients (35%), processing (25%) — food/supplements only
    - review_trust: trust_score, rating_strength, volume_confidence, distribution_quality, authenticity

    **Travel Prompt** — Accommodation-specific:
    - All shopping scores remapped: seller→host, returns→cancellation, specs→amenities, delivery→check-in
    - health_score ALWAYS scored: cleanliness (40%), safety (35%), neighborhood (25%)
    - **Recent Reality Signal**: 4x weight for last 30 days, 3x for 90 days, 1.5x for 6 months, 1x older
    - Superhost bonus (+15 to host score), response rate factored
    - Alternative suggestion uses pre-built search URL with filters (&superhost=true, etc.)

    ---

    ## 4. Architecture Overview

    ```
    ┌─────────────────────────────────────────────────────────┐
    │                    Chrome Extension                      │
    │                                                          │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
    │  │ Amazon   │  │ Walmart  │  │ Airbnb   │  │Booking  │ │
    │  │Extractor │  │Extractor │  │Extractor │  │Extractor│ │
    │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
    │       │              │              │              │      │
    │       └──────────────┴──────┬───────┴──────────────┘      │
    │                             │                             │
    │                    Content Script                         │
    │                    (intent detection,                     │
    │                     overlay UI)                           │
    │                             │                             │
    │                    Service Worker                         │
    │                    (API routing, cache)                   │
    └─────────────────────────────┬─────────────────────────────┘
                                │ POST /analyze
                                ▼
    ┌─────────────────────────────────────────────────────────┐
    │                   NirnAI Server (Rust/Axum)              │
    │                                                          │
    │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
    │  │  Shopping     │  │   Travel     │  │  Comparison   │  │
    │  │  Prompt       │  │   Prompt     │  │  Prompt       │  │
    │  │  (Amazon,     │  │  (Airbnb,    │  │  (Phase 0+)   │  │
    │  │   Walmart,    │  │   Booking)   │  │               │  │
    │  │   Target)     │  │              │  │               │  │
    │  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
    │         │                  │                   │          │
    │         └──────────────────┴───────────────────┘          │
    │                            │                              │
    │                   ConversationRuntime                     │
    │                   (session, permissions)                  │
    │                            │                              │
    │                     ClawApiClient                         │
    │                   (provider routing)                      │
    └────────────────────────────┬──────────────────────────────┘
                                │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
            ┌──────────┐  ┌──────────┐  ┌──────────┐
            │ Anthropic│  │  OpenAI  │  │   Grok   │
            │  Claude  │  │  GPT-5.4 │  │  Grok-4  │
            └──────────┘  └──────────┘  └──────────┘
    ```

    ---

    ## 5. AI Model Cost Analysis

    ### 5.1 Per-Analysis Token Usage (measured)

    A typical NirnAI product/listing analysis:
    - **System prompt**: ~1,500 tokens (shopping) / ~2,500 tokens (travel with recency rules)
    - **User prompt (product data)**: ~300-800 tokens
    - **Response (JSON)**: ~500-1,200 tokens

    **Average per analysis: ~2,500 input tokens + ~800 output tokens**

    ### 5.2 Model Pricing Comparison (per 1M tokens, as of April 2026)

    | Model | Provider | Input | Output | Cached Input | Per Analysis Cost | Quality |
    |-------|----------|-------|--------|-------------|-------------------|---------|
    | **claude-sonnet-4-6** | Anthropic | $15.00 | $75.00 | $1.50 | **~$0.098** | Excellent |
    | **claude-haiku-4-5** | Anthropic | $1.00 | $5.00 | $0.10 | **~$0.007** | Good |
    | **claude-opus-4-6** | Anthropic | $15.00 | $75.00 | $1.50 | ~$0.098 | Best (overkill) |
    | **GPT-5.4** | OpenAI | $2.50 | $15.00 | $0.25 | **~$0.018** | Excellent |
    | **GPT-5.4 mini** | OpenAI | $0.75 | $4.50 | $0.075 | **~$0.005** | Good |
    | **GPT-5.4 nano** | OpenAI | $0.20 | $1.25 | $0.02 | **~$0.002** | Acceptable |
    | **Gemini 3.1 Pro** | Google | $2.00 | $12.00 | $0.20 | **~$0.015** | Excellent |
    | **Gemini 3 Flash** | Google | $0.50 | $3.00 | $0.05 | **~$0.004** | Good |
    | **Gemini 2.5 Flash-Lite** | Google | $0.10 | $0.40 | $0.01 | **~$0.001** | Acceptable |
    | **Grok-4** | xAI | ~$3.00 | ~$15.00 | cached free | **~$0.020** | Good |
    | **Grok-3-mini** | xAI | ~$0.30 | ~$0.50 | cached free | **~$0.001** | Acceptable |

    ### 5.3 Monthly Cost Projections at Scale

    | Users/Day | Analyses/Day | Model | Monthly Cost | Notes |
    |-----------|-------------|-------|-------------|-------|
    | 10 | 30 | Sonnet | $88 | Current dev usage |
    | 10 | 30 | Haiku | $6 | Same quality tier, 93% savings |
    | 10 | 30 | GPT-5.4 mini | $5 | Comparable quality |
    | 100 | 500 | Sonnet | $1,470 | Unsustainable |
    | 100 | 500 | Haiku | $105 | Viable MVP |
    | 100 | 500 | Gemini Flash | $60 | Best cost/quality |
    | 1,000 | 5,000 | Haiku | $1,050 | Needs revenue |
    | 1,000 | 5,000 | GPT-5.4 mini | $750 | Competitive |
    | 1,000 | 5,000 | Gemini 2.5 Flash-Lite | $150 | Cheapest viable |
    | 10,000 | 50,000 | Gemini 2.5 Flash-Lite | $1,500 | Scale tier |

    ### 5.4 Key Insight: Anthropic Sonnet Is NOT Sustainable at Scale

    At current usage (Sonnet at $0.098/analysis), 1,000 daily users = **$1,470/month** in API costs alone. This only works if each user generates >$1.47/month in revenue.

    **Recommendation: Tiered model strategy (see Section 5).**

    ---

    ## 6. Model Strategy & Recommendation

    ### 6.1 Tiered Model Architecture

    ```
    ┌─────────────────────────────────────────────────┐
    │              NirnAI Model Router                 │
    │                                                  │
    │  Request → Classify Complexity → Route to Tier   │
    │                                                  │
    │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
    │  │  Tier 1  │  │  Tier 2  │  │    Tier 3     │  │
    │  │  FAST    │  │ STANDARD │  │    DEEP       │  │
    │  │          │  │          │  │               │  │
    │  │ Haiku /  │  │ GPT-5.4  │  │   Sonnet /    │  │
    │  │ GPT-5.4  │  │ mini /   │  │   GPT-5.4     │  │
    │  │ nano /   │  │ Gemini   │  │               │  │
    │  │ Gemini   │  │ Flash    │  │               │  │
    │  │ Flash-   │  │          │  │               │  │
    │  │ Lite     │  │          │  │               │  │
    │  └──────────┘  └──────────┘  └───────────────┘  │
    │                                                  │
    │  ~$0.002     ~$0.005-0.015    ~$0.018-0.098     │
    │  80% of      15% of           5% of             │
    │  requests    requests          requests          │
    └─────────────────────────────────────────────────┘
    ```

    **Routing Rules:**

    | Condition | Tier | Model | Why |
    |-----------|------|-------|-----|
    | Simple product (has rating, price, seller) | 1 — FAST | Haiku / GPT-5.4 nano | Straightforward scoring |
    | Travel listing OR food/health product | 2 — STANDARD | GPT-5.4 mini / Gemini Flash | Needs recency analysis, ingredient parsing |
    | Cross-platform comparison (5+ listings) | 3 — DEEP | Sonnet / GPT-5.4 | Complex ranking, deduplication reasoning |
    | Sparse data (no rating, no reviews) | 2 — STANDARD | GPT-5.4 mini | Needs inference from context |
    | Cart analysis (3+ items) | 2 — STANDARD | GPT-5.4 mini | Multiple items, needs coherent ranking |

    **Blended cost at scale (1,000 users/day):**
    - 80% Tier 1 at $0.002 = $240/month
    - 15% Tier 2 at $0.010 = $225/month
    - 5% Tier 3 at $0.050 = $375/month
    - **Total: ~$840/month** (vs $1,470 all-Sonnet)

    ### 6.2 Provider Exploration Options

    | Provider | Integration Effort | Pros | Cons | Verdict |
    |----------|-------------------|------|------|---------|
    | **Anthropic** (current) | Already built | Best structured JSON output, travel scoring is excellent | Most expensive | Keep for Tier 3 |
    | **OpenAI** | Harness supports it (set OPENAI_API_KEY) | GPT-5.4 mini is 95% Sonnet quality at 1/20th cost | Needs testing with our prompts | **Test immediately** |
    | **Google Gemini** | Add OpenAI-compat endpoint (Gemini supports it) | Flash-Lite at $0.001/analysis is game-changing for scale | Slightly worse at structured JSON | **Test for Tier 1** |
    | **xAI Grok** | Harness supports it (set XAI_API_KEY) | Free cached tokens, good reasoning | Less proven for structured output | Test later |
    | **Self-hosted (Llama/Mistral)** | Significant work | Zero marginal cost | Infra overhead, quality drop | Phase 4+ |

    ### 6.3 Immediate Action: Test GPT-5.4 mini

    The harness already supports OpenAI. To test:
    ```bash
    export OPENAI_API_KEY=sk-...
    export NIRNAI_MODEL=gpt-5.4-mini
    ```

    Run the same Airbnb listing and compare:
    - JSON structure compliance
    - Score accuracy vs Sonnet
    - Response latency
    - Cost per analysis

    If quality is >90% of Sonnet → switch Tier 1+2 to OpenAI immediately (85% cost reduction).

    ### 6.4 Gemini via OpenAI-Compatible Endpoint

    Google Gemini supports OpenAI-compatible endpoints. The harness can route to it:
    ```bash
    export OPENAI_API_KEY=<gemini-api-key>
    export OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
    export NIRNAI_MODEL=gemini-2.5-flash-lite
    ```

    This gives you $0.001/analysis — 98x cheaper than Sonnet. Test for Tier 1 (simple products).

    ---

    ## 7. Cross-Platform Decision Engine Vision

    ### 7.1 Core Principle

    > Users don't care about platforms. They care about outcomes.
    > Nirnai ranks outcomes, not listings.

    ### 7.2 Value Score Formula

    ```
    Value Score = (Trust × Recency × Quality × Confidence) / Normalized_Price
    ```

    Where:
    - **Trust** = review_trust.trust_score (0-100)
    - **Recency** = recent_review_ratio (0.5-1.0, based on % reviews in last 3 months)
    - **Quality** = purchase_score (0-100)
    - **Confidence** = min(review_count / 50, 1.0) — saturates at 50 reviews
    - **Normalized_Price** = (total_price / median_price_in_results) — relative to alternatives

    **Normalization:** Value Score output is 0-100, where 50 = average, 80+ = strong buy.

    ### 7.3 Data Layer Architecture

    ```
    Layer 1: Contextual Expansion (MVP)
    User on Listing → Extract {location, dates, guests, price, type}
    → Generate search query → Fetch top 20 from same platform
    → Score all → Rank top 5

    Layer 2: Platform Connectors (Phase 1-2)
    Same search query → Fetch from Airbnb + Booking.com
    → Score all with unified engine → Cross-platform ranking

    Layer 3: Property Identity (Phase 3)
    Match listings across platforms using:
        - Fuzzy title similarity
        - Geo proximity (<200m radius)
        - Image hash similarity (perceptual hashing)
        - Amenity set overlap
    → Merge into canonical properties
    → Combine reviews across platforms
    → Show: "Same property — $17 cheaper on Booking.com"
    ```

    ### 7.4 Cross-Platform Pricing Feature

    When the same property is found on multiple platforms:

    ```
    ┌─────────────────────────────────────────┐
    │  🟢 SAME PROPERTY — BETTER PRICE FOUND │
    │                                          │
    │  Airbnb:     $159/night                  │
    │  Booking.com: $142/night  ✅ Save $17    │
    │                                          │
    │  [Book on Booking.com]                   │
    └─────────────────────────────────────────┘
    ```

    **Implementation:**
    1. Normalize price: `total_price = nightly × nights + cleaning_fee + service_fee`
    2. Store in canonical format: `{ property_id, platforms: [{platform, price, score}] }`
    3. Highlight delta in UI

    ---

    ## 8. Scoring Engine Specification

    ### 8.1 Shopping Scoring (Amazon, Walmart, Target)

    | Factor | Weight | Signals |
    |--------|--------|---------|
    | Reviews | 25% | Rating, review count, review depth |
    | Price | 20% | vs category average, vs similar products |
    | Seller | 15% | Seller reputation, fulfilled-by status |
    | Returns | 10% | Return policy clarity and length |
    | Popularity | 10% | Review volume, sales rank |
    | Specs | 10% | Feature completeness, quality indicators |
    | Delivery | 10% | Speed, Prime/free shipping |

    **Health Score** (food/supplements/personal care only):
    - Nutrition: 40%, Ingredients safety: 35%, Processing level: 25%

    ### 8.2 Travel Scoring (Airbnb, Booking.com)

    | Factor | Weight | Signals |
    |--------|--------|---------|
    | Reviews | 25% | **Recency-weighted** — 4x last 30d, 3x last 90d, 1.5x last 6mo |
    | Price | 20% | Per night value, total with fees, vs area median |
    | Host | 15% | Superhost (+15), response rate, years hosting, verified |
    | Cancellation | 10% | Free=90+, moderate=60-80, strict=40-60, non-refundable=20-40 |
    | Popularity | 10% | Review frequency (10/month > 100 over 3 years) |
    | Amenities | 10% | WiFi, kitchen, washer, AC, parking, workspace |
    | Check-in | 10% | Self check-in, communication rating, instructions |

    **Safety Score** (always scored for travel):
    - Cleanliness: 40%, Safety/Accuracy: 35%, Neighborhood: 25%

    ### 8.3 Recent Reality Signal (Travel-Specific)

    ```
    Effective Rating = Σ(review_rating × recency_weight) / Σ(recency_weight)

    Recency weights:
    Last 30 days:   4.0x
    Last 90 days:   3.0x
    Last 6 months:  1.5x
    Older:          1.0x

    Warning triggers:
    - Recent reviews (3mo) avg < Historical avg - 0.3 → "Quality may be declining"
    - No reviews in 3 months → "No recent activity — verify listing is active"
    - All reviews within 2 weeks → "All reviews are very new — insufficient history"
    - Perfect 5.0 with <20 reviews → "Too few reviews to trust perfect score"
    ```

    ### 8.4 Decision Stamps

    | Stamp | Shopping Label | Travel Label | Condition |
    |-------|---------------|-------------|----------|
    | 🟢 SMART_BUY | Smart Buy | BOOK IT | purchase ≥ 75 AND health ≥ 60 (or N/A) |
    | 🟡 CHECK | Check | THINK TWICE | Everything else |
    | 🔴 AVOID | Avoid | SKIP | purchase < 40 OR health < 40 |

    ---

    ## 9. Confidence UX

    Scores mean nothing without visible confidence. Users must see *how much data* backs a score.

    ### 9.1 Confidence Tiers (Mandatory in Every Result)

    | Tier | Badge | Review Count | UI Treatment |
    |------|-------|-------------|-------------|
    | 🟢 High Confidence | Solid badge | 100+ reviews | Full scores shown, bold recommendation |
    | 🟡 Medium Confidence | Hollow badge | 20-99 reviews | Scores shown with "based on limited data" note |
    | 🔴 Low Confidence | Dashed badge | <20 reviews | Scores shown with prominent caveat: "Not enough reviews to be certain" |

    ### 9.2 Confidence Calculation

    ```
    confidence_score = min(review_count / 100, 1.0) × recency_factor × review_depth_factor

    recency_factor:
      >10 reviews in last 90 days → 1.0
      5-10 reviews in last 90 days → 0.8
      1-4 reviews in last 90 days  → 0.6
      0 reviews in last 90 days    → 0.4

    review_depth_factor:
      avg review length > 100 chars → 1.0
      avg review length 50-100      → 0.8
      avg review length < 50        → 0.6
    ```

    ### 9.3 "Why Ranked #1" (Mandatory for Every Comparison Result)

    Every ranked result must answer one question: **"Why is this better?"**

    ```
    ┌─────────────────────────────────────────────────┐
    │  #1  Cozy 2BR — Ridgewood Park                  │
    │  Score: 82/100  │  $159/night  │  🟢 BOOK IT    │
    │                                                  │
    │  WHY #1:                                         │
    │  • 298 reviews with 4.93 rating (🟢 High conf)   │
    │  • 47 reviews in last 90 days — active listing   │
    │  • Superhost with 98% response rate              │
    │  • Free cancellation (vs strict on #2, #3)       │
    │                                                  │
    │  TRADEOFF vs #2:                                 │
    │  • $17/night more expensive                      │
    │  • No pool (Alternative #2 has pool)             │
    │                                                  │
    │  [View on Airbnb]                                │
    └─────────────────────────────────────────────────┘
    ```

    **Rules:**
    - Every result shows positives AND tradeoffs vs alternatives
    - User sees *why* something ranked higher, not just that it did
    - Tradeoffs preserve user control — if the pool matters more to them, they can override
    - No ranking without explanation = no ranking at all

    ---

    ## 10. Implementation Phases (Revised)

    ```
    Timeline:

    Phase 0 ──── Phase 1 ──── Phase 2 ──── Phase 3 ──── Phase 4+
    Comparison   Booking.com   Cross-       Monetization  Property
    (Minimal)    Extractor     Platform     + Conversion  Identity
                               Ranking      Validation    Layer
    │              │              │              │              │
    ▼              ▼              ▼              ▼              ▼
    Top 5          2nd data       Unified        Affiliate +    Deduplicate
    same-platform  source         ranking API    conversion     across
    ranked                                       tracking       platforms
    ```

    **Key change from v1.0:** Property Identity Layer moved to Phase 4+ (see Section 15).
    Deduplication is HIGH-RISK. We must prove users click, trust rankings, and convert BEFORE
    attempting cross-platform property matching.

    ---

    ## 11. Phase 0: Same-Platform Comparison (Minimal)

    **Goal:** When user clicks "Better Alternative," show a NirnAI-branded ranked comparison instead of dropping them on a raw Airbnb search page.

    **Philosophy: Make this EVEN SMALLER than you think.**

    ### 11.1 What Changes

    | Current Flow | New Flow |
    |---|---|
    | Click "Search for this" → Raw Airbnb search page | Click "Compare alternatives" → NirnAI comparison panel |

    ### 11.2 MVP Scope (Deliberately Minimal)

    | Included | NOT Included (yet) |
    |----------|-------------------|
    | **Top 5 listings only** (not 10) | Cross-platform results |
    | Same platform only | Booking.com/other sources |
    | Individual scoring per listing | Deduplication |
    | "Why ranked #1" explanation | Complex filtering UI |
    | Confidence badges per result | User preference controls |
    | Tradeoffs between top results | Saved comparisons |

    **Why only 5:**
    - Faster (5 API calls vs 10 = half the cost and latency)
    - More reliable (less data noise)
    - Easier UX (no scrolling, no overwhelm)
    - Users don't compare 10 — they compare 3-5

    ### 11.3 Technical Approach

    **In-Extension Comparison Panel** (recommended for MVP)
    - New panel injected by content script on the Airbnb search results page
    - Extracts top 5 listings from the search results page
    - Sends all 5 to `/analyze-batch` endpoint
    - Displays ranked results with **Why #1**, **Confidence**, and **Tradeoffs**

    ### 11.4 New Server Endpoint

    ```
    POST /analyze-batch
    Body: { listings: ProductData[] (max 5), search_context: string }
    Response: {
      ranked: [
        {
          rank: 1,
          listing: ProductData,
          analysis: AnalysisResponse,
          value_score: number,
          confidence_tier: "high" | "medium" | "low",
          why_ranked: string,
          tradeoffs: string[]
        },
        ...
      ],
      comparison_summary: string
    }
    ```

    ### 11.5 Effort Estimate

    - Server endpoint: 1 day
    - Search results extractor (Airbnb, top 5): 1 day
    - Comparison overlay UI with confidence + tradeoffs: 2 days
    - Testing & polish: 1 day

    ---

    ## 12. Phase 1: Booking.com Extractor

    **Goal:** Second data source for cross-platform comparison.

    ### 12.1 Approach

    | Method | Effort | Legality | Data Quality |
    |--------|--------|----------|-------------|
    | DOM Extractor (like Airbnb) | 2-3 days | Gray area | Good |
    | Booking.com Affiliate API | 1-2 weeks (includes approval) | Legal | Excellent |
    | Both (extractor now, API later) | 3 days now | Start shipping | Best long-term |

    **Recommendation:** Build DOM extractor first (ships fast), apply for Affiliate API in parallel.

    ### 12.2 Booking.com Extractor Fields

    ```typescript
    // booking.ts — maps to ProductData
    title         → property name
    brand         → property chain (if any)
    price         → per night rate
    rating        → overall score (out of 10, normalize to 5)
    reviewCount   → total reviews
    seller        → property/host
    fulfiller     → "Genius" status, property type
    ingredients   → amenities/facilities
    nutritionInfo → category ratings + review snippets with dates
    returnPolicy  → cancellation policy (from booking conditions)
    delivery      → check-in/checkout times
    ```

    ### 12.3 Manifest Changes

    ```json
    "host_permissions": [
    "https://www.booking.com/*"
    ],
    "content_scripts": [{
    "matches": ["https://www.booking.com/*"]
    }]
    ```

    ---

    ## 13. Phase 2: Cross-Platform Ranking API

    **Goal:** Unified ranking across Airbnb + Booking.com results.

    ### 13.1 New Server Endpoint

    ```
    POST /compare
    Body: {
    query: {
        location: "Tampa, Florida",
        checkin: "2026-05-26",
        checkout: "2026-05-28",
        adults: 2,
        children: 2,
        bedrooms: 2
    },
    listings: {
        airbnb: ProductData[],
        booking: ProductData[]
    }
    }
    Response: {
    ranked: [{
        rank: 1,
        label: "SMART STAY" | "BEST VALUE" | "CHECK",
        platforms: [{
        platform: "airbnb",
        price: "$159",
        url: "...",
        score: 82
        }, {
        platform: "booking",
        price: "$142",
        url: "...",
        score: 79
        }],
        value_score: 87,
        why: "Superhost, 298 reviews, free cancellation. $17 cheaper on Booking.com.",
        warnings: [],
        positives: []
    }],
    summary: "Found 3 strong options in Tampa. Top pick saves you $17 by booking on Booking.com."
    }
    ```

    ### 13.2 Comparison Prompt (Tier 3 — Sonnet/GPT-5.4)

    This is the most complex prompt — it receives 10-20 listings across platforms and must:
    1. Score each individually
    2. Identify cross-platform duplicates (fuzzy match)
    3. Rank by Value Score
    4. Generate human-readable comparison

    **Estimated tokens:** ~5,000 input + ~2,000 output = ~$0.19/comparison (Sonnet)
    → Use Tier 3 model, max 5 comparisons/user/day on free tier

    ---

    ## 15. Phase 4+: Property Identity Layer (Deferred)

    **Goal:** Detect when the same property appears on multiple platforms.

    **Status: DEFERRED.** Moved from Phase 3 → Phase 4+ based on honest risk assessment.

    ### 15.1 Why Dedup Is Harder Than It Looks

    The matching logic (geo + title + amenities + images) sounds clean on paper. In reality:

    | Signal | Theory | Reality |
    |--------|--------|---------|
    | Geo proximity (<200m) | Parse lat/lng → compare | **Addresses are hidden** on most platforms. Lat/lng in meta tags is often fuzzy-rounded for privacy. |
    | Title similarity | Levenshtein/Jaccard → match | **Titles vary wildly.** "The Gem at Ridgewood Park" vs "Cozy 2BR Near USF" = same property, zero overlap. |
    | Image hash | pHash → compare | **Images differ.** Different crops, angles, lighting, seasonal photos. Same property may share 0 matching hashes. |
    | Amenity overlap | Set intersection | **Listings are incomplete.** One platform lists "WiFi, AC, kitchen." Other lists "Free parking, workspace, pool." Both miss things. |
    | Bedroom/bath count | Exact match | **Multiple listings per property.** Host may list "Full house" on Airbnb and "Private room" on Booking. |

    **The core problem:** A single false positive ("Same property — $17 cheaper!") when it's NOT the same property **destroys trust instantly.** This is the highest-risk feature in the product.

    ### 15.2 Prerequisites Before Attempting Dedup

    | Prerequisite | Why | How We Prove It |
    |-------------|-----|-----------------|
    | Users click NirnAI alternatives | Proves the ranking is valued | Click-through rate > 15% |
    | Users trust same-platform ranking | Proves scoring credibility | Return user rate > 30% |
    | Users convert via NirnAI links | Proves monetization works | Affiliate conversion > 1% |
    | Booking.com extractor is stable | Need reliable 2nd source | 2+ weeks without extraction failures |

    ### 15.3 Matching Signals (When We're Ready)

    | Signal | Weight | Implementation | False Positive Risk |
    |--------|--------|---------------|-------------------|
    | Geo proximity (<200m) | 30% | Parse lat/lng from meta tags or address | Medium — fuzzy coords |
    | Title similarity | 20% | Levenshtein / Jaccard, normalized | High — creative naming |
    | Amenity overlap | 20% | Set intersection of amenity lists | Medium — incomplete lists |
    | Image hash | 15% | Perceptual hash (pHash) | High — different photos |
    | Bedroom/bathroom match | 10% | Exact count match | Low |
    | **Human verification flag** | 5% | **User can confirm/deny match** | Reduces risk |

    **Critical addition:** User can flag "This is NOT the same property" — which trains the matcher and protects trust.

    ### 15.4 Canonical Property Format

    ```json
    {
      "property_id": "nirnai_abc123",
      "name": "Cozy 2BR Home in Tampa",
      "match_confidence": 0.78,
      "match_status": "probable" | "confirmed" | "user_verified",
      "location": { "lat": 27.95, "lng": -82.46 },
      "variants": [
        {
          "platform": "airbnb",
          "url": "...",
          "price": 159,
          "rating": 4.93,
          "review_count": 298
        },
        {
          "platform": "booking",
          "url": "...",
          "price": 142,
          "rating": 8.7,
          "review_count": 156
        }
      ],
      "merged_score": {
        "total_reviews": 454,
        "effective_rating": 4.85,
        "trust_score": 91,
        "best_price": { "platform": "booking", "price": 142 }
      }
    }
    ```

    ### 15.5 Why This Is Still The Moat (When Done Right)

    Airbnb may show perfect 4.93. Booking.com for the same property may reveal:
    - "Noisy neighborhood" (3 reviews)
    - "Photos are misleading" (2 reviews)

    **NirnAI exposes truth by merging signal across platforms.** No one else does this.

    But only if the match is correct. **Ship with "probable match" label + user confirmation**, not silent assertion.

    ---

    ## 14. Phase 3: Monetization & Conversion Validation

    ### 14.1 Revenue Streams

    | Stream | Revenue | Phase | Effort |
    |--------|---------|-------|--------|
    | **Affiliate links** | 3-5% of bookings | Phase 3 | Low — append affiliate tags to URLs |
    | **NirnAI Pro subscription** | $5-10/month | Phase 3 | Medium — gate comparison page, unlimited analyses |
    | **"NirnAI Verified" badge** | B2B SaaS ($$) | Phase 4+ | High — properties pay for trust stamp |
    | **Sponsored alternatives** | CPM/CPC | Phase 4+ | Medium — trust-first, clearly labeled |
    | **Data licensing** | Enterprise | Phase 4+ | Low marginal — aggregate trust data |

    ### 14.2 Affiliate Integration

    | Platform | Program | Commission | Approval |
    |----------|---------|------------|----------|
    | Booking.com | Affiliate Partner | 25-40% of Booking's commission (~3-4% of booking) | 2 weeks |
    | Amazon | Associates | 1-10% depending on category | Instant |
    | Walmart | Affiliate | 1-4% | 1 week |
    | Target | Affiliate (Impact) | 1-8% | 1 week |

    ### 14.3 Unit Economics (Target State)

    | Metric | Value |
    |--------|-------|
    | Avg booking value (travel) | $500 |
    | Affiliate commission | 3.5% = $17.50 |
    | Analyses per booking redirect | ~5 |
    | API cost per 5 analyses (Tier 1/2 blend) | ~$0.03 |
    | **Gross margin per conversion** | **$17.47 (99.8%)** |
    | Conversion rate (analysis → booking) | ~2% **(ASSUMED — MUST VALIDATE)** |
    | Revenue per 1,000 analyses | ~$350 |
    | Cost per 1,000 analyses | ~$6 |

    ### 14.4 Conversion Assumption Validation (CRITICAL)

    The 2% conversion assumption drives the entire business case. **This must be validated before scaling.**

    **Conversion Funnel Metrics to Track:**

    ```
    Impression (page load with NirnAI)
      → Panel Open Rate:        target > 40%     "Do users notice us?"
      → Analysis Completion:    target > 80%     "Do they wait for results?"
      → Alternative Click:      target > 15%     "Do they trust alternatives?"
      → Platform Redirect:      target > 10%     "Do they click through?"
      → Booking Completion:     target > 2%      "Do they actually book?"
      → Return Usage:           target > 30%     "Do they come back?"
    ```

    **Trust Drop-off Points (where users abandon):**

    | Drop-off Point | Signal | Fix |
    |---------------|--------|-----|
    | Panel opens but dismissed quickly | Score not credible or UI cluttered | Simplify, show confidence first |
    | Reads analysis but ignores alternatives | Alternatives feel random or irrelevant | Better search context, visible tradeoffs |
    | Clicks alternative but doesn't book | Landing page mismatch or price changed | Deep-link to exact listing, show "price as of X" |
    | Uses once, never returns | Didn't provide enough value or felt intrusive | Reduce friction, remember preferences |

    **Minimum Viable Tracking (Phase 3 launch):**
    - `panel_opened` — count per page load
    - `analysis_viewed` — user read the result
    - `alternative_clicked` — which rank, which listing
    - `redirect_completed` — user left to booking platform
    - `return_visit` — same user, different session

    These metrics **gate Phase 4+.** No conversion data = no property dedup investment.

    ---

    ## 16. Cost Projections Per Phase

    ### 16.1 Infrastructure Costs

    | Component | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
    |-----------|---------|---------|---------|---------|
    | Server hosting | $0 (local) | $20/mo (Railway/Fly) | $50/mo | $100/mo |
    | AI API (100 users/day) | $6/mo (Haiku) | $15/mo (tiered) | $40/mo (comparisons) | $60/mo |
    | Domain + SSL | $0 | $15/year | $15/year | $15/year |
    | Database | $0 | $0 (SQLite) | $20/mo (Postgres) | $50/mo |
    | **Total** | **$6/mo** | **$35/mo** | **$110/mo** | **$210/mo** |

    ### 16.2 Break-Even Analysis

    | Phase | Monthly Cost | Revenue Needed | How |
    |-------|-------------|---------------|-----|
    | Phase 0-1 | $35 | $0 (pre-revenue) | Self-funded |
    | Phase 2 | $110 | $110 | ~7 affiliate bookings/month |
    | Phase 3 | $210 | $210 | ~12 affiliate bookings/month |
    | Scale (1K users) | $840 | $840 | ~48 bookings/month (4.8% of users) |

    ---

    ## 17. Competitive Landscape

    ### 17.1 The Ecosystem Today

    Comparison sites already exist — a lot of them. Understanding the layers matters.

    ```
    ┌─────────────────────────────────────────────────────────────┐
    │                    EXISTING ECOSYSTEM                        │
    │                                                              │
    │  Aggregators (search)        OTAs (booking)                  │
    │  ────────────────────        ─────────────────               │
    │  Google Flights              Expedia                         │
    │  Kayak                       Booking.com                     │
    │  Skyscanner                  Hotels.com                      │
    │                                                              │
    │  What they do:               What they do:                   │
    │  • Pull from multiple        • Let you book                  │
    │    sources                   • Bundle deals                  │
    │  • Show prices side-by-side  • Sometimes adjust pricing      │
    │  • Help you explore                                          │
    │                                                              │
    │  What they ALL have in common:                               │
    │  ✔ Compare prices                                            │
    │  ✔ Provide filters                                           │
    │  ✔ Show ratings                                              │
    │  ❌ None answer: "Is this actually a good decision?"          │
    └─────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                    THE GAP (NirnAI lives here)               │
    │                                                              │
    │  Users STILL:                                                │
    │  • Open multiple tabs                                        │
    │  • Cross-check prices manually                               │
    │  • Read reviews one by one                                   │
    │  • Make gut decisions on $500+ bookings                      │
    │                                                              │
    │  Because existing tools help you FIND options,               │
    │  not DECIDE between them.                                    │
    └─────────────────────────────────────────────────────────────┘
    ```

    ### 17.2 The Fundamental Difference

    | | Existing Tools | NirnAI |
    |---|---|---|
    | **Flow** | Search → Filter → Compare → **YOU decide** | Analyze → Rank → Explain → Recommend → **YOU confirm** |
    | **Layer** | Navigation tool ("here are routes") | Decision co-pilot ("take THIS route — here's why") |
    | **Competing on** | Inventory, price scraping, filters | Trust, clarity, decision confidence |

    This is a completely different layer. NirnAI doesn't need better inventory or faster price scraping. It needs better *judgment*.

    ### 17.3 The 4 Big Differences

    **1. They compare prices — NirnAI compares outcomes**

    | Aggregator Shows | NirnAI Shows |
    |-----------------|-------------|
    | "$142 vs $159" | "$142 (good value, slightly weaker reviews) vs $159 (higher trust, safer stay)" |
    | Pick by price | Pick by preference — price, trust, or safety |

    This is **decision intelligence**, not price intelligence.

    **2. They use averages — NirnAI uses recency**

    | Aggregator Shows | NirnAI Shows |
    |-----------------|-------------|
    | "4.8 rating" (3 years of reviews) | "4.8 overall BUT recent reviews declining — last 3 months worse than average" |

    No major platform does this well today. This is NirnAI's sharpest edge.

    **3. They don't merge truth — NirnAI does**

    | Aggregator Shows | NirnAI Shows |
    |-----------------|-------------|
    | Airbnb reviews (separate) | 300 Airbnb reviews + 150 Booking reviews |
    | Booking reviews (separate) | Combined reality: Booking reveals hidden issues Airbnb didn't |

    This is the moat. When done right (Phase 4+), no one else does this.

    **4. They don't guide decisions — NirnAI does**

    | Aggregator Shows | NirnAI Shows |
    |-----------------|-------------|
    | "Here are 100 options" | Top 5 only. Ranked. Explained. Actionable. |
    | Effort: HIGH | Effort: LOW |
    | Confusion: HIGH | Confusion: NONE |

    NirnAI reduces decision fatigue, not just search fatigue.

    ### 17.4 Per-Competitor Breakdown

    | Competitor | What They Do | What They Miss | NirnAI Advantage |
    |-----------|-------------|---------------|-----------------|
    | **Google Travel** | Price aggregation | No review quality analysis | Trust intelligence |
    | **Kayak** | Cross-platform search | No trust scoring | Decision stamps |
    | **Skyscanner** | Flight/hotel price comparison | No outcome ranking | Decision co-pilot layer |
    | **TripAdvisor** | Review aggregation | No recency weighting | Recent Reality Signal |
    | **Expedia** | Booking + bundling | No cross-platform truth | Merged review intelligence |
    | **Fakespot** | Fake review detection | Shopping only, no travel | Multi-vertical + scoring |
    | **ReviewMeta** | Amazon review analysis | Single platform | Cross-platform + decision |
    | **Honey** | Price tracking + coupons | No quality/trust analysis | Trust + quality + price |
    | **NirnAI** | **Decision intelligence** | — | **Ranks outcomes, not listings** |

    ### 17.5 Where NirnAI Can Fail (Honest)

    If NirnAI:
    - Only shows lists → becomes another aggregator
    - Only shows scores → becomes Fakespot
    - Doesn't explain clearly → loses trust
    - Doesn't show tradeoffs → feels like an ad

    **The defense against all four: "Why #1" + visible tradeoffs + confidence badges.** These are not features — they are survival requirements.

    ### 17.6 Defensibility

    | Moat | Strength | Timeline |
    |------|----------|----------|
    | Recency-weighted scoring | Medium — others could copy, but NirnAI ships first | Phase 0 |
    | Decision intelligence layer (rank + explain + tradeoffs) | Strong — requires different product philosophy | Phase 0 |
    | Cross-platform review merging | Strong — no one does this | Phase 4+ |
    | Trust data accumulation | Compounds over time | Phase 2+ |
    | Property Identity Layer | Very strong — hard to replicate correctly | Phase 4+ |
    | "NirnAI Verified" brand | Very strong if established early | Phase 4+ |

    ---

    ## 18. Risk Register

    | Risk | Probability | Impact | Mitigation |
    |------|------------|--------|------------|
    | Airbnb blocks extension | Medium | High | Generic extractor fallback, user-driven data input |
    | API costs exceed revenue | Medium | High | Tiered model strategy, caching, rate limits |
    | Platform ToS changes | Medium | Medium | Affiliate APIs as primary, scraping as supplement |
    | Bad scoring damages trust | Low | Critical | Confidence tiers, "verify on listing page" disclaimers |
    | Competitor copies approach | Medium | Medium | Speed to market, data moat, brand trust |
    | Model quality degrades on cheaper tiers | Low | Medium | A/B testing, quality benchmarks, fallback to higher tier |
    | **False positive dedup match** | **High** | **Critical** | **Defer dedup to Phase 4+, ship with "probable match" + user confirm** |
    | **Users don't trust ranked list** | **Medium** | **High** | **"Why ranked #1" mandatory, visible tradeoffs, confidence badges** |
    | **Conversion assumption (2%) is wrong** | **Medium** | **High** | **Track full funnel from Phase 0, gate investment on data** |
    | **Comparison UX overwhelms users** | **Low** | **Medium** | **Top 5 only, not 10. Simpler = more trustable.** |

    ---

    ## 19. Decision Log

    | Date | Decision | Rationale | Status |
    |------|----------|-----------|--------|
    | Apr 2, 2026 | Use Anthropic Claude Sonnet for analysis | Best structured JSON output quality | Active (to be tiered) |
    | Apr 2, 2026 | Agent-based scoring (not ML pipeline) | Eliminates need for separate sentiment/classifier engines | Active |
    | Apr 3, 2026 | Airbnb as first travel platform | Highest trust gap, most user impact | Shipped |
    | Apr 3, 2026 | Recency-weighted scoring (4x/3x/1.5x/1x) | Recent reviews matter exponentially more for travel | Shipped |
    | Apr 3, 2026 | Pre-built search URLs in extractor | Agent was constructing broken URLs | Shipped |
    | Apr 3, 2026 | Tiered model strategy | Sonnet at $0.098/analysis unsustainable at scale | Planned |
    | Apr 3, 2026 | Test GPT-5.4 mini immediately | 95% quality at 1/20th cost, harness already supports it | Next action |
    | Apr 3, 2026 | Gemini via OpenAI-compat endpoint | $0.001/analysis for Tier 1 tasks | To test |
    | **Apr 3, 2026** | **Phase 0 = Top 5 only, same platform** | **Faster, more reliable, easier UX. Users don't compare 10.** | **Adopted** |
    | **Apr 3, 2026** | **Property Identity Layer → Phase 4+** | **Dedup is high-risk. False positive match = instant trust death.** | **Adopted** |
    | **Apr 3, 2026** | **"Why ranked #1" mandatory** | **Users won't trust ranking without visible explanation + tradeoffs** | **Adopted** |
    | **Apr 3, 2026** | **Confidence UX badges (High/Medium/Low)** | **Scores mean nothing without visible data backing. Builds trust immediately.** | **Adopted** |
    | **Apr 3, 2026** | **Conversion funnel tracking gates Phase 4+** | **2% conversion assumption must be validated before scaling investment** | **Adopted** |
    | **Apr 3, 2026** | **Near-term positioning: "Best option finder"** | **"Decision OS" is too abstract for adoption. Simple = higher conversion.** | **Adopted** |

    ---

    ## Appendix A: Quick Reference — Environment Variables

    ```bash
    # Current (Anthropic)
    export ANTHROPIC_API_KEY=sk-ant-...
    export NIRNAI_MODEL=claude-sonnet-4-6     # or claude-haiku-4-5 for cost savings

    # OpenAI (to test)
    export OPENAI_API_KEY=sk-...
    export NIRNAI_MODEL=gpt-5.4-mini

    # Gemini via OpenAI-compat (to test)
    export OPENAI_API_KEY=<gemini-api-key>
    export OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
    export NIRNAI_MODEL=gemini-2.5-flash

    # Grok (to test)
    export XAI_API_KEY=xai-...
    export NIRNAI_MODEL=grok-3-mini

    # Server
    export PORT=8000  # default
    ```

    ## Appendix B: File Map

    ```
    Nirnai extension/
    ├── manifest.json                              # Chrome extension manifest
    ├── build.mjs                                  # esbuild bundler (dev→localhost, prod→AWS)
    ├── src/
    │   ├── types.ts                               # Shared TypeScript types
    │   ├── content/
    │   │   ├── content.ts                         # Content script (extraction + overlay UI)
    │   │   └── extractors/
    │   │       ├── base.ts                        # SiteExtractor interface
    │   │       ├── amazon.ts                      # Amazon DOM extractor
    │   │       ├── walmart.ts                     # Walmart DOM extractor
    │   │       ├── target.ts                      # Target DOM extractor
    │   │       ├── airbnb.ts                      # Airbnb DOM extractor (travel)
    │   │       └── generic.ts                     # Fallback extractor
    │   ├── background/
    │   │   └── service-worker.ts                  # API routing, caching, badge
    │   └── popup/
    │       └── popup.html                         # Extension popup
    ├── NIRNAI_V1_PRODUCT_DOCUMENT.md              # This document
    ├── nirnai_cross_platform_strategy.md          # Strategy doc
    └── nirnai_travel_strategy.md                  # Travel targeting doc

    rust/crates/server/
    ├── Cargo.toml                                 # Dependencies (api, runtime, axum, tower-http)
    └── src/
        ├── main.rs                                # HTTP server binary (routes, CORS)
        ├── lib.rs                                 # Session management module
        └── nirnai.rs                              # NirnAI types, prompts, handlers

    rust/crates/api/src/providers/
        ├── mod.rs                                 # Model registry, alias resolution, provider routing
        ├── claw_provider.rs                       # Anthropic client
        └── openai_compat.rs                       # OpenAI + xAI client
    ```

    ---

    *End of document. Last updated: April 3, 2026.*
