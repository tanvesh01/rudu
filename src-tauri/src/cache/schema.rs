use rusqlite::Connection;

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

fn migrate_repo_cache_schema(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "repos",
        "languages_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(conn, "repos", "stargazer_count", "INTEGER")?;
    add_column_if_missing(conn, "repos", "fork_count", "INTEGER")?;
    add_column_if_missing(conn, "repos", "issue_count", "INTEGER")?;
    add_column_if_missing(conn, "repos", "pull_request_count", "INTEGER")?;
    add_column_if_missing(conn, "repos", "contributor_count", "INTEGER")?;

    Ok(())
}

fn migrate_review_session_schema(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "review_sessions",
        "active_review_effort_mode",
        "TEXT NOT NULL DEFAULT 'fast'",
    )?;
    add_column_if_missing(
        conn,
        "review_sessions",
        "pending_review_effort_mode",
        "TEXT",
    )?;
    add_column_if_missing(
        conn,
        "review_sessions",
        "review_runtime",
        "TEXT NOT NULL DEFAULT 'codex'",
    )?;
    add_column_if_missing(conn, "review_sessions", "runtime_model_choice", "TEXT")?;

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

pub(crate) fn ensure_cache_schema(conn: &Connection) -> Result<(), String> {
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
            languages_json TEXT NOT NULL DEFAULT '[]',
            stargazer_count INTEGER,
            fork_count INTEGER,
            issue_count INTEGER,
            pull_request_count INTEGER,
            contributor_count INTEGER,
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
            review_runtime TEXT NOT NULL DEFAULT 'codex',
            runtime_model_choice TEXT,
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

        CREATE TABLE IF NOT EXISTS active_review_chat_turns (
            session_id TEXT PRIMARY KEY,
            turn_id TEXT NOT NULL UNIQUE,
            turn_kind TEXT NOT NULL,
            status TEXT NOT NULL,
            request_message_id TEXT NOT NULL,
            review_effort_mode TEXT,
            runtime_model_choice TEXT,
            head_sha TEXT NOT NULL,
            progress_message TEXT,
            activity_summary_json TEXT NOT NULL DEFAULT '[]',
            error_message TEXT,
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_active_review_chat_turns_turn_id
            ON active_review_chat_turns (turn_id);

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

    migrate_repo_cache_schema(conn)?;
    migrate_pull_request_cache_schema(conn)?;
    migrate_review_session_schema(conn)?;
    prune_legacy_pull_request_rows(conn)?;

    Ok(())
}
