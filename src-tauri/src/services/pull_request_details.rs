use crate::models::{
    GraphQlPullRequestOverview, GraphQlStatusCheckContext, PullRequestCheck,
    PullRequestCheckStatus, PullRequestChecks, PullRequestChecksQueryData, PullRequestOverview,
    PullRequestOverviewQueryData,
};
use crate::services::review_graphql::{
    parse_graphql_response, GraphqlTransport, GraphqlVariable,
};
use crate::support::parse_repo;

pub struct PullRequestDetailsService<T: GraphqlTransport> {
    transport: T,
}

impl<T: GraphqlTransport> PullRequestDetailsService<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }

    pub fn get_overview(&self, repo: &str, number: u32) -> Result<PullRequestOverview, String> {
        let (owner, name) = parse_repo(repo)?;
        let stdout = self.transport.execute(
            PULL_REQUEST_OVERVIEW_QUERY,
            &[
                GraphqlVariable::string("owner", owner),
                GraphqlVariable::string("name", name),
                GraphqlVariable::literal("number", number),
            ],
        )?;
        let data = parse_graphql_response::<PullRequestOverviewQueryData>(
            &stdout,
            "pull request overview",
        )?;

        let pull_request = data
            .repository
            .and_then(|repository| repository.pull_request)
            .ok_or_else(|| "Pull request not found".to_string())?;

        Ok(map_pull_request_overview(repo, pull_request))
    }

    pub fn get_checks(&self, repo: &str, number: u32) -> Result<PullRequestChecks, String> {
        let (owner, name) = parse_repo(repo)?;
        let stdout = self.transport.execute(
            PULL_REQUEST_CHECKS_QUERY,
            &[
                GraphqlVariable::string("owner", owner),
                GraphqlVariable::string("name", name),
                GraphqlVariable::literal("number", number),
            ],
        )?;
        let data =
            parse_graphql_response::<PullRequestChecksQueryData>(&stdout, "pull request checks")?;
        let pull_request = data
            .repository
            .and_then(|repository| repository.pull_request)
            .ok_or_else(|| "Pull request not found".to_string())?;

        let Some(rollup) = pull_request.status_check_rollup else {
            return Ok(PullRequestChecks {
                repo: repo.to_string(),
                number,
                status: PullRequestCheckStatus::Unknown,
                checks: Vec::new(),
            });
        };

        let status = normalize_rollup_state(rollup.state.as_deref());
        let checks = rollup
            .contexts
            .nodes
            .into_iter()
            .enumerate()
            .filter_map(|(index, node)| map_check_context(index as u32, node))
            .collect();

        Ok(PullRequestChecks {
            repo: repo.to_string(),
            number,
            status,
            checks,
        })
    }
}

fn map_pull_request_overview(
    repo: &str,
    pull_request: GraphQlPullRequestOverview,
) -> PullRequestOverview {
    PullRequestOverview {
        repo: repo.to_string(),
        number: pull_request.number,
        title: pull_request.title,
        body: pull_request.body,
        state: pull_request.state,
        is_draft: pull_request.is_draft,
        url: pull_request.url,
        updated_at: pull_request.updated_at,
        author_login: pull_request
            .author
            .as_ref()
            .map(|author| author.login.clone())
            .unwrap_or_else(|| "unknown".into()),
        author_avatar_url: pull_request.author.and_then(|author| author.avatar_url),
    }
}

fn map_check_context(order: u32, node: GraphQlStatusCheckContext) -> Option<PullRequestCheck> {
    match node {
        GraphQlStatusCheckContext::CheckRun {
            name,
            status,
            conclusion,
            started_at,
            completed_at,
            check_suite,
        } => {
            let status = normalize_check_run_status(status.as_deref(), conclusion.as_deref());
            Some(PullRequestCheck {
                order,
                title: name,
                status,
                logo_url: check_suite
                    .and_then(|suite| suite.app)
                    .and_then(|app| app.logo_url),
                started_at,
                completed_at,
                created_at: None,
                is_terminal: is_terminal_status(status),
            })
        }
        GraphQlStatusCheckContext::StatusContext {
            context,
            state,
            avatar_url,
            created_at,
        } => {
            let status = normalize_status_context_state(state.as_deref());
            Some(PullRequestCheck {
                order,
                title: context,
                status,
                logo_url: avatar_url,
                started_at: None,
                completed_at: None,
                created_at,
                is_terminal: is_terminal_status(status),
            })
        }
        GraphQlStatusCheckContext::Unknown => None,
    }
}

fn normalize_rollup_state(state: Option<&str>) -> PullRequestCheckStatus {
    match state.unwrap_or("").to_ascii_uppercase().as_str() {
        "SUCCESS" => PullRequestCheckStatus::Pass,
        "FAILURE" | "ERROR" => PullRequestCheckStatus::Fail,
        "PENDING" | "EXPECTED" => PullRequestCheckStatus::Pending,
        _ => PullRequestCheckStatus::Unknown,
    }
}

fn normalize_status_context_state(state: Option<&str>) -> PullRequestCheckStatus {
    match state.unwrap_or("").to_ascii_uppercase().as_str() {
        "SUCCESS" => PullRequestCheckStatus::Pass,
        "FAILURE" | "ERROR" => PullRequestCheckStatus::Fail,
        "PENDING" | "EXPECTED" => PullRequestCheckStatus::Pending,
        _ => PullRequestCheckStatus::Unknown,
    }
}

fn normalize_check_run_status(
    status: Option<&str>,
    conclusion: Option<&str>,
) -> PullRequestCheckStatus {
    if status
        .map(|status| status.eq_ignore_ascii_case("COMPLETED"))
        != Some(true)
    {
        return PullRequestCheckStatus::Pending;
    }

    match conclusion.unwrap_or("").to_ascii_uppercase().as_str() {
        "SUCCESS" => PullRequestCheckStatus::Pass,
        "FAILURE" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => {
            PullRequestCheckStatus::Fail
        }
        "SKIPPED" => PullRequestCheckStatus::Skipped,
        "CANCELLED" => PullRequestCheckStatus::Cancelled,
        "NEUTRAL" => PullRequestCheckStatus::Neutral,
        _ => PullRequestCheckStatus::Unknown,
    }
}

fn is_terminal_status(status: PullRequestCheckStatus) -> bool {
    !matches!(status, PullRequestCheckStatus::Pending)
}

const PULL_REQUEST_OVERVIEW_QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      body
      state
      isDraft
      url
      updatedAt
      author {
        login
        avatarUrl(size: 64)
      }
    }
  }
}
"#;

const PULL_REQUEST_CHECKS_QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      statusCheckRollup {
        state
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun {
              name
              status
              conclusion
              startedAt
              completedAt
              checkSuite {
                app {
                  logoUrl
                }
              }
            }
            ... on StatusContext {
              context
              state
              avatarUrl
              createdAt
            }
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
    use crate::services::review_graphql::GhGraphqlTransport;

    struct StaticTransport(&'static str);

    impl GraphqlTransport for StaticTransport {
        fn execute(&self, _query: &str, _vars: &[GraphqlVariable]) -> Result<String, String> {
            Ok(self.0.into())
        }
    }

    #[test]
    fn maps_check_run_with_app_logo() {
        let service = PullRequestDetailsService::new(StaticTransport(
            r#"{"data":{"repository":{"pullRequest":{"statusCheckRollup":{"state":"SUCCESS","contexts":{"nodes":[{"__typename":"CheckRun","name":"unit tests","status":"COMPLETED","conclusion":"SUCCESS","startedAt":"2026-05-05T10:00:00Z","completedAt":"2026-05-05T10:01:05Z","checkSuite":{"app":{"logoUrl":"https://example.com/logo.png"}}}]}}}}}}"#,
        ));

        let checks = service.get_checks("example/repo", 1).unwrap();

        assert_eq!(checks.status, PullRequestCheckStatus::Pass);
        assert_eq!(checks.checks.len(), 1);
        assert_eq!(checks.checks[0].order, 0);
        assert_eq!(checks.checks[0].title, "unit tests");
        assert_eq!(checks.checks[0].status, PullRequestCheckStatus::Pass);
        assert_eq!(
            checks.checks[0].logo_url.as_deref(),
            Some("https://example.com/logo.png")
        );
        assert_eq!(
            checks.checks[0].started_at.as_deref(),
            Some("2026-05-05T10:00:00Z")
        );
        assert_eq!(
            checks.checks[0].completed_at.as_deref(),
            Some("2026-05-05T10:01:05Z")
        );
        assert_eq!(checks.checks[0].created_at, None);
    }

    #[test]
    fn maps_status_context_with_avatar_logo() {
        let service = PullRequestDetailsService::new(StaticTransport(
            r#"{"data":{"repository":{"pullRequest":{"statusCheckRollup":{"state":"SUCCESS","contexts":{"nodes":[{"__typename":"StatusContext","context":"legacy ci","state":"SUCCESS","avatarUrl":"https://example.com/avatar.png","createdAt":"2026-05-05T10:00:00Z"}]}}}}}}"#,
        ));

        let checks = service.get_checks("example/repo", 1).unwrap();

        assert_eq!(checks.checks[0].title, "legacy ci");
        assert_eq!(checks.checks[0].status, PullRequestCheckStatus::Pass);
        assert_eq!(
            checks.checks[0].logo_url.as_deref(),
            Some("https://example.com/avatar.png")
        );
        assert_eq!(checks.checks[0].started_at, None);
        assert_eq!(checks.checks[0].completed_at, None);
        assert_eq!(
            checks.checks[0].created_at.as_deref(),
            Some("2026-05-05T10:00:00Z")
        );
    }

    #[test]
    fn preserves_order_for_mixed_check_contexts() {
        let service = PullRequestDetailsService::new(StaticTransport(
            r#"{"data":{"repository":{"pullRequest":{"statusCheckRollup":{"state":"FAILURE","contexts":{"nodes":[{"__typename":"CheckRun","name":"changes","status":"COMPLETED","conclusion":"SUCCESS","startedAt":"2026-05-05T10:00:00Z","completedAt":"2026-05-05T10:00:05Z","checkSuite":{"app":{"logoUrl":"https://example.com/checks.png"}}},{"__typename":"StatusContext","context":"security/snyk (Follow Alice)","state":"ERROR","avatarUrl":"https://example.com/snyk.png","createdAt":"2026-05-05T10:00:00Z"}]}}}}}}"#,
        ));

        let checks = service.get_checks("example/repo", 1).unwrap();

        assert_eq!(checks.status, PullRequestCheckStatus::Fail);
        assert_eq!(checks.checks.len(), 2);
        assert_eq!(checks.checks[0].order, 0);
        assert_eq!(checks.checks[0].title, "changes");
        assert_eq!(checks.checks[0].status, PullRequestCheckStatus::Pass);
        assert_eq!(
            checks.checks[0].logo_url.as_deref(),
            Some("https://example.com/checks.png")
        );
        assert_eq!(checks.checks[1].order, 1);
        assert_eq!(checks.checks[1].title, "security/snyk (Follow Alice)");
        assert_eq!(checks.checks[1].status, PullRequestCheckStatus::Fail);
        assert_eq!(
            checks.checks[1].logo_url.as_deref(),
            Some("https://example.com/snyk.png")
        );
    }

    #[test]
    fn maps_empty_checks() {
        let service = PullRequestDetailsService::new(StaticTransport(
            r#"{"data":{"repository":{"pullRequest":{"statusCheckRollup":null}}}}"#,
        ));

        let checks = service.get_checks("example/repo", 1).unwrap();

        assert_eq!(checks.status, PullRequestCheckStatus::Unknown);
        assert!(checks.checks.is_empty());
    }

    #[test]
    fn ignores_unknown_check_context_typenames() {
        let service = PullRequestDetailsService::new(StaticTransport(
            r#"{"data":{"repository":{"pullRequest":{"statusCheckRollup":{"state":"PENDING","contexts":{"nodes":[{"__typename":"CheckRun","name":"prepare-slug","status":"IN_PROGRESS","conclusion":null,"startedAt":"2026-05-05T10:00:00Z","completedAt":null,"checkSuite":{"app":{"logoUrl":"https://example.com/checks.png"}}},{"__typename":"Deployment","state":"PENDING"}]}}}}}}"#,
        ));

        let checks = service.get_checks("example/repo", 1).unwrap();

        assert_eq!(checks.status, PullRequestCheckStatus::Pending);
        assert_eq!(checks.checks.len(), 1);
        assert_eq!(checks.checks[0].order, 0);
        assert_eq!(checks.checks[0].title, "prepare-slug");
        assert_eq!(checks.checks[0].status, PullRequestCheckStatus::Pending);
    }

    #[test]
    fn normalizes_check_states() {
        assert_eq!(
            normalize_check_run_status(Some("IN_PROGRESS"), None),
            PullRequestCheckStatus::Pending
        );
        assert_eq!(
            normalize_check_run_status(Some("COMPLETED"), Some("FAILURE")),
            PullRequestCheckStatus::Fail
        );
        assert_eq!(
            normalize_check_run_status(Some("COMPLETED"), Some("SKIPPED")),
            PullRequestCheckStatus::Skipped
        );
        assert_eq!(
            normalize_check_run_status(Some("COMPLETED"), Some("CANCELLED")),
            PullRequestCheckStatus::Cancelled
        );
    }

    #[test]
    fn constructs_with_real_transport_type() {
        let _service = PullRequestDetailsService::new(GhGraphqlTransport);
    }
}
