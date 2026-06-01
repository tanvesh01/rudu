use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use agent_client_protocol::schema::{
    CancelNotification, ContentBlock, EmbeddedResource, EmbeddedResourceResource, Implementation,
    InitializeRequest, InitializeResponse, LoadSessionRequest, McpServer, NewSessionRequest,
    PromptRequest, ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SessionId, SessionNotification, SetSessionConfigOptionRequest,
    TextContent, TextResourceContents,
};
use agent_client_protocol::{Agent, Client, ConnectionTo};
use agent_client_protocol_tokio::{AcpAgent, LineDirection};
use tokio::sync::mpsc;

mod adapter;
mod codex;
mod debug;
mod events;
mod mcp;
mod opencode;
mod permissions;
mod tools;

use adapter::{adapter_for_runtime, ReviewChatRuntimeAdapter, RuntimeConfigRequest};
use debug::{log_acp_transport_line, log_review_chat_debug, review_chat_debug_log_path};
use events::{chat_event_from_update, serialized_name};
use mcp::{
    current_review_chat_mcp_config, probe_review_chat_mcp_servers, review_chat_mcp_servers,
    ReviewChatMcpConfig,
};
use permissions::permission_policy;

use crate::models::ReviewChatRuntimeKind;

type ReviewChatEmitter = Arc<dyn Fn(ReviewChatEvent) + Send + Sync + 'static>;
pub(super) use codex::ReviewChatEffortMode;

use super::{ReviewChatAdapterInstallEvent, ReviewChatEvent};

pub(super) fn set_codex_acp_cache_root(path: PathBuf) -> Result<(), PathBuf> {
    codex::set_codex_acp_cache_root(path)
}

pub(super) fn review_chat_readiness<F>(emit_event: F) -> crate::models::ReviewChatReadinessStatus
where
    F: Fn(ReviewChatAdapterInstallEvent),
{
    adapter_for_runtime(ReviewChatRuntimeKind::Codex).readiness(emit_event)
}

pub(super) fn review_chat_readiness_for_runtime<F>(
    review_runtime: ReviewChatRuntimeKind,
    emit_event: F,
) -> crate::models::ReviewChatReadinessStatus
where
    F: Fn(ReviewChatAdapterInstallEvent),
{
    adapter_for_runtime(review_runtime).readiness(emit_event)
}

pub(super) fn list_opencode_models() -> Result<Vec<String>, String> {
    opencode::list_models()
}

pub(super) fn resolve_opencode_binary() -> String {
    opencode::resolve_opencode_binary()
}

pub(super) fn log_review_chat_workspace_debug(workspace_dir: &Path, message: impl AsRef<str>) {
    log_review_chat_debug(
        Some(&workspace_dir.join(".rudu").join("review-chat-acp.log")),
        message,
    );
}

#[derive(Default)]
struct AcpChatRuntimeState {
    active_turn_id: Option<String>,
    active_turn_has_message: bool,
    active_turn_first_update_logged: bool,
    active_turn_started_at: Option<Instant>,
    pending_context_notice: Option<PendingContextNotice>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingContextNotice {
    head_sha: String,
    text: String,
}

impl AcpChatRuntimeState {
    fn begin_turn(&mut self, turn_id: String) -> Result<Option<PendingContextNotice>, String> {
        if let Some(active_turn_id) = &self.active_turn_id {
            return Err(format!(
                "Rudu chat already has an active turn: {active_turn_id}"
            ));
        }

        self.active_turn_id = Some(turn_id);
        self.active_turn_has_message = false;
        self.active_turn_first_update_logged = false;
        self.active_turn_started_at = Some(Instant::now());
        Ok(self.pending_context_notice.take())
    }

    fn queue_context_notice(&mut self, head_sha: String, text: String) -> Result<(), String> {
        if self.active_turn_id.is_some() {
            return Err("Stop the active Rudu chat turn before refreshing the PR.".to_string());
        }

        self.pending_context_notice = Some(PendingContextNotice { head_sha, text });
        Ok(())
    }

    fn finish_turn(&mut self) -> Option<String> {
        self.active_turn_has_message = false;
        self.active_turn_first_update_logged = false;
        self.active_turn_started_at = None;
        self.active_turn_id.take()
    }

    fn is_active_turn(&self, turn_id: &str) -> bool {
        self.active_turn_id.as_deref() == Some(turn_id)
    }

    fn note_active_turn_message(&mut self, text: &str) {
        if self.active_turn_id.is_some() && !text.trim().is_empty() {
            self.active_turn_has_message = true;
        }
    }

    fn note_active_turn_update(&mut self) -> Option<u128> {
        if self.active_turn_id.is_none() || self.active_turn_first_update_logged {
            return None;
        }

        self.active_turn_first_update_logged = true;
        self.active_turn_started_at
            .map(|started_at| started_at.elapsed().as_millis())
    }

    fn active_turn_has_message(&self) -> bool {
        self.active_turn_has_message
    }
}

enum AcpChatRuntimeCommand {
    SendPrompt {
        turn_id: String,
        text: String,
        result_tx: std::sync::mpsc::Sender<Result<Option<String>, String>>,
    },
    QueueContextNotice {
        head_sha: String,
        text: String,
        result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    },
    ConfigureRuntime {
        request: RuntimeConfigRequest,
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
    debug_log_path: Option<PathBuf>,
    prompt_embedded_context: AtomicBool,
}

impl AcpChatRuntime {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn send_prompt(&self, turn_id: String, text: String) -> Result<Option<String>, String> {
        if !self.is_alive() {
            return Err("Rudu chat runtime is not running.".to_string());
        }

        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!("send prompt command start turn_id={turn_id}"),
        );
        let started_at = Instant::now();
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::SendPrompt {
                turn_id: turn_id.clone(),
                text,
                result_tx,
            })
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        let result = result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()));
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!(
                "send prompt command finish turn_id={turn_id} elapsed_ms={} success={}",
                started_at.elapsed().as_millis(),
                result.is_ok(),
            ),
        );
        result
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

    fn queue_context_notice(&self, head_sha: String, text: String) -> Result<(), String> {
        if !self.is_alive() {
            return Ok(());
        }

        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!("queue context notice command start head_sha={head_sha}"),
        );
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::QueueContextNotice {
                head_sha: head_sha.clone(),
                text,
                result_tx,
            })
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        let result = result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()));
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!(
                "queue context notice command finish head_sha={head_sha} success={}",
                result.is_ok(),
            ),
        );
        result
    }

    fn configure_runtime(&self, request: RuntimeConfigRequest) -> Result<(), String> {
        if !self.is_alive() {
            return Err("Rudu chat runtime is not running.".to_string());
        }

        if self.current_turn_id().is_some() {
            return Err(request.active_turn_error().to_string());
        }

        let request_label = request.log_label();
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!("configure runtime command start request={request_label}"),
        );
        let started_at = Instant::now();
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::ConfigureRuntime { request, result_tx })
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        let result = result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()));
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!(
                "configure runtime command finish request={request_label} elapsed_ms={} success={}",
                started_at.elapsed().as_millis(),
                result.is_ok(),
            ),
        );
        result
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
        debug_log_path: debug_log_path.clone(),
        prompt_embedded_context: AtomicBool::new(false),
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
        if line.trim().is_empty() {
            return;
        }

        match direction {
            LineDirection::Stderr => {
                log_review_chat_debug(
                    stderr_log_path.as_deref(),
                    format!("{}: {}", adapter.stderr_label, line.trim()),
                );
            }
            LineDirection::Stdin | LineDirection::Stdout => {
                log_acp_transport_line(stderr_log_path.as_deref(), direction, line);
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
) -> Result<Option<String>, String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.send_prompt(turn_id, text)
}

pub(super) fn queue_context_notice(
    session_id: &str,
    head_sha: String,
    text: String,
) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.queue_context_notice(head_sha, text)
}

pub(super) fn set_chat_effort_mode(
    session_id: &str,
    mode: ReviewChatEffortMode,
) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.configure_runtime(RuntimeConfigRequest::CodexEffort(mode))
}

pub(super) fn set_chat_model(session_id: &str, model: String) -> Result<(), String> {
    let runtime = get_review_chat_runtime(session_id)?;
    runtime.configure_runtime(RuntimeConfigRequest::ModelChoice(model))
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
                    let first_update_elapsed_ms =
                        notification_runtime.state.lock().ok().and_then(|mut state| {
                            state.note_active_turn_update()
                        });
                    if let Some(elapsed_ms) = first_update_elapsed_ms {
                        log_review_chat_debug(
                            notification_runtime.debug_log_path.as_deref(),
                            format!(
                                "first acp update received turn_id={turn_id} elapsed_ms={elapsed_ms}"
                            ),
                        );
                    }
                    if let Some(event) = chat_event_from_update(
                        &notification_runtime.rudu_session_id,
                        &turn_id,
                        notification.update,
                    ) {
                        if let ReviewChatEvent::Message { text, .. } = &event {
                            if let Ok(mut state) = notification_runtime.state.lock() {
                                state.note_active_turn_message(text);
                            }
                        }
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
            let initialize_response = initialize_agent(&connection).await?;
            let supports_embedded_context = initialize_response
                .agent_capabilities
                .prompt_capabilities
                .embedded_context;
            runtime_for_connection
                .prompt_embedded_context
                .store(supports_embedded_context, Ordering::SeqCst);
            log_review_chat_debug(
                debug_log_path.as_deref(),
                format!(
                    "initialized {} agent embedded_context={supports_embedded_context}",
                    runtime_for_connection.adapter.label,
                ),
            );
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
                    debug_log_path.clone(),
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
    debug_log_path: Option<PathBuf>,
) -> bool {
    match command {
        AcpChatRuntimeCommand::SendPrompt {
            turn_id,
            text,
            result_tx,
        } => {
            let pending_context_notice = {
                let begin_result = runtime
                    .state
                    .lock()
                    .map_err(|_| "Rudu chat runtime state is poisoned.".to_string())
                    .and_then(|mut state| state.begin_turn(turn_id.clone()));

                match begin_result {
                    Ok(pending_context_notice) => pending_context_notice,
                    Err(error) => {
                        let _ = result_tx.send(Err(error));
                        return true;
                    }
                }
            };

            let consumed_context_head_sha = pending_context_notice
                .as_ref()
                .map(|notice| notice.head_sha.clone());
            if let Some(head_sha) = &consumed_context_head_sha {
                log_review_chat_debug(
                    debug_log_path.as_deref(),
                    format!("send prompt consuming pending context turn_id={turn_id} head_sha={head_sha}"),
                );
            }

            log_review_chat_debug(
                debug_log_path.as_deref(),
                format!("send prompt task spawn turn_id={turn_id}"),
            );
            let _ = result_tx.send(Ok(consumed_context_head_sha));
            let _ = tokio::spawn(send_prompt_task(
                connection,
                acp_session_id,
                runtime,
                turn_id,
                text,
                pending_context_notice,
                debug_log_path,
            ));
            true
        }
        AcpChatRuntimeCommand::QueueContextNotice {
            head_sha,
            text,
            result_tx,
        } => {
            let result = runtime
                .state
                .lock()
                .map_err(|_| "Rudu chat runtime state is poisoned.".to_string())
                .and_then(|mut state| state.queue_context_notice(head_sha.clone(), text));
            if result.is_ok() {
                log_review_chat_debug(
                    debug_log_path.as_deref(),
                    format!("queued pending context head_sha={head_sha}"),
                );
            }
            let _ = result_tx.send(result);
            true
        }
        AcpChatRuntimeCommand::ConfigureRuntime { request, result_tx } => {
            let has_active_turn = runtime
                .state
                .lock()
                .map(|state| state.active_turn_id.is_some())
                .unwrap_or(true);
            if has_active_turn {
                let _ = result_tx.send(Err(request.active_turn_error().to_string()));
                return true;
            }

            let _ = tokio::spawn(configure_runtime_task(
                connection,
                acp_session_id,
                runtime.adapter,
                request,
                result_tx,
                debug_log_path,
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

async fn configure_runtime_task(
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    adapter: ReviewChatRuntimeAdapter,
    request: RuntimeConfigRequest,
    result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    debug_log_path: Option<PathBuf>,
) -> Result<(), agent_client_protocol::Error> {
    let task_started_at = Instant::now();
    let request_label = request.log_label();
    let result = async {
        let options = adapter.config_for_runtime(request)?;

        log_review_chat_debug(
            debug_log_path.as_deref(),
            format!(
                "configure runtime task start request={} option_count={}",
                request_label,
                options.len(),
            ),
        );
        for option in options {
            let option_started_at = Instant::now();
            log_review_chat_debug(
                debug_log_path.as_deref(),
                format!(
                    "set config option start request={} key={} value={} required={}",
                    request_label, option.key, option.value, option.required,
                ),
            );
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
            log_review_chat_debug(
                debug_log_path.as_deref(),
                format!(
                    "set config option finish request={} key={} elapsed_ms={} success={}",
                    request_label,
                    option.key,
                    option_started_at.elapsed().as_millis(),
                    config_result.is_ok(),
                ),
            );
            if option.required {
                config_result?;
            }
        }

        Ok(())
    }
    .await;

    log_review_chat_debug(
        debug_log_path.as_deref(),
        format!(
            "configure runtime task finish request={} elapsed_ms={} success={}",
            request_label,
            task_started_at.elapsed().as_millis(),
            result.is_ok(),
        ),
    );
    let _ = result_tx.send(result);
    Ok(())
}

async fn send_prompt_task(
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    runtime: Arc<AcpChatRuntime>,
    turn_id: String,
    text: String,
    pending_context_notice: Option<PendingContextNotice>,
    debug_log_path: Option<PathBuf>,
) -> Result<(), agent_client_protocol::Error> {
    let supports_embedded_context = runtime.prompt_embedded_context.load(Ordering::SeqCst);
    let (prompt, context_mode) = prompt_blocks_for_user_message(
        runtime.rudu_session_id.as_str(),
        text,
        pending_context_notice,
        supports_embedded_context,
    );
    log_review_chat_debug(
        debug_log_path.as_deref(),
        format!("send prompt request start turn_id={turn_id} context_mode={context_mode}"),
    );
    let started_at = Instant::now();
    let result = connection
        .send_request(PromptRequest::new(acp_session_id.clone(), prompt))
        .block_task()
        .await;

    match result {
        Ok(mut response) => {
            if runtime.adapter.kind == ReviewChatRuntimeKind::OpenCode
                && !runtime
                    .state
                    .lock()
                    .map(|state| state.active_turn_has_message())
                    .unwrap_or(true)
            {
                log_review_chat_debug(
                    debug_log_path.as_deref(),
                    format!("send prompt missing final answer turn_id={turn_id}; retrying once"),
                );
                match repair_missing_final_answer(
                    connection.clone(),
                    acp_session_id,
                    debug_log_path.as_deref(),
                )
                .await
                {
                    Ok(repair_response) => {
                        response = repair_response;
                    }
                    Err(error) => {
                        let finished_turn_id = runtime
                            .state
                            .lock()
                            .ok()
                            .and_then(|mut state| state.finish_turn())
                            .unwrap_or(turn_id);
                        log_review_chat_debug(
                            debug_log_path.as_deref(),
                            format!(
                                "send prompt repair missing final answer failed turn_id={finished_turn_id} error={error}",
                            ),
                        );
                        (runtime.emit_event)(ReviewChatEvent::Error {
                            session_id: runtime.rudu_session_id.clone(),
                            turn_id: finished_turn_id,
                            message: format!(
                                "OpenCode finished without a user-visible answer, and the final-answer retry failed: {error}"
                            ),
                        });
                        return Ok(());
                    }
                }

                if !runtime
                    .state
                    .lock()
                    .map(|state| state.active_turn_has_message())
                    .unwrap_or(true)
                {
                    let finished_turn_id = runtime
                        .state
                        .lock()
                        .ok()
                        .and_then(|mut state| state.finish_turn())
                        .unwrap_or(turn_id);
                    log_review_chat_debug(
                        debug_log_path.as_deref(),
                        format!(
                            "send prompt repair missing final answer produced no message turn_id={finished_turn_id}",
                        ),
                    );
                    (runtime.emit_event)(ReviewChatEvent::Error {
                        session_id: runtime.rudu_session_id.clone(),
                        turn_id: finished_turn_id,
                        message: "OpenCode finished without a user-visible answer.".to_string(),
                    });
                    return Ok(());
                }
            }

            let finished_turn_id = runtime
                .state
                .lock()
                .ok()
                .and_then(|mut state| state.finish_turn())
                .unwrap_or(turn_id);
            let stop_reason = serialized_name(&response.stop_reason);
            log_review_chat_debug(
                debug_log_path.as_deref(),
                format!(
                    "send prompt request finish turn_id={finished_turn_id} elapsed_ms={} success=true stop_reason={stop_reason}",
                    started_at.elapsed().as_millis(),
                ),
            );
            (runtime.emit_event)(ReviewChatEvent::Finished {
                session_id: runtime.rudu_session_id.clone(),
                turn_id: finished_turn_id,
                stop_reason: Some(stop_reason),
            });
        }
        Err(error) => {
            let finished_turn_id = runtime
                .state
                .lock()
                .ok()
                .and_then(|mut state| state.finish_turn())
                .unwrap_or(turn_id);
            log_review_chat_debug(
                debug_log_path.as_deref(),
                format!(
                    "send prompt request finish turn_id={finished_turn_id} elapsed_ms={} success=false error={error}",
                    started_at.elapsed().as_millis(),
                ),
            );
            (runtime.emit_event)(ReviewChatEvent::Error {
                session_id: runtime.rudu_session_id.clone(),
                turn_id: finished_turn_id,
                message: format!("Rudu chat turn failed: {error}"),
            });
        }
    }

    Ok(())
}

async fn repair_missing_final_answer(
    connection: ConnectionTo<Agent>,
    acp_session_id: SessionId,
    debug_log_path: Option<&Path>,
) -> Result<agent_client_protocol::schema::PromptResponse, agent_client_protocol::Error> {
    let prompt = vec![ContentBlock::Text(TextContent::new(
        "Rudu did not receive a user-visible final answer for your previous response. Reply now with the final answer only, concisely. Do not call tools. Do not reveal hidden reasoning. If the user's last message was just acknowledgement or test text, acknowledge it briefly.",
    ))];
    let started_at = Instant::now();
    let result = connection
        .send_request(PromptRequest::new(acp_session_id, prompt))
        .block_task()
        .await;
    log_review_chat_debug(
        debug_log_path,
        format!(
            "repair missing final answer finish elapsed_ms={} success={}",
            started_at.elapsed().as_millis(),
            result.is_ok(),
        ),
    );
    result
}

fn prompt_blocks_for_user_message(
    rudu_session_id: &str,
    text: String,
    pending_context_notice: Option<PendingContextNotice>,
    supports_embedded_context: bool,
) -> (Vec<ContentBlock>, &'static str) {
    let Some(context_notice) = pending_context_notice else {
        return (vec![ContentBlock::Text(TextContent::new(text))], "none");
    };

    if supports_embedded_context {
        let resource = TextResourceContents::new(
            context_notice.text,
            format!(
                "rudu://review-session/{}/context/{}",
                rudu_session_id, context_notice.head_sha
            ),
        )
        .mime_type(Some("text/plain".to_string()));

        return (
            vec![
                ContentBlock::Resource(EmbeddedResource::new(
                    EmbeddedResourceResource::TextResourceContents(resource),
                )),
                ContentBlock::Text(TextContent::new(text)),
            ],
            "embedded-context",
        );
    }

    (
        vec![ContentBlock::Text(TextContent::new(format!(
            "Rudu hidden review context. Use this context to answer the user, but do not answer this context separately and do not mention it unless directly relevant.\n\n{context}\n\nUser message:\n{message}",
            context = context_notice.text,
            message = text,
        )))],
        "text-prefix",
    )
}

async fn initialize_agent(
    connection: &ConnectionTo<Agent>,
) -> Result<InitializeResponse, agent_client_protocol::Error> {
    connection
        .send_request(InitializeRequest::new(ProtocolVersion::V1).client_info(
            Implementation::new("rudu", env!("CARGO_PKG_VERSION")).title("Rudu".to_string()),
        ))
        .block_task()
        .await
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
    use agent_client_protocol::schema::{ContentBlock, EmbeddedResourceResource, TextContent};

    use super::{prompt_blocks_for_user_message, AcpChatRuntimeState};

    #[test]
    fn tracks_one_chat_turn_at_a_time() {
        let mut state = AcpChatRuntimeState::default();

        assert_eq!(
            state
                .begin_turn("turn-1".to_string())
                .expect("first turn starts"),
            None
        );
        assert!(state.begin_turn("turn-2".to_string()).is_err());
        assert!(state.is_active_turn("turn-1"));
        assert!(!state.active_turn_has_message());
        state.note_active_turn_message("Visible answer.");
        assert!(state.active_turn_has_message());
        assert_eq!(state.finish_turn(), Some("turn-1".to_string()));
        assert!(!state.is_active_turn("turn-1"));
        assert!(!state.active_turn_has_message());

        assert_eq!(
            state
                .begin_turn("turn-2".to_string())
                .expect("next turn starts"),
            None
        );
        assert!(state.is_active_turn("turn-2"));
        assert!(!state.active_turn_has_message());
        state.note_active_turn_message("   ");
        assert!(!state.active_turn_has_message());
    }

    #[test]
    fn queues_context_notice_until_next_turn() {
        let mut state = AcpChatRuntimeState::default();

        state
            .queue_context_notice("head-a".to_string(), "context-a".to_string())
            .expect("context queues");
        state
            .queue_context_notice("head-b".to_string(), "context-b".to_string())
            .expect("latest context replaces stale context");

        let pending_context = state
            .begin_turn("turn-1".to_string())
            .expect("turn starts")
            .expect("context is consumed");
        assert_eq!(pending_context.head_sha, "head-b");
        assert_eq!(pending_context.text, "context-b");

        assert!(state
            .queue_context_notice("head-c".to_string(), "context-c".to_string())
            .is_err());
        assert!(state.is_active_turn("turn-1"));
        assert_eq!(state.finish_turn(), Some("turn-1".to_string()));

        assert_eq!(
            state
                .begin_turn("turn-2".to_string())
                .expect("next turn starts"),
            None
        );
    }

    #[test]
    fn builds_embedded_context_prompt_when_supported() {
        let mut state = AcpChatRuntimeState::default();
        state
            .queue_context_notice("head-a".to_string(), "hidden context".to_string())
            .expect("context queues");
        let pending_context = state.begin_turn("turn-2".to_string()).expect("turn starts");

        let (blocks, mode) =
            prompt_blocks_for_user_message("session-1", "hello".to_string(), pending_context, true);

        assert_eq!(mode, "embedded-context");
        assert_eq!(blocks.len(), 2);
        match &blocks[0] {
            ContentBlock::Resource(resource) => match &resource.resource {
                EmbeddedResourceResource::TextResourceContents(resource) => {
                    assert_eq!(resource.text, "hidden context");
                    assert_eq!(
                        resource.uri,
                        "rudu://review-session/session-1/context/head-a"
                    );
                    assert_eq!(resource.mime_type.as_deref(), Some("text/plain"));
                }
                _ => panic!("expected text resource"),
            },
            _ => panic!("expected embedded resource"),
        }
        assert_eq!(blocks[1], ContentBlock::Text(TextContent::new("hello")));
    }

    #[test]
    fn builds_text_prefixed_prompt_when_embedded_context_is_missing() {
        let mut state = AcpChatRuntimeState::default();
        state
            .queue_context_notice("head-a".to_string(), "hidden context".to_string())
            .expect("context queues");
        let pending_context = state.begin_turn("turn-1".to_string()).expect("turn starts");

        let (blocks, mode) = prompt_blocks_for_user_message(
            "session-1",
            "hello".to_string(),
            pending_context,
            false,
        );

        assert_eq!(mode, "text-prefix");
        assert_eq!(blocks.len(), 1);
        match &blocks[0] {
            ContentBlock::Text(text) => {
                assert!(text.text.contains("hidden context"));
                assert!(text.text.contains("User message:\nhello"));
            }
            _ => panic!("expected text prompt"),
        }
    }
}
