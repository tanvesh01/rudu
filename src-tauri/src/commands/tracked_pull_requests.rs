use crate::cache::{read_tracked_pull_requests, track_pull_request as track_pull_request_cache};
use crate::models::PullRequestSummary;

#[tauri::command]
pub fn list_tracked_pull_requests(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    read_tracked_pull_requests(repo)
}

#[tauri::command]
pub fn track_pull_request(
    repo: String,
    pull_request: PullRequestSummary,
) -> Result<PullRequestSummary, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    track_pull_request_cache(repo, &pull_request)?;
    Ok(pull_request)
}
