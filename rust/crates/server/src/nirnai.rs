use std::env;

use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use api::{
    resolve_startup_auth_source, ClawApiClient, InputContentBlock, InputMessage, MessageRequest,
    OutputContentBlock,
};
use runtime::{
    ApiClient, ApiRequest, AssistantEvent, ConversationMessage, ConversationRuntime,
    MessageRole, PermissionMode, PermissionPolicy, RuntimeError, Session, TokenUsage,
    ToolError, ToolExecutor,
};


// ── Nirnai request/response types (matching the Chrome extension contract) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductData {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub brand: String,
    #[serde(default)]
    pub price: String,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub rating: String,
    #[serde(default, rename = "reviewCount")]
    pub review_count: String,
    #[serde(default)]
    pub seller: String,
    #[serde(default)]
    pub fulfiller: String,
    #[serde(default)]
    pub ingredients: String,
    #[serde(default, rename = "nutritionInfo")]
    pub nutrition_info: String,
    #[serde(default, rename = "returnPolicy")]
    pub return_policy: String,
    #[serde(default)]
    pub delivery: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, rename = "imageUrl")]
    pub image_url: String,
    #[serde(default)]
    pub barcode: String,
    #[serde(default)]
    pub source_site: String,
    #[serde(default)]
    pub page_type: String,
    // ── Geo-context fields ──
    #[serde(default, rename = "country_code")]
    pub country_code: String,
    #[serde(default, rename = "currency_code")]
    pub currency_code: String,
    #[serde(default)]
    pub locale: String,
    #[serde(default, rename = "tax_included")]
    pub tax_included: bool,
    #[serde(default, rename = "shipping_region")]
    pub shipping_region: String,
    #[serde(default, rename = "measurement_system")]
    pub measurement_system: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseBreakdown {
    pub reviews: u32,
    pub price: u32,
    pub seller: u32,
    pub returns: u32,
    pub popularity: u32,
    pub specs: u32,
    pub delivery: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewTrust {
    pub trust_score: u32,
    pub rating_strength: u32,
    pub volume_confidence: u32,
    pub distribution_quality: u32,
    pub authenticity: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthBreakdown {
    pub nutrition: u32,
    pub ingredients: u32,
    pub processing: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionStamp {
    pub stamp: String,
    pub label: String,
    pub icon: String,
    pub reasons: Vec<String>,
    pub purchase_signal: String,
    pub health_signal: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlternativeSuggestion {
    pub product_name: String,
    pub reason: String,
    pub search_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResponse {
    pub purchase_score: u32,
    pub health_score: u32,
    pub decision: String,
    pub stamp: DecisionStamp,
    pub purchase_breakdown: PurchaseBreakdown,
    pub health_breakdown: HealthBreakdown,
    pub review_trust: ReviewTrust,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub positives: Vec<String>,
    pub confidence: f64,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<AlternativeSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartItemResult {
    pub title: String,
    pub price: String,
    pub image_url: String,
    pub url: String,
    pub purchase_score: u32,
    pub health_score: u32,
    pub decision: String,
    pub stamp: DecisionStamp,
    pub warnings: Vec<String>,
    pub positives: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<AlternativeSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartSummary {
    pub total_items: u32,
    pub estimated_total: String,
    pub avg_purchase_score: u32,
    pub avg_health_score: u32,
    pub items_to_avoid: u32,
    pub items_smart_buy: u32,
    pub items_check: u32,
    pub overall_verdict: String,
    pub overall_icon: String,
    pub ai_summary: String,
    pub top_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartAnalysisResponse {
    pub summary: CartSummary,
    pub items: Vec<CartItemResult>,
}

// ── Batch comparison types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchRequest {
    pub listings: Vec<ProductData>,
    #[serde(default)]
    pub search_context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedListing {
    pub rank: u32,
    pub title: String,
    pub price: String,
    pub url: String,
    pub image_url: String,
    pub purchase_score: u32,
    pub health_score: u32,
    pub confidence_tier: String,
    pub decision: String,
    pub stamp: DecisionStamp,
    pub review_trust: ReviewTrust,
    pub why_ranked: String,
    pub tradeoffs: Vec<String>,
    pub positives: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchResponse {
    pub ranked: Vec<RankedListing>,
    pub comparison_summary: String,
}

// ── Agent-backed API client ──

const DEFAULT_MODEL: &str = "claude-sonnet-4-6";

fn max_tokens_for_model(model: &str) -> u32 {
    if model.contains("opus") {
        32_000
    } else {
        16_000
    }
}

struct NirnaiApiClient {
    rt: tokio::runtime::Runtime,
    client: ClawApiClient,
    model: String,
}

impl NirnaiApiClient {
    fn new(model: String) -> Result<Self, String> {
        let auth = resolve_startup_auth_source(|| Ok(None))
            .map_err(|e| format!("auth error: {e}"))?;
        Ok(Self {
            rt: tokio::runtime::Runtime::new()
                .map_err(|e| format!("tokio runtime error: {e}"))?,
            client: ClawApiClient::from_auth(auth).with_base_url(api::read_base_url()),
            model,
        })
    }
}

impl ApiClient for NirnaiApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let message_request = MessageRequest {
            model: self.model.clone(),
            max_tokens: max_tokens_for_model(&self.model),
            messages: convert_messages(&request.messages),
            system: (!request.system_prompt.is_empty())
                .then(|| request.system_prompt.join("\n\n")),
            tools: None, // No tool use for analysis — pure reasoning
            tool_choice: None,
            stream: false,
        };

        self.rt.block_on(async {
            let response = self
                .client
                .send_message(&message_request)
                .await
                .map_err(|e| RuntimeError::new(e.to_string()))?;

            let mut events = Vec::new();
            for block in response.content {
                if let OutputContentBlock::Text { text } = block {
                    events.push(AssistantEvent::TextDelta(text));
                }
            }
            events.push(AssistantEvent::Usage(TokenUsage {
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            }));
            events.push(AssistantEvent::MessageStop);
            Ok(events)
        })
    }
}

fn convert_messages(messages: &[ConversationMessage]) -> Vec<InputMessage> {
    messages
        .iter()
        .filter_map(|msg| {
            let role = match msg.role {
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                _ => return None,
            };
            Some(InputMessage {
                role: role.to_string(),
                content: msg
                    .blocks
                    .iter()
                    .filter_map(|block| match block {
                        runtime::ContentBlock::Text { text } => {
                            Some(InputContentBlock::Text { text: text.clone() })
                        }
                        _ => None,
                    })
                    .collect(),
            })
        })
        .collect()
}

// ── No-op tool executor (agent doesn't use tools for analysis) ──

struct NoOpToolExecutor;

impl ToolExecutor for NoOpToolExecutor {
    fn execute(&mut self, tool_name: &str, _input: &str) -> Result<String, ToolError> {
        Err(ToolError::new(format!(
            "tool execution not supported in analysis mode: {tool_name}"
        )))
    }
}

// ── System prompt for product analysis ──

fn analysis_system_prompt() -> String {
    r#"You are NirnAI, an expert AI shopping advisor. Your job is to analyze product data and return a structured JSON assessment.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no explanation outside the JSON:

{
  "purchase_score": <0-100>,
  "health_score": <0-100>,
  "decision": "SMART_BUY" | "CHECK" | "AVOID",
  "stamp": {
    "stamp": "SMART_BUY" | "CHECK" | "AVOID",
    "label": "<short label>",
    "icon": "🟢" | "🟡" | "🔴",
    "reasons": ["<reason1>", "<reason2>"],
    "purchase_signal": "<one-line purchase insight>",
    "health_signal": "<one-line health insight>"
  },
  "purchase_breakdown": {
    "reviews": <0-100>,
    "price": <0-100>,
    "seller": <0-100>,
    "returns": <0-100>,
    "popularity": <0-100>,
    "specs": <0-100>,
    "delivery": <0-100>
  },
  "health_breakdown": {
    "nutrition": <0-100>,
    "ingredients": <0-100>,
    "processing": <0-100>
  },
  "review_trust": {
    "trust_score": <0-100>,
    "rating_strength": <0-100>,
    "volume_confidence": <0-100>,
    "distribution_quality": <0-100>,
    "authenticity": <0-100>
  },
  "reasons": ["<key reason 1>", "<key reason 2>"],
  "warnings": ["<warning if any>"],
  "positives": ["<positive if any>"],
  "confidence": <0.0-1.0>,
  "summary": "<2-3 sentence natural language summary>",
  "suggestion": { "product_name": "<name>", "reason": "<why>", "search_url": "<amazon/walmart search URL>" } or null
}

Scoring rules:
- purchase_score: Weighted average of reviews (25%), price fairness (20%), seller trust (15%), return policy (10%), popularity (10%), specs/quality (10%), delivery (10%)
- health_score: For food/supplements: nutrition (40%), ingredients safety (35%), processing level (25%). For personal care (shampoo, skincare, cosmetics, soap): ingredients safety (60%), allergen risk (25%), certifications (15%). For non-food AND non-personal-care items (electronics, clothing, furniture, etc.): set to 0 with health_signal "Not applicable".
- decision: SMART_BUY if purchase_score >= 75 AND (health_score >= 60 OR health_score == 0). CHECK if purchase_score >= 40. AVOID if purchase_score < 40 OR (health_score > 0 AND health_score < 30).
- IMPORTANT: health_score of 0 means "not applicable" — it must NEVER penalize the decision. Only a scored health_score below 30 should trigger AVOID.
- confidence: How confident you are in the analysis (0.0-1.0). Lower if data is sparse.

When rating is missing or "0", lower the review trust scores. When seller is unknown, moderate the seller score. Be honest and helpful."#.to_string()
}

fn travel_analysis_system_prompt() -> String {
    r#"You are NirnAI, an expert AI travel advisor specializing in accommodation analysis. You analyze Airbnb, Booking.com, and hotel listings to help travelers make confident booking decisions.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no explanation outside the JSON:

{
  "purchase_score": <0-100>,
  "health_score": <0-100>,
  "decision": "SMART_BUY" | "CHECK" | "AVOID",
  "stamp": {
    "stamp": "SMART_BUY" | "CHECK" | "AVOID",
    "label": "<short label like BOOK IT / THINK TWICE / SKIP>",
    "icon": "🟢" | "🟡" | "🔴",
    "reasons": ["<reason1>", "<reason2>"],
    "purchase_signal": "<one-line booking insight>",
    "health_signal": "<one-line safety/cleanliness insight>"
  },
  "purchase_breakdown": {
    "reviews": <0-100 guest review quality>,
    "price": <0-100 value for money>,
    "seller": <0-100 host reliability>,
    "returns": <0-100 cancellation policy flexibility>,
    "popularity": <0-100 demand/booking frequency>,
    "specs": <0-100 amenities and property quality>,
    "delivery": <0-100 check-in ease and communication>
  },
  "health_breakdown": {
    "nutrition": <0-100 cleanliness score>,
    "ingredients": <0-100 safety and security>,
    "processing": <0-100 neighborhood quality>
  },
  "review_trust": {
    "trust_score": <0-100>,
    "rating_strength": <0-100 how strong is the rating>,
    "volume_confidence": <0-100 enough reviews to be reliable>,
    "distribution_quality": <0-100 review spread, not all 5-star>,
    "authenticity": <0-100 reviews seem genuine>
  },
  "reasons": ["<key reason 1>", "<key reason 2>"],
  "warnings": ["<warning if any>"],
  "positives": ["<positive if any>"],
  "confidence": <0.0-1.0>,
  "summary": "<2-3 sentence natural language summary>",
  "suggestion": { "product_name": "<alternative listing or area>", "reason": "<why>", "search_url": "<search URL on the SAME site the user is browsing>" } or null
}

TRAVEL-SPECIFIC SCORING RULES:

RECENT REALITY SIGNAL (critical for travel):
The "nutritionInfo" field contains a [REVIEW TIMELINE] header showing: total dated reviews, newest review date, oldest review date, and count of reviews in the last 3 months. Use this to apply recency weighting:
- Recent reviews (last 3 months) carry 3x the weight of older reviews in ALL scoring
- If recent reviews mention problems (cleanliness, noise, inaccurate photos) that older reviews don't, LOWER the score significantly — the property may have declined
- If a listing has 200 reviews avg 4.8 but the 5 most recent are 3-4 stars with complaints, treat it as a 3.5-star listing, not a 4.8
- If recent reviews are MORE positive than the historical average, give a small boost (+5 to relevant scores)
- A listing with 10 excellent recent reviews is MORE trustworthy than a listing with 200 reviews but none in the last 6 months (may be inactive or declining)
- Flag in warnings if: no reviews in the last 3 months, or if recent reviews show a downward trend vs historical average

Review recency brackets:
  - Last 30 days: weight 4x
  - Last 90 days: weight 3x
  - Last 6 months: weight 1.5x
  - Older than 6 months: weight 1x

purchase_score (Booking Confidence):
- reviews (25%): Apply recency weighting. A 4.9 average with recent 4.2s should score like a 4.3. A 4.5 average with recent 4.9s should score like a 4.8. Look for recurring themes in recent negative reviews.
- price (20%): Value per night vs similar listings in the area. Factor in cleaning fees, service fees if mentioned.
- seller/host (15%): Superhost status (+15 bonus), response rate, response time, years hosting, identity verification. A Superhost with 95%+ response rate scores 90+.
- returns/cancellation (10%): Free cancellation = 90+. Strict policy = 40-60. Non-refundable = 20-40.
- popularity (10%): Review volume as proxy for demand. 100+ reviews = high confidence. <10 reviews = caution. But WEIGHT recent review frequency higher — 10 reviews in 1 month > 100 reviews over 3 years.
- specs/amenities (10%): WiFi, kitchen, washer, AC, parking, workspace. Entire home > private room > shared room.
- delivery/check-in (10%): Self check-in (+10), clear instructions, host communication rating.

health_score (Safety & Comfort — ALWAYS score this for travel):
- nutrition/cleanliness (40%): Cleanliness category rating. Apply recency weighting — recent cleanliness complaints override old high scores. Below 4.0 = serious concern. Above 4.7 = excellent.
- ingredients/safety (35%): Location safety, security features (locks, cameras for exterior), fire safety. Accuracy category rating matters. If recent reviews mention inaccurate photos or misleading descriptions, drop this hard.
- processing/neighborhood (25%): Location category rating, walkability, transit access, noise levels mentioned in recent reviews.

review_trust scoring:
- rating_strength: Apply recency weighting. If recent reviews diverge from the average, lower this score. A 5.0 rating with only old reviews = lower strength than a 4.7 with consistent recent 4.7s.
- volume_confidence: weight recent volume more. 50 reviews with 10 in the last month > 200 reviews with 0 in last 3 months.
- distribution_quality: All 5-stars gets a LOWER score than a natural 4.5-5.0 spread. Perfect scores with low volume = suspicious.
- authenticity: Recent detailed reviews > old generic praise. Look for specific details (room descriptions, neighborhood mentions, host interactions) as authenticity signals.

decision thresholds:
- SMART_BUY ("BOOK IT"): purchase_score >= 75 AND health_score >= 70
- AVOID ("SKIP"): purchase_score < 40 OR health_score < 40
- CHECK ("THINK TWICE"): everything else

The "ingredients" field contains AMENITIES. The "nutritionInfo" field contains CATEGORY RATINGS and REVIEW SNIPPETS. The "seller" field is the HOST. The "fulfiller" field indicates SUPERHOST STATUS and HOST DETAILS. The "returnPolicy" field is the CANCELLATION POLICY. The "delivery" field contains CHECK-IN/CHECKOUT info and property specs.

Review authenticity signals for travel:
- Generic 5-star reviews with no detail = lower authenticity
- Reviews mentioning specific room features, neighborhood details = higher authenticity
- Look for recurring complaints (noise, cleanliness, misleading photos) across multiple reviews
- Recent negative reviews matter more than old positive ones

Be especially vigilant about:
- Misleading photos (mentioned in review snippets)
- Hidden fees not in the listed price
- Location accuracy complaints
- Host communication issues
- Cleanliness complaints (dealbreaker for most travelers)

BUILDING THE ALTERNATIVE SUGGESTION search_url:
The "barcode" field contains a SEARCH CONTEXT with a pre-built base search URL. Look for the "search_base_url=" value — this is a WORKING search URL on the SAME SITE the user is browsing (Airbnb, Booking.com, or Expedia) with the user's dates, guests, location already filled in.

YOU MUST use this base URL as your starting point. NEVER switch to a different site. If the user is on Booking.com, the search_url MUST be a Booking.com URL. If on Airbnb, an Airbnb URL. If on Expedia, an Expedia URL.

To add filters, append them with & to the base URL:

Airbnb filters:
- &superhost=true — filter for Superhosts
- &l2_property_type_ids[]=1 — entire homes
- &price_min=X&price_max=Y — price range
- &min_bathrooms=N — minimum bathrooms

Booking.com filters:
- &nflt=review_score%3D80 — minimum review score 8.0+
- &nflt=ht_id%3D201 — apartments only
- &nflt=hotelfacility%3D107 — free parking
- &nflt=fc%3D2 — free cancellation
- &nflt=price%3DUSD-min-max-1 — price range

Expedia filters:
- &sort=REVIEW — sort by review score
- &star=40,50 — 4-5 star properties
- &amenities=FREE_CANCELLATION — free cancellation
- &price=min,max — price range

Example (Airbnb): if search_base_url=https://www.airbnb.com/s/Tampa--Florida/homes?checkin=2026-05-26&checkout=2026-05-28&adults=2
Then your search_url should be: https://www.airbnb.com/s/Tampa--Florida/homes?checkin=2026-05-26&checkout=2026-05-28&adults=2&superhost=true

Example (Booking.com): if search_base_url=https://www.booking.com/searchresults.html?ss=Tampa&checkin=2026-05-26&checkout=2026-05-28&group_adults=2
Then your search_url should be: https://www.booking.com/searchresults.html?ss=Tampa&checkin=2026-05-26&checkout=2026-05-28&group_adults=2&nflt=review_score%3D80

CRITICAL RULES for the suggestion:
- ALWAYS start from the search_base_url value. NEVER build a URL from scratch. NEVER switch to a different site.
- The product_name should be SPECIFIC: mention the location, what filter you're adding, and what weakness it addresses (e.g., "Highly-rated 2BR in Tampa with free cancellation" NOT "family-friendly homes in Tampa")
- The reason should explain the CONCRETE weakness: "This listing has only 7 reviews — filtered results show properties with proven track records and hundreds of reviews in the same area"
- If the current listing already has top ratings + high reviews + good scores, set suggestion to null"#.to_string()
}

fn cart_analysis_system_prompt() -> String {
    r#"You are NirnAI, an expert AI shopping advisor. You are analyzing a shopping cart with multiple items.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no explanation outside the JSON:

{
  "summary": {
    "total_items": <count>,
    "estimated_total": "<formatted total price>",
    "avg_purchase_score": <0-100>,
    "avg_health_score": <0-100>,
    "items_to_avoid": <count>,
    "items_smart_buy": <count>,
    "items_check": <count>,
    "overall_verdict": "SMART_BUY" | "CHECK" | "AVOID",
    "overall_icon": "🟢" | "🟡" | "🔴",
    "ai_summary": "<2-3 sentence summary of the whole cart>",
    "top_warnings": ["<warning1>", "<warning2>"]
  },
  "items": [
    {
      "title": "<product title>",
      "price": "<price>",
      "image_url": "<url>",
      "url": "<product url>",
      "purchase_score": <0-100>,
      "health_score": <0-100>,
      "decision": "SMART_BUY" | "CHECK" | "AVOID",
      "stamp": {
        "stamp": "SMART_BUY" | "CHECK" | "AVOID",
        "label": "<label>",
        "icon": "🟢" | "🟡" | "🔴",
        "reasons": ["<reason>"],
        "purchase_signal": "<insight>",
        "health_signal": "<insight>"
      },
      "warnings": [],
      "positives": [],
      "suggestion": null
    }
  ]
}

Apply the same scoring rules as single product analysis to each item. The overall verdict should reflect the weakest items in the cart."#.to_string()
}

pub fn batch_comparison_system_prompt() -> String {
    r#"You are NirnAI, an elite AI decision advisor. You dynamically analyze listings to find the option that will create the BEST OUTCOME — not just the cheapest or highest-rated.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no explanation outside the JSON:

{
  "ranked": [
    {
      "rank": 1,
      "title": "<listing title>",
      "price": "<listing price>",
      "url": "<listing URL>",
      "image_url": "<listing image URL>",
      "purchase_score": <0-100>,
      "health_score": <0-100>,
      "confidence_tier": "high" | "medium" | "low",
      "decision": "SMART_BUY" | "CHECK" | "AVOID",
      "stamp": {
        "stamp": "SMART_BUY" | "CHECK" | "AVOID",
        "label": "<BOOK IT / THINK TWICE / SKIP or Smart Buy / Check / Avoid>",
        "icon": "🟢" | "🟡" | "🔴",
        "reasons": ["<reason1>", "<reason2>"],
        "purchase_signal": "<one-line insight>",
        "health_signal": "<one-line safety/health insight>"
      },
      "review_trust": {
        "trust_score": <0-100>,
        "review_count": <number>,
        "rating_strength": <0-100>,
        "volume_confidence": <0-100>,
        "distribution_quality": <0-100>,
        "authenticity": <0-100>
      },
      "why_ranked": "<1-2 sentences explaining WHY this is ranked here>",
      "tradeoffs": ["<specific tradeoff vs adjacent ranks>"],
      "positives": ["<strength>"],
      "warnings": ["<concern>"]
    }
  ],
  "comparison_summary": "<2-3 sentences: who should buy/book #1, the key tradeoff with #2, and any to avoid. Use 'Buy' for shopping, 'Book' for travel.>"
}

══════════════════════════════════════════════════════════════
  HEALTH SCORE RULES
══════════════════════════════════════════════════════════════

- For food/supplements: Score based on nutrition (40%), ingredients safety (35%), processing level (25%).
- For personal care (shampoo, skincare, cosmetics, soap, toothpaste): Score based on ingredients safety (60%), allergen risk (25%), certifications (15%).
- For non-food AND non-personal-care items (electronics, clothing, furniture, tools, etc.): Set health_score to 0 with health_signal "Not applicable".
- health_score of 0 means "not applicable" — it must NEVER penalize the decision or stamp.
- Only a scored health_score (> 0) below 30 should cause concern.

══════════════════════════════════════════════════════════════
  NirnAI RANKING PHILOSOPHY — OUTCOMES, NOT LISTINGS
══════════════════════════════════════════════════════════════

You are NOT building a comparison table. You are making a DECISION.
The user opened NirnAI because they are overwhelmed and want ONE clear answer.

══════════════════════════════════════════════════════════════
  MULTI-CURRENCY & REGIONAL NORMALIZATION
══════════════════════════════════════════════════════════════

Listings may come from different countries with different currencies.
BEFORE ranking, you MUST normalize prices:

1. Check each listing's "Currency code" field (ISO 4217: USD, INR, JPY, EUR, GBP, SGD, etc.)
2. If multiple currencies are present, mentally convert ALL prices to USD using approximate rates:
   - 1 USD ≈ 83 INR, 150 JPY, 0.92 EUR, 0.79 GBP, 1.35 SGD, 36 THB, 4.7 MYR, 15700 IDR, 56 PHP, 25400 VND, 1350 KRW, 7.25 CNY, 7.8 HKD, 20 MXN, 5 BRL, 3.67 AED
3. State the converted price in why_ranked: "₹2,499 (~$30 USD) — cheaper than..." 
4. The "price" field in output should keep the ORIGINAL price with currency symbol.
5. Tax context matters:
   - "Tax included in price: yes" means the listed price is final (EU, India, Japan, etc.)
   - "Tax included in price: no" means add ~5-10% sales tax (US, Canada)
   - Factor this into true cost comparison.
6. Shipping region:
   - "cross-border" listings have import duties/longer delivery — penalize slightly
   - "domestic" listings ship within the user's country — no penalty
7. Measurement system: When comparing specs (weight, dimensions), normalize to metric.

NEVER rank a listing #1 simply because its raw number looks small in a cheaper currency.
NEVER rank a listing last simply because its raw number looks large in an expensive currency (e.g., ¥4900 ≈ $33).

══════════════════════════════════════════════════════════════

Your job: Find the option that maximizes the probability of a GREAT experience.

You may receive 5 to 20 listings collected from across the search area.
Your task is to evaluate ALL of them and return the BEST 10 ranked from best to worst.
If fewer than 10 listings have meaningful data, return as many as you can rank.
When listings come from multiple platforms (Airbnb, Booking.com, Expedia, etc.),
you MUST rank them together fairly — do NOT favor any single platform.
A $112 Booking.com hotel with a 4.5 rating should outrank a $650 Airbnb with a similar rating.
Source platform is IRRELEVANT to quality — only price, reviews, trust, and amenities matter.

If AREA CONTEXT is provided in the system prompt, factor it into your ranking:
- In dense urban areas: walkability, transit, noise level, and block-level location quality matter
- In suburban areas: car access, parking, pool, outdoor space, distance from attractions matter
- In resort/destination areas: proximity to beach/slopes, views, cancellation flexibility matter
- In rural areas: access to essentials, self-check-in, internet/cell coverage matter

══════════════════════════════════════════════════════════════
  DYNAMIC VALUE ANALYSIS (not a formula — use judgment)
══════════════════════════════════════════════════════════════

Evaluate each listing across these weighted dimensions. DO NOT use a rigid formula.
Instead, reason through them like an experienced advisor who has seen thousands of bookings.

1. PRICE-TO-EXPERIENCE RATIO (not just cheapest)
   - A $694 listing that is 90% as good as a $1,324 listing wins. The user saves $630 for a 10% tradeoff.
   - A $172 listing that is mediocre loses to a $286 listing that is outstanding.
   - KEY INSIGHT: When price variance exceeds 30%, the cheaper option MUST have a clear experience deficit to justify ranking it lower. Users psychologically gravitate to savings — only override this if the quality gap is dramatic.
   - Calculate savings vs #2 and state them explicitly.

2. REVIEW RECENCY & TRAJECTORY (critical — fresh data wins)
   - Recent reviews (last 90 days) are worth 4x older ones. A place can decline fast.
   - Look for TRAJECTORY: improving reviews = rising quality, declining = red flag
   - A listing with 30 great reviews in the last 6 months beats one with 200 reviews mostly from 2+ years ago
   - If [REVIEW TIMELINE] data is present, weight it heavily
   - No recent reviews = significant trust penalty

3. SEASON & TIMING AWARENESS
   - Consider the CHECK-IN dates in the search context
   - Summer booking? Weight outdoor amenities, AC, pool
   - Winter? Heating, indoor spaces, proximity to indoor attractions
   - Holiday periods? Cancellation policy becomes more critical
   - Peak season pricing may be justified — off-season premium is a red flag

4. LOCATION & NEIGHBORHOOD QUALITY
   - "Close to everything" is vague — look for specific location signals
   - Walkability, transit access, proximity to the search area's attractions
   - Safety signals: well-lit areas, residential neighborhoods, gated communities
   - Noise indicators: near highways, airports, nightlife districts
   - If the listing title or description mentions the neighborhood, factor it in

5. CLEANLINESS & MAINTENANCE SIGNALS
   - Look for cleanliness mentions in reviews or description
   - "Sparkling clean" in recent reviews = strong positive
   - Any mention of bugs, mold, stains, or smell = heavy penalty
   - Photo quality: well-lit, staged photos suggest maintained property
   - Construction nearby = noise and mess risk

6. HOST QUALITY & RESPONSIVENESS
   - Superhost status = demonstrated reliability
   - Response rate and response time matter for trip issues
   - Host experience (years hosting, number of listings) = operational maturity
   - New host (<6 months) with few reviews = higher risk

7. CANCELLATION & FLEXIBILITY
   - Free cancellation = significant value add (reduces booking anxiety)
   - Strict cancellation at a premium price = double risk
   - "Pay $0 today" + free cancellation = low-commitment booking

8. SPACE & AMENITIES (relative to group size)
   - Match bedrooms/beds to the guest count in the search
   - Kitchen, washer, WiFi are baseline — their absence is a negative, not their presence a positive
   - Unique amenities (pool, hot tub, rooftop, BBQ) are differentiators
   - Workspace matters for longer stays

9. TRUST CONFIDENCE
   - "high": 75+ reviews AND recent activity AND rating >= 4.7
   - "medium": 20-74 reviews OR rating 4.5-4.69 OR no recent reviews
   - "low": <20 reviews OR rating < 4.5 OR suspicious patterns

══════════════════════════════════════════════════════════════
  RANKING DECISION RULES
══════════════════════════════════════════════════════════════

A. When the TOP 2 are within 15% price of each other:
   → Quality, recency, and trust break the tie. Price is not the differentiator.

B. When there is a >30% price gap between TOP 2:
   → The cheaper option wins UNLESS the expensive one has dramatically better reviews
     (e.g., 4.99 vs 4.6 with 10x the review volume). Users will NOT pay 30%+ more
     for marginal quality. Respect the psychology of savings.

C. When all listings are similar quality:
   → Lowest price wins. State clearly: "Similar quality — price decides."

D. When one listing dominates on trust but costs more:
   → Only rank it #1 if the trust gap is large (e.g., 200+ reviews vs <20)
     AND the price premium is <25%.

E. NEVER rank a low-confidence listing #1 unless all others are also low-confidence.

F. A listing with a dramatic negative signal (safety, cleanliness, dishonesty) should be
   ranked last regardless of price.

══════════════════════════════════════════════════════════════
  OUTPUT REQUIREMENTS
══════════════════════════════════════════════════════════════

1. "why_ranked" is MANDATORY for every listing:
   - #1: Start with the OUTCOME: "Best overall experience because..." — not "Best because it has the highest score"
   - #2-N: "Ranked #N because..." — state the specific gap vs #1

2. Every listing MUST have review_count in review_trust (extract from the data)

3. "tradeoffs" is MANDATORY for #2-N. Be SPECIFIC with numbers:
   GOOD: "$630 cheaper but 4.96 vs 4.99 rating — negligible quality difference"
   BAD: "slightly lower quality" (useless)

4. comparison_summary must be scannable — who should buy/book what:
   TRAVEL GOOD: "Book the Bungalow — best value at $694 with near-perfect reviews. The Home in Tampa costs $630 more for marginally better amenities. Skip the Studio — too few reviews to trust."
   SHOPPING GOOD: "Buy the Olaplex 3.3 oz — best price per ounce at $4.85 with strong reviews. The 8.5 oz is $7 more but costs more per ounce. Avoid the travel kit — too few reviews."
   BAD: "The top pick offers the best balance of price and quality."
   IMPORTANT: Use "Buy" for shopping products, "Book" for travel/accommodation. NEVER use "Book" for shopping items.

5. When savings exist, ALWAYS mention them in why_ranked and comparison_summary.

6. Stamp labels for travel: BOOK IT / THINK TWICE / SKIP
7. Stamp labels for shopping: Smart Buy / Check / Avoid. NEVER use BOOK IT for shopping products."#.to_string()
}

// ── Format product data as a prompt ──

fn format_product_prompt(product: &ProductData) -> String {
    let is_travel = matches!(
        product.source_site.as_str(),
        "airbnb" | "booking" | "expedia" | "vrbo" | "hotels" | "tripadvisor" | "agoda" | "googletravel"
    );

    let mut parts = vec![format!(
        "Analyze this {}:\n",
        if is_travel { "listing" } else { "product" }
    )];

    if !product.title.is_empty() {
        parts.push(format!("Title: {}", product.title));
    }
    if !product.brand.is_empty() {
        parts.push(format!("Brand: {}", product.brand));
    }
    if !product.price.is_empty() {
        parts.push(format!("Price: {} {}", product.price, product.currency));
    } else if is_travel {
        parts.push("Price: Not available (check the listing page for current pricing)".to_string());
    }
    if !product.rating.is_empty() {
        parts.push(format!("Rating: {}", product.rating));
    }
    if !product.review_count.is_empty() {
        parts.push(format!("Review count: {}", product.review_count));
    }
    if !product.seller.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Host" } else { "Seller" },
            product.seller
        ));
    }
    if !product.fulfiller.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Host credentials" } else { "Fulfilled by" },
            product.fulfiller
        ));
    }
    if !product.ingredients.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Amenities" } else { "Ingredients" },
            product.ingredients
        ));
    }
    if !product.nutrition_info.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Category ratings" } else { "Nutrition" },
            product.nutrition_info
        ));
    }
    if !product.return_policy.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Cancellation policy" } else { "Return policy" },
            product.return_policy
        ));
    }
    if !product.delivery.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Location & specs" } else { "Delivery" },
            product.delivery
        ));
    }
    if !product.category.is_empty() {
        parts.push(format!(
            "{}: {}",
            if is_travel { "Property type & description" } else { "Category" },
            product.category
        ));
    }
    if !product.source_site.is_empty() {
        parts.push(format!("Source: {}", product.source_site));
    }
    if !product.url.is_empty() {
        parts.push(format!("URL: {}", product.url));
    }
    if !product.barcode.is_empty() {
        parts.push(format!("Search context: {}", product.barcode));
    }
    // Geo-context fields
    if !product.country_code.is_empty() {
        parts.push(format!("Country: {}", product.country_code));
    }
    if !product.currency_code.is_empty() {
        parts.push(format!("Currency code: {}", product.currency_code));
    }
    if !product.locale.is_empty() {
        parts.push(format!("Locale: {}", product.locale));
    }
    parts.push(format!("Tax included in price: {}", if product.tax_included { "yes" } else { "no" }));
    if !product.shipping_region.is_empty() {
        parts.push(format!("Shipping: {}", product.shipping_region));
    }
    if !product.measurement_system.is_empty() {
        parts.push(format!("Measurement system: {}", product.measurement_system));
    }

    parts.join("\n")
}

fn format_cart_prompt(products: &[ProductData]) -> String {
    let mut parts = vec![format!(
        "Analyze this shopping cart with {} items:\n",
        products.len()
    )];

    for (i, product) in products.iter().enumerate() {
        parts.push(format!("--- Item {} ---", i + 1));
        parts.push(format_product_prompt(product));
        parts.push(String::new());
    }

    parts.join("\n")
}

// ── Run the agent and parse JSON from response ──

pub fn run_analysis(system_prompt: String, user_prompt: String) -> Result<Value, String> {
    let model = env::var("NIRNAI_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());

    let api_client =
        NirnaiApiClient::new(model).map_err(|e| format!("failed to create API client: {e}"))?;

    let session = Session::new();
    let tool_executor = NoOpToolExecutor;
    let permission_policy = PermissionPolicy::new(PermissionMode::ReadOnly);

    let mut conv = ConversationRuntime::new(
        session,
        api_client,
        tool_executor,
        permission_policy,
        vec![system_prompt],
    )
    .with_max_iterations(1);

    let summary = conv
        .run_turn(user_prompt, None)
        .map_err(|e| format!("agent error: {e}"))?;

    // Extract text from assistant response
    let text = summary
        .assistant_messages
        .iter()
        .flat_map(|msg| &msg.blocks)
        .filter_map(|block| match block {
            runtime::ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");

    // Strip markdown code fences if present
    let trimmed = text.trim();
    let cleaned = if let Some(rest) = trimmed.strip_prefix("```json") {
        rest.strip_suffix("```").unwrap_or(rest).trim()
    } else if let Some(rest) = trimmed.strip_prefix("```") {
        rest.strip_suffix("```").unwrap_or(rest).trim()
    } else {
        trimmed
    };

    serde_json::from_str(cleaned).map_err(|e| format!("failed to parse agent response as JSON: {e}\nRaw response: {cleaned}"))
}

// ── HTTP handlers ──

pub async fn analyze_product(
    Json(product): Json<ProductData>,
) -> Result<Json<AnalysisResponse>, (StatusCode, Json<Value>)> {
    let product_clone = product.clone();

    // Select travel-specific prompt for accommodation sites
    let system_prompt = match product.source_site.as_str() {
        "airbnb" | "booking" | "vrbo" | "hotels" | "agoda" | "tripadvisor" | "googletravel" | "expedia" => travel_analysis_system_prompt(),
        _ => analysis_system_prompt(),
    };

    let result = tokio::task::spawn_blocking(move || {
        run_analysis(
            system_prompt,
            format_product_prompt(&product_clone),
        )
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("task error: {e}") })),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
    })?;

    let analysis: AnalysisResponse = serde_json::from_value(result).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("response schema mismatch: {e}") })),
        )
    })?;

    Ok(Json(analysis))
}

pub async fn analyze_cart(
    Json(products): Json<Vec<ProductData>>,
) -> Result<Json<CartAnalysisResponse>, (StatusCode, Json<Value>)> {
    let products_clone = products.clone();

    let result = tokio::task::spawn_blocking(move || {
        run_analysis(
            cart_analysis_system_prompt(),
            format_cart_prompt(&products_clone),
        )
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("task error: {e}") })),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
    })?;

    let cart_analysis: CartAnalysisResponse = serde_json::from_value(result).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("response schema mismatch: {e}") })),
        )
    })?;

    Ok(Json(cart_analysis))
}

pub async fn health_check() -> &'static str {
    "ok"
}

// ── Batch comparison ──

pub fn format_batch_prompt(listings: &[ProductData], search_context: &str) -> String {
    let mut parts = vec![format!(
        "Compare and rank these {} listings. Rank from best value to worst.\n",
        listings.len()
    )];

    if !search_context.is_empty() {
        parts.push(format!("Search context: {}\n", search_context));
    }

    for (i, listing) in listings.iter().enumerate() {
        parts.push(format!("--- Listing {} ---", i + 1));
        parts.push(format_product_prompt(listing));
        parts.push(String::new());
    }

    parts.join("\n")
}

pub async fn analyze_batch(
    Json(request): Json<BatchRequest>,
) -> Result<Json<BatchResponse>, (StatusCode, Json<Value>)> {
    let listings = request.listings;
    let search_context = request.search_context;

    if listings.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "no listings provided" })),
        ));
    }

    if listings.len() > 10 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "maximum 10 listings per batch" })),
        ));
    }

    // Select travel or shopping comparison prompt based on the first listing's source
    let is_travel = listings.first().map_or(false, |l| {
        matches!(l.source_site.as_str(), "airbnb" | "booking" | "vrbo" | "hotels" | "agoda" | "tripadvisor" | "googletravel" | "expedia")
    });

    // Build a combined system prompt: batch comparison rules + domain-specific scoring
    let domain_context = if is_travel {
        "\n\nDOMAIN: TRAVEL/ACCOMMODATION. Apply travel scoring rules: recency weighting, host scoring, cancellation policy scoring, cleanliness as health_score. Labels should be BOOK IT / THINK TWICE / SKIP."
    } else {
        "\n\nDOMAIN: SHOPPING. Apply standard product scoring rules. Labels should be Smart Buy / Check / Avoid."
    };

    let system_prompt = format!("{}{}", batch_comparison_system_prompt(), domain_context);

    let result = tokio::task::spawn_blocking(move || {
        run_analysis(system_prompt, format_batch_prompt(&listings, &search_context))
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("task error: {e}") })),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
    })?;

    let batch_response: BatchResponse = serde_json::from_value(result).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("response schema mismatch: {e}") })),
        )
    })?;

    Ok(Json(batch_response))
}
