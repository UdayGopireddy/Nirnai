use aws_sdk_dynamodb::types::AttributeValue;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

const CLICKS_TABLE: &str = "nirnai-clicks";
const CLICKS_TTL_SECS: u64 = 7_776_000; // 90 days

#[derive(Clone)]
pub struct ClickTracker {
    client: aws_sdk_dynamodb::Client,
}

impl ClickTracker {
    pub fn new(client: aws_sdk_dynamodb::Client) -> Self {
        Self { client }
    }
}

#[derive(Debug, Deserialize)]
pub struct TrackClickRequest {
    pub session_id: String,
    pub url: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub listing_title: String,
    #[serde(default)]
    pub listing_rank: Option<u32>,
    #[serde(default)]
    pub is_affiliate: bool,
}

#[derive(Debug, Serialize)]
pub struct TrackClickResponse {
    pub click_id: String,
}

pub async fn track_click(
    State(tracker): State<ClickTracker>,
    Json(req): Json<TrackClickRequest>,
) -> Result<Json<TrackClickResponse>, (StatusCode, Json<serde_json::Value>)> {
    let click_id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let ttl = now.as_secs() + CLICKS_TTL_SECS;
    let timestamp = now.as_secs().to_string();

    let mut item = std::collections::HashMap::new();
    item.insert("click_id".into(), AttributeValue::S(click_id.clone()));
    item.insert("session_id".into(), AttributeValue::S(req.session_id));
    item.insert("url".into(), AttributeValue::S(req.url));
    item.insert("platform".into(), AttributeValue::S(req.platform));
    item.insert("listing_title".into(), AttributeValue::S(req.listing_title));
    if let Some(rank) = req.listing_rank {
        item.insert("listing_rank".into(), AttributeValue::N(rank.to_string()));
    }
    item.insert("is_affiliate".into(), AttributeValue::Bool(req.is_affiliate));
    item.insert("clicked_at".into(), AttributeValue::N(timestamp));
    item.insert("ttl".into(), AttributeValue::N(ttl.to_string()));

    tracker
        .client
        .put_item()
        .table_name(CLICKS_TABLE)
        .set_item(Some(item))
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("Failed to track click: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "click tracking failed" })),
            )
        })?;

    Ok(Json(TrackClickResponse { click_id }))
}
