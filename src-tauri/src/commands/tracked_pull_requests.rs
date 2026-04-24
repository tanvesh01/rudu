use std::collections::HashMap;

use crate::cache::{
    fetch_pull_request_from_github, fetch_pull_requests_from_github, read_tracked_pull_requests,
    remove_tracked_pull_request as remove_tracked_pull_request_cache,
    track_pull_request as track_pull_request_cache, update_repo_access_timestamp,
};
use crate::models::PullRequestSummary;

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

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

#[tauri::command]
pub fn remove_tracked_pull_request(repo: String, number: u32) -> Result<(), String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    remove_tracked_pull_request_cache(repo, number)
}

fn refresh_tracked_pull_requests_sync(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    let tracked = read_tracked_pull_requests(repo)?;
    if tracked.is_empty() {
        return Ok(Vec::new());
    }

    let open_pull_requests = fetch_pull_requests_from_github(repo)?;
    let open_by_number: HashMap<u32, PullRequestSummary> = open_pull_requests
        .into_iter()
        .map(|pull_request| (pull_request.core.number, pull_request))
        .collect();

    for pull_request in tracked {
        if let Some(open_pull_request) = open_by_number.get(&pull_request.core.number) {
            track_pull_request_cache(repo, open_pull_request)?;
            continue;
        }

        if pull_request.core.state == "OPEN" {
            if let Ok(verified_pull_request) =
                fetch_pull_request_from_github(repo, pull_request.core.number)
            {
                track_pull_request_cache(repo, &verified_pull_request)?;
            }
        }
    }

    update_repo_access_timestamp(repo)?;
    read_tracked_pull_requests(repo)
}

#[tauri::command]
pub async fn refresh_tracked_pull_requests(
    repo: String,
) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || refresh_tracked_pull_requests_sync(repo)).await
}
