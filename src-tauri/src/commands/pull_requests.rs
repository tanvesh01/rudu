use std::collections::HashSet;

use crate::cache::{
    get_cached_changed_files, get_cached_patch, read_cached_pull_requests, store_changed_files,
    store_patch, update_repo_access_timestamp, write_pull_requests_cache,
};
use crate::github::run_gh;
use crate::models::{PrPatch, PullRequestSummary};
use crate::support::parse_repo;

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
    let repo = repo.trim();
    let head_sha = head_sha.trim();

    if head_sha.is_empty() {
        return Err("Head SHA is required for patch lookup".into());
    }

    if let Some(cached_patch) = get_cached_patch(repo, number, head_sha)? {
        return Ok(PrPatch {
            repo: repo.into(),
            number,
            head_sha: head_sha.into(),
            patch: cached_patch,
        });
    }

    let patch = run_gh(&[
        "pr",
        "diff",
        &number.to_string(),
        "-R",
        repo,
        "--color",
        "never",
    ])?;

    store_patch(repo, number, head_sha, &patch)?;

    Ok(PrPatch {
        repo: repo.into(),
        number,
        head_sha: head_sha.into(),
        patch,
    })
}

#[tauri::command]
pub async fn get_pull_request_patch(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<PrPatch, String> {
    let repo = repo.trim().to_string();
    let head_sha = head_sha.trim().to_string();
    run_blocking_task(move || get_pull_request_patch_sync(repo, number, head_sha)).await
}

fn list_pull_request_changed_files_sync(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Vec<String>, String> {
    let repo = repo.trim();
    let head_sha = head_sha.trim();

    if head_sha.is_empty() {
        return Err("Head SHA is required for changed files lookup".into());
    }

    if let Some(files) = get_cached_changed_files(repo, number, head_sha)? {
        return Ok(files);
    }

    let stdout = run_gh(&[
        "pr",
        "diff",
        &number.to_string(),
        "-R",
        repo,
        "--name-only",
        "--color",
        "never",
    ])?;

    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for line in stdout.lines() {
        let path = line.trim();

        if !path.is_empty() && seen.insert(path.to_string()) {
            files.push(path.to_string());
        }
    }

    store_changed_files(repo, number, head_sha, &files)?;

    Ok(files)
}

#[tauri::command]
pub async fn list_pull_request_changed_files(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Vec<String>, String> {
    let repo = repo.trim().to_string();
    let head_sha = head_sha.trim().to_string();
    run_blocking_task(move || list_pull_request_changed_files_sync(repo, number, head_sha)).await
}
