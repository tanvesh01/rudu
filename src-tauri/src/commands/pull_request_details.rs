use crate::models::{PullRequestChecks, PullRequestOverview};
use crate::services::pull_request_details::PullRequestDetailsService;
use crate::services::review_graphql::GhGraphqlTransport;

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

fn get_pull_request_overview_sync(
    repo: String,
    number: u32,
) -> Result<PullRequestOverview, String> {
    PullRequestDetailsService::new(GhGraphqlTransport).get_overview(&repo, number)
}

#[tauri::command]
pub async fn get_pull_request_overview(
    repo: String,
    number: u32,
) -> Result<PullRequestOverview, String> {
    run_blocking_task(move || get_pull_request_overview_sync(repo, number)).await
}

fn get_pull_request_checks_sync(repo: String, number: u32) -> Result<PullRequestChecks, String> {
    PullRequestDetailsService::new(GhGraphqlTransport).get_checks(&repo, number)
}

#[tauri::command]
pub async fn get_pull_request_checks(
    repo: String,
    number: u32,
) -> Result<PullRequestChecks, String> {
    run_blocking_task(move || get_pull_request_checks_sync(repo, number)).await
}
