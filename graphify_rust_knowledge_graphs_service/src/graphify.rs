//! Thin wrapper around the `graphify-rs` CLI binary.
//!
//! All commands are invoked with absolute paths so there is no dependency on
//! the process working directory.

use std::path::Path;
use tokio::process::Command;

use crate::error::AppError;

pub struct BuildOptions {
    /// Run LLM semantic extraction (Pass 2). Requires an API key.
    pub use_llm: bool,
    /// Comma-separated export formats, e.g. "json,html". None means all formats.
    pub format: Option<String>,
    /// Only re-extract files changed since the last build.
    pub incremental: bool,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self {
            use_llm: false,
            format: Some("json,html".to_string()),
            incremental: false,
        }
    }
}

/// Run `graphify-rs build` for the given graph directory.
///
/// Output is written to `<graph_dir>/graphify-out/`.
pub async fn build(graph_dir: &Path, opts: BuildOptions) -> Result<String, AppError> {
    let output_dir = graph_dir.join("graphify-out");

    let mut cmd = Command::new("graphify-rs");
    cmd.arg("build")
        .arg("--path")
        .arg(graph_dir)
        .arg("--output")
        .arg(&output_dir);

    if !opts.use_llm {
        cmd.arg("--no-llm");
    }

    if opts.incremental {
        cmd.arg("--update");
    }

    if let Some(fmt) = &opts.format {
        cmd.arg("--format").arg(fmt);
    }

    let out = cmd.output().await.map_err(map_not_found)?;

    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();

    if out.status.success() {
        Ok(stdout)
    } else {
        let msg = if stderr.trim().is_empty() { stdout } else { stderr };
        Err(AppError::BuildFailed(msg.trim().to_string()))
    }
}

/// Run `graphify-rs query` against a pre-built graph.
pub async fn query(
    graph_dir: &Path,
    question: &str,
    dfs: bool,
    budget: Option<usize>,
) -> Result<String, AppError> {
    let graph_json = graph_dir.join("graphify-out").join("graph.json");

    let mut cmd = Command::new("graphify-rs");
    cmd.arg("query")
        .arg(question)
        .arg("--graph")
        .arg(&graph_json);

    if dfs {
        cmd.arg("--dfs");
    }

    if let Some(b) = budget {
        cmd.arg("--budget").arg(b.to_string());
    }

    let out = cmd.output().await.map_err(map_not_found)?;

    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();

    if out.status.success() {
        Ok(stdout)
    } else {
        let msg = if stderr.trim().is_empty() { stdout } else { stderr };
        Err(AppError::QueryFailed(msg.trim().to_string()))
    }
}

fn map_not_found(e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::GraphifyNotFound
    } else {
        AppError::Io(e)
    }
}
