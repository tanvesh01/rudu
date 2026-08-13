use crate::cache::{read_review_notes, save_review_note};
use crate::models::{
    PublishedReview, ReviewNote, ReviewNoteOwner, REVIEW_COMMENT_DRAFT_KIND, REVIEW_NOTE_KIND,
    WORKING_TREE_REVIEW_SCOPE,
};
use crate::services::review_note_publisher;
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
    owner: ReviewNoteOwner,
    scope: Option<String>,
) -> Result<Vec<ReviewNote>, String> {
    read_review_notes(&owner.target_key(), &review_scope(scope)?, None)
}

#[tauri::command]
pub async fn publish_review_notes(
    owner: ReviewNoteOwner,
    scope: String,
) -> Result<PublishedReview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        review_note_publisher::publish_review_notes(owner, scope)
    })
    .await
    .map_err(|error| format!("Blocking task failed: {error}"))?
}

#[allow(clippy::too_many_arguments)]
fn add_user_annotation(
    owner: ReviewNoteOwner,
    scope: Option<String>,
    file_path: String,
    line: u32,
    side: String,
    start_line: Option<u32>,
    start_side: Option<String>,
    body: String,
    kind: &str,
) -> Result<ReviewNote, String> {
    if body.trim().is_empty() {
        return Err("Annotation body must not be empty.".to_string());
    }
    if side != "additions" && side != "deletions" {
        return Err("Annotation side must be additions or deletions.".to_string());
    }
    if start_line.is_some() != start_side.is_some()
        || start_side
            .as_deref()
            .is_some_and(|value| value != "additions" && value != "deletions")
    {
        return Err("Annotation range must have a valid start line and side.".to_string());
    }
    if kind == REVIEW_COMMENT_DRAFT_KIND {
        review_note_publisher::validate_publish_target(&owner)?;
    }
    let scope = review_scope(scope)?;
    let note = ReviewNote {
        id: unique_hash(&format!(
            "user:{kind}:{}:{scope}:{file_path}:{line}",
            owner.target_key()
        )),
        target_key: owner.target_key(),
        scope,
        file_path,
        line,
        side,
        start_line,
        start_side,
        reply_to_id: None,
        body,
        kind: kind.to_string(),
        author: "user".to_string(),
        author_name: None,
        created_at: now_unix_timestamp(),
    };
    save_review_note(&note)?;
    Ok(note)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn add_user_review_note(
    owner: ReviewNoteOwner,
    scope: Option<String>,
    file_path: String,
    line: u32,
    side: String,
    start_line: Option<u32>,
    start_side: Option<String>,
    body: String,
) -> Result<ReviewNote, String> {
    add_user_annotation(
        owner,
        scope,
        file_path,
        line,
        side,
        start_line,
        start_side,
        body,
        REVIEW_NOTE_KIND,
    )
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn add_user_review_comment_draft(
    owner: ReviewNoteOwner,
    scope: Option<String>,
    file_path: String,
    line: u32,
    side: String,
    start_line: Option<u32>,
    start_side: Option<String>,
    body: String,
) -> Result<ReviewNote, String> {
    add_user_annotation(
        owner,
        scope,
        file_path,
        line,
        side,
        start_line,
        start_side,
        body,
        REVIEW_COMMENT_DRAFT_KIND,
    )
}

#[tauri::command]
pub fn promote_review_note(
    owner: ReviewNoteOwner,
    scope: Option<String>,
    note_id: String,
) -> Result<ReviewNote, String> {
    review_note_publisher::validate_publish_target(&owner)?;
    let scope = review_scope(scope)?;
    let target_key = owner.target_key();
    let source = read_review_notes(&target_key, &scope, None)?
        .into_iter()
        .find(|note| note.id == note_id && note.kind == REVIEW_NOTE_KIND)
        .ok_or_else(|| format!("Private review note not found: {note_id}"))?;
    if source.reply_to_id.is_some() {
        return Err("Only root review notes can become GitHub comment drafts.".to_string());
    }
    let draft = ReviewNote {
        id: unique_hash(&format!("promoted:{note_id}")),
        kind: REVIEW_COMMENT_DRAFT_KIND.to_string(),
        author: "user".to_string(),
        author_name: None,
        reply_to_id: None,
        created_at: now_unix_timestamp(),
        ..source
    };
    save_review_note(&draft)?;
    Ok(draft)
}
