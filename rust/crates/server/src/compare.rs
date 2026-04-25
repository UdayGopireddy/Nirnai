use aws_sdk_dynamodb::types::AttributeValue;
use axum::extract::{FromRef, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::clicks::ClickTracker;
use crate::inventory::{self, Inventory, InventoryListing};
use crate::nirnai::{
    self, BatchResponse, DecisionStamp, ProductData, RankedListing, ReviewTrust,
};
use crate::proxy;

// ── Session store (DynamoDB) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareSession {
    pub id: String,
    pub status: SessionStatus,
  #[serde(default)]
  pub created_at: u64,
    pub listings: Vec<ProductData>,
    pub search_context: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<BatchResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Pending,
    Analyzing,
    Done,
    Error,
}

const SESSIONS_TABLE: &str = "nirnai-sessions";
// Keep compare sessions for 30 days so homepage history is actually useful.
const SESSION_TTL_SECS: u64 = 30 * 24 * 60 * 60;

#[derive(Clone)]
pub struct SessionStore {
    client: aws_sdk_dynamodb::Client,
}

impl SessionStore {
    pub fn new(client: aws_sdk_dynamodb::Client) -> Self {
        Self { client }
    }

    pub async fn put(&self, session: &CompareSession) -> Result<(), String> {
        let data = serde_json::to_string(session)
            .map_err(|e| format!("serialize session: {e}"))?;
        let ttl = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + SESSION_TTL_SECS;

        self.client
            .put_item()
            .table_name(SESSIONS_TABLE)
            .item("id", AttributeValue::S(session.id.clone()))
            .item("data", AttributeValue::S(data))
            .item("ttl", AttributeValue::N(ttl.to_string()))
            .send()
            .await
            .map_err(|e| format!("DynamoDB put session: {e}"))?;
        Ok(())
    }

    pub async fn get(&self, id: &str) -> Result<Option<CompareSession>, String> {
        let resp = self
            .client
            .get_item()
            .table_name(SESSIONS_TABLE)
            .key("id", AttributeValue::S(id.to_string()))
            .send()
            .await
            .map_err(|e| format!("DynamoDB get session: {e}"))?;

        match resp.item {
            Some(item) => {
                let data = item
                    .get("data")
                    .and_then(|v| v.as_s().ok())
                    .ok_or("missing data attribute")?;
                let session: CompareSession = serde_json::from_str(data)
                    .map_err(|e| format!("deserialize session: {e}"))?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    pub async fn exists(&self, id: &str) -> bool {
        self.client
            .get_item()
            .table_name(SESSIONS_TABLE)
            .key("id", AttributeValue::S(id.to_string()))
            .projection_expression("id")
            .send()
            .await
            .map(|r| r.item.is_some())
            .unwrap_or(false)
    }

    /// Scan recent completed sessions for the homepage sidebar.
    /// Returns lightweight summaries (no full listing data) paired with the
    /// session's `created_at` timestamp so callers can merge with other
    /// sources and sort newest-first.
    pub async fn recent(&self, limit: usize) -> Vec<(RecentSearch, u64)> {
      // Read ALL scan pages (DynamoDB scan is paginated at ~1MB/page).
      // Without this, recent searches can appear truncated to only the first page.
      let mut items: Vec<std::collections::HashMap<String, AttributeValue>> = Vec::new();
      let mut start_key: Option<std::collections::HashMap<String, AttributeValue>> = None;

      loop {
        let result = self
          .client
          .scan()
          .table_name(SESSIONS_TABLE)
          .set_exclusive_start_key(start_key.clone())
          .send()
          .await;

        let output = match result {
          Ok(r) => r,
          Err(_) => return vec![],
        };

        items.extend(output.items().iter().cloned());
        start_key = output.last_evaluated_key().cloned();
        if start_key.is_none() {
          break;
        }
      }

        let mut searches: Vec<(RecentSearch, u64)> = items
            .iter()
            .filter_map(|item| {
                let data_str = item.get("data")?.as_s().ok()?;
                let session: CompareSession = serde_json::from_str(data_str).ok()?;
                if session.status != SessionStatus::Done { return None; }
                let result = session.result.as_ref()?;
                let ranked = &result.ranked;
                if ranked.is_empty() { return None; }

                // Extract destination/title from search_context
                let ctx = &session.search_context;
                let destination = extract_destination(ctx, ranked);
                if destination.is_empty() { return None; }

                // When origin is the best, show origin as the top pick
                let (top_pick, top_score, top_decision) = if result.origin_is_best
                    && !result.origin_title.is_empty()
                {
                    (
                        result.origin_title.clone(),
                        result.origin_purchase_score as u32,
                        "YOUR BEST PICK".to_string(),
                    )
                } else {
                    let top = &ranked[0];
                    (top.title.clone(), top.purchase_score, top.stamp.label.clone())
                };
                let listing_count = ranked.len();

                Some((RecentSearch {
                    id: session.id.clone(),
                    destination: destination.clone(),
                    top_pick,
                    top_score,
                    top_decision,
                    listing_count,
                }, session.created_at))
            })
            .collect();

          // Sort by newest first, then by listing count to break ties.
          searches.sort_by(|a, b| {
            b.1.cmp(&a.1)
              .then_with(|| b.0.listing_count.cmp(&a.0.listing_count))
          });

          // Keep chronological recents; do not collapse identical destinations.
          let mut searches: Vec<(RecentSearch, u64)> = searches;
        searches.truncate(limit);
        searches
    }
}

// ── Recent search summary ──

#[derive(Debug, Clone, Serialize)]
pub struct RecentSearch {
    pub id: String,
    pub destination: String,
    pub top_pick: String,
    pub top_score: u32,
    pub top_decision: String,
    pub listing_count: usize,
}

/// Extract a human-readable destination/label from search_context string.
/// Falls back to top-ranked listing info if context doesn't contain a clear label.
fn extract_destination(ctx: &str, ranked: &[crate::nirnai::RankedListing]) -> String {
    // 1. "AREA CONTEXT: <destination> ("
    if let Some(start) = ctx.find("AREA CONTEXT: ") {
        let after = &ctx[start + 14..];
        if let Some(end) = after.find(" (") {
            let dest = after[..end].trim();
            if !dest.is_empty() {
                return dest.to_string();
            }
        }
        if let Some(end) = after.find('\n') {
            let dest = after[..end].trim();
            if !dest.is_empty() {
                return dest.to_string();
            }
        }
    }

    // 2. "SEARCH CONTEXT: <query>"
    if let Some(start) = ctx.find("SEARCH CONTEXT: ") {
        let after = &ctx[start + 16..];
        let end = after.find('\n').unwrap_or(after.len());
        let dest = after[..end].trim();
        if !dest.is_empty() && dest.len() <= 60 {
            return dest.to_string();
        }
    }

    // 3. Shopping: 'User wants cross-site alternatives for: "Product Name"'
    //    or newer: 'FIND ALTERNATIVES: User is viewing "Product Name"'
    for needle in &["alternatives for: \"", "User is viewing \""] {
        if let Some(start) = ctx.find(needle) {
            let after = &ctx[start + needle.len()..];
            if let Some(end) = after.find('"') {
                let product = after[..end].trim();
                if !product.is_empty() {
                    if product.len() > 40 {
                        return format!("{}…", &product[..37]);
                    }
                    return product.to_string();
                }
            }
        }
    }

    // 3b. Extract from ORIGINAL PRODUCT block: "Title: Product Name"
    if let Some(start) = ctx.find("ORIGINAL PRODUCT") {
        let block = &ctx[start..];
        if let Some(t) = block.find("Title: ") {
            let after = &block[t + 7..];
            let end = after.find('\n').unwrap_or(after.len());
            let title = after[..end].trim();
            if !title.is_empty() && title != "unknown" {
                if title.len() > 40 {
                    return format!("{}…", &title[..37]);
                }
                return title.to_string();
            }
        }
    }

    // 4. Travel with coordinates — detect travel sessions and extract city
    let is_travel = ctx.contains("Coordinates:") || ctx.contains("Dates:")
        || ctx.contains("Guests:");
    if is_travel {
        // Try to extract a city from top-ranked listing titles
        // Hotels often include city: "Hyatt Centric Faneuil Hall Boston, Boston, United States"
        for listing in ranked.iter().take(3) {
            let title = &listing.title;
            // Split by comma segments and find a short city-like segment
            let segments: Vec<&str> = title.split(',').map(|s| s.trim()).collect();
            // Walk segments from last to first, skip country names
            for seg in segments.iter().rev() {
                let s = seg.trim();
                if s.is_empty() || s.len() > 25 { continue; }
                if s.contains("United") || s.contains("India") || s.contains("Country")
                    || s.contains("State") || s.contains("Hotel") || s.contains("Resort")
                    || s.contains("Suite") || s.contains("Inn") { continue; }
                // Likely a city name
                return format!("Hotels in {}", s);
            }
        }
        return "Hotel Comparison".to_string();
    }

    // 5. Fallback: destination= URL param
    if let Some(start) = ctx.find("destination=") {
        let after = &ctx[start + 12..];
        let end = after.find('&').unwrap_or(after.len());
        let raw = &after[..end];
        let decoded = raw.replace("%20", " ").replace("%2C", ",").replace("%2c", ",").replace("+", " ");
        if !decoded.is_empty() {
            return decoded;
        }
    }

    // 6. Last resort: use the top listing title as the label
    if let Some(top) = ranked.first() {
        let title = &top.title;
        if title.len() > 35 {
            return format!("{}…", &title[..32]);
        }
        return title.clone();
    }

    String::new()
}

/// Convert a Unix epoch timestamp (seconds) to an ISO-8601-like string.
/// Used so session-backed recents can be sorted alongside inventory
/// entries (which already store an ISO `ranked_at`).
fn unix_to_iso(secs: u64) -> String {
    let secs_per_day = 86400u64;
    let days_since_epoch = secs / secs_per_day;
    let time_of_day = secs % secs_per_day;

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

/// GET /api/recent-searches
/// Recents come from two sources because writes don't always reach both
/// tables: hotel/accommodation rankings reliably land in `nirnai-inventory`
/// (geo-keyed), while retail/cross-site rankings sometimes only land in
/// `nirnai-sessions`. We merge both, dedupe by session id, and sort newest
/// first so the homepage shows hotels AND retail products.
pub async fn recent_searches(
  State(state): State<NirnaiState>,
) -> Json<Vec<RecentSearch>> {
  const LIMIT: usize = 20;

  // Inventory-backed recents (mostly accommodations). `ranked_at` is an
  // ISO-8601 string; lexicographic compare is order-preserving for ISO-8601.
  let inventory_recents: Vec<(RecentSearch, String)> = state
    .inventory
    .recent_searches(LIMIT * 2)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|r| {
      let ranked_at = r.ranked_at.clone();
      (
        RecentSearch {
          id: r.session_id,
          destination: r.destination,
          top_pick: r.top_pick,
          top_score: r.top_score,
          top_decision: r.top_decision,
          listing_count: r.listing_count,
        },
        ranked_at,
      )
    })
    .collect();

  // Session-backed recents (covers retail / cross-site comparisons that
  // don't always make it into the inventory table). Convert the unix
  // `created_at` to an ISO-8601 string so ordering is consistent with
  // inventory entries during the merge.
  let session_recents: Vec<(RecentSearch, String)> = state
    .sessions
    .recent(LIMIT * 2)
    .await
    .into_iter()
    .map(|(rec, created_at)| (rec, unix_to_iso(created_at)))
    .collect();

  // Merge: prefer the session-backed entry when both exist (richer top-pick
  // labels like "YOUR BEST PICK"), but keep whichever sort key is larger.
  use std::collections::HashMap;
  let mut by_id: HashMap<String, (RecentSearch, String)> = HashMap::new();

  for entry in inventory_recents.into_iter().chain(session_recents.into_iter()) {
    by_id
      .entry(entry.0.id.clone())
      .and_modify(|slot| {
        // Prefer the entry with the more recent timestamp; if equal, prefer
        // the session entry (already overwritten by the chain order).
        if entry.1 > slot.1 {
          slot.1 = entry.1.clone();
        }
        slot.0 = entry.0.clone();
      })
      .or_insert(entry);
  }

  let mut merged: Vec<(RecentSearch, String)> = by_id.into_values().collect();
  merged.sort_by(|a, b| b.1.cmp(&a.1));
  let recents: Vec<RecentSearch> = merged
    .into_iter()
    .map(|(r, _)| r)
    .take(LIMIT)
    .collect();

  Json(recents)
}

// ── Combined app state ──

#[derive(Clone)]
pub struct NirnaiState {
    pub sessions: SessionStore,
    pub inventory: Inventory,
    pub clicks: ClickTracker,
}

impl FromRef<NirnaiState> for SessionStore {
    fn from_ref(state: &NirnaiState) -> Self {
        state.sessions.clone()
    }
}

impl FromRef<NirnaiState> for Inventory {
    fn from_ref(state: &NirnaiState) -> Self {
        state.inventory.clone()
    }
}

impl FromRef<NirnaiState> for ClickTracker {
    fn from_ref(state: &NirnaiState) -> Self {
        state.clicks.clone()
    }
}

// ── Handlers ──

#[derive(Debug, Deserialize)]
pub struct StartRequest {
    pub listings: Vec<ProductData>,
    #[serde(default)]
    pub search_context: String,
    /// Optional original product (alternatives flow). When supplied, the
    /// Python ranker scores it directly with full ProductData fields
    /// instead of regex-parsing a stripped-down text blob from the prompt —
    /// fixes the standalone-vs-compare score mismatch.
    #[serde(default)]
    pub origin_product: Option<ProductData>,
}

#[derive(Debug, Serialize)]
pub struct StartResponse {
    pub id: String,
    pub url: String,
}

/// Create a compare session from listings + context. Returns (id, url).
/// Shared by the HTTP handler and the intent module.
pub async fn create_compare_session(
    store: &SessionStore,
    inventory: &Inventory,
    listings: Vec<ProductData>,
    search_context: String,
    origin_product: Option<ProductData>,
) -> Result<StartResponse, String> {
    if listings.is_empty() {
        return Err("no listings provided".into());
    }
    if listings.len() > 20 {
        return Err("maximum 20 listings".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_secs();
    let session = CompareSession {
        id: id.clone(),
        status: SessionStatus::Pending,
      created_at,
        listings: listings.clone(),
        search_context: search_context.clone(),
        result: None,
        error: None,
    };

    store.put(&session).await.map_err(|e| format!("Failed to save session: {e}"))?;

    // Kick off async analysis
    let store_clone = store.clone();
    let inventory_clone = inventory.clone();
    let id_clone = id.clone();
    let context_for_geo = search_context.clone();
    // For cross-site sessions, collect all unique source sites
    let source_sites: Vec<String> = {
        let mut sites: Vec<String> = listings.iter()
            .map(|l| l.source_site.clone())
            .filter(|s| !s.is_empty())
            .collect();
        sites.sort();
        sites.dedup();
        sites
    };
    let platform_label = if source_sites.len() > 1 {
        "cross-site".to_string()
    } else {
        source_sites.first().cloned().unwrap_or_default()
    };

    tokio::spawn(async move {
        // Mark as analyzing
        if let Ok(Some(mut s)) = store_clone.get(&id_clone).await {
            s.status = SessionStatus::Analyzing;
            let _ = store_clone.put(&s).await;
        }

        // Run analysis (reuse the existing analyze_batch logic)
        let result = analyze_batch_internal(listings, search_context, origin_product).await;

        // Store result
        if let Ok(Some(mut s)) = store_clone.get(&id_clone).await {
            match result {
                Ok(batch) => {
                    // Persist ranked listings to inventory
                    let geo = inventory::parse_geo_context(&context_for_geo, &platform_label);
                    tracing::info!(
                        "Saving {} rankings to inventory — destination: {:?}, platform: {}, lat: {:?}, lng: {:?}",
                        batch.ranked.len(), geo.destination, geo.platform, geo.lat, geo.lng
                    );
                    match inventory_clone.save_rankings(
                        &id_clone,
                        &batch.ranked,
                        &batch.comparison_summary,
                        &geo,
                    ).await {
                        Ok(count) => tracing::info!("Saved {count} rankings to inventory for session {}", &id_clone),
                        Err(e) => tracing::warn!("Failed to save rankings to inventory: {e}"),
                    }

                    s.result = Some(batch);
                    s.status = SessionStatus::Done;
                }
                Err(e) => {
                    s.error = Some(e);
                    s.status = SessionStatus::Error;
                }
            }
            let _ = store_clone.put(&s).await;
        }
    });

    // Use a relative URL so it works on both localhost and production
    let url = format!("/compare/{}", id);

    Ok(StartResponse { id, url })
}

/// POST /compare/start — accepts listings, stores session, kicks off async analysis, returns session ID + URL
pub async fn start_compare(
    State(state): State<NirnaiState>,
    Json(request): Json<StartRequest>,
) -> Result<Json<StartResponse>, (StatusCode, Json<serde_json::Value>)> {
    match create_compare_session(
        &state.sessions,
        &state.inventory,
        request.listings,
        request.search_context,
        request.origin_product,
    ).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "error": e })))),
    }
}

/// GET /compare/:id — serves the NirnAI compare webpage
pub async fn compare_page(
    Path(id): Path<String>,
    State(state): State<NirnaiState>,
) -> impl IntoResponse {
    if state.sessions.exists(&id).await {
        let html = build_compare_html(&id);
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            Html(html),
        );
    }

    // Fallback: rankings may still exist in inventory even if the session expired.
    if let Ok(listings) = state.inventory.get_session(&id).await {
        if !listings.is_empty() {
            let html = build_compare_html(&id);
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                Html(html),
            );
        }
    }

    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(String::from("<h1>Session not found</h1><p>This comparison link has expired or is invalid.</p>")),
    )
}

/// GET /compare/:id/status — JSON polling endpoint
pub async fn compare_status(
    Path(id): Path<String>,
    State(state): State<NirnaiState>,
) -> Result<Json<CompareSession>, (StatusCode, Json<serde_json::Value>)> {
    match state.sessions.get(&id).await {
        Ok(Some(session)) => Ok(Json(session)),
        Ok(None) => {
            // Fallback: synthesize a Done session from inventory rows.
            match state.inventory.get_session(&id).await {
                Ok(listings) if !listings.is_empty() => {
                    Ok(Json(synthesize_session_from_inventory(&id, &listings)))
                }
                _ => Err((
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "session not found" })),
                )),
            }
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )),
    }
}

/// Build a synthetic Done CompareSession from persisted inventory rows.
/// Used so historical recents (whose live sessions have expired) still render.
fn synthesize_session_from_inventory(
    id: &str,
    listings: &[InventoryListing],
) -> CompareSession {
    let comparison_summary = listings
        .iter()
        .find_map(|l| {
            if l.comparison_summary.is_empty() {
                None
            } else {
                Some(l.comparison_summary.clone())
            }
        })
        .unwrap_or_default();

    let destination = listings
        .iter()
        .find_map(|l| {
            if l.destination.is_empty() {
                None
            } else {
                Some(l.destination.clone())
            }
        })
        .unwrap_or_default();

    let platform = listings
        .iter()
        .find_map(|l| {
            if l.platform.is_empty() {
                None
            } else {
                Some(l.platform.clone())
            }
        })
        .unwrap_or_default();

    let mut search_context = String::new();
    if !destination.is_empty() {
        search_context.push_str(&format!("AREA CONTEXT: {} (historical)", destination));
    }
    if !platform.is_empty() {
        if !search_context.is_empty() {
            search_context.push_str("\n\n");
        }
        search_context.push_str(&format!("Platform: {}", platform));
    }

    let ranked: Vec<RankedListing> = listings
        .iter()
        .map(inventory_listing_to_ranked)
        .collect();

    let response = BatchResponse {
        ranked,
        comparison_summary,
        origin_title: String::new(),
        origin_purchase_score: 0,
        origin_trust_score: 0,
        origin_url: String::new(),
        origin_price: String::new(),
        origin_is_best: false,
    };

    CompareSession {
        id: id.to_string(),
        status: SessionStatus::Done,
        created_at: 0,
        listings: Vec::new(),
        search_context,
        result: Some(response),
        error: None,
    }
}

fn inventory_listing_to_ranked(l: &InventoryListing) -> RankedListing {
    let stamp_label = if l.decision.is_empty() {
        "Verified".to_string()
    } else {
        l.decision.clone()
    };

    RankedListing {
        rank: l.rank,
        title: l.title.clone(),
        price: l.price.clone(),
        url: l.url.clone(),
        image_url: l.image_url.clone(),
        purchase_score: l.purchase_score,
        health_score: l.health_score,
        confidence_tier: if l.confidence_tier.is_empty() {
            "medium".to_string()
        } else {
            l.confidence_tier.clone()
        },
        decision: l.decision.clone(),
        stamp: DecisionStamp {
            stamp: stamp_label.clone(),
            label: stamp_label,
            icon: String::new(),
            reasons: Vec::new(),
            purchase_signal: String::new(),
            health_signal: String::new(),
        },
        review_trust: ReviewTrust {
            trust_score: 0,
            rating_strength: 0,
            volume_confidence: 0,
            distribution_quality: 0,
            authenticity: 0,
        },
        why_ranked: l.why_ranked.clone(),
        tradeoffs: l.tradeoffs.clone(),
        positives: l.positives.clone(),
        warnings: l.warnings.clone(),
        domain: "general".to_string(),
    }
}

// ── Internal batch analysis ──

async fn analyze_batch_internal(
    listings: Vec<ProductData>,
    search_context: String,
    origin_product: Option<ProductData>,
) -> Result<BatchResponse, String> {
    let is_travel = listings.iter().any(|l| {
        matches!(l.source_site.as_str(), "airbnb" | "booking" | "expedia" | "vrbo" | "hotels" | "agoda" | "tripadvisor" | "googletravel")
    });

    let domain_context = if is_travel {
        "\n\nDOMAIN: TRAVEL/ACCOMMODATION. Apply travel scoring rules: recency weighting, host scoring, cancellation policy scoring, cleanliness as health_score. Labels should be Best Pick / Book / Consider / Caution / Skip."
    } else {
        "\n\nDOMAIN: SHOPPING. Apply standard product scoring rules. Labels should be Best Pick / Buy / Consider / Caution / Skip. In comparison_summary and why_ranked, use 'Buy' (never 'Book'). Example: 'Buy the Olaplex — highest confidence pick with strong reviews.'"
    };

    // Extract area/search context and notes if present (appended by content script or intent handler)
    let mut extra_context = String::new();
    for prefix in ["\n\nAREA CONTEXT:", "\n\nSEARCH CONTEXT:", "\n\nNOTE:"] {
        if let Some(idx) = search_context.find(prefix) {
            // Find the end: next \n\n or end of string
            let rest = &search_context[idx..];
            let end = rest[2..].find("\n\n").map(|i| i + 2).unwrap_or(rest.len());
            extra_context.push_str(&rest[..end]);
        }
    }

    let system_prompt = format!(
        "{}{}{}",
        nirnai::batch_comparison_system_prompt(),
        domain_context,
        extra_context
    );
    let user_prompt = nirnai::format_batch_prompt(&listings, &search_context);

    // Call Python backend for ranking (uses OpenAI) instead of Anthropic directly
    let python_url = proxy::python_url();
    let url = format!("{}/compare/rank", python_url);

    let payload = serde_json::json!({
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "listings": listings,
        "origin_product": origin_product,
    });

    let resp = proxy::http_client()
        .post(&url)
        .header("content-type", "application/json")
        .json(&payload)
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|e| format!("Python ranking request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Python ranking returned {status}: {body}"));
    }

    let batch: BatchResponse = resp.json().await
        .map_err(|e| format!("response schema mismatch: {e}"))?;

    Ok(batch)
}

// ── HTML template ──

fn build_compare_html(session_id: &str) -> String {
    format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NirnAI — Your Decision</title>
  <style>
    *, *::before, *::after {{ margin: 0; padding: 0; box-sizing: border-box; }}

    :root {{
      --bg-page: #f5f7fa;
      --bg-card: #ffffff;
      --bg-raised: #f0f2f5;
      --bg-surface: #e8ebf0;
      --border-subtle: #dce0e8;
      --border-hover: #c4c9d4;
      --accent: #6366f1;
      --accent-strong: #4f46e5;
      --accent-glow: rgba(99, 102, 241, 0.08);
      --text-primary: #1a1d2e;
      --text-secondary: #5a6478;
      --text-muted: #8892a4;
      --green: #059669;
      --green-bg: rgba(5, 150, 105, 0.08);
      --green-border: rgba(5, 150, 105, 0.2);
      --orange: #d97706;
      --orange-bg: rgba(217, 119, 6, 0.08);
      --orange-border: rgba(217, 119, 6, 0.2);
      --red: #dc2626;
      --red-bg: rgba(220, 38, 38, 0.08);
      --red-border: rgba(220, 38, 38, 0.2);
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
      --radius-xl: 28px;
    }}

    [data-theme="dark"] {{
      --bg-page: #06080f;
      --bg-card: #0c1017;
      --bg-raised: #111827;
      --bg-surface: #1a2233;
      --border-subtle: #1e293b;
      --border-hover: #334155;
      --accent: #818cf8;
      --accent-strong: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #475569;
      --green: #34d399;
      --green-bg: rgba(52, 211, 153, 0.08);
      --green-border: rgba(52, 211, 153, 0.2);
      --orange: #fbbf24;
      --orange-bg: rgba(251, 191, 36, 0.08);
      --orange-border: rgba(251, 191, 36, 0.2);
      --red: #f87171;
      --red-bg: rgba(248, 113, 113, 0.08);
      --red-border: rgba(248, 113, 113, 0.2);
    }}

    body {{
      background: var(--bg-page);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }}

    /* ── Header ── */
    .header {{
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
      padding: 14px 24px;
      display: flex; align-items: center; gap: 10px;
      position: sticky; top: 0; z-index: 100;
      backdrop-filter: blur(12px);
    }}
    .header .logo {{ font-size: 22px; }}
    .header .brand {{
      font-size: 18px; font-weight: 800;
      background: linear-gradient(135deg, var(--accent), #a78bfa);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }}
    .header .tagline {{
      font-size: 11px; color: var(--text-muted); margin-left: auto;
      letter-spacing: 0.3px;
    }}

    .container {{ max-width: 720px; margin: 0 auto; padding: 28px 20px 60px; }}

    /* ── Loading ── */
    .loading {{
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 100px 0; gap: 24px;
    }}
    .spinner {{
      width: 36px; height: 36px;
      border: 3px solid var(--border-subtle); border-top-color: var(--accent);
      border-radius: 50%; animation: spin 0.7s linear infinite;
    }}
    @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
    .loading p {{ color: var(--text-secondary); font-size: 15px; font-weight: 500; }}
    .loading .sub {{ color: var(--text-muted); font-size: 13px; }}

    .error {{ text-align: center; padding: 80px 0; }}
    .error h2 {{ color: var(--red); margin-bottom: 12px; }}
    .error p {{ color: var(--text-secondary); }}

    /* ── Verdict Bar (top-level decision) ── */
    .verdict-bar {{
      display: flex; align-items: center; gap: 14px;
      padding: 16px 22px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      margin-bottom: 20px;
    }}
    .verdict-icon {{ font-size: 26px; }}
    .verdict-text {{ flex: 1; }}
    .verdict-title {{ font-size: 15px; font-weight: 700; color: var(--text-primary); line-height: 1.3; }}
    .verdict-sub {{ font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }}

    /* ── Hero: #1 Pick ── */
    .hero {{
      position: relative;
      background: var(--bg-card);
      border: 1px solid var(--accent-strong);
      border-radius: var(--radius-xl);
      overflow: hidden;
      margin-bottom: 24px;
      box-shadow: 0 0 60px var(--accent-glow), 0 8px 32px rgba(0,0,0,0.4);
    }}
    .hero-glow {{
      position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }}

    .hero-body {{ padding: 24px; }}

    .hero-top {{ display: flex; gap: 18px; align-items: flex-start; }}
    .hero-image {{
      width: 100px; height: 100px; border-radius: var(--radius-md);
      object-fit: cover; flex-shrink: 0;
      border: 1px solid var(--border-subtle);
    }}
    .hero-content {{ flex: 1; min-width: 0; }}

    .hero-rank-badge {{
      display: inline-flex; align-items: center; gap: 5px;
      background: var(--accent-strong); color: #fff;
      padding: 3px 12px; border-radius: 6px;
      font-size: 10px; font-weight: 800; letter-spacing: 0.8px;
      text-transform: uppercase; margin-bottom: 8px;
    }}
    .hero-title {{
      font-size: 18px; font-weight: 700; line-height: 1.35;
      margin-bottom: 10px;
    }}
    .hero-title a {{ color: var(--text-primary); text-decoration: none; }}
    .hero-title a:hover {{ color: var(--accent); }}

    .hero-meta {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }}
    .meta-chip {{
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 6px;
      font-size: 11px; font-weight: 700;
      border: 1px solid transparent;
    }}
    .chip-price {{ background: var(--bg-surface); color: var(--text-primary); font-size: 15px; font-weight: 800; border-color: var(--border-subtle); }}
    .chip-conf-high   {{ background: var(--green-bg); color: var(--green); border-color: var(--green-border); }}
    .chip-conf-medium {{ background: var(--orange-bg); color: var(--orange); border-color: var(--orange-border); }}
    .chip-conf-low    {{ background: var(--red-bg); color: var(--red); border-color: var(--red-border); }}

    /* Savings */
    .hero-savings {{
      display: flex; align-items: center; gap: 8px;
      margin-top: 16px; padding: 10px 14px;
      background: var(--green-bg);
      border: 1px solid var(--green-border);
      border-radius: var(--radius-sm);
      font-size: 13px; font-weight: 700; color: var(--green);
    }}

    /* Why section */
    .hero-why {{
      margin-top: 16px; padding: 14px 16px;
      background: var(--bg-raised);
      border-radius: var(--radius-md);
      border-left: 3px solid var(--accent);
    }}
    .hero-why-label {{
      font-size: 10px; font-weight: 800; color: var(--accent);
      letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 6px;
    }}
    .hero-why-text {{ font-size: 13px; line-height: 1.55; color: var(--text-secondary); }}

    /* Signals grid */
    .hero-signals {{
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 6px 16px; margin-top: 16px;
    }}
    .signal {{ font-size: 11px; padding: 3px 0; line-height: 1.4; }}
    .sig-good {{ color: var(--green); }}
    .sig-warn {{ color: var(--red); }}

    /* Why not #2 */
    .hero-whynot {{
      margin-top: 16px; padding: 12px 14px;
      background: var(--red-bg);
      border: 1px solid var(--red-border);
      border-radius: var(--radius-sm);
    }}
    .hero-whynot-header {{ font-size: 10px; font-weight: 800; color: var(--red); letter-spacing: 0.5px; margin-bottom: 6px; }}
    .hero-whynot-item {{ font-size: 11px; color: #fca5a5; padding: 2px 0; }}

    /* CTA */
    .hero-cta-row {{
      display: flex; gap: 10px; margin-top: 20px; padding-top: 18px;
      border-top: 1px solid var(--border-subtle); align-items: center;
    }}
    .btn {{
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 11px 24px; border-radius: var(--radius-sm);
      font-size: 13px; font-weight: 700; text-decoration: none;
      cursor: pointer; border: none;
      transition: transform 0.15s, box-shadow 0.15s, background 0.2s;
    }}
    .btn:hover {{ transform: translateY(-1px); }}
    .btn-primary {{
      background: var(--accent-strong); color: #fff;
      box-shadow: 0 4px 16px rgba(99,102,241,0.3);
    }}
    .btn-primary:hover {{ box-shadow: 0 6px 24px rgba(99,102,241,0.45); background: #7c3aed; }}
    .btn-ghost {{
      background: transparent; border: 1px solid var(--border-subtle); color: var(--text-secondary);
      padding: 11px 18px;
    }}
    .btn-ghost:hover {{ border-color: var(--accent); color: var(--accent); }}

    /* ── Score Bar (mini) ── */
    .score-bar-mini {{
      display: flex; align-items: center; gap: 8px;
      margin-top: 14px; padding: 10px 14px;
      background: var(--bg-raised); border-radius: var(--radius-sm);
    }}
    .score-bar-mini .score-label {{ font-size: 10px; font-weight: 700; color: var(--text-muted); min-width: 70px; letter-spacing: 0.3px; }}
    .score-track {{ flex: 1; height: 5px; background: var(--bg-surface); border-radius: 3px; overflow: hidden; }}
    .score-fill {{ height: 100%; border-radius: 3px; transition: width 0.6s ease; }}
    .score-num {{ font-size: 11px; font-weight: 800; min-width: 32px; text-align: right; }}

    /* ── Runners ── */
    .runners-header {{
      font-size: 11px; font-weight: 800; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 1.2px;
      margin-bottom: 12px; padding-left: 2px;
    }}

    .runner {{
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      margin-bottom: 10px;
      padding: 16px 18px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }}
    .runner:hover {{ border-color: var(--border-hover); box-shadow: 0 4px 16px rgba(0,0,0,0.25); }}

    .runner-top {{ display: flex; gap: 12px; align-items: flex-start; }}
    .runner-rank {{
      min-width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-surface); color: var(--text-muted);
      border-radius: 50%; font-size: 12px; font-weight: 800;
      flex-shrink: 0;
    }}
    .runner-image {{
      width: 56px; height: 56px; border-radius: 10px;
      object-fit: cover; flex-shrink: 0;
      border: 1px solid var(--border-subtle);
    }}
    .runner-info {{ flex: 1; min-width: 0; }}
    .runner-title {{
      font-size: 13px; font-weight: 600; line-height: 1.35; margin-bottom: 6px;
    }}
    .runner-title a {{ color: var(--text-secondary); text-decoration: none; }}
    .runner-title a:hover {{ color: var(--accent); }}

    .runner-meta {{
      display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 6px;
    }}
    .badge {{
      padding: 2px 7px; border-radius: 5px;
      font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px;
    }}
    .badge-smart {{ background: var(--green-bg); color: var(--green); border: 1px solid var(--green-border); }}
    .badge-good {{ background: rgba(16,185,129,0.10); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.25); }}
    .badge-check {{ background: var(--orange-bg); color: var(--orange); border: 1px solid var(--orange-border); }}
    .badge-avoid {{ background: var(--red-bg); color: var(--red); border: 1px solid var(--red-border); }}
    .badge-caution {{ background: var(--orange-bg); color: var(--orange); border: 1px solid var(--orange-border); }}
    .runner-price {{ font-size: 13px; color: var(--text-primary); font-weight: 700; }}

    .runner-reason {{ font-size: 11px; color: var(--text-muted); line-height: 1.45; margin-top: 4px; }}

    .runner-cta {{
      align-self: flex-start; flex-shrink: 0; margin-top: 2px;
    }}
    .runner-cta a {{
      display: inline-block; padding: 6px 14px; border-radius: 6px;
      background: var(--bg-surface); border: 1px solid var(--border-subtle);
      color: var(--text-secondary); font-size: 11px; font-weight: 600;
      text-decoration: none; transition: border-color 0.2s, color 0.2s;
    }}
    .runner-cta a:hover {{ border-color: var(--accent); color: var(--accent); }}

    /* ── Score strip in runners ── */
    .runner-scores {{
      display: flex; gap: 12px; margin-top: 8px; padding-top: 8px;
      border-top: 1px solid var(--border-subtle);
    }}
    .runner-score-item {{ display: flex; align-items: center; gap: 5px; }}
    .runner-score-dot {{ width: 7px; height: 7px; border-radius: 50%; }}
    .runner-score-label {{ font-size: 10px; color: var(--text-muted); }}
    .runner-score-val {{ font-size: 10px; font-weight: 800; }}

    /* ── Platform Badges ── */
    .platform-badge {{
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 7px; border-radius: 5px;
      font-size: 9px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.3px;
    }}
    .platform-airbnb  {{ background: #ff385c15; color: #ff385c; border: 1px solid #ff385c30; }}
    .platform-booking  {{ background: #003b9515; color: #5b8def; border: 1px solid #003b9530; }}
    .platform-expedia  {{ background: #fddb3215; color: #fddb32; border: 1px solid #fddb3230; }}
    .platform-vrbo     {{ background: #3c5cff15; color: #6b8aff; border: 1px solid #3c5cff30; }}
    .platform-agoda    {{ background: #5c2d9115; color: #9b70d0; border: 1px solid #5c2d9130; }}
    .platform-hotels   {{ background: #d4111115; color: #ff5050; border: 1px solid #d4111130; }}
    .platform-tripadvisor {{ background: #34e0a115; color: #34e0a1; border: 1px solid #34e0a130; }}
    .platform-googletravel {{ background: #4285f415; color: #4285f4; border: 1px solid #4285f430; }}
    .platform-default  {{ background: #ffffff10; color: #a0a0a0; border: 1px solid #ffffff20; }}
    .platform-amazon   {{ background: #ff990015; color: #ff9900; border: 1px solid #ff990030; }}
    .platform-walmart  {{ background: #0071dc15; color: #5ba3e8; border: 1px solid #0071dc30; }}
    .platform-target   {{ background: #cc000015; color: #ff4444; border: 1px solid #cc000030; }}
    .platform-costco   {{ background: #e31c3d15; color: #f05060; border: 1px solid #e31c3d30; }}
    .platform-bestbuy  {{ background: #0046be15; color: #4d8af0; border: 1px solid #0046be30; }}
    .platform-homedepot {{ background: #f9630215; color: #f96302; border: 1px solid #f9630230; }}
    .platform-lowes     {{ background: #00499015; color: #4d8ac0; border: 1px solid #00499030; }}
    .platform-ebay      {{ background: #e5323815; color: #e53238; border: 1px solid #e5323830; }}
    .platform-wayfair   {{ background: #7b189f15; color: #b060d0; border: 1px solid #7b189f30; }}
    .platform-macys     {{ background: #e2100015; color: #f04040; border: 1px solid #e2100030; }}
    .platform-nordstrom {{ background: #ffffff10; color: #a0a0a0; border: 1px solid #ffffff20; }}
    .platform-cvs       {{ background: #cc000015; color: #ff4444; border: 1px solid #cc000030; }}
    .platform-walgreens {{ background: #32785215; color: #50b080; border: 1px solid #32785230; }}
    .platform-nike      {{ background: #ffffff10; color: #c0c0c0; border: 1px solid #ffffff20; }}
    .platform-apple     {{ background: #ffffff10; color: #a8a8a8; border: 1px solid #ffffff20; }}
    .platform-samsung   {{ background: #1428a015; color: #5060d0; border: 1px solid #1428a030; }}
    .platform-dyson     {{ background: #6b006b15; color: #c060c0; border: 1px solid #6b006b30; }}
    .platform-vrbo      {{ background: #0e47a115; color: #4080d0; border: 1px solid #0e47a130; }}
    .platform-agoda     {{ background: #e0204815; color: #e04060; border: 1px solid #e0204830; }}
    .platform-hotels    {{ background: #d32f2f15; color: #f06060; border: 1px solid #d32f2f30; }}
    .platform-tripadvisor {{ background: #00af8715; color: #00d0a0; border: 1px solid #00af8730; }}
    .platform-googletravel {{ background: #4285f415; color: #60a0f0; border: 1px solid #4285f430; }}
    .platform-default   {{ background: #64748b15; color: #94a3b8; border: 1px solid #64748b30; }}

    /* ── Footer ── */
    .footer {{
      text-align: center; padding: 36px 0 8px;
      font-size: 11px; color: var(--text-muted); letter-spacing: 0.3px;
    }}
    .footer .heart {{ color: var(--accent); }}
    .affiliate-disclosure {{
      text-align: center; padding: 4px 0 16px;
      font-size: 9px; color: var(--text-muted); opacity: 0.7;
    }}

    /* ── Responsive ── */
    @media (max-width: 600px) {{
      .container {{ padding: 16px 12px 80px; }}
      .hero-body {{ padding: 18px; }}
      .hero-top {{ flex-direction: column; gap: 12px; }}
      .hero-image {{ width: 100%; height: 180px; border-radius: var(--radius-md); }}
      .hero-signals {{ grid-template-columns: 1fr; }}
      .runner-top {{ flex-wrap: wrap; }}
      .runner-image {{ width: 48px; height: 48px; }}
      .hero-title {{ font-size: 16px; }}
      .header .tagline {{ display: none; }}
      /* Sticky CTA on mobile */
      .mobile-sticky-cta {{
        position: fixed; bottom: 0; left: 0; right: 0;
        padding: 12px 16px; background: var(--bg-card);
        border-top: 1px solid var(--border-subtle);
        z-index: 100; display: flex; gap: 10px;
        backdrop-filter: blur(12px);
      }}
      .mobile-sticky-cta .btn {{ flex: 1; justify-content: center; }}
    }}
    @media (min-width: 601px) {{
      .mobile-sticky-cta {{ display: none; }}
    }}

    /* ── Light mode overrides for hardcoded elements ── */
    :root .badge-good {{ background: rgba(5,150,105,0.08); color: #047857; border: 1px solid rgba(5,150,105,0.25); }}
    :root .badge-warn {{ background: rgba(217,119,6,0.08); color: #b45309; border: 1px solid rgba(217,119,6,0.25); }}
    :root .platform-default  {{ background: #f0f2f5; color: #6b7280; border: 1px solid #dce0e8; }}
    :root .platform-nordstrom {{ background: #f0f2f5; color: #6b7280; border: 1px solid #dce0e8; }}
    :root .platform-nike      {{ background: #f0f2f5; color: #6b7280; border: 1px solid #dce0e8; }}
    :root .platform-apple     {{ background: #f0f2f5; color: #6b7280; border: 1px solid #dce0e8; }}
    :root .header {{ box-shadow: 0 1px 3px rgba(0,0,0,0.06); }}

    [data-theme="dark"] .badge-good {{ background: rgba(16,185,129,0.10); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.25); }}
    [data-theme="dark"] .badge-warn {{ background: rgba(251,191,36,0.10); color: #fde68a; border: 1px solid rgba(251,191,36,0.25); }}
    [data-theme="dark"] .platform-default  {{ background: #ffffff10; color: #a0a0a0; border: 1px solid #ffffff20; }}
    [data-theme="dark"] .platform-nordstrom {{ background: #ffffff10; color: #a0a0a0; border: 1px solid #ffffff20; }}
    [data-theme="dark"] .platform-nike      {{ background: #ffffff10; color: #c0c0c0; border: 1px solid #ffffff20; }}
    [data-theme="dark"] .platform-apple     {{ background: #ffffff10; color: #a8a8a8; border: 1px solid #ffffff20; }}
    [data-theme="dark"] .header {{ box-shadow: none; }}

    /* ── Light-mode hero shadow ── */
    :root .hero {{ box-shadow: 0 0 40px var(--accent-glow), 0 4px 16px rgba(0,0,0,0.08); }}
    [data-theme="dark"] .hero {{ box-shadow: 0 0 60px var(--accent-glow), 0 8px 32px rgba(0,0,0,0.4); }}

    /* ── Light-mode gradient text fix ── */
    :root .brand {{ -webkit-text-fill-color: transparent; }}
  </style>
</head>
<body>
  <div class="header">
    <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <span class="logo">🛡️</span>
      <span class="brand">NirnAI</span>
    </a>
    <span class="tagline">Clear decisions. Every purchase.</span>
    <button id="theme-toggle" onclick="toggleTheme()" style="background:none;border:1px solid var(--border-subtle);border-radius:8px;padding:4px 10px;cursor:pointer;font-size:16px;color:var(--text-secondary);margin-left:8px;" title="Toggle dark/light mode">🌙</button>
  </div>

  <div class="container" id="app">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <p>Analyzing trust and quality...</p>
      <p class="sub">Checking reviews, reliability, and risk signals across platforms.</p>
    </div>
  </div>

  <script>
    // ── Theme Toggle ──
    function toggleTheme() {{
      const html = document.documentElement;
      const isDark = html.getAttribute('data-theme') === 'dark';
      if (isDark) {{
        html.removeAttribute('data-theme');
        localStorage.setItem('nirnai-theme', 'light');
        document.getElementById('theme-toggle').textContent = '🌙';
      }} else {{
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('nirnai-theme', 'dark');
        document.getElementById('theme-toggle').textContent = '☀️';
      }}
    }}
    // Apply saved theme (default: light)
    (function() {{
      const saved = localStorage.getItem('nirnai-theme');
      if (saved === 'dark') {{
        document.documentElement.setAttribute('data-theme', 'dark');
        const btn = document.getElementById('theme-toggle');
        if (btn) btn.textContent = '☀️';
      }}
    }})();

    const SESSION_ID = "{session_id}";
    const POLL_URL = `/compare/${{SESSION_ID}}/status`;
    const POLL_INTERVAL = 2000;

    function confChip(tier, reviewCount) {{
      const count = reviewCount || 0;
      const map = {{
        high:   {{ text: `${{count}} reviews · High`, cls: "chip-conf-high" }},
        medium: {{ text: `${{count}} reviews · Medium`, cls: "chip-conf-medium" }},
        low:    {{ text: `${{count}} reviews · Low`, cls: "chip-conf-low" }},
      }};
      return map[tier] || map.medium;
    }}

    const TRAVEL_HOSTS = ["airbnb","booking","expedia","vrbo","hotels.com","agoda","tripadvisor","google.com/travel","makemytrip","goibibo","ixigo","cleartrip","yatra","easemytrip"];
    function isTravelUrl(url) {{
      try {{ const h = new URL(url).hostname.toLowerCase(); return TRAVEL_HOSTS.some(t => h.includes(t)); }} catch {{ return false; }}
    }}

    function stampBadge(stamp, label, purchaseScore, trustScore, url, rank) {{
      // Backend label is source of truth: BEST PICK / BUY / CONSIDER / CAUTION / SKIP
      const lbl = (label || "").toUpperCase();

      if (stamp === "AVOID" || lbl === "SKIP") {{
        return `<span class="badge badge-avoid">SKIP</span>`;
      }}
      if (lbl === "CAUTION" || lbl === "NEEDS CAUTION") {{
        return `<span class="badge badge-caution">CAUTION</span>`;
      }}
      if (lbl === "CONSIDER") {{
        return `<span class="badge badge-check">CONSIDER</span>`;
      }}
      if (lbl === "BEST PICK" || (rank === 1 && lbl === "BUY")) {{
        return `<span class="badge badge-smart">BEST PICK</span>`;
      }}
      if (lbl === "BUY") {{
        return `<span class="badge badge-good">BUY</span>`;
      }}
      // Fallback: travel labels (BOOK etc.)
      if (label) {{
        return `<span class="badge badge-good">${{label}}</span>`;
      }}
      return ``;
    }}

    function scoreColor(score) {{
      if (score >= 70) return "var(--green)";
      if (score >= 50) return "var(--orange)";
      return "var(--red)";
    }}

    // Affiliate / monetization: append tracking + affiliate params to outbound URLs
    // so NirnAI gets conversion credit when users click through to platforms.
    const NIRNAI_AFF = {{
      'booking':     '{booking_aff}',
      'amazon':      '{amazon_aff}',
      'expedia':     '{expedia_aff}',
      'hotels.com':  '{hotels_aff}',
      'ebay':        '{ebay_aff}',
      'vrbo':        '{vrbo_aff}',
      'tripadvisor': '{tripadvisor_aff}',
    }};
    // ── Parse search dates/guests from search_context ──
    // Cross-site contexts include: "Dates: 2026-05-25 to 2026-05-28. Guests: 2 adults, 1 children."
    // Also from listings' original URLs or session data.
    let _searchCheckin = "";
    let _searchCheckout = "";
    let _searchAdults = "";
    let _searchChildren = "";
    let _searchGuests = "";
    function parseSearchContext(ctx) {{
      if (!ctx) return;
      const dateMatch = ctx.match(/Dates:\s*(\d{{4}}-\d{{2}}-\d{{2}})\s*to\s*(\d{{4}}-\d{{2}}-\d{{2}})/i);
      if (dateMatch) {{ _searchCheckin = dateMatch[1]; _searchCheckout = dateMatch[2]; }}
      const guestMatch = ctx.match(/Guests:\s*(\d+)\s*adults?/i);
      if (guestMatch) _searchAdults = guestMatch[1];
      const childMatch = ctx.match(/(\d+)\s*children/i);
      if (childMatch) _searchChildren = childMatch[1];
      // Also try "checkin=DATE&checkout=DATE" format from barcode contexts
      const ciMatch = ctx.match(/checkin=(\d{{4}}-\d{{2}}-\d{{2}})/);
      const coMatch = ctx.match(/checkout=(\d{{4}}-\d{{2}}-\d{{2}})/);
      if (ciMatch && !_searchCheckin) _searchCheckin = ciMatch[1];
      if (coMatch && !_searchCheckout) _searchCheckout = coMatch[1];
      const aMatch = ctx.match(/adults=(\d+)/);
      if (aMatch && !_searchAdults) _searchAdults = aMatch[1];
    }}

    // Inject dates/guests into listing URLs so the destination site shows pricing
    function enrichListingUrl(url) {{
      try {{
        const u = new URL(url);
        const h = u.hostname.toLowerCase();
        if (!_searchCheckin) return url; // no dates to inject

        if (h.includes("airbnb")) {{
          if (!u.searchParams.has("check_in") && !u.searchParams.has("checkin")) {{
            u.searchParams.set("check_in", _searchCheckin);
            u.searchParams.set("check_out", _searchCheckout);
          }}
          if (_searchAdults && !u.searchParams.has("adults")) u.searchParams.set("adults", _searchAdults);
          if (_searchChildren && !u.searchParams.has("children")) u.searchParams.set("children", _searchChildren);
        }} else if (h.includes("booking")) {{
          if (!u.searchParams.has("checkin")) {{
            u.searchParams.set("checkin", _searchCheckin);
            u.searchParams.set("checkout", _searchCheckout);
          }}
          if (_searchAdults && !u.searchParams.has("group_adults")) u.searchParams.set("group_adults", _searchAdults);
          if (_searchChildren && !u.searchParams.has("group_children")) u.searchParams.set("group_children", _searchChildren);
        }} else if (h.includes("expedia")) {{
          if (!u.searchParams.has("startDate")) {{
            u.searchParams.set("startDate", _searchCheckin);
            u.searchParams.set("endDate", _searchCheckout);
          }}
          if (_searchAdults && !u.searchParams.has("adults")) u.searchParams.set("adults", _searchAdults);
        }} else if (h.includes("vrbo")) {{
          if (!u.searchParams.has("startDate")) {{
            u.searchParams.set("startDate", _searchCheckin);
            u.searchParams.set("endDate", _searchCheckout);
          }}
          if (_searchAdults && !u.searchParams.has("adults")) u.searchParams.set("adults", _searchAdults);
        }} else if (h.includes("agoda")) {{
          if (!u.searchParams.has("checkIn")) {{
            u.searchParams.set("checkIn", _searchCheckin);
            u.searchParams.set("checkOut", _searchCheckout);
          }}
          if (_searchAdults && !u.searchParams.has("adults")) u.searchParams.set("adults", _searchAdults);
        }} else if (h.includes("hotels.com")) {{
          if (!u.searchParams.has("q-check-in")) {{
            u.searchParams.set("q-check-in", _searchCheckin);
            u.searchParams.set("q-check-out", _searchCheckout);
          }}
        }}
        return u.toString();
      }} catch {{ return url; }}
    }}

    function affiliateUrl(url) {{
      // First enrich with dates/guests, then add affiliate params
      const enriched = enrichListingUrl(url);
      try {{
        const u = new URL(enriched);
        const h = u.hostname.toLowerCase();
        // Booking.com → Awin redirect wrapper (proper affiliate tracking)
        if (h.includes('booking') && NIRNAI_AFF.booking) {{
          u.searchParams.set('utm_source', 'nirnai');
          u.searchParams.set('utm_medium', 'referral');
          return 'https://www.awin1.com/cread.php?awinmid=6776&awinaffid=' + NIRNAI_AFF.booking + '&ued=' + encodeURIComponent(u.toString());
        }}
        if (h.includes('amazon') && NIRNAI_AFF.amazon)        u.searchParams.set('tag', NIRNAI_AFF.amazon);
        if (h.includes('expedia') && NIRNAI_AFF.expedia)      u.searchParams.set('affcid', NIRNAI_AFF.expedia);
        if (h.includes('hotels.com') && NIRNAI_AFF['hotels.com']) u.searchParams.set('rffrid', NIRNAI_AFF['hotels.com']);
        if (h.includes('ebay') && NIRNAI_AFF.ebay) {{
          u.searchParams.set('campid', NIRNAI_AFF.ebay);
          u.searchParams.set('toolid', '10001');
          u.searchParams.set('customid', 'nirnai');
        }}
        if (h.includes('vrbo') && NIRNAI_AFF.vrbo)            u.searchParams.set('affid', NIRNAI_AFF.vrbo);
        if (h.includes('tripadvisor') && NIRNAI_AFF.tripadvisor) u.searchParams.set('CampaignId', NIRNAI_AFF.tripadvisor);
        u.searchParams.set('utm_source', 'nirnai');
        u.searchParams.set('utm_medium', 'referral');
        return u.toString();
      }} catch {{ return url; }}
    }}

    // ── Click tracking ──
    function detectPlatform(url) {{
      try {{
        const h = new URL(url).hostname.toLowerCase();
        if (h.includes('booking')) return 'booking';
        if (h.includes('airbnb')) return 'airbnb';
        if (h.includes('expedia')) return 'expedia';
        if (h.includes('vrbo')) return 'vrbo';
        if (h.includes('hotels.com')) return 'hotels';
        if (h.includes('agoda')) return 'agoda';
        if (h.includes('tripadvisor')) return 'tripadvisor';
        if (h.includes('amazon')) return 'amazon';
        if (h.includes('awin1.com')) return 'booking'; // Awin redirect
        return h;
      }} catch {{ return ''; }}
    }}
    function hasAffiliate(url) {{
      return url.includes('awin1.com') || url.includes('aid=') || url.includes('tag=') ||
             url.includes('affcid=') || url.includes('rffrid=') || url.includes('campid=') ||
             url.includes('affid=') || url.includes('CampaignId=');
    }}
    document.addEventListener('click', function(e) {{
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.href;
      // Only track outbound links (not same-page anchors)
      if (!href.startsWith('http') || href.includes(window.location.hostname)) return;
      // Find listing rank if available
      const card = a.closest('.runner, .hero');
      const rankEl = card && card.querySelector('[data-rank]');
      const rank = rankEl ? parseInt(rankEl.dataset.rank) : (card && card.classList.contains('hero') ? 1 : null);
      const titleEl = card && card.querySelector('.hero-title a, .runner-title a');
      const title = titleEl ? titleEl.textContent.trim() : '';
      // Fire and forget
      fetch('/track/click', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          session_id: SESSION_ID,
          url: href,
          platform: detectPlatform(href),
          listing_title: title,
          listing_rank: rank,
          is_affiliate: hasAffiliate(href),
        }}),
      }}).catch(() => {{}});
    }});

    function parsePriceNum(s) {{
      if (!s) return null;
      const m = s.replace(/,/g, "").match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : null;
    }}

    function parseCurrencySymbol(s) {{
      if (!s) return '$';
      const m = s.match(/^([₹$€£¥฿₩]|A\$|C\$|S\$|HK\$|NZ\$|R\$|MX\$|د\.إ)/);
      return m ? m[1] : '$';
    }}

    function ctaText(listing, savings, sym) {{
      const cs = sym || '$';
      let site = "View listing";
      try {{
        const h = new URL(listing.url).hostname;
        const p = new URL(listing.url).pathname;
        if (h.includes("airbnb"))  site = "Book on Airbnb";
        if (h.includes("booking")) site = "Book on Booking.com";
        if (h.includes("expedia")) site = "Book on Expedia";
        if (h.includes("amazon"))  site = "View on Amazon";
        if (h.includes("walmart")) site = "View on Walmart";
        if (h.includes("target"))  site = "View on Target";
        if (h.includes("costco"))  site = "View on Costco";
        if (h.includes("bestbuy")) site = "View on Best Buy";
        if (h.includes("homedepot")) site = "View on Home Depot";
        if (h.includes("lowes"))     site = "View on Lowe's";
        if (h.includes("ebay"))      site = "View on eBay";
        if (h.includes("wayfair"))   site = "View on Wayfair";
        if (h.includes("macys"))     site = "View on Macy's";
        if (h.includes("nordstrom")) site = "View on Nordstrom";
        if (h.includes("cvs"))       site = "View on CVS";
        if (h.includes("walgreens")) site = "View on Walgreens";
        if (h.includes("nike"))      site = "View on Nike";
        if (h.includes("apple"))     site = "View on Apple";
        if (h.includes("samsung"))   site = "View on Samsung";
        if (h.includes("dyson"))     site = "View on Dyson";
        if (h.includes("vrbo"))      site = "Book on Vrbo";
        if (h.includes("agoda"))     site = "Book on Agoda";
        if (h.includes("hotels.com")) site = "Book on Hotels.com";
        if (h.includes("tripadvisor")) site = "Book on Tripadvisor";
        if (h.includes("google.com") && p.includes("/travel")) site = "View on Google Travel";
        if (h.includes("makemytrip")) site = "Book on MakeMyTrip";
        if (h.includes("goibibo"))    site = "Book on Goibibo";
        if (h.includes("ixigo"))      site = "Book on Ixigo";
        if (h.includes("cleartrip"))  site = "Book on Cleartrip";
        if (h.includes("yatra"))      site = "Book on Yatra";
        if (h.includes("easemytrip")) site = "Book on EaseMyTrip";
      }} catch {{}}
      if (savings > 0) return `${{site}} — Safe Choice`;
      return site;
    }}

    function platformBadge(url) {{
      try {{
        const h = new URL(url).hostname.toLowerCase();
        const p = new URL(url).pathname;
        if (h.includes("airbnb"))  return `<span class="platform-badge platform-airbnb">Airbnb</span>`;
        if (h.includes("booking")) return `<span class="platform-badge platform-booking">Booking</span>`;
        if (h.includes("expedia")) return `<span class="platform-badge platform-expedia">Expedia</span>`;
        if (h.includes("amazon"))  return `<span class="platform-badge platform-amazon">Amazon</span>`;
        if (h.includes("walmart")) return `<span class="platform-badge platform-walmart">Walmart</span>`;
        if (h.includes("target"))  return `<span class="platform-badge platform-target">Target</span>`;
        if (h.includes("costco"))  return `<span class="platform-badge platform-costco">Costco</span>`;
        if (h.includes("bestbuy")) return `<span class="platform-badge platform-bestbuy">Best Buy</span>`;
        if (h.includes("homedepot")) return `<span class="platform-badge platform-homedepot">Home Depot</span>`;
        if (h.includes("lowes"))     return `<span class="platform-badge platform-lowes">Lowe's</span>`;
        if (h.includes("ebay"))      return `<span class="platform-badge platform-ebay">eBay</span>`;
        if (h.includes("wayfair"))   return `<span class="platform-badge platform-wayfair">Wayfair</span>`;
        if (h.includes("macys"))     return `<span class="platform-badge platform-macys">Macy's</span>`;
        if (h.includes("nordstrom")) return `<span class="platform-badge platform-nordstrom">Nordstrom</span>`;
        if (h.includes("cvs"))       return `<span class="platform-badge platform-cvs">CVS</span>`;
        if (h.includes("walgreens")) return `<span class="platform-badge platform-walgreens">Walgreens</span>`;
        if (h.includes("nike"))      return `<span class="platform-badge platform-nike">Nike</span>`;
        if (h.includes("apple"))     return `<span class="platform-badge platform-apple">Apple</span>`;
        if (h.includes("samsung"))   return `<span class="platform-badge platform-samsung">Samsung</span>`;
        if (h.includes("dyson"))     return `<span class="platform-badge platform-dyson">Dyson</span>`;
        if (h.includes("vrbo"))      return `<span class="platform-badge platform-vrbo">Vrbo</span>`;
        if (h.includes("agoda"))     return `<span class="platform-badge platform-agoda">Agoda</span>`;
        if (h.includes("hotels.com")) return `<span class="platform-badge platform-hotels">Hotels.com</span>`;
        if (h.includes("tripadvisor")) return `<span class="platform-badge platform-tripadvisor">Tripadvisor</span>`;
        if (h.includes("google.com") && p.includes("/travel")) return `<span class="platform-badge platform-googletravel">Google Travel</span>`;
      }} catch {{}}
      return `<span class="platform-badge platform-default">Web</span>`;
    }}

    function miniScoreBar(label, score) {{
      const color = scoreColor(score);
      return `<div class="score-bar-mini">
        <span class="score-label">${{label}}</span>
        <div class="score-track"><div class="score-fill" style="width:${{score}}%;background:${{color}};"></div></div>
        <span class="score-num" style="color:${{color}}">${{score}}</span>
      </div>`;
    }}

    function renderResults(data) {{
      // Parse dates/guests from search context so listing URLs carry them
      parseSearchContext(data.search_context || "");
      // Also try to extract from the original listings' URLs
      if (!_searchCheckin && data.listings) {{
        for (const l of data.listings) {{
          try {{
            const u = new URL(l.url || "");
            const ci = u.searchParams.get("check_in") || u.searchParams.get("checkin") || "";
            const co = u.searchParams.get("check_out") || u.searchParams.get("checkout") || "";
            if (ci && co) {{ _searchCheckin = ci; _searchCheckout = co; break; }}
          }} catch {{}}
        }}
      }}
      if (!_searchAdults && data.listings) {{
        for (const l of data.listings) {{
          try {{
            const u = new URL(l.url || "");
            const a = u.searchParams.get("adults") || u.searchParams.get("group_adults") || "";
            if (a) {{ _searchAdults = a; break; }}
          }} catch {{}}
        }}
      }}

      const app = document.getElementById("app");
      const batch = data.result;
      const ranked = batch.ranked || [];
      if (ranked.length === 0) {{ app.innerHTML = `<div class="error"><h2>No results</h2></div>`; return; }}

      const top = ranked[0];
      const runners = ranked.slice(1);

      // Normalize currency display: remove trailing codes when symbol present
      const normalizePrice = (price) => {{
        if (!price) return '';
        const p = price.toString().trim();
        const cleaned = p.replace(/\s*(USD|EUR|GBP|INR|AUD|CAD|SGD|JPY|THB|AED|MYR|IDR|PHP|VND|KRW|CNY|HKD|TWD|NZD|ZAR|BRL|MXN|COP|CLP|PEN|ARS)$/i, '').trim();
        const codeMatch = p.match(/(USD|EUR|GBP|INR|AUD|CAD|SGD|JPY|THB|AED|MYR|IDR|PHP|VND|KRW|CNY|HKD|TWD|NZD|ZAR|BRL|MXN|COP|CLP|PEN|ARS)$/i);
        if (codeMatch && /^[\d,.]/.test(cleaned)) {{
          const symbols = {{ USD:'$',EUR:'€',GBP:'£',INR:'₹',AUD:'A$',CAD:'C$',SGD:'S$',JPY:'¥',THB:'฿',AED:'د.إ',CNY:'¥',HKD:'HK$',NZD:'NZ$',BRL:'R$',MXN:'MX$',KRW:'₩' }};
          const sym = symbols[codeMatch[1].toUpperCase()] || codeMatch[1] + ' ';
          return sym + cleaned;
        }}
        if (/^[₹$€£¥฿₩]/.test(cleaned) || /^(A\$|C\$|S\$|HK\$|NZ\$|R\$|MX\$)/.test(cleaned)) return cleaned;
        return cleaned;
      }};

      const topPrice = parsePriceNum(top.price);
      const r2Price = runners.length > 0 ? parsePriceNum(runners[0].price) : null;
      const savings = (topPrice !== null && r2Price !== null && r2Price > topPrice) ? (r2Price - topPrice) : 0;
      const currSym = parseCurrencySymbol(top.price);

      const conf = confChip(
        top.confidence_tier,
        top.review_trust?.review_count || top.review_trust?.trust_score
      );

      let html = "";

      // ═══ ORIGIN IS BEST — user's product beats all alternatives ═══
      if (batch.origin_is_best && batch.origin_title) {{
        html += `<div class="verdict-bar">
          <div class="verdict-icon">🏆</div>
          <div class="verdict-text">
            <div class="verdict-title">Your pick is the best option.</div>
            <div class="verdict-sub">We compared ${{ranked.length}} alternative${{ranked.length !== 1 ? "s" : ""}} across platforms — none scored higher.</div>
          </div>
        </div>`;

        html += `<div class="hero"><div class="hero-glow"></div><div class="hero-body">`;
        html += `<div class="hero-top"><div class="hero-content">`;
        html += `<span class="badge badge-smart">YOUR BEST PICK</span>`;
        if (batch.origin_url) html += platformBadge(batch.origin_url);
        html += `<div class="hero-title"><a href="${{batch.origin_url || "#"}}" target="_blank" rel="noopener">${{batch.origin_title}}</a></div>`;
        html += `<div class="hero-meta">`;
        if (batch.origin_price) html += `<span class="meta-chip chip-price">${{normalizePrice(batch.origin_price)}}</span>`;
        html += `</div></div></div>`;

        html += miniScoreBar("Purchase", batch.origin_purchase_score);
        html += miniScoreBar("Trust", batch.origin_trust_score);

        html += `<div class="hero-savings" style="background:rgba(34,197,94,0.12);border-color:rgba(34,197,94,0.3)">
          ✅ We looked across multiple platforms and your product scores higher than every alternative we found. You can confidently go with your original choice.
        </div>`;

        html += `<div class="hero-cta-row">
          <a class="btn btn-primary" href="${{affiliateUrl(batch.origin_url || "#")}}" target="_blank" rel="noopener">Buy Your Pick — Best Choice</a>
        </div>`;
        html += `</div></div>`;

        // Show the alternatives we checked (demoted)
        if (ranked.length > 0) {{
          html += `<div class="runners-header">Alternatives we checked</div>`;
          for (const listing of ranked) {{
            const rConf = confChip(
              listing.confidence_tier,
              listing.review_trust?.review_count || listing.review_trust?.trust_score
            );
            const psc = scoreColor(listing.purchase_score);

            html += `<div class="runner"><div class="runner-top">`;
            html += `<div class="runner-rank">${{listing.rank}}</div>`;
            if (listing.image_url) html += `<img class="runner-image" src="${{listing.image_url}}" alt="" loading="lazy">`;
            html += `<div class="runner-info">`;
            html += `<div class="runner-title"><a href="${{affiliateUrl(listing.url)}}" target="_blank" rel="noopener">${{listing.title}}</a></div>`;
            html += `<div class="runner-meta">`;
            html += stampBadge(listing.stamp?.stamp, listing.stamp?.label, listing.purchase_score, listing.review_trust?.trust_score, listing.url, listing.rank);
            html += platformBadge(listing.url);
            if (listing.price) html += `<span class="runner-price">${{normalizePrice(listing.price)}}</span>`;
            html += `</div>`;
            if (listing.why_ranked) html += `<div class="runner-reason">${{listing.why_ranked}}</div>`;
            html += `</div>`;
            const altAction = (listing.domain === "hospitality") ? "Book" : "View";
            html += `<div class="runner-cta"><a href="${{affiliateUrl(listing.url)}}" target="_blank" rel="noopener">${{altAction}} →</a></div>`;
            html += `</div>`;

            html += `<div class="runner-scores">`;
            html += `<div class="runner-score-item">
              <div class="runner-score-dot" style="background:${{psc}}"></div>
              <span class="runner-score-label">Purchase</span>
              <span class="runner-score-val" style="color:${{psc}}">${{listing.purchase_score}}</span>
            </div>`;
            html += `<div class="runner-score-item">
              <div class="runner-score-dot" style="background:${{scoreColor(listing.review_trust?.trust_score || 0)}}"></div>
              <span class="runner-score-label">Trust</span>
              <span class="runner-score-val" style="color:${{scoreColor(listing.review_trust?.trust_score || 0)}}">${{listing.review_trust?.trust_score || "—"}}</span>
            </div>`;
            html += `<div class="runner-score-item">
              <span class="runner-score-label meta-chip ${{rConf.cls}}" style="padding:1px 6px;font-size:9px;">${{rConf.text}}</span>
            </div>`;
            html += `</div>`;

            html += `</div>`;
          }}
        }}

        app.innerHTML = html;
        return;
      }}

      // ═══ VERDICT BAR ═══
      html += `<div class="verdict-bar">
        <div class="verdict-icon">🏆</div>
        <div class="verdict-text">
          <div class="verdict-title">${{batch.comparison_summary ? batch.comparison_summary.split(".")[0] + "." : "We found your best option."}}</div>
          <div class="verdict-sub">Ranked ${{ranked.length}} options across platforms${{savings > 0 ? ` · ${{currSym}}${{Math.round(savings)}} less than next option` : ""}}</div>
        </div>
      </div>`;

      // ═══ HERO CARD ═══
      html += `<div class="hero"><div class="hero-glow"></div><div class="hero-body">`;

      // Use the actual stamp from Python scoring, not hardcoded "Best Pick"
      const heroLabel = (top.stamp?.label || "").toUpperCase();
      const heroRankText = (heroLabel === "BEST PICK" || heroLabel === "BUY")
        ? `#1 ${{top.stamp?.label || "Best Pick"}}`
        : `#1 ${{top.stamp?.label || "Ranked"}}`;

      html += `<div class="hero-top">`;
      if (top.image_url) html += `<img class="hero-image" src="${{top.image_url}}" alt="" loading="lazy">`;
      html += `<div class="hero-content">`;
      html += stampBadge(top.stamp?.stamp, top.stamp?.label, top.purchase_score, top.review_trust?.trust_score, top.url, top.rank);
      html += platformBadge(top.url);
      html += `<div class="hero-title"><a href="${{top.url}}" target="_blank" rel="noopener">${{top.title}}</a></div>`;
      html += `<div class="hero-meta">`;
      if (top.price) html += `<span class="meta-chip chip-price">${{normalizePrice(top.price)}}</span>`;
      html += `<span class="meta-chip ${{conf.cls}}">${{conf.text}}</span>`;
      html += `</div></div></div>`; // meta, content, top

      // Confidence indicator — only show when #1 actually earns it
      // (good stamp AND cheaper than #2)
      if (savings > 0 && (heroLabel === "BEST PICK" || heroLabel === "BUY")) {{
        html += `<div class="hero-savings">🛡️ High confidence — most reliable option in this comparison</div>`;
      }}

      // Origin baseline comparison — show when ranking alternatives
      if (batch.origin_purchase_score > 0 && batch.origin_trust_score > 0) {{
        const betterPurchase = top.purchase_score >= batch.origin_purchase_score;
        const betterTrust = (top.review_trust?.trust_score || 0) >= batch.origin_trust_score;
        if (betterPurchase && betterTrust) {{
          html += `<div class="hero-savings" style="background:rgba(34,197,94,0.12);border-color:rgba(34,197,94,0.3)">✅ Scores higher than your current product (Purchase ${{batch.origin_purchase_score}}, Trust ${{batch.origin_trust_score}})</div>`;
        }} else if (betterPurchase || betterTrust) {{
          html += `<div class="hero-savings" style="background:rgba(234,179,8,0.12);border-color:rgba(234,179,8,0.3)">⚖️ Mixed vs your current product (Purchase ${{batch.origin_purchase_score}}, Trust ${{batch.origin_trust_score}}) — check the tradeoffs</div>`;
        }} else {{
          html += `<div class="hero-savings" style="background:rgba(239,68,68,0.12);border-color:rgba(239,68,68,0.3)">📌 Your current product scores higher (Purchase ${{batch.origin_purchase_score}}, Trust ${{batch.origin_trust_score}}) — consider sticking with it</div>`;
        }}
      }}

      // Score bars
      html += miniScoreBar("Purchase", top.purchase_score);
      if (top.review_trust?.trust_score) html += miniScoreBar("Trust", top.review_trust.trust_score);
      if (top.health_score > 0) html += miniScoreBar("Health", top.health_score);

      // Why #1
      if (top.why_ranked) {{
        html += `<div class="hero-why">
          <div class="hero-why-label">Why This One</div>
          <div class="hero-why-text">${{top.why_ranked}}</div>
        </div>`;
      }}

      // Signals
      const positives = (top.positives || []).slice(0, 4);
      const warnings = (top.warnings || []).slice(0, 3);
      if (positives.length || warnings.length) {{
        html += `<div class="hero-signals">`;
        positives.forEach(p => {{ html += `<div class="signal sig-good">✓ ${{p}}</div>`; }});
        warnings.forEach(w => {{ html += `<div class="signal sig-warn">⚠ ${{w}}</div>`; }});
        html += `</div>`;
      }}

      // Why not #2
      if (runners.length > 0) {{
        const r2 = runners[0];
        const items = [];
        if (savings > 0) items.push(`Lower trust score`);
        (r2.warnings || []).slice(0, 2).forEach(w => items.push(w));
        if (items.length === 0 && r2.tradeoffs?.length) items.push(r2.tradeoffs[0]);
        if (items.length > 0) {{
          const name = r2.title.length > 35 ? r2.title.slice(0, 32) + "…" : r2.title;
          html += `<div class="hero-whynot">
            <div class="hero-whynot-header">Why not #2: ${{name}}</div>
            ${{items.map(i => `<div class="hero-whynot-item">✕ ${{i}}</div>`).join("")}}
          </div>`;
        }}
      }}

      // CTA
      html += `<div class="hero-cta-row">
        <a class="btn btn-primary" href="${{affiliateUrl(top.url)}}" target="_blank" rel="noopener">${{ctaText(top, savings, currSym)}}</a>
      </div>`;

      html += `</div></div>`; // hero-body, hero

      // ═══ RUNNERS ═══
      if (runners.length > 0) {{
        html += `<div class="runners-header">Other options</div>`;
        for (const listing of runners) {{
          const rConf = confChip(
            listing.confidence_tier,
            listing.review_trust?.review_count || listing.review_trust?.trust_score
          );
          const psc = scoreColor(listing.purchase_score);

          html += `<div class="runner"><div class="runner-top">`;
          html += `<div class="runner-rank">${{listing.rank}}</div>`;
          if (listing.image_url) html += `<img class="runner-image" src="${{listing.image_url}}" alt="" loading="lazy">`;
          html += `<div class="runner-info">`;
          html += `<div class="runner-title"><a href="${{affiliateUrl(listing.url)}}" target="_blank" rel="noopener">${{listing.title}}</a></div>`;
          html += `<div class="runner-meta">`;
          html += stampBadge(listing.stamp?.stamp, listing.stamp?.label, listing.purchase_score, listing.review_trust?.trust_score, listing.url, listing.rank);
          html += platformBadge(listing.url);
          if (listing.price) html += `<span class="runner-price">${{normalizePrice(listing.price)}}</span>`;
          html += `</div>`;
          if (listing.why_ranked) html += `<div class="runner-reason">${{listing.why_ranked}}</div>`;
          html += `</div>`; // runner-info
          const runnerAction = (listing.domain === "hospitality") ? "Book" : "Buy";
          html += `<div class="runner-cta"><a href="${{affiliateUrl(listing.url)}}" target="_blank" rel="noopener">${{runnerAction}} →</a></div>`;
          html += `</div>`; // runner-top

          // Score strip
          html += `<div class="runner-scores">`;
          html += `<div class="runner-score-item">
            <div class="runner-score-dot" style="background:${{psc}}"></div>
            <span class="runner-score-label">Purchase</span>
            <span class="runner-score-val" style="color:${{psc}}">${{listing.purchase_score}}</span>
          </div>`;
          html += `<div class="runner-score-item">
            <div class="runner-score-dot" style="background:${{scoreColor(listing.review_trust?.trust_score || 0)}}"></div>
            <span class="runner-score-label">Trust</span>
            <span class="runner-score-val" style="color:${{scoreColor(listing.review_trust?.trust_score || 0)}}">${{listing.review_trust?.trust_score || "—"}}</span>
          </div>`;
          html += `<div class="runner-score-item">
            <span class="runner-score-label meta-chip ${{rConf.cls}}" style="padding:1px 6px;font-size:9px;">${{rConf.text}}</span>
          </div>`;
          html += `</div>`; // runner-scores

          html += `</div>`; // runner
        }}
      }}

      // Mobile sticky CTA
      html += `<div class="mobile-sticky-cta">
        <a class="btn btn-primary" href="${{affiliateUrl(top.url)}}" target="_blank" rel="noopener">${{ctaText(top, savings, currSym)}}</a>
      </div>`;

      html += `<div class="footer">NirnAI <span class="heart">·</span> Clear decisions. Every purchase.</div>`;
      html += `<div style="text-align:center;margin-top:8px;font-size:11px;"><a href="/privacy" style="color:#7eb8da;text-decoration:none;">Privacy Policy</a> · <a href="/support" style="color:#7eb8da;text-decoration:none;">Support</a></div>`;
      html += `<div class="affiliate-disclosure">As an Amazon Associate and affiliate partner, NirnAI earns from qualifying purchases. This does not affect our rankings or recommendations.</div>`;
      app.innerHTML = html;
    }}

    function renderError(message) {{
      document.getElementById("app").innerHTML = `
        <div class="error">
          <h2>Analysis Failed</h2>
          <p>${{message || "Something went wrong. Please try again."}}</p>
        </div>
      `;
    }}

    async function poll() {{
      try {{
        const res = await fetch(POLL_URL);
        if (!res.ok) {{ renderError("Session not found"); return; }}
        const data = await res.json();

        if (data.status === "done") {{
          renderResults(data);
        }} else if (data.status === "error") {{
          renderError(data.error);
        }} else {{
          setTimeout(poll, POLL_INTERVAL);
        }}
      }} catch (err) {{
        renderError("Could not connect to NirnAI server.");
      }}
    }}

    poll();
  </script>
</body>
</html>"##,
        session_id = session_id,
        booking_aff = std::env::var("NIRNAI_AFF_BOOKING").unwrap_or_default(),
        amazon_aff = std::env::var("NIRNAI_AFF_AMAZON").unwrap_or_default(),
        expedia_aff = std::env::var("NIRNAI_AFF_EXPEDIA").unwrap_or_default(),
        hotels_aff = std::env::var("NIRNAI_AFF_HOTELS").unwrap_or_default(),
        ebay_aff = std::env::var("NIRNAI_AFF_EBAY").unwrap_or_default(),
        vrbo_aff = std::env::var("NIRNAI_AFF_VRBO").unwrap_or_default(),
        tripadvisor_aff = std::env::var("NIRNAI_AFF_TRIPADVISOR").unwrap_or_default(),
    )
}

// ── Inventory-aware wrapper for /analyze ──

/// POST /analyze — wraps nirnai::analyze_product and saves green-stamp results to inventory
pub async fn analyze_with_inventory(
    State(state): State<NirnaiState>,
    Json(product): Json<ProductData>,
) -> Result<Json<nirnai::AnalysisResponse>, (StatusCode, Json<serde_json::Value>)> {
    let result = nirnai::analyze_product(Json(product.clone())).await?;

    // Save green-stamp products (purchase_score >= 75) to inventory as NirnAI-verified
    if result.purchase_score >= 75 {
        if let Err(e) = state.inventory.save_verified_listing(&product, &result).await {
            tracing::warn!("Failed to save verified listing to inventory: {e}");
        }
    }

    Ok(result)
}
