use std::path::Path;

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::models::{GitHubFileContext, RemoteReviewSession, RemoteReviewSessionStatus};
use crate::services::remote_review_config::WorkerConfig;

use super::RemoteReviewInput;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerPrepareSessionRequest {
    repo: String,
    number: u32,
    head_sha: String,
    github_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerStatusUpdateRequest {
    status: RemoteReviewSessionStatus,
    last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerSession {
    pub(super) id: String,
    pub(super) repo: String,
    pub(super) number: u32,
    pub(super) head_sha: String,
    pub(super) status: RemoteReviewSessionStatus,
    pub(super) file_context: Option<GitHubFileContext>,
    pub(super) created_at: i64,
    pub(super) updated_at: i64,
    pub(super) last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkerErrorResponse {
    error: Option<String>,
}

pub(super) fn prepare_session(
    config: &WorkerConfig,
    input: &RemoteReviewInput,
    github_token: &str,
) -> Result<WorkerSession, String> {
    let body = WorkerPrepareSessionRequest {
        repo: input.repo.clone(),
        number: input.number,
        head_sha: input.head_sha.clone(),
        github_token: github_token.to_string(),
    };
    worker_json(
        config,
        Method::POST,
        "/sessions",
        Some(&body),
        "prepare remote review session",
    )
}

pub(super) fn hydrate_session(
    config: &WorkerConfig,
    session_id: &str,
) -> Result<WorkerSession, String> {
    worker_json_no_body(
        config,
        Method::POST,
        &format!("/sessions/{session_id}/hydrate"),
        "hydrate remote review session",
    )
}

pub(super) fn get_session(
    config: &WorkerConfig,
    session_id: &str,
) -> Result<WorkerSession, String> {
    worker_json_no_body(
        config,
        Method::GET,
        &format!("/sessions/{session_id}"),
        "load remote review session",
    )
}

pub(super) fn update_status(
    config: &WorkerConfig,
    session_id: &str,
    status: RemoteReviewSessionStatus,
    last_error: Option<String>,
) -> Result<WorkerSession, String> {
    let body = WorkerStatusUpdateRequest { status, last_error };
    worker_json(
        config,
        Method::POST,
        &format!("/sessions/{session_id}/status"),
        Some(&body),
        "update remote review session status",
    )
}

pub(super) fn mark_failed(root: &Path, session_id: &str, error: &str) {
    if let Ok(config) = WorkerConfig::load(root) {
        let _ = update_status(
            &config,
            session_id,
            RemoteReviewSessionStatus::Failed,
            Some(error.to_string()),
        );
    }
}

pub(super) fn is_missing_session_error(error: &str) -> bool {
    error.contains("HTTP 404") && error.contains("Remote review session not found")
}

pub(super) fn ensure_session_matches(
    worker_session: &WorkerSession,
    session: &RemoteReviewSession,
) -> Result<(), String> {
    if worker_session.repo != session.repo
        || worker_session.number != session.number
        || worker_session.head_sha != session.head_sha
    {
        return Err(
            "Remote review Worker returned metadata for a different PR revision.".to_string(),
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_missing_session_error;

    #[test]
    fn detects_missing_worker_session_errors() {
        assert!(is_missing_session_error(
            "Failed to load remote review session: remote review Worker returned HTTP 404: Remote review session not found."
        ));
        assert!(!is_missing_session_error(
            "Failed to load remote review session: remote review Worker returned HTTP 401: Unauthorized."
        ));
    }
}

fn worker_json_no_body<T: DeserializeOwned>(
    config: &WorkerConfig,
    method: Method,
    path: &str,
    action: &str,
) -> Result<T, String> {
    worker_json::<T, ()>(config, method, path, None, action)
}

fn worker_json<T, B>(
    config: &WorkerConfig,
    method: Method,
    path: &str,
    body: Option<&B>,
    action: &str,
) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let url = config.url(path);
    let client = reqwest::Client::new();
    let mut request = client
        .request(method, url)
        .bearer_auth(&config.api_token)
        .header(reqwest::header::ACCEPT, "application/json");

    if let Some(body) = body {
        request = request.json(body);
    }

    let response = tauri::async_runtime::block_on(async {
        let response = request
            .send()
            .await
            .map_err(|error| format!("Failed to {action}: {error}"))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|error| {
            format!("Failed to read Worker response while trying to {action}: {error}")
        })?;
        Ok::<_, String>((status, body))
    })?;

    decode_worker_response(response.0, &response.1, action)
}

fn decode_worker_response<T: DeserializeOwned>(
    status: u16,
    body: &str,
    action: &str,
) -> Result<T, String> {
    if status >= 400 {
        let message = serde_json::from_str::<WorkerErrorResponse>(body)
            .ok()
            .and_then(|response| response.error)
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| body.to_string());
        return Err(format!(
            "Failed to {action}: remote review Worker returned HTTP {status}: {message}"
        ));
    }

    serde_json::from_str(body).map_err(|error| {
        format!("Failed to parse Worker response while trying to {action}: {error}")
    })
}
