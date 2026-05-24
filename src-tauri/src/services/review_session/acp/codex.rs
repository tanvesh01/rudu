use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use agent_client_protocol_tokio::AcpAgent;
use serde_json::{json, Value};

use crate::models::{ReviewChatReadinessStatus, ReviewChatReadinessStatusKind};

use super::adapter::SessionConfigOption;

const ACP_INITIALIZE_TIMEOUT: Duration = Duration::from_secs(5);
const CODEX_ACP_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_ACP_BIN", "RUDU_CODEX_ACP_PATH"];
const CODEX_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_BIN", "RUDU_CODEX_PATH"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::services::review_session) enum ReviewChatEffortMode {
    Fast,
    Deep,
}

impl ReviewChatEffortMode {
    pub(in crate::services::review_session) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "fast" => Ok(Self::Fast),
            "deep" => Ok(Self::Deep),
            _ => Err("Review effort mode must be fast or deep.".to_string()),
        }
    }

    pub(in crate::services::review_session) fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Deep => "deep",
        }
    }

    pub(super) fn model(self) -> &'static str {
        match self {
            Self::Fast => "gpt-5.4-mini",
            Self::Deep => "gpt-5.5",
        }
    }

    pub(super) fn reasoning_effort(self) -> Option<&'static str> {
        match self {
            Self::Fast => Some("low"),
            Self::Deep => Some("high"),
        }
    }
}

pub(super) fn codex_effort_config(mode: ReviewChatEffortMode) -> Option<Vec<SessionConfigOption>> {
    let mut options = vec![SessionConfigOption {
        key: "model",
        value: mode.model(),
        required: true,
    }];

    if let Some(reasoning_effort) = mode.reasoning_effort() {
        options.push(SessionConfigOption {
            key: "reasoning_effort",
            value: reasoning_effort,
            required: mode == ReviewChatEffortMode::Deep,
        });
    }

    Some(options)
}

pub(super) fn codex_acp_agent() -> Result<AcpAgent, String> {
    let codex_acp_bin = resolve_binary(CODEX_ACP_BIN_ENV_VARS, "codex-acp");
    AcpAgent::from_args([
        codex_acp_bin,
        "-c".to_string(),
        "sandbox_mode=read-only".to_string(),
        "-c".to_string(),
        "approval_policy=on-request".to_string(),
        "-c".to_string(),
        "hide_agent_reasoning=false".to_string(),
        "-c".to_string(),
        "model_reasoning_summary=\"auto\"".to_string(),
    ])
    .map_err(|error| format!("Failed to configure codex-acp runtime: {error}"))
}

pub(super) fn review_chat_readiness() -> ReviewChatReadinessStatus {
    let codex_bin = resolve_binary(CODEX_BIN_ENV_VARS, "codex");
    let version_output = run_command_output(&codex_bin, &["--version"]);
    let version_output = match version_output {
        Ok(output) => output,
        Err(error) => {
            if command_missing(&error) {
                return readiness(
                    ReviewChatReadinessStatusKind::MissingCodexCli,
                    "Codex CLI is not installed or could not be located.",
                );
            }

            return readiness(
                ReviewChatReadinessStatusKind::UnknownError,
                format!("Couldn't verify Codex CLI: {error}"),
            );
        }
    };

    if !version_output.status.success() {
        return readiness(
            ReviewChatReadinessStatusKind::UnknownError,
            command_output_message(&version_output),
        );
    }

    let login_output = run_command_output(&codex_bin, &["login", "status"]);
    let login_output = match login_output {
        Ok(output) => output,
        Err(error) => {
            if command_missing(&error) {
                return readiness(
                    ReviewChatReadinessStatusKind::MissingCodexCli,
                    "Codex CLI is not installed or could not be located.",
                );
            }

            return readiness(
                ReviewChatReadinessStatusKind::UnknownError,
                format!("Couldn't check Codex authentication: {error}"),
            );
        }
    };

    if !login_output.status.success() {
        let message = command_output_message(&login_output);
        let status = if is_codex_auth_message(&message) {
            ReviewChatReadinessStatusKind::CodexNotAuthenticated
        } else {
            ReviewChatReadinessStatusKind::UnknownError
        };
        return readiness(status, message);
    }

    let codex_acp_bin = resolve_binary(CODEX_ACP_BIN_ENV_VARS, "codex-acp");
    if let Err(error) = run_acp_initialize_probe(&codex_acp_bin) {
        return error;
    }

    ReviewChatReadinessStatus {
        status: ReviewChatReadinessStatusKind::Ready,
        message: None,
    }
}

fn resolve_binary(env_vars: &[&str], bin_name: &str) -> String {
    for env_var in env_vars {
        if let Ok(value) = std::env::var(env_var) {
            let value = value.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }

    project_binary_candidates(bin_name)
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| bin_name.to_string())
}

fn project_binary_candidates(bin_name: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = option_env!("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        roots.push(root);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    let mut candidates: Vec<PathBuf> = roots
        .into_iter()
        .map(|root| root.join("node_modules").join(".bin").join(bin_name))
        .collect();

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{bin_name}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{bin_name}")));
    }

    candidates
}

fn run_command_output(bin: &str, args: &[&str]) -> Result<Output, std::io::Error> {
    Command::new(bin).args(args).output()
}

fn command_missing(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

fn command_output_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return stderr;
    }

    if !stdout.is_empty() {
        return stdout;
    }

    format!("Command exited with status {}", output.status)
}

fn is_codex_auth_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("not logged")
        || message.contains("not authenticated")
        || message.contains("codex login")
        || message.contains("login")
        || message.contains("authenticate")
}

fn readiness(
    status: ReviewChatReadinessStatusKind,
    message: impl Into<String>,
) -> ReviewChatReadinessStatus {
    ReviewChatReadinessStatus {
        status,
        message: Some(message.into()),
    }
}

fn run_acp_initialize_probe(codex_acp_bin: &str) -> Result<(), ReviewChatReadinessStatus> {
    let mut child = Command::new(codex_acp_bin)
        .args([
            "-c",
            "sandbox_mode=read-only",
            "-c",
            "approval_policy=on-request",
            "-c",
            "hide_agent_reasoning=false",
            "-c",
            "model_reasoning_summary=\"auto\"",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if command_missing(&error) {
                readiness(
                    ReviewChatReadinessStatusKind::MissingCodexAcp,
                    "Rudu could not find the Codex ACP adapter. In development, run `bun install`.",
                )
            } else {
                readiness(
                    ReviewChatReadinessStatusKind::AcpInitializeFailed,
                    format!("Failed to start Codex ACP: {error}"),
                )
            }
        })?;

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(readiness(
            ReviewChatReadinessStatusKind::AcpInitializeFailed,
            "Codex ACP did not expose stdout for initialize probing.",
        ));
    };

    if let Some(mut stdin) = child.stdin.take() {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": {},
                "clientInfo": {
                    "name": "rudu-preflight",
                    "title": "Rudu Preflight",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        });
        writeln!(stdin, "{request}").map_err(|error| {
            readiness(
                ReviewChatReadinessStatusKind::AcpInitializeFailed,
                format!("Failed to send Codex ACP initialize request: {error}"),
            )
        })?;
    }

    let (line_tx, line_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader.read_line(&mut line).map(|_| line);
        let _ = line_tx.send(result);
    });

    let line = match line_rx.recv_timeout(ACP_INITIALIZE_TIMEOUT) {
        Ok(Ok(line)) => line,
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(readiness(
                ReviewChatReadinessStatusKind::AcpInitializeFailed,
                format!("Failed to read Codex ACP initialize response: {error}"),
            ));
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(readiness(
                ReviewChatReadinessStatusKind::AcpInitializeFailed,
                "Codex ACP initialize timed out.",
            ));
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(readiness(
                ReviewChatReadinessStatusKind::AcpInitializeFailed,
                "Codex ACP initialize response stream closed.",
            ));
        }
    };

    let result = validate_acp_initialize_line(&line);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn validate_acp_initialize_line(line: &str) -> Result<(), ReviewChatReadinessStatus> {
    let line = line.trim();
    if line.is_empty() {
        return Err(readiness(
            ReviewChatReadinessStatusKind::AcpInitializeFailed,
            "Codex ACP initialize response was empty.",
        ));
    }

    let value: Value = serde_json::from_str(line).map_err(|error| {
        readiness(
            ReviewChatReadinessStatusKind::AcpInitializeFailed,
            format!("Codex ACP returned invalid initialize JSON: {error}"),
        )
    })?;

    if let Some(error) = value.get("error") {
        return Err(readiness(
            ReviewChatReadinessStatusKind::AcpInitializeFailed,
            format!("Codex ACP initialize failed: {error}"),
        ));
    }

    let result = value.get("result").ok_or_else(|| {
        readiness(
            ReviewChatReadinessStatusKind::AcpInitializeFailed,
            "Codex ACP initialize response did not include a result.",
        )
    })?;

    if result.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
        return Err(readiness(
            ReviewChatReadinessStatusKind::AcpProtocolUnsupported,
            "Codex ACP did not negotiate ACP protocol version 1.",
        ));
    }

    if result
        .pointer("/agentCapabilities/loadSession")
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err(readiness(
            ReviewChatReadinessStatusKind::AcpMissingRequiredCapability,
            "Codex ACP does not advertise session loading support.",
        ));
    }

    Ok(())
}
