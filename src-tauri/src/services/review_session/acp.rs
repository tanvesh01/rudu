use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use agent_client_protocol::schema::{
    CancelNotification, ClientCapabilities, ContentBlock, CreateTerminalRequest,
    CreateTerminalResponse, EmbeddedResource, EmbeddedResourceResource, FileSystemCapabilities,
    Implementation, InitializeRequest, InitializeResponse, KillTerminalRequest,
    KillTerminalResponse, LoadSessionRequest, McpServer, NewSessionRequest, PromptRequest,
    ProtocolVersion, ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalRequest,
    ReleaseTerminalResponse, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SessionConfigKind, SessionConfigOption as AcpSessionConfigOption,
    SessionConfigSelectOptions, SessionId, SessionNotification, SetSessionConfigOptionRequest,
    TerminalExitStatus, TerminalOutputRequest, TerminalOutputResponse, TextContent,
    TextResourceContents, WaitForTerminalExitRequest, WaitForTerminalExitResponse,
};
use agent_client_protocol::{Agent, Client, ConnectionTo};
use agent_client_protocol_tokio::{AcpAgent, LineDirection};
use serde_json::Value;
use tokio::sync::mpsc;

mod adapter;
mod codex;
mod debug;
mod events;
mod mcp;
mod opencode;
mod permissions;
mod tools;

use adapter::{
    adapter_for_runtime, ReviewChatRuntimeAdapter, RuntimeConfigRequest, RuntimeTurnPreparation,
    RuntimeTurnPreparationRequest, SessionConfigOption as RuntimeSessionConfigOption,
};
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

const OPENCODE_MODEL_CONFIG_ID: &str = "model";

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

#[derive(Default)]
struct AcpClientServices {
    repo_dir: PathBuf,
    terminals: Mutex<HashMap<String, StoredTerminal>>,
    next_terminal_id: Mutex<u64>,
    debug_log_path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct StoredTerminal {
    output: String,
    truncated: bool,
    exit_status: TerminalExitStatus,
}

impl AcpClientServices {
    fn new(repo_dir: PathBuf, debug_log_path: Option<PathBuf>) -> Self {
        Self {
            repo_dir,
            terminals: Mutex::new(HashMap::new()),
            next_terminal_id: Mutex::new(0),
            debug_log_path,
        }
    }

    fn read_text_file(&self, request: ReadTextFileRequest) -> Result<ReadTextFileResponse, String> {
        let path = self
            .allowed_repo_path(&request.path)
            .map_err(|error| format!("Rudu refused ACP file read: {error}"))?;
        let content = std::fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        Ok(ReadTextFileResponse::new(slice_text_lines(
            &content,
            request.line,
            request.limit,
        )))
    }

    fn create_terminal(
        &self,
        request: CreateTerminalRequest,
    ) -> Result<CreateTerminalResponse, String> {
        let executable = executable_basename(&request.command);
        if executable != "gh" {
            return Err(format!(
                "Rudu Review Chat only allows ACP terminal commands through gh; refused {}.",
                request.command
            ));
        }

        let cwd = match request.cwd {
            Some(cwd) => self.allowed_repo_path(&cwd)?,
            None => self.repo_dir.clone(),
        };
        let terminal_id = self.next_terminal_id()?;
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!(
                "terminal create start terminal_id={terminal_id} command={} args={:?} cwd={}",
                request.command,
                request.args,
                cwd.display(),
            ),
        );

        let command_output = Command::new(&request.command)
            .args(&request.args)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Failed to run gh through ACP terminal: {error}"))?;
        let exit_status = TerminalExitStatus::new()
            .exit_code(command_output.status.code().map(|code| code as u32));
        let raw_output = combined_terminal_output(command_output);
        let (output, truncated) = truncate_terminal_output(
            raw_output,
            request.output_byte_limit.unwrap_or(64 * 1024) as usize,
        );
        self.terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .insert(
                terminal_id.clone(),
                StoredTerminal {
                    output,
                    truncated,
                    exit_status,
                },
            );
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!("terminal create finish terminal_id={terminal_id} success=true"),
        );
        Ok(CreateTerminalResponse::new(terminal_id))
    }

    fn terminal_output(
        &self,
        request: TerminalOutputRequest,
    ) -> Result<TerminalOutputResponse, String> {
        let terminal = self.terminal(&request.terminal_id.to_string())?;
        Ok(
            TerminalOutputResponse::new(terminal.output, terminal.truncated)
                .exit_status(Some(terminal.exit_status)),
        )
    }

    fn wait_for_terminal_exit(
        &self,
        request: WaitForTerminalExitRequest,
    ) -> Result<WaitForTerminalExitResponse, String> {
        let terminal = self.terminal(&request.terminal_id.to_string())?;
        Ok(WaitForTerminalExitResponse::new(terminal.exit_status))
    }

    fn release_terminal(
        &self,
        request: ReleaseTerminalRequest,
    ) -> Result<ReleaseTerminalResponse, String> {
        self.terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .remove(&request.terminal_id.to_string());
        Ok(ReleaseTerminalResponse::new())
    }

    fn kill_terminal(&self, request: KillTerminalRequest) -> Result<KillTerminalResponse, String> {
        if !self
            .terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .contains_key(&request.terminal_id.to_string())
        {
            return Err(format!("Unknown ACP terminal id {}.", request.terminal_id));
        }
        Ok(KillTerminalResponse::new())
    }

    fn allowed_repo_path(&self, path: &Path) -> Result<PathBuf, String> {
        let repo_dir = self
            .repo_dir
            .canonicalize()
            .map_err(|error| format!("failed to resolve review workspace: {error}"))?;
        let full_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            repo_dir.join(path)
        };
        let canonical = full_path
            .canonicalize()
            .map_err(|error| format!("failed to resolve {}: {error}", full_path.display()))?;
        if !canonical.starts_with(&repo_dir) {
            return Err(format!(
                "{} is outside the review workspace.",
                canonical.display()
            ));
        }
        Ok(canonical)
    }

    fn next_terminal_id(&self) -> Result<String, String> {
        let mut next = self
            .next_terminal_id
            .lock()
            .map_err(|_| "Rudu ACP terminal id registry is poisoned.".to_string())?;
        *next += 1;
        Ok(format!("rudu-gh-{}", *next))
    }

    fn terminal(&self, terminal_id: &str) -> Result<StoredTerminal, String> {
        self.terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| format!("Unknown ACP terminal id {terminal_id}."))
    }
}

fn slice_text_lines(content: &str, line: Option<u32>, limit: Option<u32>) -> String {
    let start = line.unwrap_or(1).saturating_sub(1) as usize;
    let iter = content.lines().skip(start);
    match limit {
        Some(limit) => iter.take(limit as usize).collect::<Vec<_>>().join("\n"),
        None => iter.collect::<Vec<_>>().join("\n"),
    }
}

fn combined_terminal_output(output: std::process::Output) -> String {
    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !combined.ends_with('\n') && !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    combined
}

fn truncate_terminal_output(output: String, limit: usize) -> (String, bool) {
    if limit == 0 {
        return (String::new(), !output.is_empty());
    }
    if output.len() <= limit {
        return (output, false);
    }
    let mut start = output.len() - limit;
    while !output.is_char_boundary(start) {
        start += 1;
    }
    (output[start..].to_string(), true)
}

fn executable_basename(command: &str) -> &str {
    Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
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

fn runtime_error_from_stderr_line(line: &str) -> Option<String> {
    if !line.contains("service=llm") && !line.contains("AI_APICallError") {
        return None;
    }

    let provider = token_after(line, "providerID=");
    let model = token_after(line, "modelID=");
    let model_label = provider
        .as_deref()
        .zip(model.as_deref())
        .map(|(provider, model)| format!("{provider}/{model}"))
        .or(model);

    let detail = extract_error_json(line)
        .and_then(|json| serde_json::from_str::<Value>(json).ok())
        .and_then(|value| runtime_error_detail_from_json(&value))
        .or_else(|| token_after(line, "error="));

    match (model_label, detail) {
        (Some(model), Some(detail)) => Some(format!("{model} failed: {detail}")),
        (Some(model), None) => Some(format!("{model} failed.")),
        (None, Some(detail)) => Some(detail),
        (None, None) => None,
    }
}

fn token_after(line: &str, marker: &str) -> Option<String> {
    let start = line.find(marker)? + marker.len();
    let token = line[start..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|character| character == ',' || character == ';')
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}

fn extract_error_json(line: &str) -> Option<&str> {
    let start = line.find("error=")? + "error=".len();
    let json = &line[start..];
    let mut in_string = false;
    let mut escaped = false;
    let mut depth = 0usize;
    let mut object_start = None;

    for (index, character) in json.char_indices() {
        if object_start.is_none() {
            if character == '{' {
                object_start = Some(index);
                depth = 1;
            }
            continue;
        }

        if escaped {
            escaped = false;
            continue;
        }

        if character == '\\' && in_string {
            escaped = true;
            continue;
        }

        if character == '"' {
            in_string = !in_string;
            continue;
        }

        if in_string {
            continue;
        }

        match character {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let start = object_start?;
                    return Some(&json[start..=index]);
                }
            }
            _ => {}
        }
    }

    None
}

fn runtime_error_detail_from_json(value: &Value) -> Option<String> {
    find_string_key(value, "responseBody")
        .and_then(|body| {
            serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|body| find_string_key(&body, "error").map(ToOwned::to_owned))
                .or_else(|| Some(body.to_string()))
        })
        .or_else(|| find_string_key(value, "message").map(ToOwned::to_owned))
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
}

fn find_string_key<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    match value {
        Value::Object(object) => object.get(key).and_then(Value::as_str).or_else(|| {
            object
                .values()
                .find_map(|value| find_string_key(value, key))
        }),
        Value::Array(values) => values.iter().find_map(|value| find_string_key(value, key)),
        _ => None,
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
    ConfigureSessionOptions {
        request_label: String,
        options: Vec<RuntimeSessionConfigOption>,
        active_turn_error: &'static str,
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
    runtime_model_choice: Option<String>,
    mcp_config: ReviewChatMcpConfig,
    state: Arc<Mutex<AcpChatRuntimeState>>,
    last_runtime_error: Arc<Mutex<Option<String>>>,
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

    fn configure_session_options(
        &self,
        request_label: String,
        options: Vec<RuntimeSessionConfigOption>,
        active_turn_error: &'static str,
    ) -> Result<(), String> {
        if options.is_empty() {
            return Ok(());
        }
        if !self.is_alive() {
            return Err("Rudu chat runtime is not running.".to_string());
        }

        if self.current_turn_id().is_some() {
            return Err(active_turn_error.to_string());
        }

        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!("configure session options command start request={request_label}"),
        );
        let started_at = Instant::now();
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(AcpChatRuntimeCommand::ConfigureSessionOptions {
                request_label: request_label.clone(),
                options,
                active_turn_error,
                result_tx,
            })
            .map_err(|_| "Rudu chat runtime is not running.".to_string())?;

        let result = result_rx
            .recv()
            .unwrap_or_else(|_| Err("Rudu chat runtime stopped.".to_string()));
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!(
                "configure session options command finish request={request_label} elapsed_ms={} success={}",
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

    fn clear_last_runtime_error(&self) {
        if let Ok(mut error) = self.last_runtime_error.lock() {
            *error = None;
        }
    }

    fn last_runtime_error(&self) -> Option<String> {
        self.last_runtime_error
            .lock()
            .ok()
            .and_then(|error| error.clone())
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
    runtime_model_choice: Option<String>,
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
    let startup_model_choice = runtime_model_choice
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToOwned::to_owned);
    let mcp_config = current_review_chat_mcp_config();
    let debug_log_path = review_chat_debug_log_path(&repo_dir);
    let mcp_servers = review_chat_mcp_servers(mcp_config, debug_log_path.as_deref());
    let runtime = Arc::new(AcpChatRuntime {
        rudu_session_id: rudu_session_id.clone(),
        adapter,
        runtime_model_choice: startup_model_choice.clone(),
        mcp_config,
        state: Arc::new(Mutex::new(AcpChatRuntimeState::default())),
        last_runtime_error: Arc::new(Mutex::new(None)),
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
    if adapter.kind == ReviewChatRuntimeKind::OpenCode {
        log_review_chat_debug(
            debug_log_path.as_deref(),
            format!(
                "OpenCode CLI version={}",
                opencode::cli_version().unwrap_or_else(|| "unknown".to_string())
            ),
        );
    }
    probe_review_chat_mcp_servers(&mcp_servers, debug_log_path.as_deref());
    let stderr_log_path = debug_log_path.clone();
    let last_runtime_error = Arc::clone(&runtime.last_runtime_error);
    let agent = adapter.agent()?.with_debug(move |line, direction| {
        if line.trim().is_empty() {
            return;
        }

        match direction {
            LineDirection::Stderr => {
                if let Some(error) = runtime_error_from_stderr_line(line) {
                    if let Ok(mut last_error) = last_runtime_error.lock() {
                        *last_error = Some(error);
                    }
                }
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

pub(super) fn live_chat_runtime_matches_session_config(
    session_id: &str,
    review_runtime: ReviewChatRuntimeKind,
    runtime_model_choice: Option<&str>,
) -> Result<bool, String> {
    let runtime = get_review_chat_runtime(session_id)?;
    let runtime_model_choice = runtime_model_choice
        .map(str::trim)
        .filter(|model| !model.is_empty());
    Ok(runtime.adapter.kind == review_runtime
        && runtime.runtime_model_choice.as_deref() == runtime_model_choice
        && runtime.mcp_config == current_review_chat_mcp_config())
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

pub(super) fn prepare_chat_runtime_for_turn(
    session_id: &str,
    review_runtime: ReviewChatRuntimeKind,
    active_review_effort_mode: &str,
    pending_review_effort_mode: Option<&str>,
    _runtime_model_choice: Option<&str>,
) -> Result<Option<ReviewChatEffortMode>, String> {
    let runtime = get_review_chat_runtime(session_id)?;
    if runtime.adapter.kind != review_runtime {
        return Err(
            "Rudu chat runtime no longer matches the selected Review Chat runtime.".to_string(),
        );
    }

    let RuntimeTurnPreparation {
        options,
        consumed_pending_review_effort_mode,
    } = runtime
        .adapter
        .prepare_turn(RuntimeTurnPreparationRequest {
            active_review_effort_mode,
            pending_review_effort_mode,
        })?;
    runtime.configure_session_options(
        "turn-preparation".to_string(),
        options,
        "Review runtime settings apply before the next Rudu chat turn.",
    )?;
    Ok(consumed_pending_review_effort_mode)
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
    let client_services = Arc::new(AcpClientServices::new(
        repo_dir.clone(),
        debug_log_path.clone(),
    ));
    let read_file_services = Arc::clone(&client_services);
    let create_terminal_services = Arc::clone(&client_services);
    let terminal_output_services = Arc::clone(&client_services);
    let release_terminal_services = Arc::clone(&client_services);
    let wait_terminal_services = Arc::clone(&client_services);
    let kill_terminal_services = Arc::clone(&client_services);

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
        .on_receive_request(
            async move |request: ReadTextFileRequest, responder, _connection| {
                let path = request.path.display().to_string();
                let result = read_file_services.read_text_file(request);
                let success = result.is_ok();
                log_review_chat_debug(
                    read_file_services.debug_log_path.as_deref(),
                    format!("fs read_text_file path={path} success={success}"),
                );
                match result {
                    Ok(response) => responder.respond(response),
                    Err(error) => responder.respond_with_internal_error(error),
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: CreateTerminalRequest, responder, _connection| {
                let result = create_terminal_services.create_terminal(request);
                match result {
                    Ok(response) => responder.respond(response),
                    Err(error) => responder.respond_with_internal_error(error),
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: TerminalOutputRequest, responder, _connection| {
                let result = terminal_output_services.terminal_output(request);
                match result {
                    Ok(response) => responder.respond(response),
                    Err(error) => responder.respond_with_internal_error(error),
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: ReleaseTerminalRequest, responder, _connection| {
                let result = release_terminal_services.release_terminal(request);
                match result {
                    Ok(response) => responder.respond(response),
                    Err(error) => responder.respond_with_internal_error(error),
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: WaitForTerminalExitRequest, responder, _connection| {
                let result = wait_terminal_services.wait_for_terminal_exit(request);
                match result {
                    Ok(response) => responder.respond(response),
                    Err(error) => responder.respond_with_internal_error(error),
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: KillTerminalRequest, responder, _connection| {
                let result = kill_terminal_services.kill_terminal(request);
                match result {
                    Ok(response) => responder.respond(response),
                    Err(error) => responder.respond_with_internal_error(error),
                }
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
            let startup_session = create_or_load_session(
                &connection,
                repo_dir,
                agent_session_id,
                mcp_servers,
                adapter_for_connection,
                debug_log_path.as_deref(),
            )
            .await?;
            apply_startup_model_choice(
                &connection,
                startup_session.session_id.clone(),
                runtime_for_connection.adapter,
                runtime_for_connection.runtime_model_choice.as_deref(),
                startup_session.config_options.as_deref(),
                debug_log_path.as_deref(),
            )
            .await
            .map_err(agent_client_protocol::util::internal_error)?;
            let acp_session_id = startup_session.session_id;
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
            runtime.clear_last_runtime_error();

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

            let request_label = request.log_label();
            let options = match runtime.adapter.config_for_runtime(request) {
                Ok(options) => options,
                Err(error) => {
                    let _ = result_tx.send(Err(error));
                    return true;
                }
            };

            let _ = tokio::spawn(configure_runtime_task(
                connection,
                acp_session_id,
                runtime.adapter,
                request_label,
                options,
                result_tx,
                debug_log_path,
            ));
            true
        }
        AcpChatRuntimeCommand::ConfigureSessionOptions {
            request_label,
            options,
            active_turn_error,
            result_tx,
        } => {
            let has_active_turn = runtime
                .state
                .lock()
                .map(|state| state.active_turn_id.is_some())
                .unwrap_or(true);
            if has_active_turn {
                let _ = result_tx.send(Err(active_turn_error.to_string()));
                return true;
            }

            let _ = tokio::spawn(configure_runtime_task(
                connection,
                acp_session_id,
                runtime.adapter,
                request_label,
                options,
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
    request_label: String,
    options: Vec<RuntimeSessionConfigOption>,
    result_tx: std::sync::mpsc::Sender<Result<(), String>>,
    debug_log_path: Option<PathBuf>,
) -> Result<(), agent_client_protocol::Error> {
    let task_started_at = Instant::now();
    let result = async {
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
                            message: runtime.last_runtime_error().unwrap_or_else(|| {
                                format!(
                                    "OpenCode finished without a user-visible answer, and the final-answer retry failed: {error}"
                                )
                            }),
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
                        message: runtime.last_runtime_error().unwrap_or_else(|| {
                            "OpenCode finished without a user-visible answer.".to_string()
                        }),
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
        .send_request(
            InitializeRequest::new(ProtocolVersion::V1)
                .client_info(
                    Implementation::new("rudu", env!("CARGO_PKG_VERSION"))
                        .title("Rudu".to_string()),
                )
                .client_capabilities(rudu_client_capabilities()),
        )
        .block_task()
        .await
}

fn rudu_client_capabilities() -> ClientCapabilities {
    ClientCapabilities::new()
        .fs(FileSystemCapabilities::new()
            .read_text_file(true)
            .write_text_file(false))
        .terminal(true)
}

struct AcpSessionStartup {
    session_id: SessionId,
    config_options: Option<Vec<AcpSessionConfigOption>>,
}

async fn create_or_load_session(
    connection: &ConnectionTo<Agent>,
    repo_dir: PathBuf,
    agent_session_id: Option<String>,
    mcp_servers: Vec<McpServer>,
    adapter: ReviewChatRuntimeAdapter,
    debug_log_path: Option<&Path>,
) -> Result<AcpSessionStartup, agent_client_protocol::Error> {
    if let Some(agent_session_id) = agent_session_id {
        let session_id = SessionId::new(agent_session_id);
        let mut request = LoadSessionRequest::new(session_id.clone(), repo_dir);
        request.mcp_servers = mcp_servers;
        let response = connection.send_request(request).block_task().await?;
        log_review_chat_debug(
            debug_log_path,
            format!(
                "loaded {} session acp_session_id={session_id}",
                adapter.label
            ),
        );
        return Ok(AcpSessionStartup {
            session_id,
            config_options: response.config_options,
        });
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
    Ok(AcpSessionStartup {
        session_id: response.session_id,
        config_options: response.config_options,
    })
}

async fn apply_startup_model_choice(
    connection: &ConnectionTo<Agent>,
    acp_session_id: SessionId,
    adapter: ReviewChatRuntimeAdapter,
    runtime_model_choice: Option<&str>,
    config_options: Option<&[AcpSessionConfigOption]>,
    debug_log_path: Option<&Path>,
) -> Result<(), String> {
    if adapter.kind != ReviewChatRuntimeKind::OpenCode {
        return Ok(());
    }
    let Some(model) = runtime_model_choice
        .map(str::trim)
        .filter(|model| !model.is_empty())
    else {
        return Ok(());
    };
    let cli_version = opencode::cli_version();
    if !opencode::acp_model_switch_supported(cli_version.as_deref()) {
        log_review_chat_debug(
            debug_log_path,
            format!(
                "skip OpenCode startup model model={model} version={} reason=acp-model-switch-bug",
                cli_version.unwrap_or_else(|| "unknown".to_string())
            ),
        );
        return Ok(());
    }

    let config_options = config_options.ok_or_else(|| {
        format!(
            "OpenCode did not advertise ACP session config options, so Rudu cannot select model {model}."
        )
    })?;
    if !session_config_options_contain_model(config_options, model) {
        return Err(format!(
            "OpenCode did not advertise model {model} for this ACP session."
        ));
    }

    log_review_chat_debug(
        debug_log_path,
        format!("set OpenCode startup model start model={model}"),
    );
    connection
        .send_request(SetSessionConfigOptionRequest::new(
            acp_session_id,
            OPENCODE_MODEL_CONFIG_ID,
            model.to_string(),
        ))
        .block_task()
        .await
        .map_err(|error| format!("Failed to select OpenCode model {model}: {error}"))?;
    log_review_chat_debug(
        debug_log_path,
        format!("set OpenCode startup model finish model={model} success=true"),
    );
    Ok(())
}

fn session_config_options_contain_model(
    config_options: &[AcpSessionConfigOption],
    model: &str,
) -> bool {
    config_options.iter().any(|option| {
        option.id.to_string() == OPENCODE_MODEL_CONFIG_ID
            && match &option.kind {
                SessionConfigKind::Select(select) => {
                    select_options_contain_model(&select.options, model)
                }
                _ => false,
            }
    })
}

fn select_options_contain_model(options: &SessionConfigSelectOptions, model: &str) -> bool {
    match options {
        SessionConfigSelectOptions::Ungrouped(options) => options
            .iter()
            .any(|option| option.value.to_string() == model),
        SessionConfigSelectOptions::Grouped(groups) => groups.iter().any(|group| {
            group
                .options
                .iter()
                .any(|option| option.value.to_string() == model)
        }),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use agent_client_protocol::schema::{
        ContentBlock, CreateTerminalRequest, EmbeddedResourceResource, ReadTextFileRequest,
        SessionConfigOption as AcpSessionConfigOption, SessionConfigSelectGroup,
        SessionConfigSelectOption, SessionId, TextContent,
    };

    use super::{
        prompt_blocks_for_user_message, rudu_client_capabilities, runtime_error_from_stderr_line,
        session_config_options_contain_model, slice_text_lines, truncate_terminal_output,
        AcpChatRuntimeState, AcpClientServices,
    };

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

    #[test]
    fn extracts_provider_error_from_opencode_llm_stderr() {
        let line = "ERROR service=llm providerID=synthetic modelID=hf:deepseek-ai/DeepSeek-R1-0528 error={\"error\":{\"name\":\"AI_APICallError\",\"responseBody\":\"{\\\"error\\\":\\\"hf:deepseek-ai/DeepSeek-R1-0528 is no longer supported. Try using a different model, like hf:zai-org/GLM-5.1\\\"}\"}} stream error";

        assert_eq!(
            runtime_error_from_stderr_line(line),
            Some(
                "synthetic/hf:deepseek-ai/DeepSeek-R1-0528 failed: hf:deepseek-ai/DeepSeek-R1-0528 is no longer supported. Try using a different model, like hf:zai-org/GLM-5.1"
                    .to_string(),
            )
        );
    }

    #[test]
    fn ignores_unrelated_opencode_stderr_errors() {
        let line = "ERROR service=mcp clientName=context7 error=MCP error -32601: Method not found failed to get prompts";

        assert_eq!(runtime_error_from_stderr_line(line), None);
    }

    #[test]
    fn rudu_client_capabilities_advertise_read_files_and_terminal_only() {
        let capabilities = rudu_client_capabilities();

        assert!(capabilities.fs.read_text_file);
        assert!(!capabilities.fs.write_text_file);
        assert!(capabilities.terminal);
    }

    #[test]
    fn opencode_model_validation_accepts_ungrouped_and_grouped_options() {
        let ungrouped = vec![AcpSessionConfigOption::select(
            "model",
            "Model",
            "opencode/default",
            vec![
                SessionConfigSelectOption::new("opencode/default", "Default"),
                SessionConfigSelectOption::new("opencode-go/deepseek-v4-pro", "DeepSeek"),
            ],
        )];
        assert!(session_config_options_contain_model(
            &ungrouped,
            "opencode-go/deepseek-v4-pro"
        ));
        assert!(!session_config_options_contain_model(
            &ungrouped,
            "anthropic/missing"
        ));

        let grouped = vec![AcpSessionConfigOption::select(
            "model",
            "Model",
            "opencode/default",
            vec![SessionConfigSelectGroup::new(
                "opencode",
                "OpenCode",
                vec![SessionConfigSelectOption::new(
                    "opencode/grouped",
                    "Grouped",
                )],
            )],
        )];
        assert!(session_config_options_contain_model(
            &grouped,
            "opencode/grouped"
        ));
    }

    #[test]
    fn slices_text_lines_using_one_based_line_numbers() {
        let content = "one\ntwo\nthree\nfour\n";

        assert_eq!(slice_text_lines(content, Some(2), Some(2)), "two\nthree");
        assert_eq!(slice_text_lines(content, Some(1), Some(0)), "");
        assert_eq!(
            slice_text_lines(content, None, None),
            "one\ntwo\nthree\nfour"
        );
    }

    #[test]
    fn truncates_terminal_output_from_the_beginning() {
        let (output, truncated) = truncate_terminal_output("abcdef".to_string(), 3);

        assert_eq!(output, "def");
        assert!(truncated);

        let (output, truncated) = truncate_terminal_output("abc".to_string(), 3);
        assert_eq!(output, "abc");
        assert!(!truncated);
    }

    #[test]
    fn read_text_file_allows_repo_paths_and_rejects_outside_paths() {
        let base = std::env::temp_dir().join(format!(
            "rudu-acp-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock is valid")
                .as_nanos()
        ));
        let repo = base.join("repo");
        let outside = base.join("outside.txt");
        std::fs::create_dir_all(&repo).expect("repo dir exists");
        std::fs::write(repo.join("inside.txt"), "one\ntwo\nthree\n").expect("inside file writes");
        std::fs::write(&outside, "outside").expect("outside file writes");
        let services = AcpClientServices::new(repo.clone(), None);

        let response = services
            .read_text_file(
                ReadTextFileRequest::new(SessionId::new("session"), repo.join("inside.txt"))
                    .line(Some(2))
                    .limit(Some(1)),
            )
            .expect("inside file can be read");
        assert_eq!(response.content, "two");

        assert!(services
            .read_text_file(ReadTextFileRequest::new(SessionId::new("session"), outside))
            .is_err());

        std::fs::remove_dir_all(base).expect("temp tree is removed");
    }

    #[test]
    fn terminal_create_rejects_non_gh_commands() {
        let repo = std::env::temp_dir();
        let services = AcpClientServices::new(repo, None);

        let result =
            services.create_terminal(CreateTerminalRequest::new(SessionId::new("session"), "sh"));

        assert!(result
            .unwrap_err()
            .contains("only allows ACP terminal commands through gh"));
    }
}
