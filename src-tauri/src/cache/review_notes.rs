use rusqlite::params;

use crate::models::ReviewNote;
use crate::support::now_unix_timestamp;

pub fn save_review_note(note: &ReviewNote) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
    conn.execute(
        "
        INSERT INTO review_notes (
            id, target_key, scope, file_path, line, side, start_line, start_side, reply_to_id, body, kind, author, author_name, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ",
        params![
            note.id,
            note.target_key,
            note.scope,
            note.file_path,
            note.line,
            note.side,
            note.start_line,
            note.start_side,
            note.reply_to_id,
            note.body,
            note.kind,
            note.author,
            note.author_name,
            now_unix_timestamp(),
        ],
    )
    .map_err(|error| format!("Failed to save review note: {error}"))?;
    Ok(())
}

pub fn delete_selected_review_notes(
    target_key: &str,
    scope: &str,
    note_ids: &[String],
) -> Result<Option<usize>, String> {
    let mut conn = super::open_cache_connection()?;
    delete_selected_review_notes_with_connection(&mut conn, target_key, scope, note_ids)
}

pub fn read_review_notes(
    target_key: &str,
    scope: &str,
    author: Option<&str>,
) -> Result<Vec<ReviewNote>, String> {
    let conn = super::open_cache_connection()?;
    read_review_notes_with_connection(&conn, target_key, scope, author)
}

fn read_review_notes_with_connection(
    conn: &rusqlite::Connection,
    target_key: &str,
    scope: &str,
    author: Option<&str>,
) -> Result<Vec<ReviewNote>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT id, target_key, scope, file_path, line, side, start_line, start_side, reply_to_id, body, kind, author, author_name, created_at
            FROM review_notes
            WHERE target_key = ?1
              AND scope = ?2
              AND (?3 IS NULL OR author = ?3)
            ORDER BY created_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare review notes query: {error}"))?;
    let rows = statement
        .query_map(params![target_key, scope, author], note_from_row)
        .map_err(|error| format!("Failed to load review notes: {error}"))?;
    rows.map(|row| row.map_err(|error| format!("Failed to parse review note: {error}")))
        .collect()
}

fn delete_selected_review_notes_with_connection(
    conn: &mut rusqlite::Connection,
    target_key: &str,
    scope: &str,
    note_ids: &[String],
) -> Result<Option<usize>, String> {
    let transaction = conn
        .transaction()
        .map_err(|error| format!("Failed to start review note deletion: {error}"))?;

    for note_id in note_ids {
        let exists = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM review_notes WHERE target_key = ?1 AND scope = ?2 AND id = ?3)",
                params![target_key, scope, note_id],
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
                "DELETE FROM review_notes WHERE target_key = ?1 AND scope = ?2 AND (id = ?3 OR reply_to_id = ?3)",
                params![target_key, scope, note_id],
            )
            .map_err(|error| format!("Failed to delete review note: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit review note deletion: {error}"))?;
    Ok(Some(deleted_count))
}

fn note_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewNote> {
    Ok(ReviewNote {
        id: row.get(0)?,
        target_key: row.get(1)?,
        scope: row.get(2)?,
        file_path: row.get(3)?,
        line: row.get(4)?,
        side: row.get(5)?,
        start_line: row.get(6)?,
        start_side: row.get(7)?,
        reply_to_id: row.get(8)?,
        body: row.get(9)?,
        kind: row.get(10)?,
        author: row.get(11)?,
        author_name: row.get(12)?,
        created_at: row.get(13)?,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{delete_selected_review_notes_with_connection, read_review_notes_with_connection};

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
            CREATE TABLE review_notes (id TEXT PRIMARY KEY, target_key TEXT NOT NULL, scope TEXT NOT NULL, reply_to_id TEXT);
            INSERT INTO review_notes VALUES
                ('root-1', 'checkout-1', 'working-tree', NULL),
                ('reply-1', 'checkout-1', 'working-tree', 'root-1'),
                ('root-2', 'checkout-1', 'working-tree', NULL),
                ('reply-2', 'checkout-1', 'working-tree', 'root-2'),
                ('selected', 'checkout-1', 'selected-diff', NULL),
                ('other', 'checkout-2', 'working-tree', NULL);
            ",
        )
        .expect("seed notes");

        let deleted = delete_selected_review_notes_with_connection(
            &mut conn,
            "checkout-1",
            "working-tree",
            &["reply-2".to_string()],
        )
        .expect("delete reply");
        assert_eq!(deleted, Some(1));
        assert_eq!(
            note_ids(&conn),
            vec!["other", "reply-1", "root-1", "root-2", "selected"]
        );

        let deleted = delete_selected_review_notes_with_connection(
            &mut conn,
            "checkout-1",
            "working-tree",
            &["root-1".to_string()],
        )
        .expect("delete thread");
        assert_eq!(deleted, Some(2));
        assert_eq!(note_ids(&conn), vec!["other", "root-2", "selected"]);

        let missing = delete_selected_review_notes_with_connection(
            &mut conn,
            "checkout-1",
            "working-tree",
            &["missing".to_string()],
        )
        .expect("reject missing note");
        assert_eq!(missing, None);
        assert_eq!(note_ids(&conn), vec!["other", "root-2", "selected"]);
    }

    #[test]
    fn reads_only_notes_from_the_requested_scope() {
        let conn = Connection::open_in_memory().expect("open database");
        conn.execute_batch(
            "
            CREATE TABLE review_notes (
                id TEXT PRIMARY KEY, target_key TEXT NOT NULL, scope TEXT NOT NULL,
                file_path TEXT NOT NULL, line INTEGER NOT NULL, side TEXT NOT NULL,
                start_line INTEGER, start_side TEXT, reply_to_id TEXT, body TEXT NOT NULL,
                kind TEXT NOT NULL, author TEXT NOT NULL, author_name TEXT, created_at INTEGER NOT NULL
            );
            INSERT INTO review_notes VALUES
                ('working', 'checkout-1', 'working-tree', 'src/lib.rs', 1, 'additions', NULL, NULL, NULL, 'working', 'note', 'user', NULL, 1),
                ('selected', 'checkout-1', 'selected-diff', 'src/lib.rs', 1, 'additions', NULL, NULL, NULL, 'selected', 'note', 'user', NULL, 2);
            ",
        )
        .expect("seed notes");

        let notes = read_review_notes_with_connection(&conn, "checkout-1", "selected-diff", None)
            .expect("read selected diff notes");

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "selected");
    }
}
