use std::collections::HashSet;

use crate::cache::{read_saved_repos, save_repo_to_cache};
use crate::github::{ensure_user_context, run_gh};
use crate::models::{GhSearchRepo, RepoSummary};

#[tauri::command]
pub fn list_initial_repos(limit: Option<u32>) -> Result<Vec<RepoSummary>, String> {
    let limit = limit.unwrap_or(5);
    let limit_str = limit.to_string();

    let stdout = run_gh(&[
        "repo",
        "list",
        "--json",
        "name,nameWithOwner,description,isPrivate",
        "--limit",
        &limit_str,
    ])?;

    serde_json::from_str::<Vec<RepoSummary>>(&stdout)
        .map_err(|error| format!("Failed to parse repos: {error}"))
}

#[tauri::command]
pub fn search_repos(query: String, limit: Option<u32>) -> Result<Vec<RepoSummary>, String> {
    if query.trim().is_empty() {
        return list_initial_repos(limit);
    }

    let owners = ensure_user_context()?;
    let limit = limit.unwrap_or(20);
    let limit_str = limit.to_string();

    let mut args: Vec<String> = vec![
        "search".into(),
        "repos".into(),
        query.clone(),
        "--limit".into(),
        limit_str,
        "--json".into(),
        "name,fullName,description,isPrivate".into(),
        "--match".into(),
        "name".into(),
    ];

    for owner in &owners {
        args.push("--owner".into());
        args.push(owner.clone());
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = run_gh(&args_ref)?;

    let search_repos = serde_json::from_str::<Vec<GhSearchRepo>>(&stdout)
        .map_err(|error| format!("Failed to parse search results: {error}"))?;

    let mut repos = Vec::new();
    let mut seen = HashSet::new();

    for sr in search_repos {
        if seen.insert(sr.full_name.clone()) {
            repos.push(RepoSummary {
                name: sr.name,
                name_with_owner: sr.full_name,
                description: sr.description,
                is_private: sr.is_private,
            });
        }
    }

    Ok(repos)
}

#[tauri::command]
pub fn validate_repo(repo: String) -> Result<RepoSummary, String> {
    let repo = repo.trim();

    if repo.split('/').count() != 2 || repo.starts_with('/') || repo.ends_with('/') {
        return Err("Enter a repo as owner/name".into());
    }

    let stdout = run_gh(&[
        "repo",
        "view",
        repo,
        "--json",
        "name,nameWithOwner,description,isPrivate",
    ])?;

    serde_json::from_str::<RepoSummary>(&stdout)
        .map_err(|error| format!("Failed to parse repo details: {error}"))
}

#[tauri::command]
pub fn list_saved_repos() -> Result<Vec<RepoSummary>, String> {
    read_saved_repos()
}

#[tauri::command]
pub fn save_repo(repo: RepoSummary) -> Result<RepoSummary, String> {
    save_repo_to_cache(&repo)?;
    Ok(repo)
}
