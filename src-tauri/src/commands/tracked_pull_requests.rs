use crate::cache::{
    read_tracked_pull_requests,
    remove_tracked_pull_request as remove_tracked_pull_request_cache,
    track_pull_request as track_pull_request_cache,
};
use crate::models::PullRequestSummary;
use crate::services::pull_request_sync::{
    GhPullRequestSource, PullRequestSyncInput, PullRequestSyncService, SqlitePullRequestStore,
};

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
    let input = PullRequestSyncInput::new(repo)?;
    let service =
        PullRequestSyncService::new(GhPullRequestSource, SqlitePullRequestStore);
    let result = service.refresh_tracked_pull_requests(input)?;
    Ok(result.pull_requests)
}

#[tauri::command]
pub async fn refresh_tracked_pull_requests(
    repo: String,
) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || refresh_tracked_pull_requests_sync(repo)).await
}
