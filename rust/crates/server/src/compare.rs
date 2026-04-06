use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;

use crate::inventory::{self, Inventory};
use crate::nirnai::{
    self, BatchResponse, ProductData,
};

// ── Session store ──

#[derive(Debug, Clone, Serialize)]
pub struct CompareSession {
    pub id: String,
    pub status: SessionStatus,
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

pub type SessionStore = Arc<Mutex<HashMap<String, CompareSession>>>;

pub fn new_session_store() -> SessionStore {
    Arc::new(Mutex::new(HashMap::new()))
}

// ── Combined app state ──

#[derive(Clone)]
pub struct NirnaiState {
    pub sessions: SessionStore,
    pub inventory: Inventory,
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

// ── Handlers ──

#[derive(Debug, Deserialize)]
pub struct StartRequest {
    pub listings: Vec<ProductData>,
    #[serde(default)]
    pub search_context: String,
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
) -> Result<StartResponse, String> {
    if listings.is_empty() {
        return Err("no listings provided".into());
    }
    if listings.len() > 20 {
        return Err("maximum 20 listings".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let session = CompareSession {
        id: id.clone(),
        status: SessionStatus::Pending,
        listings: listings.clone(),
        search_context: search_context.clone(),
        result: None,
        error: None,
    };

    {
        let mut sessions = store.lock().await;
        sessions.insert(id.clone(), session);
    }

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
        {
            let mut sessions = store_clone.lock().await;
            if let Some(s) = sessions.get_mut(&id_clone) {
                s.status = SessionStatus::Analyzing;
            }
        }

        // Run analysis (reuse the existing analyze_batch logic)
        let result = analyze_batch_internal(listings, search_context).await;

        // Store result
        {
            let mut sessions = store_clone.lock().await;
            if let Some(s) = sessions.get_mut(&id_clone) {
                match result {
                    Ok(batch) => {
                        // Persist ranked listings to inventory
                        let geo = inventory::parse_geo_context(&context_for_geo, &platform_label);
                        tracing::info!(
                            "Saving {} rankings to inventory — destination: {:?}, platform: {}, lat: {:?}, lng: {:?}",
                            batch.ranked.len(), geo.destination, geo.platform, geo.lat, geo.lng
                        );
                        if let Ok(inv) = inventory_clone.lock() {
                            match inv.save_rankings(
                                &id_clone,
                                &batch.ranked,
                                &batch.comparison_summary,
                                &geo,
                            ) {
                                Ok(count) => tracing::info!("Saved {count} rankings to inventory for session {}", &id_clone),
                                Err(e) => tracing::warn!("Failed to save rankings to inventory: {e}"),
                            }
                        }

                        s.result = Some(batch);
                        s.status = SessionStatus::Done;
                    }
                    Err(e) => {
                        s.error = Some(e);
                        s.status = SessionStatus::Error;
                    }
                }
            }
        }
    });

    // Determine base URL for the compare page
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8000);
    let url = format!("http://localhost:{}/compare/{}", port, id);

    Ok(StartResponse { id, url })
}

/// POST /compare/start — accepts listings, stores session, kicks off async analysis, returns session ID + URL
pub async fn start_compare(
    State(state): State<NirnaiState>,
    Json(request): Json<StartRequest>,
) -> Result<Json<StartResponse>, (StatusCode, Json<serde_json::Value>)> {
    match create_compare_session(&state.sessions, &state.inventory, request.listings, request.search_context).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "error": e })))),
    }
}

/// GET /compare/:id — serves the NirnAI compare webpage
pub async fn compare_page(
    Path(id): Path<String>,
    State(store): State<SessionStore>,
) -> impl IntoResponse {
    // Validate session exists
    let exists = {
        let sessions = store.lock().await;
        sessions.contains_key(&id)
    };

    if !exists {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            Html(String::from("<h1>Session not found</h1><p>This comparison link has expired or is invalid.</p>")),
        );
    }

    let html = build_compare_html(&id);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(html),
    )
}

/// GET /compare/:id/status — JSON polling endpoint
pub async fn compare_status(
    Path(id): Path<String>,
    State(store): State<SessionStore>,
) -> Result<Json<CompareSession>, (StatusCode, Json<serde_json::Value>)> {
    let sessions = store.lock().await;
    match sessions.get(&id) {
        Some(session) => Ok(Json(session.clone())),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "session not found" })),
        )),
    }
}

// ── Internal batch analysis ──

async fn analyze_batch_internal(
    listings: Vec<ProductData>,
    search_context: String,
) -> Result<BatchResponse, String> {
    let is_travel = listings.iter().any(|l| {
        matches!(l.source_site.as_str(), "airbnb" | "booking" | "expedia" | "vrbo" | "hotels")
    });

    let domain_context = if is_travel {
        "\n\nDOMAIN: TRAVEL/ACCOMMODATION. Apply travel scoring rules: recency weighting, host scoring, cancellation policy scoring, cleanliness as health_score. Labels should be BOOK IT / THINK TWICE / SKIP."
    } else {
        "\n\nDOMAIN: SHOPPING. Apply standard product scoring rules. Labels should be Smart Buy / Check / Avoid."
    };

    // Extract area/search context if present (appended by content script after URL)
    let extra_context = if let Some(idx) = search_context.find("\n\nAREA CONTEXT:") {
        search_context[idx..].to_string()
    } else if let Some(idx) = search_context.find("\n\nSEARCH CONTEXT:") {
        search_context[idx..].to_string()
    } else {
        String::new()
    };

    let system_prompt = format!(
        "{}{}{}",
        nirnai::batch_comparison_system_prompt(),
        domain_context,
        extra_context
    );
    let user_prompt = nirnai::format_batch_prompt(&listings, &search_context);

    let result = tokio::task::spawn_blocking(move || {
        nirnai::run_analysis(system_prompt, user_prompt)
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
    .map_err(|e| e)?;

    let batch: BatchResponse = serde_json::from_value(result)
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
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
      --radius-xl: 28px;
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
    .badge-check {{ background: var(--orange-bg); color: var(--orange); border: 1px solid var(--orange-border); }}
    .badge-avoid {{ background: var(--red-bg); color: var(--red); border: 1px solid var(--red-border); }}
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
      text-align: center; padding: 36px 0 16px;
      font-size: 11px; color: var(--text-muted); letter-spacing: 0.3px;
    }}
    .footer .heart {{ color: var(--accent); }}

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
  </style>
</head>
<body>
  <div class="header">
    <span class="logo">🛡️</span>
    <span class="brand">NirnAI</span>
    <span class="tagline">Clear decisions. Every purchase.</span>
  </div>

  <div class="container" id="app">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <p>Finding your best option...</p>
      <p class="sub">Analyzing trust, value, and quality across platforms.</p>
    </div>
  </div>

  <script>
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

    function stampBadge(stamp, label) {{
      const cls = stamp === "SMART_BUY" ? "badge-smart" : stamp === "AVOID" ? "badge-avoid" : "badge-check";
      const text = stamp === "SMART_BUY" ? "RECOMMENDED" : stamp === "AVOID" ? "SKIP" : (label || "CONSIDER");
      return `<span class="badge ${{cls}}">${{text}}</span>`;
    }}

    function scoreColor(score) {{
      if (score >= 70) return "var(--green)";
      if (score >= 50) return "var(--orange)";
      return "var(--red)";
    }}

    function parsePriceNum(s) {{
      if (!s) return null;
      const m = s.replace(/,/g, "").match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : null;
    }}

    function ctaText(listing, savings) {{
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
      }} catch {{}}
      if (savings > 0) return `${{site}} — Save $$${{Math.round(savings)}}`;
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
      const app = document.getElementById("app");
      const batch = data.result;
      const ranked = batch.ranked || [];
      if (ranked.length === 0) {{ app.innerHTML = `<div class="error"><h2>No results</h2></div>`; return; }}

      const top = ranked[0];
      const runners = ranked.slice(1);

      const topPrice = parsePriceNum(top.price);
      const r2Price = runners.length > 0 ? parsePriceNum(runners[0].price) : null;
      const savings = (topPrice !== null && r2Price !== null && r2Price > topPrice) ? (r2Price - topPrice) : 0;

      const conf = confChip(
        top.confidence_tier,
        top.review_trust?.review_count || top.review_trust?.trust_score
      );

      let html = "";

      // ═══ VERDICT BAR ═══
      html += `<div class="verdict-bar">
        <div class="verdict-icon">🏆</div>
        <div class="verdict-text">
          <div class="verdict-title">${{batch.comparison_summary ? batch.comparison_summary.split(".")[0] + "." : "We found your best option."}}</div>
          <div class="verdict-sub">Ranked ${{ranked.length}} options across platforms${{savings > 0 ? ` · You save $$${{Math.round(savings)}}` : ""}}</div>
        </div>
      </div>`;

      // ═══ HERO CARD ═══
      html += `<div class="hero"><div class="hero-glow"></div><div class="hero-body">`;

      html += `<div class="hero-top">`;
      if (top.image_url) html += `<img class="hero-image" src="${{top.image_url}}" alt="" loading="lazy">`;
      html += `<div class="hero-content">`;
      html += `<div class="hero-rank-badge">#1 Best Pick</div>`;
      html += platformBadge(top.url);
      html += `<div class="hero-title"><a href="${{top.url}}" target="_blank" rel="noopener">${{top.title}}</a></div>`;
      html += `<div class="hero-meta">`;
      if (top.price) html += `<span class="meta-chip chip-price">${{top.price}}</span>`;
      html += `<span class="meta-chip ${{conf.cls}}">${{conf.text}}</span>`;
      html += `</div></div></div>`; // meta, content, top

      // Savings
      if (savings > 0) {{
        html += `<div class="hero-savings">💰 Save $$${{Math.round(savings)}} vs next best option</div>`;
      }}

      // Score bars
      html += miniScoreBar("Purchase", top.purchase_score);
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
        if (savings > 0) items.push(`$$${{Math.round(savings)}} more expensive`);
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
        <a class="btn btn-primary" href="${{top.url}}" target="_blank" rel="noopener">${{ctaText(top, savings)}}</a>
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
          html += `<div class="runner-title"><a href="${{listing.url}}" target="_blank" rel="noopener">${{listing.title}}</a></div>`;
          html += `<div class="runner-meta">`;
          html += stampBadge(listing.stamp?.stamp, listing.stamp?.label);
          html += platformBadge(listing.url);
          if (listing.price) html += `<span class="runner-price">${{listing.price}}</span>`;
          html += `</div>`;
          if (listing.why_ranked) html += `<div class="runner-reason">${{listing.why_ranked}}</div>`;
          html += `</div>`; // runner-info
          html += `<div class="runner-cta"><a href="${{listing.url}}" target="_blank" rel="noopener">View →</a></div>`;
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
        <a class="btn btn-primary" href="${{top.url}}" target="_blank" rel="noopener">${{ctaText(top, savings)}}</a>
      </div>`;

      html += `<div class="footer">NirnAI <span class="heart">·</span> Clear decisions. Every purchase.</div>`;
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
</html>"##, session_id = session_id)
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
        if let Ok(inv) = state.inventory.lock() {
            if let Err(e) = inv.save_verified_listing(&product, &result) {
                tracing::warn!("Failed to save verified listing to inventory: {e}");
            }
        }
    }

    Ok(result)
}
