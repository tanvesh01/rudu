use rusqlite::params;

use crate::models::PullRequestSummary;
use crate::support::{bool_to_sql, now_unix_timestamp};

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
