use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::warn;

use crate::compare::{self, NirnaiState};
use crate::nirnai::ProductData;
use crate::scraper;

// ── Affiliate / monetization link builder ──
//
// Appends affiliate IDs and UTM tracking params to outbound platform URLs.
// Affiliate IDs are read from env vars so they can be configured per-deployment
// without code changes:
//
//   NIRNAI_AFF_BOOKING    — Booking.com affiliate ID (affiliate program)
//   NIRNAI_AFF_AMAZON     — Amazon Associates tag (e.g. "nirnai-20")
//   NIRNAI_AFF_EXPEDIA    — Expedia/CJ affiliate ID
//   NIRNAI_AFF_HOTELS     — Hotels.com affiliate ID
//   NIRNAI_AFF_EBAY       — eBay Partner Network campaign ID
//   NIRNAI_AFF_VRBO       — VRBO affiliate ID
//   NIRNAI_AFF_TRIPADVISOR — TripAdvisor affiliate ID
//
// When an env var is unset, only UTM tracking params are appended so we can
// still measure click-through attribution via analytics.

pub fn affiliate_url(base: &str, platform: &str) -> String {
    let sep = if base.contains('?') { "&" } else { "?" };
    let mut params: Vec<String> = Vec::new();

    // Simple percent-encoding for URL embedding
    fn urlencoding_encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len() * 3);
        for b in s.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(b as char);
                }
                _ => {
                    out.push_str(&format!("%{:02X}", b));
                }
            }
        }
        out
    }

    // Platform-specific affiliate params
    let plat = platform.to_lowercase();
    match plat.as_str() {
        "booking" | "booking.com" => {
            if let Ok(aid) = std::env::var("NIRNAI_AFF_BOOKING") {
                // Awin redirect wrapper for Booking.com
                let enriched = format!("{}{}{}", base, sep, "utm_source=nirnai&utm_medium=referral");
                return format!(
                    "https://www.awin1.com/cread.php?awinmid=6776&awinaffid={}&ued={}",
                    aid,
                    urlencoding_encode(&enriched)
                );
            }
        }
        "amazon" => {
            if let Ok(tag) = std::env::var("NIRNAI_AFF_AMAZON") {
                params.push(format!("tag={}", tag));
            }
        }
        "expedia" => {
            if let Ok(aff) = std::env::var("NIRNAI_AFF_EXPEDIA") {
                params.push(format!("affcid={}", aff));
            }
        }
        "hotels" | "hotels.com" => {
            if let Ok(aff) = std::env::var("NIRNAI_AFF_HOTELS") {
                params.push(format!("rffrid={}", aff));
            }
        }
        "ebay" => {
            if let Ok(cid) = std::env::var("NIRNAI_AFF_EBAY") {
                params.push(format!("campid={}", cid));
                params.push("toolid=10001&customid=nirnai".to_string());
            }
        }
        "vrbo" => {
            if let Ok(aff) = std::env::var("NIRNAI_AFF_VRBO") {
                params.push(format!("affid={}", aff));
            }
        }
        "tripadvisor" => {
            if let Ok(aff) = std::env::var("NIRNAI_AFF_TRIPADVISOR") {
                params.push(format!("CampaignId={}", aff));
            }
        }
        _ => {}
    }

    // UTM tracking for all platforms — always appended so we can measure attribution
    params.push("utm_source=nirnai".to_string());
    params.push("utm_medium=referral".to_string());

    format!("{}{}{}", base, sep, params.join("&"))
}

// ── POST /intent/link ──

#[derive(Debug, Deserialize)]
pub struct LinkRequest {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct IntentResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compare_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

/// POST /intent/link — User pasted a single URL.
/// Scrapes the page for listing data, then creates a compare session.
pub async fn intent_link(
    State(state): State<NirnaiState>,
    Json(request): Json<LinkRequest>,
) -> Result<Json<IntentResponse>, (StatusCode, Json<serde_json::Value>)> {
    let url = request.url.trim().to_string();

    if url.is_empty() || !url.starts_with("http") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid URL" })),
        ));
    }

    // Scrape the page to extract listing data
    let listing = match scraper::scrape_url(&url).await {
        Ok(data) => {
            tracing::info!(
                "Scraped {}: title={:?}, price={:?}, rating={:?}, reviews={:?}",
                url, data.title, data.price, data.rating, data.review_count
            );
            data
        }
        Err(e) => {
            warn!("Scrape failed for {}: {}. Falling back to URL-only.", url, e);
            // Fallback: build minimal ProductData from URL
            let source_site = detect_source_site(&url);
            ProductData {
                title: String::new(),
                url: url.clone(),
                source_site: source_site.clone(),
                page_type: if is_travel_site(&source_site) { "travel".into() } else { "product".into() },
                ..Default::default()
            }
        }
    };

    // Build a rich context string from scraped data
    let mut context_parts = vec![format!("Single listing analysis from URL: {}", url)];
    if !listing.barcode.is_empty() {
        context_parts.push(format!("\n\nSEARCH CONTEXT: {}", listing.barcode));
    }
    if listing.price.is_empty() {
        context_parts.push(
            "\n\nNOTE: Price was not available from server-side page data. \
             Focus analysis on quality signals (rating, reviews, host, amenities, \
             cancellation policy, location). Set the price field to \"Check listing\" \
             rather than inventing a price. Mention in why_ranked that the user should \
             verify the price on the actual listing page."
                .to_string(),
        );
    }

    // Create a compare session with this listing
    let resp = compare::create_compare_session(
        &state.sessions,
        &state.inventory,
        vec![listing],
        context_parts.join(""),
    )
    .await
    .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))?;

    Ok(Json(IntentResponse {
        compare_url: Some(resp.url),
        result_url: None,
        result: None,
    }))
}

// ── POST /intent/search ──

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub budget: String,
    #[serde(default)]
    pub checkin: String,
    #[serde(default)]
    pub checkout: String,
    #[serde(default)]
    pub guests: String,
    #[serde(default)]
    pub property_type: String,
}

/// POST /intent/search — User typed a natural language search.
/// Returns platform search links so the user can browse with the extension,
/// which will perform real data extraction and cross-platform ranking.
pub async fn intent_search(
    State(_state): State<NirnaiState>,
    Json(request): Json<SearchRequest>,
) -> Result<Json<IntentResponse>, (StatusCode, Json<serde_json::Value>)> {
    let query = request.query.trim().to_string();

    if query.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "query is required" })),
        ));
    }

    let category = request.category.trim().to_lowercase();
    let checkin = request.checkin.trim().to_string();
    let checkout = request.checkout.trim().to_string();
    let guests = request.guests.trim().to_string();
    let property_type = request.property_type.trim().to_string();

    let is_travel = category.contains("travel")
        || category.is_empty() && looks_like_travel(&query);

    let encoded = query.replace(' ', "+");

    let platform_links: Vec<serde_json::Value> = if is_travel {
        // Build Airbnb URL with filters
        let mut airbnb_url = format!("https://www.airbnb.com/s/{}/homes", encoded);
        let mut airbnb_params = Vec::new();
        if !checkin.is_empty() { airbnb_params.push(format!("checkin={}", checkin)); }
        if !checkout.is_empty() { airbnb_params.push(format!("checkout={}", checkout)); }
        if !guests.is_empty() { airbnb_params.push(format!("adults={}", guests)); }
        if property_type == "entire_home" { airbnb_params.push("room_types[]=Entire+home/apt".to_string()); }
        else if property_type == "private_room" { airbnb_params.push("room_types[]=Private+room".to_string()); }
        else if property_type == "hotel" { airbnb_params.push("room_types[]=Hotel+room".to_string()); }
        if !airbnb_params.is_empty() { airbnb_url = format!("{}?{}", airbnb_url, airbnb_params.join("&")); }

        // Build Booking.com URL with filters
        let mut booking_url = format!("https://www.booking.com/searchresults.html?ss={}", encoded);
        if !checkin.is_empty() { booking_url.push_str(&format!("&checkin={}", checkin)); }
        if !checkout.is_empty() { booking_url.push_str(&format!("&checkout={}", checkout)); }
        if !guests.is_empty() { booking_url.push_str(&format!("&group_adults={}", guests)); }

        // Build Expedia URL with filters
        let mut expedia_url = format!("https://www.expedia.com/Hotel-Search?destination={}", encoded);
        if !checkin.is_empty() { expedia_url.push_str(&format!("&startDate={}", checkin)); }
        if !checkout.is_empty() { expedia_url.push_str(&format!("&endDate={}", checkout)); }
        if !guests.is_empty() { expedia_url.push_str(&format!("&adults={}", guests)); }

        // Build VRBO URL with filters
        let mut vrbo_url = format!("https://www.vrbo.com/search?destination={}", encoded);
        if !checkin.is_empty() { vrbo_url.push_str(&format!("&startDate={}", checkin)); }
        if !checkout.is_empty() { vrbo_url.push_str(&format!("&endDate={}", checkout)); }
        if !guests.is_empty() { vrbo_url.push_str(&format!("&adults={}", guests)); }

        // Build Hotels.com URL with filters
        let mut hotels_url = format!("https://www.hotels.com/search.do?q-destination={}", encoded);
        if !checkin.is_empty() { hotels_url.push_str(&format!("&q-check-in={}", checkin)); }
        if !checkout.is_empty() { hotels_url.push_str(&format!("&q-check-out={}", checkout)); }
        if !guests.is_empty() { hotels_url.push_str(&format!("&q-rooms=1&q-room-0-adults={}", guests)); }

        vec![
            json!({ "platform": "Airbnb", "url": affiliate_url(&airbnb_url, "airbnb"), "icon": "🏠" }),
            json!({ "platform": "Booking.com", "url": affiliate_url(&booking_url, "booking"), "icon": "🏨" }),
            json!({ "platform": "Expedia", "url": affiliate_url(&expedia_url, "expedia"), "icon": "✈️" }),
            json!({ "platform": "VRBO", "url": affiliate_url(&vrbo_url, "vrbo"), "icon": "🏡" }),
            json!({ "platform": "Hotels.com", "url": affiliate_url(&hotels_url, "hotels"), "icon": "🛏️" }),
            json!({ "platform": "TripAdvisor", "url": affiliate_url(&format!("https://www.tripadvisor.com/Search?q={}", encoded), "tripadvisor"), "icon": "📍" }),
        ]
    } else {
        vec![
            json!({ "platform": "Amazon", "url": affiliate_url(&format!("https://www.amazon.com/s?k={}", encoded), "amazon"), "icon": "📦" }),
            json!({ "platform": "Walmart", "url": affiliate_url(&format!("https://www.walmart.com/search?q={}", encoded), "walmart"), "icon": "🛒" }),
            json!({ "platform": "Target", "url": affiliate_url(&format!("https://www.target.com/s?searchTerm={}", encoded), "target"), "icon": "🎯" }),
            json!({ "platform": "Best Buy", "url": affiliate_url(&format!("https://www.bestbuy.com/site/searchpage.jsp?st={}", encoded), "bestbuy"), "icon": "💻" }),
            json!({ "platform": "eBay", "url": affiliate_url(&format!("https://www.ebay.com/sch/i.html?_nkw={}", encoded), "ebay"), "icon": "🏷️" }),
            json!({ "platform": "Costco", "url": affiliate_url(&format!("https://www.costco.com/CatalogSearch?keyword={}", encoded), "costco"), "icon": "📋" }),
        ]
    };

    // Return search guidance instead of a garbage compare session
    Ok(Json(IntentResponse {
        compare_url: None,
        result_url: None,
        result: Some(json!({
            "type": "search_guide",
            "query": query,
            "category": if is_travel { "travel" } else { "shopping" },
            "platform_links": platform_links,
            "message": format!(
                "To get NirnAI-ranked results for \"{}\", visit any of these platforms with the NirnAI extension installed. The extension will automatically extract listings, search across all platforms, and rank the best options for you.",
                query
            )
        })),
    }))
}

/// Heuristic to detect travel-related search queries.
fn looks_like_travel(query: &str) -> bool {
    let q = query.to_lowercase();

    // Explicit shopping signals override travel — prevents false positives
    let shopping_signals = [
        "phone", "laptop", "tv ", "headphone", "camera", "tablet", "monitor",
        "keyboard", "mouse", "shoes", "sneakers", "dress", "jacket", "jeans",
        "shirt", "watch", "ring", "necklace", "sofa", "couch", "mattress",
        "desk", "chair", "table", "lamp", "refrigerator", "dishwasher",
        "microwave", "blender", "vacuum", "washer", "dryer", "stroller",
        "car seat", "toy", "game", "console", "playstation", "xbox",
        "nintendo", "best buy", "amazon", "walmart", "target", "costco", "ebay",
    ];
    if shopping_signals.iter().any(|s| q.contains(s)) {
        return false;
    }

    let travel_signals = [
        "hotel", "stay", "airbnb", "booking", "resort", "hostel",
        "villa", "cabin", "cottage", "per night", "/night",
        "guest house", "check-in", "checkout", "check in", "check out",
        "vacation rental", "bed and breakfast", "b&b",
    ];
    let city_signals = [
        "new york", "newyork", "nyc", "tampa", "miami", "los angeles",
        "chicago", "seattle", "boston", "san francisco", "austin",
        "denver", "nashville", "orlando", "vegas", "las vegas", "atlanta",
        "portland", "dallas", "houston", "phoenix", "san diego",
        "london", "paris", "tokyo", "barcelona", "rome", "dubai",
        "bali", "cancun", "hawaii", "maui",
    ];
    travel_signals.iter().any(|s| q.contains(s))
        || city_signals.iter().any(|s| q.contains(s))
}

// ── POST /intent/compare ──

#[derive(Debug, Deserialize)]
pub struct CompareRequest {
    pub urls: Vec<String>,
}

/// POST /intent/compare — User pasted multiple URLs to compare.
/// Creates a compare session with all listings.
pub async fn intent_compare(
    State(state): State<NirnaiState>,
    Json(request): Json<CompareRequest>,
) -> Result<Json<IntentResponse>, (StatusCode, Json<serde_json::Value>)> {
    let urls: Vec<String> = request
        .urls
        .iter()
        .map(|u| u.trim().to_string())
        .filter(|u| u.starts_with("http"))
        .collect();

    if urls.len() < 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "need at least 2 valid URLs" })),
        ));
    }

    if urls.len() > 20 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "maximum 20 URLs" })),
        ));
    }

    let mut listings = Vec::new();
    for url in &urls {
        let listing = match scraper::scrape_url(url).await {
            Ok(data) => data,
            Err(e) => {
                warn!("Scrape failed for {}: {}", url, e);
                let source_site = detect_source_site(url);
                ProductData {
                    url: url.clone(),
                    source_site: source_site.clone(),
                    page_type: if is_travel_site(&source_site) { "travel".into() } else { "product".into() },
                    ..Default::default()
                }
            }
        };
        listings.push(listing);
    }

    let mut context = format!("Direct comparison of {} URLs from NirnAI homepage", urls.len());
    // If any listing has search context (dates/guests), include it
    if let Some(ctx) = listings.iter().find_map(|l| {
        if l.barcode.is_empty() { None } else { Some(&l.barcode) }
    }) {
        context.push_str(&format!("\n\nSEARCH CONTEXT: {}", ctx));
    }
    // If any listing is missing price, add note
    if listings.iter().any(|l| l.price.is_empty()) {
        context.push_str(
            "\n\nNOTE: Some listings have no price data available from server-side scraping. \
             Set price to \"Check listing\" for those. Focus ranking on quality signals and \
             mention in why_ranked that users should verify prices on the actual listing pages."
        );
    }

    let resp = compare::create_compare_session(&state.sessions, &state.inventory, listings, context)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))?;

    Ok(Json(IntentResponse {
        compare_url: Some(resp.url),
        result_url: None,
        result: None,
    }))
}

// ── Helpers ──

fn detect_source_site(url: &str) -> String {
    let url_lower = url.to_lowercase();
    let sites = [
        ("airbnb", "airbnb"),
        ("booking.com", "booking"),
        ("expedia", "expedia"),
        ("vrbo", "vrbo"),
        ("hotels.com", "hotels"),
        ("tripadvisor", "tripadvisor"),
        ("kayak", "kayak"),
        ("hostelworld", "hostelworld"),
        ("amazon", "amazon"),
        ("walmart", "walmart"),
        ("target.com", "target"),
        ("bestbuy", "bestbuy"),
        ("ebay", "ebay"),
        ("costco", "costco"),
        ("homedepot", "homedepot"),
        ("lowes", "lowes"),
        ("nordstrom", "nordstrom"),
        ("macys", "macys"),
        ("sephora", "sephora"),
        ("ulta", "ulta"),
        ("nike", "nike"),
        ("adidas", "adidas"),
        ("newegg", "newegg"),
        ("etsy", "etsy"),
        ("wayfair", "wayfair"),
        ("zappos", "zappos"),
    ];

    for (pattern, name) in sites {
        if url_lower.contains(pattern) {
            return name.to_string();
        }
    }
    "unknown".to_string()
}

fn is_travel_site(source: &str) -> bool {
    matches!(
        source,
        "airbnb" | "booking" | "expedia" | "vrbo" | "hotels" | "tripadvisor" | "kayak" | "hostelworld"
    )
}


