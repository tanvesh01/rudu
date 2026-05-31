use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use agent_client_protocol_tokio::LineDirection;
use serde_json::Value;

pub(super) fn review_chat_debug_log_path(repo_dir: &Path) -> Option<PathBuf> {
    repo_dir
        .parent()
        .map(|workspace_dir| workspace_dir.join(".rudu").join("review-chat-acp.log"))
}

pub(super) fn log_review_chat_debug(path: Option<&Path>, message: impl AsRef<str>) {
    let Some(path) = path else {
        return;
    };

    let _guard = debug_log_lock().lock().ok();

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{timestamp_ms} {}", message.as_ref());
    }
}

pub(super) fn log_acp_transport_line(path: Option<&Path>, direction: LineDirection, line: &str) {
    let direction = line_direction_label(direction);
    let summary = summarize_acp_json_line(line)
        .unwrap_or_else(|| format!("non_json bytes={}", line.as_bytes().len()));
    log_review_chat_debug(path, format!("acp transport {direction} {summary}"));
}

fn debug_log_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn line_direction_label(direction: LineDirection) -> &'static str {
    match direction {
        LineDirection::Stdin => "stdin",
        LineDirection::Stdout => "stdout",
        LineDirection::Stderr => "stderr",
    }
}

fn summarize_acp_json_line(line: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    let id = value
        .get("id")
        .map(json_id_label)
        .unwrap_or_else(|| "none".to_string());

    if let Some(method) = value.get("method").and_then(Value::as_str) {
        let mut summary = format!("method={method} id={id}");
        if method == "session/update" {
            if let Some(update_summary) = value.get("params").and_then(summarize_session_update) {
                summary.push(' ');
                summary.push_str(&update_summary);
            }
        }
        if method == "session/request_permission" {
            if let Some(options_count) = value
                .get("params")
                .and_then(|params| params.get("options"))
                .and_then(Value::as_array)
                .map(Vec::len)
            {
                summary.push_str(&format!(" permission_options={options_count}"));
            }
        }
        return Some(summary);
    }

    if let Some(result) = value.get("result") {
        return Some(format!("response id={id} {}", summarize_result(result)));
    }

    if let Some(error) = value.get("error") {
        return Some(format!("error id={id} {}", summarize_error(error)));
    }

    Some(format!("json id={id} keys={}", object_keys(&value)))
}

fn summarize_session_update(params: &Value) -> Option<String> {
    let update = params.get("update")?;
    let update_kind = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let session_id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .map(|value| format!(" session_id={}", stable_id_label(value)))
        .unwrap_or_default();

    let detail = match update_kind {
        "agent_message_chunk" | "agent_thought_chunk" => text_len(update)
            .map(|len| format!(" text_len={len}"))
            .unwrap_or_default(),
        "tool_call" => format!(
            " tool_call_id={} title_present={} raw_input_present={}",
            update
                .get("toolCallId")
                .and_then(Value::as_str)
                .map(stable_id_label)
                .unwrap_or_else(|| "none".to_string()),
            update
                .get("title")
                .and_then(Value::as_str)
                .map(|title| !title.trim().is_empty())
                .unwrap_or(false),
            update.get("rawInput").is_some()
        ),
        "tool_call_update" => format!(
            " tool_call_id={} status={} raw_output_present={}",
            update
                .get("toolCallId")
                .and_then(Value::as_str)
                .map(stable_id_label)
                .unwrap_or_else(|| "none".to_string()),
            update
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            update.get("rawOutput").is_some()
        ),
        "plan" => format!(
            " entries={}",
            update
                .get("entries")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        ),
        _ => format!(" keys={}", object_keys(update)),
    };

    Some(format!("session_update={update_kind}{session_id}{detail}"))
}

fn summarize_result(result: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(stop_reason) = result
        .get("stopReason")
        .or_else(|| result.get("stop_reason"))
        .and_then(Value::as_str)
    {
        parts.push(format!("stop_reason={stop_reason}"));
    }
    if let Some(session_id) = result.get("sessionId").and_then(Value::as_str) {
        parts.push(format!("session_id={}", stable_id_label(session_id)));
    }
    parts.push(format!("keys={}", object_keys(result)));
    parts.join(" ")
}

fn summarize_error(error: &Value) -> String {
    let code = error
        .get("code")
        .map(json_id_label)
        .unwrap_or_else(|| "unknown".to_string());
    let message_len = error
        .get("message")
        .and_then(Value::as_str)
        .map(str::len)
        .unwrap_or(0);
    format!("code={code} message_len={message_len}")
}

fn text_len(update: &Value) -> Option<usize> {
    update
        .get("content")
        .and_then(|content| content.get("text"))
        .or_else(|| update.get("text"))
        .and_then(Value::as_str)
        .map(str::len)
}

fn object_keys(value: &Value) -> String {
    value
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>().join(","))
        .filter(|keys| !keys.is_empty())
        .unwrap_or_else(|| "none".to_string())
}

fn json_id_label(value: &Value) -> String {
    if let Some(value) = value.as_i64() {
        return value.to_string();
    }
    if let Some(value) = value.as_u64() {
        return value.to_string();
    }
    if let Some(value) = value.as_str() {
        return stable_id_label(value);
    }
    "unknown".to_string()
}

fn stable_id_label(value: &str) -> String {
    let trimmed = value.trim();
    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() <= 16 {
        return trimmed.to_string();
    }
    let prefix = chars.iter().take(8).collect::<String>();
    let suffix = chars
        .iter()
        .skip(chars.len().saturating_sub(6))
        .collect::<String>();
    format!("{prefix}...{suffix}")
}
