use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use tokio::fs;

use crate::{
    error::AppError,
    graphify::{self, BuildOptions},
    models::*,
    AppState,
};

// ── Validation helpers ────────────────────────────────────────────────────────

/// Allow only `[a-zA-Z0-9_-]` to prevent path traversal and shell injection.
fn validate_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::InvalidName(name.to_string()));
    }
    Ok(())
}

/// Only `.md` files, no path separators or `..`.
fn validate_filename(filename: &str) -> Result<(), AppError> {
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || filename.contains('\0')
        || !filename.ends_with(".md")
    {
        return Err(AppError::InvalidName(filename.to_string()));
    }
    Ok(())
}

async fn count_md_files(dir: &std::path::Path) -> usize {
    let Ok(mut entries) = fs::read_dir(dir).await else {
        return 0;
    };
    let mut count = 0usize;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.path().extension().map_or(false, |e| e == "md") {
            count += 1;
        }
    }
    count
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /health
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// GET /graphs
///
/// Returns a list of every subdirectory in `data/`, with build status and file counts.
pub async fn list_graphs(
    State(state): State<AppState>,
) -> Result<Json<Vec<GraphInfo>>, AppError> {
    let mut graphs = Vec::new();
    let mut entries = fs::read_dir(&state.data_dir).await?;

    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        if !file_type.is_dir() {
            continue;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        let built = fs::try_exists(path.join("graphify-out").join("graph.json"))
            .await
            .unwrap_or(false);
        let file_count = count_md_files(&path).await;

        graphs.push(GraphInfo {
            output_dir: format!("data/{}/graphify-out", name),
            name,
            built,
            file_count,
        });
    }

    Ok(Json(graphs))
}

/// POST /graphs
///
/// Body: `{"name": "my-graph"}`
///
/// Creates the directory `data/<name>/` and returns the new graph info.
pub async fn create_graph(
    State(state): State<AppState>,
    Json(req): Json<CreateGraphRequest>,
) -> Result<(StatusCode, Json<GraphInfo>), AppError> {
    validate_name(&req.name)?;

    let graph_dir = state.data_dir.join(&req.name);

    if fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphAlreadyExists(req.name));
    }

    fs::create_dir_all(&graph_dir).await?;

    Ok((
        StatusCode::CREATED,
        Json(GraphInfo {
            output_dir: format!("data/{}/graphify-out", req.name),
            name: req.name,
            built: false,
            file_count: 0,
        }),
    ))
}

/// POST /graphs/:name/build[?use_llm=false&format=json,html&incremental=false]
///
/// Runs `graphify-rs build` on `data/<name>/` and writes output to
/// `data/<name>/graphify-out/`.
pub async fn build_graph(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(params): Query<BuildParams>,
) -> Result<Json<BuildResponse>, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name));
    }

    let opts = BuildOptions {
        use_llm: params.use_llm.unwrap_or(false),
        format: Some(params.format.unwrap_or_else(|| "json,html".to_string())),
        incremental: params.incremental.unwrap_or(false),
    };

    let output = graphify::build(&graph_dir, opts).await?;

    Ok(Json(BuildResponse {
        success: true,
        graph_name: name,
        output,
    }))
}

/// GET /graphs/:name/status
pub async fn graph_status(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<GraphInfo>, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name.clone()));
    }

    let built = fs::try_exists(graph_dir.join("graphify-out").join("graph.json"))
        .await
        .unwrap_or(false);
    let file_count = count_md_files(&graph_dir).await;

    Ok(Json(GraphInfo {
        output_dir: format!("data/{}/graphify-out", name),
        name,
        built,
        file_count,
    }))
}

/// GET /graphs/:name/graph.json
///
/// Streams the raw `graph.json` produced by the last build.
pub async fn get_graph_json(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name.clone()));
    }

    let json_path = graph_dir.join("graphify-out").join("graph.json");
    if !fs::try_exists(&json_path).await.unwrap_or(false) {
        return Err(AppError::GraphNotBuilt(name));
    }

    let content = fs::read_to_string(&json_path).await?;

    Ok((
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        content,
    ))
}

/// GET /graphs/:name/report
///
/// Returns the markdown `GRAPH_REPORT.md` produced by the last build.
pub async fn get_graph_report(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<String, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name.clone()));
    }

    let report_path = graph_dir.join("graphify-out").join("GRAPH_REPORT.md");
    if !fs::try_exists(&report_path).await.unwrap_or(false) {
        return Err(AppError::GraphNotBuilt(name));
    }

    Ok(fs::read_to_string(&report_path).await?)
}

/// GET /graphs/:name/query?q=<question>[&dfs=false&budget=2000]
///
/// Runs `graphify-rs query` against the built graph and returns the answer.
pub async fn query_graph(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(params): Query<QueryParams>,
) -> Result<Json<QueryResponse>, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name.clone()));
    }

    if !fs::try_exists(graph_dir.join("graphify-out").join("graph.json"))
        .await
        .unwrap_or(false)
    {
        return Err(AppError::GraphNotBuilt(name.clone()));
    }

    let answer = graphify::query(
        &graph_dir,
        &params.q,
        params.dfs.unwrap_or(false),
        params.budget,
    )
    .await?;

    Ok(Json(QueryResponse {
        graph_name: name,
        question: params.q,
        answer,
    }))
}

/// GET /graphs/:name/files
///
/// Lists all `.md` files inside `data/<name>/`.
pub async fn list_files(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Vec<FileInfo>>, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name));
    }

    let mut files = Vec::new();
    let mut entries = fs::read_dir(&graph_dir).await?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "md") {
            let meta = entry.metadata().await?;
            files.push(FileInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                size_bytes: meta.len(),
            });
        }
    }

    Ok(Json(files))
}

/// PUT /graphs/:name/files/:filename
///
/// Creates or overwrites `data/<name>/<filename>` with the provided markdown content.
/// Only `.md` filenames are accepted.
///
/// Body: `{"content": "# My note\n..."}`
pub async fn upsert_file(
    State(state): State<AppState>,
    Path((name, filename)): Path<(String, String)>,
    Json(req): Json<UpsertFileRequest>,
) -> Result<StatusCode, AppError> {
    validate_name(&name)?;
    validate_filename(&filename)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name));
    }

    let file_path = graph_dir.join(&filename);
    fs::write(&file_path, req.content.as_bytes()).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /graphs/:name/files/:filename
pub async fn get_file(
    State(state): State<AppState>,
    Path((name, filename)): Path<(String, String)>,
) -> Result<String, AppError> {
    validate_name(&name)?;
    validate_filename(&filename)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name));
    }

    let file_path = graph_dir.join(&filename);
    if !fs::try_exists(&file_path).await.unwrap_or(false) {
        return Err(AppError::FileNotFound(filename));
    }

    Ok(fs::read_to_string(&file_path).await?)
}

/// DELETE /graphs/:name/files/:filename
pub async fn delete_file(
    State(state): State<AppState>,
    Path((name, filename)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    validate_name(&name)?;
    validate_filename(&filename)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name));
    }

    let file_path = graph_dir.join(&filename);
    if !fs::try_exists(&file_path).await.unwrap_or(false) {
        return Err(AppError::FileNotFound(filename));
    }

    fs::remove_file(&file_path).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /graphs/:name
///
/// Permanently removes `data/<name>/` and all its contents including any built graph.
pub async fn delete_graph(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<StatusCode, AppError> {
    validate_name(&name)?;

    let graph_dir = state.data_dir.join(&name);
    if !fs::try_exists(&graph_dir).await.unwrap_or(false) {
        return Err(AppError::GraphNotFound(name));
    }

    fs::remove_dir_all(&graph_dir).await?;
    Ok(StatusCode::NO_CONTENT)
}
