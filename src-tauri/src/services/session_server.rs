//! Loopback HTTP server that lets the `rudu session *` CLI drive the running app.
//!
//! ponytail: hand-rolled HTTP/1.1 over std::net — one endpoint, JSON bodies only.
//! Swap for a real HTTP crate if routing or keep-alive ever grows.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::cache::{
    delete_selected_review_notes, read_all_tracked_pull_requests, read_local_checkouts,
    read_review_notes, save_review_note,
};
use crate::models::{ReviewNote, SessionTargetRef, REVIEW_COMMENT_DRAFT_KIND, REVIEW_NOTE_KIND};
use crate::services::diff_data::{DiffDataRequest, DiffDataService, GhDiffSource, SqliteDiffCache};
use crate::services::local_checkout::get_local_checkout_patch;
use crate::services::pull_request_details::PullRequestDetailsService;
use crate::services::review_graphql::{
    GhGraphqlTransport, ReviewGraphqlClient, ReviewThreadService,
};
use crate::services::review_note_publisher::publish_review_notes;
use crate::services::session_target::{
    related_pull_request_for_checkout, resolve_session_target, ActiveSessionTarget,
    ResolvedSessionTarget,
};
use crate::support::{now_unix_timestamp, parse_pull_request_ref, unique_hash};

const MAX_REQUEST_BYTES: u64 = 256 * 1024;
const NAVIGATION_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_NAVIGATION_ID: AtomicU64 = AtomicU64::new(1);
pub const NAVIGATE_EVENT: &str = "rudu://session-navigate";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigatePayload {
    pub request_id: u64,
    pub target: SessionTargetRef,
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
    pub pr: Option<String>,
    pub file: Option<String>,
    pub new_line: Option<u32>,
    pub old_line: Option<u32>,
    pub body: Option<String>,
    pub note: Option<String>,
    pub author: Option<String>,
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
    NoteAdd,
    NoteReply,
    NoteDelete,
    NoteList,
    NotePromote,
    CommentDraft,
    CommentDelete,
    CommentList,
    CommentPublish,
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
        SessionAction::List => session_list(app),
        SessionAction::Review => session_review(request, app),
        SessionAction::Navigate => session_navigate(request, app),
        SessionAction::NoteAdd => session_annotation_add(request, app, REVIEW_NOTE_KIND),
        SessionAction::NoteReply => session_note_reply(request, app),
        SessionAction::NoteDelete => {
            session_annotation_delete(request, app, Some(REVIEW_NOTE_KIND))
        }
        SessionAction::NoteList => session_annotation_list(request, app, Some(REVIEW_NOTE_KIND)),
        SessionAction::NotePromote => session_note_promote(request, app),
        SessionAction::CommentDraft => {
            session_annotation_add(request, app, REVIEW_COMMENT_DRAFT_KIND)
        }
        SessionAction::CommentDelete => {
            session_annotation_delete(request, app, Some(REVIEW_COMMENT_DRAFT_KIND))
        }
        SessionAction::CommentList => {
            session_annotation_list(request, app, Some(REVIEW_COMMENT_DRAFT_KIND))
        }
        SessionAction::CommentPublish => session_comment_publish(request, app),
    }
}

fn session_list(app: &AppHandle) -> (u16, Value) {
    let active = match app.state::<ActiveSessionTarget>().get() {
        Ok(active) => active,
        Err(error) => return (500, json!({"error": error})),
    };
    let checkouts = match read_local_checkouts() {
        Ok(checkouts) => checkouts,
        Err(error) => return (500, json!({"error": error})),
    };
    let pull_requests = match read_all_tracked_pull_requests() {
        Ok(pull_requests) => pull_requests,
        Err(error) => return (500, json!({"error": error})),
    };
    let mut sessions = checkouts
        .into_iter()
        .map(|checkout| {
            json!({
                "sessionId": checkout.id,
                "repo": checkout.path,
                "branch": checkout.branch,
                "kind": "local_checkout",
            })
        })
        .collect::<Vec<_>>();
    sessions.extend(pull_requests.into_iter().map(|(repo, pull_request)| {
        json!({
            "sessionId": format!("pr:{repo}#{}", pull_request.core.number),
            "repo": repo,
            "number": pull_request.core.number,
            "title": pull_request.core.title,
            "state": pull_request.core.state,
            "headSha": pull_request.head_sha,
            "kind": "pull_request",
        })
    }));

    (200, json!({"sessions": sessions, "active": active}))
}

fn resolve_target(
    request: &SessionRequest,
    app: &AppHandle,
) -> Result<ResolvedSessionTarget, (u16, Value)> {
    if request.repo.is_some() && request.pr.is_some() {
        return Err((400, json!({"error": "pass --repo or --pr, but not both"})));
    }
    let pull_request = request
        .pr
        .as_deref()
        .map(parse_pull_request_ref)
        .transpose()
        .map_err(|error| (400, json!({"error": error})))?;
    let active = if request.repo.is_none() && pull_request.is_none() {
        app.state::<ActiveSessionTarget>()
            .get()
            .map_err(|error| (500, json!({"error": error})))?
    } else {
        None
    };
    resolve_session_target(request.repo.as_deref(), pull_request, active)
        .map_err(|error| (error.status, json!({"error": error.message})))
}

fn target_changed_files(target: &ResolvedSessionTarget) -> Result<Vec<String>, (u16, Value)> {
    match target {
        ResolvedSessionTarget::LocalCheckout { status, .. } => Ok(status.changed_files.clone()),
        ResolvedSessionTarget::PullRequest { repo, summary } => {
            let request =
                DiffDataRequest::new(repo.clone(), summary.core.number, summary.head_sha.clone())
                    .map_err(|error| (400, json!({"error": error})))?;
            DiffDataService::new(&GhDiffSource, &SqliteDiffCache)
                .get_changed_files(&request)
                .map_err(|error| (500, json!({"error": error})))
        }
    }
}

fn session_review(request: &SessionRequest, app: &AppHandle) -> (u16, Value) {
    let target = match resolve_target(request, app) {
        Ok(target) => target,
        Err(error) => return error,
    };
    match target {
        ResolvedSessionTarget::LocalCheckout {
            checkout,
            source,
            status,
        } => {
            // ponytail: cached exact-head matches only; fetch remotely if missed links matter.
            let related_pull_request =
                match related_pull_request_for_checkout(&checkout.id, &status.head_sha) {
                    Ok(pull_request) => pull_request,
                    Err(error) => return (500, json!({"error": error})),
                };
            let patch = if request.include_patch {
                match get_local_checkout_patch(checkout.id.clone(), status.revision.clone(), source)
                {
                    Ok(patch) => Some(patch.patch),
                    Err(error) => return (500, json!({"error": error})),
                }
            } else {
                None
            };
            let mut payload = json!({
                "kind": "local_checkout",
                "checkoutId": checkout.id,
                "branch": status.branch,
                "headSha": status.head_sha,
                "revision": status.revision,
                "files": status.changes,
                "relatedPullRequest": related_pull_request,
            });
            if let Some(patch) = patch {
                payload["patch"] = json!(patch);
            }
            (200, payload)
        }
        ResolvedSessionTarget::PullRequest { repo, summary } => {
            let number = summary.core.number;
            let head_sha = summary.head_sha.clone();
            let diff_request = match DiffDataRequest::new(repo.clone(), number, head_sha.clone()) {
                Ok(request) => request,
                Err(error) => return (400, json!({"error": error})),
            };
            let diff_service = DiffDataService::new(&GhDiffSource, &SqliteDiffCache);
            let (files, patch) = if request.include_patch {
                match diff_service.get_diff_bundle(&diff_request) {
                    Ok(bundle) => (bundle.changed_files, Some(bundle.patch)),
                    Err(error) => return (500, json!({"error": error})),
                }
            } else {
                match diff_service.get_changed_files(&diff_request) {
                    Ok(files) => (files, None),
                    Err(error) => return (500, json!({"error": error})),
                }
            };
            let details = PullRequestDetailsService::new(GhGraphqlTransport);
            let overview = details.get_overview(&repo, number);
            let checks = details.get_checks(&repo, number);
            let overview_error = overview.as_ref().err().cloned();
            let checks_error = checks.as_ref().err().cloned();
            let mut payload = json!({
                "kind": "pull_request",
                "repo": repo,
                "number": number,
                "headSha": head_sha,
                "summary": summary,
                "overview": overview.ok(),
                "overviewError": overview_error,
                "checks": checks.ok(),
                "checksError": checks_error,
                "files": files,
            });
            if let Some(patch) = patch {
                payload["patch"] = json!(patch);
            }
            (200, payload)
        }
    }
}

fn required_str<'a>(value: Option<&'a str>, key: &str) -> Result<&'a str, (u16, Value)> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
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
    let target = match resolve_target(request, app) {
        Ok(target) => target,
        Err(error) => return error,
    };
    let file = match required_str(request.file.as_deref(), "file") {
        Ok(file) => file.to_string(),
        Err(error) => return error,
    };
    let (line, side) = match requested_diff_line(request.new_line, request.old_line) {
        Ok(location) => location,
        Err(error) => return error,
    };
    let changed_files = match target_changed_files(&target) {
        Ok(files) => files,
        Err(error) => return error,
    };
    if !changed_files.iter().any(|path| path == &file) {
        return (
            400,
            json!({"error": format!("file not in the selected diff: {file}")}),
        );
    }

    let request_id = NEXT_NAVIGATION_ID.fetch_add(1, Ordering::Relaxed);
    let payload = NavigatePayload {
        request_id,
        target: target.target_ref(),
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

fn session_annotation_add(request: &SessionRequest, app: &AppHandle, kind: &str) -> (u16, Value) {
    let parsed = (|| {
        let target = resolve_target(request, app)?;
        if kind == REVIEW_COMMENT_DRAFT_KIND {
            super::review_note_publisher::validate_publish_target(&target.review_note_owner())
                .map_err(|error| (400, json!({"error": error})))?;
        }
        let file = required_str(request.file.as_deref(), "file")?;
        let body = required_str(request.body.as_deref(), "body")?;
        let author_name = if kind == REVIEW_NOTE_KIND {
            Some(
                required_str(request.author.as_deref(), "author")?
                    .trim()
                    .to_string(),
            )
        } else {
            None
        };
        let (line, side) = requested_diff_line(request.new_line, request.old_line)?;
        let changed_files = target_changed_files(&target)?;
        if !changed_files.iter().any(|path| path == file) {
            return Err((
                400,
                json!({"error": format!("file not in the selected diff: {file}")}),
            ));
        }
        let (target_key, scope) = target
            .review_note_location()
            .map_err(|error| (400, json!({"error": error})))?;
        Ok(ReviewNote {
            id: unique_hash(&format!("{kind}:{target_key}:{scope}:{file}:{side}:{line}")),
            target_key,
            scope,
            file_path: file.to_string(),
            line,
            side: side.to_string(),
            start_line: None,
            start_side: None,
            reply_to_id: None,
            body: body.to_string(),
            kind: kind.to_string(),
            author: if kind == REVIEW_NOTE_KIND {
                "agent"
            } else {
                "user"
            }
            .to_string(),
            author_name,
            created_at: now_unix_timestamp(),
        })
    })();
    let annotation = match parsed {
        Ok(annotation) => annotation,
        Err(error) => return error,
    };

    if let Err(error) = save_review_note(&annotation) {
        return (500, json!({"error": error}));
    }
    (200, json!({"annotation": annotation}))
}

fn session_note_reply(request: &SessionRequest, app: &AppHandle) -> (u16, Value) {
    let parsed = (|| {
        let target = resolve_target(request, app)?;
        let target_id = required_str(request.note.as_deref(), "note")?;
        let body = required_str(request.body.as_deref(), "body")?;
        let author_name = required_str(request.author.as_deref(), "author")?;
        let (target_key, scope) = target
            .review_note_location()
            .map_err(|error| (400, json!({"error": error})))?;
        let notes = read_review_notes(&target_key, &scope, None)
            .map_err(|error| (500, json!({"error": error})))?;
        let target = notes
            .iter()
            .find(|note| note.id == target_id && note.kind == REVIEW_NOTE_KIND)
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
            target_key,
            scope,
            file_path: target.file_path.clone(),
            line: target.line,
            side: target.side.clone(),
            start_line: target.start_line,
            start_side: target.start_side.clone(),
            reply_to_id: Some(root_id),
            body: body.to_string(),
            kind: REVIEW_NOTE_KIND.to_string(),
            author: "agent".to_string(),
            author_name: Some(author_name.trim().to_string()),
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

fn session_annotation_delete(
    request: &SessionRequest,
    app: &AppHandle,
    kind: Option<&str>,
) -> (u16, Value) {
    let target = match resolve_target(request, app) {
        Ok(target) => target,
        Err(error) => return error,
    };
    let (target_key, scope) = match target.review_note_location() {
        Ok(location) => location,
        Err(error) => return (400, json!({"error": error})),
    };
    let deletion = match requested_note_deletion(&request.notes, request.all) {
        Ok(deletion) => deletion,
        Err(error) => return error,
    };
    let existing = match read_review_notes(&target_key, &scope, None) {
        Ok(notes) => notes,
        Err(error) => return (500, json!({"error": error})),
    };
    let note_ids = match deletion {
        ReviewNoteDeletion::All => existing
            .iter()
            .filter(|note| kind.is_none_or(|kind| note.kind == kind) && note.reply_to_id.is_none())
            .map(|note| note.id.clone())
            .collect::<Vec<_>>(),
        ReviewNoteDeletion::Selected(note_ids) => {
            if note_ids.iter().any(|note_id| {
                !existing
                    .iter()
                    .any(|note| note.id == *note_id && kind.is_none_or(|kind| note.kind == kind))
            }) {
                return (
                    404,
                    json!({"error": "one or more annotations were not found"}),
                );
            }
            note_ids
        }
    };
    if note_ids.is_empty() {
        return (200, json!({"deletedCount": 0}));
    }
    match delete_selected_review_notes(&target_key, &scope, &note_ids) {
        Ok(Some(deleted_count)) => (200, json!({"deletedCount": deleted_count})),
        Ok(None) => (
            404,
            json!({"error": "one or more annotations were not found"}),
        ),
        Err(error) => (500, json!({"error": error})),
    }
}

fn session_note_promote(request: &SessionRequest, app: &AppHandle) -> (u16, Value) {
    let target = match resolve_target(request, app) {
        Ok(target) => target,
        Err(error) => return error,
    };
    if let Err(error) =
        super::review_note_publisher::validate_publish_target(&target.review_note_owner())
    {
        return (400, json!({"error": error}));
    }
    let note_id = match required_str(request.note.as_deref(), "note") {
        Ok(note_id) => note_id,
        Err(error) => return error,
    };
    let (target_key, scope) = match target.review_note_location() {
        Ok(location) => location,
        Err(error) => return (400, json!({"error": error})),
    };
    let source = match read_review_notes(&target_key, &scope, None) {
        Ok(notes) => notes.into_iter().find(|note| {
            note.id == note_id && note.kind == REVIEW_NOTE_KIND && note.reply_to_id.is_none()
        }),
        Err(error) => return (500, json!({"error": error})),
    };
    let Some(source) = source else {
        return (
            404,
            json!({"error": format!("private root review note not found: {note_id}")}),
        );
    };
    let draft = ReviewNote {
        id: unique_hash(&format!("promoted:{note_id}")),
        kind: REVIEW_COMMENT_DRAFT_KIND.to_string(),
        author: "user".to_string(),
        author_name: None,
        reply_to_id: None,
        created_at: now_unix_timestamp(),
        ..source
    };
    match save_review_note(&draft) {
        Ok(()) => (200, json!({"commentDraft": draft})),
        Err(error) => (500, json!({"error": error})),
    }
}

fn session_comment_publish(request: &SessionRequest, app: &AppHandle) -> (u16, Value) {
    let target = match resolve_target(request, app) {
        Ok(target) => target,
        Err(error) => return error,
    };
    let (_, scope) = match target.review_note_location() {
        Ok(location) => location,
        Err(error) => return (400, json!({"error": error})),
    };
    match publish_review_notes(target.review_note_owner(), scope) {
        Ok(review) => (200, json!({"review": review})),
        Err(error) => (400, json!({"error": error})),
    }
}

fn session_annotation_list(
    request: &SessionRequest,
    app: &AppHandle,
    kind: Option<&str>,
) -> (u16, Value) {
    let target = match resolve_target(request, app) {
        Ok(target) => target,
        Err(error) => return error,
    };
    let (target_key, scope) = match target.review_note_location() {
        Ok(location) => location,
        Err(error) => return (400, json!({"error": error})),
    };
    let author = request
        .note_type
        .as_deref()
        .filter(|value| *value == "user" || *value == "agent");
    match read_review_notes(&target_key, &scope, author) {
        Ok(notes) => {
            let notes = notes
                .into_iter()
                .filter(|note| {
                    kind.is_none_or(|kind| note.kind == kind)
                        && request
                            .file
                            .as_deref()
                            .is_none_or(|file| file == note.file_path)
                })
                .collect::<Vec<_>>();
            let mut payload = if kind == Some(REVIEW_COMMENT_DRAFT_KIND) {
                json!({"commentDrafts": notes})
            } else {
                json!({"notes": notes})
            };
            if let ResolvedSessionTarget::PullRequest { repo, summary } = &target {
                let threads =
                    ReviewThreadService::new(ReviewGraphqlClient::new(GhGraphqlTransport))
                        .list_review_threads(repo, summary.core.number);
                let threads_error = threads.as_ref().err().cloned();
                payload["githubThreads"] = json!(threads.ok());
                payload["githubThreadsError"] = json!(threads_error);
            }
            (200, payload)
        }
        Err(error) => (500, json!({"error": error})),
    }
}

#[cfg(test)]
mod tests {
    use crate::models::SessionTargetRef;

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
            target: SessionTargetRef::LocalCheckout {
                checkout_id: "checkout".to_string(),
                source: None,
            },
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
