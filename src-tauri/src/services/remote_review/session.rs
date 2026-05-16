use std::fs;
use std::path::{Path, PathBuf};

use crate::github::run_gh;
use crate::models::{RemoteReviewReport, RemoteReviewSession, RemoteReviewSessionStatus};
use crate::support::now_unix_timestamp;

use super::worker;

const METADATA_FILE: &str = "session.json";
const REPORT_FILE: &str = "remote-review-report.md";
pub(super) const DIFF_FILE: &str = "pr.diff";
pub(super) const CHANGED_FILES_FILE: &str = "changed-files.txt";

pub(super) fn from_worker(
    root: &Path,
    worker_session: worker::WorkerSession,
) -> Result<RemoteReviewSession, String> {
    validate_session_id(&worker_session.id)?;
    let session_dir = session_dir(root, &worker_session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;

    Ok(RemoteReviewSession {
        id: worker_session.id,
        repo: worker_session.repo,
        number: worker_session.number,
        head_sha: worker_session.head_sha,
        status: worker_session.status,
        file_context: worker_session.file_context,
        report_path: session_dir.join(REPORT_FILE).to_string_lossy().to_string(),
        created_at: worker_session.created_at,
        updated_at: worker_session.updated_at,
        last_error: worker_session.last_error,
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
    let report_path = PathBuf::from(&session.report_path);

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
    session_dir: &Path,
    session: &RemoteReviewSession,
) -> Result<(), String> {
    let diff_path = session_dir.join(DIFF_FILE);
    let changed_files_path = session_dir.join(CHANGED_FILES_FILE);
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

pub(super) fn mark_local_and_worker_failed(root: &Path, session_id: &str, error: &str) {
    if let Ok(mut session) = read_by_id(root, session_id) {
        session.status = RemoteReviewSessionStatus::Failed;
        session.updated_at = now_unix_timestamp();
        session.last_error = Some(error.to_string());
        worker::mark_failed(root, &session.id, error);
        let _ = write(root, &session);
    } else {
        worker::mark_failed(root, session_id, error);
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

pub(super) fn session_id_for(repo: &str, number: u32, head_sha: &str) -> String {
    format!(
        "{}-pr-{}-{}",
        slugify(repo),
        number,
        short_sha(head_sha).to_ascii_lowercase()
    )
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

fn short_sha(head_sha: &str) -> &str {
    head_sha.get(..12).unwrap_or(head_sha)
}

#[cfg(test)]
mod tests {
    use super::session_id_for;

    #[test]
    fn session_id_is_keyed_by_repo_number_and_short_sha() {
        assert_eq!(
            session_id_for("Owner/Repo.Name", 42, "ABCDEF0123456789"),
            "owner-repo-name-pr-42-abcdef012345"
        );
    }
}
