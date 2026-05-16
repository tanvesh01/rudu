use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use agent_client_protocol::schema::{
    CancelNotification, ContentBlock, ContentChunk, Implementation, InitializeRequest,
    NewSessionRequest, PromptRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome, SessionId,
    SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::{Agent, Client, ConnectionTo};
use agent_client_protocol_tokio::{AcpAgent, LineDirection};
use serde::Serialize;
use tokio::sync::mpsc;

use super::pi;
use super::{RemoteReviewAcpPlanEntry, RemoteReviewAgentEvent, RemoteReviewChatEvent};

const PI_ACP_SCRIPT_FILE: &str = "run-pi-acp.sh";

type RemoteReviewAgentEmitter = Arc<dyn Fn(RemoteReviewAgentEvent) + Send + Sync + 'static>;
type RemoteReviewChatEmitter = Arc<dyn Fn(RemoteReviewChatEvent) + Send + Sync + 'static>;

#[derive(Default)]
struct AcpChatRuntimeState {
    active_turn_id: Option<String>,
}

impl AcpChatRuntimeState {
    fn begin_turn(&mut self, turn_id: String) -> Result<(), String> {
        if let Some(active_turn_id) = &self.active_turn_id {
            return Err(format!(
                "Remote review AI chat already has an active turn: {active_turn_id}"
            ));
        }

        self.active_turn_id = Some(turn_id);
        Ok(())
    }

    fn finish_turn(&mut self) -> Option<String> {
        self.active_turn_id.take()
    }

    fn is_active_turn(&self, turn_id: &str) -> bool {
        self.active_turn_id.as_deref() == Some(turn_id)
    }
}

enum AcpChatRuntimeCommand {
    SendPrompt {
        turn_id: String,
        text: String,
        result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    },
    CancelTurn {
        turn_id: String,
        result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    },
}

struct AcpChatRuntime {
    rudu_session_id: String,
    state: Arc<Mutex<AcpChatRuntimeState>>,
    command_tx: mpsc::UnboundedSender<AcpChatRuntimeCommand>,
    alive: Arc<AtomicBool>,
    emit_event: RemoteReviewChatEmitter,
}

impl AcpChatRuntime {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn send_prompt(&self, turn_id: String, text: String) -> Result<(), String> {
        if !self.is_alive() {
            return Err("Remote review AI chat runtime is not running.".to_string());
        }

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::SendPrompt {
                turn_id,
                text,
                result_tx,
            })
            .map_err(|_| "Remote review AI chat runtime is not running.".to_string())?;

        result_rx
            .recv()
            .unwrap_or_else(|_| Err("Remote review AI chat runtime stopped.".to_string()))
    }

    fn cancel_turn(&self, turn_id: &str) -> Result<(), String> {
        if !self.is_alive() {
            return Ok(());
        }

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::CancelTurn {
                turn_id: turn_id.to_string(),
                result_tx,
            })
            .map_err(|_| "Remote review AI chat runtime is not running.".to_string())?;

        result_rx
            .recv()
            .unwrap_or_else(|_| Err("Remote review AI chat runtime stopped.".to_string()))
    }

    fn current_turn_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.active_turn_id.clone())
    }

    fn emit_error_for_active_turn(&self, message: String) {
        if let Some(turn_id) = self.current_turn_id() {
            (self.emit_event)(RemoteReviewChatEvent::Error {
                session_id: self.rudu_session_id.clone(),
                turn_id,
                message,
            });
        }
    }
}

pub(super) fn start_agent_runtime<F, E>(
    rudu_session_id: String,
    session_dir: PathBuf,
    script_path: PathBuf,
    prompt: String,
    emit_event: F,
    on_error: E,
) -> Result<(), String>
where
    F: Fn(RemoteReviewAgentEvent) + Send + Sync + 'static,
    E: Fn(String) + Send + Sync + 'static,
{
    let emit_event: RemoteReviewAgentEmitter = Arc::new(emit_event);
    let stderr_session_id = rudu_session_id.clone();
    let stderr_emitter = Arc::clone(&emit_event);
    let agent = pi_acp_agent(&session_dir, &script_path)?.with_debug(move |line, direction| {
        if direction == LineDirection::Stderr && !line.trim().is_empty() {
            stderr_emitter(RemoteReviewAgentEvent::Thought {
                session_id: stderr_session_id.clone(),
                text: line.trim().to_string(),
            });
        }
    });
    let on_error = Arc::new(on_error);

    thread::spawn({
        let emit_event = Arc::clone(&emit_event);
        move || {
            let result = run_agent_runtime(
                rudu_session_id.clone(),
                session_dir,
                prompt,
                agent,
                emit_event,
            );
            if let Err(error) = result {
                on_error(error);
            }
        }
    });

    Ok(())
}

pub(super) fn start_chat_runtime<F>(
    rudu_session_id: String,
    session_dir: PathBuf,
    script_path: PathBuf,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewChatEvent) + Send + Sync + 'static,
{
    let (command_tx, command_rx) = mpsc::unbounded_channel();
    let (startup_tx, startup_rx) = std::sync::mpsc::channel();
    let startup_sent = Arc::new(AtomicBool::new(false));
    let runtime = Arc::new(AcpChatRuntime {
        rudu_session_id: rudu_session_id.clone(),
        state: Arc::new(Mutex::new(AcpChatRuntimeState::default())),
        command_tx,
        alive: Arc::new(AtomicBool::new(true)),
        emit_event: Arc::new(emit_event),
    });
    let debug_runtime = Arc::clone(&runtime);
    let agent = pi_acp_agent(&session_dir, &script_path)?.with_debug(move |line, direction| {
        if direction == LineDirection::Stderr && !line.trim().is_empty() {
            if let Some(turn_id) = debug_runtime.current_turn_id() {
                (debug_runtime.emit_event)(RemoteReviewChatEvent::Thought {
                    session_id: debug_runtime.rudu_session_id.clone(),
                    turn_id,
                    text: line.trim().to_string(),
                });
            }
        }
    });

    thread::spawn({
        let runtime = Arc::clone(&runtime);
        let startup_sent = Arc::clone(&startup_sent);
        move || {
            let result = run_chat_runtime(
                agent,
                session_dir,
                Arc::clone(&runtime),
                command_rx,
                startup_tx,
                startup_sent,
            );
            if let Err(error) = result {
                runtime.emit_error_for_active_turn(error);
            }
            runtime.alive.store(false, Ordering::SeqCst);
        }
    });

    match startup_rx.recv() {
        Ok(Ok(())) => {
            let mut runtimes = remote_review_chat_runtimes()
                .lock()
                .map_err(|_| "Remote review chat runtime registry is poisoned.".to_string())?;
            runtimes.insert(rudu_session_id, runtime);
            Ok(())
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err("Remote review AI chat runtime stopped during startup.".to_string()),
    }
}

pub(super) fn has_live_chat_runtime(session_id: &str) -> Result<bool, String> {
    let mut runtimes = remote_review_chat_runtimes()
        .lock()
        .map_err(|_| "Remote review chat runtime registry is poisoned.".to_string())?;
    if let Some(runtime) = runtimes.get(session_id) {
        if runtime.is_alive() {
            return Ok(true);
        }
    }
    runtimes.remove(session_id);
    Ok(false)
}

pub(super) fn send_chat_message(
    session_id: &str,
    turn_id: String,
    text: String,
) -> Result<(), String> {
    let runtime = get_remote_review_chat_runtime(session_id)?;
    runtime.send_prompt(turn_id, text)
}

pub(super) fn cancel_chat_turn(session_id: &str, turn_id: &str) -> Result<(), String> {
    let runtime = get_remote_review_chat_runtime(session_id)?;
    runtime.cancel_turn(turn_id)
}

fn remote_review_chat_runtimes() -> &'static Mutex<HashMap<String, Arc<AcpChatRuntime>>> {
    static RUNTIMES: OnceLock<Mutex<HashMap<String, Arc<AcpChatRuntime>>>> = OnceLock::new();
    RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_remote_review_chat_runtime(session_id: &str) -> Result<Arc<AcpChatRuntime>, String> {
    let mut runtimes = remote_review_chat_runtimes()
        .lock()
        .map_err(|_| "Remote review chat runtime registry is poisoned.".to_string())?;
    let Some(runtime) = runtimes.get(session_id).cloned() else {
        return Err(
            "Start the remote review AI chat session before sending a message.".to_string(),
        );
    };
    if runtime.is_alive() {
        return Ok(runtime);
    }
    runtimes.remove(session_id);
    Err("Remote review AI chat runtime is not running.".to_string())
}

fn run_agent_runtime(
    rudu_session_id: String,
    session_dir: PathBuf,
    prompt: String,
    agent: AcpAgent,
    emit_event: RemoteReviewAgentEmitter,
) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to start ACP runtime: {error}"))?;

    runtime.block_on(run_agent_runtime_async(
        rudu_session_id,
        session_dir,
        prompt,
        agent,
        emit_event,
    ))
}

async fn run_agent_runtime_async(
    rudu_session_id: String,
    session_dir: PathBuf,
    prompt: String,
    agent: AcpAgent,
    emit_event: RemoteReviewAgentEmitter,
) -> Result<(), String> {
    let notification_emitter = Arc::clone(&emit_event);
    let notification_session_id = rudu_session_id.clone();

    let result = Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _connection| {
                if let Some(event) =
                    agent_event_from_update(&notification_session_id, notification.update)
                {
                    notification_emitter(event);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                responder.respond(RequestPermissionResponse::new(permission_outcome(&request)))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection| async move {
            initialize_agent(&connection).await?;
            let acp_session_id = create_session(&connection, session_dir).await?;
            let response = connection
                .send_request(PromptRequest::new(acp_session_id, vec![prompt.into()]))
                .block_task()
                .await?;
            Ok(response.stop_reason)
        })
        .await;

    match result {
        Ok(stop_reason) => {
            emit_event(RemoteReviewAgentEvent::Finished {
                session_id: rudu_session_id,
                stop_reason: Some(serialized_name(&stop_reason)),
            });
            Ok(())
        }
        Err(error) => {
            let message = format!("pi-acp runtime failed: {error}");
            emit_event(RemoteReviewAgentEvent::Error {
                session_id: rudu_session_id,
                message: message.clone(),
            });
            Err(message)
        }
    }
}

fn run_chat_runtime(
    agent: AcpAgent,
    session_dir: PathBuf,
    runtime: Arc<AcpChatRuntime>,
    command_rx: mpsc::UnboundedReceiver<AcpChatRuntimeCommand>,
    startup_tx: std::sync::mpsc::Sender<Result<(), String>>,
    startup_sent: Arc<AtomicBool>,
) -> Result<(), String> {
    let tokio_runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to start ACP runtime: {error}"))?;

    tokio_runtime.block_on(run_chat_runtime_async(
        agent,
        session_dir,
        runtime,
        command_rx,
        startup_tx,
        startup_sent,
    ))
}

async fn run_chat_runtime_async(
    agent: AcpAgent,
    session_dir: PathBuf,
    runtime: Arc<AcpChatRuntime>,
    mut command_rx: mpsc::UnboundedReceiver<AcpChatRuntimeCommand>,
    startup_tx: std::sync::mpsc::Sender<Result<(), String>>,
    startup_sent: Arc<AtomicBool>,
) -> Result<(), String> {
    let notification_runtime = Arc::clone(&runtime);
    let startup_tx_for_connection = startup_tx.clone();
    let startup_sent_for_connection = Arc::clone(&startup_sent);

    let result = Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _connection| {
                if let Some(turn_id) = notification_runtime.current_turn_id() {
                    if let Some(event) = chat_event_from_update(
                        &notification_runtime.rudu_session_id,
                        &turn_id,
                        notification.update,
                    ) {
                        (notification_runtime.emit_event)(event);
                    }
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                responder.respond(RequestPermissionResponse::new(permission_outcome(&request)))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection| async move {
            initialize_agent(&connection).await?;
            let acp_session_id = create_session(&connection, session_dir).await?;
            startup_sent_for_connection.store(true, Ordering::SeqCst);
            let _ = startup_tx_for_connection.send(Ok(()));

            while let Some(command) = command_rx.recv().await {
                handle_chat_command(
                    command,
                    connection.clone(),
                    acp_session_id.clone(),
                    Arc::clone(&runtime),
                );
            }

            Ok(())
        })
        .await;

    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = format!("pi-acp runtime failed: {error}");
            if !startup_sent.swap(true, Ordering::SeqCst) {
                let _ = startup_tx.send(Err(message.clone()));
            }
            Err(message)
        }
    }
}

fn handle_chat_command(
    command: AcpChatRuntimeCommand,
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    runtime: Arc<AcpChatRuntime>,
) {
    match command {
        AcpChatRuntimeCommand::SendPrompt {
            turn_id,
            text,
            result_tx,
        } => {
            {
                let begin_result = runtime
                    .state
                    .lock()
                    .map_err(|_| "Remote review chat runtime state is poisoned.".to_string())
                    .and_then(|mut state| state.begin_turn(turn_id.clone()));

                if let Err(error) = begin_result {
                    let _ = result_tx.send(Err(error));
                    return;
                }
            }

            let _ = result_tx.send(Ok(()));
            let _ = tokio::spawn(send_prompt_task(
                connection,
                acp_session_id,
                runtime,
                turn_id,
                text,
            ));
        }
        AcpChatRuntimeCommand::CancelTurn { turn_id, result_tx } => {
            let is_active = runtime
                .state
                .lock()
                .map(|state| state.is_active_turn(&turn_id))
                .unwrap_or(false);

            if !is_active {
                let _ = result_tx.send(Ok(()));
                return;
            }

            let result = connection
                .send_notification(CancelNotification::new(acp_session_id))
                .map_err(|error| format!("Failed to cancel remote review AI chat turn: {error}"));
            let _ = result_tx.send(result);
        }
    }
}

async fn send_prompt_task(
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    runtime: Arc<AcpChatRuntime>,
    turn_id: String,
    text: String,
) -> Result<(), agent_client_protocol::Error> {
    let result = connection
        .send_request(PromptRequest::new(
            acp_session_id,
            vec![ContentBlock::Text(TextContent::new(text))],
        ))
        .block_task()
        .await;

    let finished_turn_id = runtime
        .state
        .lock()
        .ok()
        .and_then(|mut state| state.finish_turn())
        .unwrap_or(turn_id);

    match result {
        Ok(response) => {
            (runtime.emit_event)(RemoteReviewChatEvent::Finished {
                session_id: runtime.rudu_session_id.clone(),
                turn_id: finished_turn_id,
                stop_reason: Some(serialized_name(&response.stop_reason)),
            });
        }
        Err(error) => {
            (runtime.emit_event)(RemoteReviewChatEvent::Error {
                session_id: runtime.rudu_session_id.clone(),
                turn_id: finished_turn_id,
                message: format!("Remote review AI chat turn failed: {error}"),
            });
        }
    }

    Ok(())
}

async fn initialize_agent(
    connection: &ConnectionTo<Agent>,
) -> Result<(), agent_client_protocol::Error> {
    connection
        .send_request(InitializeRequest::new(ProtocolVersion::V1).client_info(
            Implementation::new("rudu", env!("CARGO_PKG_VERSION")).title("Rudu".to_string()),
        ))
        .block_task()
        .await?;
    Ok(())
}

async fn create_session(
    connection: &ConnectionTo<Agent>,
    session_dir: PathBuf,
) -> Result<SessionId, agent_client_protocol::Error> {
    let response = connection
        .send_request(NewSessionRequest::new(session_dir))
        .block_task()
        .await?;
    Ok(response.session_id)
}

fn pi_acp_agent(session_dir: &Path, script_path: &Path) -> Result<AcpAgent, String> {
    let launcher_path = prepare_pi_acp_launcher(session_dir, script_path)?;
    AcpAgent::from_args([launcher_path.to_string_lossy().to_string()])
        .map_err(|error| format!("Failed to configure pi-acp runtime: {error}"))
}

fn prepare_pi_acp_launcher(session_dir: &Path, script_path: &Path) -> Result<PathBuf, String> {
    let pi_acp_bin = pi::resolve_binary("RUDU_PI_ACP_BIN", "pi-acp");
    let launcher_path = session_dir.join(PI_ACP_SCRIPT_FILE);
    fs::write(
        &launcher_path,
        format!(
            r#"#!/usr/bin/env bash
set -euo pipefail

cd {session_dir}
export PI_ACP_PI_COMMAND={script_path}
export PI_SKIP_VERSION_CHECK=1
exec {pi_acp_bin} "$@"
"#,
            session_dir = sh_quote_path(session_dir),
            script_path = sh_quote_path(script_path),
            pi_acp_bin = sh_quote(&pi_acp_bin),
        ),
    )
    .map_err(|error| format!("Failed to write pi-acp launch script: {error}"))?;
    make_executable(&launcher_path)?;
    Ok(launcher_path)
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|error| format!("Failed to read script permissions: {error}"))?
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("Failed to make script executable: {error}"))?;
    }
    Ok(())
}

fn permission_outcome(request: &RequestPermissionRequest) -> RequestPermissionOutcome {
    request
        .options
        .first()
        .map(|option| {
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                option.option_id.clone(),
            ))
        })
        .unwrap_or(RequestPermissionOutcome::Cancelled)
}

fn agent_event_from_update(
    rudu_session_id: &str,
    update: SessionUpdate,
) -> Option<RemoteReviewAgentEvent> {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(RemoteReviewAgentEvent::Message {
            session_id: rudu_session_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::AgentThoughtChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(RemoteReviewAgentEvent::Thought {
            session_id: rudu_session_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::ToolCall(tool_call) => Some(RemoteReviewAgentEvent::Tool {
            session_id: rudu_session_id.to_string(),
            tool_call_id: Some(tool_call.tool_call_id.to_string()),
            title: Some(tool_call.title),
            status: Some(serialized_name(&tool_call.status)),
        }),
        SessionUpdate::ToolCallUpdate(tool_call) => Some(RemoteReviewAgentEvent::Tool {
            session_id: rudu_session_id.to_string(),
            tool_call_id: Some(tool_call.tool_call_id.to_string()),
            title: tool_call.fields.title,
            status: tool_call
                .fields
                .status
                .map(|status| serialized_name(&status)),
        }),
        SessionUpdate::Plan(plan) => Some(RemoteReviewAgentEvent::Thought {
            session_id: rudu_session_id.to_string(),
            text: summarize_plan_update(&plan),
        }),
        _ => None,
    }
}

fn chat_event_from_update(
    rudu_session_id: &str,
    turn_id: &str,
    update: SessionUpdate,
) -> Option<RemoteReviewChatEvent> {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(RemoteReviewChatEvent::Message {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::AgentThoughtChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(RemoteReviewChatEvent::Thought {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::ToolCall(tool_call) => Some(RemoteReviewChatEvent::Tool {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            tool_call_id: tool_call.tool_call_id.to_string(),
            title: Some(tool_call.title),
            status: Some(serialized_name(&tool_call.status)),
            raw_input: tool_call.raw_input,
            raw_output: tool_call.raw_output,
        }),
        SessionUpdate::ToolCallUpdate(tool_call) => Some(RemoteReviewChatEvent::Tool {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            tool_call_id: tool_call.tool_call_id.to_string(),
            title: tool_call.fields.title,
            status: tool_call
                .fields
                .status
                .map(|status| serialized_name(&status)),
            raw_input: tool_call.fields.raw_input,
            raw_output: tool_call.fields.raw_output,
        }),
        SessionUpdate::Plan(plan) => Some(RemoteReviewChatEvent::Plan {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            entries: plan_entries(&plan),
        }),
        _ => None,
    }
}

fn plan_entries(plan: &agent_client_protocol::schema::Plan) -> Vec<RemoteReviewAcpPlanEntry> {
    plan.entries
        .iter()
        .map(|entry| RemoteReviewAcpPlanEntry {
            content: entry.content.clone(),
            priority: serialized_name(&entry.priority),
            status: serialized_name(&entry.status),
        })
        .collect()
}

fn summarize_plan_update(plan: &agent_client_protocol::schema::Plan) -> String {
    let text = plan
        .entries
        .iter()
        .map(|entry| {
            format!(
                "{}: {}",
                serialized_name(&entry.status),
                entry.content.as_str()
            )
        })
        .collect::<Vec<String>>()
        .join("\n");

    if text.is_empty() {
        "Agent updated its plan.".to_string()
    } else {
        text
    }
}

fn serialized_name<T>(value: &T) -> String
where
    T: Serialize + std::fmt::Debug,
{
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{value:?}"))
}

fn sh_quote_path(path: &Path) -> String {
    sh_quote(&path.to_string_lossy())
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::{
        agent_event_from_update, chat_event_from_update, permission_outcome,
        prepare_pi_acp_launcher, serialized_name, AcpChatRuntimeState,
    };
    use crate::services::remote_review::{
        RemoteReviewAcpPlanEntry, RemoteReviewAgentEvent, RemoteReviewChatEvent,
    };
    use agent_client_protocol::schema::{
        PermissionOption, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
        SessionNotification, StopReason, ToolCallUpdate, ToolCallUpdateFields,
    };
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn translates_agent_message_chunks() {
        let event = agent_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}"#,
        );

        assert_eq!(
            event,
            Some(RemoteReviewAgentEvent::Message {
                session_id: "session-1".to_string(),
                text: "hello".to_string(),
            })
        );
    }

    #[test]
    fn translates_agent_thought_chunks() {
        let event = agent_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking"}}}"#,
        );

        assert_eq!(
            event,
            Some(RemoteReviewAgentEvent::Thought {
                session_id: "session-1".to_string(),
                text: "thinking".to_string(),
            })
        );
    }

    #[test]
    fn translates_tool_call_updates() {
        let event = agent_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","title":"Read file","status":"completed"}}"#,
        );

        assert_eq!(
            event,
            Some(RemoteReviewAgentEvent::Tool {
                session_id: "session-1".to_string(),
                tool_call_id: Some("call-1".to_string()),
                title: Some("Read file".to_string()),
                status: Some("completed".to_string()),
            })
        );
    }

    #[test]
    fn translates_chat_tool_updates_with_raw_io() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","title":"Read file","status":"completed","rawInput":{"path":"src/lib.rs"},"rawOutput":"ok"}}"#,
        );

        assert_eq!(
            event,
            Some(RemoteReviewChatEvent::Tool {
                session_id: "session-1".to_string(),
                turn_id: "turn-1".to_string(),
                tool_call_id: "call-1".to_string(),
                title: Some("Read file".to_string()),
                status: Some("completed".to_string()),
                raw_input: Some(json!({ "path": "src/lib.rs" })),
                raw_output: Some(json!("ok")),
            })
        );
    }

    #[test]
    fn translates_chat_plan_as_structured_entries() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"plan","entries":[{"content":"Read diff","priority":"high","status":"completed"},{"content":"Inspect file","priority":"medium","status":"in_progress"}]}}"#,
        );

        assert_eq!(
            event,
            Some(RemoteReviewChatEvent::Plan {
                session_id: "session-1".to_string(),
                turn_id: "turn-1".to_string(),
                entries: vec![
                    RemoteReviewAcpPlanEntry {
                        content: "Read diff".to_string(),
                        priority: "high".to_string(),
                        status: "completed".to_string(),
                    },
                    RemoteReviewAcpPlanEntry {
                        content: "Inspect file".to_string(),
                        priority: "medium".to_string(),
                        status: "in_progress".to_string(),
                    },
                ],
            })
        );
    }

    #[test]
    fn serializes_stop_reasons_with_acp_wire_names() {
        assert_eq!(serialized_name(&StopReason::EndTurn), "end_turn");
        assert_eq!(serialized_name(&StopReason::Cancelled), "cancelled");
    }

    #[test]
    fn ignores_unsupported_typed_updates() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"available_commands_update","availableCommands":[]}}"#,
        );

        assert_eq!(event, None);
    }

    #[test]
    fn malformed_acp_json_fails_schema_deserialization() {
        let error = serde_json::from_str::<SessionNotification>("{").unwrap_err();
        assert!(error.to_string().contains("EOF"));
    }

    #[test]
    fn auto_selects_first_permission_option() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new("call-1", ToolCallUpdateFields::new()),
            vec![PermissionOption::new(
                "allow-once",
                "Allow once",
                PermissionOptionKind::AllowOnce,
            )],
        );

        assert!(matches!(
            permission_outcome(&request),
            RequestPermissionOutcome::Selected(outcome) if outcome.option_id.to_string() == "allow-once"
        ));
    }

    #[test]
    fn cancels_permission_request_without_options() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new("call-1", ToolCallUpdateFields::new()),
            Vec::new(),
        );

        assert_eq!(
            permission_outcome(&request),
            RequestPermissionOutcome::Cancelled
        );
    }

    #[test]
    fn tracks_one_chat_turn_at_a_time() {
        let mut state = AcpChatRuntimeState::default();

        state
            .begin_turn("turn-1".to_string())
            .expect("first turn starts");
        assert!(state.begin_turn("turn-2".to_string()).is_err());
        assert!(state.is_active_turn("turn-1"));
        assert_eq!(state.finish_turn(), Some("turn-1".to_string()));
        assert!(!state.is_active_turn("turn-1"));

        state
            .begin_turn("turn-2".to_string())
            .expect("next turn starts");
        assert!(state.is_active_turn("turn-2"));
    }

    #[test]
    fn pi_acp_launcher_disables_version_check_noise() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let session_dir = std::env::temp_dir().join(format!("rudu-pi-acp-launcher-test-{unique}"));
        fs::create_dir_all(&session_dir).expect("create test session dir");

        let launcher_path =
            prepare_pi_acp_launcher(&session_dir, &session_dir.join("run-pi-review.sh"))
                .expect("write launcher");

        let launcher = fs::read_to_string(launcher_path).expect("read launcher");
        assert!(launcher.contains("export PI_SKIP_VERSION_CHECK=1"));

        fs::remove_dir_all(session_dir).expect("cleanup test session dir");
    }

    fn agent_event_from_json(json: &str) -> Option<RemoteReviewAgentEvent> {
        let notification: SessionNotification = serde_json::from_str(json).unwrap();
        agent_event_from_update("session-1", notification.update)
    }

    fn chat_event_from_json(json: &str) -> Option<RemoteReviewChatEvent> {
        let notification: SessionNotification = serde_json::from_str(json).unwrap();
        chat_event_from_update("session-1", "turn-1", notification.update)
    }
}
