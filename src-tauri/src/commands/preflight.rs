use crate::github::get_gh_cli_status_sync;
use crate::models::GhCliStatus;

#[tauri::command]
pub async fn get_gh_cli_status() -> Result<GhCliStatus, String> {
    tauri::async_runtime::spawn_blocking(get_gh_cli_status_sync)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))
}
