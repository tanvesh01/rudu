use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use crate::cache::{
    find_local_checkout, find_open_pr_for_head, find_tracked_pull_request, read_local_checkouts,
};
use crate::models::{
    LocalCheckout, LocalCheckoutStatus, LocalDiffSource, PullRequestRevisionRef,
    PullRequestSummary, ReviewNoteOwner, SessionTargetRef, PULL_REQUEST_REVIEW_SCOPE,
    WORKING_TREE_REVIEW_SCOPE,
};

use super::local_checkout::{get_local_checkout_status, inspect_checkout};

#[derive(Default)]
pub struct ActiveSessionTarget(Mutex<Option<SessionTargetRef>>);

impl ActiveSessionTarget {
    pub fn get(&self) -> Result<Option<SessionTargetRef>, String> {
        self.0
            .lock()
            .map(|target| target.clone())
            .map_err(|_| "The active Rudu session is unavailable.".to_string())
    }

    pub fn set(&self, target: Option<SessionTargetRef>) -> Result<(), String> {
        *self
            .0
            .lock()
            .map_err(|_| "The active Rudu session is unavailable.".to_string())? = target;
        Ok(())
    }
}

#[derive(Debug)]
pub enum ResolvedSessionTarget {
    LocalCheckout {
        checkout: LocalCheckout,
        source: Option<LocalDiffSource>,
        status: LocalCheckoutStatus,
    },
    PullRequest {
        repo: String,
        summary: PullRequestSummary,
    },
}

impl ResolvedSessionTarget {
    pub fn target_ref(&self) -> SessionTargetRef {
        match self {
            Self::LocalCheckout {
                checkout, source, ..
            } => SessionTargetRef::LocalCheckout {
                checkout_id: checkout.id.clone(),
                source: source.clone(),
            },
            Self::PullRequest { repo, summary } => SessionTargetRef::PullRequest {
                repo: repo.clone(),
                number: summary.core.number,
            },
        }
    }

    pub fn review_note_owner(&self) -> ReviewNoteOwner {
        match self {
            Self::LocalCheckout { checkout, .. } => ReviewNoteOwner::Checkout {
                checkout_id: checkout.id.clone(),
            },
            Self::PullRequest { repo, summary } => ReviewNoteOwner::PullRequestRevision {
                repo: repo.clone(),
                number: summary.core.number,
                head_sha: summary.head_sha.clone(),
            },
        }
    }

    pub fn review_note_location(&self) -> Result<(String, String), String> {
        let scope = match self {
            Self::LocalCheckout { source, status, .. } => match source {
                Some(source) => serde_json::to_string(&SelectedDiffScope {
                    source,
                    revision: &status.revision,
                })
                .map_err(|error| format!("Failed to identify the selected diff: {error}"))?,
                None => WORKING_TREE_REVIEW_SCOPE.to_string(),
            },
            Self::PullRequest { .. } => PULL_REQUEST_REVIEW_SCOPE.to_string(),
        };
        Ok((self.review_note_owner().target_key(), scope))
    }
}

#[derive(Serialize)]
struct SelectedDiffScope<'a> {
    source: &'a LocalDiffSource,
    revision: &'a str,
}

#[derive(Debug)]
pub struct SessionTargetError {
    pub status: u16,
    pub message: String,
}

impl SessionTargetError {
    fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

pub fn resolve_session_target(
    repo: Option<&str>,
    pull_request: Option<(String, u32)>,
    active: Option<SessionTargetRef>,
) -> Result<ResolvedSessionTarget, SessionTargetError> {
    if let Some(repo) = repo {
        let inspection = inspect_checkout(Path::new(repo))
            .map_err(|error| SessionTargetError::new(404, error))?;
        let checkouts =
            read_local_checkouts().map_err(|error| SessionTargetError::new(500, error))?;
        let checkout = checkouts
            .into_iter()
            .find(|checkout| checkout.path == inspection.root_path)
            .ok_or_else(|| {
                SessionTargetError::new(
                    404,
                    format!(
                        "no session matches repo {}; open it with: rudu {}",
                        inspection.root_path, inspection.root_path
                    ),
                )
            })?;
        return resolve_local_checkout(checkout, None);
    }

    if let Some((repo, number)) = pull_request {
        return resolve_pull_request(repo, number);
    }

    if let Some(active) = active {
        return match active {
            SessionTargetRef::LocalCheckout {
                checkout_id,
                source,
            } => {
                let checkout = find_local_checkout(&checkout_id)
                    .map_err(|error| SessionTargetError::new(500, error))?
                    .ok_or_else(|| {
                        SessionTargetError::new(404, "The active local checkout was not found.")
                    })?;
                resolve_local_checkout(checkout, source)
            }
            SessionTargetRef::PullRequest { repo, number } => resolve_pull_request(repo, number),
        };
    }

    let checkouts = read_local_checkouts().map_err(|error| SessionTargetError::new(500, error))?;
    match checkouts.as_slice() {
        [only] => resolve_local_checkout(only.clone(), None),
        [] => Err(SessionTargetError::new(
            404,
            "no sessions are open; run: rudu <path>",
        )),
        _ => Err(SessionTargetError::new(
            400,
            "multiple sessions are open; pass --repo <path>",
        )),
    }
}

pub fn related_pull_request_for_checkout(
    checkout_id: &str,
    head_sha: &str,
) -> Result<Option<PullRequestRevisionRef>, String> {
    let Some(checkout) = find_local_checkout(checkout_id)? else {
        return Ok(None);
    };
    let Some(repo) = checkout.github_repo else {
        return Ok(None);
    };
    Ok(
        find_open_pr_for_head(&repo, head_sha)?.map(|pull_request| PullRequestRevisionRef {
            repo,
            number: pull_request.core.number,
            head_sha: pull_request.head_sha,
        }),
    )
}

fn resolve_pull_request(
    repo: String,
    number: u32,
) -> Result<ResolvedSessionTarget, SessionTargetError> {
    let (canonical_repo, summary) = find_tracked_pull_request(&repo, number)
        .map_err(|error| SessionTargetError::new(500, error))?
        .ok_or_else(|| {
            SessionTargetError::new(
                404,
                format!("pull request {repo}#{number} is not tracked; open it with: rudu pr {repo}#{number}"),
            )
        })?;
    Ok(ResolvedSessionTarget::PullRequest {
        repo: canonical_repo,
        summary,
    })
}

fn resolve_local_checkout(
    checkout: LocalCheckout,
    source: Option<LocalDiffSource>,
) -> Result<ResolvedSessionTarget, SessionTargetError> {
    let status = get_local_checkout_status(checkout.id.clone(), source.clone())
        .map_err(|error| SessionTargetError::new(500, error))?;
    Ok(ResolvedSessionTarget::LocalCheckout {
        checkout,
        source,
        status,
    })
}

#[cfg(test)]
mod tests {
    use crate::models::LocalDiffSource;

    use super::{ResolvedSessionTarget, SelectedDiffScope};

    #[test]
    fn selected_diff_scope_matches_frontend_json_order() {
        let source = LocalDiffSource::GitDiff {
            target: Some("main...HEAD".to_string()),
            staged: false,
            include_untracked: true,
            paths: vec!["src".to_string()],
        };
        let scope = serde_json::to_string(&SelectedDiffScope {
            source: &source,
            revision: "revision-1",
        })
        .unwrap();

        assert_eq!(
            scope,
            r#"{"source":{"kind":"git_diff","target":"main...HEAD","staged":false,"includeUntracked":true,"paths":["src"]},"revision":"revision-1"}"#
        );
    }

    #[test]
    fn pull_request_target_ref_round_trips() {
        let target = ResolvedSessionTarget::PullRequest {
            repo: "outerworld/rudu".to_string(),
            summary: crate::models::PullRequestSummary {
                core: crate::models::PullRequestCore {
                    number: 42,
                    title: "PR".to_string(),
                    state: "OPEN".to_string(),
                    updated_at: "now".to_string(),
                    url: "url".to_string(),
                },
                is_draft: false,
                merge_state_status: "CLEAN".to_string(),
                mergeable: "MERGEABLE".to_string(),
                additions: 1,
                deletions: 0,
                author_login: "user".to_string(),
                head_sha: "head".to_string(),
                base_sha: None,
            },
        };
        assert_eq!(
            serde_json::to_value(target.target_ref()).unwrap(),
            serde_json::json!({
                "kind": "pull_request",
                "repo": "outerworld/rudu",
                "number": 42,
            })
        );
    }
}
