mod acp;
mod session;
mod walkthrough;
mod walkthrough_generator;
mod workspace;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};

use crate::cache::review_sessions as store;
use crate::models::{
    ReviewChatReadinessStatus, ReviewChatRuntimeKind, ReviewSession, ReviewSessionStatus,
    ReviewWalkthrough,
};
use crate::support::now_unix_timestamp;

const CODEX_ACP_VERSION: &str = "v0.14.0";
const REVIEW_CHAT_ADAPTER_INSTALL_EVENT: &str = "review-chat-adapter-install-event";
const REVIEW_CHAT_EVENT: &str = "review-chat-event";
const REVIEW_WALKTHROUGH_EVENT: &str = "review-walkthrough-event";
const REVIEW_WORKSPACE_EVENT: &str = "review-workspace-event";

struct LiveActiveTurnGuard {
    key: (String, String),
}

#[derive(Default)]
struct ActiveChatTurnAccumulator {
    text: String,
}

impl Drop for LiveActiveTurnGuard {
    fn drop(&mut self) {
        if let Ok(mut turns) = live_active_turns().lock() {
            turns.remove(&self.key);
        }
    }
}

fn live_active_turns() -> &'static Mutex<HashSet<(String, String)>> {
    static LIVE_TURNS: OnceLock<Mutex<HashSet<(String, String)>>> = OnceLock::new();
    LIVE_TURNS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_live_active_turn(session_id: &str, turn_id: &str) -> Result<LiveActiveTurnGuard, String> {
    let key = (session_id.to_string(), turn_id.to_string());
    let mut turns = live_active_turns()
        .lock()
        .map_err(|_| "Active Review Chat Turn registry is poisoned.".to_string())?;
    turns.insert(key.clone());
    Ok(LiveActiveTurnGuard { key })
}

fn is_marked_live_active_turn(session_id: &str, turn_id: &str) -> Result<bool, String> {
    let turns = live_active_turns()
        .lock()
        .map_err(|_| "Active Review Chat Turn registry is poisoned.".to_string())?;
    Ok(turns.contains(&(session_id.to_string(), turn_id.to_string())))
}

fn active_chat_turn_accumulators(
) -> &'static Mutex<HashMap<(String, String), ActiveChatTurnAccumulator>> {
    static ACCUMULATORS: OnceLock<Mutex<HashMap<(String, String), ActiveChatTurnAccumulator>>> =
        OnceLock::new();
    ACCUMULATORS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn begin_active_chat_turn_accumulator(session_id: &str, turn_id: &str) -> Result<(), String> {
    let mut accumulators = active_chat_turn_accumulators()
        .lock()
        .map_err(|_| "Active Review Chat Turn accumulator registry is poisoned.".to_string())?;
    accumulators.insert(
        (session_id.to_string(), turn_id.to_string()),
        Default::default(),
    );
    Ok(())
}

fn append_active_chat_turn_text(session_id: &str, turn_id: &str, text: &str) -> Result<(), String> {
    let mut accumulators = active_chat_turn_accumulators()
        .lock()
        .map_err(|_| "Active Review Chat Turn accumulator registry is poisoned.".to_string())?;
    if let Some(accumulator) = accumulators.get_mut(&(session_id.to_string(), turn_id.to_string()))
    {
        accumulator.text.push_str(text);
    }
    Ok(())
}

fn take_active_chat_turn_text(session_id: &str, turn_id: &str) -> Result<String, String> {
    let mut accumulators = active_chat_turn_accumulators()
        .lock()
        .map_err(|_| "Active Review Chat Turn accumulator registry is poisoned.".to_string())?;
    Ok(accumulators
        .remove(&(session_id.to_string(), turn_id.to_string()))
        .map(|accumulator| accumulator.text)
        .unwrap_or_default())
}

fn complete_active_chat_turn_from_event(
    session_id: &str,
    turn_id: &str,
    text: String,
    acp_stop_reason: Option<&str>,
) -> Result<(), String> {
    let Some(active_turn) = store::read_active_review_chat_turn(session_id)? else {
        return Ok(());
    };
    if active_turn.turn_id != turn_id || active_turn.kind != store::ReviewChatTurnKind::Chat {
        return Ok(());
    }

    let text = text.trim();
    let visible_text = if text.is_empty() {
        "Rudu finished without a visible answer."
    } else {
        text
    };
    let terminal_message = assistant_text_message(
        turn_id,
        active_turn.started_at,
        visible_text,
        acp_stop_reason,
    );
    store::complete_active_review_chat_turn(session_id, turn_id, &terminal_message)
}

fn complete_active_chat_turn_with_error_event<F>(
    session_id: &str,
    turn_id: &str,
    error: &str,
    emit_event: &F,
) -> Result<(), String>
where
    F: Fn(ReviewChatEvent),
{
    let _ = take_active_chat_turn_text(session_id, turn_id);
    let message = review_chat_turn_failed_text(error);

    if let Some(active_turn) = store::read_active_review_chat_turn(session_id)? {
        if active_turn.turn_id == turn_id && active_turn.kind == store::ReviewChatTurnKind::Chat {
            let terminal_message =
                assistant_text_message(turn_id, active_turn.started_at, &message, Some("error"));
            store::complete_active_review_chat_turn(session_id, turn_id, &terminal_message)?;
        }
    }

    emit_event(ReviewChatEvent::Error {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        message,
    });

    Ok(())
}

fn progress_activity(label: &str) -> Vec<store::ReviewChatActiveTurnActivityItem> {
    vec![store::ReviewChatActiveTurnActivityItem::Progress {
        label: label.to_string(),
    }]
}

fn plan_activity(label: &str) -> Vec<store::ReviewChatActiveTurnActivityItem> {
    vec![store::ReviewChatActiveTurnActivityItem::Plan {
        label: label.to_string(),
    }]
}

fn tool_activity(
    label: &str,
    status: &Option<String>,
) -> Vec<store::ReviewChatActiveTurnActivityItem> {
    vec![store::ReviewChatActiveTurnActivityItem::Tool {
        label: visible_tool_label(label),
        status: status.clone(),
    }]
}

fn visible_tool_label(label: &str) -> String {
    let label = label.trim();
    if label.is_empty()
        || label.contains("|fc_")
        || label.starts_with("call_")
        || label.starts_with("fc_")
    {
        return "Using tool".to_string();
    }

    label.to_string()
}

fn update_active_turn_snapshot(
    session_id: &str,
    turn_id: &str,
    progress_message: &str,
    activity_summary: Vec<store::ReviewChatActiveTurnActivityItem>,
) {
    let _ = store::update_active_review_chat_turn_snapshot(
        session_id,
        turn_id,
        progress_message,
        activity_summary,
    );
}

fn handle_active_chat_turn_event(event: &ReviewChatEvent) {
    match event {
        ReviewChatEvent::Message {
            session_id,
            turn_id,
            text,
        } => {
            let _ = append_active_chat_turn_text(session_id, turn_id, text);
            update_active_turn_snapshot(
                session_id,
                turn_id,
                "Writing response",
                progress_activity("Writing response"),
            );
        }
        ReviewChatEvent::Thought {
            session_id,
            turn_id,
            ..
        } => {
            update_active_turn_snapshot(
                session_id,
                turn_id,
                "Thinking",
                progress_activity("Thinking"),
            );
        }
        ReviewChatEvent::Tool {
            session_id,
            turn_id,
            title,
            status,
            ..
        } => {
            let message = title
                .as_deref()
                .map(visible_tool_label)
                .unwrap_or_else(|| "Using tool".to_string());
            update_active_turn_snapshot(
                session_id,
                turn_id,
                &message,
                tool_activity(&message, status),
            );
        }
        ReviewChatEvent::Plan {
            session_id,
            turn_id,
            ..
        } => {
            update_active_turn_snapshot(
                session_id,
                turn_id,
                "Planning next steps",
                plan_activity("Planning next steps"),
            );
        }
        ReviewChatEvent::Finished {
            session_id,
            turn_id,
            stop_reason,
        } => {
            let text = take_active_chat_turn_text(session_id, turn_id).unwrap_or_default();
            let _ = complete_active_chat_turn_from_event(
                session_id,
                turn_id,
                text,
                stop_reason.as_deref(),
            );
        }
        ReviewChatEvent::Error {
            session_id,
            turn_id,
            message,
        } => {
            let _ = take_active_chat_turn_text(session_id, turn_id);
            let _ = complete_active_chat_turn_from_event(
                session_id,
                turn_id,
                review_chat_turn_failed_text(message),
                Some("error"),
            );
        }
    }
}

fn review_chat_turn_failed_text(message: &str) -> String {
    let message = message.trim();
    if message.starts_with("Rudu chat turn failed:") {
        return message.to_string();
    }
    format!("Rudu chat turn failed: {message}")
}

#[derive(Debug, Clone)]
pub struct ReviewSessionInput {
    repo: String,
    number: u32,
    head_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReviewWorkspaceEvent {
    Log {
        repo: String,
        number: u32,
        #[serde(rename = "headSha")]
        head_sha: String,
        status: String,
        message: String,
        command: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReviewWalkthroughEvent {
    Progress {
        #[serde(rename = "sessionId")]
        session_id: String,
        phase: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatAdapterInstallEvent {
    pub phase: String,
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    pub total_bytes: Option<u64>,
    pub version: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatAcpPlanEntry {
    content: String,
    priority: String,
    status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReviewChatEvent {
    Message {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        text: String,
    },
    Thought {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        text: String,
    },
    Tool {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        title: Option<String>,
        status: Option<String>,
        #[serde(rename = "rawInput")]
        raw_input: Option<Value>,
        #[serde(rename = "rawOutput")]
        raw_output: Option<Value>,
    },
    Plan {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        entries: Vec<ReviewChatAcpPlanEntry>,
    },
    Finished {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        #[serde(rename = "stopReason")]
        stop_reason: Option<String>,
    },
    Error {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatTranscript {
    pub messages: Vec<Value>,
    pub active_review_effort_mode: String,
    pub pending_review_effort_mode: Option<String>,
    pub revision_checkpoints: Vec<store::ReviewRevisionCheckpoint>,
    pub active_turn: Option<store::ReviewChatActiveTurn>,
}

impl ReviewSessionInput {
    pub fn new(repo: String, number: u32, head_sha: String) -> Result<Self, String> {
        let repo = repo.trim().to_string();
        if repo.is_empty() {
            return Err("Repo is required".to_string());
        }
        if !repo.contains('/') {
            return Err("Repo must be in owner/name format".to_string());
        }
        if number == 0 {
            return Err("Pull request number is required".to_string());
        }

        let head_sha = head_sha.trim().to_string();
        if head_sha.is_empty() {
            return Err("Head SHA is required".to_string());
        }

        Ok(Self {
            repo,
            number,
            head_sha,
        })
    }

    pub(super) fn repo(&self) -> &str {
        &self.repo
    }

    pub(super) fn number(&self) -> u32 {
        self.number
    }

    pub(super) fn head_sha(&self) -> &str {
        &self.head_sha
    }
}

pub fn prepare_workspace<F>(
    root: &Path,
    repo: String,
    number: u32,
    head_sha: String,
    emit_workspace_event: F,
) -> Result<ReviewSession, String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    let input = ReviewSessionInput::new(repo, number, head_sha)?;
    fs::create_dir_all(root).map_err(|error| format!("Failed to create review root: {error}"))?;

    emit_workspace_log(
        &input,
        &emit_workspace_event,
        "running",
        "Prepare Review Workspace",
        None,
    );

    let workspace = workspace::prepare(&input, &emit_workspace_event)?;
    let mut session = session::from_workspace(root, input.repo, input.number, &workspace)?;
    if let Ok(previous) = session::read_by_id(root, &session.id) {
        session.created_at = previous.created_at;
        session.status = match previous.status {
            ReviewSessionStatus::Failed => ReviewSessionStatus::Indexed,
            status => status,
        };
        session.review_runtime = previous.review_runtime;
        session.runtime_model_choice = previous.runtime_model_choice;
        session.agent_session_id = previous.agent_session_id;
        session.agent_context_head_sha = previous.agent_context_head_sha;
        session.updated_at = now_unix_timestamp();
        session.last_error = None;
    }
    session::write(root, &session)?;
    emit_workspace_log(
        &session_input(&session),
        &emit_workspace_event,
        "success",
        "Review Workspace ready",
        None,
    );
    Ok(session)
}

pub fn load_review_session(
    root: &Path,
    repo: String,
    number: u32,
) -> Result<Option<ReviewSession>, String> {
    let repo = repo.trim().to_string();
    if repo.is_empty() {
        return Err("Repo is required".to_string());
    }
    if !repo.contains('/') {
        return Err("Repo must be in owner/name format".to_string());
    }

    session::read_by_pull_request(root, &repo, number)
}

pub fn generate_review_walkthrough<F>(
    root: &Path,
    session_id: String,
    emit_event: F,
) -> Result<ReviewWalkthrough, String>
where
    F: Fn(ReviewWalkthroughEvent),
{
    walkthrough::generate(root, session_id, emit_event)
}

pub fn run_review_walkthrough_turn<F>(
    root: &Path,
    session_id: String,
    turn_id: String,
    review_effort_mode: String,
    emit_event: F,
) -> Result<ReviewChatTranscript, String>
where
    F: Fn(ReviewWalkthroughEvent),
{
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;
    let review_effort_mode = normalize_review_effort_mode(&review_effort_mode)?;
    let session = session::read_by_id(root, &session_id)?;
    ensure_session_indexed(
        &session,
        "Prepare this review workspace before generating a walkthrough.",
    )?;

    let _live_turn = mark_live_active_turn(&session_id, &turn_id)?;
    let started_at = timestamp_millis();
    let request_message = walkthrough_request_message(&turn_id, &review_effort_mode);
    store::start_review_chat_turn(store::StartReviewChatTurnInput {
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        kind: store::ReviewChatTurnKind::Walkthrough,
        request_message,
        review_effort_mode: Some(review_effort_mode.clone()),
        runtime_model_choice: session.runtime_model_choice.clone(),
        head_sha: session.head_sha.clone(),
        progress_message: Some("Preparing review context".to_string()),
    })?;

    let walkthrough_result = walkthrough::generate(root, session_id.clone(), |event| {
        let ReviewWalkthroughEvent::Progress {
            session_id: event_session_id,
            message,
            ..
        } = &event;
        if event_session_id == &session_id {
            let _ = store::update_active_review_chat_turn_progress(&session_id, &turn_id, message);
        }
        emit_event(event);
    });

    let terminal_message = match walkthrough_result {
        Ok(walkthrough) => walkthrough_assistant_message(&turn_id, started_at, walkthrough),
        Err(error) => assistant_text_message(
            &turn_id,
            started_at,
            &format!("Review walkthrough failed: {error}"),
            Some("error"),
        ),
    };
    store::complete_active_review_chat_turn(&session_id, &turn_id, &terminal_message)?;
    load_review_chat_transcript(root, session_id)
}

pub fn refresh_review_session<F>(
    root: &Path,
    session_id: String,
    head_sha: String,
    message_count: u32,
    emit_workspace_event: F,
) -> Result<ReviewSession, String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    session::validate_session_id(&session_id)?;
    if acp::has_live_chat_runtime(&session_id)? && acp::has_active_chat_turn(&session_id)? {
        return Err("Stop the active Rudu chat turn before refreshing the PR.".to_string());
    }

    let previous = session::read_by_id(root, &session_id)?;
    let input = ReviewSessionInput::new(previous.repo.clone(), previous.number, head_sha)?;
    emit_workspace_log(
        &input,
        &emit_workspace_event,
        "running",
        "Refresh Review Workspace",
        None,
    );
    let workspace = workspace::prepare(&input, &emit_workspace_event)?;
    let mut session =
        session::from_workspace(root, previous.repo.clone(), previous.number, &workspace)?;

    if session.id != previous.id {
        return Err("Refreshed review session did not match the existing session.".to_string());
    }

    let previous_head_sha = previous.head_sha.clone();
    session.created_at = previous.created_at;
    session.status = match previous.status {
        ReviewSessionStatus::Failed => ReviewSessionStatus::Indexed,
        status => status,
    };
    session.review_runtime = previous.review_runtime;
    session.runtime_model_choice = previous.runtime_model_choice.clone();
    session.agent_session_id = previous.agent_session_id.clone();
    session.agent_context_head_sha = previous.agent_context_head_sha.clone();
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    session::write(root, &session)?;

    if previous_head_sha != session.head_sha {
        store::record_revision_checkpoint(
            &session.id,
            &previous_head_sha,
            &session.head_sha,
            message_count,
        )?;
    }

    if previous_head_sha != session.head_sha && acp::has_live_chat_runtime(&session.id)? {
        acp::queue_context_notice(
            &session.id,
            session.head_sha.clone(),
            revision_refresh_notice(&session, &previous_head_sha),
        )?;
    }

    emit_workspace_log(
        &session_input(&session),
        &emit_workspace_event,
        "success",
        "Review Workspace refreshed",
        None,
    );

    Ok(session)
}

pub fn list_workspace_files(root: &Path, session_id: String) -> Result<Vec<String>, String> {
    session::validate_session_id(&session_id)?;
    let session = session::read_by_id(root, &session_id)?;
    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    workspace::list_tracked_files(&workspace_dir)
}

pub fn review_chat_event_name() -> &'static str {
    REVIEW_CHAT_EVENT
}

pub fn review_walkthrough_event_name() -> &'static str {
    REVIEW_WALKTHROUGH_EVENT
}

pub fn review_chat_adapter_install_event_name() -> &'static str {
    REVIEW_CHAT_ADAPTER_INSTALL_EVENT
}

pub fn review_workspace_event_name() -> &'static str {
    REVIEW_WORKSPACE_EVENT
}

pub fn set_codex_acp_cache_root(path: std::path::PathBuf) -> Result<(), std::path::PathBuf> {
    acp::set_codex_acp_cache_root(path)
}

pub(super) fn emit_adapter_install_progress<F>(
    emit_event: &F,
    phase: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: &str,
) where
    F: Fn(ReviewChatAdapterInstallEvent),
{
    emit_event(ReviewChatAdapterInstallEvent {
        phase: phase.to_string(),
        downloaded_bytes,
        total_bytes,
        version: CODEX_ACP_VERSION.to_string(),
        message: message.to_string(),
    });
}

pub(super) fn emit_walkthrough_progress<F>(
    session_id: &str,
    emit_event: &F,
    phase: &str,
    message: &str,
) where
    F: Fn(ReviewWalkthroughEvent),
{
    emit_event(ReviewWalkthroughEvent::Progress {
        session_id: session_id.to_string(),
        phase: phase.to_string(),
        message: message.to_string(),
    });
}

pub(super) fn emit_workspace_log<F>(
    input: &ReviewSessionInput,
    emit_event: &F,
    status: &str,
    message: &str,
    command: Option<String>,
) where
    F: Fn(ReviewWorkspaceEvent),
{
    emit_event(ReviewWorkspaceEvent::Log {
        repo: input.repo().to_string(),
        number: input.number(),
        head_sha: input.head_sha().to_string(),
        status: status.to_string(),
        message: message.to_string(),
        command,
    });
}

fn session_input(session: &ReviewSession) -> ReviewSessionInput {
    ReviewSessionInput {
        repo: session.repo.clone(),
        number: session.number,
        head_sha: session.head_sha.clone(),
    }
}

fn parse_review_runtime(runtime: &str) -> Result<ReviewChatRuntimeKind, String> {
    serde_json::from_value(Value::String(runtime.trim().to_string()))
        .map_err(|_| "Review Chat runtime must be codex or open_code.".to_string())
}

pub fn ensure_review_chat_session<F>(
    root: &Path,
    session_id: String,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(ReviewChatEvent) + Send + Sync + 'static,
{
    session::validate_session_id(&session_id)?;
    if acp::has_live_chat_runtime(&session_id)? {
        let mut session = session::read_by_id(root, &session_id)?;
        if acp::live_chat_runtime_matches_session_config(
            &session_id,
            session.review_runtime,
            session.runtime_model_choice.as_deref(),
        )? {
            ensure_agent_context_current(&mut session)?;
            return Ok(());
        }

        if acp::has_active_chat_turn(&session_id)? {
            return Err(
                "Stop the active Rudu chat turn before refreshing Linear issue access.".to_string(),
            );
        }

        acp::shutdown_chat_runtime(&session_id)?;
        let agent_session_id = start_review_chat_session_inner(&session, emit_event)?;
        session.agent_session_id = Some(agent_session_id);
        session.status = ReviewSessionStatus::Launched;
        session.updated_at = now_unix_timestamp();
        session.last_error = None;
        ensure_agent_context_current(&mut session)?;
        return session::write(root, &session);
    }

    let mut session = session::read_by_id(root, &session_id)?;
    let agent_session_id = start_review_chat_session_inner(&session, emit_event)?;
    session.agent_session_id = Some(agent_session_id);
    ensure_agent_context_current(&mut session)?;

    session.status = ReviewSessionStatus::Launched;
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    session::write(root, &session)
}

pub fn get_review_chat_readiness<F>(emit_event: F) -> ReviewChatReadinessStatus
where
    F: Fn(ReviewChatAdapterInstallEvent),
{
    acp::review_chat_readiness(emit_event)
}

pub fn get_review_chat_readiness_for_runtime<F>(
    runtime: String,
    emit_event: F,
) -> ReviewChatReadinessStatus
where
    F: Fn(ReviewChatAdapterInstallEvent),
{
    let Ok(review_runtime) = parse_review_runtime(&runtime) else {
        return ReviewChatReadinessStatus {
            status: crate::models::ReviewChatReadinessStatusKind::UnknownError,
            message: Some("Review Chat runtime must be codex or open_code.".to_string()),
        };
    };

    acp::review_chat_readiness_for_runtime(review_runtime, emit_event)
}

pub fn list_opencode_models() -> Result<Vec<String>, String> {
    acp::list_opencode_models()
}

pub fn switch_review_chat_runtime(
    root: &Path,
    session_id: String,
    runtime: String,
    runtime_model_choice: Option<String>,
) -> Result<ReviewSession, String> {
    session::validate_session_id(&session_id)?;
    let review_runtime = parse_review_runtime(&runtime)?;
    let runtime_model_choice = runtime_model_choice
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty());

    if acp::has_live_chat_runtime(&session_id)? {
        if acp::has_active_chat_turn(&session_id)? {
            return Err("Stop the active Rudu chat turn before switching runtimes.".to_string());
        }
        acp::shutdown_chat_runtime(&session_id)?;
    }

    let mut session = session::read_by_id(root, &session_id)?;
    if session.review_runtime == review_runtime
        && session.runtime_model_choice == runtime_model_choice
        && session.agent_session_id.is_none()
    {
        return Ok(session);
    }

    store::reset_review_chat_state(&session_id)?;
    session.review_runtime = review_runtime;
    session.runtime_model_choice = runtime_model_choice;
    session.agent_session_id = None;
    session.agent_context_head_sha = None;
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    session::write(root, &session)?;
    Ok(session)
}

pub fn reset_review_chat_session(root: &Path, session_id: String) -> Result<ReviewSession, String> {
    session::validate_session_id(&session_id)?;

    if acp::has_live_chat_runtime(&session_id)? {
        if acp::has_active_chat_turn(&session_id)? {
            return Err("Stop the active Rudu chat turn before resetting Review Chat.".to_string());
        }
        acp::shutdown_chat_runtime(&session_id)?;
    }

    store::reset_review_chat_state(&session_id)?;
    let mut session = session::read_by_id(root, &session_id)?;
    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    acp::log_review_chat_workspace_debug(
        &workspace_dir,
        format!(
            "reset review chat session runtime={:?} previous_agent_session_id_present={}",
            session.review_runtime,
            session.agent_session_id.is_some()
        ),
    );
    session.agent_session_id = None;
    session.agent_context_head_sha = None;
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    session::write(root, &session)?;
    Ok(session)
}

pub fn set_review_chat_effort_mode<F>(
    root: &Path,
    session_id: String,
    mode: String,
    message_count: u32,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(ReviewChatEvent) + Send + Sync + 'static,
{
    session::validate_session_id(&session_id)?;
    let mode = acp::ReviewChatEffortMode::parse(&mode)?;
    let session = session::read_by_id(root, &session_id)?;
    ensure_codex_review_effort_supported(&session)?;
    ensure_review_chat_session(root, session_id.clone(), emit_event)?;
    acp::set_chat_effort_mode(&session_id, mode)?;
    store::apply_review_effort_mode(&session_id, mode.as_str(), message_count)
}

pub fn set_runtime_model_choice<F>(
    root: &Path,
    session_id: String,
    model: String,
    _emit_event: F,
) -> Result<ReviewSession, String>
where
    F: Fn(ReviewChatEvent) + Send + Sync + 'static,
{
    session::validate_session_id(&session_id)?;
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("Review model is required.".to_string());
    }

    let mut session = session::read_by_id(root, &session_id)?;
    if session.review_runtime == ReviewChatRuntimeKind::Codex {
        return Err("Use Codex review effort modes for Codex-backed Review Sessions.".to_string());
    }

    if session.runtime_model_choice.as_deref() == Some(model.as_str()) {
        return Ok(session);
    }

    let has_live_runtime = acp::has_live_chat_runtime(&session_id)?;
    if has_live_runtime && acp::has_active_chat_turn(&session_id)? {
        return Err("Stop the active Rudu chat turn before switching models.".to_string());
    }

    if has_live_runtime {
        acp::shutdown_chat_runtime(&session_id)?;
    }

    apply_runtime_model_choice_to_session(&mut session, model.clone(), has_live_runtime);
    session::write(root, &session)?;
    Ok(session)
}

fn apply_runtime_model_choice_to_session(
    session: &mut ReviewSession,
    model: String,
    reset_agent_state: bool,
) {
    session.runtime_model_choice = Some(model);
    if reset_agent_state {
        session.agent_session_id = None;
        session.agent_context_head_sha = None;
    }
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
}

pub fn set_pending_review_chat_effort_mode(
    root: &Path,
    session_id: String,
    mode: String,
) -> Result<(), String> {
    session::validate_session_id(&session_id)?;
    let mode = acp::ReviewChatEffortMode::parse(&mode)?;
    let session = session::read_by_id(root, &session_id)?;
    ensure_codex_review_effort_supported(&session)?;
    store::set_pending_review_effort_mode(&session_id, mode.as_str())
}

pub fn load_review_chat_transcript(
    root: &Path,
    session_id: String,
) -> Result<ReviewChatTranscript, String> {
    session::validate_session_id(&session_id)?;
    let _session = session::read_by_id(root, &session_id)?;
    recover_stale_active_turn(&session_id)?;
    let messages = store::read_review_chat_messages(&session_id)?;
    let effort_state = store::read_review_effort_state(&session_id)?;
    let revision_checkpoints = store::read_review_revision_checkpoints(&session_id)?;
    let active_turn = store::read_active_review_chat_turn(&session_id)?;

    Ok(ReviewChatTranscript {
        messages,
        active_review_effort_mode: effort_state.active_mode,
        pending_review_effort_mode: effort_state.pending_mode,
        revision_checkpoints,
        active_turn,
    })
}

pub fn save_review_chat_transcript(
    root: &Path,
    session_id: String,
    messages: Vec<Value>,
) -> Result<(), String> {
    session::validate_session_id(&session_id)?;
    let _session = session::read_by_id(root, &session_id)?;
    store::replace_review_chat_messages(&session_id, &messages)
}

pub fn complete_review_chat_turn(
    root: &Path,
    session_id: String,
    turn_id: String,
    terminal_message: Value,
) -> Result<ReviewChatTranscript, String> {
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;
    let _session = session::read_by_id(root, &session_id)?;
    store::complete_active_review_chat_turn(&session_id, &turn_id, &terminal_message)?;
    load_review_chat_transcript(root, session_id)
}

fn recover_stale_active_turn(session_id: &str) -> Result<(), String> {
    let Some(active_turn) = store::read_active_review_chat_turn(session_id)? else {
        return Ok(());
    };

    if active_turn_is_live(&active_turn)? {
        return Ok(());
    }

    let terminal_message = assistant_text_message(
        &active_turn.turn_id,
        active_turn.started_at,
        "Rudu stopped before this turn finished.",
        Some("error"),
    );
    store::complete_active_review_chat_turn(session_id, &active_turn.turn_id, &terminal_message)
}

fn normalize_review_effort_mode(mode: &str) -> Result<String, String> {
    match mode {
        "fast" | "deep" => Ok(mode.to_string()),
        _ => Err("Review effort mode must be fast or deep.".to_string()),
    }
}

fn timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_else(|_| now_unix_timestamp())
}

fn walkthrough_request_message(turn_id: &str, review_effort_mode: &str) -> Value {
    json!({
        "id": format!("user-{turn_id}"),
        "role": "user",
        "parts": [{ "type": "text", "text": "/walkthrough" }],
        "metadata": {
            "command": {
                "kind": "review-walkthrough",
                "label": "Review walkthrough"
            },
            "reviewEffortMode": review_effort_mode
        }
    })
}

fn walkthrough_assistant_message(
    turn_id: &str,
    started_at: i64,
    walkthrough: ReviewWalkthrough,
) -> Value {
    json!({
        "id": format!("assistant-{turn_id}"),
        "role": "assistant",
        "parts": [
            {
                "type": "data-review-walkthrough",
                "id": "review-walkthrough",
                "data": walkthrough
            }
        ],
        "metadata": {
            "finishedAt": timestamp_millis(),
            "startedAt": started_at,
            "turnId": turn_id
        }
    })
}

fn assistant_text_message(
    turn_id: &str,
    started_at: i64,
    text: &str,
    acp_stop_reason: Option<&str>,
) -> Value {
    let mut metadata = json!({
        "finishedAt": timestamp_millis(),
        "startedAt": started_at,
        "turnId": turn_id
    });
    if let Some(stop_reason) = acp_stop_reason {
        metadata["acpStopReason"] = Value::String(stop_reason.to_string());
    }

    json!({
        "id": format!("assistant-{turn_id}"),
        "role": "assistant",
        "parts": [{ "type": "text", "text": text }],
        "metadata": metadata
    })
}

fn active_turn_is_live(active_turn: &store::ReviewChatActiveTurn) -> Result<bool, String> {
    if is_marked_live_active_turn(&active_turn.session_id, &active_turn.turn_id)? {
        return Ok(true);
    }

    match active_turn.kind {
        store::ReviewChatTurnKind::Walkthrough => Ok(false),
        store::ReviewChatTurnKind::Chat => {
            if !acp::has_live_chat_runtime(&active_turn.session_id)? {
                return Ok(false);
            }
            acp::has_active_chat_turn(&active_turn.session_id)
        }
    }
}

pub fn delete_review_session_for_pull_request(
    root: &Path,
    repo: &str,
    number: u32,
) -> Result<(), String> {
    store::delete_review_session_for_pull_request(repo, number)?;
    session::delete_by_pull_request(root, repo, number)
}

pub fn send_review_chat_message<F>(
    root: &Path,
    session_id: String,
    turn_id: String,
    text: String,
    user_message: Value,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(ReviewChatEvent) + Send + Sync + 'static,
{
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Chat message is required.".to_string());
    }

    let session = session::read_by_id(root, &session_id)?;
    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    let send_started_at = Instant::now();
    acp::log_review_chat_workspace_debug(
        &workspace_dir,
        format!("send review chat message start turn_id={turn_id}"),
    );

    let emit_event = Arc::new(emit_event);
    let ensure_started_at = Instant::now();
    let ensure_emit_event = Arc::clone(&emit_event);
    ensure_review_chat_session(root, session_id.clone(), move |event| {
        (ensure_emit_event.as_ref())(event);
    })?;
    acp::log_review_chat_workspace_debug(
        &workspace_dir,
        format!(
            "ensure review chat session finish turn_id={turn_id} elapsed_ms={} total_elapsed_ms={}",
            ensure_started_at.elapsed().as_millis(),
            send_started_at.elapsed().as_millis()
        ),
    );

    let starting_turn_guard = mark_live_active_turn(&session_id, &turn_id)?;
    store::start_review_chat_turn(store::StartReviewChatTurnInput {
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        kind: store::ReviewChatTurnKind::Chat,
        request_message: user_message,
        review_effort_mode: store::read_review_effort_state(&session_id)
            .ok()
            .map(|state| state.active_mode),
        runtime_model_choice: session.runtime_model_choice.clone(),
        head_sha: session.head_sha.clone(),
        progress_message: Some("Thinking".to_string()),
    })?;
    begin_active_chat_turn_accumulator(&session_id, &turn_id)?;

    if let Err(error) = prepare_runtime_for_turn(&session) {
        complete_active_chat_turn_with_error_event(
            &session_id,
            &turn_id,
            &error,
            emit_event.as_ref(),
        )?;
        return Err(error);
    }

    acp::log_review_chat_workspace_debug(
        &workspace_dir,
        format!(
            "prepare runtime for turn finish turn_id={turn_id} total_elapsed_ms={}",
            send_started_at.elapsed().as_millis()
        ),
    );

    let consumed_context_head_sha = match acp::send_chat_message(&session_id, turn_id.clone(), text)
    {
        Ok(head_sha) => {
            drop(starting_turn_guard);
            head_sha
        }
        Err(error) => {
            complete_active_chat_turn_with_error_event(
                &session_id,
                &turn_id,
                &error,
                emit_event.as_ref(),
            )?;
            return Err(error);
        }
    };
    if let Some(head_sha) = consumed_context_head_sha {
        let mut session = session::read_by_id(root, &session_id)?;
        if session.head_sha == head_sha {
            session.agent_context_head_sha = Some(head_sha);
            session.updated_at = now_unix_timestamp();
            session::write(root, &session)?;
        }
    }

    Ok(())
}

fn prepare_runtime_for_turn(session: &ReviewSession) -> Result<(), String> {
    let effort_state = store::read_review_effort_state(&session.id)?;
    let consumed_pending_mode = acp::prepare_chat_runtime_for_turn(
        &session.id,
        session.review_runtime,
        effort_state.active_mode.as_str(),
        effort_state.pending_mode.as_deref(),
        session.runtime_model_choice.as_deref(),
    )?;
    if let Some(mode) = consumed_pending_mode {
        store::apply_review_effort_mode(&session.id, mode.as_str(), 0)?;
    }

    Ok(())
}

pub fn cancel_review_chat_turn(
    root: &Path,
    session_id: String,
    turn_id: String,
) -> Result<ReviewChatTranscript, String> {
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;
    let _session = session::read_by_id(root, &session_id)?;
    acp::cancel_chat_turn(&session_id, &turn_id)?;
    let _ = take_active_chat_turn_text(&session_id, &turn_id);

    if let Some(active_turn) = store::read_active_review_chat_turn(&session_id)? {
        if active_turn.turn_id == turn_id {
            let terminal_message = assistant_text_message(
                &turn_id,
                active_turn.started_at,
                "Stopped before Rudu finished this turn.",
                Some("error"),
            );
            store::complete_active_review_chat_turn(&session_id, &turn_id, &terminal_message)?;
        }
    }

    load_review_chat_transcript(root, session_id)
}

fn revision_refresh_notice(session: &ReviewSession, previous_head_sha: &str) -> String {
    format!(
        "Rudu hidden context update: the active pull request revision for {repo}#{number} changed from {previous_head_sha} to {head_sha}. The active head SHA is {head_sha}. The local review workspace files have been refreshed. Use the refreshed workspace for all future answers. You are running inside a clean local worktree checked out at the active pull request head SHA {head_sha}; this detached worktree is not itself the full PR diff. When reasoning about changes in this PR, first inspect the PR diff with `gh pr diff {number} --repo {repo} --name-only` and `gh pr diff {number} --repo {repo}`. `git status` and `git show HEAD` are not enough to determine the full PR change set; `git show HEAD` is scoped to the latest commit, not the full PR diff, so use it only when the developer specifically asks about the latest commit. After confirming a path belongs to the PR diff, use local file reads and read-only git commands to inspect current file contents. Stay within Inspection-Only Review: inspect code and use read-only local git commands only. GitHub CLI Delegation is always on, so you may use `gh` directly, including commands that mutate remote GitHub state. If a Linear issue attachment needs its body or description, use the session-scoped Rudu Linear issue detail tool. Do not edit files, run project commands, install dependencies, mutate local Git, or change Rudu app state. If asked to do those things, explain that Rudu is built for reviewing code. Do not mention this maintenance notice unless it is directly relevant to the user's question.",
        repo = session.repo,
        number = session.number,
        head_sha = session.head_sha,
    )
}

fn start_review_chat_session_inner<F>(
    session: &ReviewSession,
    emit_event: F,
) -> Result<String, String>
where
    F: Fn(ReviewChatEvent) + Send + Sync + 'static,
{
    ensure_session_indexed(
        session,
        "Prepare this review workspace before starting Rudu chat.",
    )?;

    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    let repo_dir = workspace_dir.join("repo");
    let emit_event = move |event: ReviewChatEvent| {
        handle_active_chat_turn_event(&event);
        emit_event(event);
    };

    let agent_session_id = acp::start_chat_runtime(
        session.id.clone(),
        session.review_runtime,
        session.runtime_model_choice.clone(),
        repo_dir,
        session.agent_session_id.clone(),
        emit_event,
    )?;

    Ok(agent_session_id)
}

fn ensure_agent_context_current(session: &mut ReviewSession) -> Result<(), String> {
    if session.agent_context_head_sha.as_deref() == Some(session.head_sha.as_str()) {
        return Ok(());
    }

    let context_notice = session
        .agent_context_head_sha
        .clone()
        .map(|previous_head_sha| revision_refresh_notice(session, &previous_head_sha))
        .unwrap_or_else(|| review_session_context_notice(session));
    acp::queue_context_notice(&session.id, session.head_sha.clone(), context_notice)
}

fn review_session_context_notice(session: &ReviewSession) -> String {
    format!(
        "Rudu hidden context: you are reviewing {repo}#{number} at active head SHA {head_sha}. You are running inside a clean local worktree checked out at the active pull request head SHA {head_sha}; this detached worktree is not itself the full PR diff. When reasoning about changes in this PR, first inspect the PR diff with `gh pr diff {number} --repo {repo} --name-only` and `gh pr diff {number} --repo {repo}`. `git status` and `git show HEAD` are not enough to determine the full PR change set; `git show HEAD` is scoped to the latest commit, not the full PR diff, so use it only when the developer specifically asks about the latest commit. After confirming a path belongs to the PR diff, use local file reads and read-only git commands to inspect current file contents. Stay within Inspection-Only Review: inspect code and use read-only local git commands only. GitHub CLI Delegation is always on, so you may use `gh` directly, including commands that mutate remote GitHub state. If a Linear issue attachment needs its body or description, use the session-scoped Rudu Linear issue detail tool. Do not edit files, run project commands, install dependencies, mutate local Git, or change Rudu app state. If asked to do those things, explain that Rudu is built for reviewing code. Do not mention this maintenance notice unless it is directly relevant to the user's question.",
        repo = session.repo,
        number = session.number,
        head_sha = session.head_sha,
    )
}

fn ensure_codex_review_effort_supported(session: &ReviewSession) -> Result<(), String> {
    if session.review_runtime == ReviewChatRuntimeKind::Codex {
        return Ok(());
    }

    Err(
        "Codex review effort modes are only available for Codex-backed Review Sessions."
            .to_string(),
    )
}

fn ensure_session_indexed(
    session: &ReviewSession,
    missing_local_message: &str,
) -> Result<(), String> {
    if !matches!(
        session.status,
        ReviewSessionStatus::Indexed | ReviewSessionStatus::Launched
    ) {
        return Err(missing_local_message.to_string());
    }

    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    let repo_dir = workspace_dir.join("repo");
    let rudu_dir = workspace_dir.join(".rudu");
    if !repo_dir.is_dir() || !rudu_dir.is_dir() {
        return Err(missing_local_message.to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        active_turn_is_live, apply_runtime_model_choice_to_session, mark_live_active_turn,
        review_chat_turn_failed_text, review_session_context_notice, revision_refresh_notice,
    };
    use crate::cache::review_sessions as store;
    use crate::models::{ReviewChatRuntimeKind, ReviewSession, ReviewSessionStatus};

    fn sample_session() -> ReviewSession {
        ReviewSession {
            id: "owner-repo-pr-42".to_string(),
            repo: "owner/repo".to_string(),
            number: 42,
            head_sha: "abc123head".to_string(),
            status: ReviewSessionStatus::Indexed,
            workspace_path: "/tmp/rudu/workspaces/owner-repo-pr-42".to_string(),
            review_runtime: ReviewChatRuntimeKind::Codex,
            runtime_model_choice: None,
            agent_session_id: None,
            agent_context_head_sha: None,
            created_at: 1,
            updated_at: 1,
            last_error: None,
        }
    }

    fn assert_pr_diff_grounding(notice: &str) {
        assert!(notice.contains("owner/repo#42"));
        assert!(notice.contains("active head SHA"));
        assert!(notice.contains("abc123head"));
        assert!(notice.contains("clean local worktree"));
        assert!(
            notice.contains("gh pr diff 42 --repo owner/repo --name-only"),
            "{notice}"
        );
        assert!(notice.contains("gh pr diff 42 --repo owner/repo"));
        assert!(notice.contains("git status"));
        assert!(notice.contains("git show HEAD"));
        assert!(
            notice.contains("latest commit, not the full PR diff"),
            "{notice}"
        );
    }

    #[test]
    fn initial_review_context_notice_grounds_agent_in_pr_diff() {
        let notice = review_session_context_notice(&sample_session());

        assert_pr_diff_grounding(&notice);
    }

    #[test]
    fn revision_refresh_notice_grounds_agent_in_pr_diff() {
        let notice = revision_refresh_notice(&sample_session(), "previous-head");

        assert!(notice.contains("changed from previous-head to abc123head"));
        assert_pr_diff_grounding(&notice);
    }

    #[test]
    fn review_chat_turn_failed_text_does_not_duplicate_prefix() {
        assert_eq!(
            review_chat_turn_failed_text("Internal error"),
            "Rudu chat turn failed: Internal error"
        );
        assert_eq!(
            review_chat_turn_failed_text("Rudu chat turn failed: Internal error"),
            "Rudu chat turn failed: Internal error"
        );
    }

    #[test]
    fn starting_chat_turn_is_live_until_guard_drops() {
        let active_turn = store::ReviewChatActiveTurn {
            session_id: "test-starting-chat-session".to_string(),
            turn_id: "test-starting-chat-turn".to_string(),
            kind: store::ReviewChatTurnKind::Chat,
            status: store::ReviewChatTurnStatus::Running,
            request_message_id: "user-test-starting-chat-turn".to_string(),
            review_effort_mode: Some("fast".to_string()),
            runtime_model_choice: None,
            head_sha: "abc123head".to_string(),
            progress_message: Some("Thinking".to_string()),
            activity_summary: Vec::new(),
            error_message: None,
            started_at: 1,
            updated_at: 1,
        };

        assert!(!active_turn_is_live(&active_turn).expect("live check succeeds"));
        let guard = mark_live_active_turn(&active_turn.session_id, &active_turn.turn_id)
            .expect("marking live turn succeeds");
        assert!(active_turn_is_live(&active_turn).expect("live check succeeds"));
        drop(guard);
        assert!(!active_turn_is_live(&active_turn).expect("live check succeeds"));
    }

    #[test]
    fn model_choice_reset_clears_agent_state_for_next_opencode_runtime() {
        let mut session = sample_session();
        session.review_runtime = ReviewChatRuntimeKind::OpenCode;
        session.runtime_model_choice = Some("opencode/old".to_string());
        session.agent_session_id = Some("ses_old".to_string());
        session.agent_context_head_sha = Some("abc123head".to_string());

        apply_runtime_model_choice_to_session(
            &mut session,
            "opencode-go/deepseek-v4-pro".to_string(),
            true,
        );

        assert_eq!(
            session.runtime_model_choice.as_deref(),
            Some("opencode-go/deepseek-v4-pro")
        );
        assert_eq!(session.agent_session_id, None);
        assert_eq!(session.agent_context_head_sha, None);
        assert_eq!(session.last_error, None);
    }
}
