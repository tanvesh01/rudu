use rusqlite::{params, OptionalExtension};

use crate::support::now_unix_timestamp;

pub fn get_cached_patch(repo: &str, number: u32, head_sha: &str) -> Result<Option<String>, String> {
    let conn = super::open_cache_connection()?;
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
    let conn = super::open_cache_connection()?;
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
    let conn = super::open_cache_connection()?;
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
    let conn = super::open_cache_connection()?;
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
