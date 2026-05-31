use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Instant;

use crate::models::ReviewWalkthrough;
use crate::support::cli::resolve_binary;

use super::{unique_suffix, WalkthroughGeneratorRequest, WALKTHROUGH_SCHEMA, WALKTHROUGH_TIMEOUT};

const CODEX_BIN_ENV_VARS: &[&str] = &["RUDU_CODEX_BIN", "RUDU_CODEX_PATH"];

pub(super) fn run(request: &WalkthroughGeneratorRequest<'_>) -> Result<ReviewWalkthrough, String> {
    let schema_path = request.rudu_dir.join("review-walkthrough.schema.json");
    let output_path = request
        .rudu_dir
        .join(format!("review-walkthrough-{}.json", unique_suffix()));
    fs::write(&schema_path, WALKTHROUGH_SCHEMA)
        .map_err(|error| format!("Failed to write walkthrough schema: {error}"))?;

    run_codex_exec(request.repo_dir, &schema_path, &output_path, request.prompt)?;
    let body = fs::read_to_string(&output_path)
        .map_err(|error| format!("Failed to read generated walkthrough: {error}"))?;
    let walkthrough = serde_json::from_str::<ReviewWalkthrough>(&body)
        .map_err(|error| format!("Generated walkthrough did not match the schema: {error}"))?;
    let _ = fs::remove_file(output_path);
    Ok(walkthrough)
}

fn run_codex_exec(
    repo_dir: &Path,
    schema_path: &Path,
    output_path: &Path,
    prompt: &str,
) -> Result<(), String> {
    let codex_bin = resolve_binary(CODEX_BIN_ENV_VARS, "codex");
    let mut child = Command::new(&codex_bin)
        .arg("exec")
        .arg("--skip-git-repo-check")
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("read-only")
        .arg("--output-schema")
        .arg(schema_path)
        .arg("--output-last-message")
        .arg(output_path)
        .arg("--json")
        .arg(prompt)
        .current_dir(repo_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start Codex walkthrough generator: {error}"))?;

    let started_at = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to wait for Codex walkthrough generator: {error}"))?
        {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("Failed to collect Codex walkthrough output: {error}"))?;
            if status.success() {
                return Ok(());
            }

            return Err(format!(
                "Codex walkthrough generator failed: {}{}",
                first_non_empty_line(&output.stderr),
                first_non_empty_line(&output.stdout)
            ));
        }

        if started_at.elapsed() > WALKTHROUGH_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Codex walkthrough generator timed out.".to_string());
        }

        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

fn first_non_empty_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| format!(" {}", line.trim()))
        .unwrap_or_default()
}
