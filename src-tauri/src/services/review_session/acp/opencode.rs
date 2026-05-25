use std::process::Command;

use agent_client_protocol_tokio::AcpAgent;

use crate::models::{ReviewChatReadinessStatus, ReviewChatReadinessStatusKind};

use super::adapter::SessionConfigOption;
use super::codex::run_command_output;

const OPENCODE_BIN_ENV_VARS: &[&str] = &["RUDU_OPENCODE_BIN", "OPENCODE_BIN"];

pub(super) fn opencode_acp_agent() -> Result<AcpAgent, String> {
    AcpAgent::from_args([resolve_opencode_binary(), "acp".to_string()])
        .map_err(|error| format!("Failed to configure OpenCode ACP runtime: {error}"))
}

pub(super) fn opencode_model_config(model: &str) -> Vec<SessionConfigOption> {
    vec![SessionConfigOption {
        key: "model",
        value: model.to_string(),
        required: true,
    }]
}

pub(super) fn review_chat_readiness() -> ReviewChatReadinessStatus {
    match run_command_output(&resolve_opencode_binary(), &["--version"]) {
        Ok(output) if output.status.success() => ReviewChatReadinessStatus {
            status: ReviewChatReadinessStatusKind::Ready,
            message: None,
        },
        Ok(output) => ReviewChatReadinessStatus {
            status: ReviewChatReadinessStatusKind::UnknownError,
            message: Some(format!(
                "OpenCode CLI version check failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )),
        },
        Err(error) if command_missing(&error) => ReviewChatReadinessStatus {
            status: ReviewChatReadinessStatusKind::MissingOpenCodeCli,
            message: Some("OpenCode CLI is not installed or could not be located.".to_string()),
        },
        Err(error) => ReviewChatReadinessStatus {
            status: ReviewChatReadinessStatusKind::UnknownError,
            message: Some(format!("Couldn't verify OpenCode CLI: {error}")),
        },
    }
}

pub(super) fn list_models() -> Result<Vec<String>, String> {
    let output = Command::new(resolve_opencode_binary())
        .arg("models")
        .output()
        .map_err(|error| format!("Failed to list OpenCode models: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "OpenCode models command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter_map(|line| line.split_whitespace().find(|part| part.contains('/')))
        .map(ToOwned::to_owned)
        .collect())
}

fn resolve_opencode_binary() -> String {
    OPENCODE_BIN_ENV_VARS
        .iter()
        .find_map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| "opencode".to_string())
}

fn command_missing(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}
