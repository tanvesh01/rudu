use rusqlite::params;

use crate::models::ReviewNote;
use crate::support::now_unix_timestamp;

pub fn save_review_note(note: &ReviewNote) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
    conn.execute(
        "
        INSERT INTO review_notes (
            id, checkout_id, file_path, line, side, start_line, start_side, body, author, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ",
        params![
            note.id,
            note.checkout_id,
            note.file_path,
            note.line,
            note.side,
            note.start_line,
            note.start_side,
            note.body,
            note.author,
            now_unix_timestamp(),
        ],
    )
    .map_err(|error| format!("Failed to save review note: {error}"))?;
    Ok(())
}

pub fn read_review_notes(
    checkout_id: &str,
    author: Option<&str>,
) -> Result<Vec<ReviewNote>, String> {
    let conn = super::open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT id, checkout_id, file_path, line, side, start_line, start_side, body, author, created_at
            FROM review_notes
            WHERE checkout_id = ?1
              AND (?2 IS NULL OR author = ?2)
            ORDER BY created_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare review notes query: {error}"))?;
    let rows = statement
        .query_map(params![checkout_id, author], note_from_row)
        .map_err(|error| format!("Failed to load review notes: {error}"))?;
    rows.map(|row| row.map_err(|error| format!("Failed to parse review note: {error}")))
        .collect()
}

fn note_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewNote> {
    Ok(ReviewNote {
        id: row.get(0)?,
        checkout_id: row.get(1)?,
        file_path: row.get(2)?,
        line: row.get(3)?,
        side: row.get(4)?,
        start_line: row.get(5)?,
        start_side: row.get(6)?,
        body: row.get(7)?,
        author: row.get(8)?,
        created_at: row.get(9)?,
    })
}
