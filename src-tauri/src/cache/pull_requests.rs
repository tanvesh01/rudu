use rusqlite::{params, OptionalExtension, Row};

use crate::models::{PullRequestCore, PullRequestSummary};
use crate::support::{bool_to_sql, now_unix_timestamp};

pub(crate) fn pull_request_from_row(row: &Row<'_>) -> rusqlite::Result<PullRequestSummary> {
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
}

pub fn read_cached_pull_requests(repo: &str) -> Result<Vec<PullRequestSummary>, String> {
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
            FROM repo_pull_requests
            WHERE repo_name_with_owner = ?1
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare cached pull requests query: {error}"))?;

    let rows = statement
        .query_map(params![repo], pull_request_from_row)
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

pub fn find_open_pr_for_head(
    repo: &str,
    head_sha: &str,
) -> Result<Option<PullRequestSummary>, String> {
    let conn = super::open_cache_connection()?;
    find_open_pr_for_head_with_connection(&conn, repo, head_sha)
}

fn find_open_pr_for_head_with_connection(
    conn: &rusqlite::Connection,
    repo: &str,
    head_sha: &str,
) -> Result<Option<PullRequestSummary>, String> {
    conn.query_row(
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
        WHERE repo_name_with_owner = ?1 COLLATE NOCASE
          AND head_sha = ?2
          AND state = 'OPEN' COLLATE NOCASE
        ORDER BY updated_at DESC
        LIMIT 1
        ",
        params![repo, head_sha],
        pull_request_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to find related pull request: {error}"))
}

pub fn write_pull_requests_cache(
    repo: &str,
    pull_requests: &[PullRequestSummary],
) -> Result<(), String> {
    let mut conn = super::open_cache_connection()?;
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
    let conn = super::open_cache_connection()?;
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

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::find_open_pr_for_head_with_connection;

    #[test]
    fn finds_only_open_pull_requests_with_the_exact_head() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE repo_pull_requests (
                repo_name_with_owner TEXT NOT NULL, pr_number INTEGER NOT NULL,
                title TEXT NOT NULL, state TEXT NOT NULL, is_draft INTEGER NOT NULL,
                merge_state_status TEXT NOT NULL, mergeable TEXT NOT NULL,
                additions INTEGER NOT NULL, deletions INTEGER NOT NULL,
                author_login TEXT NOT NULL, updated_at TEXT NOT NULL, url TEXT NOT NULL,
                head_sha TEXT NOT NULL, base_sha TEXT
            );
            INSERT INTO repo_pull_requests VALUES
                ('outerworld/rudu', 1, 'open', 'OPEN', 0, 'CLEAN', 'MERGEABLE', 1, 0, 'user', '2', 'url', 'exact', NULL),
                ('outerworld/rudu', 2, 'closed', 'CLOSED', 0, 'CLEAN', 'MERGEABLE', 1, 0, 'user', '3', 'url', 'closed', NULL),
                ('other/rudu', 3, 'other', 'OPEN', 0, 'CLEAN', 'MERGEABLE', 1, 0, 'user', '4', 'url', 'exact', NULL);
            ",
        )
        .unwrap();

        let related = find_open_pr_for_head_with_connection(&conn, "OUTERWORLD/RUDU", "exact")
            .unwrap()
            .unwrap();
        assert_eq!(related.core.number, 1);
        assert!(
            find_open_pr_for_head_with_connection(&conn, "outerworld/rudu", "closed")
                .unwrap()
                .is_none()
        );
        assert!(
            find_open_pr_for_head_with_connection(&conn, "outerworld/rudu", "missing")
                .unwrap()
                .is_none()
        );
    }
}
