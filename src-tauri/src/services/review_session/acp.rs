use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use agent_client_protocol::schema::{
    CancelNotification, ContentBlock, ContentChunk, Implementation, InitializeRequest,
    LoadSessionRequest, NewSessionRequest, PermissionOptionKind, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::{Agent, Client, ConnectionTo};
use agent_client_protocol_tokio::{AcpAgent, LineDirection};
use serde::Serialize;
use tokio::sync::mpsc;

use super::{ReviewChatAcpPlanEntry, ReviewChatEvent};

const CODEX_ACP_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_ACP_BIN", "RUDU_CODEX_ACP_PATH"];

type ReviewChatEmitter = Arc<dyn Fn(ReviewChatEvent) + Send + Sync + 'static>;

#[derive(Default)]
struct AcpChatRuntimeState {
    active_turn_id: Option<String>,
}

impl AcpChatRuntimeState {
    fn begin_turn(&mut self, turn_id: String) -> Result<(), String> {
        if let Some(active_turn_id) = &self.active_turn_id {
            return Err(format!(
                "Rudu chat already has an active turn: {active_turn_id}"
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
    SendContextNotice {
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
    emit_event: ReviewChatEmitter,
}

impl AcpChatRuntime {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn send_prompt(&self, turn_id: String, text: String) -> Result<(), String> {
        if !self.is_alive() {
            return Err("Rudu chat runtime is not running.".to_string());
        }

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::SendPrompt {
                turn_id,
                text,
                result_tx,
            })
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()))
    }

    fn send_context_notice(&self, text: String) -> Result<(), String> {
        if !self.is_alive() {
            return Ok(());
        }

        if self.current_turn_id().is_some() {
            return Err("Stop the active Rudu chat turn before refreshing the PR.".to_string());
        }

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::SendContextNotice { text, result_tx })
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()))
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
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()))
    }

    fn current_turn_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.active_turn_id.clone())
    }

    fn emit_error_for_active_turn(&self, message: String) {
        if let Some(turn_id) = self.current_turn_id() {
            (self.emit_event)(ReviewChatEvent::Error {
                session_id: self.rudu_session_id.clone(),
                turn_id,
                message,
            });
        }
    }
}

pub(super) fn start_chat_runtime<F>(
    rudu_session_id: String,
    repo_dir: PathBuf,
    agent_session_id: Option<String>,
    emit_event: F,
) -> Result<String, String>
where
    F: Fn(ReviewChatEvent) + Send + Sync + 'static,
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
    let agent = codex_acp_agent()?.with_debug(move |line, direction| {
        if direction == LineDirection::Stderr && !line.trim().is_empty() {
            if let Some(turn_id) = debug_runtime.current_turn_id() {
                (debug_runtime.emit_event)(ReviewChatEvent::Thought {
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
                repo_dir,
                agent_session_id,
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
        Ok(Ok(started_agent_session_id)) => {
            let mut runtimes = review_chat_runtimes()
                .lock()
                .map_err(|_| "Rudu chat runtime registry is poisoned.".to_string())?;
            runtimes.insert(rudu_session_id, runtime);
            Ok(started_agent_session_id)
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err("Rudu chat runtime stopped during startup.".to_string()),
    }
}

pub(super) fn has_live_chat_runtime(session_id: &str) -> Result<bool, String> {
    let mut runtimes = review_chat_runtimes()
        .lock()
        .map_err(|_| "Rudu chat runtime registry is poisoned.".to_string())?;
    if let Some(runtime) = runtimes.get(session_id) {
        if runtime.is_alive() {
            return Ok(true);
        }
    }
    runtimes.remove(session_id);
    Ok(false)
}

pub(super) fn has_active_chat_turn(session_id: &str) -> Result<bool, String> {
    let runtime = get_review_chat_runtime(session_id)?;
    Ok(runtime.current_turn_id().is_some())
}

pub(super) fn send_chat_message(
    session_id: &str,
    turn_id: String,
    text: String,
) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.send_prompt(turn_id, text)
}

pub(super) fn send_context_notice(session_id: &str, text: String) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.send_context_notice(text)
}

pub(super) fn cancel_chat_turn(session_id: &str, turn_id: &str) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.cancel_turn(turn_id)
}

fn review_chat_runtimes() -> &'static Mutex<HashMap<String, Arc<AcpChatRuntime>>> {
    static RUNTIMES: OnceLock<Mutex<HashMap<String, Arc<AcpChatRuntime>>>> = OnceLock::new();
    RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_review_chat_runtime(session_id: &str) -> Result<Arc<AcpChatRuntime>, String> {
    let mut runtimes = review_chat_runtimes()
        .lock()
        .map_err(|_| "Rudu chat runtime registry is poisoned.".to_string())?;
    let Some(runtime) = runtimes.get(session_id).cloned() else {
        return Err("Start the Rudu chat session before sending a message.".to_string());
    };
    if runtime.is_alive() {
        return Ok(runtime);
    }
    runtimes.remove(session_id);
    Err("Rudu chat runtime is not running.".to_string())
}

fn run_chat_runtime(
    agent: AcpAgent,
    repo_dir: PathBuf,
    agent_session_id: Option<String>,
    runtime: Arc<AcpChatRuntime>,
    command_rx: mpsc::UnboundedReceiver<AcpChatRuntimeCommand>,
    startup_tx: std::sync::mpsc::Sender<Result<String, String>>,
    startup_sent: Arc<AtomicBool>,
) -> Result<(), String> {
    let tokio_runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to start ACP runtime: {error}"))?;

    tokio_runtime.block_on(run_chat_runtime_async(
        agent,
        repo_dir,
        agent_session_id,
        runtime,
        command_rx,
        startup_tx,
        startup_sent,
    ))
}

async fn run_chat_runtime_async(
    agent: AcpAgent,
    repo_dir: PathBuf,
    agent_session_id: Option<String>,
    runtime: Arc<AcpChatRuntime>,
    mut command_rx: mpsc::UnboundedReceiver<AcpChatRuntimeCommand>,
    startup_tx: std::sync::mpsc::Sender<Result<String, String>>,
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
            let acp_session_id =
                create_or_load_session(&connection, repo_dir, agent_session_id).await?;
            startup_sent_for_connection.store(true, Ordering::SeqCst);
            let _ = startup_tx_for_connection.send(Ok(acp_session_id.to_string()));

            while let Some(command) = command_rx.recv().await {
                if !handle_chat_command(
                    command,
                    connection.clone(),
                    acp_session_id.clone(),
                    Arc::clone(&runtime),
                ) {
                    break;
                }
            }

            Ok(())
        })
        .await;

    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = format!("codex-acp runtime failed: {error}");
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
) -> bool {
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
                    .map_err(|_| "Rudu chat runtime state is poisoned.".to_string())
                    .and_then(|mut state| state.begin_turn(turn_id.clone()));

                if let Err(error) = begin_result {
                    let _ = result_tx.send(Err(error));
                    return true;
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
            true
        }
        AcpChatRuntimeCommand::SendContextNotice { text, result_tx } => {
            let has_active_turn = runtime
                .state
                .lock()
                .map(|state| state.active_turn_id.is_some())
                .unwrap_or(true);
            if has_active_turn {
                let _ = result_tx.send(Err(
                    "Stop the active Rudu chat turn before refreshing the PR.".to_string(),
                ));
                return true;
            }

            let _ = tokio::spawn(send_context_notice_task(
                connection,
                acp_session_id,
                text,
                result_tx,
            ));
            true
        }
        AcpChatRuntimeCommand::CancelTurn { turn_id, result_tx } => {
            let is_active = runtime
                .state
                .lock()
                .map(|state| state.is_active_turn(&turn_id))
                .unwrap_or(false);

            if !is_active {
                let _ = result_tx.send(Ok(()));
                return true;
            }

            let result = connection
                .send_notification(CancelNotification::new(acp_session_id))
                .map_err(|error| format!("Failed to cancel Rudu chat turn: {error}"));
            let _ = result_tx.send(result);
            true
        }
    }
}

async fn send_context_notice_task(
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    text: String,
    result_tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), agent_client_protocol::Error> {
    let result = connection
        .send_request(PromptRequest::new(
            acp_session_id,
            vec![ContentBlock::Text(TextContent::new(text))],
        ))
        .block_task()
        .await
        .map(|_| ())
        .map_err(|error| format!("Failed to send Rudu context update: {error}"));

    let _ = result_tx.send(result);
    Ok(())
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
            (runtime.emit_event)(ReviewChatEvent::Finished {
                session_id: runtime.rudu_session_id.clone(),
                turn_id: finished_turn_id,
                stop_reason: Some(serialized_name(&response.stop_reason)),
            });
        }
        Err(error) => {
            (runtime.emit_event)(ReviewChatEvent::Error {
                session_id: runtime.rudu_session_id.clone(),
                turn_id: finished_turn_id,
                message: format!("Rudu chat turn failed: {error}"),
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

async fn create_or_load_session(
    connection: &ConnectionTo<Agent>,
    repo_dir: PathBuf,
    agent_session_id: Option<String>,
) -> Result<SessionId, agent_client_protocol::Error> {
    if let Some(agent_session_id) = agent_session_id {
        let session_id = SessionId::new(agent_session_id);
        connection
            .send_request(LoadSessionRequest::new(session_id.clone(), repo_dir))
            .block_task()
            .await?;
        return Ok(session_id);
    }

    let response = connection
        .send_request(NewSessionRequest::new(repo_dir))
        .block_task()
        .await?;
    Ok(response.session_id)
}

fn codex_acp_agent() -> Result<AcpAgent, String> {
    let codex_acp_bin = resolve_binary(CODEX_ACP_BIN_ENV_VARS, "codex-acp");
    AcpAgent::from_args([
        codex_acp_bin,
        "-c".to_string(),
        "sandbox_mode=read-only".to_string(),
        "-c".to_string(),
        "approval_policy=never".to_string(),
        "-c".to_string(),
        "hide_agent_reasoning=false".to_string(),
        "-c".to_string(),
        "model_reasoning_summary=\"auto\"".to_string(),
    ])
    .map_err(|error| format!("Failed to configure codex-acp runtime: {error}"))
}

fn resolve_binary(env_vars: &[&str], bin_name: &str) -> String {
    for env_var in env_vars {
        if let Ok(value) = std::env::var(env_var) {
            let value = value.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }

    project_binary_candidates(bin_name)
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| bin_name.to_string())
}

fn project_binary_candidates(bin_name: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = option_env!("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        roots.push(root);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    roots
        .into_iter()
        .map(|root| root.join("node_modules").join(".bin").join(bin_name))
        .collect()
}

fn permission_outcome(request: &RequestPermissionRequest) -> RequestPermissionOutcome {
    request
        .options
        .iter()
        .find(|option| {
            matches!(
                option.kind,
                PermissionOptionKind::RejectAlways | PermissionOptionKind::RejectOnce
            )
        })
        .map(|option| {
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                option.option_id.clone(),
            ))
        })
        .unwrap_or(RequestPermissionOutcome::Cancelled)
}

fn chat_event_from_update(
    rudu_session_id: &str,
    turn_id: &str,
    update: SessionUpdate,
) -> Option<ReviewChatEvent> {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(ReviewChatEvent::Message {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::AgentThoughtChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(ReviewChatEvent::Thought {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::ToolCall(tool_call) => Some(ReviewChatEvent::Tool {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            tool_call_id: tool_call.tool_call_id.to_string(),
            title: Some(tool_call.title),
            status: Some(serialized_name(&tool_call.status)),
            raw_input: tool_call.raw_input,
            raw_output: tool_call.raw_output,
        }),
        SessionUpdate::ToolCallUpdate(tool_call) => Some(ReviewChatEvent::Tool {
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
        SessionUpdate::Plan(plan) => Some(ReviewChatEvent::Plan {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            entries: plan_entries(&plan),
        }),
        _ => None,
    }
}

fn plan_entries(plan: &agent_client_protocol::schema::Plan) -> Vec<ReviewChatAcpPlanEntry> {
    plan.entries
        .iter()
        .map(|entry| ReviewChatAcpPlanEntry {
            content: entry.content.clone(),
            priority: serialized_name(&entry.priority),
            status: serialized_name(&entry.status),
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::{chat_event_from_update, permission_outcome, serialized_name, AcpChatRuntimeState};
    use crate::services::review_session::{ReviewChatAcpPlanEntry, ReviewChatEvent};
    use agent_client_protocol::schema::{
        PermissionOption, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
        SessionNotification, StopReason, ToolCallUpdate, ToolCallUpdateFields,
    };
    use serde_json::json;

    #[test]
    fn translates_chat_tool_updates_with_raw_io() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","title":"Read file","status":"completed","rawInput":{"path":"src/lib.rs"},"rawOutput":"ok"}}"#,
        );

        assert_eq!(
            event,
            Some(ReviewChatEvent::Tool {
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
            Some(ReviewChatEvent::Plan {
                session_id: "session-1".to_string(),
                turn_id: "turn-1".to_string(),
                entries: vec![
                    ReviewChatAcpPlanEntry {
                        content: "Read diff".to_string(),
                        priority: "high".to_string(),
                        status: "completed".to_string(),
                    },
                    ReviewChatAcpPlanEntry {
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
    fn auto_rejects_permission_request_when_reject_option_exists() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new("call-1", ToolCallUpdateFields::new()),
            vec![
                PermissionOption::new("allow-once", "Allow once", PermissionOptionKind::AllowOnce),
                PermissionOption::new(
                    "reject-once",
                    "Reject once",
                    PermissionOptionKind::RejectOnce,
                ),
            ],
        );

        assert!(matches!(
            permission_outcome(&request),
            RequestPermissionOutcome::Selected(outcome) if outcome.option_id.to_string() == "reject-once"
        ));
    }

    #[test]
    fn cancels_permission_request_without_reject_option() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new("call-1", ToolCallUpdateFields::new()),
            vec![PermissionOption::new(
                "allow-once",
                "Allow once",
                PermissionOptionKind::AllowOnce,
            )],
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

    fn chat_event_from_json(json: &str) -> Option<ReviewChatEvent> {
        let notification: SessionNotification = serde_json::from_str(json).unwrap();
        chat_event_from_update("session-1", "turn-1", notification.update)
    }
}
