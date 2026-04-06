use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::compare::{self, NirnaiState};
use crate::nirnai::ProductData;

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
/// Creates a compare session with one listing and returns the compare URL.
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

    // Detect source site from URL
    let source_site = detect_source_site(&url);

    // Build a minimal ProductData from the URL — the AI engine will work with what it has
    let listing = ProductData {
        title: String::new(),
        url: url.clone(),
        source_site: source_site.clone(),
        page_type: if is_travel_site(&source_site) { "travel".into() } else { "product".into() },
        ..default_product_data()
    };

    // Create a compare session with this single listing
    let resp = compare::create_compare_session(
        &state.sessions,
        &state.inventory,
        vec![listing],
        format!("Single product analysis from URL: {}", url),
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
    let is_travel = category.is_empty()
        || category.contains("travel")
        || category.contains("hotel")
        || category.contains("stay")
        || category.contains("airbnb")
        || category.contains("accommodation")
        || looks_like_travel(&query);

    let encoded = query.replace(' ', "+");

    let platform_links: Vec<serde_json::Value> = if is_travel {
        vec![
            json!({ "platform": "Airbnb", "url": format!("https://www.airbnb.com/s/{}/homes", encoded), "icon": "🏠" }),
            json!({ "platform": "Booking.com", "url": format!("https://www.booking.com/searchresults.html?ss={}", encoded), "icon": "🏨" }),
            json!({ "platform": "Expedia", "url": format!("https://www.expedia.com/Hotel-Search?destination={}", encoded), "icon": "✈️" }),
            json!({ "platform": "VRBO", "url": format!("https://www.vrbo.com/search?destination={}", encoded), "icon": "🏡" }),
            json!({ "platform": "Hotels.com", "url": format!("https://www.hotels.com/search.do?q-destination={}", encoded), "icon": "🛏️" }),
            json!({ "platform": "TripAdvisor", "url": format!("https://www.tripadvisor.com/Search?q={}", encoded), "icon": "📍" }),
        ]
    } else {
        vec![
            json!({ "platform": "Amazon", "url": format!("https://www.amazon.com/s?k={}", encoded), "icon": "📦" }),
            json!({ "platform": "Walmart", "url": format!("https://www.walmart.com/search?q={}", encoded), "icon": "🛒" }),
            json!({ "platform": "Target", "url": format!("https://www.target.com/s?searchTerm={}", encoded), "icon": "🎯" }),
            json!({ "platform": "Best Buy", "url": format!("https://www.bestbuy.com/site/searchpage.jsp?st={}", encoded), "icon": "💻" }),
            json!({ "platform": "eBay", "url": format!("https://www.ebay.com/sch/i.html?_nkw={}", encoded), "icon": "🏷️" }),
            json!({ "platform": "Costco", "url": format!("https://www.costco.com/CatalogSearch?keyword={}", encoded), "icon": "📋" }),
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
    let travel_signals = [
        "hotel", "stay", "airbnb", "booking", "resort", "hostel",
        "apartment", "villa", "cabin", "cottage", "br ", "1br", "2br", "3br",
        "bedroom", "night", "/night", "per night", "guest", "guests",
        "check-in", "checkout", "check in", "check out",
    ];
    // Also treat bare city/location names as travel by default
    let city_signals = [
        "new york", "newyork", "nyc", "tampa", "miami", "los angeles", "la ",
        "chicago", "seattle", "boston", "san francisco", "sf ", "austin",
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

    let listings: Vec<ProductData> = urls
        .iter()
        .map(|url| {
            let source_site = detect_source_site(url);
            ProductData {
                title: String::new(),
                url: url.clone(),
                source_site: source_site.clone(),
                page_type: if is_travel_site(&source_site) {
                    "travel".into()
                } else {
                    "product".into()
                },
                ..default_product_data()
            }
        })
        .collect();

    let context = format!("Direct comparison of {} URLs from NirnAI homepage", urls.len());

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

fn default_product_data() -> ProductData {
    ProductData {
        title: String::new(),
        brand: String::new(),
        price: String::new(),
        currency: String::new(),
        rating: String::new(),
        review_count: String::new(),
        seller: String::new(),
        fulfiller: String::new(),
        ingredients: String::new(),
        nutrition_info: String::new(),
        return_policy: String::new(),
        delivery: String::new(),
        category: String::new(),
        url: String::new(),
        image_url: String::new(),
        barcode: String::new(),
        source_site: String::new(),
        page_type: String::new(),
        country_code: String::new(),
        currency_code: String::new(),
        locale: String::new(),
        tax_included: false,
        shipping_region: String::new(),
        measurement_system: String::new(),
    }
}
