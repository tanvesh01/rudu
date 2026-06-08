use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{ReviewChatReadinessStatus, ReviewSession, ReviewWalkthrough};
use crate::services::review_session::{self, ReviewChatTranscript};

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
pub async fn get_review_chat_readiness(
    app: AppHandle,
) -> Result<ReviewChatReadinessStatus, String> {
    let event_app = app.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        review_session::get_review_chat_readiness(move |event| {
            let _ = event_app.emit(
                review_session::review_chat_adapter_install_event_name(),
                event,
            );
        })
    })
    .await
    .map_err(|error| format!("Blocking task failed: {error}"))?)
}

#[tauri::command]
pub async fn get_review_chat_readiness_for_runtime(
    app: AppHandle,
    runtime: String,
) -> Result<ReviewChatReadinessStatus, String> {
    let event_app = app.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        review_session::get_review_chat_readiness_for_runtime(runtime, move |event| {
            let _ = event_app.emit(
                review_session::review_chat_adapter_install_event_name(),
                event,
            );
        })
    })
    .await
    .map_err(|error| format!("Blocking task failed: {error}"))?)
}

#[tauri::command]
pub async fn list_opencode_models() -> Result<Vec<String>, String> {
    run_blocking_task(review_session::list_opencode_models).await
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
pub async fn load_review_session(
    app: AppHandle,
    repo: String,
    number: u32,
) -> Result<Option<ReviewSession>, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || review_session::load_review_session(&root, repo, number)).await
}

#[tauri::command]
pub async fn refresh_review_session(
    app: AppHandle,
    session_id: String,
    head_sha: String,
    message_count: u32,
) -> Result<ReviewSession, String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::refresh_review_session(
            &root,
            session_id,
            head_sha,
            message_count,
            move |event| {
                let _ = event_app.emit(review_session::review_workspace_event_name(), event);
            },
        )
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
pub async fn generate_review_walkthrough(
    app: AppHandle,
    session_id: String,
) -> Result<ReviewWalkthrough, String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::generate_review_walkthrough(&root, session_id, move |event| {
            let _ = event_app.emit(review_session::review_walkthrough_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn run_review_walkthrough_turn(
    app: AppHandle,
    session_id: String,
    turn_id: String,
    review_effort_mode: String,
) -> Result<ReviewChatTranscript, String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::run_review_walkthrough_turn(
            &root,
            session_id,
            turn_id,
            review_effort_mode,
            move |event| {
                let _ = event_app.emit(review_session::review_walkthrough_event_name(), event);
            },
        )
    })
    .await
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
    message_count: u32,
) -> Result<(), String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::set_review_chat_effort_mode(
            &root,
            session_id,
            mode,
            message_count,
            move |event| {
                let _ = event_app.emit(review_session::review_chat_event_name(), event);
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn switch_review_chat_runtime(
    app: AppHandle,
    session_id: String,
    runtime: String,
    runtime_model_choice: Option<String>,
) -> Result<ReviewSession, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || {
        review_session::switch_review_chat_runtime(&root, session_id, runtime, runtime_model_choice)
    })
    .await
}

#[tauri::command]
pub async fn reset_review_chat_session(
    app: AppHandle,
    session_id: String,
) -> Result<ReviewSession, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || review_session::reset_review_chat_session(&root, session_id)).await
}

#[tauri::command]
pub async fn set_runtime_model_choice(
    app: AppHandle,
    session_id: String,
    model: String,
) -> Result<ReviewSession, String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::set_runtime_model_choice(&root, session_id, model, move |event| {
            let _ = event_app.emit(review_session::review_chat_event_name(), event);
        })
    })
    .await
}

#[tauri::command]
pub async fn set_pending_review_chat_effort_mode(
    app: AppHandle,
    session_id: String,
    mode: String,
) -> Result<(), String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || {
        review_session::set_pending_review_chat_effort_mode(&root, session_id, mode)
    })
    .await
}

#[tauri::command]
pub async fn load_review_chat_transcript(
    app: AppHandle,
    session_id: String,
) -> Result<ReviewChatTranscript, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || review_session::load_review_chat_transcript(&root, session_id)).await
}

#[tauri::command]
pub async fn save_review_chat_transcript(
    app: AppHandle,
    session_id: String,
    messages: Vec<serde_json::Value>,
) -> Result<(), String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || {
        review_session::save_review_chat_transcript(&root, session_id, messages)
    })
    .await
}

#[tauri::command]
pub async fn complete_review_chat_turn(
    app: AppHandle,
    session_id: String,
    turn_id: String,
    terminal_message: serde_json::Value,
) -> Result<ReviewChatTranscript, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || {
        review_session::complete_review_chat_turn(&root, session_id, turn_id, terminal_message)
    })
    .await
}

#[tauri::command]
pub async fn send_review_chat_message(
    app: AppHandle,
    session_id: String,
    turn_id: String,
    text: String,
    user_message: serde_json::Value,
) -> Result<(), String> {
    let root = review_session_root(&app)?;
    let event_app = app.clone();
    run_blocking_task(move || {
        review_session::send_review_chat_message(
            &root,
            session_id,
            turn_id,
            text,
            user_message,
            move |event| {
                let _ = event_app.emit(review_session::review_chat_event_name(), event);
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn cancel_review_chat_turn(
    app: AppHandle,
    session_id: String,
    turn_id: String,
) -> Result<ReviewChatTranscript, String> {
    let root = review_session_root(&app)?;
    run_blocking_task(move || review_session::cancel_review_chat_turn(&root, session_id, turn_id))
        .await
}
