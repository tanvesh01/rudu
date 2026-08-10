//! Loopback HTTP server that lets the `rudu session *` CLI drive the running app.
//!
//! ponytail: hand-rolled HTTP/1.1 over std::net — one endpoint, JSON bodies only.
//! Swap for a real HTTP crate if routing or keep-alive ever grows.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::cache::{
    delete_all_review_notes, delete_selected_review_notes, find_local_checkout,
    read_local_checkouts, read_review_notes, save_review_note,
};
use crate::models::{ReviewNote, WORKING_TREE_REVIEW_SCOPE};
use crate::services::local_checkout::{
    inspect_checkout, load_working_tree_diff, load_working_tree_status,
};
use crate::support::{now_unix_timestamp, unique_hash};

const MAX_REQUEST_BYTES: u64 = 256 * 1024;
const NAVIGATION_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_NAVIGATION_ID: AtomicU64 = AtomicU64::new(1);
pub const NAVIGATE_EVENT: &str = "rudu://session-navigate";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigatePayload {
    pub request_id: u64,
    pub checkout_id: String,
    pub file: String,
    pub line: u32,
    pub side: String,
}

#[derive(Default)]
struct SessionNavigationState {
    queue: VecDeque<NavigatePayload>,
    completions: HashMap<u64, SyncSender<()>>,
}

#[derive(Default)]
pub struct SessionNavigationQueue(Mutex<SessionNavigationState>);

impl SessionNavigationQueue {
    fn push(&self, payload: NavigatePayload, completion: SyncSender<()>) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Session navigation queue is unavailable.".to_string())?;
        state.completions.insert(payload.request_id, completion);
        state.queue.push_back(payload);
        Ok(())
    }

    pub fn take(&self) -> Option<NavigatePayload> {
        self.0.lock().ok()?.queue.pop_front()
    }

    pub fn complete(&self, request_id: u64) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Session navigation queue is unavailable.".to_string())?
            .completions
            .remove(&request_id)
            .ok_or_else(|| "Session navigation request is no longer pending.".to_string())?
            .send(())
            .map_err(|_| "Session navigation request timed out.".to_string())
    }

    fn cancel(&self, request_id: u64) {
        if let Ok(mut state) = self.0.lock() {
            state
                .queue
                .retain(|payload| payload.request_id != request_id);
            state.completions.remove(&request_id);
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub action: SessionAction,
    pub repo: Option<String>,
    pub file: Option<String>,
    pub new_line: Option<u32>,
    pub old_line: Option<u32>,
    pub body: Option<String>,
    pub note: Option<String>,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub include_patch: bool,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SessionAction {
    List,
    Review,
    Navigate,
    CommentAdd,
    CommentReply,
    CommentDelete,
    CommentList,
}

#[derive(Debug, PartialEq, Eq)]
enum ReviewNoteDeletion {
    All,
    Selected(Vec<String>),
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
    if let Some(parent) = port_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
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
pub fn call_session_server(request: &SessionRequest) -> Result<String, String> {
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
        .read_to_end(&mut response)
        .map_err(|error| format!("Could not read the Rudu session response: {error}"))?;
    parse_session_response(&response)
}

fn parse_session_response(response: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(response)
        .map_err(|_| "Malformed response from the Rudu session server.".to_string())?;
    let (headers, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Malformed response from the Rudu session server.".to_string())?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "Malformed response from the Rudu session server.".to_string())?;
    if (200..300).contains(&status) {
        Ok(body.to_string())
    } else {
        Err(body.to_string())
    }
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
    let Ok(request) = serde_json::from_slice::<SessionRequest>(&body) else {
        write_response(
            &mut reader,
            400,
            json!({"error": "body must be a valid session request"}),
        );
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
        504 => "Gateway Timeout",
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

fn dispatch(request: &SessionRequest, app: &AppHandle) -> (u16, Value) {
    match request.action {
        SessionAction::List => session_list(),
        SessionAction::Review => session_review(request),
        SessionAction::Navigate => session_navigate(request, app),
        SessionAction::CommentAdd => session_comment_add(request),
        SessionAction::CommentReply => session_comment_reply(request),
        SessionAction::CommentDelete => session_comment_delete(request),
        SessionAction::CommentList => session_comment_list(request),
    }
}

fn session_list() -> (u16, Value) {
    match read_local_checkouts() {
        Ok(checkouts) => (
            200,
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
            }),
        ),
        Err(error) => (500, json!({"error": error})),
    }
}

/// Resolve `--repo <path>` (any dir inside a checkout) or fall back to the single open session.
fn resolve_checkout(repo: Option<&str>) -> Result<crate::models::LocalCheckout, (u16, Value)> {
    let checkouts = read_local_checkouts().map_err(|error| (500, json!({"error": error})))?;
    if let Some(repo) = repo {
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

fn session_review(request: &SessionRequest) -> (u16, Value) {
    let checkout = match resolve_checkout(request.repo.as_deref()) {
        Ok(checkout) => checkout,
        Err(error) => return error,
    };
    let root = Path::new(&checkout.path);
    let result = if request.include_patch {
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

fn required_str<'a>(value: Option<&'a str>, key: &str) -> Result<&'a str, (u16, Value)> {
    value.filter(|value| !value.is_empty()).ok_or_else(|| {
        (
            400,
            json!({"error": format!("missing required field {key}")}),
        )
    })
}

fn requested_diff_line(
    new_line: Option<u32>,
    old_line: Option<u32>,
) -> Result<(u32, &'static str), (u16, Value)> {
    match (
        new_line.filter(|line| *line > 0),
        old_line.filter(|line| *line > 0),
    ) {
        (Some(line), None) => Ok((line, "additions")),
        (None, Some(line)) => Ok((line, "deletions")),
        _ => Err((
            400,
            json!({"error": "provide exactly one of newLine or oldLine (1-based)"}),
        )),
    }
}

fn session_navigate(request: &SessionRequest, app: &AppHandle) -> (u16, Value) {
    let parsed = (|| {
        let checkout = resolve_checkout(request.repo.as_deref())?;
        let file = required_str(request.file.as_deref(), "file")?;
        let (line, side) = requested_diff_line(request.new_line, request.old_line)?;
        Ok((checkout, file.to_string(), line, side))
    })();
    let (checkout, file, line, side) = match parsed {
        Ok(value) => value,
        Err(error) => return error,
    };
    let changed_files = match load_working_tree_status(Path::new(&checkout.path)) {
        Ok(status) => status.changes,
        Err(error) => return (500, json!({"error": error})),
    };
    if !changed_files.iter().any(|change| change.path == file) {
        return (
            400,
            json!({"error": format!("file not in the working-tree diff: {file}")}),
        );
    }

    let request_id = NEXT_NAVIGATION_ID.fetch_add(1, Ordering::Relaxed);
    let payload = NavigatePayload {
        request_id,
        checkout_id: checkout.id,
        file,
        line,
        side: side.to_string(),
    };
    let (completion, completed) = std::sync::mpsc::sync_channel(1);
    let queue = app.state::<SessionNavigationQueue>();
    if let Err(error) = queue.push(payload, completion) {
        return (500, json!({"error": error}));
    }
    if let Err(error) = app.emit(NAVIGATE_EVENT, ()) {
        queue.cancel(request_id);
        return (500, json!({"error": error.to_string()}));
    }
    match completed.recv_timeout(NAVIGATION_TIMEOUT) {
        Ok(()) => (200, json!({"ok": true})),
        Err(_) => {
            queue.cancel(request_id);
            (
                504,
                json!({"error": "the app did not finish navigation in time"}),
            )
        }
    }
}

fn session_comment_add(request: &SessionRequest) -> (u16, Value) {
    let parsed = (|| {
        let checkout = resolve_checkout(request.repo.as_deref())?;
        let file = required_str(request.file.as_deref(), "file")?;
        let body = required_str(request.body.as_deref(), "body")?;
        let (line, side) = requested_diff_line(request.new_line, request.old_line)?;
        Ok(ReviewNote {
            id: unique_hash(&format!(
                "{}:{}:{}:{}:{}",
                checkout.id, WORKING_TREE_REVIEW_SCOPE, file, side, line
            )),
            checkout_id: checkout.id,
            scope: WORKING_TREE_REVIEW_SCOPE.to_string(),
            file_path: file.to_string(),
            line,
            side: side.to_string(),
            start_line: None,
            start_side: None,
            reply_to_id: None,
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
    (200, json!({"note": note}))
}

fn session_comment_reply(request: &SessionRequest) -> (u16, Value) {
    let parsed = (|| {
        let checkout = resolve_checkout(request.repo.as_deref())?;
        let target_id = required_str(request.note.as_deref(), "note")?;
        let body = required_str(request.body.as_deref(), "body")?;
        let notes = read_review_notes(&checkout.id, WORKING_TREE_REVIEW_SCOPE, None)
            .map_err(|error| (500, json!({"error": error})))?;
        let target = notes
            .iter()
            .find(|note| note.id == target_id)
            .ok_or_else(|| {
                (
                    404,
                    json!({"error": format!("review note not found: {target_id}")}),
                )
            })?;
        let root_id = target
            .reply_to_id
            .clone()
            .unwrap_or_else(|| target.id.clone());
        Ok(ReviewNote {
            id: unique_hash(&format!("reply:{}", target.id)),
            checkout_id: checkout.id,
            scope: WORKING_TREE_REVIEW_SCOPE.to_string(),
            file_path: target.file_path.clone(),
            line: target.line,
            side: target.side.clone(),
            start_line: target.start_line,
            start_side: target.start_side.clone(),
            reply_to_id: Some(root_id),
            body: body.to_string(),
            author: "agent".to_string(),
            created_at: now_unix_timestamp(),
        })
    })();
    let note = match parsed {
        Ok(note) => note,
        Err(error) => return error,
    };
    if let Err(error) = save_review_note(&note) {
        return (500, json!({"error": error}));
    }
    (200, json!({"note": note}))
}

fn requested_note_deletion(
    note_ids: &[String],
    delete_all: bool,
) -> Result<ReviewNoteDeletion, (u16, Value)> {
    if note_ids.iter().any(String::is_empty) {
        return Err((
            400,
            json!({"error": "notes must contain non-empty note IDs"}),
        ));
    }
    match (note_ids.is_empty(), delete_all) {
        (true, true) => Ok(ReviewNoteDeletion::All),
        (false, false) => Ok(ReviewNoteDeletion::Selected(note_ids.to_vec())),
        _ => Err((
            400,
            json!({"error": "provide one or more note IDs or all=true, but not both"}),
        )),
    }
}

fn session_comment_delete(request: &SessionRequest) -> (u16, Value) {
    let checkout = match resolve_checkout(request.repo.as_deref()) {
        Ok(checkout) => checkout,
        Err(error) => return error,
    };
    let deletion = match requested_note_deletion(&request.notes, request.all) {
        Ok(deletion) => deletion,
        Err(error) => return error,
    };

    match deletion {
        ReviewNoteDeletion::All => {
            match delete_all_review_notes(&checkout.id, WORKING_TREE_REVIEW_SCOPE) {
                Ok(deleted_count) => (200, json!({"deletedCount": deleted_count})),
                Err(error) => (500, json!({"error": error})),
            }
        }
        ReviewNoteDeletion::Selected(note_ids) => {
            match delete_selected_review_notes(&checkout.id, WORKING_TREE_REVIEW_SCOPE, &note_ids) {
                Ok(Some(deleted_count)) => (200, json!({"deletedCount": deleted_count})),
                Ok(None) => (
                    404,
                    json!({"error": "one or more review notes were not found"}),
                ),
                Err(error) => (500, json!({"error": error})),
            }
        }
    }
}

fn session_comment_list(request: &SessionRequest) -> (u16, Value) {
    let checkout = match resolve_checkout(request.repo.as_deref()) {
        Ok(checkout) => checkout,
        Err(error) => return error,
    };
    let author = request
        .note_type
        .as_deref()
        .filter(|value| *value == "user" || *value == "agent");
    match read_review_notes(&checkout.id, WORKING_TREE_REVIEW_SCOPE, author) {
        Ok(notes) => {
            let notes = notes
                .into_iter()
                .filter(|note| {
                    request
                        .file
                        .as_deref()
                        .is_none_or(|file| file == note.file_path)
                })
                .collect::<Vec<_>>();
            (200, json!({"notes": notes}))
        }
        Err(error) => (500, json!({"error": error})),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_session_response, requested_diff_line, requested_note_deletion, NavigatePayload,
        ReviewNoteDeletion, SessionNavigationQueue,
    };

    #[test]
    fn reads_complete_success_responses_and_rejects_http_errors() {
        let large_body = "x".repeat(300_000);
        let success = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            large_body.len(),
            large_body
        );
        assert_eq!(
            parse_session_response(success.as_bytes()).unwrap(),
            large_body
        );

        let failure = b"HTTP/1.1 404 Not Found\r\nContent-Length: 17\r\n\r\n{\"error\":\"nope\"}";
        assert_eq!(
            parse_session_response(failure).unwrap_err(),
            r#"{"error":"nope"}"#
        );
    }

    #[test]
    fn reads_addition_and_deletion_locations() {
        assert_eq!(
            requested_diff_line(Some(4), None).unwrap(),
            (4, "additions")
        );
        assert_eq!(
            requested_diff_line(None, Some(11)).unwrap(),
            (11, "deletions")
        );
    }

    #[test]
    fn rejects_missing_or_ambiguous_locations() {
        assert!(requested_diff_line(None, None).is_err());
        assert!(requested_diff_line(Some(1), Some(1)).is_err());
    }

    #[test]
    fn queues_and_completes_navigation_in_order() {
        let navigation = |request_id, file: &str| NavigatePayload {
            request_id,
            checkout_id: "checkout".to_string(),
            file: file.to_string(),
            line: 1,
            side: "additions".to_string(),
        };
        let queue = SessionNavigationQueue::default();
        let (complete_first, first_completed) = std::sync::mpsc::sync_channel(1);
        let (complete_second, second_completed) = std::sync::mpsc::sync_channel(1);
        queue.push(navigation(1, "first"), complete_first).unwrap();
        queue
            .push(navigation(2, "second"), complete_second)
            .unwrap();

        assert_eq!(queue.take(), Some(navigation(1, "first")));
        assert_eq!(queue.take(), Some(navigation(2, "second")));
        assert_eq!(queue.take(), None);
        queue.complete(1).unwrap();
        queue.complete(2).unwrap();
        assert_eq!(first_completed.recv(), Ok(()));
        assert_eq!(second_completed.recv(), Ok(()));
    }

    #[test]
    fn validates_review_note_deletion_modes() {
        let selected = vec!["one".to_string(), "two".to_string()];
        assert_eq!(
            requested_note_deletion(&selected, false).unwrap(),
            ReviewNoteDeletion::Selected(selected)
        );
        assert_eq!(
            requested_note_deletion(&[], true).unwrap(),
            ReviewNoteDeletion::All
        );
        assert!(requested_note_deletion(&[], false).is_err());
        assert!(requested_note_deletion(&["one".to_string()], true).is_err());
        assert!(requested_note_deletion(&[String::new()], false).is_err());
    }
}
