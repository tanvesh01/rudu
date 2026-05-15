use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::github::{get_gh_auth_token_sync, run_gh};
use crate::models::{
    GitHubFileContext, RemoteReviewReport, RemoteReviewSession, RemoteReviewSessionStatus,
};
use crate::support::now_unix_timestamp;

const METADATA_FILE: &str = "session.json";
const REPORT_FILE: &str = "remote-review-report.md";
const DIFF_FILE: &str = "pr.diff";
const CHANGED_FILES_FILE: &str = "changed-files.txt";
const PI_EXTENSION_FILE: &str = "rudu-remote-review-extension.ts";
const PI_PROMPT_FILE: &str = "remote-review-prompt.md";
const PI_SCRIPT_FILE: &str = "run-pi-review.sh";

#[derive(Debug, Clone)]
pub struct RemoteReviewInput {
    repo: String,
    number: u32,
    head_sha: String,
}

#[derive(Debug, Clone)]
struct WorkerConfig {
    base_url: String,
    api_token: String,
}

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
struct WorkerSession {
    id: String,
    repo: String,
    number: u32,
    head_sha: String,
    status: RemoteReviewSessionStatus,
    file_context: Option<GitHubFileContext>,
    created_at: i64,
    updated_at: i64,
    last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkerErrorResponse {
    error: Option<String>,
}

impl RemoteReviewInput {
    pub fn new(repo: String, number: u32, head_sha: String) -> Result<Self, String> {
        let repo = repo.trim().to_string();
        if repo.is_empty() {
            return Err("Repo is required".to_string());
        }
        if !repo.contains('/') {
            return Err("Repo must be in owner/name format".to_string());
        }
        if number == 0 {
            return Err("Pull request number is required".to_string());
        }

        let head_sha = head_sha.trim().to_string();
        if head_sha.is_empty() {
            return Err("Head SHA is required".to_string());
        }

        Ok(Self {
            repo,
            number,
            head_sha,
        })
    }
}

pub fn prepare_session(
    root: &Path,
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<RemoteReviewSession, String> {
    let input = RemoteReviewInput::new(repo, number, head_sha)?;
    fs::create_dir_all(root).map_err(|error| format!("Failed to create review root: {error}"))?;

    let config = WorkerConfig::from_env()?;
    let github_token = get_gh_auth_token_sync()?;
    let worker_session = prepare_worker_session(&config, &input, &github_token)?;
    let session = local_session_from_worker(root, worker_session)?;
    write_session(root, &session)?;
    Ok(session)
}

pub fn hydrate_session(root: &Path, session_id: String) -> Result<GitHubFileContext, String> {
    let session = read_session_by_id(root, &session_id)?;
    let result = hydrate_session_inner(root, &session);

    match result {
        Ok(file_context) => Ok(file_context),
        Err(error) => {
            let mut failed_session = session;
            failed_session.status = RemoteReviewSessionStatus::Failed;
            failed_session.updated_at = now_unix_timestamp();
            failed_session.last_error = Some(error.clone());
            mark_worker_session_failed(&failed_session.id, &error);
            let _ = write_session(root, &failed_session);
            Err(error)
        }
    }
}

pub fn launch_pi_review_terminal(root: &Path, session_id: String) -> Result<(), String> {
    let mut session = read_session_by_id(root, &session_id)?;
    let result = launch_pi_review_terminal_inner(root, &session);

    match result {
        Ok(()) => {
            session.status = RemoteReviewSessionStatus::Launched;
            session.updated_at = now_unix_timestamp();
            session.last_error = None;
            if let Ok(config) = WorkerConfig::from_env() {
                if let Ok(worker_session) = update_worker_session_status(
                    &config,
                    &session.id,
                    RemoteReviewSessionStatus::Launched,
                    None,
                ) {
                    session.file_context = worker_session.file_context;
                    session.updated_at = worker_session.updated_at;
                }
            }
            write_session(root, &session)
        }
        Err(error) => {
            session.status = RemoteReviewSessionStatus::Failed;
            session.updated_at = now_unix_timestamp();
            session.last_error = Some(error.clone());
            mark_worker_session_failed(&session.id, &error);
            let _ = write_session(root, &session);
            Err(error)
        }
    }
}

pub fn get_report(root: &Path, session_id: String) -> Result<Option<RemoteReviewReport>, String> {
    let session = read_session_by_id(root, &session_id)?;
    let report_path = PathBuf::from(&session.report_path);

    if !report_path.exists() {
        return Ok(None);
    }

    let body = fs::read_to_string(&report_path)
        .map_err(|error| format!("Failed to read remote review report: {error}"))?;
    let updated_at = fs::metadata(&report_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(now_unix_timestamp);

    Ok(Some(RemoteReviewReport {
        session_id: session.id,
        path: report_path.to_string_lossy().to_string(),
        body,
        updated_at,
    }))
}

fn hydrate_session_inner(
    root: &Path,
    session: &RemoteReviewSession,
) -> Result<GitHubFileContext, String> {
    let config = WorkerConfig::from_env()?;
    let worker_session = hydrate_worker_session(&config, &session.id)?;
    ensure_worker_session_matches(&worker_session, session)?;

    let file_context = worker_session.file_context.clone().ok_or_else(|| {
        "Remote review Worker session is missing indexed file metadata. Recreate the session from the selected PR.".to_string()
    })?;

    let session_dir = session_dir(root, &session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    capture_diff_snapshots(&session_dir, session)?;

    let local_session = local_session_from_worker(root, worker_session)?;
    write_session(root, &local_session)?;
    Ok(file_context)
}

fn capture_diff_snapshots(session_dir: &Path, session: &RemoteReviewSession) -> Result<(), String> {
    let diff_path = session_dir.join(DIFF_FILE);
    let changed_files_path = session_dir.join(CHANGED_FILES_FILE);
    let number = session.number.to_string();

    let diff = run_gh(&["pr", "diff", &number, "--repo", &session.repo])?;
    fs::write(&diff_path, diff)
        .map_err(|error| format!("Failed to write PR diff snapshot: {error}"))?;

    let changed_files = run_gh(&["pr", "diff", &number, "--repo", &session.repo, "--name-only"])?;
    fs::write(&changed_files_path, changed_files)
        .map_err(|error| format!("Failed to write changed files snapshot: {error}"))?;

    Ok(())
}

fn launch_pi_review_terminal_inner(root: &Path, session: &RemoteReviewSession) -> Result<(), String> {
    if session.file_context.is_none() {
        return Err("Hydrate this review session before launching Pi.".to_string());
    }

    let config = WorkerConfig::from_env()?;
    let worker_session = get_worker_session(&config, &session.id)?;
    ensure_worker_session_matches(&worker_session, session)?;
    if worker_session.file_context.is_none() {
        return Err("Remote review Worker session is not indexed yet. Hydrate it first.".to_string());
    }

    let session_dir = session_dir(root, &session.id);
    let extension_path = session_dir.join(PI_EXTENSION_FILE);
    let prompt_path = session_dir.join(PI_PROMPT_FILE);
    let script_path = session_dir.join(PI_SCRIPT_FILE);
    let diff_path = session_dir.join(DIFF_FILE);
    let changed_files_path = session_dir.join(CHANGED_FILES_FILE);
    let report_path = PathBuf::from(&session.report_path);

    fs::write(&extension_path, pi_extension_source())
        .map_err(|error| format!("Failed to write Pi extension: {error}"))?;
    fs::write(&prompt_path, pi_review_prompt(session))
        .map_err(|error| format!("Failed to write Pi prompt: {error}"))?;
    fs::write(
        &script_path,
        pi_launch_script(PiLaunchScriptInput {
            pi_bin: std::env::var("RUDU_PI_BIN").unwrap_or_else(|_| "pi".to_string()),
            worker_url: config.base_url,
            worker_api_token: config.api_token,
            session_id: session.id.clone(),
            session_dir,
            extension_path,
            prompt_path,
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
    open_terminal(&script_path)
}

fn prepare_worker_session(
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

fn hydrate_worker_session(config: &WorkerConfig, session_id: &str) -> Result<WorkerSession, String> {
    worker_json_no_body(
        config,
        Method::POST,
        &format!("/sessions/{session_id}/hydrate"),
        "hydrate remote review session",
    )
}

fn get_worker_session(config: &WorkerConfig, session_id: &str) -> Result<WorkerSession, String> {
    worker_json_no_body(
        config,
        Method::GET,
        &format!("/sessions/{session_id}"),
        "load remote review session",
    )
}

fn update_worker_session_status(
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

fn mark_worker_session_failed(session_id: &str, error: &str) {
    if let Ok(config) = WorkerConfig::from_env() {
        let _ = update_worker_session_status(
            &config,
            session_id,
            RemoteReviewSessionStatus::Failed,
            Some(error.to_string()),
        );
    }
}

fn local_session_from_worker(
    root: &Path,
    worker_session: WorkerSession,
) -> Result<RemoteReviewSession, String> {
    validate_session_id(&worker_session.id)?;
    let session_dir = session_dir(root, &worker_session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;

    Ok(RemoteReviewSession {
        id: worker_session.id,
        repo: worker_session.repo,
        number: worker_session.number,
        head_sha: worker_session.head_sha,
        status: worker_session.status,
        file_context: worker_session.file_context,
        report_path: session_dir.join(REPORT_FILE).to_string_lossy().to_string(),
        created_at: worker_session.created_at,
        updated_at: worker_session.updated_at,
        last_error: worker_session.last_error,
    })
}

fn ensure_worker_session_matches(
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

fn run_command_output(
    output: Result<Output, std::io::Error>,
    program: &str,
) -> Result<String, String> {
    let output = output.map_err(|error| format!("Failed to execute {program}: {error}"))?;
    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|error| format!("{program} returned non-UTF-8 output: {error}"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

fn read_session_by_id(root: &Path, session_id: &str) -> Result<RemoteReviewSession, String> {
    validate_session_id(session_id)?;
    let metadata_path = metadata_path(&session_dir(root, session_id));
    let body = fs::read_to_string(&metadata_path)
        .map_err(|error| format!("Failed to read remote review session: {error}"))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse remote review session: {error}"))
}

fn write_session(root: &Path, session: &RemoteReviewSession) -> Result<(), String> {
    validate_session_id(&session.id)?;
    let session_dir = session_dir(root, &session.id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create review session directory: {error}"))?;
    let body = serde_json::to_string_pretty(session)
        .map_err(|error| format!("Failed to serialize remote review session: {error}"))?;
    fs::write(metadata_path(&session_dir), body)
        .map_err(|error| format!("Failed to write remote review session: {error}"))
}

fn metadata_path(session_dir: &Path) -> PathBuf {
    session_dir.join(METADATA_FILE)
}

fn session_dir(root: &Path, session_id: &str) -> PathBuf {
    root.join(session_id)
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id
            .chars()
            .any(|ch| !(ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'))
    {
        return Err("Remote review session id is invalid".to_string());
    }

    Ok(())
}

pub fn session_id_for(repo: &str, number: u32, head_sha: &str) -> String {
    format!(
        "{}-pr-{}-{}",
        slugify(repo),
        number,
        short_sha(head_sha).to_ascii_lowercase()
    )
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            previous_dash = false;
            Some(ch.to_ascii_lowercase())
        } else if !previous_dash {
            previous_dash = true;
            Some('-')
        } else {
            None
        };

        if let Some(next) = next {
            output.push(next);
        }
    }

    output.trim_matches('-').to_string()
}

fn short_sha(head_sha: &str) -> &str {
    head_sha.get(..12).unwrap_or(head_sha)
}

impl WorkerConfig {
    fn from_env() -> Result<Self, String> {
        let base_url = std::env::var("RUDU_REMOTE_REVIEW_WORKER_URL").map_err(|_| {
            "Remote review Worker config is missing. Set RUDU_REMOTE_REVIEW_WORKER_URL to your deployed Worker URL or local wrangler dev URL, for example http://localhost:8787.".to_string()
        })?;
        let api_token = std::env::var("RUDU_REMOTE_REVIEW_API_TOKEN").map_err(|_| {
            "Remote review Worker config is missing. Set RUDU_REMOTE_REVIEW_API_TOKEN to the same bearer token configured on the Worker.".to_string()
        })?;
        let base_url = base_url.trim().trim_end_matches('/').to_string();
        let api_token = api_token.trim().to_string();

        if base_url.is_empty() {
            return Err("RUDU_REMOTE_REVIEW_WORKER_URL cannot be empty.".to_string());
        }

        if api_token.is_empty() {
            return Err("RUDU_REMOTE_REVIEW_API_TOKEN cannot be empty.".to_string());
        }

        Ok(Self {
            base_url,
            api_token,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}

struct PiLaunchScriptInput {
    pi_bin: String,
    worker_url: String,
    worker_api_token: String,
    session_id: String,
    session_dir: PathBuf,
    extension_path: PathBuf,
    prompt_path: PathBuf,
    report_path: PathBuf,
    diff_path: PathBuf,
    changed_files_path: PathBuf,
    repo: String,
    number: u32,
    head_sha: String,
}

fn pi_launch_script(input: PiLaunchScriptInput) -> String {
    format!(
        r#"#!/usr/bin/env bash
set -euo pipefail

PI_BIN={pi_bin}
SESSION_DIR={session_dir}
EXTENSION={extension}
PROMPT_FILE={prompt}
REPORT_PATH={report}

finish() {{
  status=$?
  trap - EXIT
  echo
  echo "Rudu remote Pi review finished with status $status."
  echo "Report path: $REPORT_PATH"
  read -r -p "Press Return to close this terminal." _
  exit "$status"
}}
trap finish EXIT

mkdir -p "$SESSION_DIR"

export RUDU_REMOTE_REVIEW_WORKER_URL={worker_url}
export RUDU_REMOTE_REVIEW_API_TOKEN={worker_api_token}
export RUDU_REMOTE_REVIEW_SESSION_ID={session_id}
export RUDU_REMOTE_REVIEW_REPORT_PATH="$REPORT_PATH"
export RUDU_REMOTE_REVIEW_DIFF_PATH={diff}
export RUDU_REMOTE_REVIEW_CHANGED_FILES_PATH={changed_files}
export RUDU_REMOTE_REVIEW_REPO={repo}
export RUDU_REMOTE_REVIEW_NUMBER={number}
export RUDU_REMOTE_REVIEW_HEAD_SHA={head_sha}

cd "$SESSION_DIR"
"$PI_BIN" \
  --no-builtin-tools \
  --tools read,ls,get_pr_diff,get_changed_files,save_remote_review_report \
  -e "$EXTENSION" \
  "$(cat "$PROMPT_FILE")"
"#,
        pi_bin = sh_quote(&input.pi_bin),
        session_dir = sh_quote_path(&input.session_dir),
        extension = sh_quote_path(&input.extension_path),
        prompt = sh_quote_path(&input.prompt_path),
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

fn pi_review_prompt(session: &RemoteReviewSession) -> String {
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

fn pi_extension_source() -> &'static str {
    r#"import { readFile, writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_TEXT_BYTES = 50_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function truncateText(text: string): string {
  const bytes = Buffer.byteLength(text);
  if (bytes <= MAX_TEXT_BYTES) return text;
  return `${text.slice(0, MAX_TEXT_BYTES)}\n\n[Output truncated at ${MAX_TEXT_BYTES} bytes from ${bytes} bytes.]`;
}

function sessionPath(pathname: string): string {
  const sessionId = encodeURIComponent(requiredEnv("RUDU_REMOTE_REVIEW_SESSION_ID"));
  return `/sessions/${sessionId}${pathname}`;
}

async function workerJson<T>(pathname: string): Promise<T> {
  const workerUrl = requiredEnv("RUDU_REMOTE_REVIEW_WORKER_URL").replace(/\/+$/, "");
  const apiToken = requiredEnv("RUDU_REMOTE_REVIEW_API_TOKEN");
  const response = await fetch(`${workerUrl}${pathname}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiToken}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        message = parsed.error ?? text;
      } catch {
        message = text;
      }
    }
    throw new Error(message || `Worker request failed with HTTP ${response.status}`);
  }
  return JSON.parse(text) as T;
}

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number | null;
};

type FilesResponse = {
  path: string;
  entries: DirectoryEntry[];
};

type FileResponse = {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  body: string;
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read",
    label: "Read",
    description: "Read a file from the Worker-indexed GitHub PR tree.",
    promptSnippet: "Read file contents from the remote PR file tree.",
    promptGuidelines: ["Use read to inspect files from the remote PR file tree."],
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const search = new URLSearchParams({ path: params.path });
      if (typeof params.startLine === "number") {
        search.set("startLine", String(params.startLine));
      }
      if (typeof params.endLine === "number") {
        search.set("endLine", String(params.endLine));
      }
      const file = await workerJson<FileResponse>(sessionPath(`/file?${search.toString()}`));
      return {
        content: [{ type: "text", text: truncateText(file.body) }],
        details: {
          path: file.path,
          startLine: file.startLine,
          endLine: file.endLine,
          totalLines: file.totalLines,
        },
      };
    },
  });

  pi.registerTool({
    name: "ls",
    label: "List",
    description: "List directory entries from the Worker-indexed GitHub PR tree.",
    promptSnippet: "List directory entries from the remote PR file tree.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const search = new URLSearchParams({
        path: params.path && params.path.trim().length > 0 ? params.path : ".",
      });
      const result = await workerJson<FilesResponse>(sessionPath(`/files?${search.toString()}`));
      const lines = result.entries.map((entry) =>
        `${entry.kind === "dir" ? "dir " : "file"} ${entry.path}${entry.size === null ? "" : ` (${entry.size} bytes)`}`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") || "(empty)" }],
        details: { path: result.path, entries: result.entries.length },
      };
    },
  });

  pi.registerTool({
    name: "get_pr_diff",
    label: "PR Diff",
    description: "Read the pull request diff snapshot captured by Rudu.",
    promptSnippet: "Read the selected PR diff snapshot.",
    parameters: Type.Object({}),
    async execute() {
      const text = await readFile(requiredEnv("RUDU_REMOTE_REVIEW_DIFF_PATH"), "utf8");
      return { content: [{ type: "text", text: truncateText(text) }], details: {} };
    },
  });

  pi.registerTool({
    name: "get_changed_files",
    label: "Changed Files",
    description: "Read the selected PR changed-file list captured by Rudu.",
    promptSnippet: "Read the changed file list for the selected PR.",
    parameters: Type.Object({}),
    async execute() {
      const text = await readFile(requiredEnv("RUDU_REMOTE_REVIEW_CHANGED_FILES_PATH"), "utf8");
      return { content: [{ type: "text", text: text.trim() || "No changed files." }], details: {} };
    },
  });

  pi.registerTool({
    name: "save_remote_review_report",
    label: "Save Report",
    description: "Save the final Markdown review report for Rudu to display.",
    promptSnippet: "Save the final remote review report.",
    parameters: Type.Object({ body: Type.String() }),
    async execute(_id, params) {
      await writeFile(requiredEnv("RUDU_REMOTE_REVIEW_REPORT_PATH"), params.body, "utf8");
      return { content: [{ type: "text", text: "Remote review report saved." }], details: {} };
    },
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt:
        event.systemPrompt +
        "\n\nRudu remote review mode: the active repo context comes from a read-only Worker-indexed GitHub file tree. Use get_pr_diff, get_changed_files, ls, and read. Do not edit files, write files outside save_remote_review_report, or run shell commands.",
    };
  });
}
"#
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

fn open_terminal(script_path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(script_path)
            .output();
        return run_command_output(output, "open").map(|_| ());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = script_path;
        Err(
            "Launching Pi in an external terminal is currently implemented for macOS only."
                .to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::session_id_for;
    use std::path::PathBuf;

    #[test]
    fn session_id_is_keyed_by_repo_number_and_short_sha() {
        assert_eq!(
            session_id_for("Owner/Repo.Name", 42, "ABCDEF0123456789"),
            "owner-repo-name-pr-42-abcdef012345"
        );
    }

    #[test]
    fn pi_launch_script_does_not_clone_or_register_git_tools() {
        let script = super::pi_launch_script(super::PiLaunchScriptInput {
            pi_bin: "pi".to_string(),
            worker_url: "http://localhost:8787".to_string(),
            worker_api_token: "secret".to_string(),
            session_id: "session-1".to_string(),
            session_dir: PathBuf::from("/tmp/session"),
            extension_path: PathBuf::from("/tmp/extension.ts"),
            prompt_path: PathBuf::from("/tmp/prompt.md"),
            report_path: PathBuf::from("/tmp/report.md"),
            diff_path: PathBuf::from("/tmp/pr.diff"),
            changed_files_path: PathBuf::from("/tmp/changed-files.txt"),
            repo: "tanvesh/rudu".to_string(),
            number: 7,
            head_sha: "abc123".to_string(),
        });

        assert!(!script.contains("git clone"));
        assert!(script.contains("--tools read,ls,get_pr_diff,get_changed_files,save_remote_review_report"));
    }
}
