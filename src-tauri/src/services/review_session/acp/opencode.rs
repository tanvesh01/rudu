use std::process::Command;

use agent_client_protocol_tokio::AcpAgent;

use crate::models::{ReviewChatReadinessStatus, ReviewChatReadinessStatusKind};
use crate::support::cli::resolve_binary;

use super::codex::run_command_output;

const OPENCODE_BIN_ENV_VARS: &[&str] = &["RUDU_OPENCODE_BIN", "OPENCODE_BIN"];

pub(super) fn opencode_acp_agent() -> Result<AcpAgent, String> {
    AcpAgent::from_args(opencode_acp_agent_args(resolve_opencode_binary()))
        .map_err(|error| format!("Failed to configure OpenCode ACP runtime: {error}"))
}

fn opencode_acp_agent_args(opencode_bin: String) -> Vec<String> {
    vec![
        opencode_bin,
        "acp".to_string(),
        "--print-logs".to_string(),
        "--log-level".to_string(),
        opencode_acp_log_level(),
    ]
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

pub(super) fn cli_version() -> Option<String> {
    let output = run_command_output(&resolve_opencode_binary(), &["--version"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

pub(super) fn acp_model_switch_supported(version: Option<&str>) -> bool {
    let Some(version) = version.and_then(parse_semver_prefix) else {
        return true;
    };
    version >= (1, 16, 2)
}

fn parse_semver_prefix(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version
        .trim()
        .trim_start_matches('v')
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .next()?
        .split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

pub(super) fn resolve_opencode_binary() -> String {
    resolve_binary(OPENCODE_BIN_ENV_VARS, "opencode")
}

fn opencode_acp_log_level() -> String {
    let value = std::env::var("RUDU_OPENCODE_ACP_LOG_LEVEL")
        .ok()
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "WARN".to_string());
    match value.as_str() {
        "DEBUG" | "INFO" | "WARN" | "ERROR" => value,
        _ => "WARN".to_string(),
    }
}

fn command_missing(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

#[cfg(test)]
mod tests {
    use super::{acp_model_switch_supported, opencode_acp_agent_args, parse_semver_prefix};

    #[test]
    fn opencode_acp_agent_args_do_not_include_startup_model() {
        let args = opencode_acp_agent_args("opencode".to_string());

        assert_eq!(args[0], "opencode");
        assert_eq!(args[1], "acp");
        assert!(!args.iter().any(|arg| arg == "--model"));
    }

    #[test]
    fn detects_opencode_versions_with_supported_acp_model_switching() {
        assert_eq!(parse_semver_prefix("1.15.13"), Some((1, 15, 13)));
        assert_eq!(parse_semver_prefix("v1.16.2"), Some((1, 16, 2)));
        assert!(!acp_model_switch_supported(Some("1.15.13")));
        assert!(!acp_model_switch_supported(Some("1.16.1")));
        assert!(acp_model_switch_supported(Some("1.16.2")));
        assert!(acp_model_switch_supported(Some("1.17.0")));
        assert!(acp_model_switch_supported(None));
    }
}
