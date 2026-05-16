use crate::models::{IssueBuckets, IssueRoleCounts};
use crate::services::issues::IssueSearchService;

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
pub async fn count_open_issue_roles() -> Result<IssueRoleCounts, String> {
    run_blocking_task(move || IssueSearchService::new().count_open_roles()).await
}

#[tauri::command]
pub async fn list_open_issue_buckets() -> Result<IssueBuckets, String> {
    run_blocking_task(move || IssueSearchService::new().list_open_buckets()).await
}
