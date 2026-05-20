use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Graph '{0}' not found")]
    GraphNotFound(String),

    #[error("File '{0}' not found")]
    FileNotFound(String),

    #[error("Graph '{0}' already exists")]
    GraphAlreadyExists(String),

    #[error("graphify-rs binary not found in PATH — install it with: cargo install graphify-rs")]
    GraphifyNotFound,

    #[error("Build failed: {0}")]
    BuildFailed(String),

    #[error("Query failed: {0}")]
    QueryFailed(String),

    #[error("Graph '{0}' has not been built yet — call POST /graphs/{0}/build first")]
    GraphNotBuilt(String),

    #[error("Invalid name '{0}' — use only letters, digits, hyphens, and underscores")]
    InvalidName(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::GraphNotFound(_) | AppError::FileNotFound(_) | AppError::GraphNotBuilt(_) => {
                StatusCode::NOT_FOUND
            }
            AppError::GraphAlreadyExists(_) => StatusCode::CONFLICT,
            AppError::InvalidName(_) => StatusCode::BAD_REQUEST,
            AppError::GraphifyNotFound => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = json!({ "error": self.to_string() });
        (status, Json(body)).into_response()
    }
}
