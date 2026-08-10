use rusqlite::params;

use crate::models::ReviewNote;
use crate::support::now_unix_timestamp;

pub fn save_review_note(note: &ReviewNote) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
    conn.execute(
        "
        INSERT INTO review_notes (
            id, checkout_id, file_path, line, side, start_line, start_side, reply_to_id, body, author, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ",
        params![
            note.id,
            note.checkout_id,
            note.file_path,
            note.line,
            note.side,
            note.start_line,
            note.start_side,
            note.reply_to_id,
            note.body,
            note.author,
            now_unix_timestamp(),
        ],
    )
    .map_err(|error| format!("Failed to save review note: {error}"))?;
    Ok(())
}

pub fn delete_selected_review_notes(
    checkout_id: &str,
    note_ids: &[String],
) -> Result<Option<usize>, String> {
    let mut conn = super::open_cache_connection()?;
    delete_selected_review_notes_with_connection(&mut conn, checkout_id, note_ids)
}

pub fn delete_all_review_notes(checkout_id: &str) -> Result<usize, String> {
    let conn = super::open_cache_connection()?;
    delete_all_review_notes_with_connection(&conn, checkout_id)
}

pub fn read_review_notes(
    checkout_id: &str,
    author: Option<&str>,
) -> Result<Vec<ReviewNote>, String> {
    let conn = super::open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT id, checkout_id, file_path, line, side, start_line, start_side, reply_to_id, body, author, created_at
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

fn delete_selected_review_notes_with_connection(
    conn: &mut rusqlite::Connection,
    checkout_id: &str,
    note_ids: &[String],
) -> Result<Option<usize>, String> {
    let transaction = conn
        .transaction()
        .map_err(|error| format!("Failed to start review note deletion: {error}"))?;

    for note_id in note_ids {
        let exists = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM review_notes WHERE checkout_id = ?1 AND id = ?2)",
                params![checkout_id, note_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("Failed to find review note: {error}"))?;
        if !exists {
            return Ok(None);
        }
    }

    let mut deleted_count = 0;
    for note_id in note_ids {
        deleted_count += transaction
            .execute(
                "DELETE FROM review_notes WHERE checkout_id = ?1 AND (id = ?2 OR reply_to_id = ?2)",
                params![checkout_id, note_id],
            )
            .map_err(|error| format!("Failed to delete review note: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit review note deletion: {error}"))?;
    Ok(Some(deleted_count))
}

fn delete_all_review_notes_with_connection(
    conn: &rusqlite::Connection,
    checkout_id: &str,
) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM review_notes WHERE checkout_id = ?1",
        [checkout_id],
    )
    .map_err(|error| format!("Failed to delete review notes: {error}"))
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
        reply_to_id: row.get(7)?,
        body: row.get(8)?,
        author: row.get(9)?,
        created_at: row.get(10)?,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{
        delete_all_review_notes_with_connection, delete_selected_review_notes_with_connection,
    };

    fn note_ids(conn: &Connection) -> Vec<String> {
        let mut statement = conn
            .prepare("SELECT id FROM review_notes ORDER BY id")
            .expect("prepare note query");
        statement
            .query_map([], |row| row.get(0))
            .expect("query notes")
            .collect::<Result<_, _>>()
            .expect("read notes")
    }

    #[test]
    fn deletes_selected_notes_and_cascades_root_replies() {
        let mut conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            "
            CREATE TABLE review_notes (id TEXT PRIMARY KEY, checkout_id TEXT NOT NULL, reply_to_id TEXT);
            INSERT INTO review_notes VALUES
                ('root-1', 'checkout-1', NULL),
                ('reply-1', 'checkout-1', 'root-1'),
                ('root-2', 'checkout-1', NULL),
                ('reply-2', 'checkout-1', 'root-2'),
                ('other', 'checkout-2', NULL);
            ",
        )
        .expect("seed notes");

        let deleted = delete_selected_review_notes_with_connection(
            &mut conn,
            "checkout-1",
            &["reply-2".to_string()],
        )
        .expect("delete reply");
        assert_eq!(deleted, Some(1));
        assert_eq!(
            note_ids(&conn),
            vec!["other", "reply-1", "root-1", "root-2"]
        );

        let deleted = delete_selected_review_notes_with_connection(
            &mut conn,
            "checkout-1",
            &["root-1".to_string()],
        )
        .expect("delete thread");
        assert_eq!(deleted, Some(2));
        assert_eq!(note_ids(&conn), vec!["other", "root-2"]);

        let missing = delete_selected_review_notes_with_connection(
            &mut conn,
            "checkout-1",
            &["missing".to_string()],
        )
        .expect("reject missing note");
        assert_eq!(missing, None);
        assert_eq!(note_ids(&conn), vec!["other", "root-2"]);

        assert_eq!(
            delete_all_review_notes_with_connection(&conn, "checkout-1")
                .expect("delete all checkout notes"),
            1
        );
        assert_eq!(note_ids(&conn), vec!["other"]);
    }
}
