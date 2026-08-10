use rusqlite::{params, OptionalExtension};

use crate::models::LocalCheckout;
use crate::support::now_unix_timestamp;

pub fn save_local_checkout(checkout: &LocalCheckout) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
    conn.execute(
        "
        INSERT INTO local_checkouts (
            id,
            path,
            repository_key,
            folder_name,
            branch,
            github_repo,
            added_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(path)
        DO UPDATE SET
            repository_key = excluded.repository_key,
            folder_name = excluded.folder_name,
            branch = excluded.branch,
            github_repo = excluded.github_repo
        ",
        params![
            checkout.id,
            checkout.path,
            checkout.repository_key,
            checkout.folder_name,
            checkout.branch,
            checkout.github_repo,
            now_unix_timestamp(),
        ],
    )
    .map_err(|error| format!("Failed to save local checkout: {error}"))?;
    Ok(())
}

pub fn read_local_checkouts() -> Result<Vec<LocalCheckout>, String> {
    let conn = super::open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT id, path, repository_key, folder_name, branch, github_repo
            FROM local_checkouts
            ORDER BY added_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare local checkout query: {error}"))?;
    let rows = statement
        .query_map([], checkout_from_row)
        .map_err(|error| format!("Failed to load local checkouts: {error}"))?;
    rows.map(|row| row.map_err(|error| format!("Failed to parse local checkout: {error}")))
        .collect()
}

pub fn find_local_checkout(id: &str) -> Result<Option<LocalCheckout>, String> {
    let conn = super::open_cache_connection()?;
    conn.query_row(
        "
        SELECT id, path, repository_key, folder_name, branch, github_repo
        FROM local_checkouts
        WHERE id = ?1
        ",
        [id],
        checkout_from_row,
    )
    .optional()
    .map_err(|error| format!("Failed to find local checkout: {error}"))
}

pub fn remove_local_checkout(id: &str) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
    conn.execute("DELETE FROM local_checkouts WHERE id = ?1", [id])
        .map_err(|error| format!("Failed to remove local checkout: {error}"))?;
    Ok(())
}

fn checkout_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalCheckout> {
    Ok(LocalCheckout {
        id: row.get(0)?,
        path: row.get(1)?,
        repository_key: row.get(2)?,
        folder_name: row.get(3)?,
        branch: row.get(4)?,
        github_repo: row.get(5)?,
        available: true,
    })
}
