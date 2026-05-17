use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::json;

use crate::models::{
    GraphQlError, GraphQlResponse, IssueBuckets, IssueProvider, IssueSummary,
    LinearIntegrationStatus, LinearIssue, LinearIssueBucketsQueryData, LinearUser,
    LinearViewerQueryData,
};

const LINEAR_API_URL: &str = "https://api.linear.app/graphql";
const LINEAR_KEYCHAIN_SERVICE: &str = "com.tanvesh.rudu";
const LINEAR_KEYCHAIN_ACCOUNT: &str = "linear-api-key";
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
        linked_pull_requests: Vec::new(),
    }
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
}
"#;
