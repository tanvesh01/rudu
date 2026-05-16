use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{
    GitHubFileContext, RemoteReviewReport, RemoteReviewSession, RemoteReviewWorkerConfigStatus,
};
use crate::services::{remote_review, remote_review_config};

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
    start_remote_review_agent(app, session_id).await
}

#[tauri::command]
pub async fn start_remote_review_agent(app: AppHandle, session_id: String) -> Result<(), String> {
    let root = remote_review_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        remote_review::start_remote_review_agent(&root, session_id, move |event| {
            let _ = event_app.emit(remote_review::remote_review_agent_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn ensure_remote_review_chat_session(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let root = remote_review_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        remote_review::ensure_remote_review_chat_session(&root, session_id, move |event| {
            let _ = event_app.emit(remote_review::remote_review_chat_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn send_remote_review_chat_message(
    session_id: String,
    turn_id: String,
    text: String,
) -> Result<(), String> {
    run_blocking_task(move || {
        remote_review::send_remote_review_chat_message(session_id, turn_id, text)
    })
    .await
}

#[tauri::command]
pub async fn cancel_remote_review_chat_turn(
    session_id: String,
    turn_id: String,
) -> Result<(), String> {
    run_blocking_task(move || remote_review::cancel_remote_review_chat_turn(session_id, turn_id))
        .await
}

#[tauri::command]
pub async fn get_remote_review_report(
    app: AppHandle,
    session_id: String,
) -> Result<Option<RemoteReviewReport>, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::get_report(&root, session_id)).await
}

#[tauri::command]
pub async fn get_remote_review_worker_config(
    app: AppHandle,
) -> Result<RemoteReviewWorkerConfigStatus, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review_config::get_worker_config_status(&root)).await
}

#[tauri::command]
pub async fn save_remote_review_worker_config(
    app: AppHandle,
    worker_url: String,
    api_token: String,
) -> Result<RemoteReviewWorkerConfigStatus, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || {
        remote_review_config::save_worker_config(&root, worker_url, api_token)
    })
    .await
}

#[tauri::command]
pub async fn pair_remote_review_worker_config(
    app: AppHandle,
    worker_url: String,
) -> Result<RemoteReviewWorkerConfigStatus, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review_config::pair_worker_config(&root, worker_url)).await
}

#[tauri::command]
pub async fn clear_remote_review_worker_config(
    app: AppHandle,
) -> Result<RemoteReviewWorkerConfigStatus, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review_config::clear_worker_config(&root)).await
}

#[tauri::command]
pub async fn test_remote_review_worker_config(
    app: AppHandle,
    worker_url: Option<String>,
    api_token: Option<String>,
) -> Result<(), String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || {
        remote_review_config::test_worker_config(&root, worker_url, api_token)
    })
    .await
}
