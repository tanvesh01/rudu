use crate::cache::{
    read_cached_pull_requests, update_repo_access_timestamp, write_pull_requests_cache,
};
use crate::models::{PrPatch, PullRequestSummary};
use crate::services::diff_data::{DiffDataRequest, DiffDataService, GhDiffSource, SqliteDiffCache};

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
pub fn list_cached_pull_requests(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    read_cached_pull_requests(repo)
}

fn refresh_pull_requests_sync(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    let pull_requests = crate::cache::fetch_pull_requests_from_github(repo)?;
    write_pull_requests_cache(repo, &pull_requests)?;
    update_repo_access_timestamp(repo)?;

    Ok(pull_requests)
}

#[tauri::command]
pub async fn list_pull_requests(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || refresh_pull_requests_sync(repo)).await
}

fn get_pull_request_patch_sync(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<PrPatch, String> {
    let req = DiffDataRequest::new(repo, number, head_sha)?;
    DiffDataService::new(&GhDiffSource, &SqliteDiffCache).get_patch(&req)
}

#[tauri::command]
pub async fn get_pull_request_patch(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<PrPatch, String> {
    run_blocking_task(move || get_pull_request_patch_sync(repo, number, head_sha)).await
}

fn list_pull_request_changed_files_sync(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Vec<String>, String> {
    let req = DiffDataRequest::new(repo, number, head_sha)?;
    DiffDataService::new(&GhDiffSource, &SqliteDiffCache).get_changed_files(&req)
}

#[tauri::command]
pub async fn list_pull_request_changed_files(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Vec<String>, String> {
    run_blocking_task(move || list_pull_request_changed_files_sync(repo, number, head_sha)).await
}
