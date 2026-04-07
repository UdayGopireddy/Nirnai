use std::env;
use std::net::SocketAddr;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

mod compare;
mod homepage;
mod intent;
mod inventory;
mod nirnai;
mod scraper;

#[tokio::main]
async fn main() {
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8000);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let session_store = compare::new_session_store();
    let inventory = inventory::new_inventory()
        .expect("Failed to initialize inventory database");

    let state = compare::NirnaiState {
        sessions: session_store,
        inventory,
    };

    let app = Router::new()
        .route("/", get(homepage::index))
        .route("/analyze", post(compare::analyze_with_inventory))
        .route("/analyze-cart", post(nirnai::analyze_cart))
        .route("/analyze-batch", post(nirnai::analyze_batch))
        .route("/compare/start", post(compare::start_compare))
        .route("/compare/{id}", get(compare::compare_page))
        .route("/compare/{id}/status", get(compare::compare_status))
        .route("/intent/link", post(intent::intent_link))
        .route("/intent/search", post(intent::intent_search))
        .route("/intent/compare", post(intent::intent_compare))
        .route("/listings/search", get(inventory::search_inventory))
        .route("/health", get(nirnai::health_check))
        .with_state(state)
        .layer(cors);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("NirnAI server listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind");
    axum::serve(listener, app).await.expect("server error");
}
