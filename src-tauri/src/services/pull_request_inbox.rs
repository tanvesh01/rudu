use std::collections::HashSet;

use serde::Deserialize;

use crate::github::run_gh_graphql_json;
use crate::models::{
    GhActor, PullRequestCore, PullRequestInbox, PullRequestInboxItem, PullRequestSummary,
};

// ponytail: each actionable bucket is capped at 100; paginate if large inboxes need it.
const INBOX_QUERY: &str = r#"
query($authoredQuery: String!, $reviewQuery: String!, $waitingForAuthorQuery: String!, $involvedQuery: String!) {
  viewer { login }
  authored: search(type: ISSUE, query: $authoredQuery, first: 100) {
    nodes { ...PullRequestInboxFields }
  }
  reviewRequested: search(type: ISSUE, query: $reviewQuery, first: 100) {
    nodes { ...PullRequestInboxFields }
  }
  waitingForAuthor: search(type: ISSUE, query: $waitingForAuthorQuery, first: 100) {
    nodes { ...PullRequestInboxFields }
  }
  involved: search(type: ISSUE, query: $involvedQuery, first: 100) {
    nodes { ...PullRequestInboxFields }
  }
}

fragment PullRequestInboxFields on PullRequest {
  id
  number
  title
  state
  isDraft
  mergeStateStatus
  mergeable
  additions
  deletions
  updatedAt
  url
  headRefOid
  baseRefOid
  reviewDecision
  author { login }
  repository { nameWithOwner }
}
"#;

#[derive(Deserialize)]
struct InboxResponse {
    data: Option<InboxData>,
    errors: Option<Vec<InboxError>>,
}

#[derive(Deserialize)]
struct InboxError {
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxData {
    viewer: GhActor,
    authored: InboxConnection,
    review_requested: InboxConnection,
    waiting_for_author: InboxConnection,
    involved: InboxConnection,
}

#[derive(Deserialize)]
struct InboxConnection {
    #[serde(default)]
    nodes: Vec<InboxPullRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxPullRequest {
    id: String,
    number: u32,
    title: String,
    state: String,
    is_draft: bool,
    merge_state_status: String,
    mergeable: String,
    additions: u32,
    deletions: u32,
    updated_at: String,
    url: String,
    head_ref_oid: String,
    base_ref_oid: Option<String>,
    review_decision: Option<String>,
    author: Option<GhActor>,
    repository: InboxRepository,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxRepository {
    name_with_owner: String,
}

impl InboxPullRequest {
    fn into_item(self, review_requested: bool) -> PullRequestInboxItem {
        PullRequestInboxItem {
            repo: self.repository.name_with_owner,
            summary: PullRequestSummary {
                core: PullRequestCore {
                    number: self.number,
                    title: self.title,
                    state: self.state,
                    updated_at: self.updated_at,
                    url: self.url,
                },
                is_draft: self.is_draft,
                merge_state_status: self.merge_state_status,
                mergeable: self.mergeable,
                additions: self.additions,
                deletions: self.deletions,
                author_login: self
                    .author
                    .map(|author| author.login)
                    .unwrap_or_else(|| "unknown".into()),
                head_sha: self.head_ref_oid,
                base_sha: self.base_ref_oid,
            },
            review_decision: self.review_decision,
            review_requested,
        }
    }
}

fn fetch_pull_request_inbox() -> Result<PullRequestInbox, String> {
    let response = run_gh_graphql_json(
        INBOX_QUERY,
        serde_json::json!({
            "authoredQuery": "is:pr is:open author:@me sort:updated-desc",
            "reviewQuery": "is:pr is:open review-requested:@me sort:updated-desc",
            "waitingForAuthorQuery": "is:pr is:open reviewed-by:@me review:changes_requested sort:updated-desc",
            "involvedQuery": "is:pr is:open involves:@me sort:updated-desc",
        }),
    )?;
    let response: InboxResponse = serde_json::from_str(&response)
        .map_err(|error| format!("Failed to parse pull request inbox: {error}"))?;
    if let Some(errors) = response.errors {
        return Err(errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; "));
    }
    let data = response
        .data
        .ok_or_else(|| "GitHub returned no pull request inbox data".to_string())?;

    let review_requested_ids: HashSet<String> = data
        .review_requested
        .nodes
        .iter()
        .map(|pull_request| pull_request.id.clone())
        .collect();
    let mut seen = HashSet::new();
    let mut pull_requests = data.review_requested.nodes;
    pull_requests.extend(data.authored.nodes);
    pull_requests.extend(data.waiting_for_author.nodes);
    pull_requests.extend(data.involved.nodes);
    let pull_requests = pull_requests
        .into_iter()
        .filter(|pull_request| seen.insert(pull_request.id.clone()))
        .map(|pull_request| {
            let review_requested = review_requested_ids.contains(&pull_request.id);
            pull_request.into_item(review_requested)
        })
        .collect();

    Ok(PullRequestInbox {
        viewer_login: data.viewer.login,
        pull_requests,
    })
}

pub fn get_pull_request_inbox() -> Result<PullRequestInbox, String> {
    match fetch_pull_request_inbox() {
        Ok(inbox) => {
            if let Err(error) = crate::cache::store_pull_request_inbox(&inbox) {
                eprintln!("Failed to persist pull request inbox: {error}");
            }
            Ok(inbox)
        }
        Err(network_error) => match crate::cache::read_cached_pull_request_inbox() {
            Ok(Some(inbox)) => Ok(inbox),
            Ok(None) => Err(network_error),
            Err(cache_error) => Err(format!("{network_error}; {cache_error}")),
        },
    }
}
