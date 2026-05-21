use std::collections::HashMap;

use serde::Serialize;

use crate::cache::{read_saved_repos, read_tracked_pull_requests};
use crate::models::{PullRequestSummary, RepoSummary};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialCachePayload {
    pub repos: Vec<RepoSummary>,
    pub tracked_prs_by_repo: HashMap<String, Vec<PullRequestSummary>>,
}

#[tauri::command]
pub fn get_initial_cache() -> Result<InitialCachePayload, String> {
    let repos = read_saved_repos().unwrap_or_default();
    let mut tracked_prs_by_repo = HashMap::new();

    for repo in &repos {
        if let Ok(prs) = read_tracked_pull_requests(&repo.name_with_owner) {
            tracked_prs_by_repo.insert(repo.name_with_owner.clone(), prs);
        }
    }

    Ok(InitialCachePayload {
        repos,
        tracked_prs_by_repo,
    })
}
