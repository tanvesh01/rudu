use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::models::{
    PullRequestCore, PullRequestSummary, RepoSummary, ReviewSession, ReviewSessionStatus,
};
use crate::support::{bool_to_sql, now_unix_timestamp, sql_to_bool};

static CACHE_DB_PATH: OnceLock<PathBuf> = OnceLock::new();

fn table_has_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = conn
        .prepare(&pragma)
        .map_err(|error| format!("Failed to inspect table {table_name}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to read table metadata for {table_name}: {error}"))?;

    for row in rows {
        let current_column = row
            .map_err(|error| format!("Failed to parse table metadata for {table_name}: {error}"))?;
        if current_column == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn add_column_if_missing(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), String> {
    if table_has_column(conn, table_name, column_name)? {
        return Ok(());
    }

    let alter_query = format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}");
    conn.execute(&alter_query, [])
        .map_err(|error| format!("Failed to add {column_name} to {table_name}: {error}"))?;

    Ok(())
}

fn migrate_pull_request_cache_schema(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "repo_pull_requests",
        "is_draft",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        conn,
        "repo_pull_requests",
        "merge_state_status",
        "TEXT NOT NULL DEFAULT 'UNKNOWN'",
    )?;
    add_column_if_missing(
        conn,
        "repo_pull_requests",
        "mergeable",
        "TEXT NOT NULL DEFAULT 'UNKNOWN'",
    )?;
    add_column_if_missing(
        conn,
        "repo_pull_requests",
        "additions",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        conn,
        "repo_pull_requests",
        "deletions",
        "INTEGER NOT NULL DEFAULT 0",
    )?;

    Ok(())
}

fn prune_legacy_pull_request_rows(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "
        DELETE FROM repo_pull_requests
        WHERE merge_state_status = 'UNKNOWN'
          AND mergeable = 'UNKNOWN'
          AND additions = 0
          AND deletions = 0
        ",
        [],
    )
    .map_err(|error| format!("Failed to prune legacy pull request cache rows: {error}"))?;

    Ok(())
}

pub fn cache_db_path() -> Result<&'static PathBuf, String> {
    CACHE_DB_PATH
        .get()
        .ok_or_else(|| "Cache database path is not initialized".to_string())
}

pub fn set_cache_db_path(path: PathBuf) -> Result<(), PathBuf> {
    CACHE_DB_PATH.set(path)
}

pub fn open_cache_connection() -> Result<Connection, String> {
    let path = cache_db_path()?;

    ensure_cache_parent(path)?;
    let conn = Connection::open(path).map_err(|error| {
        format!(
            "Failed to open cache database at {}: {error}",
            path.display()
        )
    })?;
    ensure_cache_schema(&conn)?;
    Ok(conn)
}

fn ensure_cache_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create cache directory {}: {error}",
                parent.display()
            )
        })?;
    }

    Ok(())
}

pub fn initialize_cache_database(path: &Path) -> Result<(), String> {
    ensure_cache_parent(path)?;

    let conn = Connection::open(path).map_err(|error| {
        format!(
            "Failed to initialize cache database at {}: {error}",
            path.display()
        )
    })?;

    ensure_cache_schema(&conn)
}

fn ensure_cache_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS repos (
            name_with_owner TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            is_private INTEGER,
            added_at INTEGER NOT NULL,
            last_opened_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS repo_pull_requests (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            state TEXT NOT NULL,
            is_draft INTEGER NOT NULL DEFAULT 0,
            merge_state_status TEXT NOT NULL DEFAULT 'UNKNOWN',
            mergeable TEXT NOT NULL DEFAULT 'UNKNOWN',
            additions INTEGER NOT NULL DEFAULT 0,
            deletions INTEGER NOT NULL DEFAULT 0,
            author_login TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            url TEXT NOT NULL,
            head_sha TEXT NOT NULL,
            base_sha TEXT,
            cached_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number)
        );

        CREATE INDEX IF NOT EXISTS idx_repo_pull_requests_repo_updated
            ON repo_pull_requests (repo_name_with_owner, updated_at DESC);

        CREATE TABLE IF NOT EXISTS pr_patch_cache (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            head_sha TEXT NOT NULL,
            patch_text TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            last_accessed_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number, head_sha)
        );

        CREATE TABLE IF NOT EXISTS pr_changed_files_cache (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            head_sha TEXT NOT NULL,
            files_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            last_accessed_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number, head_sha)
        );

        CREATE TABLE IF NOT EXISTS tracked_pull_requests (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            state TEXT NOT NULL,
            is_draft INTEGER NOT NULL DEFAULT 0,
            merge_state_status TEXT NOT NULL DEFAULT 'UNKNOWN',
            mergeable TEXT NOT NULL DEFAULT 'UNKNOWN',
            additions INTEGER NOT NULL DEFAULT 0,
            deletions INTEGER NOT NULL DEFAULT 0,
            author_login TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            url TEXT NOT NULL,
            head_sha TEXT NOT NULL,
            base_sha TEXT,
            added_at INTEGER NOT NULL,
            last_refreshed_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number)
        );

        CREATE INDEX IF NOT EXISTS idx_tracked_pull_requests_repo_added
            ON tracked_pull_requests (repo_name_with_owner, added_at DESC);

        CREATE TABLE IF NOT EXISTS review_sessions (
            id TEXT PRIMARY KEY,
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            head_sha TEXT NOT NULL,
            status TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            agent_session_id TEXT,
            agent_context_head_sha TEXT,
            active_review_effort_mode TEXT NOT NULL DEFAULT 'fast',
            pending_review_effort_mode TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_error TEXT,
            UNIQUE (repo_name_with_owner, pr_number)
        );

        CREATE INDEX IF NOT EXISTS idx_review_sessions_repo_pr
            ON review_sessions (repo_name_with_owner, pr_number);

        CREATE TABLE IF NOT EXISTS review_chat_messages (
            session_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            role TEXT NOT NULL,
            message_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, message_id),
            FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_review_chat_messages_session_position
            ON review_chat_messages (session_id, position);

        CREATE TABLE IF NOT EXISTS review_chat_timeline_events (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            event_kind TEXT NOT NULL,
            event_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_review_chat_timeline_events_session_position
            ON review_chat_timeline_events (session_id, position);
        ",
    )
    .map_err(|error| format!("Failed to initialize cache schema: {error}"))?;

    migrate_pull_request_cache_schema(&conn)?;
    prune_legacy_pull_request_rows(&conn)?;

    Ok(())
}

pub fn read_cached_pull_requests(repo: &str) -> Result<Vec<PullRequestSummary>, String> {
    let conn = open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT
                pr_number,
                title,
                state,
                is_draft,
                merge_state_status,
                mergeable,
                additions,
                deletions,
                author_login,
                updated_at,
                url,
                head_sha,
                base_sha
            FROM repo_pull_requests
            WHERE repo_name_with_owner = ?1
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare cached pull requests query: {error}"))?;

    let rows = statement
        .query_map(params![repo], |row| {
            Ok(PullRequestSummary {
                core: PullRequestCore {
                    number: row.get(0)?,
                    title: row.get(1)?,
                    state: row.get(2)?,
                    updated_at: row.get(9)?,
                    url: row.get(10)?,
                },
                is_draft: row.get::<_, i64>(3)? != 0,
                merge_state_status: row.get(4)?,
                mergeable: row.get(5)?,
                additions: row.get(6)?,
                deletions: row.get(7)?,
                author_login: row.get(8)?,
                head_sha: row.get(11)?,
                base_sha: row.get(12)?,
            })
        })
        .map_err(|error| format!("Failed to read cached pull requests: {error}"))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(
            row.map_err(|error| format!("Failed to parse cached pull request row: {error}"))?,
        );
    }

    let has_only_legacy_rows = !results.is_empty()
        && results.iter().all(|pull_request| {
            pull_request.merge_state_status == "UNKNOWN"
                && pull_request.mergeable == "UNKNOWN"
                && pull_request.additions == 0
                && pull_request.deletions == 0
        });

    if has_only_legacy_rows {
        return Ok(Vec::new());
    }

    Ok(results)
}

pub fn write_pull_requests_cache(
    repo: &str,
    pull_requests: &[PullRequestSummary],
) -> Result<(), String> {
    let mut conn = open_cache_connection()?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start pull request cache transaction: {error}"))?;

    tx.execute(
        "DELETE FROM repo_pull_requests WHERE repo_name_with_owner = ?1",
        params![repo],
    )
    .map_err(|error| format!("Failed to clear cached pull requests: {error}"))?;

    let timestamp = now_unix_timestamp();

    for pull_request in pull_requests {
        tx.execute(
            "
            INSERT INTO repo_pull_requests (
                repo_name_with_owner,
                pr_number,
                title,
                state,
                is_draft,
                merge_state_status,
                mergeable,
                additions,
                deletions,
                author_login,
                updated_at,
                url,
                head_sha,
                base_sha,
                cached_at,
                last_seen_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
            ",
            params![
                repo,
                pull_request.core.number,
                pull_request.core.title,
                pull_request.core.state,
                bool_to_sql(Some(pull_request.is_draft)),
                pull_request.merge_state_status,
                pull_request.mergeable,
                pull_request.additions,
                pull_request.deletions,
                pull_request.author_login,
                pull_request.core.updated_at,
                pull_request.core.url,
                pull_request.head_sha,
                pull_request.base_sha,
                timestamp,
            ],
        )
        .map_err(|error| {
            format!(
                "Failed to cache pull request {}: {error}",
                pull_request.core.number
            )
        })?;
    }

    tx.commit()
        .map_err(|error| format!("Failed to commit pull request cache transaction: {error}"))
}

pub fn upsert_pull_request_summary(
    repo: &str,
    pull_request: &PullRequestSummary,
) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        INSERT INTO repo_pull_requests (
            repo_name_with_owner,
            pr_number,
            title,
            state,
            is_draft,
            merge_state_status,
            mergeable,
            additions,
            deletions,
            author_login,
            updated_at,
            url,
            head_sha,
            base_sha,
            cached_at,
            last_seen_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
        ON CONFLICT(repo_name_with_owner, pr_number)
        DO UPDATE SET
            title = excluded.title,
            state = excluded.state,
            is_draft = excluded.is_draft,
            merge_state_status = excluded.merge_state_status,
            mergeable = excluded.mergeable,
            additions = excluded.additions,
            deletions = excluded.deletions,
            author_login = excluded.author_login,
            updated_at = excluded.updated_at,
            url = excluded.url,
            head_sha = excluded.head_sha,
            base_sha = excluded.base_sha,
            cached_at = excluded.cached_at,
            last_seen_at = excluded.last_seen_at
        ",
        params![
            repo,
            pull_request.core.number,
            pull_request.core.title,
            pull_request.core.state,
            bool_to_sql(Some(pull_request.is_draft)),
            pull_request.merge_state_status,
            pull_request.mergeable,
            pull_request.additions,
            pull_request.deletions,
            pull_request.author_login,
            pull_request.core.updated_at,
            pull_request.core.url,
            pull_request.head_sha,
            pull_request.base_sha,
            timestamp,
        ],
    )
    .map_err(|error| {
        format!(
            "Failed to upsert cached pull request {}: {error}",
            pull_request.core.number
        )
    })?;

    conn.execute(
        "
        UPDATE tracked_pull_requests
        SET
            title = ?3,
            state = ?4,
            is_draft = ?5,
            merge_state_status = ?6,
            mergeable = ?7,
            additions = ?8,
            deletions = ?9,
            author_login = ?10,
            updated_at = ?11,
            url = ?12,
            head_sha = ?13,
            base_sha = ?14,
            last_refreshed_at = ?15
        WHERE repo_name_with_owner = ?1
          AND pr_number = ?2
        ",
        params![
            repo,
            pull_request.core.number,
            pull_request.core.title,
            pull_request.core.state,
            bool_to_sql(Some(pull_request.is_draft)),
            pull_request.merge_state_status,
            pull_request.mergeable,
            pull_request.additions,
            pull_request.deletions,
            pull_request.author_login,
            pull_request.core.updated_at,
            pull_request.core.url,
            pull_request.head_sha,
            pull_request.base_sha,
            timestamp,
        ],
    )
    .map_err(|error| {
        format!(
            "Failed to update tracked pull request {}: {error}",
            pull_request.core.number
        )
    })?;

    Ok(())
}

pub fn get_cached_patch(repo: &str, number: u32, head_sha: &str) -> Result<Option<String>, String> {
    let conn = open_cache_connection()?;
    let patch = conn
        .query_row(
            "
            SELECT patch_text
            FROM pr_patch_cache
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
              AND head_sha = ?3
            ",
            params![repo, number, head_sha],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to query cached patch: {error}"))?;

    if patch.is_some() {
        conn.execute(
            "
            UPDATE pr_patch_cache
            SET last_accessed_at = ?4
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
              AND head_sha = ?3
            ",
            params![repo, number, head_sha, now_unix_timestamp()],
        )
        .map_err(|error| format!("Failed to update patch cache access time: {error}"))?;
    }

    Ok(patch)
}

pub fn store_patch(repo: &str, number: u32, head_sha: &str, patch: &str) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let timestamp = now_unix_timestamp();
    conn.execute(
        "
        INSERT INTO pr_patch_cache (
            repo_name_with_owner,
            pr_number,
            head_sha,
            patch_text,
            cached_at,
            last_accessed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?5)
        ON CONFLICT(repo_name_with_owner, pr_number, head_sha)
        DO UPDATE SET
            patch_text = excluded.patch_text,
            cached_at = excluded.cached_at,
            last_accessed_at = excluded.last_accessed_at
        ",
        params![repo, number, head_sha, patch, timestamp],
    )
    .map_err(|error| format!("Failed to persist patch cache: {error}"))?;

    Ok(())
}

pub fn get_cached_changed_files(
    repo: &str,
    number: u32,
    head_sha: &str,
) -> Result<Option<Vec<String>>, String> {
    let conn = open_cache_connection()?;
    let files_json = conn
        .query_row(
            "
            SELECT files_json
            FROM pr_changed_files_cache
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
              AND head_sha = ?3
            ",
            params![repo, number, head_sha],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to query cached changed files: {error}"))?;

    let Some(files_json) = files_json else {
        return Ok(None);
    };

    conn.execute(
        "
        UPDATE pr_changed_files_cache
        SET last_accessed_at = ?4
        WHERE repo_name_with_owner = ?1
          AND pr_number = ?2
          AND head_sha = ?3
        ",
        params![repo, number, head_sha, now_unix_timestamp()],
    )
    .map_err(|error| format!("Failed to update changed files cache access time: {error}"))?;

    let files = serde_json::from_str::<Vec<String>>(&files_json)
        .map_err(|error| format!("Failed to parse cached changed files: {error}"))?;

    Ok(Some(files))
}

pub fn store_changed_files(
    repo: &str,
    number: u32,
    head_sha: &str,
    files: &[String],
) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let files_json = serde_json::to_string(files)
        .map_err(|error| format!("Failed to serialize changed files for cache: {error}"))?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        INSERT INTO pr_changed_files_cache (
            repo_name_with_owner,
            pr_number,
            head_sha,
            files_json,
            cached_at,
            last_accessed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?5)
        ON CONFLICT(repo_name_with_owner, pr_number, head_sha)
        DO UPDATE SET
            files_json = excluded.files_json,
            cached_at = excluded.cached_at,
            last_accessed_at = excluded.last_accessed_at
        ",
        params![repo, number, head_sha, files_json, timestamp],
    )
    .map_err(|error| format!("Failed to persist changed files cache: {error}"))?;

    Ok(())
}

pub fn update_repo_access_timestamp(repo: &str) -> Result<(), String> {
    let conn = open_cache_connection()?;
    conn.execute(
        "
        UPDATE repos
        SET last_opened_at = ?2
        WHERE name_with_owner = ?1
        ",
        params![repo, now_unix_timestamp()],
    )
    .map_err(|error| format!("Failed to update repo access timestamp: {error}"))?;

    Ok(())
}

pub fn read_tracked_pull_requests(repo: &str) -> Result<Vec<PullRequestSummary>, String> {
    let conn = open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT
                pr_number,
                title,
                state,
                is_draft,
                merge_state_status,
                mergeable,
                additions,
                deletions,
                author_login,
                updated_at,
                url,
                head_sha,
                base_sha
            FROM tracked_pull_requests
            WHERE repo_name_with_owner = ?1
            ORDER BY added_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare tracked pull requests query: {error}"))?;

    let rows = statement
        .query_map(params![repo], |row| {
            Ok(PullRequestSummary {
                core: PullRequestCore {
                    number: row.get(0)?,
                    title: row.get(1)?,
                    state: row.get(2)?,
                    updated_at: row.get(9)?,
                    url: row.get(10)?,
                },
                is_draft: row.get::<_, i64>(3)? != 0,
                merge_state_status: row.get(4)?,
                mergeable: row.get(5)?,
                additions: row.get(6)?,
                deletions: row.get(7)?,
                author_login: row.get(8)?,
                head_sha: row.get(11)?,
                base_sha: row.get(12)?,
            })
        })
        .map_err(|error| format!("Failed to load tracked pull requests: {error}"))?;

    let mut tracked = Vec::new();
    for row in rows {
        tracked.push(
            row.map_err(|error| format!("Failed to parse tracked pull request row: {error}"))?,
        );
    }

    Ok(tracked)
}

pub fn track_pull_request(repo: &str, pull_request: &PullRequestSummary) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        INSERT INTO tracked_pull_requests (
            repo_name_with_owner,
            pr_number,
            title,
            state,
            is_draft,
            merge_state_status,
            mergeable,
            additions,
            deletions,
            author_login,
            updated_at,
            url,
            head_sha,
            base_sha,
            added_at,
            last_refreshed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
        ON CONFLICT(repo_name_with_owner, pr_number)
        DO UPDATE SET
            title = excluded.title,
            state = excluded.state,
            is_draft = excluded.is_draft,
            merge_state_status = excluded.merge_state_status,
            mergeable = excluded.mergeable,
            additions = excluded.additions,
            deletions = excluded.deletions,
            author_login = excluded.author_login,
            updated_at = excluded.updated_at,
            url = excluded.url,
            head_sha = excluded.head_sha,
            base_sha = excluded.base_sha,
            last_refreshed_at = excluded.last_refreshed_at
        ",
        params![
            repo,
            pull_request.core.number,
            pull_request.core.title,
            pull_request.core.state,
            bool_to_sql(Some(pull_request.is_draft)),
            pull_request.merge_state_status,
            pull_request.mergeable,
            pull_request.additions,
            pull_request.deletions,
            pull_request.author_login,
            pull_request.core.updated_at,
            pull_request.core.url,
            pull_request.head_sha,
            pull_request.base_sha,
            timestamp,
        ],
    )
    .map_err(|error| {
        format!(
            "Failed to track pull request {} for {}: {error}",
            pull_request.core.number, repo
        )
    })?;

    Ok(())
}

pub fn remove_tracked_pull_request(repo: &str, number: u32) -> Result<(), String> {
    let conn = open_cache_connection()?;
    conn.execute(
        "
        DELETE FROM tracked_pull_requests
        WHERE repo_name_with_owner = ?1
          AND pr_number = ?2
        ",
        params![repo, number],
    )
    .map_err(|error| {
        format!("Failed to remove tracked pull request #{number} for {repo}: {error}")
    })?;

    delete_review_session_for_pull_request_with_connection(&conn, repo, number)?;

    Ok(())
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

fn review_chat_message_field<'a>(message: &'a Value, field: &str) -> Result<&'a str, String> {
    message
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Review chat message is missing {field}"))
}

pub fn upsert_review_session(session: &ReviewSession) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let status = review_session_status_to_sql(session.status)?;

    conn.execute(
        "
        INSERT INTO review_sessions (
            id,
            repo_name_with_owner,
            pr_number,
            head_sha,
            status,
            workspace_path,
            agent_session_id,
            agent_context_head_sha,
            created_at,
            updated_at,
            last_error
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id)
        DO UPDATE SET
            repo_name_with_owner = excluded.repo_name_with_owner,
            pr_number = excluded.pr_number,
            head_sha = excluded.head_sha,
            status = excluded.status,
            workspace_path = excluded.workspace_path,
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

pub fn read_review_session(session_id: &str) -> Result<Option<ReviewSession>, String> {
    let conn = open_cache_connection()?;
    conn.query_row(
        "
        SELECT
            id,
            repo_name_with_owner,
            pr_number,
            head_sha,
            status,
            workspace_path,
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
            Ok((
                ReviewSession {
                    id: row.get(0)?,
                    repo: row.get(1)?,
                    number: row.get(2)?,
                    head_sha: row.get(3)?,
                    status: ReviewSessionStatus::Prepared,
                    workspace_path: row.get(5)?,
                    agent_session_id: row.get(6)?,
                    agent_context_head_sha: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    last_error: row.get(10)?,
                },
                status,
            ))
        },
    )
    .optional()
    .map_err(|error| format!("Failed to read review session {session_id}: {error}"))?
    .map(|(mut session, status)| {
        session.status = review_session_status_from_sql(status)?;
        Ok(session)
    })
    .transpose()
}

pub fn read_review_session_effort_modes(
    session_id: &str,
) -> Result<(String, Option<String>), String> {
    let conn = open_cache_connection()?;
    conn.query_row(
        "
        SELECT active_review_effort_mode, pending_review_effort_mode
        FROM review_sessions
        WHERE id = ?1
        ",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|error| {
        format!("Failed to read review chat effort mode for session {session_id}: {error}")
    })
    .map(|modes| modes.unwrap_or_else(|| ("fast".to_string(), None)))
}

pub fn set_review_session_active_effort_mode(session_id: &str, mode: &str) -> Result<(), String> {
    let conn = open_cache_connection()?;
    conn.execute(
        "
        UPDATE review_sessions
        SET active_review_effort_mode = ?2,
            pending_review_effort_mode = NULL,
            updated_at = ?3
        WHERE id = ?1
        ",
        params![session_id, mode, now_unix_timestamp()],
    )
    .map_err(|error| {
        format!("Failed to persist review chat effort mode for session {session_id}: {error}")
    })?;

    Ok(())
}

pub fn read_review_chat_messages(session_id: &str) -> Result<Vec<Value>, String> {
    let conn = open_cache_connection()?;
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

pub fn replace_review_chat_messages(session_id: &str, messages: &[Value]) -> Result<(), String> {
    let mut conn = open_cache_connection()?;
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

pub fn read_saved_repos() -> Result<Vec<RepoSummary>, String> {
    let conn = open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT name, name_with_owner, description, is_private
            FROM repos
            ORDER BY added_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare saved repos query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(RepoSummary {
                name: row.get(0)?,
                name_with_owner: row.get(1)?,
                description: row.get(2)?,
                is_private: sql_to_bool(row.get(3)?),
            })
        })
        .map_err(|error| format!("Failed to load saved repos: {error}"))?;

    let mut repos = Vec::new();
    for row in rows {
        repos.push(row.map_err(|error| format!("Failed to parse saved repo row: {error}"))?);
    }

    Ok(repos)
}

pub fn save_repo_to_cache(repo: &RepoSummary) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        INSERT INTO repos (
            name,
            name_with_owner,
            description,
            is_private,
            added_at,
            last_opened_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?5)
        ON CONFLICT(name_with_owner)
        DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            is_private = excluded.is_private
        ",
        params![
            &repo.name,
            &repo.name_with_owner,
            &repo.description,
            bool_to_sql(repo.is_private),
            timestamp,
        ],
    )
    .map_err(|error| format!("Failed to save repo {}: {error}", repo.name_with_owner))?;

    Ok(())
}
