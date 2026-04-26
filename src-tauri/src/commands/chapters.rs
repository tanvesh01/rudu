use crate::models::{LlmProviderInfo, LlmSettings, PullRequestChapters, SaveLlmSettingsInput};
use crate::services::{chapters, llm};

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
pub fn list_llm_providers() -> Vec<LlmProviderInfo> {
    llm::list_provider_infos()
}

#[tauri::command]
pub async fn get_llm_settings() -> Result<LlmSettings, String> {
    run_blocking_task(llm::load_llm_settings).await
}

#[tauri::command]
pub async fn save_llm_settings(settings: SaveLlmSettingsInput) -> Result<LlmSettings, String> {
    run_blocking_task(move || llm::save_llm_settings(settings)).await
}

#[tauri::command]
pub async fn set_llm_api_key(provider: String, api_key: String) -> Result<LlmSettings, String> {
    run_blocking_task(move || {
        llm::save_api_key(&provider, &api_key)?;
        llm::load_llm_settings()
    })
    .await
}

#[tauri::command]
pub async fn delete_llm_api_key(provider: String) -> Result<LlmSettings, String> {
    run_blocking_task(move || {
        llm::delete_api_key(&provider)?;
        llm::load_llm_settings()
    })
    .await
}

#[tauri::command]
pub async fn test_llm_provider() -> Result<(), String> {
    run_blocking_task(|| {
        let settings = llm::load_llm_settings()?;
        llm::test_llm_provider(&settings)
    })
    .await
}

#[tauri::command]
pub async fn get_pull_request_chapters(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Option<PullRequestChapters>, String> {
    run_blocking_task(move || chapters::read_cached_chapters(repo, number, head_sha)).await
}

#[tauri::command]
pub async fn regenerate_pull_request_chapters(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<PullRequestChapters, String> {
    run_blocking_task(move || chapters::generate_chapters(repo, number, head_sha)).await
}
