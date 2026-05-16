use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

use crate::models::{RemoteReviewWorkerConfigSource, RemoteReviewWorkerConfigStatus};

const CONFIG_FILE: &str = "worker-config.json";
const KEYRING_SERVICE: &str = "com.tanvesh.rudu.remote-review";
const KEYRING_USER: &str = "worker-api-token";
const ENV_WORKER_URL: &str = "RUDU_REMOTE_REVIEW_WORKER_URL";
const ENV_API_TOKEN: &str = "RUDU_REMOTE_REVIEW_API_TOKEN";
const HEALTH_SERVICE: &str = "rudu-remote-review";
const API_TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub base_url: String,
    pub api_token: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorkerConfig {
    worker_url: String,
}

#[derive(Debug, Deserialize)]
struct WorkerHealthResponse {
    ok: bool,
    service: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerClaimRequest {
    api_token: String,
}

#[derive(Debug, Deserialize)]
struct WorkerErrorResponse {
    error: Option<String>,
}

impl WorkerConfig {
    pub fn load(root: &Path) -> Result<Self, String> {
        load_resolved_config(root)?
            .config
            .ok_or_else(missing_config_message)
    }

    pub fn from_parts(worker_url: &str, api_token: &str) -> Result<Self, String> {
        let base_url = normalize_worker_url(worker_url)?;
        let api_token = normalize_api_token(api_token)?;
        Ok(Self {
            base_url,
            api_token,
        })
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}

struct ResolvedWorkerConfig {
    config: Option<WorkerConfig>,
    status: RemoteReviewWorkerConfigStatus,
}

pub fn get_worker_config_status(root: &Path) -> Result<RemoteReviewWorkerConfigStatus, String> {
    Ok(load_resolved_config(root)?.status)
}

pub fn save_worker_config(
    root: &Path,
    worker_url: String,
    api_token: String,
) -> Result<RemoteReviewWorkerConfigStatus, String> {
    let config = WorkerConfig::from_parts(&worker_url, &api_token)?;
    persist_worker_config(root, &config)?;
    get_worker_config_status(root)
}

pub fn pair_worker_config(
    root: &Path,
    worker_url: String,
) -> Result<RemoteReviewWorkerConfigStatus, String> {
    let api_token = generate_worker_api_token()?;
    let config = WorkerConfig::from_parts(&worker_url, &api_token)?;
    persist_worker_config(root, &config)?;

    if let Err(error) = claim_worker_config(&config) {
        let _ = clear_worker_config(root);
        return Err(error);
    }

    test_config_health(&config).map_err(|error| {
        format!("Remote review Worker was paired, but health validation failed: {error}")
    })?;

    get_worker_config_status(root)
}

fn persist_worker_config(root: &Path, config: &WorkerConfig) -> Result<(), String> {
    write_api_token(&config.api_token)?;
    fs::create_dir_all(root)
        .map_err(|error| format!("Failed to create remote review config directory: {error}"))?;

    let stored = StoredWorkerConfig {
        worker_url: config.base_url.clone(),
    };
    let body = serde_json::to_string_pretty(&stored)
        .map_err(|error| format!("Failed to serialize remote review Worker config: {error}"))?;

    if let Err(error) = fs::write(config_path(root), body) {
        let _ = delete_api_token();
        return Err(format!(
            "Failed to write remote review Worker config: {error}"
        ));
    }

    Ok(())
}

pub fn generate_worker_api_token() -> Result<String, String> {
    let mut bytes = [0_u8; API_TOKEN_BYTES];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("Failed to generate remote review Worker API token: {error}"))?;
    Ok(encode_worker_api_token(&bytes))
}

fn encode_worker_api_token(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn worker_error_message(body: &str) -> String {
    serde_json::from_str::<WorkerErrorResponse>(body)
        .ok()
        .and_then(|response| response.error)
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| body.to_string())
}

pub fn clear_worker_config(root: &Path) -> Result<RemoteReviewWorkerConfigStatus, String> {
    match fs::remove_file(config_path(root)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to remove remote review Worker config: {error}"
            ))
        }
    }

    delete_api_token()?;
    get_worker_config_status(root)
}

pub fn test_worker_config(
    root: &Path,
    worker_url: Option<String>,
    api_token: Option<String>,
) -> Result<(), String> {
    let config = match (worker_url, api_token) {
        (Some(worker_url), Some(api_token)) => WorkerConfig::from_parts(&worker_url, &api_token)?,
        (None, None) => WorkerConfig::load(root)?,
        _ => {
            return Err(
                "Worker URL and API token are both required when testing unsaved config."
                    .to_string(),
            )
        }
    };

    test_config_health(&config)
}

fn test_config_health(config: &WorkerConfig) -> Result<(), String> {
    let url = config.url("/health");
    let client = reqwest::Client::new();
    let response = tauri::async_runtime::block_on(async {
        let response = client
            .get(url)
            .bearer_auth(&config.api_token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| format!("Failed to reach remote review Worker: {error}"))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|error| {
            format!("Failed to read remote review Worker health response: {error}")
        })?;
        Ok::<_, String>((status, body))
    })?;

    if response.0 >= 400 {
        return Err(format!(
            "Remote review Worker health check returned HTTP {}: {}",
            response.0,
            worker_error_message(&response.1)
        ));
    }

    let health: WorkerHealthResponse = serde_json::from_str(&response.1).map_err(|error| {
        format!("Failed to parse remote review Worker health response: {error}")
    })?;
    if !health.ok || health.service != HEALTH_SERVICE {
        return Err("Remote review Worker health response did not match Rudu.".to_string());
    }

    Ok(())
}

fn claim_worker_config(config: &WorkerConfig) -> Result<(), String> {
    let url = config.url("/setup/claim");
    let body = WorkerClaimRequest {
        api_token: config.api_token.clone(),
    };
    let client = reqwest::Client::new();
    let response = tauri::async_runtime::block_on(async {
        let response = client
            .post(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("Failed to pair remote review Worker: {error}"))?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|error| {
            format!("Failed to read remote review Worker pairing response: {error}")
        })?;
        Ok::<_, String>((status, body))
    })?;

    if response.0 >= 400 {
        return Err(format!(
            "Remote review Worker pairing returned HTTP {}: {}",
            response.0,
            worker_error_message(&response.1)
        ));
    }

    Ok(())
}

fn load_resolved_config(root: &Path) -> Result<ResolvedWorkerConfig, String> {
    let env_url = std::env::var(ENV_WORKER_URL).ok();
    let env_token = std::env::var(ENV_API_TOKEN).ok();
    let stored_url = read_stored_worker_url(root)?;
    let stored_token = if env_url.is_none() && env_token.is_none() && stored_url.is_some() {
        read_api_token()?
    } else {
        None
    };

    resolve_worker_config(
        env_url.as_deref(),
        env_token.as_deref(),
        stored_url.as_deref(),
        stored_token.as_deref(),
    )
}

fn resolve_worker_config(
    env_url: Option<&str>,
    env_token: Option<&str>,
    stored_url: Option<&str>,
    stored_token: Option<&str>,
) -> Result<ResolvedWorkerConfig, String> {
    if env_url.is_some() || env_token.is_some() {
        let worker_url = env_url.ok_or_else(|| {
            "Remote review Worker config is incomplete. Set RUDU_REMOTE_REVIEW_WORKER_URL when RUDU_REMOTE_REVIEW_API_TOKEN is set.".to_string()
        })?;
        let api_token = env_token.ok_or_else(|| {
            "Remote review Worker config is incomplete. Set RUDU_REMOTE_REVIEW_API_TOKEN when RUDU_REMOTE_REVIEW_WORKER_URL is set.".to_string()
        })?;
        let config = WorkerConfig::from_parts(worker_url, api_token)?;
        let status = status_for_config(&config, RemoteReviewWorkerConfigSource::Env);
        return Ok(ResolvedWorkerConfig {
            config: Some(config),
            status,
        });
    }

    if let Some(worker_url) = stored_url {
        let normalized_url = normalize_worker_url(worker_url)?;
        let api_token = stored_token.map(normalize_api_token).transpose()?;
        let configured = api_token.is_some();
        let config = api_token.map(|api_token| WorkerConfig {
            base_url: normalized_url.clone(),
            api_token,
        });
        return Ok(ResolvedWorkerConfig {
            config,
            status: RemoteReviewWorkerConfigStatus {
                configured,
                worker_url: Some(normalized_url),
                has_api_token: configured,
                source: RemoteReviewWorkerConfigSource::Stored,
            },
        });
    }

    Ok(ResolvedWorkerConfig {
        config: None,
        status: RemoteReviewWorkerConfigStatus {
            configured: false,
            worker_url: None,
            has_api_token: false,
            source: RemoteReviewWorkerConfigSource::Missing,
        },
    })
}

fn status_for_config(
    config: &WorkerConfig,
    source: RemoteReviewWorkerConfigSource,
) -> RemoteReviewWorkerConfigStatus {
    RemoteReviewWorkerConfigStatus {
        configured: true,
        worker_url: Some(config.base_url.clone()),
        has_api_token: true,
        source,
    }
}

fn read_stored_worker_url(root: &Path) -> Result<Option<String>, String> {
    let path = config_path(root);
    let body = match fs::read_to_string(&path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to read remote review Worker config: {error}"
            ))
        }
    };
    let config: StoredWorkerConfig = serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse remote review Worker config: {error}"))?;
    Ok(Some(config.worker_url))
}

fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_FILE)
}

fn normalize_worker_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err("Remote review Worker URL cannot be empty.".to_string());
    }

    let parsed = reqwest::Url::parse(&trimmed)
        .map_err(|error| format!("Remote review Worker URL is invalid: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(trimmed),
        _ => Err("Remote review Worker URL must start with http:// or https://.".to_string()),
    }
}

fn normalize_api_token(value: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err("Remote review Worker API token cannot be empty.".to_string());
    }
    Ok(trimmed)
}

fn api_token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("Failed to open OS credential store: {error}"))
}

fn read_api_token() -> Result<Option<String>, String> {
    match api_token_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Failed to read remote review Worker API token from OS credential store: {error}"
        )),
    }
}

fn write_api_token(api_token: &str) -> Result<(), String> {
    api_token_entry()?.set_password(api_token).map_err(|error| {
        format!("Failed to store remote review Worker API token in OS credential store: {error}")
    })
}

fn delete_api_token() -> Result<(), String> {
    match api_token_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove remote review Worker API token from OS credential store: {error}"
        )),
    }
}

fn missing_config_message() -> String {
    "Remote review Worker config is missing. Set up a user-owned Worker in Rudu, or set RUDU_REMOTE_REVIEW_WORKER_URL and RUDU_REMOTE_REVIEW_API_TOKEN for local development.".to_string()
}

#[cfg(test)]
mod tests {
    use super::{encode_worker_api_token, normalize_worker_url, resolve_worker_config};
    use crate::models::RemoteReviewWorkerConfigSource;

    #[test]
    fn normalize_worker_url_trims_trailing_slashes() {
        assert_eq!(
            normalize_worker_url(" https://worker.example/ ").unwrap(),
            "https://worker.example"
        );
    }

    #[test]
    fn normalize_worker_url_rejects_non_http_urls() {
        assert!(normalize_worker_url("file:///tmp/worker").is_err());
    }

    #[test]
    fn encode_worker_api_token_uses_base64url_without_padding() {
        let token = encode_worker_api_token(&[255_u8; 32]);

        assert_eq!(token.len(), 43);
        assert!(!token.contains('+'));
        assert!(!token.contains('/'));
        assert!(!token.contains('='));
    }

    #[test]
    fn resolve_worker_config_prefers_env_over_stored_config() {
        let resolved = resolve_worker_config(
            Some("https://env.example"),
            Some("env-token"),
            Some("https://stored.example"),
            Some("stored-token"),
        )
        .unwrap();

        let config = resolved.config.unwrap();
        assert_eq!(config.base_url, "https://env.example");
        assert_eq!(config.api_token, "env-token");
        assert_eq!(resolved.status.source, RemoteReviewWorkerConfigSource::Env);
    }

    #[test]
    fn resolve_worker_config_reports_missing_stored_token() {
        let resolved =
            resolve_worker_config(None, None, Some("https://stored.example"), None).unwrap();

        assert!(resolved.config.is_none());
        assert!(!resolved.status.configured);
        assert_eq!(
            resolved.status.worker_url.as_deref(),
            Some("https://stored.example")
        );
        assert!(!resolved.status.has_api_token);
        assert_eq!(
            resolved.status.source,
            RemoteReviewWorkerConfigSource::Stored
        );
    }

    #[test]
    fn resolve_worker_config_requires_complete_env_pair() {
        assert!(resolve_worker_config(Some("https://env.example"), None, None, None).is_err());
        assert!(resolve_worker_config(None, Some("token"), None, None).is_err());
    }
}
