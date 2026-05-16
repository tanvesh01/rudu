mod acp;
mod pi;
mod session;
mod worker;

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::github::get_gh_auth_token_sync;
use crate::models::{
    GitHubFileContext, RemoteReviewReport, RemoteReviewSession, RemoteReviewSessionStatus,
};
use crate::services::remote_review_config::WorkerConfig;
use crate::support::now_unix_timestamp;

const REMOTE_REVIEW_AGENT_EVENT: &str = "remote-review-agent-event";
const REMOTE_REVIEW_CHAT_EVENT: &str = "remote-review-chat-event";

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

pub fn prepare_session(
    root: &Path,
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    let input = RemoteReviewInput::new(repo, number, head_sha)?;
    fs::create_dir_all(root).map_err(|error| format!("Failed to create review root: {error}"))?;

    let config = WorkerConfig::load(root)?;
    let github_token = get_gh_auth_token_sync()?;
    let worker_session = worker::prepare_session(&config, &input, &github_token)?;
    let session = session::from_worker(root, worker_session)?;
    session::write(root, &session)?;
    Ok(session)
}

pub fn hydrate_session(root: &Path, session_id: String) -> Result<GitHubFileContext, String> {
    let session = session::read_by_id(root, &session_id)?;
    let result = hydrate_session_inner(root, &session);

    match result {
        Ok(file_context) => Ok(file_context),
        Err(error) => {
            let mut failed_session = session;
            failed_session.status = RemoteReviewSessionStatus::Failed;
            failed_session.updated_at = now_unix_timestamp();
            failed_session.last_error = Some(error.clone());
            worker::mark_failed(root, &failed_session.id, &error);
            let _ = session::write(root, &failed_session);
            Err(error)
        }
    }
}

pub fn remote_review_agent_event_name() -> &'static str {
    REMOTE_REVIEW_AGENT_EVENT
}

pub fn remote_review_chat_event_name() -> &'static str {
    REMOTE_REVIEW_CHAT_EVENT
}

pub fn start_remote_review_agent<F>(
    root: &Path,
    session_id: String,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewAgentEvent) + Send + Sync + 'static,
{
    let mut session = session::read_by_id(root, &session_id)?;
    let result = start_remote_review_agent_inner(root, &session, emit_event);

    match result {
        Ok(()) => {
            session.status = RemoteReviewSessionStatus::Launched;
            session.updated_at = now_unix_timestamp();
            session.last_error = None;
            refresh_worker_status(
                root,
                &mut session,
                RemoteReviewSessionStatus::Launched,
                None,
            );
            session::write(root, &session)
        }
        Err(error) => {
            session.status = RemoteReviewSessionStatus::Failed;
            session.updated_at = now_unix_timestamp();
            session.last_error = Some(error.clone());
            worker::mark_failed(root, &session.id, &error);
            let _ = session::write(root, &session);
            Err(error)
        }
    }
}

pub fn ensure_remote_review_chat_session<F>(
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
    if session.file_context.is_none()
        || !matches!(
            session.status,
            RemoteReviewSessionStatus::Indexed | RemoteReviewSessionStatus::Launched
        )
    {
        hydrate_session(root, session_id.clone())?;
        session = session::read_by_id(root, &session_id)?;
    }

    start_remote_review_chat_session_inner(root, &session, emit_event)?;

    session.status = RemoteReviewSessionStatus::Launched;
    session.updated_at = now_unix_timestamp();
    session.last_error = None;
    refresh_worker_status(
        root,
        &mut session,
        RemoteReviewSessionStatus::Launched,
        None,
    );
    session::write(root, &session)
}

pub fn send_remote_review_chat_message(
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

pub fn cancel_remote_review_chat_turn(session_id: String, turn_id: String) -> Result<(), String> {
    session::validate_session_id(&session_id)?;
    session::validate_turn_id(&turn_id)?;
    acp::cancel_chat_turn(&session_id, &turn_id)
}

pub fn get_report(root: &Path, session_id: String) -> Result<Option<RemoteReviewReport>, String> {
    session::get_report(root, &session_id)
}

pub fn session_id_for(repo: &str, number: u32, head_sha: &str) -> String {
    session::session_id_for(repo, number, head_sha)
}

fn hydrate_session_inner(
    root: &Path,
    session: &RemoteReviewSession,
) -> Result<GitHubFileContext, String> {
    let config = WorkerConfig::load(root)?;
    let worker_session = match worker::hydrate_session(&config, &session.id) {
        Ok(worker_session) => worker_session,
        Err(error) if worker::is_missing_session_error(&error) => {
            let prepared_session = prepare_worker_session_from_local(root, session)?;
            worker::hydrate_session(&config, &prepared_session.id)?
        }
        Err(error) => return Err(error),
    };
    worker::ensure_session_matches(&worker_session, session)?;

    let file_context = worker_session.file_context.clone().ok_or_else(|| {
        "Remote review Worker session is missing indexed file metadata. Recreate the session from the selected PR.".to_string()
    })?;

    let session_dir = session::session_dir(root, &session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    session::capture_diff_snapshots(&session_dir, session)?;

    let local_session = session::from_worker(root, worker_session)?;
    session::write(root, &local_session)?;
    Ok(file_context)
}

fn prepare_worker_session_from_local(
    root: &Path,
    session: &RemoteReviewSession,
) -> Result<RemoteReviewSession, String> {
    let input = RemoteReviewInput::new(
        session.repo.clone(),
        session.number,
        session.head_sha.clone(),
    )?;
    let config = WorkerConfig::load(root)?;
    let github_token = get_gh_auth_token_sync()?;
    let worker_session = worker::prepare_session(&config, &input, &github_token)?;
    worker::ensure_session_matches(&worker_session, session)?;
    let local_session = session::from_worker(root, worker_session)?;
    session::write(root, &local_session)?;
    Ok(local_session)
}

fn start_remote_review_agent_inner<F>(
    root: &Path,
    session: &RemoteReviewSession,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewAgentEvent) + Send + Sync + 'static,
{
    ensure_session_indexed(
        root,
        session,
        "Hydrate this review session before starting Pi over ACP.",
    )?;

    let config = WorkerConfig::load(root)?;
    let session_dir = session::session_dir(root, &session.id);
    let runtime_files = pi::prepare_runtime_files(&config, session, &session_dir)?;
    let prompt = pi::review_prompt(session);
    let root_path = root.to_path_buf();
    let session_id = session.id.clone();

    acp::start_agent_runtime(
        session_id.clone(),
        session_dir,
        runtime_files.script_path,
        prompt,
        emit_event,
        move |error| {
            session::mark_local_and_worker_failed(&root_path, &session_id, &error);
        },
    )
}

fn start_remote_review_chat_session_inner<F>(
    root: &Path,
    session: &RemoteReviewSession,
    emit_event: F,
) -> Result<(), String>
where
    F: Fn(RemoteReviewChatEvent) + Send + Sync + 'static,
{
    ensure_session_indexed(
        root,
        session,
        "Hydrate this review session before starting AI chat.",
    )?;

    let config = WorkerConfig::load(root)?;
    let session_dir = session::session_dir(root, &session.id);
    let runtime_files = pi::prepare_runtime_files(&config, session, &session_dir)?;

    acp::start_chat_runtime(
        session.id.clone(),
        session_dir,
        runtime_files.script_path,
        emit_event,
    )
}

fn ensure_session_indexed(
    root: &Path,
    session: &RemoteReviewSession,
    missing_local_message: &str,
) -> Result<(), String> {
    if session.file_context.is_none() {
        return Err(missing_local_message.to_string());
    }

    let config = WorkerConfig::load(root)?;
    let worker_session = match worker::get_session(&config, &session.id) {
        Ok(worker_session) => worker_session,
        Err(error) if worker::is_missing_session_error(&error) => {
            hydrate_session_inner(root, session)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    worker::ensure_session_matches(&worker_session, session)?;
    if worker_session.file_context.is_none() {
        return Err(
            "Remote review Worker session is not indexed yet. Hydrate it first.".to_string(),
        );
    }

    Ok(())
}

fn refresh_worker_status(
    root: &Path,
    session: &mut RemoteReviewSession,
    status: RemoteReviewSessionStatus,
    last_error: Option<String>,
) {
    if let Ok(config) = WorkerConfig::load(root) {
        if let Ok(worker_session) = worker::update_status(&config, &session.id, status, last_error)
        {
            session.file_context = worker_session.file_context;
            session.updated_at = worker_session.updated_at;
        }
    }
}
