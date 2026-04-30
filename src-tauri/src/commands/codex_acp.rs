use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SessionNotification, TextContent,
};
use agent_client_protocol::{Agent, ConnectionTo};
use agent_client_protocol_tokio::AcpAgent;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

const CODEX_ACP_EVENT: &str = "codex-acp-event";
const DEFAULT_CODEX_ACP_COMMAND: &str = "bunx @zed-industries/codex-acp@0.12.0";

static CODEX_WORKER: OnceLock<Mutex<Option<CodexWorkerHandle>>> = OnceLock::new();

#[derive(Clone)]
struct CodexWorkerHandle {
    local_session_id: String,
    tx: mpsc::UnboundedSender<CodexWorkerCommand>,
}

enum CodexWorkerCommand {
    Prompt { prompt_id: String, text: String },
    Stop,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexStartSessionResponse {
    pub local_session_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexAcpEvent {
    kind: String,
    local_session_id: String,
    prompt_id: Option<String>,
    message: Option<String>,
    raw: Option<serde_json::Value>,
}

fn worker_slot() -> &'static Mutex<Option<CodexWorkerHandle>> {
    CODEX_WORKER.get_or_init(|| Mutex::new(None))
}

fn make_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{prefix}-{millis}")
}

fn emit_event(app: &AppHandle, event: CodexAcpEvent) {
    let _ = app.emit(CODEX_ACP_EVENT, event);
}

fn codex_command() -> String {
    std::env::var("RUDU_CODEX_ACP_COMMAND")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CODEX_ACP_COMMAND.to_string())
}

fn normalize_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    if let Some(cwd) = cwd {
        let trimmed = cwd.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            return if path.is_absolute() {
                Ok(path)
            } else {
                std::env::current_dir()
                    .map(|current| current.join(path))
                    .map_err(|error| format!("Failed to resolve cwd: {error}"))
            };
        }
    }

    std::env::current_dir().map_err(|error| format!("Failed to read current dir: {error}"))
}

#[tauri::command]
pub async fn codex_acp_start_session(
    app: AppHandle,
    cwd: Option<String>,
) -> Result<CodexStartSessionResponse, String> {
    let slot = worker_slot();
    {
        let guard = slot
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        if let Some(handle) = guard.as_ref() {
            return Ok(CodexStartSessionResponse {
                local_session_id: handle.local_session_id.clone(),
            });
        }
    }

    let cwd = normalize_cwd(cwd)?;
    let local_session_id = make_id("codex-local-session");
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = CodexWorkerHandle {
        local_session_id: local_session_id.clone(),
        tx,
    };

    {
        let mut guard = slot
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        *guard = Some(handle);
    }

    tauri::async_runtime::spawn(run_codex_worker(app, local_session_id.clone(), cwd, rx));

    Ok(CodexStartSessionResponse { local_session_id })
}

#[tauri::command]
pub async fn codex_acp_send_prompt(text: String) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Prompt is required".into());
    }

    let prompt_id = make_id("codex-prompt");
    let tx = {
        let guard = worker_slot()
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        guard
            .as_ref()
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| "Codex session has not been started".to_string())?
    };

    tx.send(CodexWorkerCommand::Prompt {
        prompt_id: prompt_id.clone(),
        text,
    })
    .map_err(|_| "Codex worker is not running".to_string())?;

    Ok(prompt_id)
}

#[tauri::command]
pub async fn codex_acp_stop_session() -> Result<(), String> {
    let handle = {
        let mut guard = worker_slot()
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        guard.take()
    };

    if let Some(handle) = handle {
        let _ = handle.tx.send(CodexWorkerCommand::Stop);
    }

    Ok(())
}

async fn run_codex_worker(
    app: AppHandle,
    local_session_id: String,
    cwd: PathBuf,
    mut rx: mpsc::UnboundedReceiver<CodexWorkerCommand>,
) {
    emit_event(
        &app,
        CodexAcpEvent {
            kind: "starting".into(),
            local_session_id: local_session_id.clone(),
            prompt_id: None,
            message: Some(format!("Starting `{}`", codex_command())),
            raw: None,
        },
    );

    let agent = match AcpAgent::from_str(&codex_command()) {
        Ok(agent) => agent,
        Err(error) => {
            emit_worker_error(
                &app,
                &local_session_id,
                format!("Invalid Codex ACP command: {error}"),
            );
            clear_worker(&local_session_id);
            return;
        }
    };

    let notification_app = app.clone();
    let notification_session_id = local_session_id.clone();
    let permission_app = app.clone();
    let permission_session_id = local_session_id.clone();
    let worker_app = app.clone();
    let worker_session_id = local_session_id.clone();

    let result = agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                let raw = serde_json::to_value(&notification).ok();
                emit_event(
                    &notification_app,
                    CodexAcpEvent {
                        kind: "sessionUpdate".into(),
                        local_session_id: notification_session_id.clone(),
                        prompt_id: None,
                        message: extract_notification_text(raw.as_ref()),
                        raw,
                    },
                );
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                let raw = serde_json::to_value(&request).ok();
                emit_event(
                    &permission_app,
                    CodexAcpEvent {
                        kind: "permissionRequested".into(),
                        local_session_id: permission_session_id.clone(),
                        prompt_id: None,
                        message: Some(
                            "Codex requested permission; cancelling by default in this MVP.".into(),
                        ),
                        raw,
                    },
                );

                responder.respond(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            emit_event(
                &worker_app,
                CodexAcpEvent {
                    kind: "initializing".into(),
                    local_session_id: worker_session_id.clone(),
                    prompt_id: None,
                    message: None,
                    raw: None,
                },
            );

            let init_response = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            emit_event(
                &worker_app,
                CodexAcpEvent {
                    kind: "initialized".into(),
                    local_session_id: worker_session_id.clone(),
                    prompt_id: None,
                    message: Some(format!("{:?}", init_response.agent_info)),
                    raw: serde_json::to_value(&init_response).ok(),
                },
            );

            let new_session_response = connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?;
            let session_id = new_session_response.session_id.clone();

            emit_event(
                &worker_app,
                CodexAcpEvent {
                    kind: "sessionStarted".into(),
                    local_session_id: worker_session_id.clone(),
                    prompt_id: None,
                    message: Some(format!("{:?}", session_id)),
                    raw: serde_json::to_value(&new_session_response).ok(),
                },
            );

            while let Some(command) = rx.recv().await {
                match command {
                    CodexWorkerCommand::Prompt { prompt_id, text } => {
                        emit_event(
                            &worker_app,
                            CodexAcpEvent {
                                kind: "promptStarted".into(),
                                local_session_id: worker_session_id.clone(),
                                prompt_id: Some(prompt_id.clone()),
                                message: None,
                                raw: None,
                            },
                        );

                        match connection
                            .send_request(PromptRequest::new(
                                session_id.clone(),
                                vec![ContentBlock::Text(TextContent::new(text))],
                            ))
                            .block_task()
                            .await
                        {
                            Ok(response) => emit_event(
                                &worker_app,
                                CodexAcpEvent {
                                    kind: "promptDone".into(),
                                    local_session_id: worker_session_id.clone(),
                                    prompt_id: Some(prompt_id),
                                    message: Some(format!("{:?}", response.stop_reason)),
                                    raw: serde_json::to_value(&response).ok(),
                                },
                            ),
                            Err(error) => emit_event(
                                &worker_app,
                                CodexAcpEvent {
                                    kind: "error".into(),
                                    local_session_id: worker_session_id.clone(),
                                    prompt_id: Some(prompt_id),
                                    message: Some(error.to_string()),
                                    raw: None,
                                },
                            ),
                        }
                    }
                    CodexWorkerCommand::Stop => break,
                }
            }

            Ok(())
        })
        .await;

    if let Err(error) = result {
        emit_worker_error(&app, &local_session_id, error.to_string());
    }

    clear_worker(&local_session_id);
    emit_event(
        &app,
        CodexAcpEvent {
            kind: "stopped".into(),
            local_session_id,
            prompt_id: None,
            message: None,
            raw: None,
        },
    );
}

fn emit_worker_error(app: &AppHandle, local_session_id: &str, message: String) {
    emit_event(
        app,
        CodexAcpEvent {
            kind: "error".into(),
            local_session_id: local_session_id.to_string(),
            prompt_id: None,
            message: Some(message),
            raw: None,
        },
    );
}

fn clear_worker(local_session_id: &str) {
    if let Ok(mut guard) = worker_slot().lock() {
        if guard
            .as_ref()
            .map(|handle| handle.local_session_id == local_session_id)
            .unwrap_or(false)
        {
            *guard = None;
        }
    }
}

fn extract_notification_text(raw: Option<&serde_json::Value>) -> Option<String> {
    let value = raw?;
    find_text_value(value).filter(|text| !text.trim().is_empty())
}

fn find_text_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|value| value.as_str()) {
                return Some(text.to_string());
            }
            if let Some(content) = map.get("content") {
                if let Some(text) = find_text_value(content) {
                    return Some(text);
                }
            }
            for value in map.values() {
                if let Some(text) = find_text_value(value) {
                    return Some(text);
                }
            }
            None
        }
        serde_json::Value::Array(items) => items.iter().find_map(find_text_value),
        _ => None,
    }
}
