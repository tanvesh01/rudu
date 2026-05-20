use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::ReviewSession;
use crate::services::review_session;

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

fn review_session_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve("review", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve Rudu directory: {error}"))
}

#[tauri::command]
pub async fn prepare_review_workspace(
    app: AppHandle,
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<ReviewSession, String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::prepare_workspace(&root, repo, number, head_sha, move |event| {
            let _ = event_app.emit(review_session::review_workspace_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn refresh_review_session(
    app: AppHandle,
    session_id: String,
    head_sha: String,
) -> Result<ReviewSession, String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::refresh_review_session(&root, session_id, head_sha, move |event| {
            let _ = event_app.emit(review_session::review_workspace_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn list_review_workspace_files(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<String>, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || review_session::list_workspace_files(&root, session_id)).await
}

#[tauri::command]
pub async fn ensure_review_chat_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::ensure_review_chat_session(&root, session_id, move |event| {
            let _ = event_app.emit(review_session::review_chat_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn set_review_chat_effort_mode(
    app: AppHandle,
    session_id: String,
    mode: String,
) -> Result<(), String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::set_review_chat_effort_mode(&root, session_id, mode, move |event| {
            let _ = event_app.emit(review_session::review_chat_event_name(), event);
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
    run_blocking_task(move || review_session::send_review_chat_message(session_id, turn_id, text))
        .await
}

#[tauri::command]
pub async fn cancel_review_chat_turn(session_id: String, turn_id: String) -> Result<(), String> {
    run_blocking_task(move || review_session::cancel_review_chat_turn(session_id, turn_id)).await
}
