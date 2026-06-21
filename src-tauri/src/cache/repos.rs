use rusqlite::params;

use crate::models::{RepoLanguage, RepoSummary};
use crate::support::{bool_to_sql, now_unix_timestamp, sql_to_bool};

pub fn update_repo_access_timestamp(repo: &str) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
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

pub fn read_saved_repos() -> Result<Vec<RepoSummary>, String> {
    let conn = super::open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT
                name,
                name_with_owner,
                description,
                is_private,
                languages_json,
                stargazer_count,
                fork_count,
                issue_count,
                pull_request_count,
                contributor_count
            FROM repos
            ORDER BY added_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare saved repos query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let languages_json: String = row.get(4)?;
            Ok(RepoSummary {
                name: row.get(0)?,
                name_with_owner: row.get(1)?,
                description: row.get(2)?,
                is_private: sql_to_bool(row.get(3)?),
                languages: serde_json::from_str::<Vec<RepoLanguage>>(&languages_json)
                    .unwrap_or_default(),
                stargazer_count: optional_u32(row.get(5)?),
                fork_count: optional_u32(row.get(6)?),
                issue_count: optional_u32(row.get(7)?),
                pull_request_count: optional_u32(row.get(8)?),
                contributor_count: optional_u32(row.get(9)?),
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
    let conn = super::open_cache_connection()?;
    let timestamp = now_unix_timestamp();
    let languages_json = serde_json::to_string(&repo.languages)
        .map_err(|error| format!("Failed to serialize repo languages: {error}"))?;

    conn.execute(
        "
        INSERT INTO repos (
            name,
            name_with_owner,
            description,
            is_private,
            languages_json,
            stargazer_count,
            fork_count,
            issue_count,
            pull_request_count,
            contributor_count,
            added_at,
            last_opened_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
        ON CONFLICT(name_with_owner)
        DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            is_private = excluded.is_private,
            languages_json = excluded.languages_json,
            stargazer_count = excluded.stargazer_count,
            fork_count = excluded.fork_count,
            issue_count = excluded.issue_count,
            pull_request_count = excluded.pull_request_count,
            contributor_count = excluded.contributor_count
        ",
        params![
            &repo.name,
            &repo.name_with_owner,
            &repo.description,
            bool_to_sql(repo.is_private),
            languages_json,
            optional_i64(repo.stargazer_count),
            optional_i64(repo.fork_count),
            optional_i64(repo.issue_count),
            optional_i64(repo.pull_request_count),
            optional_i64(repo.contributor_count),
            timestamp,
        ],
    )
    .map_err(|error| format!("Failed to save repo {}: {error}", repo.name_with_owner))?;

    Ok(())
}

fn optional_u32(value: Option<i64>) -> Option<u32> {
    value.and_then(|value| u32::try_from(value).ok())
}

fn optional_i64(value: Option<u32>) -> Option<i64> {
    value.map(i64::from)
}
