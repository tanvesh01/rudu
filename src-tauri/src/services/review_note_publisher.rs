use crate::cache::{delete_selected_review_notes, find_tracked_pull_request, read_review_notes};
use crate::models::{
    PublishedReview, PullRequestRevisionRef, ReviewNote, ReviewNoteOwner, REVIEW_COMMENT_DRAFT_KIND,
};

use super::local_checkout::get_local_checkout_status;
use super::review_graphql::{
    DraftPullRequestReviewThread, GhGraphqlTransport, ReviewGraphqlClient, ReviewThreadService,
};
use super::session_target::related_pull_request_for_checkout;

pub fn publish_review_notes(
    owner: ReviewNoteOwner,
    scope: String,
) -> Result<PublishedReview, String> {
    let scope = scope.trim();
    if scope.is_empty() {
        return Err("Review note scope must not be empty.".to_string());
    }

    let target = publish_target(&owner)?;
    let target_key = owner.target_key();
    let notes = read_review_notes(&target_key, scope, None)?;
    let roots = publishable_roots(&notes);
    if roots.is_empty() {
        return Err("No review drafts to publish.".to_string());
    }

    let threads = roots
        .iter()
        .map(|note| draft_thread(note))
        .collect::<Result<Vec<_>, _>>()?;
    let published = ReviewThreadService::new(ReviewGraphqlClient::new(GhGraphqlTransport))
        .publish_comment_review(&target.repo, target.number, &target.head_sha, threads)?;
    let note_ids = roots.iter().map(|note| note.id.clone()).collect::<Vec<_>>();
    let cleanup_error = match delete_selected_review_notes(&target_key, scope, &note_ids) {
        Ok(Some(_)) => None,
        Ok(None) => Some(
            "Published to GitHub, but the local drafts changed before cleanup; do not publish them again."
                .to_string(),
        ),
        Err(error) => Some(format!(
            "Published to GitHub, but local draft cleanup failed: {error}. Do not publish them again."
        )),
    };

    Ok(PublishedReview {
        repo: target.repo,
        number: target.number,
        head_sha: target.head_sha,
        review_id: published.id,
        review_url: published.url,
        published_count: note_ids.len(),
        cleanup_error,
    })
}

pub fn validate_publish_target(owner: &ReviewNoteOwner) -> Result<PullRequestRevisionRef, String> {
    publish_target(owner)
}

fn publish_target(owner: &ReviewNoteOwner) -> Result<PullRequestRevisionRef, String> {
    match owner {
        ReviewNoteOwner::PullRequestRevision {
            repo,
            number,
            head_sha,
        } => {
            let (canonical_repo, pull_request) = find_tracked_pull_request(repo, *number)?
                .ok_or_else(|| format!("Pull request {repo}#{number} is not tracked."))?;
            if !pull_request.core.state.eq_ignore_ascii_case("OPEN") {
                return Err(format!(
                    "Pull request {canonical_repo}#{number} is not open."
                ));
            }
            if pull_request.head_sha != *head_sha {
                return Err(
                    "The pull request head changed; reopen the current revision before publishing."
                        .to_string(),
                );
            }
            Ok(PullRequestRevisionRef {
                repo: canonical_repo,
                number: *number,
                head_sha: head_sha.clone(),
            })
        }
        ReviewNoteOwner::Checkout { checkout_id } => {
            let status = get_local_checkout_status(checkout_id.clone(), None)?;
            related_pull_request_for_checkout(checkout_id, &status.head_sha)?.ok_or_else(|| {
                "This Local Checkout has no cached open pull request at its current HEAD."
                    .to_string()
            })
        }
    }
}

fn publishable_roots(notes: &[ReviewNote]) -> Vec<&ReviewNote> {
    notes
        .iter()
        .filter(|note| note.kind == REVIEW_COMMENT_DRAFT_KIND && note.reply_to_id.is_none())
        .collect()
}

fn draft_thread(note: &ReviewNote) -> Result<DraftPullRequestReviewThread, String> {
    let side = github_side(&note.side)?;
    let start_side = note
        .start_side
        .as_deref()
        .map(github_side)
        .transpose()?
        .map(str::to_string);
    if note.start_line.is_some() != start_side.is_some() {
        return Err(format!("Review draft {} has an invalid range.", note.id));
    }
    Ok(DraftPullRequestReviewThread {
        body: note.body.clone(),
        path: note.file_path.clone(),
        line: note.line,
        side: side.to_string(),
        start_line: note.start_line,
        start_side,
    })
}

fn github_side(side: &str) -> Result<&'static str, String> {
    match side {
        "additions" => Ok("RIGHT"),
        "deletions" => Ok("LEFT"),
        _ => Err(format!("Invalid review draft side: {side}")),
    }
}

#[cfg(test)]
mod tests {
    use crate::models::ReviewNote;

    use super::{draft_thread, publishable_roots};

    fn annotation(kind: &str) -> ReviewNote {
        ReviewNote {
            id: "note-1".into(),
            target_key: "checkout:one".into(),
            scope: "working-tree".into(),
            file_path: "src/lib.rs".into(),
            line: 12,
            side: "additions".into(),
            start_line: Some(10),
            start_side: Some("deletions".into()),
            reply_to_id: None,
            body: "body".into(),
            kind: kind.into(),
            author: "user".into(),
            author_name: None,
            created_at: 1,
        }
    }

    #[test]
    fn publishes_only_root_comment_drafts() {
        let mut private_note = annotation("note");
        private_note.id = "private".into();
        let mut draft = annotation("comment_draft");
        draft.id = "draft".into();
        let mut reply = annotation("comment_draft");
        reply.id = "reply".into();
        reply.reply_to_id = Some("draft".into());

        assert_eq!(
            publishable_roots(&[private_note, draft, reply])
                .iter()
                .map(|note| note.id.as_str())
                .collect::<Vec<_>>(),
            ["draft"]
        );
    }

    #[test]
    fn maps_local_note_locations_to_github_threads() {
        let thread = draft_thread(&annotation("comment_draft")).expect("note should map");
        assert_eq!(thread.side, "RIGHT");
        assert_eq!(thread.start_side.as_deref(), Some("LEFT"));
        assert_eq!(thread.start_line, Some(10));
    }
}
