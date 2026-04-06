use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::nirnai::{AnalysisResponse, ProductData, RankedListing};

// ── Types ──

pub type Inventory = Arc<std::sync::Mutex<InventoryDb>>;

pub struct InventoryDb {
    conn: Connection,
}

#[derive(Debug, Serialize)]
pub struct InventoryListing {
    pub id: i64,
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

        // Format: "Tampa, FL (2-mile search radius, urban density)"
        if let Some(paren_start) = line.find('(') {
            ctx.destination = line[..paren_start].trim().to_string();
            let paren_content = &line[paren_start + 1..];

            // Parse radius: "2-mile search radius"
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

            // Parse area type: "urban density" / "dense_urban density" etc.
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

    // If no destination from AREA CONTEXT, try other formats
    if ctx.destination.is_empty() {
        // Cross-site format: "Cross-site search for Tampa, FL (urban, ~3mi radius). Dates: ..."
        if let Some(idx) = search_context.find("Cross-site search for ") {
            let rest = &search_context[idx + "Cross-site search for ".len()..];
            // Destination ends at '(' or '.' whichever comes first
            let end = rest
                .find('(')
                .unwrap_or_else(|| rest.find('.').unwrap_or(rest.len()));
            let dest = rest[..end].trim().to_string();
            if !dest.is_empty() && dest != "this area" {
                ctx.destination = dest;
            }

            // Parse area type and radius from parenthesized portion
            if let Some(paren_start) = rest.find('(') {
                if let Some(paren_end) = rest[paren_start..].find(')') {
                    let paren = &rest[paren_start + 1..paren_start + paren_end];
                    // "urban, ~3mi radius"
                    let area_types = ["dense_urban", "urban", "suburban", "resort", "rural"];
                    for at in area_types {
                        if paren.contains(at) {
                            ctx.area_type = Some(at.to_string());
                            break;
                        }
                    }
                    if let Some(mi_idx) = paren.find("mi") {
                        // find digits/dot before "mi"
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
        }
        // Fallback: "SEARCH CONTEXT:" line
        else if let Some(idx) = search_context.find("SEARCH CONTEXT:") {
            let rest = &search_context[idx + "SEARCH CONTEXT:".len()..];
            let line = rest.lines().next().unwrap_or("").trim();
            ctx.destination = line.to_string();
        }
    }

    // Parse coordinates: "Coordinates: 27.9506,-82.4572"
    if ctx.lat.is_none() {
        if let Some(idx) = search_context.find("Coordinates: ") {
            let rest = &search_context[idx + "Coordinates: ".len()..];
            let coord_str = rest.lines().next().unwrap_or("").trim();
            // Remove trailing period
            let coord_str = coord_str.trim_end_matches('.');
            if let Some(comma) = coord_str.find(',') {
                let lat_str = coord_str[..comma].trim();
                let lng_str = coord_str[comma + 1..].trim();
                // Stop at first non-numeric character after the number
                let lng_str = lng_str.split_whitespace().next().unwrap_or(lng_str);
                ctx.lat = lat_str.parse().ok();
                ctx.lng = lng_str.parse().ok();
            }
        }
    }

    ctx
}

// ── Database ──

pub fn new_inventory() -> Result<Inventory, String> {
    let db = InventoryDb::open()?;
    Ok(Arc::new(std::sync::Mutex::new(db)))
}

impl InventoryDb {
    fn open() -> Result<Self, String> {
        let conn = Connection::open("nirnai_inventory.db")
            .map_err(|e| format!("SQLite open error: {e}"))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ranked_listings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                rank INTEGER NOT NULL,
                title TEXT NOT NULL,
                price TEXT NOT NULL,
                url TEXT NOT NULL,
                image_url TEXT NOT NULL,
                platform TEXT NOT NULL,
                destination TEXT NOT NULL,
                lat REAL,
                lng REAL,
                area_type TEXT,
                radius_miles REAL,
                purchase_score INTEGER NOT NULL,
                health_score INTEGER NOT NULL,
                confidence_tier TEXT NOT NULL,
                decision TEXT NOT NULL,
                why_ranked TEXT NOT NULL,
                positives TEXT NOT NULL,
                warnings TEXT NOT NULL,
                tradeoffs TEXT NOT NULL,
                comparison_summary TEXT NOT NULL,
                ranked_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_listings_destination
                ON ranked_listings(destination);
            CREATE INDEX IF NOT EXISTS idx_listings_geo
                ON ranked_listings(lat, lng);
            CREATE INDEX IF NOT EXISTS idx_listings_ranked_at
                ON ranked_listings(ranked_at);",
        )
        .map_err(|e| format!("SQLite init error: {e}"))?;

        Ok(Self { conn })
    }

    pub fn save_rankings(
        &self,
        session_id: &str,
        ranked: &[RankedListing],
        comparison_summary: &str,
        geo: &GeoContext,
    ) -> Result<usize, String> {
        let mut count = 0;
        for listing in ranked {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO ranked_listings
                     (session_id, rank, title, price, url, image_url, platform,
                      destination, lat, lng, area_type, radius_miles,
                      purchase_score, health_score, confidence_tier, decision,
                      why_ranked, positives, warnings, tradeoffs, comparison_summary)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                             ?8, ?9, ?10, ?11, ?12,
                             ?13, ?14, ?15, ?16,
                             ?17, ?18, ?19, ?20, ?21)",
                    params![
                        session_id,
                        listing.rank,
                        listing.title,
                        listing.price,
                        listing.url,
                        listing.image_url,
                        geo.platform,
                        geo.destination,
                        geo.lat,
                        geo.lng,
                        geo.area_type,
                        geo.radius_miles,
                        listing.purchase_score,
                        listing.health_score,
                        listing.confidence_tier,
                        listing.decision,
                        listing.why_ranked,
                        serde_json::to_string(&listing.positives).unwrap_or_default(),
                        serde_json::to_string(&listing.warnings).unwrap_or_default(),
                        serde_json::to_string(&listing.tradeoffs).unwrap_or_default(),
                        comparison_summary,
                    ],
                )
                .map_err(|e| format!("SQLite insert error: {e}"))?;
            count += 1;
        }
        Ok(count)
    }

    /// Save a single product that scored green (BOOK IT / Smart Buy).
    /// Only called when purchase_score >= 75, making it "NirnAI-verified."
    pub fn save_verified_listing(
        &self,
        product: &ProductData,
        analysis: &AnalysisResponse,
    ) -> Result<(), String> {
        // Extract destination from barcode (used as search context in travel extractors)
        let destination = if !product.barcode.is_empty() {
            // barcode often contains "Tampa, FL | 2 guests | May 26-28" style context
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

        self.conn
            .execute(
                "INSERT OR IGNORE INTO ranked_listings
                 (session_id, rank, title, price, url, image_url, platform,
                  destination, lat, lng, area_type, radius_miles,
                  purchase_score, health_score, confidence_tier, decision,
                  why_ranked, positives, warnings, tradeoffs, comparison_summary)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                         ?8, ?9, ?10, ?11, ?12,
                         ?13, ?14, ?15, ?16,
                         ?17, ?18, ?19, ?20, ?21)",
                params![
                    format!("verified-{}", uuid::Uuid::new_v4()),
                    1, // rank 1 — standalone verified listing
                    product.title,
                    product.price,
                    product.url,
                    product.image_url,
                    product.source_site,
                    destination,
                    Option::<f64>::None, // lat — not available from single analysis
                    Option::<f64>::None, // lng
                    Option::<String>::None, // area_type
                    Option::<f64>::None, // radius_miles
                    analysis.purchase_score,
                    analysis.health_score,
                    confidence_tier,
                    analysis.decision,
                    analysis.summary,
                    serde_json::to_string(&analysis.positives).unwrap_or_default(),
                    serde_json::to_string(&analysis.warnings).unwrap_or_default(),
                    "[]", // no tradeoffs for single listing
                    format!("NirnAI-verified: {}", analysis.stamp.label),
                ],
            )
            .map_err(|e| format!("SQLite insert error: {e}"))?;

        Ok(())
    }

    pub fn search_listings(
        &self,
        params: &SearchParams,
    ) -> Result<Vec<InventoryListing>, String> {
        // Geo-bounded search
        if let (Some(lat), Some(lng)) = (params.lat, params.lng) {
            let radius = params.radius_miles.unwrap_or(5.0);
            let lat_delta = radius / 69.0;
            let lng_delta = radius / (69.0 * lat.to_radians().cos().abs().max(0.01));

            let mut stmt = self
                .conn
                .prepare(
                    "SELECT id, session_id, rank, title, price, url, image_url,
                            platform, destination, lat, lng, area_type, radius_miles,
                            purchase_score, health_score, confidence_tier, decision,
                            why_ranked, positives, warnings, tradeoffs,
                            comparison_summary, ranked_at
                     FROM ranked_listings
                     WHERE ranked_at > datetime('now', '-7 days')
                       AND lat BETWEEN ?1 AND ?2
                       AND lng BETWEEN ?3 AND ?4
                     ORDER BY rank ASC, ranked_at DESC
                     LIMIT ?5",
                )
                .map_err(|e| format!("SQLite prepare error: {e}"))?;

            let rows = stmt
                .query_map(
                    params![
                        lat - lat_delta,
                        lat + lat_delta,
                        lng - lng_delta,
                        lng + lng_delta,
                        params.limit as i64,
                    ],
                    row_to_listing,
                )
                .map_err(|e| format!("SQLite query error: {e}"))?;

            return collect_rows(rows);
        }

        // Destination text search
        if let Some(dest) = &params.destination {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT id, session_id, rank, title, price, url, image_url,
                            platform, destination, lat, lng, area_type, radius_miles,
                            purchase_score, health_score, confidence_tier, decision,
                            why_ranked, positives, warnings, tradeoffs,
                            comparison_summary, ranked_at
                     FROM ranked_listings
                     WHERE ranked_at > datetime('now', '-7 days')
                       AND destination LIKE ?1
                     ORDER BY rank ASC, ranked_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| format!("SQLite prepare error: {e}"))?;

            let pattern = format!("%{}%", dest);
            let rows = stmt
                .query_map(params![pattern, params.limit as i64], row_to_listing)
                .map_err(|e| format!("SQLite query error: {e}"))?;

            return collect_rows(rows);
        }

        // All recent listings
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, session_id, rank, title, price, url, image_url,
                        platform, destination, lat, lng, area_type, radius_miles,
                        purchase_score, health_score, confidence_tier, decision,
                        why_ranked, positives, warnings, tradeoffs,
                        comparison_summary, ranked_at
                 FROM ranked_listings
                 WHERE ranked_at > datetime('now', '-7 days')
                 ORDER BY ranked_at DESC, rank ASC
                 LIMIT ?1",
            )
            .map_err(|e| format!("SQLite prepare error: {e}"))?;

        let rows = stmt
            .query_map(params![params.limit as i64], row_to_listing)
            .map_err(|e| format!("SQLite query error: {e}"))?;

        collect_rows(rows)
    }
}

fn row_to_listing(row: &rusqlite::Row) -> rusqlite::Result<InventoryListing> {
    let positives_str: String = row.get(18)?;
    let warnings_str: String = row.get(19)?;
    let tradeoffs_str: String = row.get(20)?;

    Ok(InventoryListing {
        id: row.get(0)?,
        session_id: row.get(1)?,
        rank: row.get(2)?,
        title: row.get(3)?,
        price: row.get(4)?,
        url: row.get(5)?,
        image_url: row.get(6)?,
        platform: row.get(7)?,
        destination: row.get(8)?,
        lat: row.get(9)?,
        lng: row.get(10)?,
        area_type: row.get(11)?,
        radius_miles: row.get(12)?,
        purchase_score: row.get(13)?,
        health_score: row.get(14)?,
        confidence_tier: row.get(15)?,
        decision: row.get(16)?,
        why_ranked: row.get(17)?,
        positives: serde_json::from_str(&positives_str).unwrap_or_default(),
        warnings: serde_json::from_str(&warnings_str).unwrap_or_default(),
        tradeoffs: serde_json::from_str(&tradeoffs_str).unwrap_or_default(),
        comparison_summary: row.get(21)?,
        ranked_at: row.get(22)?,
    })
}

fn collect_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row) -> rusqlite::Result<InventoryListing>>,
) -> Result<Vec<InventoryListing>, String> {
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("SQLite row error: {e}"))?);
    }
    Ok(results)
}

// ── HTTP Handler ──

/// GET /listings/search?destination=Tampa&lat=27.95&lng=-82.46&radius_miles=5&limit=20
pub async fn search_inventory(
    State(inventory): State<Inventory>,
    Query(params): Query<SearchParams>,
) -> Result<Json<InventorySearchResponse>, (StatusCode, Json<serde_json::Value>)> {
    let inv = inventory
        .lock()
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "inventory lock failed" })),
            )
        })?;

    let listings = inv.search_listings(&params).map_err(|e| {
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
