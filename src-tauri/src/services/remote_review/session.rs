use std::fs;
use std::path::{Path, PathBuf};

use crate::github::run_gh;
use crate::models::{RemoteReviewReport, RemoteReviewSession, RemoteReviewSessionStatus};
use crate::support::now_unix_timestamp;

use super::workspace::ReviewWorkspace;

const METADATA_FILE: &str = "session.json";
const REPORT_FILE: &str = "review-report.md";
pub(super) const DIFF_FILE: &str = "pr.diff";
pub(super) const CHANGED_FILES_FILE: &str = "changed-files.txt";

pub(super) fn from_workspace(
    root: &Path,
    repo: String,
    number: u32,
    workspace: &ReviewWorkspace,
) -> Result<RemoteReviewSession, String> {
    let id = session_id_for(&repo, number);
    validate_session_id(&id)?;
    let session_dir = session_dir(root, &id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    let now = now_unix_timestamp();

    Ok(RemoteReviewSession {
        id,
        repo,
        number,
        head_sha: workspace.head_sha.clone(),
        status: RemoteReviewSessionStatus::Indexed,
        workspace_path: workspace.workspace_dir.to_string_lossy().to_string(),
        report_path: workspace.rudu_dir.join(REPORT_FILE).to_string_lossy().to_string(),
        created_at: now,
        updated_at: now,
        last_error: None,
    })
}

pub(super) fn read_by_id(root: &Path, session_id: &str) -> Result<RemoteReviewSession, String> {
    validate_session_id(session_id)?;
    let metadata_path = metadata_path(&session_dir(root, session_id));
    let body = fs::read_to_string(&metadata_path)
        .map_err(|error| format!("Failed to read remote review session: {error}"))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse remote review session: {error}"))
}

pub(super) fn write(root: &Path, session: &RemoteReviewSession) -> Result<(), String> {
    validate_session_id(&session.id)?;
    let session_dir = session_dir(root, &session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    let body = serde_json::to_string_pretty(session)
        .map_err(|error| format!("Failed to serialize remote review session: {error}"))?;
    fs::write(metadata_path(&session_dir), body)
        .map_err(|error| format!("Failed to write remote review session: {error}"))
}

pub(super) fn get_report(
    root: &Path,
    session_id: &str,
) -> Result<Option<RemoteReviewReport>, String> {
    let session = read_by_id(root, session_id)?;
    let report_path = PathBuf::from(session.report_path.as_str());

    if !report_path.exists() {
        return Ok(None);
    }

    let body = fs::read_to_string(&report_path)
        .map_err(|error| format!("Failed to read remote review report: {error}"))?;
    let updated_at = fs::metadata(&report_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(now_unix_timestamp);

    Ok(Some(RemoteReviewReport {
        session_id: session.id,
        path: report_path.to_string_lossy().to_string(),
        body,
        updated_at,
    }))
}

pub(super) fn capture_diff_snapshots(
    rudu_dir: &Path,
    session: &RemoteReviewSession,
) -> Result<(), String> {
    let diff_path = rudu_dir.join(DIFF_FILE);
    let changed_files_path = rudu_dir.join(CHANGED_FILES_FILE);
    let number = session.number.to_string();

    let diff = run_gh(&["pr", "diff", &number, "--repo", &session.repo])?;
    fs::write(&diff_path, diff)
        .map_err(|error| format!("Failed to write PR diff snapshot: {error}"))?;

    let changed_files = run_gh(&[
        "pr",
        "diff",
        &number,
        "--repo",
        &session.repo,
        "--name-only",
    ])?;
    fs::write(&changed_files_path, changed_files)
        .map_err(|error| format!("Failed to write changed files snapshot: {error}"))?;

    Ok(())
}

pub(super) fn mark_local_failed(root: &Path, session_id: &str, error: &str) {
    if let Ok(mut session) = read_by_id(root, session_id) {
        session.status = RemoteReviewSessionStatus::Failed;
        session.updated_at = now_unix_timestamp();
        session.last_error = Some(error.to_string());
        let _ = write(root, &session);
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
        return Err("Remote review session id is invalid".to_string());
    }

    Ok(())
}

pub(super) fn validate_turn_id(turn_id: &str) -> Result<(), String> {
    if turn_id.is_empty()
        || turn_id
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    {
        return Err("Remote review chat turn id is invalid".to_string());
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
    use super::session_id_for;

    #[test]
    fn session_id_is_keyed_by_repo_and_number() {
        assert_eq!(
            session_id_for("Owner/Repo.Name", 42),
            "owner-repo-name-pr-42"
        );
    }
}
