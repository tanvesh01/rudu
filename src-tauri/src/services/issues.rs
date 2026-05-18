use std::collections::{HashMap, HashSet};

use crate::github::run_gh;
use crate::linear::LinearIntegrationService;
use crate::models::{
    GhSearchIssue, GraphQlLinkedPullRequest, IssueBucketCounts, IssueBuckets, IssueDashboardData,
    IssueLinkedPullRequest, IssueLinkedPullRequestsQueryData, IssueProvider, IssueSummary,
};
use crate::services::review_graphql::{
    parse_graphql_response, GhGraphqlTransport, GraphqlTransport, GraphqlVariable,
};

const ISSUE_SEARCH_LIMIT: &str = "50";
const ISSUE_SEARCH_JSON_FIELDS: &str =
    "id,number,title,repository,author,createdAt,updatedAt,commentsCount,state,url";
const ISSUE_LINK_LOOKUP_CHUNK_SIZE: usize = 50;

#[derive(Debug, Clone, Copy)]
enum GithubIssueBucket {
    Assigned,
    Subscribed,
    Created,
}

pub struct IssueSearchService<T: GraphqlTransport> {
    transport: T,
}

pub struct IssueDashboardService<T: GraphqlTransport> {
    github_issues: IssueSearchService<T>,
    linear_integration: LinearIntegrationService,
}

impl IssueDashboardService<GhGraphqlTransport> {
    pub fn new() -> Self {
        Self {
            github_issues: IssueSearchService::new(),
            linear_integration: LinearIntegrationService::new(),
        }
    }
}

impl<T: GraphqlTransport> IssueDashboardService<T> {
    pub fn get_dashboard(&self) -> Result<IssueDashboardData, String> {
        let github_buckets = self.github_issues.list_open_buckets()?;
        let (linear_buckets, linear_integration) = self.linear_integration.list_buckets();

        Ok(IssueDashboardData {
            buckets: merge_issue_buckets(github_buckets, linear_buckets),
            linear_integration,
        })
    }

    pub fn count_buckets(&self) -> Result<IssueBucketCounts, String> {
        Ok(count_issue_buckets(&self.get_dashboard()?.buckets))
    }
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
            assigned: self.search_bucket(GithubIssueBucket::Assigned)?,
            subscribed: self.search_bucket(GithubIssueBucket::Subscribed)?,
            created: self.search_bucket(GithubIssueBucket::Created)?,
        };
        let linked_pull_requests_by_issue_id = self.linked_pull_requests_by_issue_id(&buckets)?;

        let buckets = move_in_progress_issues(buckets, &linked_pull_requests_by_issue_id);
        Ok(sort_issue_buckets(enforce_issue_bucket_priority(buckets)))
    }

    fn search_bucket(&self, bucket: GithubIssueBucket) -> Result<Vec<IssueSummary>, String> {
        let bucket_args = github_issue_bucket_search_args(bucket);
        let args = [
            "search",
            "issues",
            bucket_args.0,
            bucket_args.1,
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

    fn linked_pull_requests_by_issue_id(
        &self,
        buckets: &IssueBuckets,
    ) -> Result<HashMap<String, Vec<IssueLinkedPullRequest>>, String> {
        let mut seen_issue_ids = HashSet::new();
        let mut issue_ids = Vec::new();
        for issue in buckets
            .assigned
            .iter()
            .chain(buckets.subscribed.iter())
            .chain(buckets.created.iter())
        {
            if seen_issue_ids.insert(issue.id.clone()) {
                issue_ids.push(issue.id.clone());
            }
        }

        if issue_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut linked_pull_requests_by_issue_id = HashMap::new();

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
                let linked_pull_requests = issue
                    .closed_by_pull_requests_references
                    .nodes
                    .into_iter()
                    .flatten()
                    .map(map_linked_pull_request)
                    .collect::<Vec<_>>();

                if issue.closed_by_pull_requests_references.total_count > 0
                    && !linked_pull_requests.is_empty()
                {
                    linked_pull_requests_by_issue_id.insert(issue.id, linked_pull_requests);
                }
            }
        }

        Ok(linked_pull_requests_by_issue_id)
    }
}

fn github_issue_bucket_search_args(bucket: GithubIssueBucket) -> (&'static str, &'static str) {
    match bucket {
        GithubIssueBucket::Assigned => ("--assignee", "@me"),
        GithubIssueBucket::Subscribed => ("--mentions", "@me"),
        GithubIssueBucket::Created => ("--author", "@me"),
    }
}

fn map_search_issue(issue: GhSearchIssue) -> IssueSummary {
    let author = issue.author;
    IssueSummary {
        id: issue.id,
        provider: IssueProvider::Github,
        number: Some(issue.number),
        key: None,
        title: issue.title,
        state: issue.state,
        repo: Some(issue.repository.name_with_owner),
        team_name: None,
        author_login: author.as_ref().map(|author| author.login.clone()),
        author_avatar_url: author.and_then(|author| author.avatar_url),
        assignee_name: None,
        comment_count: issue.comments_count.unwrap_or(0),
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        url: issue.url,
        linked_pull_requests: Vec::new(),
    }
}

fn map_linked_pull_request(pull_request: GraphQlLinkedPullRequest) -> IssueLinkedPullRequest {
    IssueLinkedPullRequest {
        number: pull_request.number,
        title: pull_request.title,
        repo: pull_request.repository.name_with_owner,
        url: pull_request.url,
    }
}

fn move_in_progress_issues(
    mut buckets: IssueBuckets,
    linked_pull_requests_by_issue_id: &HashMap<String, Vec<IssueLinkedPullRequest>>,
) -> IssueBuckets {
    let mut seen_in_progress_ids = HashSet::new();
    let mut in_progress = Vec::new();

    extract_in_progress_issues(
        &mut buckets.assigned,
        linked_pull_requests_by_issue_id,
        &mut seen_in_progress_ids,
        &mut in_progress,
    );
    extract_in_progress_issues(
        &mut buckets.subscribed,
        linked_pull_requests_by_issue_id,
        &mut seen_in_progress_ids,
        &mut in_progress,
    );
    extract_in_progress_issues(
        &mut buckets.created,
        linked_pull_requests_by_issue_id,
        &mut seen_in_progress_ids,
        &mut in_progress,
    );

    buckets.in_progress = in_progress;
    buckets
}

fn extract_in_progress_issues(
    issues: &mut Vec<IssueSummary>,
    linked_pull_requests_by_issue_id: &HashMap<String, Vec<IssueLinkedPullRequest>>,
    seen_in_progress_ids: &mut HashSet<String>,
    in_progress: &mut Vec<IssueSummary>,
) {
    let mut remaining = Vec::with_capacity(issues.len());

    for issue in issues.drain(..) {
        if let Some(linked_pull_requests) = linked_pull_requests_by_issue_id.get(&issue.id) {
            if seen_in_progress_ids.insert(issue.id.clone()) {
                let mut issue = issue;
                issue.linked_pull_requests = linked_pull_requests.clone();
                in_progress.push(issue);
            }
        } else {
            remaining.push(issue);
        }
    }

    *issues = remaining;
}

pub fn empty_issue_buckets() -> IssueBuckets {
    IssueBuckets {
        in_progress: Vec::new(),
        assigned: Vec::new(),
        subscribed: Vec::new(),
        created: Vec::new(),
    }
}

pub fn merge_issue_buckets(mut left: IssueBuckets, right: IssueBuckets) -> IssueBuckets {
    left.in_progress.extend(right.in_progress);
    left.assigned.extend(right.assigned);
    left.subscribed.extend(right.subscribed);
    left.created.extend(right.created);

    sort_issue_buckets(enforce_issue_bucket_priority(left))
}

pub fn count_issue_buckets(buckets: &IssueBuckets) -> IssueBucketCounts {
    let in_progress = buckets.in_progress.len() as u32;
    let assigned = buckets.assigned.len() as u32;
    let subscribed = buckets.subscribed.len() as u32;
    let created = buckets.created.len() as u32;

    IssueBucketCounts {
        in_progress,
        assigned,
        subscribed,
        created,
        total: in_progress + assigned + subscribed + created,
    }
}

pub fn enforce_issue_bucket_priority(mut buckets: IssueBuckets) -> IssueBuckets {
    let mut seen_issue_ids = HashSet::new();

    buckets.in_progress = retain_unseen_issues(buckets.in_progress, &mut seen_issue_ids);
    buckets.assigned = retain_unseen_issues(buckets.assigned, &mut seen_issue_ids);
    buckets.subscribed = retain_unseen_issues(buckets.subscribed, &mut seen_issue_ids);
    buckets.created = retain_unseen_issues(buckets.created, &mut seen_issue_ids);

    buckets
}

fn retain_unseen_issues(
    issues: Vec<IssueSummary>,
    seen_issue_ids: &mut HashSet<(IssueProvider, String)>,
) -> Vec<IssueSummary> {
    issues
        .into_iter()
        .filter(|issue| seen_issue_ids.insert((issue.provider, issue.id.clone())))
        .collect()
}

fn sort_issue_buckets(mut buckets: IssueBuckets) -> IssueBuckets {
    sort_issues_by_updated_at(&mut buckets.in_progress);
    sort_issues_by_updated_at(&mut buckets.assigned);
    sort_issues_by_updated_at(&mut buckets.subscribed);
    sort_issues_by_updated_at(&mut buckets.created);

    buckets
}

fn sort_issues_by_updated_at(issues: &mut [IssueSummary]) {
    issues.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
}

const ISSUE_LINKED_PULL_REQUESTS_QUERY: &str = r#"
query IssueLinkedPullRequests($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      id
      closedByPullRequestsReferences(first: 10) {
        totalCount
        nodes {
          number
          title
          url
          repository {
            nameWithOwner
          }
        }
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
            subscribed: vec![issue("subscribed-1", "Subscribed issue")],
            created: vec![duplicate],
        };
        let linked_pull_requests_by_issue_id = HashMap::from([(
            "linked-1".to_string(),
            vec![linked_pull_request(42), linked_pull_request(43)],
        )]);

        let buckets = move_in_progress_issues(buckets, &linked_pull_requests_by_issue_id);

        assert_eq!(buckets.in_progress.len(), 1);
        assert_eq!(buckets.in_progress[0].id, "linked-1");
        assert_eq!(buckets.in_progress[0].linked_pull_requests.len(), 2);
        assert_eq!(buckets.in_progress[0].linked_pull_requests[0].number, 42);
        assert_eq!(buckets.in_progress[0].linked_pull_requests[1].number, 43);
        assert_eq!(buckets.assigned.len(), 1);
        assert_eq!(buckets.assigned[0].id, "open-1");
        assert_eq!(buckets.subscribed.len(), 1);
        assert_eq!(buckets.subscribed[0].id, "subscribed-1");
        assert!(buckets.created.is_empty());
    }

    #[test]
    fn maps_graphql_pull_request_nodes_to_linked_pull_requests() {
        let transport = MockTransport::with_responses(vec![Ok(r#"{
              "data": {
                "nodes": [
                  {
                    "id": "linked-1",
                    "closedByPullRequestsReferences": {
                      "totalCount": 2,
                      "nodes": [
                        {
                          "number": 42,
                          "title": "First PR",
                          "url": "https://github.com/owner/repo/pull/42",
                          "repository": { "nameWithOwner": "owner/repo" }
                        },
                        {
                          "number": 43,
                          "title": "Second PR",
                          "url": "https://github.com/owner/repo/pull/43",
                          "repository": { "nameWithOwner": "owner/repo" }
                        }
                      ]
                    }
                  },
                  {
                    "id": "unlinked-1",
                    "closedByPullRequestsReferences": {
                      "totalCount": 0,
                      "nodes": []
                    }
                  },
                  null
                ]
              }
            }"#
        .into())]);
        let service = IssueSearchService::with_transport(&transport);
        let buckets = IssueBuckets {
            in_progress: Vec::new(),
            assigned: vec![issue("linked-1", "Linked issue")],
            subscribed: vec![issue("unlinked-1", "Unlinked issue")],
            created: Vec::new(),
        };

        let linked_pull_requests_by_issue_id =
            service.linked_pull_requests_by_issue_id(&buckets).unwrap();

        let linked_pull_requests = linked_pull_requests_by_issue_id
            .get("linked-1")
            .expect("linked issue should be present");
        assert_eq!(linked_pull_requests.len(), 2);
        assert_eq!(linked_pull_requests[0].number, 42);
        assert_eq!(linked_pull_requests[0].title, "First PR");
        assert_eq!(linked_pull_requests[0].repo, "owner/repo");
        assert_eq!(
            linked_pull_requests[0].url,
            "https://github.com/owner/repo/pull/42"
        );
        assert!(!linked_pull_requests_by_issue_id.contains_key("unlinked-1"));
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
            provider: IssueProvider::Github,
            number: Some(1),
            key: None,
            title: title.to_string(),
            state: "open".to_string(),
            repo: Some("owner/repo".to_string()),
            team_name: None,
            author_login: Some("octocat".to_string()),
            author_avatar_url: None,
            assignee_name: None,
            comment_count: 0,
            created_at: "2026-05-16T00:00:00Z".to_string(),
            updated_at: "2026-05-16T00:00:00Z".to_string(),
            url: format!("https://github.com/owner/repo/issues/{id}"),
            linked_pull_requests: Vec::new(),
        }
    }

    fn linked_pull_request(number: u32) -> IssueLinkedPullRequest {
        IssueLinkedPullRequest {
            number,
            title: format!("PR {number}"),
            repo: "owner/repo".to_string(),
            url: format!("https://github.com/owner/repo/pull/{number}"),
        }
    }
}
