use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use agent_client_protocol_tokio::AcpAgent;
use flate2::read::GzDecoder;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tar::Archive;

use crate::models::{ReviewChatReadinessStatus, ReviewChatReadinessStatusKind};
use crate::support::cli::{env_binary, project_dev_binary_candidates, resolve_binary};

use super::super::{emit_adapter_install_progress, ReviewChatAdapterInstallEvent};
use super::adapter::SessionConfigOption;

const ACP_INITIALIZE_TIMEOUT: Duration = Duration::from_secs(5);
const CODEX_ACP_VERSION: &str = "v0.14.0";
const CODEX_ACP_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_ACP_BIN", "RUDU_CODEX_ACP_PATH"];
const CODEX_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_BIN", "RUDU_CODEX_PATH"];
const DOWNLOAD_BUFFER_SIZE: usize = 64 * 1024;

static CODEX_ACP_CACHE_ROOT: OnceLock<PathBuf> = OnceLock::new();
static CODEX_ACP_INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArchiveKind {
    TarGz,
    Zip,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct CodexAcpTarget {
    platform: &'static str,
    archive_url: &'static str,
    archive_kind: ArchiveKind,
    executable_name: &'static str,
    sha256: &'static str,
}

const CODEX_ACP_TARGETS: &[CodexAcpTarget] = &[
    CodexAcpTarget {
        platform: "darwin-aarch64",
        archive_url: "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-aarch64-apple-darwin.tar.gz",
        archive_kind: ArchiveKind::TarGz,
        executable_name: "codex-acp",
        sha256: "01009b98cf3cfe83280f6aad060001cfa02694d6a62e6a2c4d17b6c30a3edcb1",
    },
    CodexAcpTarget {
        platform: "darwin-x86_64",
        archive_url: "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-x86_64-apple-darwin.tar.gz",
        archive_kind: ArchiveKind::TarGz,
        executable_name: "codex-acp",
        sha256: "57f5c265473fc2b4c29cf574496d0f97c7a2474a2ea353662d0289885e529f36",
    },
    CodexAcpTarget {
        platform: "linux-aarch64",
        archive_url: "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-aarch64-unknown-linux-gnu.tar.gz",
        archive_kind: ArchiveKind::TarGz,
        executable_name: "codex-acp",
        sha256: "a820fe12333cc7eb5e65a3c0a38867320550c01b6d6adc99423b5d08141b684e",
    },
    CodexAcpTarget {
        platform: "linux-x86_64",
        archive_url: "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-x86_64-unknown-linux-gnu.tar.gz",
        archive_kind: ArchiveKind::TarGz,
        executable_name: "codex-acp",
        sha256: "d8bd610c79df447d2d302c6b56c899a0d44837411de10ab190102eb07932ec28",
    },
    CodexAcpTarget {
        platform: "windows-aarch64",
        archive_url: "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-aarch64-pc-windows-msvc.zip",
        archive_kind: ArchiveKind::Zip,
        executable_name: "codex-acp.exe",
        sha256: "409e9b114fff9451c73a27f620a087ad73649a44396415ef1c3bf217fb23c093",
    },
    CodexAcpTarget {
        platform: "windows-x86_64",
        archive_url: "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-x86_64-pc-windows-msvc.zip",
        archive_kind: ArchiveKind::Zip,
        executable_name: "codex-acp.exe",
        sha256: "267f577d6d87c403d541420507f7b8f28fa56f6ff432d97eb2eb196c39cf268a",
    },
];

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

pub(super) fn codex_effort_config(mode: ReviewChatEffortMode) -> Vec<SessionConfigOption> {
    let mut options = vec![SessionConfigOption {
        key: "model",
        value: mode.model().to_string(),
        required: true,
    }];

    if let Some(reasoning_effort) = mode.reasoning_effort() {
        options.push(SessionConfigOption {
            key: "reasoning_effort",
            value: reasoning_effort.to_string(),
            required: mode == ReviewChatEffortMode::Deep,
        });
    }

    options
}

pub(super) fn codex_acp_agent() -> Result<AcpAgent, String> {
    let codex_acp_bin = resolve_codex_acp_binary(&|_, _, _, _| {}).map_err(|status| {
        status
            .message
            .unwrap_or_else(|| "Codex ACP is unavailable.".into())
    })?;
    AcpAgent::from_args(codex_acp_agent_args(codex_acp_bin))
        .map_err(|error| format!("Failed to configure codex-acp runtime: {error}"))
}

fn codex_acp_agent_args(codex_acp_bin: String) -> Vec<String> {
    let mut args = vec![codex_acp_bin];
    args.extend(codex_acp_config_args().into_iter().map(String::from));
    args
}

fn codex_acp_config_args() -> [&'static str; 10] {
    [
        "-c",
        "sandbox_mode=read-only",
        "-c",
        "approval_policy=on-request",
        "-c",
        "service_tier=fast",
        "-c",
        "hide_agent_reasoning=false",
        "-c",
        "model_reasoning_summary=\"auto\"",
    ]
}

pub(super) fn set_codex_acp_cache_root(path: PathBuf) -> Result<(), PathBuf> {
    CODEX_ACP_CACHE_ROOT.set(path)
}

pub(super) fn review_chat_readiness<F>(emit_event: F) -> ReviewChatReadinessStatus
where
    F: Fn(ReviewChatAdapterInstallEvent),
{
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

    let codex_acp_bin = match resolve_codex_acp_binary(&|phase, downloaded, total, message| {
        emit_adapter_install_progress(&emit_event, phase, downloaded, total, message);
    }) {
        Ok(path) => path,
        Err(status) => return status,
    };
    if let Err(error) = run_acp_initialize_probe(&codex_acp_bin) {
        return error;
    }

    ReviewChatReadinessStatus {
        status: ReviewChatReadinessStatusKind::Ready,
        message: None,
    }
}

fn resolve_codex_acp_binary<F>(emit_progress: &F) -> Result<String, ReviewChatReadinessStatus>
where
    F: Fn(&str, u64, Option<u64>, &str),
{
    if let Some(value) = env_binary(CODEX_ACP_BIN_ENV_VARS) {
        return Ok(value);
    }

    if let Some(path) = cached_managed_codex_acp_binary_path() {
        if path.is_file() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    match ensure_managed_codex_acp_binary(emit_progress) {
        Ok(path) => return Ok(path.to_string_lossy().to_string()),
        Err(error) => {
            if let Some(path) = project_dev_binary_candidates("codex-acp")
                .into_iter()
                .find(|path| path.is_file())
            {
                return Ok(path.to_string_lossy().to_string());
            }

            Err(readiness(
                ReviewChatReadinessStatusKind::MissingCodexAcp,
                format!("Rudu could not install the managed Codex ACP adapter: {error}"),
            ))
        }
    }
}

fn cached_managed_codex_acp_binary_path() -> Option<PathBuf> {
    let root = CODEX_ACP_CACHE_ROOT.get()?;
    let target = current_codex_acp_target()?;
    Some(managed_codex_acp_binary_path(root, target))
}

fn ensure_managed_codex_acp_binary<F>(emit_progress: &F) -> Result<PathBuf, String>
where
    F: Fn(&str, u64, Option<u64>, &str),
{
    let Some(root) = CODEX_ACP_CACHE_ROOT.get() else {
        return Err("Codex ACP cache directory is not initialized.".to_string());
    };
    let Some(target) = current_codex_acp_target() else {
        return Err("This platform is not supported by the pinned Codex ACP release.".to_string());
    };

    let bin_path = managed_codex_acp_binary_path(root, target);
    emit_progress(
        "checking",
        0,
        None,
        "Checking for the managed Codex ACP adapter",
    );
    if bin_path.is_file() {
        emit_progress("ready", 0, None, "Codex ACP adapter is ready");
        return Ok(bin_path);
    }

    let _install_guard = CODEX_ACP_INSTALL_LOCK
        .lock()
        .map_err(|error| format!("Failed to lock Codex ACP installer: {error}"))?;
    if bin_path.is_file() {
        emit_progress("ready", 0, None, "Codex ACP adapter is ready");
        return Ok(bin_path);
    }

    let staging_dir =
        root.join(".downloads")
            .join(format!("{}-{}", target.platform, std::process::id()));
    let archive_path = staging_dir.join(archive_file_name(target.archive_url));
    let extract_dir = staging_dir.join("extract");

    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|error| {
            format!(
                "Failed to clear previous Codex ACP download at {}: {error}",
                staging_dir.display()
            )
        })?;
    }
    fs::create_dir_all(&staging_dir).map_err(|error| {
        format!(
            "Failed to create Codex ACP download directory {}: {error}",
            staging_dir.display()
        )
    })?;

    let result = (|| {
        emit_progress("downloading", 0, None, "Downloading Codex ACP adapter");
        download_and_verify_archive(&archive_path, target, emit_progress)?;
        emit_progress("extracting", 0, None, "Installing Codex ACP adapter");
        extract_archive(&archive_path, &extract_dir, target.archive_kind)?;
        let extracted_bin = find_extracted_binary(&extract_dir, target.executable_name)
            .ok_or_else(|| "Codex ACP archive did not contain the adapter binary.".to_string())?;
        let direct_bin = extract_dir.join(target.executable_name);
        if extracted_bin != direct_bin {
            fs::copy(&extracted_bin, &direct_bin).map_err(|error| {
                format!(
                    "Failed to normalize Codex ACP binary path from {} to {}: {error}",
                    extracted_bin.display(),
                    direct_bin.display()
                )
            })?;
        }

        #[cfg(unix)]
        set_executable_permissions(&direct_bin)?;

        let final_dir = bin_path
            .parent()
            .ok_or_else(|| "Codex ACP cache path did not have a parent directory.".to_string())?;
        if final_dir.exists() {
            fs::remove_dir_all(final_dir).map_err(|error| {
                format!(
                    "Failed to replace existing Codex ACP cache at {}: {error}",
                    final_dir.display()
                )
            })?;
        }
        fs::create_dir_all(final_dir.parent().ok_or_else(|| {
            "Codex ACP cache platform directory did not have a parent.".to_string()
        })?)
        .map_err(|error| format!("Failed to create Codex ACP cache parent: {error}"))?;
        fs::rename(&extract_dir, final_dir).map_err(|error| {
            format!(
                "Failed to move Codex ACP adapter into cache {}: {error}",
                final_dir.display()
            )
        })?;

        if !bin_path.is_file() {
            return Err(format!(
                "Codex ACP adapter was not found at {} after install.",
                bin_path.display()
            ));
        }

        emit_progress("ready", 0, None, "Codex ACP adapter is ready");
        Ok(bin_path.clone())
    })();

    if let Err(error) = fs::remove_dir_all(&staging_dir) {
        if staging_dir.exists() {
            eprintln!(
                "Failed to remove Codex ACP staging directory {}: {}",
                staging_dir.display(),
                error
            );
        }
    }

    result
}

fn current_codex_acp_target() -> Option<&'static CodexAcpTarget> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        return None;
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        return None;
    };

    target_for_platform(os, arch)
}

fn target_for_platform(os: &str, arch: &str) -> Option<&'static CodexAcpTarget> {
    let platform = format!("{os}-{arch}");
    CODEX_ACP_TARGETS
        .iter()
        .find(|target| target.platform == platform)
}

fn managed_codex_acp_binary_path(root: &Path, target: &CodexAcpTarget) -> PathBuf {
    root.join(CODEX_ACP_VERSION)
        .join(target.platform)
        .join(target.executable_name)
}

fn archive_file_name(url: &str) -> &str {
    url.rsplit('/').next().unwrap_or("codex-acp-archive")
}

fn download_and_verify_archive<F>(
    archive_path: &Path,
    target: &CodexAcpTarget,
    emit_progress: &F,
) -> Result<(), String>
where
    F: Fn(&str, u64, Option<u64>, &str),
{
    let mut response = reqwest::blocking::Client::new()
        .get(target.archive_url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Failed to download Codex ACP adapter: {error}"))?;
    let total_bytes = response.content_length();
    let mut file = File::create(archive_path).map_err(|error| {
        format!(
            "Failed to create Codex ACP archive {}: {error}",
            archive_path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut downloaded_bytes = 0_u64;
    let mut buffer = [0_u8; DOWNLOAD_BUFFER_SIZE];

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read Codex ACP download: {error}"))?;
        if read == 0 {
            break;
        }

        file.write_all(&buffer[..read]).map_err(|error| {
            format!(
                "Failed to write Codex ACP archive {}: {error}",
                archive_path.display()
            )
        })?;
        hasher.update(&buffer[..read]);
        downloaded_bytes += read as u64;
        emit_progress(
            "downloading",
            downloaded_bytes,
            total_bytes,
            "Downloading Codex ACP adapter",
        );
    }

    let hash = hasher.finalize();
    let actual_sha = hash.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    verify_sha256_digest(&actual_sha, target.sha256)
}

fn verify_sha256_digest(actual_sha: &str, expected_sha: &str) -> Result<(), String> {
    if actual_sha.eq_ignore_ascii_case(expected_sha) {
        return Ok(());
    }

    Err(format!(
        "Codex ACP archive checksum mismatch: expected {expected_sha}, got {actual_sha}"
    ))
}

fn extract_archive(
    archive_path: &Path,
    extract_dir: &Path,
    kind: ArchiveKind,
) -> Result<(), String> {
    fs::create_dir_all(extract_dir).map_err(|error| {
        format!(
            "Failed to create Codex ACP extraction directory {}: {error}",
            extract_dir.display()
        )
    })?;

    match kind {
        ArchiveKind::TarGz => {
            let file = File::open(archive_path).map_err(|error| {
                format!(
                    "Failed to open Codex ACP archive {}: {error}",
                    archive_path.display()
                )
            })?;
            let decoder = GzDecoder::new(file);
            let mut archive = Archive::new(decoder);
            archive.unpack(extract_dir).map_err(|error| {
                format!(
                    "Failed to extract Codex ACP archive {}: {error}",
                    archive_path.display()
                )
            })
        }
        ArchiveKind::Zip => extract_zip_archive(archive_path, extract_dir),
    }
}

fn extract_zip_archive(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open Codex ACP zip archive {}: {error}",
            archive_path.display()
        )
    })?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read Codex ACP zip archive: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read Codex ACP zip entry: {error}"))?;
        let Some(enclosed_name) = entry.enclosed_name() else {
            continue;
        };
        let out_path = extract_dir.join(enclosed_name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|error| {
                format!(
                    "Failed to create Codex ACP zip directory {}: {error}",
                    out_path.display()
                )
            })?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create Codex ACP zip parent {}: {error}",
                    parent.display()
                )
            })?;
        }
        let mut output = File::create(&out_path).map_err(|error| {
            format!(
                "Failed to create Codex ACP zip output {}: {error}",
                out_path.display()
            )
        })?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Failed to extract Codex ACP zip entry: {error}"))?;
    }

    Ok(())
}

fn find_extracted_binary(root: &Path, executable_name: &str) -> Option<PathBuf> {
    let direct = root.join(executable_name);
    if direct.is_file() {
        return Some(direct);
    }

    for entry in fs::read_dir(root).ok()? {
        let path = entry.ok()?.path();
        if path.is_dir() {
            if let Some(found) = find_extracted_binary(&path, executable_name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|name| name.to_str()) == Some(executable_name) {
            return Some(path);
        }
    }

    None
}

#[cfg(unix)]
fn set_executable_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|error| {
            format!(
                "Failed to read Codex ACP binary metadata {}: {error}",
                path.display()
            )
        })?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| {
        format!(
            "Failed to set executable permissions on {}: {error}",
            path.display()
        )
    })
}

pub(super) fn run_command_output(bin: &str, args: &[&str]) -> Result<Output, std::io::Error> {
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
        .args(codex_acp_config_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if command_missing(&error) {
                readiness(
                    ReviewChatReadinessStatusKind::MissingCodexAcp,
                    "Rudu could not find or start the managed Codex ACP adapter.",
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

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tar::{Builder, Header};

    fn temp_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("rudu-codex-acp-{name}-{nanos}"))
    }

    fn write_test_tar_gz(path: &Path, file_path: &str, contents: &[u8]) {
        let file = File::create(path).unwrap();
        let encoder = GzEncoder::new(file, Compression::default());
        let mut archive = Builder::new(encoder);
        let mut header = Header::new_gnu();
        header.set_path(file_path).unwrap();
        header.set_size(contents.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        archive.append(&header, contents).unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn selects_platform_specific_targets() {
        let target = target_for_platform("darwin", "aarch64").unwrap();
        assert_eq!(target.platform, "darwin-aarch64");
        assert_eq!(target.archive_kind, ArchiveKind::TarGz);
        assert_eq!(target.executable_name, "codex-acp");

        let target = target_for_platform("windows", "x86_64").unwrap();
        assert_eq!(target.platform, "windows-x86_64");
        assert_eq!(target.archive_kind, ArchiveKind::Zip);
        assert_eq!(target.executable_name, "codex-acp.exe");

        assert!(target_for_platform("freebsd", "x86_64").is_none());
    }

    #[test]
    fn codex_acp_agent_args_force_supported_service_tier() {
        let args = codex_acp_agent_args("codex-acp".to_string());

        assert!(args
            .windows(2)
            .any(|window| window[0] == "-c" && window[1] == "service_tier=fast"));
    }

    #[test]
    fn builds_versioned_cache_path() {
        let root = PathBuf::from("/tmp/rudu");
        let target = target_for_platform("darwin", "aarch64").unwrap();
        assert_eq!(
            managed_codex_acp_binary_path(&root, target),
            PathBuf::from("/tmp/rudu/v0.14.0/darwin-aarch64/codex-acp")
        );
    }

    #[test]
    fn rejects_sha256_mismatch() {
        let error = verify_sha256_digest("abc", "def").unwrap_err();
        assert!(error.contains("checksum mismatch"));
    }

    #[test]
    fn extracts_tar_gz_archive_and_finds_binary() {
        let dir = temp_test_dir("extract");
        fs::create_dir_all(&dir).unwrap();
        let archive_path = dir.join("codex-acp.tar.gz");
        let extract_dir = dir.join("extract");
        write_test_tar_gz(&archive_path, "nested/codex-acp", b"adapter");

        extract_archive(&archive_path, &extract_dir, ArchiveKind::TarGz).unwrap();
        let binary = find_extracted_binary(&extract_dir, "codex-acp").unwrap();
        assert_eq!(fs::read(binary).unwrap(), b"adapter");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cached_binary_reuse_path_is_detectable() {
        let dir = temp_test_dir("cache");
        let target = target_for_platform("linux", "x86_64").unwrap();
        let binary = managed_codex_acp_binary_path(&dir, target);
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, b"adapter").unwrap();

        assert!(binary.is_file());

        fs::remove_dir_all(&dir).unwrap();
    }
}
