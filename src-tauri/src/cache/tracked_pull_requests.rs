use rusqlite::{params, OptionalExtension};

use crate::models::PullRequestSummary;
use crate::support::{bool_to_sql, now_unix_timestamp};

pub fn read_all_tracked_pull_requests() -> Result<Vec<(String, PullRequestSummary)>, String> {
    let conn = super::open_cache_connection()?;
    read_all_tracked_pull_requests_with_connection(&conn)
}

fn read_all_tracked_pull_requests_with_connection(
    conn: &rusqlite::Connection,
) -> Result<Vec<(String, PullRequestSummary)>, String> {
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
                base_sha,
                repo_name_with_owner
            FROM tracked_pull_requests
            ORDER BY added_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare all tracked pull requests query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get(13)?,
                super::pull_requests::pull_request_from_row(row)?,
            ))
        })
        .map_err(|error| format!("Failed to load all tracked pull requests: {error}"))?;

    rows.map(|row| {
        row.map_err(|error| format!("Failed to parse tracked pull request row: {error}"))
    })
    .collect()
}

pub fn read_tracked_pull_requests(repo: &str) -> Result<Vec<PullRequestSummary>, String> {
    let conn = super::open_cache_connection()?;
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
        .query_map(params![repo], super::pull_requests::pull_request_from_row)
        .map_err(|error| format!("Failed to load tracked pull requests: {error}"))?;

    let mut tracked = Vec::new();
    for row in rows {
        tracked.push(
            row.map_err(|error| format!("Failed to parse tracked pull request row: {error}"))?,
        );
    }

    Ok(tracked)
}

pub fn find_tracked_pull_request(
    repo: &str,
    number: u32,
) -> Result<Option<(String, PullRequestSummary)>, String> {
    let conn = super::open_cache_connection()?;
    find_tracked_pull_request_with_connection(&conn, repo, number)
}

fn find_tracked_pull_request_with_connection(
    conn: &rusqlite::Connection,
    repo: &str,
    number: u32,
) -> Result<Option<(String, PullRequestSummary)>, String> {
    let canonical_repo = conn
        .query_row(
            "SELECT repo_name_with_owner FROM tracked_pull_requests WHERE repo_name_with_owner = ?1 COLLATE NOCASE AND pr_number = ?2",
            params![repo, number],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to find tracked pull request: {error}"))?;
    let Some(canonical_repo) = canonical_repo else {
        return Ok(None);
    };
    let summary = conn
        .query_row(
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
        WHERE repo_name_with_owner = ?1 COLLATE NOCASE
          AND pr_number = ?2
        ",
            params![&canonical_repo, number],
            super::pull_requests::pull_request_from_row,
        )
        .map_err(|error| format!("Failed to load tracked pull request: {error}"))?;
    Ok(Some((canonical_repo, summary)))
}

pub fn track_pull_request(repo: &str, pull_request: &PullRequestSummary) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
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
    let conn = super::open_cache_connection()?;
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

    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{
        find_tracked_pull_request_with_connection, read_all_tracked_pull_requests_with_connection,
    };

    #[test]
    fn finds_tracked_pull_requests_case_insensitively_and_returns_canonical_repo() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE tracked_pull_requests (
                repo_name_with_owner TEXT NOT NULL, pr_number INTEGER NOT NULL,
                title TEXT NOT NULL, state TEXT NOT NULL, is_draft INTEGER NOT NULL,
                merge_state_status TEXT NOT NULL, mergeable TEXT NOT NULL,
                additions INTEGER NOT NULL, deletions INTEGER NOT NULL,
                author_login TEXT NOT NULL, updated_at TEXT NOT NULL, url TEXT NOT NULL,
                head_sha TEXT NOT NULL, base_sha TEXT, added_at INTEGER NOT NULL
            );
            INSERT INTO tracked_pull_requests VALUES
                ('OuterWorld/Rudu', 42, 'PR', 'OPEN', 0, 'CLEAN', 'MERGEABLE', 1, 0, 'user', 'now', 'url', 'head', NULL, 1),
                ('Another/Repo', 7, 'Other', 'OPEN', 0, 'CLEAN', 'MERGEABLE', 2, 1, 'other', 'later', 'other-url', 'other-head', NULL, 2);
            ",
        )
        .unwrap();

        let (repo, pull_request) =
            find_tracked_pull_request_with_connection(&conn, "outerworld/rudu", 42)
                .unwrap()
                .unwrap();
        assert_eq!(repo, "OuterWorld/Rudu");
        assert_eq!(pull_request.core.number, 42);
        assert!(
            find_tracked_pull_request_with_connection(&conn, "outerworld/rudu", 7)
                .unwrap()
                .is_none()
        );

        let tracked = read_all_tracked_pull_requests_with_connection(&conn).unwrap();
        assert_eq!(tracked.len(), 2);
        assert_eq!(tracked[0].0, "Another/Repo");
        assert_eq!(tracked[1].1.core.number, 42);
    }
}
