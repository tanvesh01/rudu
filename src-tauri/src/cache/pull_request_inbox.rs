use rusqlite::{params, Connection, OptionalExtension};

use crate::models::PullRequestInbox;
use crate::support::now_unix_timestamp;

pub fn read_cached_pull_request_inbox() -> Result<Option<PullRequestInbox>, String> {
    let conn = super::open_cache_connection()?;
    read_cached_pull_request_inbox_with_connection(&conn)
}

fn read_cached_pull_request_inbox_with_connection(
    conn: &Connection,
) -> Result<Option<PullRequestInbox>, String> {
    let payload = conn
        .query_row(
            "SELECT payload_json FROM pull_request_inbox_cache WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read cached pull request inbox: {error}"))?;

    payload
        .map(|payload| {
            serde_json::from_str(&payload)
                .map_err(|error| format!("Failed to parse cached pull request inbox: {error}"))
        })
        .transpose()
}

pub fn store_pull_request_inbox(inbox: &PullRequestInbox) -> Result<(), String> {
    let conn = super::open_cache_connection()?;
    let payload = serde_json::to_string(inbox)
        .map_err(|error| format!("Failed to serialize pull request inbox: {error}"))?;

    conn.execute(
        "
        INSERT INTO pull_request_inbox_cache (id, payload_json, cached_at)
        VALUES (1, ?1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            payload_json = excluded.payload_json,
            cached_at = excluded.cached_at
        ",
        params![payload, now_unix_timestamp()],
    )
    .map_err(|error| format!("Failed to cache pull request inbox: {error}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::read_cached_pull_request_inbox_with_connection;
    use rusqlite::Connection;

    #[test]
    fn reads_a_cached_inbox_payload() {
        let conn = Connection::open_in_memory().unwrap();
        super::super::schema::ensure_cache_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO pull_request_inbox_cache VALUES (1, ?1, 1)",
            [r#"{"viewerLogin":"viewer","pullRequests":[]}"#],
        )
        .unwrap();

        let inbox = read_cached_pull_request_inbox_with_connection(&conn)
            .unwrap()
            .unwrap();
        assert_eq!(inbox.viewer_login, "viewer");
        assert!(inbox.pull_requests.is_empty());
    }
}
