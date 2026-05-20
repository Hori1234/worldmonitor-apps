mod error;
mod graphify;
mod handlers;
mod models;

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub use error::AppError;

#[derive(Clone)]
pub struct AppState {
    /// Absolute path to the `data/` directory that stores all graphs.
    pub data_dir: PathBuf,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::new(
                std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
            ),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Resolve `data/` to an absolute path so graphify-rs receives full paths.
    let data_dir = std::env::current_dir()
        .expect("Cannot read current directory")
        .join("data");

    std::fs::create_dir_all(&data_dir).expect("Failed to create data/ directory");

    let state = AppState { data_dir };

    let app = Router::new()
        // ── Health ────────────────────────────────────────────────────────────
        .route("/health", get(handlers::health))
        // ── Graph management ──────────────────────────────────────────────────
        .route("/graphs", get(handlers::list_graphs))
        .route("/graphs", post(handlers::create_graph))
        .route("/graphs/:name", delete(handlers::delete_graph))
        // ── Build & status ────────────────────────────────────────────────────
        .route("/graphs/:name/build", post(handlers::build_graph))
        .route("/graphs/:name/status", get(handlers::graph_status))
        // ── Graph output ──────────────────────────────────────────────────────
        .route("/graphs/:name/graph.json", get(handlers::get_graph_json))
        .route("/graphs/:name/report", get(handlers::get_graph_report))
        .route("/graphs/:name/query", get(handlers::query_graph))
        // ── Markdown file management ──────────────────────────────────────────
        .route("/graphs/:name/files", get(handlers::list_files))
        .route(
            "/graphs/:name/files/:filename",
            put(handlers::upsert_file)
                .get(handlers::get_file)
                .delete(handlers::delete_file),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3741);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Graphify Knowledge Graph Service listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}
