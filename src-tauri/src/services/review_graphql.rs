use crate::github::run_gh_graphql;
use crate::models::{
    GraphQlResponse, GraphQlReviewComment, GraphQlReviewThread, PullRequestNodeIdQueryData,
    ReviewComment, ReviewThread, ReviewThreadsQueryData,
};
use crate::support::parse_repo;

pub trait GraphqlTransport {
    fn execute(&self, query: &str, vars: &[GraphqlVariable]) -> Result<String, String>;
}

pub struct GhGraphqlTransport;

impl GraphqlTransport for GhGraphqlTransport {
    fn execute(&self, query: &str, vars: &[GraphqlVariable]) -> Result<String, String> {
        let mut args = vec!["api".to_string(), "graphql".to_string()];

        for var in vars {
            args.push(var.flag().to_string());
            args.push(format!("{}={}", var.name, var.value));
        }

        args.push("-f".to_string());
        args.push(format!("query={query}"));

        run_gh_graphql(&args)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphqlVariable {
    pub name: &'static str,
    pub value: String,
    kind: GraphqlVariableKind,
}

impl GraphqlVariable {
    fn string(name: &'static str, value: impl Into<String>) -> Self {
        Self {
            name,
            value: value.into(),
            kind: GraphqlVariableKind::String,
        }
    }

    fn literal(name: &'static str, value: impl ToString) -> Self {
        Self {
            name,
            value: value.to_string(),
            kind: GraphqlVariableKind::Literal,
        }
    }

    fn flag(&self) -> &'static str {
        match self.kind {
            GraphqlVariableKind::String => "-f",
            GraphqlVariableKind::Literal => "-F",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum GraphqlVariableKind {
    String,
    Literal,
}

pub struct CreatePullRequestReviewCommentInput {
    pub body: String,
    pub path: String,
    pub line: Option<u32>,
    pub side: Option<String>,
    pub start_line: Option<u32>,
    pub start_side: Option<String>,
    pub subject_type: String,
}

pub struct ReviewGraphqlClient<T: GraphqlTransport> {
    transport: T,
}

impl<T: GraphqlTransport> ReviewGraphqlClient<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }

    fn get_pull_request_node_id(
        &self,
        owner: &str,
        name: &str,
        number: u32,
    ) -> Result<String, String> {
        let stdout = self.transport.execute(
            PULL_REQUEST_NODE_ID_QUERY,
            &[
                GraphqlVariable::string("owner", owner),
                GraphqlVariable::string("name", name),
                GraphqlVariable::literal("number", number),
            ],
        )?;
        let data =
            parse_graphql_response::<PullRequestNodeIdQueryData>(&stdout, "pull request id")?;

        data.repository
            .and_then(|repo| repo.pull_request)
            .map(|pull_request| pull_request.id)
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "Pull request not found".to_string())
    }

    fn create_thread_comment(
        &self,
        pull_request_id: &str,
        input: CreatePullRequestReviewCommentInput,
    ) -> Result<(), String> {
        let mut vars = vec![
            GraphqlVariable::string("pullRequestId", pull_request_id),
            GraphqlVariable::string("body", input.body),
            GraphqlVariable::string("path", input.path),
            GraphqlVariable::string("subjectType", input.subject_type.to_uppercase()),
        ];

        if let Some(line) = input.line {
            vars.push(GraphqlVariable::literal("line", line));
        }
        if let Some(side) = input.side.filter(|side| !side.trim().is_empty()) {
            vars.push(GraphqlVariable::string("side", side));
        }
        if let Some(start_line) = input.start_line {
            vars.push(GraphqlVariable::literal("startLine", start_line));
        }
        if let Some(start_side) = input.start_side.filter(|side| !side.trim().is_empty()) {
            vars.push(GraphqlVariable::string("startSide", start_side));
        }

        let stdout = self
            .transport
            .execute(CREATE_THREAD_COMMENT_MUTATION, &vars)?;
        parse_graphql_response::<serde_json::Value>(&stdout, "create review comment")?;
        Ok(())
    }

    fn reply_to_thread(&self, thread_id: &str, body: &str) -> Result<(), String> {
        let stdout = self.transport.execute(
            REPLY_TO_THREAD_MUTATION,
            &[
                GraphqlVariable::string("threadId", thread_id),
                GraphqlVariable::string("body", body),
            ],
        )?;
        parse_graphql_response::<serde_json::Value>(&stdout, "reply to review thread")?;
        Ok(())
    }

    fn update_comment(&self, comment_id: &str, body: &str) -> Result<(), String> {
        let stdout = self.transport.execute(
            UPDATE_COMMENT_MUTATION,
            &[
                GraphqlVariable::string("commentId", comment_id),
                GraphqlVariable::string("body", body),
            ],
        )?;
        parse_graphql_response::<serde_json::Value>(&stdout, "update review comment")?;
        Ok(())
    }

    fn list_review_threads(
        &self,
        owner: &str,
        name: &str,
        number: u32,
    ) -> Result<Vec<ReviewThread>, String> {
        let stdout = self.transport.execute(
            REVIEW_THREADS_QUERY,
            &[
                GraphqlVariable::string("owner", owner),
                GraphqlVariable::string("name", name),
                GraphqlVariable::literal("number", number),
            ],
        )?;
        let data = parse_graphql_response::<ReviewThreadsQueryData>(&stdout, "review threads")?;
        Ok(map_review_threads(data))
    }
}

pub struct ReviewThreadService<T: GraphqlTransport> {
    client: ReviewGraphqlClient<T>,
}

impl<T: GraphqlTransport> ReviewThreadService<T> {
    pub fn new(client: ReviewGraphqlClient<T>) -> Self {
        Self { client }
    }

    pub fn create_thread_comment(
        &self,
        repo: &str,
        number: u32,
        input: CreatePullRequestReviewCommentInput,
    ) -> Result<(), String> {
        let (owner, name) = parse_repo(repo)?;
        let pull_request_id = self
            .client
            .get_pull_request_node_id(&owner, &name, number)?;
        self.client.create_thread_comment(&pull_request_id, input)
    }

    pub fn reply_to_thread(&self, thread_id: &str, body: &str) -> Result<(), String> {
        self.client.reply_to_thread(thread_id, body)
    }

    pub fn update_comment(&self, comment_id: &str, body: &str) -> Result<(), String> {
        self.client.update_comment(comment_id, body)
    }

    pub fn list_review_threads(
        &self,
        repo: &str,
        number: u32,
    ) -> Result<Vec<ReviewThread>, String> {
        let (owner, name) = parse_repo(repo)?;
        self.client.list_review_threads(&owner, &name, number)
    }
}

fn parse_graphql_response<T>(stdout: &str, context: &str) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let response = serde_json::from_str::<GraphQlResponse<T>>(stdout)
        .map_err(|error| format!("Failed to parse {context}: {error}"))?;

    if let Some(errors) = response.errors {
        return Err(normalize_graphql_errors(errors));
    }

    response
        .data
        .ok_or_else(|| format!("GitHub returned no {context} data"))
}

fn normalize_graphql_errors(errors: Vec<crate::models::GraphQlError>) -> String {
    let messages = errors
        .into_iter()
        .map(|error| error.message)
        .collect::<Vec<_>>()
        .join("\n");

    if messages.is_empty() {
        "GitHub returned an unknown GraphQL error".into()
    } else {
        messages
    }
}

fn map_review_threads(data: ReviewThreadsQueryData) -> Vec<ReviewThread> {
    data.repository
        .and_then(|repository| repository.pull_request)
        .map(|pull_request| pull_request.review_threads.nodes)
        .unwrap_or_default()
        .into_iter()
        .filter_map(map_review_thread)
        .collect()
}

fn map_review_thread(thread: GraphQlReviewThread) -> Option<ReviewThread> {
    let GraphQlReviewThread {
        id,
        path,
        is_resolved,
        is_outdated,
        line,
        original_line,
        start_line,
        original_start_line,
        diff_side,
        start_diff_side,
        subject_type,
        comments,
    } = thread;
    let nodes = comments.nodes;
    if nodes.is_empty() {
        return None;
    }

    Some(ReviewThread {
        id,
        path,
        is_resolved,
        is_outdated,
        line: line.or(original_line),
        start_line: start_line.or(original_start_line),
        side: Some(diff_side),
        start_side: start_diff_side,
        subject_type: Some(subject_type.to_ascii_lowercase()),
        comments: nodes.into_iter().map(map_review_comment).collect(),
    })
}

fn map_review_comment(comment: GraphQlReviewComment) -> ReviewComment {
    let GraphQlReviewComment {
        id,
        database_id,
        body,
        created_at,
        updated_at,
        url,
        author,
        author_association,
        reply_to,
    } = comment;

    ReviewComment {
        id,
        database_id,
        author_login: author
            .as_ref()
            .map(|author| author.login.clone())
            .unwrap_or_else(|| "unknown".into()),
        author_avatar_url: author.and_then(|author| author.avatar_url),
        author_association,
        body,
        created_at,
        updated_at,
        url,
        reply_to_id: reply_to.map(|reply_to| reply_to.id),
    }
}

const PULL_REQUEST_NODE_ID_QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
    }
  }
}
"#;

const CREATE_THREAD_COMMENT_MUTATION: &str = r#"
mutation(
  $pullRequestId: ID!,
  $body: String!,
  $path: String!,
  $line: Int,
  $side: DiffSide,
  $startLine: Int,
  $startSide: DiffSide,
  $subjectType: PullRequestReviewThreadSubjectType
) {
  addPullRequestReviewThread(
    input: {
      pullRequestId: $pullRequestId,
      body: $body,
      path: $path,
      line: $line,
      side: $side,
      startLine: $startLine,
      startSide: $startSide,
      subjectType: $subjectType
    }
  ) {
    thread {
      id
    }
  }
}
"#;

const REPLY_TO_THREAD_MUTATION: &str = r#"
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(
    input: {
      pullRequestReviewThreadId: $threadId,
      body: $body
    }
  ) {
    comment {
      id
    }
  }
}
"#;

const UPDATE_COMMENT_MUTATION: &str = r#"
mutation($commentId: ID!, $body: String!) {
  updatePullRequestReviewComment(
    input: {
      pullRequestReviewCommentId: $commentId,
      body: $body
    }
  ) {
    pullRequestReviewComment {
      id
    }
  }
}
"#;

const REVIEW_THREADS_QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          path
          isResolved
          isOutdated
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          startDiffSide
          subjectType
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              path
              authorAssociation
              author {
                login
                avatarUrl(size: 64)
              }
              replyTo {
                id
              }
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
    fn normalizes_graphql_error_payloads() {
        let transport = MockTransport::with_responses(vec![Ok(
            r#"{"errors":[{"message":"first"},{"message":"second"}]}"#.into(),
        )]);
        let client = ReviewGraphqlClient::new(&transport);

        let error = client
            .reply_to_thread("thread-1", "body")
            .expect_err("GraphQL errors should fail");

        assert_eq!(error, "first\nsecond");
    }

    #[test]
    fn maps_partial_review_thread_fields_safely() {
        let transport = MockTransport::with_responses(vec![Ok(r#"{
              "data": {
                "repository": {
                  "pullRequest": {
                    "reviewThreads": {
                      "nodes": [{
                        "id": "thread-1",
                        "path": "src/lib.rs",
                        "isResolved": false,
                        "isOutdated": true,
                        "line": null,
                        "originalLine": 42,
                        "startLine": null,
                        "originalStartLine": 40,
                        "diffSide": "RIGHT",
                        "startDiffSide": null,
                        "subjectType": "LINE",
                        "comments": {
                          "nodes": [{
                            "id": "comment-1",
                            "databaseId": null,
                            "body": "Looks good",
                            "createdAt": "2026-04-27T00:00:00Z",
                            "updatedAt": "2026-04-27T00:00:00Z",
                            "url": "https://github.com/example/repo/pull/1#discussion_r1",
                            "path": "src/lib.rs",
                            "authorAssociation": null,
                            "author": null,
                            "replyTo": null
                          }]
                        }
                      }]
                    }
                  }
                }
              }
            }"#
        .into())]);
        let client = ReviewGraphqlClient::new(&transport);

        let threads = client
            .list_review_threads("example", "repo", 1)
            .expect("review threads should parse");

        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].line, Some(42));
        assert_eq!(threads[0].start_line, Some(40));
        assert_eq!(threads[0].subject_type.as_deref(), Some("line"));
        assert_eq!(threads[0].comments[0].author_login, "unknown");
    }

    #[test]
    fn create_thread_comment_emits_expected_transport_calls() {
        let transport = MockTransport::with_responses(vec![
            Ok(r#"{"data":{"repository":{"pullRequest":{"id":"PR_kwDO"}}}}"#.into()),
            Ok(r#"{"data":{"addPullRequestReviewThread":{"thread":{"id":"thread-1"}}}}"#.into()),
        ]);
        let service = ReviewThreadService::new(ReviewGraphqlClient::new(&transport));

        service
            .create_thread_comment(
                "example/repo",
                7,
                CreatePullRequestReviewCommentInput {
                    body: "body".into(),
                    path: "src/lib.rs".into(),
                    line: Some(12),
                    side: Some("RIGHT".into()),
                    start_line: None,
                    start_side: None,
                    subject_type: "line".into(),
                },
            )
            .expect("comment should be created");

        let calls = transport.calls();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].0.contains("pullRequest(number: $number)"));
        assert_eq!(calls[0].1[2], GraphqlVariable::literal("number", 7));
        assert!(calls[1].0.contains("addPullRequestReviewThread"));
        assert!(calls[1]
            .1
            .contains(&GraphqlVariable::string("pullRequestId", "PR_kwDO")));
        assert!(calls[1].1.contains(&GraphqlVariable::literal("line", 12)));
    }
}
