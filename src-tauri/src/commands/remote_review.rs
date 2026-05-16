use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{RemoteReviewReport, RemoteReviewSession};
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
        .resolve("review", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve remote review directory: {error}"))
}

#[tauri::command]
pub async fn prepare_review_workspace(
    app: AppHandle,
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::prepare_workspace(&root, repo, number, head_sha)).await
}

#[tauri::command]
pub async fn refresh_review_session(
    app: AppHandle,
    session_id: String,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::refresh_review_session(&root, session_id, head_sha))
        .await
}

#[tauri::command]
pub async fn start_review_agent(app: AppHandle, session_id: String) -> Result<(), String> {
    let root = remote_review_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        remote_review::start_review_agent(&root, session_id, move |event| {
            let _ = event_app.emit(remote_review::review_agent_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn ensure_review_chat_session(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let root = remote_review_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        remote_review::ensure_review_chat_session(&root, session_id, move |event| {
            let _ = event_app.emit(remote_review::review_chat_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn send_review_chat_message(
    session_id: String,
    turn_id: String,
    text: String,
) -> Result<(), String> {
    run_blocking_task(move || remote_review::send_review_chat_message(session_id, turn_id, text))
        .await
}

#[tauri::command]
pub async fn cancel_review_chat_turn(
    session_id: String,
    turn_id: String,
) -> Result<(), String> {
    run_blocking_task(move || remote_review::cancel_review_chat_turn(session_id, turn_id)).await
}

#[tauri::command]
pub async fn get_review_report(
    app: AppHandle,
    session_id: String,
) -> Result<Option<RemoteReviewReport>, String> {
    let root = remote_review_root(&app)?;
    run_blocking_task(move || remote_review::get_report(&root, session_id)).await
}
