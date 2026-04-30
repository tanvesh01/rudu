use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol::schema::{
    ContentBlock, InitializeRequest, McpServer, McpServerStdio, NewSessionRequest, PromptRequest,
    ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SessionNotification, TextContent,
};
use agent_client_protocol::{Agent, ConnectionTo};
use agent_client_protocol_tokio::AcpAgent;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

const CODEX_ACP_EVENT: &str = "codex-acp-event";
const CODEX_ACP_SIDECAR_NAME: &str = "codex-acp";
const CODEX_ACP_ARGS: [&str; 8] = [
    "-c",
    "sandbox_mode=read-only",
    "-c",
    "approval_policy=never",
    "-c",
    "features.computer_use=false",
    "-c",
    "plugins.\"computer-use@openai-bundled\".enabled=false",
];
const PROMPT_TIMEOUT_SECS: u64 = 120;

static CODEX_WORKER: OnceLock<Mutex<Option<CodexWorkerHandle>>> = OnceLock::new();

#[derive(Debug, Clone)]
struct CodexAcpLaunch {
    command: PathBuf,
    args: Vec<String>,
}

#[derive(Clone)]
struct CodexWorkerHandle {
    local_session_id: String,
    cwd: PathBuf,
    context: Option<CodexSessionContext>,
    is_stopping: bool,
    tx: mpsc::UnboundedSender<CodexWorkerCommand>,
}

enum CodexWorkerCommand {
    Prompt {
        prompt_id: String,
        text: String,
        context: Option<CodexSessionContext>,
    },
    Stop,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionContext {
    pub selected_pr_key: Option<String>,
    pub selected_diff_key: Option<String>,
    pub repo: Option<String>,
    pub pull_request_number: Option<u64>,
    pub pull_request_title: Option<String>,
    pub pull_request_url: Option<String>,
    pub head_sha: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexStartSessionResponse {
    pub local_session_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexAcpEvent {
    kind: String,
    local_session_id: String,
    prompt_id: Option<String>,
    permission_request_id: Option<String>,
    message: Option<String>,
    raw: Option<serde_json::Value>,
}

fn worker_slot() -> &'static Mutex<Option<CodexWorkerHandle>> {
    CODEX_WORKER.get_or_init(|| Mutex::new(None))
}

fn make_id(prefix: &str) -> String {
    format!("{prefix}-{}", now_unix_millis())
}

fn now_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn emit_event(app: &AppHandle, event: CodexAcpEvent) {
    let _ = app.emit(CODEX_ACP_EVENT, event);
}

fn emit_worker_event(app: &AppHandle, cwd: &Path, event: CodexAcpEvent) {
    append_transcript_record(
        cwd,
        &event.local_session_id,
        json!({
            "schemaVersion": 1,
            "type": "acp_event",
            "timestampUnixMs": now_unix_millis(),
            "localSessionId": event.local_session_id.clone(),
            "kind": event.kind.clone(),
            "promptId": event.prompt_id.clone(),
            "permissionRequestId": event.permission_request_id.clone(),
            "message": event.message.clone(),
        }),
    );
    emit_event(app, event);
}

fn transcript_dir(cwd: &Path) -> PathBuf {
    cwd.join(".context").join("rudu").join("codex-sessions")
}

fn session_transcript_path(cwd: &Path, local_session_id: &str) -> PathBuf {
    transcript_dir(cwd).join(format!("{local_session_id}.jsonl"))
}

fn append_transcript_record(cwd: &Path, local_session_id: &str, record: serde_json::Value) {
    let dir = transcript_dir(cwd);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    let line = match serde_json::to_string(&record) {
        Ok(line) => line,
        Err(_) => return,
    };

    for path in [
        session_transcript_path(cwd, local_session_id),
        dir.join("latest.jsonl"),
    ] {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn initialize_session_transcript(
    cwd: &Path,
    local_session_id: &str,
    context: Option<&CodexSessionContext>,
) {
    let dir = transcript_dir(cwd);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    let _ = fs::write(dir.join("latest.jsonl"), "");
    let branch = current_git_branch(cwd);
    let session_path = session_transcript_path(cwd, local_session_id);
    let latest_path = dir.join("latest.jsonl");
    let metadata = json!({
        "schemaVersion": 1,
        "localSessionId": local_session_id,
        "createdAtUnixMs": now_unix_millis(),
        "cwd": cwd.display().to_string(),
        "branch": branch.clone(),
        "context": context,
        "sessionPath": session_path.display().to_string(),
        "latestTranscriptPath": latest_path.display().to_string(),
    });

    if let Ok(contents) = serde_json::to_string_pretty(&metadata) {
        let _ = fs::write(dir.join("latest.json"), contents);
    }

    write_current_context(cwd, local_session_id, context, branch.as_deref());
    append_transcript_record(
        cwd,
        local_session_id,
        json!({
            "schemaVersion": 1,
            "type": "session_start",
            "timestampUnixMs": now_unix_millis(),
            "localSessionId": local_session_id,
            "cwd": cwd.display().to_string(),
            "branch": branch.clone(),
            "context": context,
        }),
    );
}

fn write_current_context(
    cwd: &Path,
    local_session_id: &str,
    context: Option<&CodexSessionContext>,
    branch: Option<&str>,
) {
    let context_dir = cwd.join(".context").join("rudu");
    if fs::create_dir_all(&context_dir).is_err() {
        return;
    }

    let mut contents = format!(
        "# Rudu Codex Context\n\n- Session: `{}`\n- Cwd: `{}`\n",
        local_session_id,
        cwd.display()
    );
    if let Some(branch) = branch {
        contents.push_str(&format!("- Branch: `{branch}`\n"));
    }
    if let Some(context) = context {
        if let Some(repo) = context.repo.as_deref() {
            contents.push_str(&format!("- Selected repo: `{repo}`\n"));
        }
        if let Some(number) = context.pull_request_number {
            contents.push_str(&format!("- Selected PR: `#{number}`\n"));
        }
        if let Some(title) = context.pull_request_title.as_deref() {
            contents.push_str(&format!("- PR title: {title}\n"));
        }
        if let Some(url) = context.pull_request_url.as_deref() {
            contents.push_str(&format!("- PR URL: {url}\n"));
        }
        if let Some(head_sha) = context.head_sha.as_deref() {
            contents.push_str(&format!("- Head SHA: `{head_sha}`\n"));
        }
    }
    contents.push_str("\nTranscript: `codex-sessions/latest.jsonl`\n");

    let _ = fs::write(context_dir.join("current-context.md"), contents);
}

fn current_git_branch(cwd: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!branch.is_empty()).then_some(branch)
}

fn codex_acp_args() -> Vec<String> {
    CODEX_ACP_ARGS
        .iter()
        .map(|arg| (*arg).to_string())
        .collect()
}

fn codex_acp_launch() -> Result<CodexAcpLaunch, String> {
    let args = codex_acp_args();
    if let Some(override_path) = std::env::var("RUDU_CODEX_ACP_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let command = PathBuf::from(override_path);
        if !command.is_absolute() {
            return Err("RUDU_CODEX_ACP_PATH must be an absolute path".into());
        }
        if !command.is_file() {
            return Err(format!(
                "RUDU_CODEX_ACP_PATH does not point to a file: {}",
                command.display()
            ));
        }
        return Ok(CodexAcpLaunch { command, args });
    }

    for command in codex_acp_sidecar_candidates() {
        if command.is_file() {
            return Ok(CodexAcpLaunch { command, args });
        }
    }

    Err(format!(
        "Codex ACP sidecar is missing. Run `bun run prepare:codex-acp-sidecar` and restart Rudu. Expected generated sidecar: {}",
        generated_codex_acp_sidecar_path().display()
    ))
}

fn codex_acp_sidecar_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(sidecar_runtime_file_name()));
        }
    }
    candidates.push(generated_codex_acp_sidecar_path());
    candidates
}

fn generated_codex_acp_sidecar_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(sidecar_generated_file_name())
}

fn sidecar_runtime_file_name() -> &'static str {
    if cfg!(windows) {
        "codex-acp.exe"
    } else {
        CODEX_ACP_SIDECAR_NAME
    }
}

fn sidecar_generated_file_name() -> String {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    format!("codex-acp-{}{}", current_target_triple(), extension)
}

fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64", target_env = "gnu"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64", target_env = "gnu"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64", target_env = "musl"))]
    {
        "aarch64-unknown-linux-musl"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64", target_env = "musl"))]
    {
        "x86_64-unknown-linux-musl"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "aarch64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(
            target_os = "linux",
            target_arch = "aarch64",
            any(target_env = "gnu", target_env = "musl")
        ),
        all(
            target_os = "linux",
            target_arch = "x86_64",
            any(target_env = "gnu", target_env = "musl")
        ),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    {
        "unsupported-target"
    }
}

fn describe_codex_launch(launch: &CodexAcpLaunch) -> String {
    format!(
        "{} {}",
        launch.command.display(),
        launch
            .args
            .iter()
            .map(|arg| format!("{arg:?}"))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn workspace_root() -> Result<PathBuf, String> {
    if let Some(workspace_cwd) = std::env::var("RUDU_WORKSPACE_CWD")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(workspace_cwd);
        if !path.is_absolute() {
            return Err("RUDU_WORKSPACE_CWD must be an absolute path".into());
        }
        if !path.is_dir() {
            return Err(format!(
                "RUDU_WORKSPACE_CWD does not point to a directory: {}",
                path.display()
            ));
        }
        return Ok(path);
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Failed to resolve workspace root from CARGO_MANIFEST_DIR".to_string())
}

fn build_analysis_only_prompt(text: &str, context: Option<&CodexSessionContext>) -> String {
    let mut prompt = String::from(
        "You are running inside Rudu's analysis-only Codex chat.\n\
         Do not edit, create, delete, move, format, or otherwise mutate files.\n\
         Do not run commands that write repo-tracked files.\n\
         If the user asks for changes, provide analysis, recommendations, or a patch plan only.\n\n",
    );

    if let Some(context) = context {
        prompt.push_str("Selected PR context:\n");
        if let Some(repo) = context.repo.as_deref() {
            prompt.push_str(&format!("- Repo: {repo}\n"));
        }
        if let Some(number) = context.pull_request_number {
            prompt.push_str(&format!("- PR: #{number}\n"));
        }
        if let Some(title) = context.pull_request_title.as_deref() {
            prompt.push_str(&format!("- Title: {title}\n"));
        }
        if let Some(url) = context.pull_request_url.as_deref() {
            prompt.push_str(&format!("- URL: {url}\n"));
        }
        if let Some(head_sha) = context.head_sha.as_deref() {
            prompt.push_str(&format!("- Head SHA: {head_sha}\n"));
        }
        if let Some(selected_pr_key) = context.selected_pr_key.as_deref() {
            prompt.push_str(&format!("- Selected PR key: {selected_pr_key}\n"));
        }
        if let Some(selected_diff_key) = context.selected_diff_key.as_deref() {
            prompt.push_str(&format!("- Selected diff key: {selected_diff_key}\n"));
        }
        prompt.push('\n');
    }

    prompt.push_str("User prompt:\n");
    prompt.push_str(text);
    prompt
}

#[tauri::command]
pub async fn codex_acp_start_session(
    app: AppHandle,
    context: Option<CodexSessionContext>,
) -> Result<CodexStartSessionResponse, String> {
    let slot = worker_slot();
    {
        let guard = slot
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        if let Some(handle) = guard.as_ref() {
            if handle.is_stopping {
                return Err("Codex session is stopping; wait for it to finish".into());
            }
            return Ok(CodexStartSessionResponse {
                local_session_id: handle.local_session_id.clone(),
            });
        }
    }

    let cwd = workspace_root()?;
    let local_session_id = make_id("codex-local-session");
    initialize_session_transcript(&cwd, &local_session_id, context.as_ref());
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = CodexWorkerHandle {
        local_session_id: local_session_id.clone(),
        cwd: cwd.clone(),
        context: context.clone(),
        is_stopping: false,
        tx,
    };

    {
        let mut guard = slot
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        *guard = Some(handle);
    }

    tauri::async_runtime::spawn(run_codex_worker(app, local_session_id.clone(), cwd, rx));

    Ok(CodexStartSessionResponse { local_session_id })
}

#[tauri::command]
pub async fn codex_acp_send_prompt(
    text: String,
    context: Option<CodexSessionContext>,
) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Prompt is required".into());
    }

    let prompt_id = make_id("codex-prompt");
    let (tx, local_session_id, cwd, session_context) = {
        let guard = worker_slot()
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        let handle = guard
            .as_ref()
            .ok_or_else(|| "Codex session has not been started".to_string())?;
        if handle.is_stopping {
            return Err("Codex session is stopping".to_string());
        }
        (
            handle.tx.clone(),
            handle.local_session_id.clone(),
            handle.cwd.clone(),
            context.clone().or_else(|| handle.context.clone()),
        )
    };

    append_transcript_record(
        &cwd,
        &local_session_id,
        json!({
            "schemaVersion": 1,
            "type": "user_prompt",
            "timestampUnixMs": now_unix_millis(),
            "localSessionId": local_session_id.clone(),
            "promptId": prompt_id.clone(),
            "context": session_context.clone(),
            "analysisOnly": true,
            "text": text.clone(),
        }),
    );
    let branch = current_git_branch(&cwd);
    write_current_context(
        &cwd,
        &local_session_id,
        session_context.as_ref(),
        branch.as_deref(),
    );

    tx.send(CodexWorkerCommand::Prompt {
        prompt_id: prompt_id.clone(),
        text: build_analysis_only_prompt(&text, session_context.as_ref()),
        context,
    })
    .map_err(|_| "Codex worker is not running".to_string())?;

    Ok(prompt_id)
}

#[tauri::command]
pub async fn codex_acp_stop_session() -> Result<(), String> {
    let tx = {
        let mut guard = worker_slot()
            .lock()
            .map_err(|_| "Codex worker lock failed".to_string())?;
        let Some(handle) = guard.as_mut() else {
            return Ok(());
        };
        if handle.is_stopping {
            return Ok(());
        }
        handle.is_stopping = true;
        handle.tx.clone()
    };

    let _ = tx.send(CodexWorkerCommand::Stop);

    Ok(())
}

#[tauri::command]
pub async fn codex_acp_respond_permission(
    permission_request_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let permission_request_id = permission_request_id.trim();
    if permission_request_id.is_empty() {
        return Err("Permission request id is required".into());
    }

    let _ = option_id;
    Err("Codex permissions are disabled because this chat is analysis-only".into())
}

async fn run_codex_worker(
    app: AppHandle,
    local_session_id: String,
    cwd: PathBuf,
    mut rx: mpsc::UnboundedReceiver<CodexWorkerCommand>,
) {
    let launch = match codex_acp_launch() {
        Ok(launch) => launch,
        Err(error) => {
            emit_worker_error(&app, &cwd, &local_session_id, error);
            clear_worker(&local_session_id);
            return;
        }
    };

    emit_worker_event(
        &app,
        &cwd,
        CodexAcpEvent {
            kind: "starting".into(),
            local_session_id: local_session_id.clone(),
            prompt_id: None,
            permission_request_id: None,
            message: Some(format!("Starting `{}`", describe_codex_launch(&launch))),
            raw: None,
        },
    );

    let agent = AcpAgent::new(McpServer::Stdio(
        McpServerStdio::new(CODEX_ACP_SIDECAR_NAME, launch.command.clone()).args(launch.args),
    ));

    let notification_app = app.clone();
    let notification_session_id = local_session_id.clone();
    let notification_cwd = cwd.clone();
    let permission_app = app.clone();
    let permission_session_id = local_session_id.clone();
    let permission_cwd = cwd.clone();
    let worker_app = app.clone();
    let worker_session_id = local_session_id.clone();
    let worker_cwd = cwd.clone();

    let result = agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                let raw = serde_json::to_value(&notification).ok();
                emit_worker_event(
                    &notification_app,
                    &notification_cwd,
                    CodexAcpEvent {
                        kind: "sessionUpdate".into(),
                        local_session_id: notification_session_id.clone(),
                        prompt_id: None,
                        permission_request_id: None,
                        message: extract_notification_text(raw.as_ref()),
                        raw,
                    },
                );
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                let permission_request_id = make_id("codex-permission");
                let raw = serde_json::to_value(&request).ok();
                emit_worker_event(
                    &permission_app,
                    &permission_cwd,
                    CodexAcpEvent {
                        kind: "permissionRequested".into(),
                        local_session_id: permission_session_id.clone(),
                        prompt_id: None,
                        permission_request_id: Some(permission_request_id.clone()),
                        message: Some(
                            "Codex requested permission, but this chat is analysis-only so the request was denied.".into(),
                        ),
                        raw,
                    },
                );
                append_transcript_record(
                    &permission_cwd,
                    &permission_session_id,
                    json!({
                        "schemaVersion": 1,
                        "type": "permission_response",
                        "timestampUnixMs": now_unix_millis(),
                        "localSessionId": permission_session_id.clone(),
                        "permissionRequestId": permission_request_id,
                        "outcome": "cancelled",
                        "reason": "analysis_only",
                    }),
                );

                responder.respond(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            emit_worker_event(
                &worker_app,
                &worker_cwd,
                CodexAcpEvent {
                    kind: "initializing".into(),
                    local_session_id: worker_session_id.clone(),
                    prompt_id: None,
                    permission_request_id: None,
                    message: None,
                    raw: None,
                },
            );

            let init_response = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            emit_worker_event(
                &worker_app,
                &worker_cwd,
                CodexAcpEvent {
                    kind: "initialized".into(),
                    local_session_id: worker_session_id.clone(),
                    prompt_id: None,
                    permission_request_id: None,
                    message: Some(format!("{:?}", init_response.agent_info)),
                    raw: serde_json::to_value(&init_response).ok(),
                },
            );

            let new_session_response = connection
                .send_request(NewSessionRequest::new(worker_cwd.clone()))
                .block_task()
                .await?;
            let session_id = new_session_response.session_id.clone();

            emit_worker_event(
                &worker_app,
                &worker_cwd,
                CodexAcpEvent {
                    kind: "sessionStarted".into(),
                    local_session_id: worker_session_id.clone(),
                    prompt_id: None,
                    permission_request_id: None,
                    message: Some(format!("{:?}", session_id)),
                    raw: serde_json::to_value(&new_session_response).ok(),
                },
            );

            while let Some(command) = rx.recv().await {
                match command {
                    CodexWorkerCommand::Prompt {
                        prompt_id,
                        text,
                        context,
                    } => {
                        append_transcript_record(
                            &worker_cwd,
                            &worker_session_id,
                            json!({
                                "schemaVersion": 1,
                                "type": "prompt_dispatch",
                                "timestampUnixMs": now_unix_millis(),
                                "localSessionId": worker_session_id.clone(),
                                "promptId": prompt_id.clone(),
                                "context": context,
                            }),
                        );

                        emit_worker_event(
                            &worker_app,
                            &worker_cwd,
                            CodexAcpEvent {
                                kind: "promptStarted".into(),
                                local_session_id: worker_session_id.clone(),
                                prompt_id: Some(prompt_id.clone()),
                                permission_request_id: None,
                                message: None,
                                raw: None,
                            },
                        );

                        let prompt_result = timeout(
                            Duration::from_secs(PROMPT_TIMEOUT_SECS),
                            connection
                                .send_request(PromptRequest::new(
                                    session_id.clone(),
                                    vec![ContentBlock::Text(TextContent::new(text))],
                                ))
                                .block_task(),
                        )
                        .await;

                        match prompt_result {
                            Ok(Ok(response)) => emit_worker_event(
                                &worker_app,
                                &worker_cwd,
                                CodexAcpEvent {
                                    kind: "promptDone".into(),
                                    local_session_id: worker_session_id.clone(),
                                    prompt_id: Some(prompt_id),
                                    permission_request_id: None,
                                    message: Some(format!("{:?}", response.stop_reason)),
                                    raw: serde_json::to_value(&response).ok(),
                                },
                            ),
                            Ok(Err(error)) => emit_worker_event(
                                &worker_app,
                                &worker_cwd,
                                CodexAcpEvent {
                                    kind: "error".into(),
                                    local_session_id: worker_session_id.clone(),
                                    prompt_id: Some(prompt_id),
                                    permission_request_id: None,
                                    message: Some(error.to_string()),
                                    raw: None,
                                },
                            ),
                            Err(_) => emit_worker_event(
                                &worker_app,
                                &worker_cwd,
                                CodexAcpEvent {
                                    kind: "error".into(),
                                    local_session_id: worker_session_id.clone(),
                                    prompt_id: Some(prompt_id),
                                    permission_request_id: None,
                                    message: Some(format!(
                                        "Codex ACP prompt timed out after {PROMPT_TIMEOUT_SECS}s"
                                    )),
                                    raw: None,
                                },
                            ),
                        }
                    }
                    CodexWorkerCommand::Stop => break,
                }
            }

            Ok(())
        })
        .await;

    if let Err(error) = result {
        emit_worker_error(&app, &cwd, &local_session_id, error.to_string());
    }

    clear_worker(&local_session_id);
    emit_worker_event(
        &app,
        &cwd,
        CodexAcpEvent {
            kind: "stopped".into(),
            local_session_id,
            prompt_id: None,
            permission_request_id: None,
            message: None,
            raw: None,
        },
    );
}

fn emit_worker_error(app: &AppHandle, cwd: &Path, local_session_id: &str, message: String) {
    emit_worker_event(
        app,
        cwd,
        CodexAcpEvent {
            kind: "error".into(),
            local_session_id: local_session_id.to_string(),
            prompt_id: None,
            permission_request_id: None,
            message: Some(message),
            raw: None,
        },
    );
}

fn clear_worker(local_session_id: &str) {
    if let Ok(mut guard) = worker_slot().lock() {
        if guard
            .as_ref()
            .map(|handle| handle.local_session_id == local_session_id)
            .unwrap_or(false)
        {
            *guard = None;
        }
    }
}

fn extract_notification_text(raw: Option<&serde_json::Value>) -> Option<String> {
    let value = raw?;
    find_text_value(value).filter(|text| !text.trim().is_empty())
}

fn find_text_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|value| value.as_str()) {
                return Some(text.to_string());
            }
            if let Some(content) = map.get("content") {
                if let Some(text) = find_text_value(content) {
                    return Some(text);
                }
            }
            for value in map.values() {
                if let Some(text) = find_text_value(value) {
                    return Some(text);
                }
            }
            None
        }
        serde_json::Value::Array(items) => items.iter().find_map(find_text_value),
        _ => None,
    }
}
