use aws_sdk_dynamodb::types::AttributeValue;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::nirnai::{AnalysisResponse, ProductData, RankedListing};

// ── Types ──

const INVENTORY_TABLE: &str = "nirnai-inventory";
const INVENTORY_TTL_SECS: u64 = 604800; // 7 days

#[derive(Clone)]
pub struct Inventory {
    client: aws_sdk_dynamodb::Client,
}

impl Inventory {
    pub fn new(client: aws_sdk_dynamodb::Client) -> Self {
        Self { client }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InventoryListing {
    pub id: String,
    pub session_id: String,
    pub rank: u32,
    pub title: String,
    pub price: String,
    pub url: String,
    pub image_url: String,
    pub platform: String,
    pub destination: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub area_type: Option<String>,
    pub radius_miles: Option<f64>,
    pub purchase_score: u32,
    pub health_score: u32,
    pub confidence_tier: String,
    pub decision: String,
    pub why_ranked: String,
    pub positives: Vec<String>,
    pub warnings: Vec<String>,
    pub tradeoffs: Vec<String>,
    pub comparison_summary: String,
    pub ranked_at: String,
}

#[derive(Debug, Serialize)]
pub struct InventorySearchResponse {
    pub listings: Vec<InventoryListing>,
    pub total: usize,
    pub freshness_note: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lng: Option<f64>,
    #[serde(default)]
    pub radius_miles: Option<f64>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    20
}

// ── Geo context parsed from search_context string ──

#[derive(Debug, Default)]
pub struct GeoContext {
    pub destination: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub area_type: Option<String>,
    pub radius_miles: Option<f64>,
    pub platform: String,
}

/// Parse geo context from the search_context string and listings.
/// Format: "URL\n\nAREA CONTEXT: Tampa, FL (2-mile search radius, urban density)\n..."
pub fn parse_geo_context(search_context: &str, source_site: &str) -> GeoContext {
    let mut ctx = GeoContext {
        platform: source_site.to_string(),
        ..Default::default()
    };

    // Parse AREA CONTEXT line
    if let Some(idx) = search_context.find("AREA CONTEXT:") {
        let rest = &search_context[idx + "AREA CONTEXT:".len()..];
        let line = rest.lines().next().unwrap_or("").trim();

        if let Some(paren_start) = line.find('(') {
            ctx.destination = line[..paren_start].trim().to_string();
            let paren_content = &line[paren_start + 1..];

            if let Some(mile_idx) = paren_content.find("-mile") {
                let num_str: String = paren_content[..mile_idx]
                    .chars()
                    .rev()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
                ctx.radius_miles = num_str.parse().ok();
            }

            let area_types = ["dense_urban", "urban", "suburban", "resort", "rural"];
            for at in area_types {
                if paren_content.contains(at) {
                    ctx.area_type = Some(at.to_string());
                    break;
                }
            }
        } else {
            ctx.destination = line.to_string();
        }
    }

    if ctx.destination.is_empty() {
        if let Some(idx) = search_context.find("Cross-site search for ") {
            let rest = &search_context[idx + "Cross-site search for ".len()..];
            let end = rest
                .find('(')
                .unwrap_or_else(|| rest.find('.').unwrap_or(rest.len()));
            let dest = rest[..end].trim().to_string();
            if !dest.is_empty() && dest != "this area" {
                ctx.destination = dest;
            }

            if let Some(paren_start) = rest.find('(') {
                if let Some(paren_end) = rest[paren_start..].find(')') {
                    let paren = &rest[paren_start + 1..paren_start + paren_end];
                    let area_types = ["dense_urban", "urban", "suburban", "resort", "rural"];
                    for at in area_types {
                        if paren.contains(at) {
                            ctx.area_type = Some(at.to_string());
                            break;
                        }
                    }
                    if let Some(mi_idx) = paren.find("mi") {
                        let before = &paren[..mi_idx];
                        let num_str: String = before
                            .chars()
                            .rev()
                            .take_while(|c| c.is_ascii_digit() || *c == '.')
                            .collect::<String>()
                            .chars()
                            .rev()
                            .collect();
                        ctx.radius_miles = num_str.parse().ok();
                    }
                }
            }
        } else if let Some(idx) = search_context.find("SEARCH CONTEXT:") {
            let rest = &search_context[idx + "SEARCH CONTEXT:".len()..];
            let line = rest.lines().next().unwrap_or("").trim();
            ctx.destination = line.to_string();
        }
    }

    if ctx.lat.is_none() {
        if let Some(idx) = search_context.find("Coordinates: ") {
            let rest = &search_context[idx + "Coordinates: ".len()..];
            let coord_str = rest.lines().next().unwrap_or("").trim();
            let coord_str = coord_str.trim_end_matches('.');
            if let Some(comma) = coord_str.find(',') {
                let lat_str = coord_str[..comma].trim();
                let lng_str = coord_str[comma + 1..].trim();
                let lng_str = lng_str.split_whitespace().next().unwrap_or(lng_str);
                ctx.lat = lat_str.parse().ok();
                ctx.lng = lng_str.parse().ok();
            }
        }
    }

    ctx
}

// ── DynamoDB helpers ──

fn ttl_value() -> String {
    let ttl = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + INVENTORY_TTL_SECS;
    ttl.to_string()
}

fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // Simple ISO-ish format: YYYY-MM-DDTHH:MM:SSZ
    let secs_per_day = 86400u64;
    let days_since_epoch = now / secs_per_day;
    let time_of_day = now % secs_per_day;

    // Simple date calculation
    let mut year = 1970u64;
    let mut remaining_days = days_since_epoch;
    loop {
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 366 } else { 365 };
        if remaining_days < days_in_year { break; }
        remaining_days -= days_in_year;
        year += 1;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_months: [u64; 12] = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0usize;
    for (i, &d) in days_in_months.iter().enumerate() {
        if remaining_days < d { month = i; break; }
        remaining_days -= d;
    }
    let day = remaining_days + 1;
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month + 1, day, hour, minute, second)
}

fn seven_days_ago_iso() -> String {
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - 604800; // 7 days in seconds

    let secs_per_day = 86400u64;
    let days_since_epoch = cutoff / secs_per_day;
    let time_of_day = cutoff % secs_per_day;

    let mut year = 1970u64;
    let mut remaining_days = days_since_epoch;
    loop {
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 366 } else { 365 };
        if remaining_days < days_in_year { break; }
        remaining_days -= days_in_year;
        year += 1;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_months: [u64; 12] = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0usize;
    for (i, &d) in days_in_months.iter().enumerate() {
        if remaining_days < d { month = i; break; }
        remaining_days -= d;
    }
    let day = remaining_days + 1;
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month + 1, day, hour, minute, second)
}

fn listing_to_item(
    session_id: &str,
    listing: &RankedListing,
    comparison_summary: &str,
    geo: &GeoContext,
    ranked_at: &str,
) -> std::collections::HashMap<String, AttributeValue> {
    let mut item = std::collections::HashMap::new();
    let id = format!("{}-{}", session_id, listing.rank);
    item.insert("session_id".into(), AttributeValue::S(session_id.to_string()));
    item.insert("rank".into(), AttributeValue::N(listing.rank.to_string()));
    item.insert("id".into(), AttributeValue::S(id));
    item.insert("title".into(), AttributeValue::S(listing.title.clone()));
    item.insert("price".into(), AttributeValue::S(listing.price.clone()));
    item.insert("url".into(), AttributeValue::S(listing.url.clone()));
    item.insert("image_url".into(), AttributeValue::S(listing.image_url.clone()));
    item.insert("platform".into(), AttributeValue::S(geo.platform.clone()));
    item.insert("destination".into(), AttributeValue::S(geo.destination.clone()));
    if let Some(lat) = geo.lat {
        item.insert("lat".into(), AttributeValue::N(lat.to_string()));
    }
    if let Some(lng) = geo.lng {
        item.insert("lng".into(), AttributeValue::N(lng.to_string()));
    }
    if let Some(ref at) = geo.area_type {
        item.insert("area_type".into(), AttributeValue::S(at.clone()));
    }
    if let Some(rm) = geo.radius_miles {
        item.insert("radius_miles".into(), AttributeValue::N(rm.to_string()));
    }
    item.insert("purchase_score".into(), AttributeValue::N(listing.purchase_score.to_string()));
    item.insert("health_score".into(), AttributeValue::N(listing.health_score.to_string()));
    item.insert("confidence_tier".into(), AttributeValue::S(listing.confidence_tier.clone()));
    item.insert("decision".into(), AttributeValue::S(listing.decision.clone()));
    item.insert("why_ranked".into(), AttributeValue::S(listing.why_ranked.clone()));
    item.insert("positives".into(), AttributeValue::S(serde_json::to_string(&listing.positives).unwrap_or_default()));
    item.insert("warnings".into(), AttributeValue::S(serde_json::to_string(&listing.warnings).unwrap_or_default()));
    item.insert("tradeoffs".into(), AttributeValue::S(serde_json::to_string(&listing.tradeoffs).unwrap_or_default()));
    item.insert("comparison_summary".into(), AttributeValue::S(comparison_summary.to_string()));
    item.insert("ranked_at".into(), AttributeValue::S(ranked_at.to_string()));
    item.insert("ttl".into(), AttributeValue::N(ttl_value()));
    item
}

fn item_to_listing(item: &std::collections::HashMap<String, AttributeValue>) -> Option<InventoryListing> {
    let get_s = |k: &str| item.get(k).and_then(|v| v.as_s().ok()).cloned().unwrap_or_default();
    let get_n_u32 = |k: &str| item.get(k).and_then(|v| v.as_n().ok()).and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    let get_n_f64 = |k: &str| item.get(k).and_then(|v| v.as_n().ok()).and_then(|n| n.parse::<f64>().ok());

    Some(InventoryListing {
        id: get_s("id"),
        session_id: get_s("session_id"),
        rank: get_n_u32("rank"),
        title: get_s("title"),
        price: get_s("price"),
        url: get_s("url"),
        image_url: get_s("image_url"),
        platform: get_s("platform"),
        destination: get_s("destination"),
        lat: get_n_f64("lat"),
        lng: get_n_f64("lng"),
        area_type: item.get("area_type").and_then(|v| v.as_s().ok()).cloned(),
        radius_miles: get_n_f64("radius_miles"),
        purchase_score: get_n_u32("purchase_score"),
        health_score: get_n_u32("health_score"),
        confidence_tier: get_s("confidence_tier"),
        decision: get_s("decision"),
        why_ranked: get_s("why_ranked"),
        positives: serde_json::from_str(&get_s("positives")).unwrap_or_default(),
        warnings: serde_json::from_str(&get_s("warnings")).unwrap_or_default(),
        tradeoffs: serde_json::from_str(&get_s("tradeoffs")).unwrap_or_default(),
        comparison_summary: get_s("comparison_summary"),
        ranked_at: get_s("ranked_at"),
    })
}

// ── Database operations ──

impl Inventory {
    pub async fn save_rankings(
        &self,
        session_id: &str,
        ranked: &[RankedListing],
        comparison_summary: &str,
        geo: &GeoContext,
    ) -> Result<usize, String> {
        let ranked_at = now_iso();
        let mut count = 0;
        for listing in ranked {
            let item = listing_to_item(session_id, listing, comparison_summary, geo, &ranked_at);
            self.client
                .put_item()
                .table_name(INVENTORY_TABLE)
                .set_item(Some(item))
                .send()
                .await
                .map_err(|e| format!("DynamoDB put inventory: {e}"))?;
            count += 1;
        }
        Ok(count)
    }

    pub async fn save_verified_listing(
        &self,
        product: &ProductData,
        analysis: &AnalysisResponse,
    ) -> Result<(), String> {
        let destination = if !product.barcode.is_empty() {
            product.barcode.split('|').next().unwrap_or("").trim().to_string()
        } else {
            String::new()
        };

        let confidence_tier = if analysis.confidence >= 0.7 {
            "high"
        } else if analysis.confidence >= 0.4 {
            "medium"
        } else {
            "low"
        };

        let session_id = format!("verified-{}", uuid::Uuid::new_v4());
        let ranked_at = now_iso();

        // Build a RankedListing for reuse
        let fake_listing = RankedListing {
            rank: 1,
            title: product.title.clone(),
            price: product.price.clone(),
            url: product.url.clone(),
            image_url: product.image_url.clone(),
            purchase_score: analysis.purchase_score,
            health_score: analysis.health_score,
            confidence_tier: confidence_tier.to_string(),
            decision: analysis.decision.clone(),
            stamp: analysis.stamp.clone(),
            review_trust: analysis.review_trust.clone(),
            why_ranked: analysis.summary.clone(),
            tradeoffs: vec![],
            positives: analysis.positives.clone(),
            warnings: analysis.warnings.clone(),
        };

        let geo = GeoContext {
            platform: product.source_site.clone(),
            destination,
            ..Default::default()
        };

        let mut item = listing_to_item(&session_id, &fake_listing, &format!("NirnAI-verified: {}", analysis.stamp.label), &geo, &ranked_at);
        item.insert("comparison_summary".into(), AttributeValue::S(format!("NirnAI-verified: {}", analysis.stamp.label)));

        self.client
            .put_item()
            .table_name(INVENTORY_TABLE)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| format!("DynamoDB put verified: {e}"))?;

        Ok(())
    }

    pub async fn search_listings(
        &self,
        params: &SearchParams,
    ) -> Result<Vec<InventoryListing>, String> {
        let cutoff = seven_days_ago_iso();

        // Use Scan with filters (efficient at low volume, no complex GSI needed)
        let mut scan = self.client
            .scan()
            .table_name(INVENTORY_TABLE)
            .filter_expression("ranked_at > :cutoff");

        scan = scan.expression_attribute_values(":cutoff", AttributeValue::S(cutoff));

        // Add destination filter
        if let Some(dest) = &params.destination {
            scan = scan
                .filter_expression("ranked_at > :cutoff AND contains(destination, :dest)")
                .expression_attribute_values(":dest", AttributeValue::S(dest.clone()));
        }

        // Add geo filter
        if let (Some(lat), Some(lng)) = (params.lat, params.lng) {
            let radius = params.radius_miles.unwrap_or(5.0);
            let lat_delta = radius / 69.0;
            let lng_delta = radius / (69.0 * lat.to_radians().cos().abs().max(0.01));

            scan = scan
                .filter_expression(
                    "ranked_at > :cutoff AND lat BETWEEN :lat_min AND :lat_max AND lng BETWEEN :lng_min AND :lng_max"
                )
                .expression_attribute_values(":lat_min", AttributeValue::N((lat - lat_delta).to_string()))
                .expression_attribute_values(":lat_max", AttributeValue::N((lat + lat_delta).to_string()))
                .expression_attribute_values(":lng_min", AttributeValue::N((lng - lng_delta).to_string()))
                .expression_attribute_values(":lng_max", AttributeValue::N((lng + lng_delta).to_string()));
        }

        // Don't use DynamoDB Limit — it caps items *evaluated* (pre-filter),
        // not results returned.  At low volume a full scan is fine; we
        // truncate after sorting below.
        let result = scan
            .send()
            .await
            .map_err(|e| format!("DynamoDB scan: {e}"))?;

        let mut listings: Vec<InventoryListing> = result
            .items()
            .iter()
            .filter_map(item_to_listing)
            .collect();

        // Sort by rank then by ranked_at descending
        listings.sort_by(|a, b| {
            a.rank.cmp(&b.rank).then(b.ranked_at.cmp(&a.ranked_at))
        });

        // Limit results
        listings.truncate(params.limit);

        Ok(listings)
    }
}

// ── HTTP Handler ──

/// GET /listings/search?destination=Tampa&lat=27.95&lng=-82.46&radius_miles=5&limit=20
pub async fn search_inventory(
    State(inventory): State<Inventory>,
    Query(params): Query<SearchParams>,
) -> Result<Json<InventorySearchResponse>, (StatusCode, Json<serde_json::Value>)> {
    let listings = inventory.search_listings(&params).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    let total = listings.len();
    Ok(Json(InventorySearchResponse {
        listings,
        total,
        freshness_note: "Prices shown are from NirnAI-verified rankings within the last 7 days. Actual prices may have changed.".into(),
    }))
}
