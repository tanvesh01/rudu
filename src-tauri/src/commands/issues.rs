use crate::linear::LinearIntegrationService;
use crate::models::{IssueBucketCounts, IssueBuckets, IssueDashboardData, LinearIntegrationStatus};
use crate::services::issues::IssueDashboardService;

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
pub async fn get_issue_dashboard() -> Result<IssueDashboardData, String> {
    run_blocking_task(move || IssueDashboardService::new().get_dashboard()).await
}

#[tauri::command]
pub async fn count_issue_buckets() -> Result<IssueBucketCounts, String> {
    run_blocking_task(move || IssueDashboardService::new().count_buckets()).await
}

#[tauri::command]
pub async fn get_linear_integration_status() -> Result<LinearIntegrationStatus, String> {
    run_blocking_task(move || Ok(LinearIntegrationService::new().status())).await
}

#[tauri::command]
pub async fn save_linear_api_key(api_key: String) -> Result<LinearIntegrationStatus, String> {
    run_blocking_task(move || LinearIntegrationService::new().save_api_key(api_key)).await
}

#[tauri::command]
pub async fn delete_linear_api_key() -> Result<LinearIntegrationStatus, String> {
    run_blocking_task(move || LinearIntegrationService::new().delete_api_key()).await
}

#[tauri::command]
pub async fn count_open_issue_roles() -> Result<IssueBucketCounts, String> {
    count_issue_buckets().await
}

#[tauri::command]
pub async fn list_open_issue_buckets() -> Result<IssueBuckets, String> {
    get_issue_dashboard()
        .await
        .map(|dashboard| dashboard.buckets)
}
