use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use agent_client_protocol::schema::{
    CancelNotification, ContentBlock, Implementation, InitializeRequest, LoadSessionRequest,
    McpServer, NewSessionRequest, PromptRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SessionId, SessionNotification,
    SetSessionConfigOptionRequest, TextContent,
};
use agent_client_protocol::{Agent, Client, ConnectionTo};
use agent_client_protocol_tokio::{AcpAgent, LineDirection};
use tokio::sync::mpsc;

mod adapter;
mod codex;
mod debug;
mod events;
mod mcp;
mod permissions;

use adapter::{adapter_for_runtime, ReviewChatRuntimeAdapter};
use debug::{log_review_chat_debug, review_chat_debug_log_path};
use events::{chat_event_from_update, serialized_name};
use mcp::{
    current_review_chat_mcp_config, probe_review_chat_mcp_servers, review_chat_mcp_servers,
    ReviewChatMcpConfig,
};
use permissions::permission_policy;

use crate::models::ReviewChatRuntimeKind;

type ReviewChatEmitter = Arc<dyn Fn(ReviewChatEvent) + Send + Sync + 'static>;
pub(super) use codex::ReviewChatEffortMode;

use super::ReviewChatEvent;

pub(super) fn review_chat_readiness() -> crate::models::ReviewChatReadinessStatus {
    adapter_for_runtime(ReviewChatRuntimeKind::Codex).readiness()
}

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
    SetEffortMode {
        mode: ReviewChatEffortMode,
        result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    },
    CancelTurn {
        turn_id: String,
        result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    },
    Shutdown {
        result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    },
}

struct AcpChatRuntime {
    rudu_session_id: String,
    adapter: ReviewChatRuntimeAdapter,
    mcp_config: ReviewChatMcpConfig,
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

    fn shutdown(&self) -> Result<(), String> {
        if !self.is_alive() {
            return Ok(());
        }

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::Shutdown { result_tx })
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

    fn set_effort_mode(&self, mode: ReviewChatEffortMode) -> Result<(), String> {
        if !self.is_alive() {
            return Err("Rudu chat runtime is not running.".to_string());
        }

        if self.current_turn_id().is_some() {
            return Err("Review effort changes apply before the next Rudu chat turn.".to_string());
        }

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::SetEffortMode { mode, result_tx })
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
    review_runtime: ReviewChatRuntimeKind,
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
    let adapter = adapter_for_runtime(review_runtime);
    let mcp_config = current_review_chat_mcp_config();
    let debug_log_path = review_chat_debug_log_path(&repo_dir);
    let mcp_servers = review_chat_mcp_servers(mcp_config, debug_log_path.as_deref());
    let runtime = Arc::new(AcpChatRuntime {
        rudu_session_id: rudu_session_id.clone(),
        adapter,
        mcp_config,
        state: Arc::new(Mutex::new(AcpChatRuntimeState::default())),
        command_tx,
        alive: Arc::new(AtomicBool::new(true)),
        emit_event: Arc::new(emit_event),
    });
    log_review_chat_debug(
        debug_log_path.as_deref(),
        format!(
            "start runtime rudu_session_id={rudu_session_id} runtime={:?} repo_dir={} mcp_linear_issue_details={} mcp_server_count={} load_existing_session={}",
            adapter.kind,
            repo_dir.display(),
            mcp_config.linear_issue_details,
            mcp_servers.len(),
            agent_session_id.is_some(),
        ),
    );
    probe_review_chat_mcp_servers(&mcp_servers, debug_log_path.as_deref());
    let stderr_log_path = debug_log_path.clone();
    let agent = adapter.agent()?.with_debug(move |line, direction| {
        if direction == LineDirection::Stderr && !line.trim().is_empty() {
            log_review_chat_debug(
                stderr_log_path.as_deref(),
                format!("{}: {}", adapter.stderr_label, line.trim()),
            );
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
                mcp_servers,
                debug_log_path,
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

pub(super) fn live_chat_runtime_matches_current_mcp_config(
    session_id: &str,
) -> Result<bool, String> {
    let runtime = get_review_chat_runtime(session_id)?;
    Ok(runtime.mcp_config == current_review_chat_mcp_config())
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

pub(super) fn set_chat_effort_mode(
    session_id: &str,
    mode: ReviewChatEffortMode,
) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.set_effort_mode(mode)
}

pub(super) fn cancel_chat_turn(session_id: &str, turn_id: &str) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.cancel_turn(turn_id)
}

pub(super) fn shutdown_chat_runtime(session_id: &str) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.shutdown()?;

    let mut runtimes = review_chat_runtimes()
        .lock()
        .map_err(|_| "Rudu chat runtime registry is poisoned.".to_string())?;
    runtimes.remove(session_id);
    Ok(())
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
    mcp_servers: Vec<McpServer>,
    debug_log_path: Option<PathBuf>,
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
        mcp_servers,
        debug_log_path,
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
    mcp_servers: Vec<McpServer>,
    debug_log_path: Option<PathBuf>,
    runtime: Arc<AcpChatRuntime>,
    mut command_rx: mpsc::UnboundedReceiver<AcpChatRuntimeCommand>,
    startup_tx: std::sync::mpsc::Sender<Result<String, String>>,
    startup_sent: Arc<AtomicBool>,
) -> Result<(), String> {
    let notification_runtime = Arc::clone(&runtime);
    let startup_tx_for_connection = startup_tx.clone();
    let startup_sent_for_connection = Arc::clone(&startup_sent);
    let permission_debug_log_path = debug_log_path.clone();
    let runtime_for_connection = Arc::clone(&runtime);
    let adapter_for_connection = runtime.adapter;
    let runtime_error_label = runtime.adapter.label;

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
                let policy = permission_policy(&request);
                let outcome = policy.outcome(&request);
                let outcome_label = match &outcome {
                    RequestPermissionOutcome::Cancelled => "cancelled".to_string(),
                    RequestPermissionOutcome::Selected(outcome) => {
                        format!("selected option_id={}", outcome.option_id)
                    }
                    _ => "unknown".to_string(),
                };
                log_review_chat_debug(
                    permission_debug_log_path.as_deref(),
                    format!(
                        "permission request reason={} options={} outcome={outcome_label}",
                        policy.reason,
                        request.options.len(),
                    ),
                );
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection| async move {
            initialize_agent(&connection).await?;
            let acp_session_id = create_or_load_session(
                &connection,
                repo_dir,
                agent_session_id,
                mcp_servers,
                adapter_for_connection,
                debug_log_path.as_deref(),
            )
            .await?;
            startup_sent_for_connection.store(true, Ordering::SeqCst);
            let _ = startup_tx_for_connection.send(Ok(acp_session_id.to_string()));

            while let Some(command) = command_rx.recv().await {
                if !handle_chat_command(
                    command,
                    connection.clone(),
                    acp_session_id.clone(),
                    Arc::clone(&runtime_for_connection),
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
            let message = format!("{runtime_error_label} runtime failed: {error}");
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
        AcpChatRuntimeCommand::SetEffortMode { mode, result_tx } => {
            let has_active_turn = runtime
                .state
                .lock()
                .map(|state| state.active_turn_id.is_some())
                .unwrap_or(true);
            if has_active_turn {
                let _ = result_tx.send(Err(
                    "Review effort changes apply before the next Rudu chat turn.".to_string(),
                ));
                return true;
            }

            let _ = tokio::spawn(set_effort_mode_task(
                connection,
                acp_session_id,
                runtime.adapter,
                mode,
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
        AcpChatRuntimeCommand::Shutdown { result_tx } => {
            let _ = result_tx.send(Ok(()));
            false
        }
    }
}

async fn set_effort_mode_task(
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    adapter: ReviewChatRuntimeAdapter,
    mode: ReviewChatEffortMode,
    result_tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), agent_client_protocol::Error> {
    let result = async {
        let Some(options) = adapter.config_for_codex_effort(mode) else {
            return Err(format!(
                "{} does not support Codex review effort modes.",
                adapter.label
            ));
        };

        for option in options {
            let config_result = connection
                .send_request(SetSessionConfigOptionRequest::new(
                    acp_session_id.clone(),
                    option.key,
                    option.value,
                ))
                .block_task()
                .await
                .map_err(|error| {
                    format!(
                        "Failed to set Rudu {} for {}: {error}",
                        option.key, adapter.label
                    )
                });
            if option.required {
                config_result?;
            }
        }

        Ok(())
    }
    .await;

    let _ = result_tx.send(result);
    Ok(())
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
    mcp_servers: Vec<McpServer>,
    adapter: ReviewChatRuntimeAdapter,
    debug_log_path: Option<&Path>,
) -> Result<SessionId, agent_client_protocol::Error> {
    if let Some(agent_session_id) = agent_session_id {
        let session_id = SessionId::new(agent_session_id);
        let mut request = LoadSessionRequest::new(session_id.clone(), repo_dir);
        request.mcp_servers = mcp_servers;
        connection.send_request(request).block_task().await?;
        log_review_chat_debug(
            debug_log_path,
            format!(
                "loaded {} session acp_session_id={session_id}",
                adapter.label
            ),
        );
        return Ok(session_id);
    }

    let mut request = NewSessionRequest::new(repo_dir);
    request.mcp_servers = mcp_servers;
    let response = connection.send_request(request).block_task().await?;
    log_review_chat_debug(
        debug_log_path,
        format!(
            "created {} session acp_session_id={}",
            adapter.label, response.session_id
        ),
    );
    Ok(response.session_id)
}

#[cfg(test)]
mod tests {
    use super::AcpChatRuntimeState;

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
}
