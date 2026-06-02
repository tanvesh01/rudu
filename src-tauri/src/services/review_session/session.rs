use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{ReviewChatRuntimeKind, ReviewSession, ReviewSessionStatus};
use crate::support::now_unix_timestamp;

use super::workspace::ReviewWorkspace;

const METADATA_FILE: &str = "session.json";

pub(super) fn from_workspace(
    root: &Path,
    repo: String,
    number: u32,
    workspace: &ReviewWorkspace,
) -> Result<ReviewSession, String> {
    let id = session_id_for(&repo, number);
    validate_session_id(&id)?;
    let session_dir = session_dir(root, &id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    let now = now_unix_timestamp();

    Ok(ReviewSession {
        id,
        repo,
        number,
        head_sha: workspace.head_sha.clone(),
        status: ReviewSessionStatus::Indexed,
        workspace_path: workspace.workspace_dir.to_string_lossy().to_string(),
        review_runtime: ReviewChatRuntimeKind::Codex,
        runtime_model_choice: None,
        agent_session_id: None,
        agent_context_head_sha: None,
        created_at: now,
        updated_at: now,
        last_error: None,
    })
}

pub(super) fn read_by_id(root: &Path, session_id: &str) -> Result<ReviewSession, String> {
    validate_session_id(session_id)?;
    match crate::cache::review_sessions::read_review_session(session_id) {
        Ok(Some(session)) => return Ok(session),
        Ok(None) => {}
        Err(error) if error.contains("database path is not initialized") => {}
        Err(error) => return Err(error),
    }

    let metadata_path = metadata_path(&session_dir(root, session_id));
    let body = fs::read_to_string(&metadata_path)
        .map_err(|error| format!("Failed to read Rudu session: {error}"))?;
    let session = serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse Rudu session: {error}"))?;
    if let Err(error) = crate::cache::review_sessions::upsert_review_session(&session) {
        if !error.contains("database path is not initialized") {
            return Err(error);
        }
    }
    Ok(session)
}

pub(super) fn read_by_pull_request(
    root: &Path,
    repo: &str,
    number: u32,
) -> Result<Option<ReviewSession>, String> {
    let session_id = session_id_for(repo, number);
    validate_session_id(&session_id)?;
    match read_by_id(root, &session_id) {
        Ok(session) => Ok(Some(session)),
        Err(error) if error.contains("Failed to read Rudu session") => Ok(None),
        Err(error) => Err(error),
    }
}

pub(super) fn delete_by_pull_request(root: &Path, repo: &str, number: u32) -> Result<(), String> {
    let session_id = session_id_for(repo, number);
    validate_session_id(&session_id)?;
    let session_dir = session_dir(root, &session_id);

    match fs::remove_dir_all(&session_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete Rudu session metadata at {}: {error}",
            session_dir.display()
        )),
    }
}

pub(super) fn write(root: &Path, session: &ReviewSession) -> Result<(), String> {
    validate_session_id(&session.id)?;
    let session_dir = session_dir(root, &session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    let body = serde_json::to_string_pretty(session)
        .map_err(|error| format!("Failed to serialize Rudu session: {error}"))?;
    fs::write(metadata_path(&session_dir), body)
        .map_err(|error| format!("Failed to write Rudu session: {error}"))?;
    match crate::cache::review_sessions::upsert_review_session(session) {
        Ok(()) => Ok(()),
        Err(error) if error.contains("database path is not initialized") => Ok(()),
        Err(error) => Err(error),
    }
}

fn metadata_path(session_dir: &Path) -> PathBuf {
    session_dir.join(METADATA_FILE)
}

pub(super) fn session_dir(root: &Path, session_id: &str) -> PathBuf {
    root.join(session_id)
}

pub(super) fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id
            .chars()
            .any(|ch| !(ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'))
    {
        return Err("Rudu session id is invalid".to_string());
    }

    Ok(())
}

pub(super) fn validate_turn_id(turn_id: &str) -> Result<(), String> {
    if turn_id.is_empty()
        || turn_id
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    {
        return Err("Rudu chat turn id is invalid".to_string());
    }

    Ok(())
}

pub(super) fn session_id_for(repo: &str, number: u32) -> String {
    format!("{}-pr-{}", slugify(repo), number)
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            previous_dash = false;
            Some(ch.to_ascii_lowercase())
        } else if !previous_dash {
            previous_dash = true;
            Some('-')
        } else {
            None
        };

        if let Some(next) = next {
            output.push(next);
        }
    }

    output.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::{delete_by_pull_request, session_dir, session_id_for, METADATA_FILE};
    use std::fs;

    #[test]
    fn session_id_is_keyed_by_repo_and_number() {
        assert_eq!(
            session_id_for("Owner/Repo.Name", 42),
            "owner-repo-name-pr-42"
        );
    }

    #[test]
    fn deletes_session_metadata_for_pull_request() {
        let root = std::env::temp_dir().join(format!("rudu-session-test-{}", std::process::id()));
        let session_id = session_id_for("owner/repo", 42);
        let session_dir = session_dir(&root, &session_id);
        fs::create_dir_all(&session_dir).expect("session dir is created");
        fs::write(session_dir.join(METADATA_FILE), "{}").expect("metadata is written");

        delete_by_pull_request(&root, "owner/repo", 42).expect("metadata is deleted");

        assert!(!session_dir.exists());
        let _ = fs::remove_dir_all(root);
    }
}
