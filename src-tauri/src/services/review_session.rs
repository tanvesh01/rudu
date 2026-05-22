mod acp;
mod session;
mod store;
mod walkthrough;
mod workspace;

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::models::{
    ReviewChatReadinessStatus, ReviewSession, ReviewSessionStatus, ReviewWalkthrough,
};
use crate::support::now_unix_timestamp;

const REVIEW_CHAT_EVENT: &str = "review-chat-event";
const REVIEW_WALKTHROUGH_EVENT: &str = "review-walkthrough-event";
const REVIEW_WORKSPACE_EVENT: &str = "review-workspace-event";

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
        acp::send_context_notice(
            &session.id,
            revision_refresh_notice(&session, &previous_head_sha),
        )?;
        session.agent_context_head_sha = Some(session.head_sha.clone());
        session.updated_at = now_unix_timestamp();
        session::write(root, &session)?;
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

pub fn review_workspace_event_name() -> &'static str {
    REVIEW_WORKSPACE_EVENT
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
        ensure_agent_context_current(root, &mut session)?;
        if acp::live_chat_runtime_matches_current_mcp_config(&session_id)? {
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
        return session::write(root, &session);
    }

    let mut session = session::read_by_id(root, &session_id)?;
    let agent_session_id = start_review_chat_session_inner(&session, emit_event)?;
    session.agent_session_id = Some(agent_session_id);
    ensure_agent_context_current(root, &mut session)?;

    session.status = ReviewSessionStatus::Launched;
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    session::write(root, &session)
}

pub fn get_review_chat_readiness() -> ReviewChatReadinessStatus {
    acp::review_chat_readiness()
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
    ensure_review_chat_session(root, session_id.clone(), emit_event)?;
    acp::set_chat_effort_mode(&session_id, mode)?;
    store::apply_review_effort_mode(&session_id, mode.as_str(), message_count)
}

pub fn set_pending_review_chat_effort_mode(
    root: &Path,
    session_id: String,
    mode: String,
) -> Result<(), String> {
    session::validate_session_id(&session_id)?;
    let mode = acp::ReviewChatEffortMode::parse(&mode)?;
    let _session = session::read_by_id(root, &session_id)?;
    store::set_pending_review_effort_mode(&session_id, mode.as_str())
}

pub fn load_review_chat_transcript(
    root: &Path,
    session_id: String,
) -> Result<ReviewChatTranscript, String> {
    session::validate_session_id(&session_id)?;
    let _session = session::read_by_id(root, &session_id)?;
    let messages = store::read_review_chat_messages(&session_id)?;
    let effort_state = store::read_review_effort_state(&session_id)?;
    let revision_checkpoints = store::read_review_revision_checkpoints(&session_id)?;

    Ok(ReviewChatTranscript {
        messages,
        active_review_effort_mode: effort_state.active_mode,
        pending_review_effort_mode: effort_state.pending_mode,
        revision_checkpoints,
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

pub fn delete_review_session_for_pull_request(
    root: &Path,
    repo: &str,
    number: u32,
) -> Result<(), String> {
    store::delete_review_session_for_pull_request(repo, number)?;
    session::delete_by_pull_request(root, repo, number)
}

pub fn send_review_chat_message(
    session_id: String,
    turn_id: String,
    text: String,
) -> Result<(), String> {
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Chat message is required.".to_string());
    }

    acp::send_chat_message(&session_id, turn_id, text)
}

pub fn cancel_review_chat_turn(session_id: String, turn_id: String) -> Result<(), String> {
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;
    acp::cancel_chat_turn(&session_id, &turn_id)
}

fn revision_refresh_notice(session: &ReviewSession, previous_head_sha: &str) -> String {
    format!(
        "Rudu hidden context update: the active pull request revision for {repo}#{number} changed from {previous_head_sha} to {head_sha}. The local review workspace files have been refreshed. Use the refreshed workspace for all future answers. Stay within Inspection-Only Review: inspect code and use read-only local git commands only. GitHub CLI Delegation is always on, so you may use `gh` directly, including commands that mutate remote GitHub state. If a Linear issue attachment needs its body or description, use the session-scoped Rudu Linear issue detail tool. Do not edit files, run project commands, install dependencies, mutate local Git, or change Rudu app state. If asked to do those things, explain that Rudu is built for reviewing code. Do not mention this maintenance notice unless it is directly relevant to the user's question.",
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

    acp::start_chat_runtime(
        session.id.clone(),
        repo_dir,
        session.agent_session_id.clone(),
        emit_event,
    )
}

fn ensure_agent_context_current(root: &Path, session: &mut ReviewSession) -> Result<(), String> {
    if session.agent_context_head_sha.as_deref() == Some(session.head_sha.as_str()) {
        return Ok(());
    }

    let context_notice = session
        .agent_context_head_sha
        .clone()
        .map(|previous_head_sha| revision_refresh_notice(session, &previous_head_sha))
        .unwrap_or_else(|| review_session_context_notice(session));
    acp::send_context_notice(&session.id, context_notice)?;
    session.agent_context_head_sha = Some(session.head_sha.clone());
    session.updated_at = now_unix_timestamp();
    session::write(root, session)
}

fn review_session_context_notice(session: &ReviewSession) -> String {
    format!(
        "Rudu hidden context: you are reviewing {repo}#{number} at active head SHA {head_sha}. You are running inside the local repository worktree for this Review Session. Stay within Inspection-Only Review: inspect code and use read-only local git commands only. GitHub CLI Delegation is always on, so you may use `gh` directly, including commands that mutate remote GitHub state. If a Linear issue attachment needs its body or description, use the session-scoped Rudu Linear issue detail tool. Do not edit files, run project commands, install dependencies, mutate local Git, or change Rudu app state. If asked to do those things, explain that Rudu is built for reviewing code. Do not mention this maintenance notice unless it is directly relevant to the user's question.",
        repo = session.repo,
        number = session.number,
        head_sha = session.head_sha,
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
