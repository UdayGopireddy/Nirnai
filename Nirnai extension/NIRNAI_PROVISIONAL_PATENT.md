# NirnAI Provisional Patent Application — DRAFT

    **Title of Invention:**
    System and Method for Cross-Platform Decision Intelligence
    Using Recency-Weighted Review Analysis and Parallel
    Multi-Source Data Collection

    **Inventor(s):** Uday Gopi Reddy
    **Filing Date:** [TO BE FILED]
    **Application Type:** U.S. Provisional Patent Application (35 U.S.C. § 111(b))

    ---

    ## ⚠️ DISCLOSURE vs TRADE SECRET STRATEGY

    This section is **NOT filed** — it is your internal reference.
    Everything below the line "BEGIN PATENT SPECIFICATION" is what gets filed.

    ---

    ### DISCLOSE IN PATENT (Broad Claims — Hard to Design Around)

    | # | What to Disclose | Why Disclose |
    |---|-----------------|--------------|
    | 1 | **The overall system architecture** — browser extension + AI server + inventory DB working together as a unified decision engine | This is the core invention. Broad claim. Without this, nothing is protected. |
    | 2 | **Recency-weighted review scoring METHOD** — the concept of weighting recent reviews exponentially higher than older ones, and detecting trajectory (improving vs declining) | This is your sharpest novel contribution. No major platform does this. Disclose the *method* (time-bracket weighting) but NOT the exact weights. |
    | 3 | **Parallel multi-source collection via off-screen browser windows** — the method of launching invisible browser windows to collect data from multiple platforms simultaneously | Novel technique. Protects the collection mechanism. |
    | 4 | **Round-robin source distribution for fair ranking** — the method of ensuring equal representation from each data source before AI ranking | Prevents single-source bias. Novel approach. |
    | 5 | **Outcome-maximization ranking framework** — ranking by predicted user outcome (value × trust × recency × confidence / price) rather than by individual scores | This is the philosophical differentiator. "Ranks outcomes, not listings." |
    | 6 | **Adaptive geographic area classification** — automatically adjusting search radius and listing density based on area type (dense urban vs resort vs rural) | Novel. No extension does context-aware radius adjustment. |
    | 7 | **Confidence-tiered decision stamps** — visual decision indicators (BOOK IT / THINK TWICE / SKIP) gated by multi-factor confidence assessment | The UX innovation. Protects the decision stamp concept. |
    | 8 | **Inventory persistence with geo-indexed search** — saving AI-ranked results to a searchable database for instant future recommendations | Creates the data moat. Protects the "NirnAI-verified" concept. |
    | 9 | **Domain-aware prompt routing** — automatically selecting scoring methodology (travel vs shopping) based on detected source platform | Enables single system to score across verticals. |
    | 10 | **Cross-platform review truth merging (future)** — combining reviews from multiple platforms for the same entity to reveal hidden patterns | File now, build later. Strongest long-term moat. |

    ### KEEP AS TRADE SECRET (Do NOT File — Competitive Advantage)

    | # | What to Keep Secret | Why Keep Secret |
    |---|-------------------|----------------|
    | 1 | **Exact recency weights (4x/3x/1.5x/1x)** | These are tunable parameters. If disclosed, competitors copy exact formula. Keep the METHOD patented, the NUMBERS secret. |
    | 2 | **All AI prompt text** — system prompts, batch comparison prompts, scoring instructions | Prompts are your "secret sauce." They encode years of iteration. A patent can't protect prompt text effectively — trade secret does. |
    | 3 | **Specific decision stamp thresholds** (purchase ≥ 75, health ≥ 60, etc.) | Tunable. Disclosing lets competitors clone your exact scoring gates. |
    | 4 | **DOM extraction selectors and fallback chains** | These change frequently. Filed selectors become outdated. Keep as trade secret and update freely. |
    | 5 | **Source reliability weights** (airbnb: 1.0, booking: 0.95, agoda: 0.6, etc.) | Competitive intelligence about platform data quality. No reason to disclose. |
    | 6 | **Data-richness scoring formula** (price=3pts, rating=2pts, etc.) | Internal prioritization heuristic. Trade secret protection is stronger here. |
    | 7 | **City/neighborhood database for area classification** | The specific list of 250+ city/neighborhood → density mappings is curated IP. |
    | 8 | **Scroll collection parameters** (cycles, delays, thresholds per area type) | Operational tuning. No patent value, high trade secret value. |
    | 9 | **Multi-currency exchange rate table and normalization logic** | Implementation detail. Not novel enough for patent claims. |
    | 10 | **Per-site URL builder syntax** (how each platform's search URL is constructed) | Reverse-engineered platform knowledge. Trade secret keeps competitors from using your work. |
    | 11 | **Telemetry schema and adaptive source ranking** | Future competitive advantage. Don't signal to competitors that you're tracking source performance. |
    | 12 | **Server endpoint contract and session management internals** | API design is not patentable, and disclosing it helps competitors build compatible systems. |

    ### DECISION RULE

    > **Patent the METHOD. Trade-secret the PARAMETERS.**
    >
    > "We weight recent reviews more heavily" → PATENT
    > "We use 4x for 30 days, 3x for 90 days" → TRADE SECRET
    >
    > "We use off-screen windows for collection" → PATENT
    > "We use left:-2000, top:-2000 with 1024×768" → TRADE SECRET
    >
    > "We classify areas to adjust search radius" → PATENT
    > "Manhattan = dense_urban, 0.5mi; Tampa = urban, 3mi" → TRADE SECRET

    ---

    ## BEGIN PATENT SPECIFICATION

    ---

    ### CROSS-REFERENCE TO RELATED APPLICATIONS

    This application claims priority as a U.S. Provisional Patent
    Application filed under 35 U.S.C. § 111(b).

    ---

    ### FIELD OF THE INVENTION

    The present invention relates to computer-implemented systems
    and methods for automated purchase and booking decision-making.
    More specifically, the invention relates to a cross-platform
    decision intelligence system that collects product or listing
    data from multiple electronic commerce and travel booking
    platforms, applies recency-weighted review analysis and
    outcome-focused ranking, and presents actionable decision
    recommendations through an in-browser overlay interface.

    ---

    ### BACKGROUND OF THE INVENTION

    Consumers routinely face complex purchase decisions across
    multiple online platforms. When booking travel accommodations,
    a consumer may compare listings on Airbnb, Booking.com,
    Expedia, VRBO, and others — each presenting different pricing,
    review formats, and quality signals. Similarly, when shopping
    for products, consumers compare Amazon, Walmart, Target,
    and numerous other retailers.

    **Problem 1 — Platform-Confined Information.**
    Existing platforms present only their own listings. A consumer
    viewing an Airbnb property has no visibility into whether the
    same or similar property is available at a lower price on
    Booking.com, or whether better-reviewed alternatives exist
    on other platforms.

    **Problem 2 — Stale Review Aggregation.**
    All major platforms display a single aggregate rating (e.g.,
    "4.93 stars from 298 reviews") that treats a review from
    three years ago identically to one from last week. This fails
    to capture quality trajectory — a property that was excellent
    two years ago may have declined significantly in recent months.
    No major platform exposes review recency weighting to consumers.

    **Problem 3 — Information Overload Without Decision Guidance.**
    Existing comparison tools (Google Travel, Kayak, Skyscanner)
    help consumers *find* options but do not help them *decide*.
    They present price tables and filter controls, leaving the
    consumer to manually evaluate dozens of listings across
    trust, value, recency, and cancellation risk dimensions.

    **Problem 4 — Single-Source Collection Throttling.**
    When a browser-based system attempts to collect data from
    multiple platforms simultaneously, modern operating systems
    (particularly macOS) aggressively throttle JavaScript execution
    in minimized or background windows. This causes single-page
    application platforms to never render their content, making
    DOM-based data extraction impossible.

    There is a need for a unified decision intelligence system
    that (a) collects data across platforms in parallel without
    throttling, (b) applies recency-weighted analysis to surface
    quality trajectory, (c) ranks by predicted user outcome rather
    than individual listing score, and (d) presents clear,
    actionable decision recommendations within the user's existing
    browsing context.

    ---

    ### SUMMARY OF THE INVENTION

    The present invention provides a cross-platform decision
    intelligence system comprising:

    (a) a browser extension component that detects when a user
    is viewing a product or listing page, extracts structured
    data from the page, and injects a decision overlay interface;

    (b) a parallel multi-source data collection engine that
    launches off-screen browser windows to simultaneously collect
    comparable listings from multiple platforms, with fair
    source distribution to prevent single-platform bias;

    (c) a geographic area classification engine that automatically
    determines area density (dense urban, urban, suburban, resort,
    rural) and adapts search parameters accordingly;

    (d) a recency-weighted review analysis engine that assigns
    exponentially higher weight to recent reviews, detects
    quality trajectory (improving vs declining), and generates
    a time-sensitive trust signal;

    (e) an outcome-maximization ranking engine that evaluates
    listings across trust, recency, quality, confidence, and
    normalized price dimensions to rank by predicted user
    satisfaction rather than by individual metric;

    (f) a confidence assessment system that evaluates the
    reliability of each ranking based on review volume, recency
    distribution, and data completeness, and communicates
    this confidence to the user through tiered visual indicators;

    (g) a domain-aware analysis routing system that automatically
    selects the appropriate scoring methodology (travel
    accommodation vs retail product) based on the detected
    source platform;

    (h) a decision stamp rendering system that translates
    multi-factor scores into clear actionable recommendations
    with mandatory explanations and visible tradeoffs; and

    (i) a geo-indexed inventory system that persists
    AI-generated rankings for future instant retrieval,
    enabling the system to serve pre-ranked recommendations
    when a user searches for a previously-analyzed destination
    or product category.

    ---

    ### DETAILED DESCRIPTION OF THE INVENTION

    #### 1. System Architecture Overview

    The system comprises three cooperating components:

    **Component A — Browser Extension (Client)**
    A browser extension (implemented as a Chrome Manifest V3
    extension, though applicable to any browser extension
    framework) that operates across two execution contexts:

    - A *content script* that executes within the context of
      the web page the user is viewing, responsible for data
      extraction from the page DOM and structured data sources
      (JSON-LD, Open Graph meta tags), and for rendering the
      decision overlay interface.

    - A *service worker* (background script) that manages
      cross-platform data collection orchestration, API
      communication with the analysis server, result caching,
      and browser extension lifecycle.

    **Component B — Analysis Server (AI Engine)**
    A server application that receives structured product or
    listing data, applies domain-specific scoring prompts via
    one or more large language model (LLM) providers, and
    returns structured analysis results including scores,
    decision stamps, confidence assessments, and natural
    language explanations.

    **Component C — Inventory Database (Persistence)**
    A geo-indexed database that stores AI-generated ranking
    results with associated geographic coordinates, destination
    labels, area classifications, and temporal metadata.
    Enables instant retrieval of previously-computed rankings
    for repeat queries.

    The three components communicate as follows:

    ```
    User views listing on Platform X
         │
         ▼
    Content Script extracts structured data
         │
         ├──► Single-listing analysis ──► Analysis Server
         │                                     │
         │                              Returns scores +
         │                              decision stamp
         │                                     │
         │    ◄────────────────────────────────┘
         │
         ├──► Cross-platform comparison trigger
         │         │
         │         ▼
         │    Service Worker launches off-screen
         │    collection windows for Platforms Y, Z, ...
         │         │
         │         ▼
         │    Content Scripts in collection windows
         │    extract listings from each platform
         │         │
         │         ▼
         │    Service Worker applies round-robin
         │    source distribution (fair bucketing)
         │         │
         │         ▼
         │    Analysis Server receives N listings
         │    + geographic context + domain signal
         │         │
         │         ├──► Domain-aware prompt selection
         │         ├──► Recency-weighted analysis
         │         ├──► Outcome-maximization ranking
         │         ├──► Confidence tier assessment
         │         │
         │         ▼
         │    Returns ranked Top-K with explanations,
         │    tradeoffs, decision stamps, and
         │    comparison summary
         │         │
         │         ├──► Persists to Inventory DB
         │         │    (geo-indexed, time-stamped)
         │         │
         │    ◄────┘
         │
         ▼
    Decision overlay rendered on user's page
    OR user navigated to dedicated comparison page
    ```

    #### 2. Parallel Multi-Source Data Collection Engine

    A key challenge in cross-platform comparison is collecting
    data from multiple platforms simultaneously. The present
    invention addresses this through a novel off-screen window
    collection technique.

    **2.1 Off-Screen Window Technique**

    When the user triggers a cross-platform comparison, the
    service worker creates a new browser window with the
    following properties:

    - Window type is set to "normal" (not "minimized" or "popup")
    - Window dimensions are set to standard rendering size
      (sufficient for responsive web design breakpoints)
    - Window position is set to coordinates far outside the
      visible screen area (e.g., negative x/y coordinates)
    - Window focus is set to false (does not steal user focus)

    This technique solves the operating system throttling problem:
    modern operating systems (particularly macOS) aggressively
    reduce JavaScript execution frequency in minimized windows,
    causing single-page applications to never complete their
    initial render. By positioning the window off-screen rather
    than minimizing it, the operating system treats it as a
    normal active window, permitting full JavaScript execution
    and complete SPA rendering.

    **2.2 Parallel Site Launch**

    All target platforms are launched simultaneously as separate
    tabs within the off-screen collection window. Each tab
    loads the platform's search results page with query
    parameters derived from the user's current listing context
    (destination, dates, guest count, geographic coordinates,
    price range).

    Each tab's URL includes a collection flag (appended as a
    URL fragment or query parameter) that signals the content
    script in that tab to operate in collection mode rather
    than overlay mode.

    **2.3 Collection Window with Early Termination**

    The system employs a fixed collection window (a maximum
    duration after which collection stops regardless of
    individual site status). Individual per-site timeouts
    handle non-responsive platforms. If all sites report
    results before the collection window expires, the system
    proceeds immediately (early termination optimization).

    **2.4 Fair Source Distribution (Round-Robin Bucketing)**

    When the total collected listings exceed the analysis
    capacity limit, the system applies round-robin source
    distribution:

    1. Group all collected listings by source platform.
    2. Calculate equal share: floor(capacity / number_of_sources).
    3. Take equal share from each source.
    4. Fill remaining capacity slots from overflow listings.

    This prevents temporal bias (the first platform to respond
    dominating the ranking pool) and ensures fair representation
    across all contributing platforms.

    #### 3. Geographic Area Classification Engine

    The system automatically classifies the user's search area
    to adapt collection and ranking parameters.

    **3.1 Classification Method**

    Area classification proceeds through a three-tier fallback:

    - **Tier 1: Known geographic database.** A curated database
      of city names and neighborhood identifiers mapped to
      density classifications (dense urban, urban, suburban,
      resort, rural). The destination extracted from the user's
      listing is matched against this database.

    - **Tier 2: Bounding box analysis.** If the destination
      is not in the known database, the system calculates the
      diagonal distance of the map bounding box (using the
      Haversine formula) and classifies based on effective
      search radius.

    - **Tier 3: Listing density heuristic.** If neither database
      nor bounding box is available, the system uses the number
      of initially-detected listings as a density proxy.

    **3.2 Adaptive Parameters**

    Each area classification determines:

    - Search radius (in miles) for geographic filtering
    - Maximum number of listings to collect per source
    - Number of scroll cycles for pagination collection
    - Contextual ranking tips passed to the analysis engine
      (e.g., in dense urban areas, walkability and transit
      access are weighted higher; in resort areas, beach
      proximity and cancellation flexibility matter more)

    #### 4. Recency-Weighted Review Analysis Engine

    The core analytical innovation of the system is
    time-sensitive review scoring.

    **4.1 Temporal Bracket Weighting**

    Reviews are assigned to temporal brackets based on their
    publication date relative to the current date. Each bracket
    carries an exponentially decreasing weight multiplier.
    More recent brackets receive substantially higher weight
    than older brackets.

    The effective rating is computed as:

    $$\text{Effective Rating} = \frac{\sum_{i} (r_i \times w_{b(i)})}{\sum_{i} w_{b(i)}}$$

    Where $r_i$ is the rating of review $i$, $w_{b(i)}$ is
    the weight assigned to the temporal bracket containing
    review $i$, and the brackets are defined by time ranges
    (e.g., last month, last quarter, last half-year, older).

    **4.2 Quality Trajectory Detection**

    The system compares the recency-weighted effective rating
    against the historical aggregate rating to detect trajectory:

    - **Declining trajectory**: Recent effective rating is
      meaningfully below the historical average. The system
      generates a warning (e.g., "Quality may be declining —
      recent reviews are weaker than historical average").

    - **Improving trajectory**: Recent effective rating
      exceeds the historical average. The system notes the
      improvement as a positive signal.

    - **Stable trajectory**: Recent and historical ratings
      are consistent.

    **4.3 Review Velocity Analysis**

    Beyond individual review scores, the system analyzes
    review frequency over time:

    - A listing with 10 reviews per month in recent months
      indicates active, bookable inventory.
    - A listing with no reviews in recent months despite
      historical activity suggests possible delisting,
      quality issues, or seasonal closure.
    - A listing with all reviews concentrated in a very
      short period (e.g., two weeks) suggests possible
      review manipulation.

    #### 5. Outcome-Maximization Ranking Engine

    Unlike traditional comparison systems that rank by a single
    score, the present invention ranks by predicted user outcome.

    **5.1 Multi-Dimensional Evaluation**

    Each listing is evaluated across weighted dimensions that
    vary by domain:

    For travel accommodations: review trust (recency-weighted),
    price-to-experience ratio, host reliability, cancellation
    flexibility, amenity completeness, and check-in convenience.

    For retail products: review trust, price-to-value ratio,
    seller reputation, return policy, delivery speed, and
    specification completeness.

    For food and health products: an additional safety/health
    dimension covering ingredient safety, nutritional quality,
    and processing level.

    **5.2 Psychology-Aware Price Sensitivity**

    The ranking engine applies human-behavioral rules:

    - Within a narrow price band, quality and trust break ties
      — not price.
    - When the price gap is large, the cheaper option is
      preferred unless the quality gap is dramatic.
    - Similar quality listings are ranked by lowest price.
    - A high-trust, expensive listing only ranks first if the
      trust gap is substantial and the price premium is moderate.

    **5.3 Mandatory Explanation and Tradeoff Visibility**

    Every ranked result includes:

    - "Why ranked #N" — a specific explanation of why this
      listing ranked where it did, citing measurable factors.
    - Positives — concrete advantages of this listing.
    - Warnings — risk factors the user should consider.
    - Tradeoffs vs alternatives — what the user gives up
      by choosing this listing over the next-ranked option.
    - Savings calculation — dollar amount saved vs the
      next best alternative.

    No ranking is presented without visible explanation.
    This is a design constraint, not an optional feature.

    #### 6. Confidence Assessment and Decision Stamp System

    **6.1 Confidence Tiers**

    Each ranking result carries a confidence tier based on:

    - Review volume (more reviews = higher confidence)
    - Review recency (recent reviews present = higher confidence)
    - Data completeness (price, rating, review count, host
      info all present = higher confidence)
    - Rating level (very high or very low ratings with
      sufficient volume = higher confidence)

    Confidence tiers are communicated visually:

    - High confidence: full visual indicator, bold recommendation
    - Medium confidence: partial indicator with "based on
      limited data" qualification
    - Low confidence: minimal indicator with prominent caveat

    **6.2 Decision Stamps**

    Each analyzed listing receives a decision stamp — a
    categorical recommendation derived from multi-factor scoring:

    - **Positive** (travel: "BOOK IT" / shopping: "Smart Buy"):
      The listing scores well across purchase quality AND
      safety/health dimensions.

    - **Neutral** (travel: "THINK TWICE" / shopping: "Check"):
      The listing has mixed signals or insufficient data for
      strong recommendation.

    - **Negative** (travel: "SKIP" / shopping: "Avoid"):
      The listing scores poorly on purchase quality OR
      safety/health, indicating significant risk.

    Decision stamps require BOTH purchase quality and
    safety/health thresholds to be met for a positive
    recommendation. A listing with excellent reviews but
    poor cleanliness scores will not receive a positive stamp.

    #### 7. Domain-Aware Analysis Routing

    The system automatically detects the domain category
    (travel accommodation vs retail product vs food/health)
    from the source platform identifier and routes the
    analysis request to the appropriate scoring methodology.

    For travel platforms (Airbnb, Booking.com, Expedia, VRBO,
    Hotels.com, Agoda, TripAdvisor, Google Travel): the system
    applies recency-weighted review scoring, host reliability
    assessment, cancellation policy scoring, and cleanliness/
    safety scoring in the health dimension.

    For retail platforms (Amazon, Walmart, Target, and others):
    the system applies standard product scoring with seller
    reputation, return policy, delivery speed, and optional
    nutritional/ingredient analysis for food products.

    This routing is automatic — the user takes no action to
    select the scoring mode.

    #### 8. Geo-Indexed Inventory Persistence

    When the analysis engine produces ranked results, the system
    persists them to a geo-indexed database.

    **8.1 Storage Schema**

    Each ranked listing is stored with:

    - Session identifier (links all listings from one comparison)
    - Rank position
    - Listing metadata (title, price, URL, image, platform)
    - Geographic context (destination text, latitude/longitude,
      area type, search radius)
    - Scoring data (purchase score, health score, confidence
      tier, decision stamp)
    - Explanation data (why ranked, positives, warnings, tradeoffs)
    - Comparison summary
    - Timestamp

    **8.2 Multi-Index Search**

    The inventory supports three search modes:

    - **Geographic bounding box search**: Given a center point
      and radius, retrieves all rankings within the geographic
      area. Uses latitude/longitude indices with cosine-corrected
      longitude delta for accurate bounding at different latitudes.

    - **Destination text search**: Given a destination name,
      retrieves all rankings matching the destination string.

    - **Temporal search**: All queries are bounded by a
      freshness window (e.g., results older than 7 days are
      excluded) to ensure recommendations reflect current
      market conditions.

    **8.3 Instant Recommendations**

    When a user searches for a destination or product category
    on the system's homepage, the system first checks the
    inventory for pre-computed rankings. If fresh results are
    available, they are served instantly as "NirnAI-verified"
    recommendations, eliminating the need for real-time
    collection and analysis.

    If no inventory results exist, the system falls through
    to live cross-platform collection and analysis.

    #### 9. Cross-Platform Review Truth Merging (Planned)

    The system is designed to support future merging of reviews
    from multiple platforms for the same physical entity
    (property, product, or business).

    When the same entity is identified across platforms (via
    geographic proximity, title similarity, amenity overlap,
    image similarity, or user confirmation), the system
    combines reviews from all platforms into a unified review
    corpus. This merged corpus is then subjected to
    recency-weighted analysis, potentially revealing quality
    signals hidden on any individual platform.

    For example: a property rated 4.9 on Platform A (from
    repeat guests) may be rated 3.8 on Platform B (from
    first-time visitors who experienced noise issues). The
    merged view exposes the full truth.

    Entity matching employs conservative thresholds with
    human verification fallback:

    - "Probable match" shown with user-confirmable prompt
    - User feedback ("This is NOT the same property")
      trains the matching system
    - No silent assertion — transparency preserves trust

    ---

    ### CLAIMS

    **Claim 1.** A computer-implemented method for cross-platform
    decision intelligence, comprising:

    (a) detecting, by a browser extension executing in a user's
    web browser, that the user is viewing a product listing or
    accommodation listing on a first electronic commerce platform;

    (b) extracting, by the browser extension, structured data
    from the listing page including at least product identifiers,
    pricing, review data, and geographic context;

    (c) launching, by a background service worker of the browser
    extension, one or more off-screen browser windows positioned
    outside the visible display area, each window loading a
    search results page on a respective additional electronic
    commerce platform with search parameters derived from the
    extracted data;

    (d) collecting, by content scripts executing within the
    off-screen windows, structured listing data from each
    additional platform;

    (e) applying fair source distribution to the collected
    listings by allocating an equal share of an analysis
    capacity to each contributing platform;

    (f) transmitting the distributed listings and geographic
    context to an analysis server;

    (g) applying, by the analysis server, recency-weighted
    review analysis to each listing, wherein reviews are
    assigned to temporal brackets and each bracket carries
    a weight multiplier that decreases with the age of the
    bracket;

    (h) ranking the listings by predicted user outcome based
    on multi-dimensional evaluation including trust, recency,
    quality, confidence, and normalized price;

    (i) generating, for each ranked listing, a natural language
    explanation of its ranking position, including specific
    positives, warnings, and tradeoffs against alternatively-
    ranked listings;

    (j) assigning a confidence tier to each ranking based on
    review volume, recency distribution, and data completeness;

    (k) assigning a categorical decision stamp to each listing
    based on multi-factor thresholds spanning both purchase
    quality and safety/health dimensions; and

    (l) presenting the ranked results with explanations,
    confidence tiers, and decision stamps to the user through
    an overlay interface rendered within the user's browser.

    **Claim 2.** The method of Claim 1, wherein launching
    off-screen browser windows comprises creating browser
    windows of type "normal" with positive width and height
    dimensions and with position coordinates outside the
    visible display area, thereby avoiding operating system
    JavaScript execution throttling that is applied to
    minimized windows while maintaining invisibility to
    the user.

    **Claim 3.** The method of Claim 1, further comprising:
    classifying the geographic area associated with the user's
    listing into an area density category by matching the
    destination against a geographic database, computing the
    diagonal distance of a map bounding box using the Haversine
    formula, or estimating density from listing count; and
    adapting search radius, collection depth, and ranking
    context based on the classified area density.

    **Claim 4.** The method of Claim 1, wherein recency-weighted
    review analysis further comprises detecting quality
    trajectory by comparing the recency-weighted effective
    rating against the historical aggregate rating, and
    generating trajectory-specific warnings when recent review
    quality diverges meaningfully from historical averages.

    **Claim 5.** The method of Claim 1, wherein ranking by
    predicted user outcome comprises applying psychology-aware
    price sensitivity rules wherein: within a narrow price
    band, quality and trust break ties rather than price; when
    the price gap exceeds a threshold, the lower-priced option
    is preferred unless the quality gap is dramatic; and a
    high-trust expensive option ranks first only when the trust
    gap is substantial and the price premium is moderate.

    **Claim 6.** The method of Claim 1, further comprising
    persisting the ranked results to a geo-indexed database
    with latitude, longitude, destination text, area type,
    and timestamp; and serving the persisted results as
    instant recommendations when a subsequent user query
    matches the geographic or textual index within a
    freshness window.

    **Claim 7.** The method of Claim 1, wherein the analysis
    server automatically selects a domain-specific scoring
    methodology based on the source platform identifier,
    applying travel-specific scoring (including host reliability,
    cancellation flexibility, and cleanliness as safety metric)
    for travel platforms and retail-specific scoring (including
    seller reputation, return policy, and delivery speed) for
    shopping platforms.

    **Claim 8.** The method of Claim 1, wherein the categorical
    decision stamp requires both a purchase quality score and
    a safety/health score to independently exceed respective
    thresholds for a positive recommendation, such that a
    high purchase quality score alone is insufficient.

    **Claim 9.** The method of Claim 1, wherein fair source
    distribution comprises: grouping collected listings by
    source platform; computing an equal allocation as the
    floor of the analysis capacity divided by the number of
    contributing platforms; selecting up to the equal allocation
    from each platform; and filling remaining capacity from
    overflow listings.

    **Claim 10.** The method of Claim 1, further comprising:
    detecting, for a physical entity listed on multiple
    platforms, a probable identity match based on geographic
    proximity, title similarity, amenity overlap, or image
    similarity; presenting the probable match to the user with
    a confidence label; merging reviews from matched platforms
    into a unified review corpus; applying recency-weighted
    analysis to the merged corpus; and accepting user feedback
    to confirm or reject the match.

    **Claim 11.** A system for cross-platform decision
    intelligence, comprising:

    a browser extension configured to:
    - detect product or listing pages across multiple
      electronic commerce platforms,
    - extract structured data from detected pages,
    - launch off-screen browser windows for parallel
      multi-platform data collection,
    - apply fair source distribution across collected data, and
    - render decision overlay interfaces within the user's browser;

    an analysis server configured to:
    - receive listing data and geographic context,
    - apply domain-aware scoring methodology selection,
    - perform recency-weighted review analysis with temporal
      bracket weighting,
    - rank listings by multi-dimensional predicted user outcome,
    - generate natural language explanations with tradeoffs, and
    - assign confidence tiers and decision stamps; and

    a geo-indexed database configured to:
    - persist ranked results with geographic coordinates
      and temporal metadata,
    - support geographic bounding box search with cosine-
      corrected longitude, destination text search, and
      temporal freshness filtering, and
    - serve persisted rankings as instant recommendations
      for matching queries.

    **Claim 12.** The system of Claim 11, wherein the browser
    extension further comprises per-site content extractors that
    employ a multi-source data extraction hierarchy comprising
    structured data sources (JSON-LD, Open Graph metadata),
    semantic DOM selectors (data-attribute identifiers), and
    heuristic text extraction, with fallback across sources
    to maximize resilience to platform DOM changes.

    ---

    ### ABSTRACT

    A computer-implemented system and method for cross-platform
    decision intelligence that helps consumers make informed
    purchase and booking decisions. The system comprises a
    browser extension that detects product and listing pages
    across multiple electronic commerce platforms, a parallel
    multi-source data collection engine using off-screen browser
    windows to avoid operating system throttling, a geographic
    area classification engine that adapts search parameters
    to local density, a recency-weighted review analysis engine
    that detects quality trajectory through temporal bracket
    weighting, an outcome-maximization ranking engine that
    evaluates listings across trust, recency, quality,
    confidence, and price dimensions, a confidence-tiered
    decision stamp system providing categorical recommendations
    with mandatory explanations and tradeoff visibility, domain-
    aware analysis routing for travel and retail verticals, and
    a geo-indexed inventory system that persists rankings for
    instant future recommendations. The system ranks outcomes,
    not listings — surfacing the best decision across platforms
    rather than sorting within a single platform.

    ---

    *END OF SPECIFICATION*
