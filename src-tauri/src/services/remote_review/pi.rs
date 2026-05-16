use std::fs;
use std::path::{Path, PathBuf};

use crate::models::RemoteReviewSession;
use crate::services::remote_review_config::WorkerConfig;

use super::session::{CHANGED_FILES_FILE, DIFF_FILE};

const PI_EXTENSION_FILE: &str = "rudu-remote-review-extension.ts";
const PI_SCRIPT_FILE: &str = "run-pi-review.sh";
const PI_SETTINGS_DIR: &str = ".pi";
const PI_SETTINGS_FILE: &str = "settings.json";

pub(super) struct RuntimeFiles {
    pub(super) script_path: PathBuf,
}

pub(super) fn prepare_runtime_files(
    config: &WorkerConfig,
    session: &RemoteReviewSession,
    session_dir: &Path,
) -> Result<RuntimeFiles, String> {
    let extension_path = session_dir.join(PI_EXTENSION_FILE);
    let script_path = session_dir.join(PI_SCRIPT_FILE);
    let diff_path = session_dir.join(DIFF_FILE);
    let changed_files_path = session_dir.join(CHANGED_FILES_FILE);
    let report_path = PathBuf::from(&session.report_path);
    let pi_bin = resolve_binary("RUDU_PI_BIN", "pi");

    write_quiet_startup_settings(session_dir)?;
    fs::write(&extension_path, extension_source())
        .map_err(|error| format!("Failed to write Pi extension: {error}"))?;
    fs::write(
        &script_path,
        wrapper_script(PiWrapperScriptInput {
            pi_bin,
            worker_url: config.base_url.clone(),
            worker_api_token: config.api_token.clone(),
            session_id: session.id.clone(),
            extension_path,
            report_path,
            diff_path,
            changed_files_path,
            repo: session.repo.clone(),
            number: session.number,
            head_sha: session.head_sha.clone(),
        }),
    )
    .map_err(|error| format!("Failed to write Pi launch script: {error}"))?;

    make_executable(&script_path)?;
    Ok(RuntimeFiles { script_path })
}

pub(super) fn review_prompt(session: &RemoteReviewSession) -> String {
    format!(
        r#"Review GitHub pull request {repo}#{number} at head SHA {head_sha}.

This is a read-only remote review session launched by Rudu.

Use get_pr_diff and get_changed_files first. Use ls and read for extra context from the Worker-indexed GitHub file tree. Do not ask to run shell commands, edit files, or post GitHub comments.

Write a concise Markdown report with:
- Summary
- Findings, ordered by severity, with file paths and line references when possible
- Residual risks or "No findings" if there are no actionable issues

When the report is final, call save_remote_review_report with the complete Markdown body.
"#,
        repo = session.repo,
        number = session.number,
        head_sha = session.head_sha,
    )
}

pub(super) fn resolve_binary(env_var: &str, bin_name: &str) -> String {
    if let Ok(value) = std::env::var(env_var) {
        let value = value.trim();
        if !value.is_empty() {
            return value.to_string();
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

    roots
        .into_iter()
        .map(|root| root.join("node_modules").join(".bin").join(bin_name))
        .collect()
}

struct PiWrapperScriptInput {
    pi_bin: String,
    worker_url: String,
    worker_api_token: String,
    session_id: String,
    extension_path: PathBuf,
    report_path: PathBuf,
    diff_path: PathBuf,
    changed_files_path: PathBuf,
    repo: String,
    number: u32,
    head_sha: String,
}

fn wrapper_script(input: PiWrapperScriptInput) -> String {
    format!(
        r#"#!/usr/bin/env bash
set -euo pipefail

PI_BIN={pi_bin}
EXTENSION={extension}
REPORT_PATH={report}

export RUDU_REMOTE_REVIEW_WORKER_URL={worker_url}
export RUDU_REMOTE_REVIEW_API_TOKEN={worker_api_token}
export RUDU_REMOTE_REVIEW_SESSION_ID={session_id}
export RUDU_REMOTE_REVIEW_REPORT_PATH="$REPORT_PATH"
export RUDU_REMOTE_REVIEW_DIFF_PATH={diff}
export RUDU_REMOTE_REVIEW_CHANGED_FILES_PATH={changed_files}
export RUDU_REMOTE_REVIEW_REPO={repo}
export RUDU_REMOTE_REVIEW_NUMBER={number}
export RUDU_REMOTE_REVIEW_HEAD_SHA={head_sha}

exec "$PI_BIN" \
  --no-builtin-tools \
  --tools read,ls,get_pr_diff,get_changed_files,save_remote_review_report \
  -e "$EXTENSION" \
  "$@"
"#,
        pi_bin = sh_quote(&input.pi_bin),
        extension = sh_quote_path(&input.extension_path),
        report = sh_quote_path(&input.report_path),
        worker_url = sh_quote(&input.worker_url),
        worker_api_token = sh_quote(&input.worker_api_token),
        session_id = sh_quote(&input.session_id),
        diff = sh_quote_path(&input.diff_path),
        changed_files = sh_quote_path(&input.changed_files_path),
        repo = sh_quote(&input.repo),
        number = sh_quote(&input.number.to_string()),
        head_sha = sh_quote(&input.head_sha),
    )
}

fn sh_quote_path(path: &Path) -> String {
    sh_quote(&path.to_string_lossy())
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn extension_source() -> &'static str {
    include_str!("pi_extension.ts")
}

fn write_quiet_startup_settings(session_dir: &Path) -> Result<(), String> {
    let settings_dir = session_dir.join(PI_SETTINGS_DIR);
    fs::create_dir_all(&settings_dir)
        .map_err(|error| format!("Failed to create Pi settings directory: {error}"))?;
    fs::write(
        settings_dir.join(PI_SETTINGS_FILE),
        "{\n  \"quietStartup\": true\n}\n",
    )
    .map_err(|error| format!("Failed to write Pi quiet startup settings: {error}"))
}

fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|error| format!("Failed to read script permissions: {error}"))?
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("Failed to make Pi script executable: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        extension_source, wrapper_script, write_quiet_startup_settings, PiWrapperScriptInput,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn pi_extension_source_comes_from_checked_in_template() {
        assert_eq!(extension_source(), include_str!("pi_extension.ts"));
        assert!(extension_source().contains("save_remote_review_report"));
        assert!(extension_source().contains("Worker-indexed GitHub PR tree"));
    }

    #[test]
    fn pi_wrapper_script_preserves_acp_args_and_registers_only_review_tools() {
        let script = wrapper_script(PiWrapperScriptInput {
            pi_bin: "pi".to_string(),
            worker_url: "http://localhost:8787".to_string(),
            worker_api_token: "secret".to_string(),
            session_id: "session-1".to_string(),
            extension_path: PathBuf::from("/tmp/extension.ts"),
            report_path: PathBuf::from("/tmp/report.md"),
            diff_path: PathBuf::from("/tmp/pr.diff"),
            changed_files_path: PathBuf::from("/tmp/changed-files.txt"),
            repo: "tanvesh/rudu".to_string(),
            number: 7,
            head_sha: "abc123".to_string(),
        });

        assert!(!script.contains("git clone"));
        assert!(script
            .contains("--tools read,ls,get_pr_diff,get_changed_files,save_remote_review_report"));
        assert!(script.contains("\"$@\""));
        assert!(!script.contains("--tools bash"));
        assert!(!script.contains("--tools edit"));
        assert!(!script.contains("--tools write"));
    }

    #[test]
    fn pi_settings_silence_startup_header_for_session_workspace() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let session_dir = std::env::temp_dir().join(format!("rudu-pi-settings-test-{unique}"));
        fs::create_dir_all(&session_dir).expect("create test session dir");

        write_quiet_startup_settings(&session_dir).expect("write pi settings");

        let settings =
            fs::read_to_string(session_dir.join(".pi/settings.json")).expect("read pi settings");
        assert!(settings.contains("\"quietStartup\": true"));

        fs::remove_dir_all(session_dir).expect("cleanup test session dir");
    }
}
