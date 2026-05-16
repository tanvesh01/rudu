use std::collections::HashSet;

use crate::github::run_gh;
use crate::models::{
    GhSearchIssue, IssueBuckets, IssueLinkedPullRequestsQueryData, IssueRole, IssueRoleCounts,
    IssueSummary,
};
use crate::services::review_graphql::{
    parse_graphql_response, GhGraphqlTransport, GraphqlTransport, GraphqlVariable,
};

const ISSUE_SEARCH_LIMIT: &str = "50";
const ISSUE_SEARCH_JSON_FIELDS: &str =
    "id,number,title,repository,author,createdAt,updatedAt,commentsCount,state,url";
const ISSUE_LINK_LOOKUP_CHUNK_SIZE: usize = 50;

pub struct IssueSearchService<T: GraphqlTransport> {
    transport: T,
}

impl IssueSearchService<GhGraphqlTransport> {
    pub fn new() -> Self {
        Self {
            transport: GhGraphqlTransport,
        }
    }
}

impl<T: GraphqlTransport> IssueSearchService<T> {
    pub fn with_transport(transport: T) -> Self {
        Self { transport }
    }

    pub fn list_open_buckets(&self) -> Result<IssueBuckets, String> {
        let buckets = IssueBuckets {
            in_progress: Vec::new(),
            assigned: self.search_role(IssueRole::Assigned)?,
            mentioned: self.search_role(IssueRole::Mentioned)?,
            authored: self.search_role(IssueRole::Authored)?,
        };
        let linked_issue_ids = self.linked_issue_ids(&buckets)?;

        Ok(move_in_progress_issues(buckets, &linked_issue_ids))
    }

    pub fn count_open_roles(&self) -> Result<IssueRoleCounts, String> {
        let assigned = self.count_role(IssueRole::Assigned)?;
        let mentioned = self.count_role(IssueRole::Mentioned)?;
        let authored = self.count_role(IssueRole::Authored)?;

        Ok(IssueRoleCounts {
            assigned,
            mentioned,
            authored,
            total: assigned + mentioned + authored,
        })
    }

    fn search_role(&self, role: IssueRole) -> Result<Vec<IssueSummary>, String> {
        let role_args = role_search_args(role);
        let args = [
            "search",
            "issues",
            role_args.0,
            role_args.1,
            "--state",
            "open",
            "--limit",
            ISSUE_SEARCH_LIMIT,
            "--sort",
            "updated",
            "--order",
            "desc",
            "--json",
            ISSUE_SEARCH_JSON_FIELDS,
        ];
        let stdout = run_gh(&args)?;
        let issues = serde_json::from_str::<Vec<GhSearchIssue>>(&stdout)
            .map_err(|error| format!("Failed to parse GitHub issues: {error}"))?;

        Ok(issues.into_iter().map(map_search_issue).collect())
    }

    fn count_role(&self, role: IssueRole) -> Result<u32, String> {
        let query = format!("is:issue is:open {}", role_search_query(role));
        let field = format!("q={query}");
        let stdout = run_gh(&[
            "api",
            "-X",
            "GET",
            "search/issues",
            "-f",
            &field,
            "--jq",
            ".total_count",
        ])?;
        stdout
            .trim()
            .parse::<u32>()
            .map_err(|error| format!("Failed to parse issue count: {error}"))
    }

    fn linked_issue_ids(&self, buckets: &IssueBuckets) -> Result<HashSet<String>, String> {
        let mut seen_issue_ids = HashSet::new();
        let mut issue_ids = Vec::new();
        for issue in buckets
            .assigned
            .iter()
            .chain(buckets.mentioned.iter())
            .chain(buckets.authored.iter())
        {
            if seen_issue_ids.insert(issue.id.clone()) {
                issue_ids.push(issue.id.clone());
            }
        }

        if issue_ids.is_empty() {
            return Ok(HashSet::new());
        }

        let mut linked_issue_ids = HashSet::new();

        for chunk in issue_ids.chunks(ISSUE_LINK_LOOKUP_CHUNK_SIZE) {
            let vars = chunk
                .iter()
                .map(|id| GraphqlVariable::literal("ids[]", id))
                .collect::<Vec<_>>();
            let stdout = self
                .transport
                .execute(ISSUE_LINKED_PULL_REQUESTS_QUERY, &vars)?;
            let data = parse_graphql_response::<IssueLinkedPullRequestsQueryData>(
                &stdout,
                "issue linked pull requests",
            )?;

            for issue in data.nodes.into_iter().flatten() {
                if issue.closed_by_pull_requests_references.total_count > 0 {
                    linked_issue_ids.insert(issue.id);
                }
            }
        }

        Ok(linked_issue_ids)
    }
}

fn role_search_args(role: IssueRole) -> (&'static str, &'static str) {
    match role {
        IssueRole::Assigned => ("--assignee", "@me"),
        IssueRole::Mentioned => ("--mentions", "@me"),
        IssueRole::Authored => ("--author", "@me"),
    }
}

fn role_search_query(role: IssueRole) -> &'static str {
    match role {
        IssueRole::Assigned => "assignee:@me",
        IssueRole::Mentioned => "mentions:@me",
        IssueRole::Authored => "author:@me",
    }
}

fn map_search_issue(issue: GhSearchIssue) -> IssueSummary {
    IssueSummary {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        repo: issue.repository.name_with_owner,
        author_login: issue
            .author
            .map(|author| author.login)
            .unwrap_or_else(|| "unknown".to_string()),
        comment_count: issue.comments_count.unwrap_or(0),
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        url: issue.url,
    }
}

fn move_in_progress_issues(
    mut buckets: IssueBuckets,
    linked_issue_ids: &HashSet<String>,
) -> IssueBuckets {
    let mut seen_in_progress_ids = HashSet::new();
    let mut in_progress = Vec::new();

    extract_in_progress_issues(
        &mut buckets.assigned,
        linked_issue_ids,
        &mut seen_in_progress_ids,
        &mut in_progress,
    );
    extract_in_progress_issues(
        &mut buckets.mentioned,
        linked_issue_ids,
        &mut seen_in_progress_ids,
        &mut in_progress,
    );
    extract_in_progress_issues(
        &mut buckets.authored,
        linked_issue_ids,
        &mut seen_in_progress_ids,
        &mut in_progress,
    );

    buckets.in_progress = in_progress;
    buckets
}

fn extract_in_progress_issues(
    issues: &mut Vec<IssueSummary>,
    linked_issue_ids: &HashSet<String>,
    seen_in_progress_ids: &mut HashSet<String>,
    in_progress: &mut Vec<IssueSummary>,
) {
    let mut remaining = Vec::with_capacity(issues.len());

    for issue in issues.drain(..) {
        if linked_issue_ids.contains(&issue.id) {
            if seen_in_progress_ids.insert(issue.id.clone()) {
                in_progress.push(issue);
            }
        } else {
            remaining.push(issue);
        }
    }

    *issues = remaining;
}

const ISSUE_LINKED_PULL_REQUESTS_QUERY: &str = r#"
query IssueLinkedPullRequests($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      id
      closedByPullRequestsReferences(first: 1) {
        totalCount
      }
    }
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct MockTransport {
        responses: RefCell<Vec<Result<String, String>>>,
        calls: RefCell<Vec<(String, Vec<GraphqlVariable>)>>,
    }

    impl MockTransport {
        fn with_responses(responses: Vec<Result<String, String>>) -> Self {
            Self {
                responses: RefCell::new(responses),
                calls: RefCell::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<(String, Vec<GraphqlVariable>)> {
            self.calls.borrow().clone()
        }
    }

    impl GraphqlTransport for &MockTransport {
        fn execute(&self, query: &str, vars: &[GraphqlVariable]) -> Result<String, String> {
            self.calls
                .borrow_mut()
                .push((query.to_string(), vars.to_vec()));
            self.responses.borrow_mut().remove(0)
        }
    }

    #[test]
    fn moves_linked_issues_into_in_progress_and_dedupes() {
        let duplicate = issue("linked-1", "Linked issue");
        let buckets = IssueBuckets {
            in_progress: Vec::new(),
            assigned: vec![duplicate.clone(), issue("open-1", "Assigned issue")],
            mentioned: vec![issue("mentioned-1", "Mentioned issue")],
            authored: vec![duplicate],
        };
        let linked_issue_ids = HashSet::from(["linked-1".to_string()]);

        let buckets = move_in_progress_issues(buckets, &linked_issue_ids);

        assert_eq!(buckets.in_progress.len(), 1);
        assert_eq!(buckets.in_progress[0].id, "linked-1");
        assert_eq!(buckets.assigned.len(), 1);
        assert_eq!(buckets.assigned[0].id, "open-1");
        assert_eq!(buckets.mentioned.len(), 1);
        assert_eq!(buckets.mentioned[0].id, "mentioned-1");
        assert!(buckets.authored.is_empty());
    }

    #[test]
    fn maps_graphql_pull_request_totals_to_linked_issue_ids() {
        let transport = MockTransport::with_responses(vec![Ok(
            r#"{
              "data": {
                "nodes": [
                  {
                    "id": "linked-1",
                    "closedByPullRequestsReferences": { "totalCount": 1 }
                  },
                  {
                    "id": "unlinked-1",
                    "closedByPullRequestsReferences": { "totalCount": 0 }
                  },
                  null
                ]
              }
            }"#
            .into(),
        )]);
        let service = IssueSearchService::with_transport(&transport);
        let buckets = IssueBuckets {
            in_progress: Vec::new(),
            assigned: vec![issue("linked-1", "Linked issue")],
            mentioned: vec![issue("unlinked-1", "Unlinked issue")],
            authored: Vec::new(),
        };

        let linked_issue_ids = service.linked_issue_ids(&buckets).unwrap();

        assert_eq!(linked_issue_ids, HashSet::from(["linked-1".to_string()]));
        let calls = transport.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, ISSUE_LINKED_PULL_REQUESTS_QUERY);
        assert_eq!(
            calls[0].1,
            vec![
                GraphqlVariable::literal("ids[]", "linked-1"),
                GraphqlVariable::literal("ids[]", "unlinked-1"),
            ]
        );
    }

    fn issue(id: &str, title: &str) -> IssueSummary {
        IssueSummary {
            id: id.to_string(),
            number: 1,
            title: title.to_string(),
            state: "open".to_string(),
            repo: "owner/repo".to_string(),
            author_login: "octocat".to_string(),
            comment_count: 0,
            created_at: "2026-05-16T00:00:00Z".to_string(),
            updated_at: "2026-05-16T00:00:00Z".to_string(),
            url: format!("https://github.com/owner/repo/issues/{id}"),
        }
    }
}
