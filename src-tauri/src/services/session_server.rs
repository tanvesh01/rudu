//! Loopback HTTP server that lets the `rudu session *` CLI drive the running app.
//!
//! ponytail: hand-rolled HTTP/1.1 over std::net — one endpoint, JSON bodies only.
//! Swap for a real HTTP crate if routing or keep-alive ever grows.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::cache::{
    find_local_checkout, read_local_checkouts, read_review_notes, save_review_note,
};
use crate::models::ReviewNote;
use crate::services::local_checkout::{
    inspect_checkout, load_working_tree_diff, load_working_tree_status,
};
use crate::support::{hash_text, now_unix_timestamp};

const MAX_REQUEST_BYTES: u64 = 256 * 1024;
pub const REVIEW_NOTES_CHANGED_EVENT: &str = "rudu://review-notes-changed";
pub const NAVIGATE_EVENT: &str = "rudu://session-navigate";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NavigatePayload {
    pub checkout_id: String,
    pub file: String,
    pub line: u32,
    pub side: String,
}

pub fn start_session_server(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Could not bind the Rudu session server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the Rudu session server port: {error}"))?
        .port();

    let port_path = app
        .path()
        .resolve("session.port", tauri::path::BaseDirectory::AppData)
        .map_err(|error| format!("Could not resolve the session port file path: {error}"))?;
    std::fs::write(&port_path, port.to_string())
        .map_err(|error| format!("Could not write {}: {error}", port_path.display()))?;

    std::thread::Builder::new()
        .name("rudu-session-server".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let app = app.clone();
                std::thread::spawn(move || handle_connection(stream, app));
            }
        })
        .map_err(|error| format!("Could not spawn the Rudu session server: {error}"))?;
    Ok(())
}

/// CLI-side entry: read the port file and POST one action. Used by `rudu session *`.
pub fn call_session_server(request: &Value) -> Result<String, String> {
    let port_path = session_port_path()?;
    let port = std::fs::read_to_string(&port_path)
        .map_err(|_| "Rudu is not running. Open it first with: rudu <path>".to_string())?;
    let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port.trim()))
        .map_err(|_| "Rudu is not running. Open it first with: rudu <path>".to_string())?;
    let body = serde_json::to_vec(request).map_err(|error| error.to_string())?;
    write!(
        stream,
        "POST /session HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .and_then(|()| stream.write_all(&body))
    .map_err(|error| format!("Could not reach the Rudu session server: {error}"))?;

    let mut response = Vec::new();
    stream
        .take(MAX_REQUEST_BYTES)
        .read_to_end(&mut response)
        .map_err(|error| format!("Could not read the Rudu session response: {error}"))?;
    let text = String::from_utf8_lossy(&response);
    let body = text
        .split("\r\n\r\n")
        .nth(1)
        .ok_or_else(|| "Malformed response from the Rudu session server.".to_string())?;
    Ok(body.to_string())
}

fn session_port_path() -> Result<PathBuf, String> {
    // ponytail: mirrors Tauri's macOS AppData layout (~/Library/Application Support/<identifier>)
    // so the CLI can find the file without booting Tauri. Linux/Windows CLI falls later.
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve the home directory.".to_string())?;
    Ok(home.join("Library/Application Support/com.tanvesh.rudu/session.port"))
}

fn handle_connection(stream: TcpStream, app: AppHandle) {
    let mut reader = BufReader::new(stream);
    let mut content_length = 0_u64;
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() || header == "\r\n" {
            break;
        }
        if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
    }
    if content_length == 0 || content_length > MAX_REQUEST_BYTES {
        write_response(&mut reader, 400, json!({"error": "expected a JSON body"}));
        return;
    }
    let mut body = vec![0_u8; content_length as usize];
    if reader.read_exact(&mut body).is_err() {
        write_response(&mut reader, 400, json!({"error": "truncated body"}));
        return;
    }
    let Ok(request) = serde_json::from_slice::<Value>(&body) else {
        write_response(&mut reader, 400, json!({"error": "body must be JSON"}));
        return;
    };

    let (status, payload) = dispatch(&request, &app);
    write_response(&mut reader, status, payload);
}

fn write_response(reader: &mut BufReader<TcpStream>, status: u16, payload: Value) {
    let body = serde_json::to_vec(&payload).unwrap_or_else(|_| b"{}".to_vec());
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let _ = reader.get_mut().write_all(
        format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .as_bytes(),
    );
    let _ = reader.get_mut().write_all(&body);
}

fn dispatch(request: &Value, app: &AppHandle) -> (u16, Value) {
    match request.get("action").and_then(Value::as_str) {
        Some("list") => (200, session_list()),
        Some("review") => session_review(request),
        Some("navigate") => session_navigate(request, app),
        Some("comment-add") => session_comment_add(request, app),
        Some("comment-list") => session_comment_list(request),
        _ => (
            400,
            json!({"error": "unknown action; expected list, review, navigate, comment-add, or comment-list"}),
        ),
    }
}

fn session_list() -> Value {
    let checkouts = read_local_checkouts().unwrap_or_default();
    json!({
        "sessions": checkouts
            .iter()
            .map(|checkout| json!({
                "sessionId": checkout.id,
                "repo": checkout.path,
                "branch": checkout.branch,
                "kind": "local_checkout",
            }))
            .collect::<Vec<_>>()
    })
}

/// Resolve `--repo <path>` (any dir inside a checkout) or fall back to the single open session.
fn resolve_checkout(request: &Value) -> Result<crate::models::LocalCheckout, (u16, Value)> {
    let checkouts = read_local_checkouts().map_err(|error| (500, json!({"error": error})))?;
    if let Some(repo) = request.get("repo").and_then(Value::as_str) {
        let inspection =
            inspect_checkout(Path::new(repo)).map_err(|error| (404, json!({"error": error})))?;
        return checkouts
            .into_iter()
            .find(|checkout| checkout.path == inspection.root_path)
            .ok_or_else(|| {
                (404, json!({"error": format!("no session matches repo {}; open it with: rudu {}", inspection.root_path, inspection.root_path)}))
            });
    }
    match checkouts.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err((
            404,
            json!({"error": "no sessions are open; run: rudu <path>"}),
        )),
        _ => Err((
            400,
            json!({"error": "multiple sessions are open; pass --repo <path>"}),
        )),
    }
}

fn session_review(request: &Value) -> (u16, Value) {
    let checkout = match resolve_checkout(request) {
        Ok(checkout) => checkout,
        Err(error) => return error,
    };
    let include_patch = request
        .get("includePatch")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let root = Path::new(&checkout.path);
    let result = if include_patch {
        load_working_tree_diff(root).map(|diff| {
            json!({
                "checkoutId": checkout.id,
                "branch": diff.branch,
                "headSha": diff.head_sha,
                "files": diff.changes,
                "patch": diff.patch,
            })
        })
    } else {
        load_working_tree_status(root).map(|status| {
            json!({
                "checkoutId": checkout.id,
                "branch": status.branch,
                "headSha": status.head_sha,
                "files": status.changes,
            })
        })
    };
    match result {
        Ok(payload) => (200, payload),
        Err(error) => (500, json!({"error": error})),
    }
}

fn required_str<'a>(request: &'a Value, key: &str) -> Result<&'a str, (u16, Value)> {
    request
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            (
                400,
                json!({"error": format!("missing required field {key}")}),
            )
        })
}

fn requested_diff_line(request: &Value) -> Result<(u32, &'static str), (u16, Value)> {
    let new_line = request
        .get("newLine")
        .and_then(Value::as_u64)
        .filter(|line| *line > 0);
    let old_line = request
        .get("oldLine")
        .and_then(Value::as_u64)
        .filter(|line| *line > 0);
    match (new_line, old_line) {
        (Some(line), None) => Ok((line as u32, "additions")),
        (None, Some(line)) => Ok((line as u32, "deletions")),
        _ => Err((
            400,
            json!({"error": "provide exactly one of newLine or oldLine (1-based)"}),
        )),
    }
}

fn session_navigate(request: &Value, app: &AppHandle) -> (u16, Value) {
    let parsed = (|| {
        let checkout = resolve_checkout(request)?;
        let file = required_str(request, "file")?;
        let (line, side) = requested_diff_line(request)?;
        Ok((checkout, file.to_string(), line, side))
    })();
    let (checkout, file, line, side) = match parsed {
        Ok(value) => value,
        Err(error) => return error,
    };
    let payload = NavigatePayload {
        checkout_id: checkout.id,
        file,
        line,
        side: side.to_string(),
    };
    match app.emit(NAVIGATE_EVENT, payload) {
        Ok(()) => (200, json!({"ok": true})),
        Err(error) => (500, json!({"error": error.to_string()})),
    }
}

fn session_comment_add(request: &Value, app: &AppHandle) -> (u16, Value) {
    let parsed = (|| {
        let checkout = resolve_checkout(request)?;
        let file = required_str(request, "file")?;
        let body = required_str(request, "body")?;
        let (line, side) = requested_diff_line(request)?;
        Ok(ReviewNote {
            id: hash_text(&format!(
                "{}:{}:{}:{}:{}",
                checkout.id,
                file,
                side,
                line,
                now_unix_timestamp()
            )),
            checkout_id: checkout.id,
            file_path: file.to_string(),
            line,
            side: side.to_string(),
            start_line: None,
            start_side: None,
            body: body.to_string(),
            author: "agent".to_string(),
            created_at: now_unix_timestamp(),
        })
    })();
    let note = match parsed {
        Ok(note) => note,
        Err(error) => return error,
    };

    let checkout_path = find_local_checkout(&note.checkout_id)
        .ok()
        .flatten()
        .map(|checkout| checkout.path);
    if let Some(checkout_path) = checkout_path {
        if let Ok(status) = load_working_tree_status(Path::new(&checkout_path)) {
            if !status
                .changes
                .iter()
                .any(|change| change.path == note.file_path)
            {
                return (
                    400,
                    json!({"error": format!("file not in the working-tree diff: {}", note.file_path)}),
                );
            }
        }
    }

    if let Err(error) = save_review_note(&note) {
        return (500, json!({"error": error}));
    }
    let _ = app.emit(
        REVIEW_NOTES_CHANGED_EVENT,
        json!({"checkoutId": note.checkout_id.clone()}),
    );
    (200, json!({"note": note}))
}

fn session_comment_list(request: &Value) -> (u16, Value) {
    let checkout = match resolve_checkout(request) {
        Ok(checkout) => checkout,
        Err(error) => return error,
    };
    let author = request
        .get("type")
        .and_then(Value::as_str)
        .filter(|value| *value == "user" || *value == "agent");
    match read_review_notes(&checkout.id, author) {
        Ok(notes) => {
            let file_filter = request.get("file").and_then(Value::as_str);
            let notes = notes
                .into_iter()
                .filter(|note| {
                    file_filter.is_none() || Some(note.file_path.as_str()) == file_filter
                })
                .collect::<Vec<_>>();
            (200, json!({"notes": notes}))
        }
        Err(error) => (500, json!({"error": error})),
    }
}

#[cfg(test)]
mod tests {
    use super::requested_diff_line;

    #[test]
    fn reads_addition_and_deletion_locations() {
        assert_eq!(
            requested_diff_line(&serde_json::json!({"newLine": 4})).unwrap(),
            (4, "additions")
        );
        assert_eq!(
            requested_diff_line(&serde_json::json!({"oldLine": 11})).unwrap(),
            (11, "deletions")
        );
    }

    #[test]
    fn rejects_missing_or_ambiguous_locations() {
        assert!(requested_diff_line(&serde_json::json!({})).is_err());
        assert!(requested_diff_line(&serde_json::json!({"newLine": 1, "oldLine": 1})).is_err());
    }
}
