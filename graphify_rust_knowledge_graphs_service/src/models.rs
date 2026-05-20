use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

#[derive(Serialize)]
pub struct GraphInfo {
    pub name: String,
    pub built: bool,
    pub file_count: usize,
    /// Relative path to the graphify-out directory for this graph
    pub output_dir: String,
}

#[derive(Deserialize)]
pub struct CreateGraphRequest {
    pub name: String,
}

/// Query parameters for POST /graphs/:name/build
#[derive(Deserialize, Default)]
pub struct BuildParams {
    /// Set to true to enable LLM semantic extraction (Pass 2).
    /// Requires ANTHROPIC_API_KEY / OPENAI_API_KEY or a graphify.toml [llm] section.
    pub use_llm: Option<bool>,
    /// Comma-separated export formats: json,html,graphml,cypher,svg,wiki,obsidian,report
    /// Defaults to "json,html"
    pub format: Option<String>,
    /// Incremental rebuild — only re-extracts new/modified files since last build.
    pub incremental: Option<bool>,
}

#[derive(Serialize)]
pub struct BuildResponse {
    pub success: bool,
    pub graph_name: String,
    pub output: String,
}

/// Query parameters for GET /graphs/:name/query
#[derive(Deserialize)]
pub struct QueryParams {
    /// The natural-language question to ask the graph
    pub q: String,
    /// Use depth-first search instead of BFS
    pub dfs: Option<bool>,
    /// Maximum token budget for the returned context (default: 2000)
    pub budget: Option<usize>,
}

#[derive(Serialize)]
pub struct QueryResponse {
    pub graph_name: String,
    pub question: String,
    pub answer: String,
}

#[derive(Deserialize)]
pub struct UpsertFileRequest {
    /// Markdown content to write into the file
    pub content: String,
}

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub size_bytes: u64,
}
