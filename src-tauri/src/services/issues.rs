use crate::github::run_gh;
use crate::models::{GhSearchIssue, IssueBuckets, IssueRole, IssueRoleCounts, IssueSummary};

const ISSUE_SEARCH_LIMIT: &str = "50";
const ISSUE_SEARCH_JSON_FIELDS: &str =
    "number,title,repository,author,createdAt,updatedAt,commentsCount,state,url";

pub struct IssueSearchService;

impl IssueSearchService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_open_buckets(&self) -> Result<IssueBuckets, String> {
        Ok(IssueBuckets {
            assigned: self.search_role(IssueRole::Assigned)?,
            mentioned: self.search_role(IssueRole::Mentioned)?,
            authored: self.search_role(IssueRole::Authored)?,
        })
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
