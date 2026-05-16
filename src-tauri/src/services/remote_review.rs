mod acp;
mod pi;
mod session;
mod workspace;

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::models::{RemoteReviewReport, RemoteReviewSession, RemoteReviewSessionStatus};
use crate::support::now_unix_timestamp;

const REVIEW_AGENT_EVENT: &str = "review-agent-event";
const REVIEW_CHAT_EVENT: &str = "review-chat-event";

#[derive(Debug, Clone)]
pub struct RemoteReviewInput {
    repo: String,
    number: u32,
    head_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RemoteReviewAgentEvent {
    Message {
        #[serde(rename = "sessionId")]
        session_id: String,
        text: String,
    },
    Thought {
        #[serde(rename = "sessionId")]
        session_id: String,
        text: String,
    },
    Tool {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "toolCallId")]
        tool_call_id: Option<String>,
        title: Option<String>,
        status: Option<String>,
    },
    Finished {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "stopReason")]
        stop_reason: Option<String>,
    },
    Error {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReviewAcpPlanEntry {
    content: String,
    priority: String,
    status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RemoteReviewChatEvent {
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
        entries: Vec<RemoteReviewAcpPlanEntry>,
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

impl RemoteReviewInput {
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
}

pub fn prepare_workspace(
    root: &Path,
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    let input = RemoteReviewInput::new(repo, number, head_sha)?;
    fs::create_dir_all(root).map_err(|error| format!("Failed to create review root: {error}"))?;

    let workspace = workspace::prepare(&input)?;
    let session = session::from_workspace(root, input.repo, input.number, &workspace)?;

    session::capture_diff_snapshots(&workspace.rudu_dir, &session)?;
    session::write(root, &session)?;
    Ok(session)
}

pub fn refresh_review_session(
    root: &Path,
    session_id: String,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    session::validate_session_id(&session_id)?;
    if acp::has_live_chat_runtime(&session_id)? && acp::has_active_chat_turn(&session_id)? {
        return Err(
            "Stop the active remote review AI chat turn before refreshing the PR.".to_string(),
        );
    }

    let previous = session::read_by_id(root, &session_id)?;
    let input = RemoteReviewInput::new(previous.repo.clone(), previous.number, head_sha)?;
    let workspace = workspace::prepare(&input)?;
    let mut session =
        session::from_workspace(root, previous.repo.clone(), previous.number, &workspace)?;

    if session.id != previous.id {
        return Err("Refreshed review session did not match the existing session.".to_string());
    }

    let previous_head_sha = previous.head_sha.clone();
    session.created_at = previous.created_at;
    session.status = match previous.status {
        RemoteReviewSessionStatus::Failed => RemoteReviewSessionStatus::Indexed,
        status => status,
    };
    session.updated_at = now_unix_timestamp();
    session.last_error = None;

    session::capture_diff_snapshots(&workspace.rudu_dir, &session)?;
    session::write(root, &session)?;

    if previous_head_sha != session.head_sha && acp::has_live_chat_runtime(&session.id)? {
        acp::send_context_notice(
            &session.id,
            revision_refresh_notice(&session, &previous_head_sha),
        )?;
    }

    Ok(session)
}

pub fn review_agent_event_name() -> &'static str {
    REVIEW_AGENT_EVENT
}

pub fn review_chat_event_name() -> &'static str {
    REVIEW_CHAT_EVENT
}

pub fn start_review_agent<F>(
    root: &Path,
    session_id: String,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewAgentEvent) + Send + Sync + 'static,
{
    let mut session = session::read_by_id(root, &session_id)?;
    let result = start_review_agent_inner(root, &session, emit_event);

    match result {
        Ok(()) => {
            session.status = RemoteReviewSessionStatus::Launched;
            session.updated_at = now_unix_timestamp();
            session.last_error = None;
            session::write(root, &session)
        }
        Err(error) => {
            session.status = RemoteReviewSessionStatus::Failed;
            session.updated_at = now_unix_timestamp();
            session.last_error = Some(error.clone());
            let _ = session::write(root, &session);
            Err(error)
        }
    }
}

pub fn ensure_review_chat_session<F>(
    root: &Path,
    session_id: String,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewChatEvent) + Send + Sync + 'static,
{
    session::validate_session_id(&session_id)?;
    if acp::has_live_chat_runtime(&session_id)? {
        return Ok(());
    }

    let mut session = session::read_by_id(root, &session_id)?;
    start_review_chat_session_inner(&session, emit_event)?;

    session.status = RemoteReviewSessionStatus::Launched;
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    session::write(root, &session)
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

pub fn get_report(root: &Path, session_id: String) -> Result<Option<RemoteReviewReport>, String> {
    session::get_report(root, &session_id)
}

fn revision_refresh_notice(session: &RemoteReviewSession, previous_head_sha: &str) -> String {
    format!(
        "Rudu hidden context update: the active pull request revision for {repo}#{number} changed from {previous_head_sha} to {head_sha}. The local review workspace files, PR diff snapshot, and changed-files snapshot have been refreshed. Use the refreshed workspace for all future answers. Do not mention this maintenance notice unless it is directly relevant to the user's question.",
        repo = session.repo,
        number = session.number,
        head_sha = session.head_sha,
    )
}

fn start_review_agent_inner<F>(
    root: &Path,
    session: &RemoteReviewSession,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewAgentEvent) + Send + Sync + 'static,
{
    ensure_session_indexed(
        session,
        "Prepare this review workspace before starting Pi over ACP.",
    )?;

    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    let rudu_dir = workspace_dir.join(".rudu");
    let runtime_files = pi::prepare_runtime_files(session, &workspace_dir, &rudu_dir)?;
    let prompt = pi::review_prompt(session);
    let root_path = root.to_path_buf();
    let session_id = session.id.clone();

    acp::start_agent_runtime(
        session_id.clone(),
        workspace_dir,
        runtime_files.script_path,
        prompt,
        emit_event,
        move |error| {
            session::mark_local_failed(&root_path, &session_id, &error);
        },
    )
}

fn start_review_chat_session_inner<F>(
    session: &RemoteReviewSession,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewChatEvent) + Send + Sync + 'static,
{
    ensure_session_indexed(
        session,
        "Prepare this review workspace before starting AI chat.",
    )?;

    let workspace_dir = std::path::PathBuf::from(session.workspace_path.as_str());
    let rudu_dir = workspace_dir.join(".rudu");
    let runtime_files = pi::prepare_runtime_files(session, &workspace_dir, &rudu_dir)?;

    acp::start_chat_runtime(
        session.id.clone(),
        workspace_dir,
        runtime_files.script_path,
        emit_event,
    )
}

fn ensure_session_indexed(
    session: &RemoteReviewSession,
    missing_local_message: &str,
) -> Result<(), String> {
    if !matches!(
        session.status,
        RemoteReviewSessionStatus::Indexed | RemoteReviewSessionStatus::Launched
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
