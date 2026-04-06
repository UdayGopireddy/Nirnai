
# Nirnai Provisional Patent Filing Package
## Consolidated Draft: Provisional Disclosure + Sample Claim Language + Trade Secret Boundary
**Prepared for filing support**
**Date:** April 6, 2026

---

## Important Note

This document is a founder-ready draft package to help prepare a U.S. provisional patent application.
It is not legal advice and should ideally be reviewed by a patent attorney before filing.

A U.S. provisional application generally does not require formal claims, but this package includes sample claim language for later use in a non-provisional filing strategy.

---

# Table of Contents

1. Filing Strategy Summary
2. What to Patent vs What to Keep Secret
3. Provisional Patent Disclosure Draft
4. Technical Diagrams
5. Embodiments and Variations
6. Sample Claim Language
7. Draft Filing Checklist
8. What Not to Disclose
9. Final Founder Notes

---

# 1. Filing Strategy Summary

## 1.1 Core Filing Rule

Patent the METHOD. Keep the PARAMETERS as trade secrets.

### Patent:
- system architecture
- multi-stage extraction and ranking pipeline
- temporal review weighting framework
- cross-platform entity resolution
- cross-platform review merging
- explainable ranking and decision presentation
- progressive ranking under partial data availability
- priority-based source orchestration
- off-screen browser window collection method
- fair source distribution (round-robin bucketing)
- adaptive geographic area classification
- multi-factor gated decision categorization
- geo-indexed inventory persistence and pre-computed recommendations
- domain-aware automatic scoring methodology selection
- review velocity and frequency analysis

### Keep Secret:
- exact numeric weights
- thresholds
- prompts
- platform selectors
- source reliability tuning
- city and category priors
- confidence formulas
- tie-breakers
- model routing heuristics
- internal quality scoring recipes
- exact off-screen window coordinates and dimensions
- exact round-robin allocation formulas
- specific city-to-density database mappings
- exact dual-threshold score gates per category
- exact geo-index freshness window durations
- per-domain scoring weight configurations

---

## 1.2 Recommended Patent Positioning

The strongest filing angle is not:
- "AI recommendation"
- "browser extension for shopping"

The strongest filing angle is:

A cross-platform decision optimization system that extracts platform data, resolves common entities, applies temporal weighting to user-generated content, fuses heterogeneous review signals, ranks outcomes, and generates explainable recommendations under partial and evolving data availability.

---

## 1.3 Core Patent Themes

The filing should center around these technical pillars:

1. Temporal weighting of review data
2. Cross-platform entity resolution
3. Cross-platform review normalization and merging
4. Decision scoring and ranking
5. Progressive ranking under partial data availability
6. Explainable recommendation output
7. Priority-based source orchestration
8. Off-screen browser window data collection technique
9. Fair source distribution via round-robin bucketing
10. Adaptive geographic area classification
11. Multi-factor gated decision categorization (dual-threshold stamps)
12. Geo-indexed inventory persistence for pre-computed recommendations
13. Domain-aware automatic scoring methodology selection

---

# 2. What to Patent vs What to Keep Secret

## 2.1 Sixteen Things to Disclose in the Patent

1. Multi-source extraction of listing/product/review data
2. Entity resolution across heterogeneous platforms
3. Temporal weighting of reviews based on recency cohorts or decay functions
4. Unified trust scoring from multiple review ecosystems
5. Candidate ranking using trust, quality, recency, and price/value
6. Progressive recommendation generation before all sources complete
7. Priority-tier orchestration across multiple source systems
8. Explainable ranking with score-impact reasoning
9. Human-in-the-loop correction feedback for entity matching
10. Delivery through overlay UI, web application, or API layer
11. Off-screen browser window collection to avoid OS throttling of hidden windows
12. Fair source distribution via round-robin bucketing to prevent temporal response-order bias
13. Adaptive geographic area classification (tiered: knowledge base → bounding box → density heuristic)
14. Multi-factor gated decision categorization requiring independent threshold satisfaction
15. Geo-indexed inventory persistence with pre-computed recommendation serving
16. Domain-aware automatic scoring methodology selection based on detected source platform category

---

## 2.2 Eighteen Things to Keep as Trade Secret

1. Exact recency multipliers
2. Exact decision thresholds
3. Prompt wording and prompt architecture
4. Source-specific DOM selectors and extraction recipes
5. Source reliability weights
6. Model routing and fallback logic
7. Confidence scoring formula details
8. Ranking tie-breaker logic
9. Category-specific weight tuning
10. Platform and city priors
11. Material-change thresholds for rerendering
12. Internal evaluation benchmarks and calibration dataset
13. Exact off-screen window pixel coordinates and window dimensions
14. Exact per-source allocation counts and remainder-fill logic
15. Specific city/neighborhood-to-density-category database entries
16. Exact dual-threshold score values per vertical (e.g., purchase ≥ X, health ≥ Y)
17. Exact geo-index freshness windows and bounding-box expansion factors
18. Per-domain scoring dimension weights and label vocabulary

---

## 2.3 Decision Rule

### Patent:
- the technical method
- the transformation pipeline
- the interaction among system components

### Keep Secret:
- the exact constants, formulas, and operational tuning that make the system outperform others

---

# 3. Provisional Patent Disclosure Draft

## Title

System and Method for Cross-Platform Decision Optimization Using Temporal Review Weighting, Entity Resolution, Progressive Ranking, and Explainable Output

---

## 3.1 Field of the Invention

The present invention relates generally to computer-implemented systems for information processing and decision optimization. More particularly, the invention relates to systems and methods for:

- extracting data from multiple independent digital platforms
- identifying common underlying entities across those platforms
- temporally weighting user-generated review content
- merging heterogeneous review and quality signals
- generating ranked recommendations
- producing explainable outputs under partial or progressively available data

The invention is applicable to travel accommodations, retail products, services, food products, hospitality inventory, and other multi-option decision environments.

---

## 3.2 Background

Users increasingly rely on digital platforms to select products, accommodations, and services. Such platforms often expose:
- ratings
- review counts
- written reviews
- price information
- platform-specific listing information

However, existing systems typically suffer from several technical deficiencies:

1. Historical averaging problem  
   Ratings and reviews are commonly aggregated over long time periods, which can obscure recent quality changes.

2. Platform silo problem  
   Identical entities may appear across multiple platforms with different prices, different reviews, and different rating distributions.

3. Entity fragmentation problem  
   The same underlying entity may not be recognized across platforms due to title variations, platform-specific identifiers, incomplete location details, and other structural differences.

4. Decision overload problem  
   Users are often forced to manually compare many options across multiple sources without a system that ranks or explains outcomes.

5. Slow or incomplete aggregation problem  
   Some source systems are slow, heavily client-rendered, anti-automation protected, or intermittently unavailable, causing conventional multi-source comparisons to block while waiting for stragglers.

6. Source dominance bias problem  
   When collecting candidates from multiple platforms, faster-responding or higher-volume platforms may dominate the candidate pool, introducing systematic bias unrelated to candidate quality.

7. Geographic context insensitivity problem  
   Existing systems apply uniform search parameters regardless of whether the target area is a dense urban center or a sparse rural region, leading to either over-saturated or under-populated candidate pools.

8. Single-dimension recommendation masking problem  
   Systems that gate recommendations on a single composite score may recommend candidates that excel in one dimension but have critical deficiencies in another (e.g., high quality but poor safety).

Accordingly, there exists a need for a technical system that:
- identifies equivalent entities across independent systems
- accounts for temporal relevance of review signals
- merges cross-platform evidence
- ranks results before all sources fully complete when sufficient confidence exists
- explains why a result is recommended
- ensures balanced source representation in the candidate pool
- adapts collection behavior to geographic context
- gates recommendations on multiple independent quality dimensions
- persists and re-serves ranked results for instant future recommendations

---

## 3.3 Summary of the Invention

The present invention provides a computer-implemented system that:

1. receives or extracts listing or product data from one or more source platforms;
2. optionally expands a search context to retrieve comparable alternatives from additional source platforms using off-screen browser windows that maintain full rendering capability;
3. classifies the geographic search area into a density category using a tiered classification approach;
4. applies fair source distribution to ensure balanced representation from all responding platforms;
5. resolves whether multiple platform listings correspond to a common underlying entity;
6. segments review data into recency cohorts or applies a temporal decay function;
7. computes review velocity metrics to assess listing activity status;
8. computes temporally weighted trust or quality scores;
9. merges normalized signals from multiple review ecosystems;
10. automatically selects a domain-appropriate scoring methodology based on detected source platform category;
11. computes one or more decision scores;
12. applies multi-factor gated categorization requiring independent threshold satisfaction across multiple score dimensions;
13. ranks candidate entities or listings;
14. generates a recommendation and an explanation;
15. persists ranked results to a geo-indexed searchable database; and
16. outputs such recommendation through an overlay, web page, application view, or API response.

In some embodiments, the system produces recommendations before all possible source systems complete, provided minimum sufficiency conditions are satisfied. In some embodiments, the system continues enrichment in the background and updates ranking only when a material change threshold is exceeded. In some embodiments, the system serves pre-computed recommendations from previously persisted results when a subsequent query matches a previously ranked geographic area within a freshness window.

---

## 3.4 Definitions

### Entity
An underlying product, stay, service, or listing that may appear on one or more platforms.

### Variant
A platform-specific representation of an entity, including its own metadata, price, rating, review corpus, and URL.

### Temporal weighting
A process by which newer review evidence receives greater influence than older review evidence.

### Progressive ranking
Generation of one or more rankings from partial data before all sources have completed.

### Explainable output
A human-readable recommendation that identifies at least one rationale for rank, trust, or risk.

### Off-screen browser window
A browser window of standard rendering type positioned at coordinates outside the visible display area, used to maintain full JavaScript execution priority during data collection.

### Fair source distribution
A method of allocating candidate pool capacity equally among responding source platforms to prevent temporal response-order bias.

### Geographic density classification
A categorization of a search area into a density type (such as dense urban, urban, suburban, resort, or rural) that influences search radius, collection depth, and ranking context.

### Multi-factor gated categorization
A decision labeling process that requires multiple independent score dimensions to each independently satisfy a threshold before assigning a positive recommendation label.

### Review velocity
The rate at which new reviews are posted for a given entity within a recent time window, used as an independent signal of listing activity status.

### Geo-indexed inventory
A searchable database of previously ranked results indexed by geographic coordinates and destination identifiers, enabling instant re-serving of pre-computed recommendations.

---

## 3.5 System Overview

The system may include one or more of the following components:

- data extraction module
- off-screen browser window manager
- source orchestration module
- fair source distribution module
- candidate expansion module
- geographic area classification module
- entity resolution module
- temporal weighting engine
- review velocity analysis module
- review normalization and merging module
- domain-aware scoring methodology selector
- trust scoring engine
- value/quality scoring engine
- multi-factor gated decision categorization module
- ranking engine
- explanation generation module
- geo-indexed inventory persistence module
- user interface module
- telemetry and feedback module

In certain embodiments, one or more components may be deployed in:
- a browser extension
- a web server
- a cloud service
- a local runtime
- a hybrid client-server architecture

---

## 3.6 Data Extraction Layer

The data extraction layer obtains information from one or more digital platforms.

### Example inputs:
- title
- listing name
- product name
- price
- fees
- ratings
- review counts
- review text
- review timestamps
- amenities
- category ratings
- location data
- images
- seller or host information
- cancellation/return policies
- check-in or delivery details

In some embodiments, extraction occurs from a platform page directly displayed to a user.
In other embodiments, extraction occurs from search results, APIs, or pre-fetched source pages.

### 3.6.1 Off-Screen Browser Window Collection Technique

Many modern digital platforms render listing and review data through client-side JavaScript frameworks (single-page applications). Operating systems commonly reduce JavaScript execution priority, suspend timers, or throttle rendering for browser windows that are minimized, hidden, or set to a zero-visibility state.

In one embodiment, the system creates one or more browser windows of a standard rendering type and positions them at coordinates outside the visible display area of the user's screen (for example, at a large negative horizontal or vertical offset). Because these windows are not minimized and maintain standard dimensions, the operating system continues to execute JavaScript, render DOM elements, and process asynchronous data loading at full speed.

This technique provides a technical advantage: it enables parallel multi-source data collection from platforms that require full client-side rendering, without degrading extraction quality or speed due to operating system throttling policies. The windows may be created and destroyed programmatically as part of the orchestration lifecycle.

In some embodiments, each off-screen window loads a platform search URL constructed from the user's search context (destination, dates, guests, product query, etc.) and extracts structured data once the page has fully rendered.

### 3.6.2 Multi-Layer Extraction Hierarchy

In some embodiments, the data extraction layer employs a hierarchical extraction approach for each platform page. The system first attempts extraction from structured data formats embedded in the page (such as JSON-LD or schema.org markup). If structured data is absent or incomplete, the system falls back to platform-specific metadata tags. If those are also insufficient, the system applies DOM-level selector-based extraction against known page structures.

This multi-layer approach maximizes extraction reliability across platforms with varying levels of structured data support.

---

## 3.7 Source Orchestration Layer

The source orchestration layer coordinates data gathering across multiple source systems.

### In some embodiments, the system:
- groups sources into priority tiers
- assigns separate timeout budgets to different source types
- terminates slow or non-responsive source collection
- generates a partial ranking once confidence sufficiency is reached
- treats some sources as enrichment-only sources that do not block ranking

### Example source roles:
- primary ranking sources
- price enrichment sources
- review enrichment sources
- candidate discovery sources

In some embodiments, the system launches a first tier of source retrievals, computes a provisional ranking, and conditionally launches additional tiers only if candidate quality or confidence remains insufficient.

### 3.7.1 Fair Source Distribution via Round-Robin Bucketing

When the system collects candidate listings from multiple source platforms, certain platforms may return results faster or return more results than others. If the system simply takes candidates in the order received, the ranking pool may be dominated by whichever platform responded first or returned the most data, introducing temporal response-order bias.

To address this, the system employs a fair source distribution method:

1. Upon receiving candidate listings from all responding source platforms, the system groups candidates by their originating source platform.
2. The system determines a maximum candidate pool size.
3. The system computes an equal allocation share for each responding source platform by dividing the maximum pool size by the number of responding sources.
4. The system selects up to the allocated share of candidates from each source platform.
5. If one or more source platforms returned fewer candidates than their allocated share, the remaining capacity is filled from overflow candidates of other sources.

This method ensures that the ranking engine receives a balanced, representative sample from all data sources, regardless of which platform responded first or returned the most raw candidates.

### 3.7.2 Data Richness Prioritization

In some embodiments, when selecting which candidates to include from each source platform's allocation, the system prioritizes candidates that have richer data completeness. Each candidate may receive a data-richness score based on the presence or absence of key fields such as:

- price information
- rating information
- review count
- review text content
- amenity or feature data
- image availability
- location data

Candidates with higher data richness are preferentially selected, as they provide better inputs to the scoring and ranking engines.

---

## 3.8 Progressive Ranking Under Partial Data Availability

This is a core part of the invention.

Traditional systems may wait for all sources before returning a result. The present invention instead allows:
- early ranking from a subset of high-value sources
- ranking updates only when a material improvement or material rank change occurs
- final or near-final recommendation without requiring all sources to finish

### Example sufficiency conditions:
- enough high-confidence candidates
- enough priority sources completed
- enough review evidence
- enough unique entities after deduplication

### Example refinement rules:
- continue enrichment in the background
- rerank only if top result changes
- rerank only if price delta exceeds a threshold
- rerank only if confidence materially changes

---

## 3.9 Entity Resolution Layer

The entity resolution layer determines whether platform-specific variants correspond to a common underlying entity.

### Matching inputs may include:
- geographic proximity
- title similarity
- description similarity
- amenity set similarity
- image similarity
- host/brand identity
- room count or property-type alignment
- user correction feedback

### Matching output may include:
- canonical entity identifier
- confidence score for match
- merged group of variants

In some embodiments, a feedback loop allows a user or operator to confirm or correct a proposed match, and the correction is stored to improve subsequent matching.

---

## 3.10 Cross-Platform Review Normalization and Merging

Once entity resolution groups multiple variants, the system normalizes platform-specific evidence.

### Examples of normalization:
- converting different rating scales to a shared scale
- weighting different platforms based on source reliability
- adjusting for differences in review count and sparsity
- reconciling conflicting reviews across platforms

The system computes one or more merged outputs:
- unified trust score
- unified effective rating
- merged sentiment profile
- merged issue frequency profile
- merged confidence score

This allows a single recommendation to reflect the combined truth of multiple platforms, rather than isolated platform-specific views.

---

## 3.11 Temporal Weighting Engine

The temporal weighting engine transforms review data based on review age.

### In some embodiments:
- review data is divided into cohorts based on time
- newer cohorts are given greater influence
- older cohorts remain present but less determinative

### Example cohorting approaches:
- last quartile of reviews
- most recent fixed time window
- recent cohort vs historical cohort
- continuous decay curve

### Example outputs:
- recent reality score
- trend classification
- recent-vs-historical delta
- issue acceleration signal
- confidence adjustment based on recency density

The system may classify an entity as:
- improving
- declining
- stable
- uncertain due to sparse recent data

### 3.11.1 Review Velocity and Frequency Analysis

Distinct from temporal weighting of individual reviews, the system may also compute review velocity — the rate at which new reviews are being posted for a given entity or listing.

Review velocity provides an independent signal about the entity's operational status:

- A listing with high total review count but near-zero recent review velocity may indicate a dormant, closed, or delisted entity.
- A listing with accelerating review velocity may indicate growing popularity or a recently launched promotion.
- A listing with sudden deceleration in review velocity may indicate a service disruption or quality issue.

In some embodiments, the system computes:
- recent review frequency (reviews per time unit over a recent window)
- velocity trend (accelerating, decelerating, or stable)
- activity classification (active, slowing, dormant)

This signal may be used to adjust confidence scores, flag potentially stale listings, or prioritize actively-reviewed candidates in the ranking.

---

## 3.12 Context and Event Detection

In some embodiments, the system detects contextual changes affecting interpretation of reviews.

Examples:
- seasonality
- management or ownership change
- renovation or refurbishment
- inventory quality drift
- service decline or improvement
- peak-season anomaly
- neighborhood or environmental conditions

The system may extract such context from review text, metadata, and temporal clusters.

---

## 3.13 Decision Scoring Engine

The scoring engine computes one or more values that represent whether a candidate is recommended.

The score may be based on:
- trust
- recency
- quality
- confidence
- price
- value
- platform-normalized quality
- merged review evidence
- contextual adjustments

In some embodiments, the system calculates:
- trust score
- quality score
- value score
- safety score
- health score
- decision score

In some embodiments, the final ranking is based on one or more combinations of the above.

### 3.13.1 Multi-Factor Gated Decision Categorization

In some embodiments, the system assigns each candidate a categorical decision label (such as a positive recommendation, a cautionary label, or a negative recommendation). Unlike simple threshold systems that gate on a single composite score, the present system requires multiple independent score dimensions to each independently satisfy their own thresholds before a positive categorical label is assigned.

For example, a candidate that scores very high on quality but fails to meet a minimum safety or health threshold would not receive a positive recommendation label. Similarly, a candidate with strong safety metrics but poor value may receive a cautionary label rather than a positive one.

This multi-factor gating ensures that the system does not mask deficiencies in one dimension behind strength in another, addressing a common failure mode in single-score recommendation systems.

In some embodiments, the categorical labels include:
- a strong positive recommendation (e.g., "recommended," "top pick")
- a cautionary recommendation (e.g., "proceed with caution," "consider alternatives")
- a negative recommendation (e.g., "not recommended," "skip")

The specific thresholds and number of gating dimensions may vary by domain (travel vs retail vs services).

### 3.13.2 Domain-Aware Automatic Scoring Methodology Selection

In some embodiments, the system automatically selects a scoring methodology based on the detected category of the source platform or the item being evaluated.

For example, when the system detects that a candidate item originates from a hospitality or travel platform, it may apply a scoring methodology that emphasizes:
- location quality
- cleanliness indicators
- host responsiveness
- cancellation flexibility
- seasonal pricing patterns

When the system detects that a candidate item originates from a retail or e-commerce platform, it may instead apply a scoring methodology that emphasizes:
- seller reliability
- return policy
- product defect rate
- shipping speed
- price competitiveness

The selection of scoring methodology is automatic and does not require user input. The system identifies the platform category from the source URL, platform metadata, or a platform registry, and routes the candidate data to the appropriate scoring pipeline.

This enables a single unified system to produce high-quality recommendations across multiple verticals without requiring separate applications or manual domain configuration.

---

## 3.14 Explainability Layer

The explainability layer produces outputs that clarify:
- why a candidate ranked first
- why a candidate is not recommended
- what tradeoff exists between price and trust
- whether recent evidence differs from historical evidence
- whether the same entity is cheaper elsewhere

### Example explanation categories:
- better value
- stronger recent reviews
- fewer safety concerns
- lower price on another platform
- declining recent quality
- insufficient review confidence

In some embodiments, the explanation includes:
- a top pick label
- short reasons
- warnings
- comparative savings
- score-impact messages

---

## 3.15 Output Interfaces

The system can output results through one or more interfaces:

1. Browser overlay or in-page panel
2. Comparison page hosted on a website
3. Mobile application
4. API response
5. Search results augmentation panel

### Example outputs:
- recommended top option
- ranked alternatives
- cross-platform price comparison
- confidence badge
- explanation block
- action button routing user to a platform URL

---

## 3.16 Adaptive Geographic Area Classification

In embodiments involving location-based searches (such as travel accommodations, restaurants, or local services), the system classifies the geographic search area into a density category that determines collection scope, search radius, and ranking context.

### Tiered Classification Approach

The system applies a tiered classification method:

1. **Geographic knowledge base lookup.** The system first attempts to match the user's destination against a curated database of known locations with pre-assigned density classifications (e.g., dense urban, urban, suburban, resort, rural).

2. **Bounding box diagonal distance computation.** If the destination is not found in the knowledge base, the system computes the diagonal distance of the geographic bounding box implied by the search coordinates or returned listing coordinates. Short diagonals suggest dense, concentrated areas. Longer diagonals suggest spread-out or rural areas.

3. **Listing density heuristic.** If neither of the above methods produces a classification, the system estimates density from the number of listings returned per unit area in the initial collection pass.

### Adaptive Parameters

Based on the classified density category, the system adapts:
- the search radius for candidate discovery
- the number of collection cycles or scroll depth per source
- the expected listing count for sufficiency determination
- delay intervals between collection cycles
- the geographic context provided to the ranking engine

This adaptive approach ensures that the system performs appropriately in both dense urban environments (where many similar listings exist in a small radius) and sparse rural environments (where a wider radius is needed to gather sufficient candidates).

---

## 3.17 Geo-Indexed Inventory Persistence

In some embodiments, after the system completes the ranking of candidate items, it persists the ranked results to a searchable database that serves as a pre-computed recommendation inventory.

### Persistence Structure

Each persisted ranked result may include:
- a unique session identifier
- the rank position assigned by the ranking engine
- listing or product title
- price at time of ranking
- source platform identifier
- the original listing URL
- the classified destination or geographic area
- geographic coordinates (latitude and longitude)
- area classification category
- recommendation scores and explanations
- a timestamp indicating when the ranking was performed

### Geographic Indexing

The persisted results are indexed by geographic coordinates and destination identifiers to support fast geographic queries. When a subsequent user queries for a destination that falls within the geographic bounds of previously ranked results, the system can serve those pre-computed recommendations instantly without re-executing the full collection, resolution, scoring, and ranking pipeline.

### Freshness Management

In some embodiments, persisted results are considered valid within a configurable freshness window. After the freshness window expires, the system may re-execute the full pipeline if a new query arrives for that geographic area.

In other embodiments, persisted results are served immediately as a provisional response, while the system simultaneously launches a background refresh pipeline. If the background refresh produces materially different results, the displayed recommendations are updated.

### Technical Advantages

This inventory persistence layer provides:
- instant recommendation delivery for repeat or similar queries
- reduced server load for frequently searched destinations
- accumulation of curated recommendation data over time
- the ability to present "verified" or "previously ranked" badges to users

---

## 3.18 Example End-to-End Flow

1. A user views a listing on a platform or initiates a search.
2. The system extracts source listing data and search context.
3. The system classifies the geographic area (if location-based) using tiered classification.
4. The system launches off-screen browser windows to collect candidates from additional source platforms.
5. The system applies fair source distribution (round-robin bucketing) to balance the candidate pool.
6. The system resolves common entities across platforms.
7. The system applies temporal weighting to review evidence.
8. The system computes review velocity signals.
9. The system merges normalized review evidence across matching variants.
10. The system selects a domain-appropriate scoring methodology based on detected platform category.
11. The system computes trust, value, recency, safety, and confidence scores.
12. The system applies multi-factor gated categorization to assign decision labels.
13. The system ranks candidates.
14. The system generates explanations for each ranking position.
15. The system outputs a recommendation through an overlay, comparison page, or API.
16. The system persists the ranked results to the geo-indexed inventory.
17. The system optionally routes the user to a chosen platform for completion.
18. The system logs feedback or click signals for calibration.

---

## 3.19 Technical Advantages

The invention provides technical advantages including:
- reduced latency from progressive ranking
- improved decision quality from recency-aware analysis
- improved cross-platform comparability
- reduction of entity fragmentation
- improved explainability
- reduced user decision burden
- identification of better prices across platforms for the same underlying entity
- elimination of temporal response-order bias through fair source distribution
- reliable parallel data collection from single-page applications via off-screen window technique
- instant recommendation serving for repeat destinations via geo-indexed inventory
- consistent cross-vertical recommendation quality via automatic domain-aware scoring
- prevention of single-dimension masking through multi-factor gated decision categorization
- early detection of listing staleness through review velocity analysis
- context-appropriate search scoping through adaptive geographic area classification

---

## 3.20 Variations and Embodiments

The invention may apply to:
- accommodations
- consumer products
- restaurants
- services
- events
- food and supplement products
- electronics
- household goods
- travel inventory

The temporal weighting and entity resolution methods may vary without departing from the invention.

The invention may be implemented:
- entirely on-device
- entirely server-side
- in a hybrid form

The source orchestration may use:
- browser tabs
- hidden or off-screen windows
- background tasks
- queued fetch pipelines
- server-side retrieval
- any other source acquisition mechanism

The ranking may be updated:
- once
- continuously
- only on material change
- in staged passes

---

# 4. Technical Diagrams

## Diagram 1 — High-Level System

```text
User Context / Listing Page / Search Query
                |
                v
      +----------------------------+
      | Geographic Area            |
      | Classification (Tiered)    |
      +----------------------------+
                |
                v
      +----------------------------+
      | Data Extraction Layer      |
      | (Off-Screen Windows +      |
      |  Multi-Layer Hierarchy)    |
      +----------------------------+
                |
                v
      +----------------------------+
      | Source Orchestration        |
      | Priority + Timeouts        |
      | Progressive Collection     |
      +----------------------------+
                |
                v
      +----------------------------+
      | Fair Source Distribution    |
      | (Round-Robin Bucketing)    |
      +----------------------------+
                |
                v
      +----------------------------+
      | Candidate Pool             |
      +----------------------------+
                |
                v
      +----------------------------+
      | Entity Resolution          |
      | Cross-Platform Matching    |
      +----------------------------+
                |
                v
      +----------------------------+
      | Review Normalization       |
      | + Temporal Weighting       |
      | + Velocity Analysis        |
      +----------------------------+
                |
                v
      +----------------------------+
      | Domain-Aware Scoring       |
      | + Multi-Factor Gating      |
      +----------------------------+
                |
                v
      +----------------------------+
      | Ranking Engine             |
      +----------------------------+
                |
                v
      +----------------------------+
      | Explainability Output      |
      +----------------------------+
                |
                v
      +----------------------------+
      | Geo-Indexed Inventory      |
      | Persistence                |
      +----------------------------+
                |
                v
      Recommendation / Ranking / Route-out
```

---

## Diagram 2 — Progressive Ranking Under Partial Data

```text
Launch Tier 1 Sources
   |
   +--> Source A complete
   |
   +--> Source B complete
   |
   +--> Source C slow
   |
   v
Minimum Sufficiency Check
   |
   +--> sufficient? yes --> provisional top results rendered
   |                         |
   |                         +--> continue enrichment in background
   |
   +--> sufficient? no --> launch Tier 2 or wait for more data
```

---

## Diagram 3 — Entity Resolution Across Platforms

```text
Platform Variant A  ----\
                         \
Platform Variant B  ------> Similarity Engine --> Canonical Entity
                         /
Platform Variant C  ----/

Similarity inputs:
- geo
- title
- images
- amenities
- host/brand signals
- user feedback
```

---

## Diagram 4 — Review Merging and Temporal Weighting

```text
Platform A Reviews  --> Normalize ----\
                                        \
Platform B Reviews  --> Normalize ------> Merge --> Temporal Weighting --> Unified Trust / Recent Reality
                                        /                    |
Platform C Reviews  --> Normalize ----/                      |
                                                             v
                                                    Velocity Analysis
                                                    (active / slowing / dormant)
```

---

## Diagram 5 — Off-Screen Browser Window Collection

```text
User triggers cross-platform search
            |
            v
   +---------------------+
   | Orchestration Layer  |
   +---------------------+
     |         |         |
     v         v         v
  +------+  +------+  +------+
  |Window|  |Window|  |Window|
  |(-2K, |  |(-2K, |  |(-2K, |
  | 0)   |  | 0)   |  | 0)   |
  |Site A|  |Site B|  |Site C|
  +------+  +------+  +------+
     |         |         |
     v         v         v
   Full SPA rendering at normal speed
   (not throttled by OS)
     |         |         |
     v         v         v
   Extract --> Merge into Candidate Pool
```

Note: Windows positioned outside visible display area maintain full JavaScript execution priority, unlike minimized or hidden windows which may be throttled by the operating system.

---

## Diagram 6 — Fair Source Distribution (Round-Robin Bucketing)

```text
Source A returns: 25 listings
Source B returns: 18 listings         Max Pool: 20
Source C returns: 12 listings         Sources: 3
                                      Share: floor(20/3) = 6 each
     |
     v
  +-------------------------------------------+
  | Round-Robin Allocation:                   |
  |   Source A: 6 listings (by data richness) |
  |   Source B: 6 listings (by data richness) |
  |   Source C: 6 listings (by data richness) |
  |   Remainder: 2 slots filled from overflow |
  +-------------------------------------------+
     |
     v
  Balanced 20-listing candidate pool
  (no single source dominates)
```

---

## Diagram 7 — Adaptive Geographic Area Classification

```text
User destination input
          |
          v
   +-----------------------------+
   | Tier 1: Knowledge Base      |
   | (known city/neighborhood    |
   |  database lookup)           |
   +-----------------------------+
          |
    found? yes --> density category assigned
          |
          no
          v
   +-----------------------------+
   | Tier 2: Bounding Box        |
   | (compute diagonal distance  |
   |  from search coordinates)   |
   +-----------------------------+
          |
    computable? yes --> density inferred from distance
          |
          no
          v
   +-----------------------------+
   | Tier 3: Listing Density     |
   | (count listings per area    |
   |  in initial collection)     |
   +-----------------------------+
          |
          v
   Density category --> Adapt search radius,
                        scroll depth, ranking context
```

---

## Diagram 8 — Multi-Factor Gated Decision Categorization

```text
Candidate scores:
   Quality: 92    Safety: 35    Value: 78

           |           |          |
           v           v          v
   +----------- Gate Check -----------+
   | Quality >= threshold?  YES       |
   | Safety  >= threshold?  NO  <--   |
   | Value   >= threshold?  YES       |
   +----- All gates must pass --------+
           |
           v
   Result: CAUTIONARY LABEL
   (not positive, because safety gate failed)

   Compare with single-score system:
   Composite = (92 + 35 + 78) / 3 = 68.3
   -> might pass a single threshold -> FALSE POSITIVE
```

---

## Diagram 9 — Geo-Indexed Inventory Persistence

```text
Ranking Complete
       |
       v
  +---------------------------+
  | Persist to Geo-Indexed DB |
  | - rank, title, price      |
  | - platform, URL           |
  | - lat/lng, destination    |
  | - scores, explanations    |
  | - timestamp               |
  +---------------------------+
       |
       v
  Indexed by: (lat,lng), destination, timestamp

  Future query: "Hotels in Tampa"
       |
       v
  +---------------------------+
  | Geo search: bounding box  |
  | + destination text match  |
  | + freshness window check  |
  +---------------------------+
       |
       v
  Instant pre-computed results served
  (with "previously verified" badge)
       |
       +--> Optional: background refresh pipeline
```

---

# 5. Embodiments and Variations

## 5.1 Accommodation Embodiment
The system ranks stays across multiple hospitality platforms using:
- merged review evidence
- normalized total price
- recency-based quality shifts
- platform-crossing price comparison

## 5.2 Retail Embodiment
The system ranks consumer products across multiple retail platforms using:
- seller trust
- review trust
- recency shifts in quality
- normalized pricing
- alternative suggestions

## 5.3 Direct Comparison Embodiment
The system receives multiple URLs or selected items from a user and compares them directly.

## 5.4 Search-Intent Embodiment
The system receives a destination, dates, and guests or a product query and finds candidates from multiple sources before ranking them.

## 5.5 Progressive-Orchestration Embodiment
The system intentionally returns a recommendation before all sources finish, based on decision sufficiency.

## 5.6 Human-Correction Embodiment
The system receives user confirmation or correction regarding whether variants represent the same entity and uses that signal to improve future matching.

## 5.7 Off-Screen Collection Embodiment
The system creates browser windows positioned outside the visible display area to collect data from single-page application platforms without triggering operating system JavaScript throttling. Each window loads a platform-specific search URL, allows full client-side rendering, extracts structured data, and is destroyed after collection completes.

## 5.8 Inventory-First Embodiment
The system checks a geo-indexed inventory of previously ranked results before initiating a new collection pipeline. If fresh, high-confidence results exist for the queried area, they are served instantly. The system may optionally launch a background refresh pipeline to update the inventory concurrently.

## 5.9 Cross-Vertical Unified Embodiment
A single system instance handles multiple verticals (travel, retail, services) by automatically detecting the domain category of each source platform and routing candidate data through the domain-appropriate scoring pipeline, without requiring the user to specify the category or switch between separate applications.

## 5.10 Dense Urban vs Rural Adaptive Embodiment
The system adapts its collection and ranking behavior based on geographic density classification. In a dense urban area, it uses a narrow search radius with high listing density expectations. In a rural area, it uses a wider search radius and lower sufficiency thresholds, ensuring useful recommendations even with sparse candidate availability.

---

# 6. Sample Claim Language
## For later non-provisional drafting strategy

## Claim 1 — Independent Method Claim

A computer-implemented method for generating a cross-platform recommendation, the method comprising:

1. receiving, by one or more processors, data associated with a first candidate item from a first digital platform;
2. obtaining data associated with a plurality of additional candidate items from one or more additional digital platforms;
3. normalizing platform-specific data associated with the candidate items into a common comparison format;
4. determining whether two or more of the candidate items correspond to a common underlying entity based on a plurality of similarity signals;
5. grouping candidate items determined to correspond to the common underlying entity;
6. obtaining review data associated with at least some of the candidate items;
7. applying a temporal weighting process to the review data such that more recent review data has greater influence than older review data;
8. generating at least one trust-related score based on temporally weighted review data;
9. combining normalized data and the at least one trust-related score to generate a recommendation score for each of a plurality of candidate items or grouped entities;
10. ranking the plurality of candidate items or grouped entities based at least in part on the recommendation scores;
11. generating an explanation identifying at least one reason for a ranking position of a selected candidate item or grouped entity; and
12. outputting a recommendation identifying the selected candidate item or grouped entity.

---

## Claim 2 — Dependent Claim (Progressive Ranking)

The method of claim 1, wherein the recommendation is output before data collection from all candidate source platforms has completed, based on a determination that a minimum sufficiency condition has been satisfied.

---

## Claim 3 — Dependent Claim (Priority-Based Source Orchestration)

The method of claim 1, wherein the one or more additional digital platforms are queried according to platform priority tiers, and wherein completion of at least one lower-priority platform is not required before output of the recommendation.

---

## Claim 4 — Dependent Claim (Entity Resolution Signals)

The method of claim 1, wherein determining whether two or more candidate items correspond to the common underlying entity is based on two or more of:
- geographic information,
- text similarity,
- image similarity,
- amenity overlap,
- host or brand identity information, or
- user-provided correction data.

---

## Claim 5 — Dependent Claim (Cross-Platform Review Merging)

The method of claim 1, wherein review data from two or more digital platforms associated with the common underlying entity is normalized and merged prior to generation of the trust-related score.

---

## Claim 6 — Dependent Claim (Explainable Tradeoff Output)

The method of claim 1, wherein the explanation identifies a tradeoff between at least two of price, trust, recency, confidence, or quality.

---

## Claim 7 — Independent System Claim

A system comprising:
- one or more processors; and
- memory storing instructions that, when executed by the one or more processors, cause the system to:
  - receive platform-specific candidate data from multiple digital platforms,
  - normalize the candidate data,
  - determine common underlying entities across the multiple digital platforms,
  - apply temporal weighting to review data,
  - generate recommendation scores,
  - rank candidates or grouped entities,
  - output an explainable recommendation,
  - persist ranked results to a geo-indexed searchable database, and
  - serve pre-computed recommendations from the database for subsequent matching queries.

---

## Claim 8 — Independent Non-Transitory Computer-Readable Medium Claim

A non-transitory computer-readable medium storing instructions that, when executed by one or more processors, cause the one or more processors to perform the method of claim 1.

---

## Claim 9 — Dependent Claim (Off-Screen Browser Window Collection)

The method of claim 1, wherein obtaining data from the one or more additional digital platforms comprises:
- creating one or more browser windows positioned at coordinates outside the visible display area of the user's screen;
- loading a platform-specific search URL in each browser window;
- permitting full client-side rendering of each platform page within the off-screen window; and
- extracting structured data from the rendered page,
wherein the off-screen positioning avoids operating system JavaScript execution throttling that would otherwise be applied to minimized or hidden windows.

---

## Claim 10 — Dependent Claim (Fair Source Distribution)

The method of claim 1, wherein the plurality of candidate items are selected for ranking using a fair source distribution method comprising:
- grouping collected candidates by originating source platform;
- computing an equal allocation share for each responding source platform based on a maximum candidate pool size divided by the number of responding sources;
- selecting up to the allocation share from each source platform; and
- filling remaining pool capacity from overflow candidates of other source platforms,
thereby preventing any single source platform from dominating the candidate pool due to faster response time or larger result set.

---

## Claim 11 — Dependent Claim (Adaptive Geographic Area Classification)

The method of claim 1, further comprising:
- classifying a geographic search area into a density category using a tiered approach comprising:
  (a) matching the search area against a geographic knowledge base of locations with pre-assigned density classifications,
  (b) if no match is found, computing a bounding box diagonal distance from search coordinates to infer density, or
  (c) if neither prior method produces a classification, estimating density from a listing count per area in an initial collection pass; and
- adapting at least one of search radius, collection depth, or sufficiency threshold based on the classified density category.

---

## Claim 12 — Dependent Claim (Multi-Factor Gated Decision Categorization)

The method of claim 1, further comprising:
- computing a plurality of independent score dimensions for each candidate item, the dimensions including at least two of quality, safety, health, value, trust, or confidence;
- determining a categorical decision label for each candidate item by requiring each of the plurality of independent score dimensions to independently satisfy a respective threshold;
wherein a candidate item that fails to satisfy the threshold for any single score dimension is not assigned a positive recommendation label, regardless of scores in other dimensions.

---

## Claim 13 — Dependent Claim (Geo-Indexed Inventory Persistence)

The method of claim 1, further comprising:
- persisting the ranked candidate items to a searchable database indexed by geographic coordinates and destination identifiers;
- associating each persisted ranked item with a ranking timestamp;
- upon receiving a subsequent query matching the geographic area of previously persisted results, serving the persisted ranked items as pre-computed recommendations without re-executing the full collection and ranking pipeline,
wherein the persisted results are subject to a freshness window and may be refreshed when the window expires.

---

## Claim 14 — Dependent Claim (Domain-Aware Scoring Methodology Selection)

The method of claim 1, wherein the recommendation score is generated using a scoring methodology automatically selected based on a detected category of the source platform, wherein:
- when the detected category corresponds to travel or hospitality, the scoring methodology emphasizes at least location quality, cleanliness, and host responsiveness; and
- when the detected category corresponds to retail or e-commerce, the scoring methodology emphasizes at least seller reliability, defect rate, and price competitiveness,
and wherein the category detection is performed automatically from platform metadata without user input.

---

## Claim 15 — Dependent Claim (Review Velocity Analysis)

The method of claim 1, further comprising:
- computing a review velocity metric for each candidate item, the review velocity metric representing a rate at which new reviews are posted within a recent time window;
- classifying each candidate item into an activity state based on the review velocity metric, the activity state being one of active, slowing, or dormant; and
- adjusting a confidence score or ranking position of the candidate item based on the classified activity state.

---

# 7. Draft Filing Checklist

## Before Filing
- [ ] Add inventor legal name and address
- [ ] Add assignee/applicant entity if applicable
- [ ] Convert to PDF
- [ ] Add cover sheet required for provisional filing
- [ ] Add at least one or more diagrams
- [ ] Add date and version
- [ ] Review for accidental disclosure of prompts, thresholds, and weights
- [ ] Remove internal-only notes before filing
- [ ] Confirm title
- [ ] Save a final copy for records

## Good Optional Additions
- [ ] Add one accommodation example
- [ ] Add one retail example
- [ ] Add one progressive ranking example
- [ ] Add one entity-resolution example
- [ ] Add one off-screen collection walkthrough
- [ ] Add one round-robin distribution numeric example
- [ ] Add one geographic classification walkthrough (urban vs rural)
- [ ] Add one dual-threshold gating example with numbers
- [ ] Add one inventory persistence and re-serving example

---

# 8. What Not to Disclose

Do not include:
- exact recency multipliers
- exact scoring thresholds
- exact platform reliability weights
- exact prompts
- exact selector logic
- exact ranking tie-breakers
- exact confidence formulas
- exact rerender thresholds
- exact tuning datasets
- exact city or platform priors
- exact model routing triggers
- any internal benchmark that reveals where your system is strongest or weakest
- exact off-screen window coordinates or dimensions
- exact round-robin allocation arithmetic or remainder-fill rules
- specific city/neighborhood-to-density mappings
- exact dual-threshold score gates per category or vertical
- exact freshness window durations for inventory persistence
- exact bounding-box expansion factors for geo-search
- exact per-domain scoring weight tables
- exact review velocity window sizes or classification thresholds
- exact data-richness scoring point values per field

If a detail is useful to make the system work but not required to enable the invention at the architectural level, consider keeping it secret.

---

# 9. Final Founder Notes

## Best filing posture

File this as:
- one coherent system
- with multiple embodiments
- without over-constraining exact values

## Best narrative

This is not merely a recommendation engine.
It is a technical system for:
- extracting fragmented multi-platform data
- identifying common underlying entities
- correcting historical averaging errors using temporal weighting
- progressively generating decision-ready rankings
- producing explainable recommendations

## Best moat strategy

- Patent the architecture and core method
- Protect as trade secret the parameters, tuning, prompts, and calibration
- Build product moat through user trust, data accumulation, and feedback loops

---

## End of Filing Package
