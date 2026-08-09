use crate::models::{LocalCheckout, LocalCheckoutPatch, LocalCheckoutStatus, LocalDiffSource};
use crate::services::local_checkout;

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
pub async fn add_local_checkout(path: String) -> Result<LocalCheckout, String> {
    run_blocking_task(move || local_checkout::add_local_checkout(path)).await
}

#[tauri::command]
pub async fn list_local_checkouts() -> Result<Vec<LocalCheckout>, String> {
    run_blocking_task(local_checkout::list_local_checkouts).await
}

#[tauri::command]
pub async fn get_local_checkout_status(
    id: String,
    source: Option<LocalDiffSource>,
) -> Result<LocalCheckoutStatus, String> {
    run_blocking_task(move || local_checkout::get_local_checkout_status(id, source)).await
}

#[tauri::command]
pub async fn get_local_checkout_patch(
    id: String,
    revision: String,
    source: Option<LocalDiffSource>,
) -> Result<LocalCheckoutPatch, String> {
    run_blocking_task(move || local_checkout::get_local_checkout_patch(id, revision, source)).await
}

#[tauri::command]
pub fn remove_local_checkout(id: String) -> Result<(), String> {
    local_checkout::remove_local_checkout(id)
}
