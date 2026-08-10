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

fn migrate_review_notes_schema(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(
        conn,
        "review_notes",
        "side",
        "TEXT NOT NULL DEFAULT 'additions' CHECK(side IN ('additions', 'deletions'))",
    )?;
    add_column_if_missing(conn, "review_notes", "start_line", "INTEGER")?;
    add_column_if_missing(
        conn,
        "review_notes",
        "start_side",
        "TEXT CHECK(start_side IS NULL OR start_side IN ('additions', 'deletions'))",
    )?;
    add_column_if_missing(conn, "review_notes", "reply_to_id", "TEXT")?;
    add_column_if_missing(
        conn,
        "review_notes",
        "scope",
        "TEXT NOT NULL DEFAULT 'working-tree'",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_notes_checkout_scope ON review_notes (checkout_id, scope, created_at ASC)",
        [],
    )
    .map_err(|error| format!("Failed to create scoped review notes index: {error}"))?;
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

        CREATE TABLE IF NOT EXISTS local_checkouts (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            repository_key TEXT NOT NULL,
            folder_name TEXT NOT NULL,
            branch TEXT NOT NULL,
            github_repo TEXT,
            added_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_local_checkouts_repository_added
            ON local_checkouts (repository_key, added_at ASC);

        CREATE TABLE IF NOT EXISTS review_notes (
            id TEXT PRIMARY KEY,
            checkout_id TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'working-tree',
            file_path TEXT NOT NULL,
            line INTEGER NOT NULL,
            side TEXT NOT NULL DEFAULT 'additions' CHECK(side IN ('additions', 'deletions')),
            start_line INTEGER,
            start_side TEXT CHECK(start_side IS NULL OR start_side IN ('additions', 'deletions')),
            reply_to_id TEXT,
            body TEXT NOT NULL,
            author TEXT NOT NULL CHECK(author IN ('user', 'agent')),
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_review_notes_checkout
            ON review_notes (checkout_id, created_at ASC);

        ",
    )
    .map_err(|error| format!("Failed to initialize cache schema: {error}"))?;

    migrate_repo_cache_schema(conn)?;
    migrate_pull_request_cache_schema(conn)?;
    migrate_review_notes_schema(conn)?;
    prune_legacy_pull_request_rows(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::ensure_cache_schema;

    #[test]
    fn migrates_existing_review_notes_to_additions_side() {
        let conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            "
            CREATE TABLE review_notes (
                id TEXT PRIMARY KEY,
                checkout_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                line INTEGER NOT NULL,
                body TEXT NOT NULL,
                author TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            INSERT INTO review_notes VALUES ('note-1', 'checkout-1', 'src/lib.rs', 7, 'note', 'agent', 1);
            ",
        )
        .expect("create legacy schema");

        ensure_cache_schema(&conn).expect("migrate schema");

        let (side, reply_to_id, scope): (String, Option<String>, String) = conn
            .query_row(
                "SELECT side, reply_to_id, scope FROM review_notes WHERE id = 'note-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read migrated note");
        assert_eq!(side, "additions");
        assert_eq!(reply_to_id, None);
        assert_eq!(scope, "working-tree");
    }
}
