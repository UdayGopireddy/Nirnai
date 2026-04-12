//! Proxy layer: forwards scoring & WhatsApp routes to the Python backend.
//!
//! The Python service URL is read from `NIRNAI_PYTHON_URL` env var.
//! Falls back to `http://localhost:8001` for local dev.

use axum::body::Body;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use reqwest::Client;
use std::env;
use std::sync::LazyLock;

static PYTHON_URL: LazyLock<String> = LazyLock::new(|| {
    env::var("NIRNAI_PYTHON_URL").unwrap_or_else(|_| "http://localhost:8001".to_string())
});

static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client")
});

/// Get the Python backend base URL.
pub fn python_url() -> &'static str {
    &PYTHON_URL
}

/// Get a reference to the shared HTTP client.
pub fn http_client() -> &'static Client {
    &HTTP_CLIENT
}

/// Generic proxy: forwards the full request to the Python backend at the same path.
pub async fn proxy(req: Request<Body>) -> impl IntoResponse {
    let method = req.method().clone();
    let path = req.uri().path_and_query().map_or("/", |pq| pq.as_str()).to_owned();
    let headers = req.headers().clone();
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "request body too large").into_response(),
    };

    let url = format!("{}{}", *PYTHON_URL, path);

    let mut builder = HTTP_CLIENT.request(method, &url);

    // Forward relevant headers
    for (name, value) in &headers {
        let n = name.as_str();
        if n == "content-type" || n == "accept" || n == "authorization" || n.starts_with("x-") {
            builder = builder.header(name.clone(), value.clone());
        }
    }

    let resp = match builder.body(body_bytes).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[proxy] error forwarding to {url}: {e}");
            return (StatusCode::BAD_GATEWAY, format!("Python backend unreachable: {e}"))
                .into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let resp_headers = resp.headers().clone();
    let resp_body = resp.bytes().await.unwrap_or_default();

    let mut response = Response::builder().status(status);
    for (name, value) in &resp_headers {
        let n = name.as_str();
        if n == "content-type" || n == "content-length" || n.starts_with("x-") {
            response = response.header(name.clone(), value.clone());
        }
    }
    response
        .body(Body::from(resp_body))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "proxy error").into_response())
}
