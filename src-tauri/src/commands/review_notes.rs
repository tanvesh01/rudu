use crate::cache::{read_review_notes, save_review_note};
use crate::models::{ReviewNote, WORKING_TREE_REVIEW_SCOPE};
use crate::support::{now_unix_timestamp, unique_hash};

fn review_scope(scope: Option<String>) -> Result<String, String> {
    let scope = scope.unwrap_or_else(|| WORKING_TREE_REVIEW_SCOPE.to_string());
    let scope = scope.trim();
    if scope.is_empty() {
        return Err("Review note scope must not be empty.".to_string());
    }
    Ok(scope.to_string())
}

#[tauri::command]
pub fn list_review_notes(
    checkout_id: String,
    scope: Option<String>,
) -> Result<Vec<ReviewNote>, String> {
    read_review_notes(&checkout_id, &review_scope(scope)?, None)
}

#[tauri::command]
pub fn add_user_review_note(
    checkout_id: String,
    scope: Option<String>,
    file_path: String,
    line: u32,
    side: String,
    start_line: Option<u32>,
    start_side: Option<String>,
    body: String,
) -> Result<ReviewNote, String> {
    if body.trim().is_empty() {
        return Err("Review note body must not be empty.".to_string());
    }
    if side != "additions" && side != "deletions" {
        return Err("Review note side must be additions or deletions.".to_string());
    }
    if start_line.is_some() != start_side.is_some()
        || start_side
            .as_deref()
            .is_some_and(|value| value != "additions" && value != "deletions")
    {
        return Err("Review note range must have a valid start line and side.".to_string());
    }
    let scope = review_scope(scope)?;
    let note = ReviewNote {
        id: unique_hash(&format!("user:{checkout_id}:{scope}:{file_path}:{line}")),
        checkout_id: checkout_id.clone(),
        scope,
        file_path,
        line,
        side,
        start_line,
        start_side,
        reply_to_id: None,
        body,
        author: "user".to_string(),
        created_at: now_unix_timestamp(),
    };
    save_review_note(&note)?;
    Ok(note)
}
