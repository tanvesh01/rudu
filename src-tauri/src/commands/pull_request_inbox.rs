use crate::models::PullRequestInbox;
use crate::services::pull_request_inbox;

#[tauri::command]
pub async fn get_pull_request_inbox() -> Result<PullRequestInbox, String> {
    tauri::async_runtime::spawn_blocking(pull_request_inbox::get_pull_request_inbox)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}
