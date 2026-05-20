use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::{
    CancelNotification, ContentBlock, ContentChunk, EnvVariable, Implementation, InitializeRequest,
    LoadSessionRequest, McpServer, McpServerStdio, NewSessionRequest, PermissionOptionKind,
    PromptRequest, ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, SessionNotification,
    SessionUpdate, SetSessionConfigOptionRequest, TextContent,
};
use agent_client_protocol::{Agent, Client, ConnectionTo};
use agent_client_protocol_tokio::{AcpAgent, LineDirection};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::linear::{LinearIntegrationService, LINEAR_MCP_API_KEY_ENV, LINEAR_MCP_DEBUG_LOG_ENV};

use super::{ReviewChatAcpPlanEntry, ReviewChatEvent};

const CODEX_ACP_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_ACP_BIN", "RUDU_CODEX_ACP_PATH"];

type ReviewChatEmitter = Arc<dyn Fn(ReviewChatEvent) + Send + Sync + 'static>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ReviewChatMcpConfig {
    linear_issue_details: bool,
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
    mcp_config: ReviewChatMcpConfig,
    state: Arc<Mutex<AcpChatRuntimeState>>,
    command_tx: mpsc::UnboundedSender<AcpChatRuntimeCommand>,
    alive: Arc<AtomicBool>,
    emit_event: ReviewChatEmitter,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ReviewChatEffortMode {
    Fast,
    Deep,
}

impl ReviewChatEffortMode {
    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "fast" => Ok(Self::Fast),
            "deep" => Ok(Self::Deep),
            _ => Err("Review effort mode must be fast or deep.".to_string()),
        }
    }

    fn model(self) -> &'static str {
        match self {
            Self::Fast => "gpt-5.4-mini",
            Self::Deep => "gpt-5.5",
        }
    }

    fn reasoning_effort(self) -> Option<&'static str> {
        match self {
            Self::Fast => Some("low"),
            Self::Deep => Some("high"),
        }
    }
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
    let mcp_config = current_review_chat_mcp_config();
    let debug_log_path = review_chat_debug_log_path(&repo_dir);
    let mcp_servers = review_chat_mcp_servers(mcp_config, debug_log_path.as_deref());
    let agent_session_id = if mcp_servers.is_empty() {
        agent_session_id
    } else {
        None
    };
    let runtime = Arc::new(AcpChatRuntime {
        rudu_session_id: rudu_session_id.clone(),
        mcp_config,
        state: Arc::new(Mutex::new(AcpChatRuntimeState::default())),
        command_tx,
        alive: Arc::new(AtomicBool::new(true)),
        emit_event: Arc::new(emit_event),
    });
    log_review_chat_debug(
        debug_log_path.as_deref(),
        format!(
            "start runtime rudu_session_id={rudu_session_id} repo_dir={} mcp_linear_issue_details={} mcp_server_count={} load_existing_session={}",
            repo_dir.display(),
            mcp_config.linear_issue_details,
            mcp_servers.len(),
            agent_session_id.is_some(),
        ),
    );
    probe_review_chat_mcp_servers(&mcp_servers, debug_log_path.as_deref());
    let stderr_log_path = debug_log_path.clone();
    let agent = codex_acp_agent()?.with_debug(move |line, direction| {
        if direction == LineDirection::Stderr && !line.trim().is_empty() {
            log_review_chat_debug(
                stderr_log_path.as_deref(),
                format!("codex-acp stderr: {}", line.trim()),
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
    mode: ReviewChatEffortMode,
    result_tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), agent_client_protocol::Error> {
    let result = async {
        connection
            .send_request(SetSessionConfigOptionRequest::new(
                acp_session_id.clone(),
                "model",
                mode.model(),
            ))
            .block_task()
            .await
            .map_err(|error| format!("Failed to set Rudu model: {error}"))?;

        if let Some(reasoning_effort) = mode.reasoning_effort() {
            let reasoning_result = connection
                .send_request(SetSessionConfigOptionRequest::new(
                    acp_session_id,
                    "reasoning_effort",
                    reasoning_effort,
                ))
                .block_task()
                .await
                .map_err(|error| format!("Failed to set Rudu reasoning effort: {error}"));
            if mode == ReviewChatEffortMode::Deep {
                reasoning_result?;
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
    debug_log_path: Option<&Path>,
) -> Result<SessionId, agent_client_protocol::Error> {
    if let Some(agent_session_id) = agent_session_id {
        let session_id = SessionId::new(agent_session_id);
        let mut request = LoadSessionRequest::new(session_id.clone(), repo_dir);
        request.mcp_servers = mcp_servers;
        connection.send_request(request).block_task().await?;
        log_review_chat_debug(
            debug_log_path,
            format!("loaded codex ACP session acp_session_id={session_id}"),
        );
        return Ok(session_id);
    }

    let mut request = NewSessionRequest::new(repo_dir);
    request.mcp_servers = mcp_servers;
    let response = connection.send_request(request).block_task().await?;
    log_review_chat_debug(
        debug_log_path,
        format!(
            "created codex ACP session acp_session_id={}",
            response.session_id
        ),
    );
    Ok(response.session_id)
}

fn current_review_chat_mcp_config() -> ReviewChatMcpConfig {
    ReviewChatMcpConfig {
        linear_issue_details: matches!(
            LinearIntegrationService::new().api_key_for_session_mcp(),
            Ok(Some(_))
        ),
    }
}

fn review_chat_mcp_servers(
    config: ReviewChatMcpConfig,
    debug_log_path: Option<&Path>,
) -> Vec<McpServer> {
    if !config.linear_issue_details {
        return Vec::new();
    }

    let Ok(current_exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let Ok(Some(linear_api_key)) = LinearIntegrationService::new().api_key_for_session_mcp() else {
        return Vec::new();
    };

    let mut env = vec![EnvVariable::new(LINEAR_MCP_API_KEY_ENV, linear_api_key)];
    if let Some(debug_log_path) = debug_log_path {
        env.push(EnvVariable::new(
            LINEAR_MCP_DEBUG_LOG_ENV,
            debug_log_path.to_string_lossy().to_string(),
        ));
    }

    vec![McpServer::Stdio(
        McpServerStdio::new("rudu-linear", current_exe)
            .args(vec!["--rudu-linear-mcp".to_string()])
            .env(env),
    )]
}

fn codex_acp_agent() -> Result<AcpAgent, String> {
    let codex_acp_bin = resolve_binary(CODEX_ACP_BIN_ENV_VARS, "codex-acp");
    AcpAgent::from_args([
        codex_acp_bin,
        "-c".to_string(),
        "sandbox_mode=read-only".to_string(),
        "-c".to_string(),
        "approval_policy=on-request".to_string(),
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

fn review_chat_debug_log_path(repo_dir: &Path) -> Option<PathBuf> {
    repo_dir
        .parent()
        .map(|workspace_dir| workspace_dir.join(".rudu").join("review-chat-acp.log"))
}

fn log_review_chat_debug(path: Option<&Path>, message: impl AsRef<str>) {
    let Some(path) = path else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{timestamp_ms} {}", message.as_ref());
    }
}

fn probe_review_chat_mcp_servers(mcp_servers: &[McpServer], debug_log_path: Option<&Path>) {
    for server in mcp_servers {
        let McpServer::Stdio(server) = server else {
            continue;
        };

        let env_names = server
            .env
            .iter()
            .map(|env| env.name.as_str())
            .collect::<Vec<_>>()
            .join(",");
        log_review_chat_debug(
            debug_log_path,
            format!(
                "probe MCP server name={} command={} args={:?} env_names=[{}]",
                server.name,
                server.command.display(),
                server.args,
                env_names,
            ),
        );

        let mut command = Command::new(&server.command);
        command
            .args(&server.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for env in &server.env {
            command.env(&env.name, &env.value);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                log_review_chat_debug(
                    debug_log_path,
                    format!(
                        "probe MCP server spawn failed name={} error={error}",
                        server.name
                    ),
                );
                continue;
            }
        };

        if let Some(stdin) = child.stdin.as_mut() {
            let _ = writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"2024-11-05","capabilities":{{}},"clientInfo":{{"name":"rudu","version":"{}"}}}}}}"#,
                env!("CARGO_PKG_VERSION")
            );
            let _ = writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","method":"notifications/initialized","params":{{}}}}"#
            );
            let _ = writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{{}}}}"#
            );
        }
        drop(child.stdin.take());

        let started_at = SystemTime::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if started_at
                        .elapsed()
                        .map(|elapsed| elapsed > Duration::from_secs(3))
                        .unwrap_or(true)
                    {
                        let _ = child.kill();
                        log_review_chat_debug(
                            debug_log_path,
                            format!("probe MCP server timed out name={}", server.name),
                        );
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => {
                    log_review_chat_debug(
                        debug_log_path,
                        format!(
                            "probe MCP server wait failed name={} error={error}",
                            server.name
                        ),
                    );
                    break;
                }
            }
        }

        match child.wait_with_output() {
            Ok(output) => {
                log_review_chat_debug(
                    debug_log_path,
                    format!(
                        "probe MCP server exited name={} status={}",
                        server.name, output.status
                    ),
                );
                if !output.stdout.is_empty() {
                    log_review_chat_debug(
                        debug_log_path,
                        format!(
                            "probe MCP server stdout name={} output={}",
                            server.name,
                            String::from_utf8_lossy(&output.stdout).trim()
                        ),
                    );
                }
                if !output.stderr.is_empty() {
                    log_review_chat_debug(
                        debug_log_path,
                        format!(
                            "probe MCP server stderr name={} output={}",
                            server.name,
                            String::from_utf8_lossy(&output.stderr).trim()
                        ),
                    );
                }
            }
            Err(error) => log_review_chat_debug(
                debug_log_path,
                format!(
                    "probe MCP server output read failed name={} error={error}",
                    server.name
                ),
            ),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PermissionPolicyDecision {
    reason: &'static str,
    allow: bool,
}

impl PermissionPolicyDecision {
    fn allow(reason: &'static str) -> Self {
        Self {
            reason,
            allow: true,
        }
    }

    fn deny(reason: &'static str) -> Self {
        Self {
            reason,
            allow: false,
        }
    }

    fn outcome(&self, request: &RequestPermissionRequest) -> RequestPermissionOutcome {
        if !self.allow {
            return RequestPermissionOutcome::Cancelled;
        }

        preferred_allow_option(request)
            .map(|option| {
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    option.option_id.clone(),
                ))
            })
            .unwrap_or(RequestPermissionOutcome::Cancelled)
    }
}

fn permission_policy(request: &RequestPermissionRequest) -> PermissionPolicyDecision {
    if is_rudu_read_only_mcp_permission(request) {
        return PermissionPolicyDecision::allow("rudu_read_only_mcp_tool");
    }

    if is_direct_gh_command_permission(request) {
        return PermissionPolicyDecision::allow("github_cli_delegation");
    }

    PermissionPolicyDecision::deny("outside_inspection_only")
}

fn preferred_allow_option(
    request: &RequestPermissionRequest,
) -> Option<&agent_client_protocol::schema::PermissionOption> {
    request
        .options
        .iter()
        .find(|option| matches!(option.kind, PermissionOptionKind::AllowOnce))
        .or_else(|| {
            request
                .options
                .iter()
                .find(|option| matches!(option.kind, PermissionOptionKind::AllowAlways))
        })
}

fn is_rudu_read_only_mcp_permission(request: &RequestPermissionRequest) -> bool {
    let Some(raw_input) = request.tool_call.fields.raw_input.as_ref() else {
        return false;
    };

    let server_name = json_string(raw_input, &["server_name"])
        .or_else(|| json_string(raw_input, &["serverName"]))
        .or_else(|| json_string(raw_input, &["server", "name"]));
    if server_name.as_deref() != Some("rudu-linear") {
        return false;
    }

    let tool_name = json_string(raw_input, &["request", "params", "name"])
        .or_else(|| json_string(raw_input, &["params", "name"]))
        .or_else(|| json_string(raw_input, &["tool_name"]))
        .or_else(|| json_string(raw_input, &["toolName"]))
        .or_else(|| {
            request
                .tool_call
                .fields
                .title
                .as_deref()
                .map(str::to_string)
        });

    tool_name
        .as_deref()
        .map(|name| name.contains("get_linear_issue_details"))
        .unwrap_or(false)
}

fn is_direct_gh_command_permission(request: &RequestPermissionRequest) -> bool {
    let Some(raw_input) = request.tool_call.fields.raw_input.as_ref() else {
        return false;
    };

    command_argv(raw_input)
        .and_then(|argv| argv.first().cloned())
        .map(|program| executable_basename(&program) == "gh")
        .unwrap_or(false)
}

fn command_argv(value: &Value) -> Option<Vec<String>> {
    if let Some(argv) = string_array_at(value, &["command"]) {
        return Some(argv);
    }

    if let Some(command) = json_string(value, &["command"]) {
        return shell_words(&command);
    }

    if let Some(argv) = string_array_at(value, &["exec", "command"]) {
        return Some(argv);
    }

    if let Some(argv) = string_array_at(value, &["action", "exec", "command"]) {
        return Some(argv);
    }

    None
}

fn string_array_at(value: &Value, path: &[&str]) -> Option<Vec<String>> {
    let value = json_at(value, path)?;
    let values = value.as_array()?;
    values
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect()
}

fn json_string(value: &Value, path: &[&str]) -> Option<String> {
    json_at(value, path)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn json_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn shell_words(command: &str) -> Option<Vec<String>> {
    let words = command
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    (!words.is_empty()).then_some(words)
}

fn executable_basename(program: &str) -> &str {
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
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
    use super::{
        chat_event_from_update, permission_policy, serialized_name, AcpChatRuntimeState,
        PermissionPolicyDecision,
    };
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
    fn allows_direct_gh_permission_requests() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new(
                "call-1",
                ToolCallUpdateFields::new()
                    .raw_input(json!({ "command": ["gh", "run", "rerun", "123"] })),
            ),
            vec![
                PermissionOption::new("allow-once", "Allow once", PermissionOptionKind::AllowOnce),
                PermissionOption::new(
                    "reject-once",
                    "Reject once",
                    PermissionOptionKind::RejectOnce,
                ),
            ],
        );

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::allow("github_cli_delegation")
        );
        assert!(matches!(
            permission_policy(&request).outcome(&request),
            RequestPermissionOutcome::Selected(outcome) if outcome.option_id.to_string() == "allow-once"
        ));
    }

    #[test]
    fn denies_shell_wrapped_gh_permission_requests() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new(
                "call-1",
                ToolCallUpdateFields::new()
                    .raw_input(json!({ "command": ["sh", "-c", "gh run rerun 123"] })),
            ),
            vec![
                PermissionOption::new("allow-once", "Allow once", PermissionOptionKind::AllowOnce),
                PermissionOption::new(
                    "reject-once",
                    "Reject once",
                    PermissionOptionKind::RejectOnce,
                ),
            ],
        );

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::deny("outside_inspection_only")
        );
        assert_eq!(
            permission_policy(&request).outcome(&request),
            RequestPermissionOutcome::Cancelled
        );
    }

    #[test]
    fn allows_rudu_read_only_mcp_permission_requests() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new(
                "call-1",
                ToolCallUpdateFields::new().raw_input(json!({
                    "server_name": "rudu-linear",
                    "request": {
                        "params": {
                            "name": "get_linear_issue_details",
                            "arguments": { "issue_id": "LIN-123" }
                        }
                    }
                })),
            ),
            vec![PermissionOption::new(
                "allow-once",
                "Allow once",
                PermissionOptionKind::AllowOnce,
            )],
        );

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::allow("rudu_read_only_mcp_tool")
        );
    }

    #[test]
    fn denies_unknown_permission_requests_even_with_allow_option() {
        let request = RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new(
                "call-1",
                ToolCallUpdateFields::new()
                    .raw_input(json!({ "command": ["git", "checkout", "main"] })),
            ),
            vec![
                PermissionOption::new("allow-once", "Allow once", PermissionOptionKind::AllowOnce),
                PermissionOption::new(
                    "reject-once",
                    "Reject once",
                    PermissionOptionKind::RejectOnce,
                ),
            ],
        );

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::deny("outside_inspection_only")
        );
        assert_eq!(
            permission_policy(&request).outcome(&request),
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
