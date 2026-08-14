use serde::{Deserialize, Serialize};

pub const WORKING_TREE_REVIEW_SCOPE: &str = "working-tree";
pub const PULL_REQUEST_REVIEW_SCOPE: &str = "pull-request";
pub const REVIEW_NOTE_KIND: &str = "note";
pub const REVIEW_COMMENT_DRAFT_KIND: &str = "comment_draft";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRevisionRef {
    pub repo: String,
    pub number: u32,
    pub head_sha: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedReview {
    pub repo: String,
    pub number: u32,
    pub head_sha: String,
    pub review_id: String,
    pub review_url: String,
    pub published_count: usize,
    pub cleanup_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ReviewNoteOwner {
    Checkout {
        checkout_id: String,
    },
    PullRequestRevision {
        repo: String,
        number: u32,
        head_sha: String,
    },
}

impl ReviewNoteOwner {
    pub fn target_key(&self) -> String {
        match self {
            Self::Checkout { checkout_id } => format!("checkout:{checkout_id}"),
            Self::PullRequestRevision {
                repo,
                number,
                head_sha,
            } => format!("pr:{repo}#{number}@{head_sha}"),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNote {
    pub id: String,
    pub target_key: String,
    pub scope: String,
    pub file_path: String,
    pub line: u32,
    /// Pierre diff side: `additions` or `deletions`.
    pub side: String,
    pub start_line: Option<u32>,
    pub start_side: Option<String>,
    pub reply_to_id: Option<String>,
    pub body: String,
    /// `note` stays private; only `comment_draft` can be published to GitHub.
    pub kind: String,
    /// `user` = typed by the human in the app, `agent` = written via `rudu session note *`.
    pub author: String,
    pub author_name: Option<String>,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::ReviewNoteOwner;

    #[test]
    fn target_keys_separate_checkouts_and_pull_request_revisions() {
        assert_eq!(
            ReviewNoteOwner::Checkout {
                checkout_id: "checkout-1".to_string(),
            }
            .target_key(),
            "checkout:checkout-1"
        );
        assert_eq!(
            ReviewNoteOwner::PullRequestRevision {
                repo: "outerworld/rudu".to_string(),
                number: 42,
                head_sha: "abc123".to_string(),
            }
            .target_key(),
            "pr:outerworld/rudu#42@abc123"
        );
    }
}
