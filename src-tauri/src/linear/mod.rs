use std::{collections::HashSet, time::Duration};

use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::json;

use crate::models::{
    GraphQlError, GraphQlResponse, IssueBuckets, IssueLinkedPullRequest, IssueProvider,
    IssueSummary, LinearAttachment, LinearAttachmentConnection, LinearIntegrationStatus,
    LinearIssue, LinearIssueBucketsQueryData, LinearIssueDetailQueryData, LinearUser,
    LinearViewerQueryData,
};

const LINEAR_API_URL: &str = "https://api.linear.app/graphql";
const LINEAR_KEYCHAIN_SERVICE: &str = "com.tanvesh.rudu";
const LINEAR_KEYCHAIN_ACCOUNT: &str = "linear-api-key";
pub const LINEAR_MCP_API_KEY_ENV: &str = "RUDU_LINEAR_MCP_API_KEY";
pub const LINEAR_MCP_DEBUG_LOG_ENV: &str = "RUDU_LINEAR_MCP_DEBUG_LOG";
const LINEAR_ISSUE_LIMIT: i32 = 50;

pub struct LinearIntegrationService;

impl LinearIntegrationService {
    pub fn new() -> Self {
        Self
    }

    pub fn status(&self) -> LinearIntegrationStatus {
        match get_linear_api_key() {
            Ok(Some(api_key)) => {
                match LinearClient::new(api_key).and_then(|client| client.viewer()) {
                    Ok(viewer) => connected_status(&viewer),
                    Err(error) => configured_error_status(error),
                }
            }
            Ok(None) => unconfigured_status(),
            Err(error) => configured_error_status(error),
        }
    }

    pub fn save_api_key(&self, api_key: String) -> Result<LinearIntegrationStatus, String> {
        let trimmed_api_key = api_key.trim();
        if trimmed_api_key.is_empty() {
            return Err("Linear API key is required.".to_string());
        }

        let viewer = LinearClient::new(trimmed_api_key.to_string())?.viewer()?;
        set_linear_api_key(trimmed_api_key)?;

        Ok(connected_status(&viewer))
    }

    pub fn delete_api_key(&self) -> Result<LinearIntegrationStatus, String> {
        delete_linear_api_key()?;
        Ok(unconfigured_status())
    }

    pub fn list_buckets(&self) -> (IssueBuckets, LinearIntegrationStatus) {
        match get_linear_api_key() {
            Ok(Some(api_key)) => {
                match LinearClient::new(api_key).and_then(|client| client.list_issue_buckets()) {
                    Ok(data) => data,
                    Err(error) => (empty_issue_buckets(), configured_error_status(error)),
                }
            }
            Ok(None) => (empty_issue_buckets(), unconfigured_status()),
            Err(error) => (empty_issue_buckets(), configured_error_status(error)),
        }
    }

    pub fn api_key_for_session_mcp(&self) -> Result<Option<String>, String> {
        get_linear_api_key()
    }

    pub fn get_issue_details(&self, issue_id: &str) -> Result<LinearIssueDetails, String> {
        let api_key = get_linear_api_key_for_details()?
            .ok_or_else(|| "Linear is not integrated in Rudu.".to_string())?;
        LinearClient::new(api_key)?.get_issue_details(issue_id)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearIssueDetails {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
    pub team_name: Option<String>,
    pub assignee_name: Option<String>,
}

struct LinearClient {
    api_key: String,
    http: Client,
}

impl LinearClient {
    fn new(api_key: String) -> Result<Self, String> {
        Ok(Self {
            api_key,
            http: Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .map_err(|error| format!("Failed to configure Linear HTTP client: {error}"))?,
        })
    }

    fn viewer(&self) -> Result<LinearUser, String> {
        let data = self.execute::<LinearViewerQueryData>(LINEAR_VIEWER_QUERY, json!({}))?;
        Ok(data.viewer)
    }

    fn list_issue_buckets(&self) -> Result<(IssueBuckets, LinearIntegrationStatus), String> {
        let viewer = self.viewer()?;
        let data = self.execute::<LinearIssueBucketsQueryData>(
            LINEAR_ISSUE_BUCKETS_QUERY,
            json!({
                "viewerId": viewer.id.clone(),
                "first": LINEAR_ISSUE_LIMIT,
            }),
        )?;

        let buckets = IssueBuckets {
            in_progress: data
                .in_progress
                .nodes
                .into_iter()
                .map(map_linear_issue)
                .collect(),
            assigned: data
                .assigned
                .nodes
                .into_iter()
                .map(map_linear_issue)
                .collect(),
            subscribed: data
                .subscribed
                .nodes
                .into_iter()
                .map(map_linear_issue)
                .collect(),
            created: data
                .created
                .nodes
                .into_iter()
                .map(map_linear_issue)
                .collect(),
        };

        Ok((buckets, connected_status(&viewer)))
    }

    fn get_issue_details(&self, issue_id: &str) -> Result<LinearIssueDetails, String> {
        let trimmed_issue_id = issue_id.trim();
        if trimmed_issue_id.is_empty() {
            return Err("Linear issue ID is required.".to_string());
        }

        let data = self.execute::<LinearIssueDetailQueryData>(
            LINEAR_ISSUE_DETAIL_QUERY,
            json!({
                "issueId": trimmed_issue_id,
            }),
        )?;

        data.issue
            .map(map_linear_issue_details)
            .ok_or_else(|| format!("Linear issue not found: {trimmed_issue_id}"))
    }

    fn execute<T>(&self, query: &str, variables: serde_json::Value) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        let response = self
            .http
            .post(LINEAR_API_URL)
            .header("Authorization", &self.api_key)
            .json(&GraphQlRequest { query, variables })
            .send()
            .map_err(|error| format!("Failed to reach Linear: {error}"))?;

        let status = response.status();
        let body = response
            .text()
            .map_err(|error| format!("Failed to read Linear response: {error}"))?;

        if !status.is_success() {
            return Err(format!(
                "Linear returned HTTP {status}: {}",
                trim_body(&body)
            ));
        }

        parse_linear_graphql_response(&body)
    }
}

#[derive(Serialize)]
struct GraphQlRequest<'a> {
    query: &'a str,
    variables: serde_json::Value,
}

fn parse_linear_graphql_response<T>(body: &str) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let response = serde_json::from_str::<GraphQlResponse<T>>(body)
        .map_err(|error| format!("Failed to parse Linear response: {error}"))?;

    if let Some(errors) = response.errors {
        return Err(format_linear_graphql_errors(errors));
    }

    response
        .data
        .ok_or_else(|| "Linear returned no GraphQL data.".to_string())
}

fn format_linear_graphql_errors(errors: Vec<GraphQlError>) -> String {
    let messages = errors
        .into_iter()
        .map(|error| error.message)
        .collect::<Vec<_>>()
        .join("\n");

    if messages.is_empty() {
        "Linear returned an unknown GraphQL error.".to_string()
    } else {
        messages
    }
}

fn trim_body(body: &str) -> String {
    let trimmed = body.trim();
    let preview = trimmed.chars().take(240).collect::<String>();
    if preview.len() < trimmed.len() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn linear_keychain_entry() -> Result<Entry, String> {
    Entry::new(LINEAR_KEYCHAIN_SERVICE, LINEAR_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("Failed to open OS keychain entry: {error}"))
}

fn get_linear_api_key() -> Result<Option<String>, String> {
    match linear_keychain_entry()?.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Failed to read Linear API key from OS keychain: {error}"
        )),
    }
}

fn get_linear_api_key_for_details() -> Result<Option<String>, String> {
    if let Ok(api_key) = std::env::var(LINEAR_MCP_API_KEY_ENV) {
        let api_key = api_key.trim();
        if !api_key.is_empty() {
            return Ok(Some(api_key.to_string()));
        }
    }

    get_linear_api_key()
}

fn set_linear_api_key(api_key: &str) -> Result<(), String> {
    linear_keychain_entry()?
        .set_password(api_key)
        .map_err(|error| format!("Failed to save Linear API key to OS keychain: {error}"))
}

fn delete_linear_api_key() -> Result<(), String> {
    match linear_keychain_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove Linear API key from OS keychain: {error}"
        )),
    }
}

fn connected_status(viewer: &LinearUser) -> LinearIntegrationStatus {
    LinearIntegrationStatus {
        configured: true,
        connected: true,
        display_name: user_display_name(viewer),
        error: None,
    }
}

fn configured_error_status(error: String) -> LinearIntegrationStatus {
    LinearIntegrationStatus {
        configured: true,
        connected: false,
        display_name: None,
        error: Some(error),
    }
}

fn unconfigured_status() -> LinearIntegrationStatus {
    LinearIntegrationStatus {
        configured: false,
        connected: false,
        display_name: None,
        error: None,
    }
}

fn map_linear_issue(issue: LinearIssue) -> IssueSummary {
    let creator = issue.creator;
    let assignee = issue.assignee;
    let team = issue.team;
    let linked_pull_requests = linked_pull_requests_from_attachments(issue.attachments);
    let state = issue
        .state
        .map(|state| state.name)
        .unwrap_or_else(|| "Unknown".to_string());

    IssueSummary {
        id: issue.id,
        provider: IssueProvider::Linear,
        number: None,
        key: Some(issue.identifier),
        title: issue.title,
        state,
        repo: None,
        team_name: team.map(|team| {
            if team.key.trim().is_empty() {
                team.name
            } else {
                format!("{} - {}", team.key, team.name)
            }
        }),
        author_login: creator.as_ref().and_then(user_display_name),
        author_avatar_url: creator.and_then(|user| user.avatar_url),
        assignee_name: assignee.as_ref().and_then(user_display_name),
        comment_count: 0,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        url: issue.url,
        linked_pull_requests,
    }
}

fn map_linear_issue_details(issue: LinearIssue) -> LinearIssueDetails {
    let assignee = issue.assignee;
    let team = issue.team;
    let state = issue
        .state
        .map(|state| state.name)
        .unwrap_or_else(|| "Unknown".to_string());

    LinearIssueDetails {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        state,
        url: issue.url,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        team_name: team.map(|team| {
            if team.key.trim().is_empty() {
                team.name
            } else {
                format!("{} - {}", team.key, team.name)
            }
        }),
        assignee_name: assignee.as_ref().and_then(user_display_name),
    }
}

fn linked_pull_requests_from_attachments(
    attachments: Option<LinearAttachmentConnection>,
) -> Vec<IssueLinkedPullRequest> {
    let mut seen = HashSet::new();

    attachments
        .map(|attachments| attachments.nodes)
        .unwrap_or_default()
        .into_iter()
        .filter_map(map_linear_attachment_pull_request)
        .filter(|pull_request| seen.insert((pull_request.repo.clone(), pull_request.number)))
        .collect()
}

fn map_linear_attachment_pull_request(
    attachment: LinearAttachment,
) -> Option<IssueLinkedPullRequest> {
    let url = attachment.url?;
    let (repo, number) = parse_github_pull_request_url(&url)?;
    let title = attachment
        .title
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| format!("#{number}"));

    Some(IssueLinkedPullRequest {
        number,
        title,
        repo,
        url,
    })
}

fn parse_github_pull_request_url(value: &str) -> Option<(String, u32)> {
    let value = value.trim();
    let value = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .unwrap_or(value);
    let value = value.strip_prefix("www.").unwrap_or(value);
    let path = value.strip_prefix("github.com/")?;
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or(path)
        .trim_matches('/');

    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    let marker = parts.next()?;
    let number = parts.next()?.parse::<u32>().ok()?;

    if owner.is_empty() || repo.is_empty() || marker != "pull" {
        return None;
    }

    Some((format!("{owner}/{repo}"), number))
}

fn empty_issue_buckets() -> IssueBuckets {
    IssueBuckets {
        in_progress: Vec::new(),
        assigned: Vec::new(),
        subscribed: Vec::new(),
        created: Vec::new(),
    }
}

fn user_display_name(user: &LinearUser) -> Option<String> {
    user.display_name
        .as_deref()
        .or(user.name.as_deref())
        .or(user.email.as_deref())
        .map(str::to_string)
}

const LINEAR_VIEWER_QUERY: &str = r#"
query RuduLinearViewer {
  viewer {
    id
    name
    displayName
    email
    avatarUrl
  }
}
"#;

const LINEAR_ISSUE_DETAIL_QUERY: &str = r#"
query RuduLinearIssueDetail($issueId: String!) {
  issue(id: $issueId) {
    ...RuduLinearIssueFields
  }
}

fragment RuduLinearIssueFields on Issue {
  id
  identifier
  title
  description
  url
  createdAt
  updatedAt
  state {
    name
  }
  assignee {
    id
    name
    displayName
    email
    avatarUrl
  }
  creator {
    id
    name
    displayName
    email
    avatarUrl
  }
  team {
    key
    name
  }
  attachments(first: 10) {
    nodes {
      title
      url
    }
  }
}
"#;

const LINEAR_ISSUE_BUCKETS_QUERY: &str = r#"
query RuduLinearIssueBuckets($viewerId: ID!, $first: Int!) {
  inProgress: issues(
    first: $first
    orderBy: updatedAt
    filter: {
      assignee: { id: { eq: $viewerId } }
      state: { type: { eq: "started" } }
    }
  ) {
    nodes {
      ...RuduLinearIssueFields
    }
  }
  assigned: issues(
    first: $first
    orderBy: updatedAt
    filter: {
      assignee: { id: { eq: $viewerId } }
      state: { type: { nin: ["completed", "canceled"] } }
    }
  ) {
    nodes {
      ...RuduLinearIssueFields
    }
  }
  subscribed: issues(
    first: $first
    orderBy: updatedAt
    filter: {
      subscribers: { some: { id: { eq: $viewerId } } }
      state: { type: { nin: ["completed", "canceled"] } }
    }
  ) {
    nodes {
      ...RuduLinearIssueFields
    }
  }
  created: issues(
    first: $first
    orderBy: updatedAt
    filter: {
      creator: { id: { eq: $viewerId } }
      state: { type: { nin: ["completed", "canceled"] } }
    }
  ) {
    nodes {
      ...RuduLinearIssueFields
    }
  }
}

fragment RuduLinearIssueFields on Issue {
  id
  identifier
  title
  url
  createdAt
  updatedAt
  state {
    name
  }
  assignee {
    id
    name
    displayName
    email
    avatarUrl
  }
  creator {
    id
    name
    displayName
    email
    avatarUrl
  }
  team {
    key
    name
  }
  attachments(first: 10) {
    nodes {
      title
      url
    }
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_linear_github_pull_request_attachments_to_linked_pull_requests() {
        let issue = linear_issue(vec![
            attachment(
                Some("Fix linked issue"),
                Some("https://github.com/outerworld/rudu/pull/42"),
            ),
            attachment(
                Some("Duplicate PR link"),
                Some("https://github.com/outerworld/rudu/pull/42#discussion_r1"),
            ),
            attachment(
                Some("GitHub issue is not a pull request"),
                Some("https://github.com/outerworld/rudu/issues/7"),
            ),
            attachment(
                Some("Design"),
                Some("https://linear.app/outerworld/issue/RUD-7"),
            ),
        ]);

        let summary = map_linear_issue(issue);

        assert_eq!(summary.linked_pull_requests.len(), 1);
        assert_eq!(summary.linked_pull_requests[0].number, 42);
        assert_eq!(summary.linked_pull_requests[0].title, "Fix linked issue");
        assert_eq!(summary.linked_pull_requests[0].repo, "outerworld/rudu");
        assert_eq!(
            summary.linked_pull_requests[0].url,
            "https://github.com/outerworld/rudu/pull/42"
        );
    }

    #[test]
    fn maps_linear_pull_request_attachment_without_title() {
        let linked_pull_request = map_linear_attachment_pull_request(attachment(
            Some("  "),
            Some("github.com/outerworld/rudu/pull/123?tab=files"),
        ))
        .expect("attachment should map to linked pull request");

        assert_eq!(linked_pull_request.number, 123);
        assert_eq!(linked_pull_request.title, "#123");
        assert_eq!(linked_pull_request.repo, "outerworld/rudu");
    }

    fn linear_issue(attachments: Vec<LinearAttachment>) -> LinearIssue {
        LinearIssue {
            id: "lin-issue-1".to_string(),
            identifier: "RUD-7".to_string(),
            title: "Linear issue".to_string(),
            description: None,
            url: "https://linear.app/outerworld/issue/RUD-7".to_string(),
            created_at: "2026-05-18T00:00:00Z".to_string(),
            updated_at: "2026-05-18T00:00:00Z".to_string(),
            state: None,
            assignee: None,
            creator: None,
            team: None,
            attachments: Some(LinearAttachmentConnection { nodes: attachments }),
        }
    }

    fn attachment(title: Option<&str>, url: Option<&str>) -> LinearAttachment {
        LinearAttachment {
            title: title.map(str::to_string),
            url: url.map(str::to_string),
        }
    }
}
