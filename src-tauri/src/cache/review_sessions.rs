use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::{ReviewChatRuntimeKind, ReviewSession, ReviewSessionStatus};
use crate::support::now_unix_timestamp;

const REVISION_CHECKPOINT_EVENT_KIND: &str = "revision_checkpoint";
const DEFAULT_REVIEW_EFFORT_MODE: &str = "fast";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRevisionCheckpoint {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "headSha")]
    pub head_sha: String,
    #[serde(rename = "previousHeadSha")]
    pub previous_head_sha: String,
    #[serde(rename = "messageCount")]
    pub message_count: u32,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewEffortState {
    pub active_mode: String,
    pub pending_mode: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewChatTurnKind {
    Chat,
    Walkthrough,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewChatTurnStatus {
    Running,
    Completing,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReviewChatActiveTurnActivityItem {
    Progress {
        label: String,
    },
    Plan {
        label: String,
    },
    Tool {
        label: String,
        status: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChatActiveTurn {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "turnId")]
    pub turn_id: String,
    pub kind: ReviewChatTurnKind,
    pub status: ReviewChatTurnStatus,
    #[serde(rename = "requestMessageId")]
    pub request_message_id: String,
    #[serde(rename = "reviewEffortMode")]
    pub review_effort_mode: Option<String>,
    #[serde(rename = "runtimeModelChoice")]
    pub runtime_model_choice: Option<String>,
    #[serde(rename = "headSha")]
    pub head_sha: String,
    #[serde(rename = "progressMessage")]
    pub progress_message: Option<String>,
    #[serde(rename = "activitySummary")]
    pub activity_summary: Vec<ReviewChatActiveTurnActivityItem>,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct StartReviewChatTurnInput {
    pub session_id: String,
    pub turn_id: String,
    pub kind: ReviewChatTurnKind,
    pub request_message: Value,
    pub review_effort_mode: Option<String>,
    pub runtime_model_choice: Option<String>,
    pub head_sha: String,
    pub progress_message: Option<String>,
}

pub fn upsert_review_session(session: &ReviewSession) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    upsert_review_session_with_connection(&conn, session)
}

pub fn read_review_session(session_id: &str) -> Result<Option<ReviewSession>, String> {
    let conn = crate::cache::open_cache_connection()?;
    read_review_session_with_connection(&conn, session_id)
}

pub fn read_review_effort_state(session_id: &str) -> Result<ReviewEffortState, String> {
    let conn = crate::cache::open_cache_connection()?;
    read_review_effort_state_with_connection(&conn, session_id)
}

pub fn apply_review_effort_mode(
    session_id: &str,
    mode: &str,
    message_count: u32,
) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    apply_review_effort_mode_with_connection(&conn, session_id, mode, message_count)
}

pub fn set_pending_review_effort_mode(session_id: &str, mode: &str) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    set_pending_review_effort_mode_with_connection(&conn, session_id, mode)
}

pub fn reset_review_chat_state(session_id: &str) -> Result<(), String> {
    let mut conn = crate::cache::open_cache_connection()?;
    reset_review_chat_state_with_connection(&mut conn, session_id)
}

pub fn read_active_review_chat_turn(
    session_id: &str,
) -> Result<Option<ReviewChatActiveTurn>, String> {
    let conn = crate::cache::open_cache_connection()?;
    read_active_review_chat_turn_with_connection(&conn, session_id)
}

pub fn start_review_chat_turn(
    input: StartReviewChatTurnInput,
) -> Result<ReviewChatActiveTurn, String> {
    let mut conn = crate::cache::open_cache_connection()?;
    start_review_chat_turn_with_connection(&mut conn, input)
}

pub fn update_active_review_chat_turn_progress(
    session_id: &str,
    turn_id: &str,
    progress_message: &str,
) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    update_active_review_chat_turn_snapshot_with_connection(
        &conn,
        session_id,
        turn_id,
        progress_message,
        vec![ReviewChatActiveTurnActivityItem::Progress {
            label: progress_message.to_string(),
        }],
    )
}

pub fn update_active_review_chat_turn_snapshot(
    session_id: &str,
    turn_id: &str,
    progress_message: &str,
    activity_summary: Vec<ReviewChatActiveTurnActivityItem>,
) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    update_active_review_chat_turn_snapshot_with_connection(
        &conn,
        session_id,
        turn_id,
        progress_message,
        activity_summary,
    )
}

pub fn complete_active_review_chat_turn(
    session_id: &str,
    turn_id: &str,
    terminal_message: &Value,
) -> Result<(), String> {
    let mut conn = crate::cache::open_cache_connection()?;
    complete_active_review_chat_turn_with_connection(
        &mut conn,
        session_id,
        turn_id,
        terminal_message,
    )
}

pub fn read_review_chat_messages(session_id: &str) -> Result<Vec<Value>, String> {
    let conn = crate::cache::open_cache_connection()?;
    read_review_chat_messages_with_connection(&conn, session_id)
}

pub fn replace_review_chat_messages(session_id: &str, messages: &[Value]) -> Result<(), String> {
    let mut conn = crate::cache::open_cache_connection()?;
    replace_review_chat_messages_with_connection(&mut conn, session_id, messages)
}

pub fn record_revision_checkpoint(
    session_id: &str,
    previous_head_sha: &str,
    head_sha: &str,
    message_count: u32,
) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    insert_revision_checkpoint_with_connection(
        &conn,
        session_id,
        previous_head_sha,
        head_sha,
        message_count,
    )
}

pub fn read_review_revision_checkpoints(
    session_id: &str,
) -> Result<Vec<ReviewRevisionCheckpoint>, String> {
    let conn = crate::cache::open_cache_connection()?;
    read_review_revision_checkpoints_with_connection(&conn, session_id)
}

pub fn delete_review_session_for_pull_request(repo: &str, number: u32) -> Result<(), String> {
    let conn = crate::cache::open_cache_connection()?;
    delete_review_session_for_pull_request_with_connection(&conn, repo, number)
}

fn review_session_status_to_sql(status: ReviewSessionStatus) -> Result<String, String> {
    let value = serde_json::to_value(status)
        .map_err(|error| format!("Failed to serialize review session status: {error}"))?;
    value
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Review session status serialized to an invalid value".to_string())
}

fn review_session_status_from_sql(status: String) -> Result<ReviewSessionStatus, String> {
    serde_json::from_value(Value::String(status))
        .map_err(|error| format!("Failed to parse review session status: {error}"))
}

fn review_runtime_to_sql(runtime: ReviewChatRuntimeKind) -> Result<String, String> {
    let value = serde_json::to_value(runtime)
        .map_err(|error| format!("Failed to serialize review runtime: {error}"))?;
    value
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Review runtime serialized to an invalid value".to_string())
}

fn review_runtime_from_sql(runtime: String) -> Result<ReviewChatRuntimeKind, String> {
    serde_json::from_value(Value::String(runtime))
        .map_err(|error| format!("Failed to parse review runtime: {error}"))
}

fn review_turn_kind_to_sql(kind: ReviewChatTurnKind) -> Result<String, String> {
    let value = serde_json::to_value(kind)
        .map_err(|error| format!("Failed to serialize review chat turn kind: {error}"))?;
    value
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Review chat turn kind serialized to an invalid value".to_string())
}

fn review_turn_kind_from_sql(kind: String) -> Result<ReviewChatTurnKind, String> {
    serde_json::from_value(Value::String(kind))
        .map_err(|error| format!("Failed to parse review chat turn kind: {error}"))
}

fn review_turn_status_to_sql(status: ReviewChatTurnStatus) -> Result<String, String> {
    let value = serde_json::to_value(status)
        .map_err(|error| format!("Failed to serialize review chat turn status: {error}"))?;
    value
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Review chat turn status serialized to an invalid value".to_string())
}

fn review_turn_status_from_sql(status: String) -> Result<ReviewChatTurnStatus, String> {
    serde_json::from_value(Value::String(status))
        .map_err(|error| format!("Failed to parse review chat turn status: {error}"))
}

fn validate_review_effort_mode(mode: &str) -> Result<(), String> {
    match mode {
        "fast" | "deep" => Ok(()),
        _ => Err("Review effort mode must be fast or deep.".to_string()),
    }
}

fn review_chat_message_field<'a>(message: &'a Value, field: &str) -> Result<&'a str, String> {
    message
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Review chat message is missing {field}"))
}

fn review_chat_message_position(conn: &Connection, session_id: &str) -> Result<i64, String> {
    conn.query_row(
        "
        SELECT COALESCE(MAX(position), -1) + 1
        FROM review_chat_messages
        WHERE session_id = ?1
        ",
        params![session_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        format!("Failed to find next review chat message position for {session_id}: {error}")
    })
}

fn timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_else(|_| now_unix_timestamp())
}

fn upsert_review_session_with_connection(
    conn: &Connection,
    session: &ReviewSession,
) -> Result<(), String> {
    let status = review_session_status_to_sql(session.status)?;
    let review_runtime = review_runtime_to_sql(session.review_runtime)?;

    conn.execute(
        "
        INSERT INTO review_sessions (
            id,
            repo_name_with_owner,
            pr_number,
            head_sha,
            status,
            workspace_path,
            review_runtime,
            runtime_model_choice,
            agent_session_id,
            agent_context_head_sha,
            created_at,
            updated_at,
            last_error
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(id)
        DO UPDATE SET
            repo_name_with_owner = excluded.repo_name_with_owner,
            pr_number = excluded.pr_number,
            head_sha = excluded.head_sha,
            status = excluded.status,
            workspace_path = excluded.workspace_path,
            review_runtime = excluded.review_runtime,
            runtime_model_choice = excluded.runtime_model_choice,
            agent_session_id = excluded.agent_session_id,
            agent_context_head_sha = excluded.agent_context_head_sha,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            last_error = excluded.last_error
        ",
        params![
            session.id,
            session.repo,
            session.number,
            session.head_sha,
            status,
            session.workspace_path,
            review_runtime,
            session.runtime_model_choice,
            session.agent_session_id,
            session.agent_context_head_sha,
            session.created_at,
            session.updated_at,
            session.last_error,
        ],
    )
    .map_err(|error| format!("Failed to persist review session {}: {error}", session.id))?;

    Ok(())
}

fn read_review_session_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ReviewSession>, String> {
    conn.query_row(
        "
        SELECT
            id,
            repo_name_with_owner,
            pr_number,
            head_sha,
            status,
            workspace_path,
            review_runtime,
            runtime_model_choice,
            agent_session_id,
            agent_context_head_sha,
            created_at,
            updated_at,
            last_error
        FROM review_sessions
        WHERE id = ?1
        ",
        params![session_id],
        |row| {
            let status: String = row.get(4)?;
            let review_runtime: String = row.get(6)?;
            Ok((
                ReviewSession {
                    id: row.get(0)?,
                    repo: row.get(1)?,
                    number: row.get(2)?,
                    head_sha: row.get(3)?,
                    status: ReviewSessionStatus::Prepared,
                    workspace_path: row.get(5)?,
                    review_runtime: ReviewChatRuntimeKind::Codex,
                    runtime_model_choice: row.get(7)?,
                    agent_session_id: row.get(8)?,
                    agent_context_head_sha: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    last_error: row.get(12)?,
                },
                status,
                review_runtime,
            ))
        },
    )
    .optional()
    .map_err(|error| format!("Failed to read review session {session_id}: {error}"))?
    .map(|(mut session, status, review_runtime)| {
        session.status = review_session_status_from_sql(status)?;
        session.review_runtime = review_runtime_from_sql(review_runtime)?;
        Ok(session)
    })
    .transpose()
}

fn read_review_effort_state_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<ReviewEffortState, String> {
    conn.query_row(
        "
        SELECT active_review_effort_mode, pending_review_effort_mode
        FROM review_sessions
        WHERE id = ?1
        ",
        params![session_id],
        |row| {
            Ok(ReviewEffortState {
                active_mode: row.get(0)?,
                pending_mode: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(|error| {
        format!("Failed to read review chat effort mode for session {session_id}: {error}")
    })
    .map(|state| {
        state.unwrap_or_else(|| ReviewEffortState {
            active_mode: DEFAULT_REVIEW_EFFORT_MODE.to_string(),
            pending_mode: None,
        })
    })
}

fn apply_review_effort_mode_with_connection(
    conn: &Connection,
    session_id: &str,
    mode: &str,
    _message_count: u32,
) -> Result<(), String> {
    validate_review_effort_mode(mode)?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        UPDATE review_sessions
        SET active_review_effort_mode = ?2,
            pending_review_effort_mode = NULL,
            updated_at = ?3
        WHERE id = ?1
        ",
        params![session_id, mode, timestamp],
    )
    .map_err(|error| {
        format!("Failed to persist review chat effort mode for session {session_id}: {error}")
    })?;

    Ok(())
}

fn set_pending_review_effort_mode_with_connection(
    conn: &Connection,
    session_id: &str,
    mode: &str,
) -> Result<(), String> {
    validate_review_effort_mode(mode)?;
    conn.execute(
        "
        UPDATE review_sessions
        SET pending_review_effort_mode = ?2,
            updated_at = ?3
        WHERE id = ?1
        ",
        params![session_id, mode, now_unix_timestamp()],
    )
    .map_err(|error| {
        format!(
            "Failed to persist pending review chat effort mode for session {session_id}: {error}"
        )
    })?;

    Ok(())
}

fn reset_review_chat_state_with_connection(
    conn: &mut Connection,
    session_id: &str,
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to reset review chat state for {session_id}: {error}"))?;

    tx.execute(
        "
        DELETE FROM review_chat_messages
        WHERE session_id = ?1
        ",
        params![session_id],
    )
    .map_err(|error| {
        format!("Failed to reset review chat transcript for session {session_id}: {error}")
    })?;

    tx.execute(
        "
        DELETE FROM active_review_chat_turns
        WHERE session_id = ?1
        ",
        params![session_id],
    )
    .map_err(|error| {
        format!("Failed to reset active review chat turn for session {session_id}: {error}")
    })?;

    tx.execute(
        "
        DELETE FROM review_chat_timeline_events
        WHERE session_id = ?1
        ",
        params![session_id],
    )
    .map_err(|error| {
        format!("Failed to reset review chat timeline for session {session_id}: {error}")
    })?;

    tx.execute(
        "
        UPDATE review_sessions
        SET active_review_effort_mode = ?2,
            pending_review_effort_mode = NULL,
            updated_at = ?3
        WHERE id = ?1
        ",
        params![session_id, DEFAULT_REVIEW_EFFORT_MODE, now_unix_timestamp()],
    )
    .map_err(|error| {
        format!("Failed to reset review chat settings for session {session_id}: {error}")
    })?;

    tx.commit()
        .map_err(|error| format!("Failed to reset review chat state for {session_id}: {error}"))
}

fn read_active_review_chat_turn_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ReviewChatActiveTurn>, String> {
    conn.query_row(
        "
        SELECT
            session_id,
            turn_id,
            turn_kind,
            status,
            request_message_id,
            review_effort_mode,
            runtime_model_choice,
            head_sha,
            progress_message,
            activity_summary_json,
            error_message,
            started_at,
            updated_at
        FROM active_review_chat_turns
        WHERE session_id = ?1
        ",
        params![session_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
            ))
        },
    )
    .optional()
    .map_err(|error| {
        format!("Failed to read active review chat turn for session {session_id}: {error}")
    })?
    .map(
        |(
            session_id,
            turn_id,
            kind,
            status,
            request_message_id,
            review_effort_mode,
            runtime_model_choice,
            head_sha,
            progress_message,
            activity_summary_json,
            error_message,
            started_at,
            updated_at,
        )| {
            let activity_summary = serde_json::from_str::<Vec<ReviewChatActiveTurnActivityItem>>(
                &activity_summary_json,
            )
            .map_err(|error| {
                format!(
                    "Failed to parse active review chat turn activity for {session_id}: {error}"
                )
            })?;
            Ok(ReviewChatActiveTurn {
                session_id,
                turn_id,
                kind: review_turn_kind_from_sql(kind)?,
                status: review_turn_status_from_sql(status)?,
                request_message_id,
                review_effort_mode,
                runtime_model_choice,
                head_sha,
                progress_message,
                activity_summary,
                error_message,
                started_at,
                updated_at,
            })
        },
    )
    .transpose()
}

fn start_review_chat_turn_with_connection(
    conn: &mut Connection,
    input: StartReviewChatTurnInput,
) -> Result<ReviewChatActiveTurn, String> {
    let request_message_id = review_chat_message_field(&input.request_message, "id")?.to_string();
    let kind = review_turn_kind_to_sql(input.kind)?;
    let status = review_turn_status_to_sql(ReviewChatTurnStatus::Running)?;
    let timestamp = timestamp_millis();
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start active review chat turn: {error}"))?;
    let position = review_chat_message_position(&tx, &input.session_id)?;
    let role = review_chat_message_field(&input.request_message, "role")?;
    let request_message_json = serde_json::to_string(&input.request_message)
        .map_err(|error| format!("Failed to serialize review chat request message: {error}"))?;
    let activity_summary = input
        .progress_message
        .as_ref()
        .map(|message| {
            vec![ReviewChatActiveTurnActivityItem::Progress {
                label: message.clone(),
            }]
        })
        .unwrap_or_default();
    let activity_summary_json = serde_json::to_string(&activity_summary).map_err(|error| {
        format!("Failed to serialize active review chat turn activity: {error}")
    })?;

    tx.execute(
        "
        INSERT INTO review_chat_messages (
            session_id,
            message_id,
            position,
            role,
            message_json,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ",
        params![
            input.session_id.as_str(),
            request_message_id.as_str(),
            position,
            role,
            request_message_json,
            timestamp,
        ],
    )
    .map_err(|error| {
        format!("Failed to persist review chat request message {request_message_id}: {error}")
    })?;

    tx.execute(
        "
        INSERT INTO active_review_chat_turns (
            session_id,
            turn_id,
            turn_kind,
            status,
            request_message_id,
            review_effort_mode,
            runtime_model_choice,
            head_sha,
            progress_message,
            activity_summary_json,
            error_message,
            started_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?11)
        ",
        params![
            input.session_id.as_str(),
            input.turn_id.as_str(),
            kind,
            status,
            request_message_id.as_str(),
            input.review_effort_mode.as_deref(),
            input.runtime_model_choice.as_deref(),
            input.head_sha.as_str(),
            input.progress_message.as_deref(),
            activity_summary_json,
            timestamp,
        ],
    )
    .map_err(|error| {
        format!(
            "Failed to persist active review chat turn {}: {error}",
            input.turn_id
        )
    })?;

    tx.commit()
        .map_err(|error| format!("Failed to commit active review chat turn: {error}"))?;

    read_active_review_chat_turn_with_connection(conn, &input.session_id)?.ok_or_else(|| {
        format!(
            "Active review chat turn {} was not persisted",
            input.turn_id
        )
    })
}

fn update_active_review_chat_turn_snapshot_with_connection(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
    progress_message: &str,
    activity_summary: Vec<ReviewChatActiveTurnActivityItem>,
) -> Result<(), String> {
    let activity_summary_json = serde_json::to_string(&activity_summary).map_err(|error| {
        format!("Failed to serialize active review chat turn activity: {error}")
    })?;
    conn.execute(
        "
        UPDATE active_review_chat_turns
        SET progress_message = ?3,
            activity_summary_json = ?4,
            updated_at = ?5
        WHERE session_id = ?1
          AND turn_id = ?2
        ",
        params![
            session_id,
            turn_id,
            progress_message,
            activity_summary_json,
            timestamp_millis()
        ],
    )
    .map_err(|error| {
        format!("Failed to update active review chat turn {turn_id} progress: {error}")
    })?;

    Ok(())
}

fn complete_active_review_chat_turn_with_connection(
    conn: &mut Connection,
    session_id: &str,
    turn_id: &str,
    terminal_message: &Value,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|error| {
        format!("Failed to start active review chat turn completion for {turn_id}: {error}")
    })?;
    let active_turn_id = tx
        .query_row(
            "
            SELECT turn_id
            FROM active_review_chat_turns
            WHERE session_id = ?1
              AND turn_id = ?2
            ",
            params![session_id, turn_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read active review chat turn {turn_id}: {error}"))?;
    if active_turn_id.is_none() {
        return tx.commit().map_err(|error| {
            format!("Failed to commit active review chat turn completion for {turn_id}: {error}")
        });
    }

    let message_id = review_chat_message_field(terminal_message, "id")?;
    let role = review_chat_message_field(terminal_message, "role")?;
    let message_json = serde_json::to_string(terminal_message)
        .map_err(|error| format!("Failed to serialize terminal review chat message: {error}"))?;
    let position = review_chat_message_position(&tx, session_id)?;
    let timestamp = now_unix_timestamp();

    tx.execute(
        "
        INSERT INTO review_chat_messages (
            session_id,
            message_id,
            position,
            role,
            message_json,
            created_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ",
        params![
            session_id,
            message_id,
            position,
            role,
            message_json,
            timestamp
        ],
    )
    .map_err(|error| {
        format!("Failed to append terminal review chat message {message_id}: {error}")
    })?;

    tx.execute(
        "
        DELETE FROM active_review_chat_turns
        WHERE session_id = ?1
          AND turn_id = ?2
        ",
        params![session_id, turn_id],
    )
    .map_err(|error| format!("Failed to clear active review chat turn {turn_id}: {error}"))?;

    tx.commit().map_err(|error| {
        format!("Failed to commit active review chat turn completion for {turn_id}: {error}")
    })
}

fn insert_revision_checkpoint_with_connection(
    conn: &Connection,
    session_id: &str,
    previous_head_sha: &str,
    head_sha: &str,
    message_count: u32,
) -> Result<(), String> {
    if previous_head_sha == head_sha {
        return Ok(());
    }

    let created_at = timestamp_millis();
    let checkpoint = ReviewRevisionCheckpoint {
        id: format!("{session_id}:revision:{message_count}:{previous_head_sha}:{head_sha}"),
        session_id: session_id.to_string(),
        head_sha: head_sha.to_string(),
        previous_head_sha: previous_head_sha.to_string(),
        message_count,
        created_at,
    };
    let event_json = serde_json::to_string(&checkpoint)
        .map_err(|error| format!("Failed to serialize revision checkpoint: {error}"))?;

    conn.execute(
        "
        INSERT OR IGNORE INTO review_chat_timeline_events (
            id,
            session_id,
            position,
            event_kind,
            event_json,
            created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        params![
            checkpoint.id,
            session_id,
            message_count as i64,
            REVISION_CHECKPOINT_EVENT_KIND,
            event_json,
            created_at,
        ],
    )
    .map_err(|error| {
        format!("Failed to persist revision checkpoint for session {session_id}: {error}")
    })?;

    Ok(())
}

fn read_review_chat_messages_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT message_json
            FROM review_chat_messages
            WHERE session_id = ?1
            ORDER BY position ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare review chat transcript query: {error}"))?;

    let rows = statement
        .query_map(params![session_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to load review chat transcript: {error}"))?;

    let mut messages = Vec::new();
    for row in rows {
        let body = row.map_err(|error| {
            format!("Failed to parse review chat transcript row for {session_id}: {error}")
        })?;
        let message = serde_json::from_str::<Value>(&body).map_err(|error| {
            format!("Failed to parse review chat message for {session_id}: {error}")
        })?;
        messages.push(message);
    }

    Ok(messages)
}

fn replace_review_chat_messages_with_connection(
    conn: &mut Connection,
    session_id: &str,
    messages: &[Value],
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start review chat transcript transaction: {error}"))?;

    tx.execute(
        "DELETE FROM review_chat_messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|error| format!("Failed to clear review chat transcript: {error}"))?;

    let timestamp = now_unix_timestamp();
    for (index, message) in messages.iter().enumerate() {
        let message_id = review_chat_message_field(message, "id")?;
        let role = review_chat_message_field(message, "role")?;
        let message_json = serde_json::to_string(message)
            .map_err(|error| format!("Failed to serialize review chat message: {error}"))?;

        tx.execute(
            "
            INSERT INTO review_chat_messages (
                session_id,
                message_id,
                position,
                role,
                message_json,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ",
            params![
                session_id,
                message_id,
                index as i64,
                role,
                message_json,
                timestamp,
            ],
        )
        .map_err(|error| format!("Failed to persist review chat message {message_id}: {error}"))?;
    }

    tx.commit()
        .map_err(|error| format!("Failed to commit review chat transcript transaction: {error}"))
}

fn read_review_revision_checkpoints_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ReviewRevisionCheckpoint>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT event_json
            FROM review_chat_timeline_events
            WHERE session_id = ?1
              AND event_kind = ?2
            ORDER BY position ASC, created_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare revision checkpoint query: {error}"))?;

    let rows = statement
        .query_map(params![session_id, REVISION_CHECKPOINT_EVENT_KIND], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("Failed to load revision checkpoints: {error}"))?;

    let mut checkpoints = Vec::new();
    for row in rows {
        let body = row.map_err(|error| {
            format!("Failed to parse revision checkpoint row for {session_id}: {error}")
        })?;
        let checkpoint =
            serde_json::from_str::<ReviewRevisionCheckpoint>(&body).map_err(|error| {
                format!("Failed to parse revision checkpoint for {session_id}: {error}")
            })?;
        checkpoints.push(checkpoint);
    }

    Ok(checkpoints)
}

fn delete_review_session_for_pull_request_with_connection(
    conn: &Connection,
    repo: &str,
    number: u32,
) -> Result<(), String> {
    let session_ids = conn
        .prepare(
            "
            SELECT id
            FROM review_sessions
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
            ",
        )
        .and_then(|mut statement| {
            let rows = statement.query_map(params![repo, number], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| {
            format!("Failed to find review sessions for pull request #{number} in {repo}: {error}")
        })?;

    for session_id in &session_ids {
        conn.execute(
            "DELETE FROM active_review_chat_turns WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|error| {
            format!("Failed to delete active review chat turn for session {session_id}: {error}")
        })?;
        conn.execute(
            "DELETE FROM review_chat_messages WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|error| {
            format!("Failed to delete review chat transcript for session {session_id}: {error}")
        })?;
        conn.execute(
            "DELETE FROM review_chat_timeline_events WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|error| {
            format!("Failed to delete review chat timeline for session {session_id}: {error}")
        })?;
    }

    conn.execute(
        "
        DELETE FROM review_sessions
        WHERE repo_name_with_owner = ?1
          AND pr_number = ?2
        ",
        params![repo, number],
    )
    .map_err(|error| {
        format!("Failed to delete review session for pull request #{number} in {repo}: {error}")
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database opens");
        crate::cache::ensure_cache_schema(&conn).expect("schema initializes");
        conn
    }

    fn sample_session() -> ReviewSession {
        ReviewSession {
            id: "owner-repo-pr-42".to_string(),
            repo: "owner/repo".to_string(),
            number: 42,
            head_sha: "head-a".to_string(),
            status: ReviewSessionStatus::Indexed,
            workspace_path: "/tmp/rudu/workspace".to_string(),
            review_runtime: ReviewChatRuntimeKind::Codex,
            runtime_model_choice: None,
            agent_session_id: Some("agent-1".to_string()),
            agent_context_head_sha: Some("head-a".to_string()),
            created_at: 1,
            updated_at: 2,
            last_error: None,
        }
    }

    #[test]
    fn persists_and_reads_review_session() {
        let conn = test_connection();
        let session = sample_session();

        upsert_review_session_with_connection(&conn, &session).unwrap();

        let persisted = read_review_session_with_connection(&conn, &session.id)
            .unwrap()
            .expect("session is persisted");
        assert_eq!(persisted.id, session.id);
        assert_eq!(persisted.repo, session.repo);
        assert_eq!(persisted.number, session.number);
        assert_eq!(persisted.status, session.status);
        assert_eq!(persisted.review_runtime, session.review_runtime);
        assert_eq!(persisted.runtime_model_choice, session.runtime_model_choice);
        assert_eq!(persisted.agent_session_id, session.agent_session_id);
    }

    #[test]
    fn persists_active_and_pending_effort_modes() {
        let conn = test_connection();
        let session = sample_session();
        upsert_review_session_with_connection(&conn, &session).unwrap();

        set_pending_review_effort_mode_with_connection(&conn, &session.id, "deep").unwrap();
        assert_eq!(
            read_review_effort_state_with_connection(&conn, &session.id).unwrap(),
            ReviewEffortState {
                active_mode: "fast".to_string(),
                pending_mode: Some("deep".to_string()),
            }
        );

        apply_review_effort_mode_with_connection(&conn, &session.id, "deep", 3).unwrap();
        assert_eq!(
            read_review_effort_state_with_connection(&conn, &session.id).unwrap(),
            ReviewEffortState {
                active_mode: "deep".to_string(),
                pending_mode: None,
            }
        );
    }

    #[test]
    fn records_and_reads_revision_checkpoints() {
        let conn = test_connection();
        let session = sample_session();
        upsert_review_session_with_connection(&conn, &session).unwrap();

        insert_revision_checkpoint_with_connection(&conn, &session.id, "head-a", "head-b", 4)
            .unwrap();
        insert_revision_checkpoint_with_connection(&conn, &session.id, "head-b", "head-c", 2)
            .unwrap();

        let checkpoints =
            read_review_revision_checkpoints_with_connection(&conn, &session.id).unwrap();
        assert_eq!(checkpoints.len(), 2);
        assert_eq!(checkpoints[0].head_sha, "head-c");
        assert_eq!(checkpoints[0].previous_head_sha, "head-b");
        assert_eq!(checkpoints[0].message_count, 2);
        assert_eq!(checkpoints[1].head_sha, "head-b");
        assert_eq!(checkpoints[1].previous_head_sha, "head-a");
        assert_eq!(checkpoints[1].message_count, 4);
    }

    #[test]
    fn does_not_duplicate_revision_checkpoints_for_same_transition_position() {
        let conn = test_connection();
        let session = sample_session();
        upsert_review_session_with_connection(&conn, &session).unwrap();

        insert_revision_checkpoint_with_connection(&conn, &session.id, "head-a", "head-b", 4)
            .unwrap();
        insert_revision_checkpoint_with_connection(&conn, &session.id, "head-a", "head-b", 4)
            .unwrap();
        insert_revision_checkpoint_with_connection(&conn, &session.id, "head-b", "head-b", 5)
            .unwrap();

        let checkpoints =
            read_review_revision_checkpoints_with_connection(&conn, &session.id).unwrap();
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].head_sha, "head-b");
        assert_eq!(checkpoints[0].previous_head_sha, "head-a");
        assert_eq!(checkpoints[0].message_count, 4);
    }

    #[test]
    fn replaces_review_chat_messages() {
        let mut conn = test_connection();
        let session = sample_session();
        upsert_review_session_with_connection(&conn, &session).unwrap();
        let messages = vec![
            serde_json::json!({ "id": "m1", "role": "user", "parts": [] }),
            serde_json::json!({ "id": "m2", "role": "assistant", "parts": [] }),
        ];

        replace_review_chat_messages_with_connection(&mut conn, &session.id, &messages).unwrap();

        assert_eq!(
            read_review_chat_messages_with_connection(&conn, &session.id).unwrap(),
            messages
        );
    }

    #[test]
    fn starts_updates_and_completes_active_review_chat_turn() {
        let mut conn = test_connection();
        let session = sample_session();
        upsert_review_session_with_connection(&conn, &session).unwrap();
        let request_message = serde_json::json!({
            "id": "user-turn-1",
            "role": "user",
            "parts": [{ "type": "text", "text": "/walkthrough" }]
        });
        let terminal_message = serde_json::json!({
            "id": "assistant-turn-1",
            "role": "assistant",
            "parts": [{ "type": "text", "text": "Done" }]
        });

        let active_turn = start_review_chat_turn_with_connection(
            &mut conn,
            StartReviewChatTurnInput {
                session_id: session.id.clone(),
                turn_id: "turn-1".to_string(),
                kind: ReviewChatTurnKind::Walkthrough,
                request_message: request_message.clone(),
                review_effort_mode: Some("fast".to_string()),
                runtime_model_choice: None,
                head_sha: session.head_sha.clone(),
                progress_message: Some("Preparing review context".to_string()),
            },
        )
        .unwrap();
        assert_eq!(active_turn.turn_id, "turn-1");
        assert_eq!(active_turn.kind, ReviewChatTurnKind::Walkthrough);
        assert_eq!(active_turn.status, ReviewChatTurnStatus::Running);
        assert_eq!(
            active_turn.activity_summary,
            vec![ReviewChatActiveTurnActivityItem::Progress {
                label: "Preparing review context".to_string()
            }]
        );
        assert_eq!(
            read_review_chat_messages_with_connection(&conn, &session.id).unwrap(),
            vec![request_message.clone()]
        );

        update_active_review_chat_turn_snapshot_with_connection(
            &conn,
            &session.id,
            "turn-1",
            "Formatting walkthrough",
            vec![ReviewChatActiveTurnActivityItem::Progress {
                label: "Formatting walkthrough".to_string(),
            }],
        )
        .unwrap();
        let updated_turn = read_active_review_chat_turn_with_connection(&conn, &session.id)
            .unwrap()
            .expect("active turn exists");
        assert_eq!(
            updated_turn.progress_message,
            Some("Formatting walkthrough".to_string())
        );
        assert_eq!(
            updated_turn.activity_summary,
            vec![ReviewChatActiveTurnActivityItem::Progress {
                label: "Formatting walkthrough".to_string()
            }]
        );

        complete_active_review_chat_turn_with_connection(
            &mut conn,
            &session.id,
            "turn-1",
            &terminal_message,
        )
        .unwrap();
        assert!(
            read_active_review_chat_turn_with_connection(&conn, &session.id)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            read_review_chat_messages_with_connection(&conn, &session.id).unwrap(),
            vec![request_message.clone(), terminal_message.clone()]
        );

        complete_active_review_chat_turn_with_connection(
            &mut conn,
            &session.id,
            "turn-1",
            &serde_json::json!({
                "id": "assistant-turn-1-duplicate",
                "role": "assistant",
                "parts": [{ "type": "text", "text": "Duplicate" }]
            }),
        )
        .unwrap();
        assert_eq!(
            read_review_chat_messages_with_connection(&conn, &session.id).unwrap(),
            vec![request_message, terminal_message]
        );
    }

    #[test]
    fn deletes_review_session_state_for_pull_request() {
        let mut conn = test_connection();
        let session = sample_session();
        upsert_review_session_with_connection(&conn, &session).unwrap();
        replace_review_chat_messages_with_connection(
            &mut conn,
            &session.id,
            &[serde_json::json!({ "id": "m1", "role": "user", "parts": [] })],
        )
        .unwrap();
        apply_review_effort_mode_with_connection(&conn, &session.id, "deep", 1).unwrap();

        delete_review_session_for_pull_request_with_connection(
            &conn,
            &session.repo,
            session.number,
        )
        .unwrap();

        assert!(read_review_session_with_connection(&conn, &session.id)
            .unwrap()
            .is_none());
        assert!(
            read_review_chat_messages_with_connection(&conn, &session.id)
                .unwrap()
                .is_empty()
        );
        assert!(
            read_review_revision_checkpoints_with_connection(&conn, &session.id)
                .unwrap()
                .is_empty()
        );
    }
}
