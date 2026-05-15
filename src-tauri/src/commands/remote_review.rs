use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::models::{GitHubFileContext, RemoteReviewReport, RemoteReviewSession};
use crate::services::remote_review;

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

fn remote_review_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve("remote-review", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve remote review directory: {error}"))
}

#[tauri::command]
pub async fn prepare_remote_review_session(
    app: AppHandle,
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::prepare_session(&root, repo, number, head_sha)).await
}

#[tauri::command]
pub async fn hydrate_remote_review_session(
    app: AppHandle,
    session_id: String,
) -> Result<GitHubFileContext, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::hydrate_session(&root, session_id)).await
}

#[tauri::command]
pub async fn launch_pi_review_terminal(app: AppHandle, session_id: String) -> Result<(), String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::launch_pi_review_terminal(&root, session_id)).await
}

#[tauri::command]
pub async fn get_remote_review_report(
    app: AppHandle,
    session_id: String,
) -> Result<Option<RemoteReviewReport>, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::get_report(&root, session_id)).await
}
