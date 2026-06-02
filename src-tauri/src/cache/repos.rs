use rusqlite::params;

use crate::models::RepoSummary;
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
    let conn = super::open_cache_connection()?;
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
