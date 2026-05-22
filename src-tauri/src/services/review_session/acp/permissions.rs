use std::path::Path;

use agent_client_protocol::schema::{
    PermissionOption, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    SelectedPermissionOutcome,
};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReviewPermissionCapability {
    RuduReadOnlyMcpTool,
    GithubCliDelegation,
    OutsideInspectionOnly,
}

impl ReviewPermissionCapability {
    fn reason(self) -> &'static str {
        match self {
            Self::RuduReadOnlyMcpTool => "rudu_read_only_mcp_tool",
            Self::GithubCliDelegation => "github_cli_delegation",
            Self::OutsideInspectionOnly => "outside_inspection_only",
        }
    }

    fn is_allowed(self) -> bool {
        matches!(self, Self::RuduReadOnlyMcpTool | Self::GithubCliDelegation)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct PermissionPolicyDecision {
    pub(super) reason: &'static str,
    allow: bool,
}

impl PermissionPolicyDecision {
    fn for_capability(capability: ReviewPermissionCapability) -> Self {
        Self {
            reason: capability.reason(),
            allow: capability.is_allowed(),
        }
    }

    pub(super) fn outcome(&self, request: &RequestPermissionRequest) -> RequestPermissionOutcome {
        if !self.allow {
            return RequestPermissionOutcome::Cancelled;
        }

        preferred_allow_option(request)
            .map(|option| {
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    option.option_id.clone(),
                ))
            })
            .unwrap_or(RequestPermissionOutcome::Cancelled)
    }
}

pub(super) fn permission_policy(request: &RequestPermissionRequest) -> PermissionPolicyDecision {
    PermissionPolicyDecision::for_capability(classify_permission(request))
}

fn classify_permission(request: &RequestPermissionRequest) -> ReviewPermissionCapability {
    if is_rudu_read_only_mcp_permission(request) {
        return ReviewPermissionCapability::RuduReadOnlyMcpTool;
    }

    if is_direct_gh_command_permission(request) {
        return ReviewPermissionCapability::GithubCliDelegation;
    }

    ReviewPermissionCapability::OutsideInspectionOnly
}

fn preferred_allow_option(request: &RequestPermissionRequest) -> Option<&PermissionOption> {
    request
        .options
        .iter()
        .find(|option| matches!(option.kind, PermissionOptionKind::AllowOnce))
        .or_else(|| {
            request
                .options
                .iter()
                .find(|option| matches!(option.kind, PermissionOptionKind::AllowAlways))
        })
}

fn is_rudu_read_only_mcp_permission(request: &RequestPermissionRequest) -> bool {
    let Some(raw_input) = request.tool_call.fields.raw_input.as_ref() else {
        return false;
    };

    let server_name = json_string(raw_input, &["server_name"])
        .or_else(|| json_string(raw_input, &["serverName"]))
        .or_else(|| json_string(raw_input, &["server", "name"]));
    if server_name.as_deref() != Some("rudu-linear") {
        return false;
    }

    let tool_name = json_string(raw_input, &["request", "params", "name"])
        .or_else(|| json_string(raw_input, &["params", "name"]))
        .or_else(|| json_string(raw_input, &["tool_name"]))
        .or_else(|| json_string(raw_input, &["toolName"]))
        .or_else(|| {
            request
                .tool_call
                .fields
                .title
                .as_deref()
                .map(str::to_string)
        });

    tool_name
        .as_deref()
        .map(|name| name.contains("get_linear_issue_details"))
        .unwrap_or(false)
}

fn is_direct_gh_command_permission(request: &RequestPermissionRequest) -> bool {
    let Some(raw_input) = request.tool_call.fields.raw_input.as_ref() else {
        return false;
    };

    command_argv(raw_input)
        .and_then(|argv| argv.first().cloned())
        .map(|program| executable_basename(&program) == "gh")
        .unwrap_or(false)
}

fn command_argv(value: &Value) -> Option<Vec<String>> {
    if let Some(argv) = string_array_at(value, &["command"]) {
        return Some(argv);
    }

    if let Some(command) = json_string(value, &["command"]) {
        return shell_words(&command);
    }

    if let Some(argv) = string_array_at(value, &["exec", "command"]) {
        return Some(argv);
    }

    if let Some(argv) = string_array_at(value, &["action", "exec", "command"]) {
        return Some(argv);
    }

    None
}

fn string_array_at(value: &Value, path: &[&str]) -> Option<Vec<String>> {
    let value = json_at(value, path)?;
    let values = value.as_array()?;
    values
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect()
}

fn json_string(value: &Value, path: &[&str]) -> Option<String> {
    json_at(value, path)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn json_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn shell_words(command: &str) -> Option<Vec<String>> {
    let words = command
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    (!words.is_empty()).then_some(words)
}

fn executable_basename(program: &str) -> &str {
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
}

#[cfg(test)]
mod tests {
    use super::{permission_policy, PermissionPolicyDecision, ReviewPermissionCapability};
    use agent_client_protocol::schema::{
        PermissionOption, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
        ToolCallUpdate, ToolCallUpdateFields,
    };
    use serde_json::json;

    impl PermissionPolicyDecision {
        fn allow(reason: &'static str) -> Self {
            Self {
                reason,
                allow: true,
            }
        }

        fn deny(reason: &'static str) -> Self {
            Self {
                reason,
                allow: false,
            }
        }
    }

    #[test]
    fn capability_reasons_are_stable_for_debug_logs() {
        assert_eq!(
            ReviewPermissionCapability::RuduReadOnlyMcpTool.reason(),
            "rudu_read_only_mcp_tool"
        );
        assert_eq!(
            ReviewPermissionCapability::GithubCliDelegation.reason(),
            "github_cli_delegation"
        );
        assert_eq!(
            ReviewPermissionCapability::OutsideInspectionOnly.reason(),
            "outside_inspection_only"
        );
    }

    #[test]
    fn allows_direct_gh_permission_requests() {
        let request = permission_request(json!({ "command": ["gh", "run", "rerun", "123"] }));

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::allow("github_cli_delegation")
        );
        assert!(matches!(
            permission_policy(&request).outcome(&request),
            RequestPermissionOutcome::Selected(outcome) if outcome.option_id.to_string() == "allow-once"
        ));
    }

    #[test]
    fn denies_shell_wrapped_gh_permission_requests() {
        let request = permission_request(json!({ "command": ["sh", "-c", "gh run rerun 123"] }));

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::deny("outside_inspection_only")
        );
        assert_eq!(
            permission_policy(&request).outcome(&request),
            RequestPermissionOutcome::Cancelled
        );
    }

    #[test]
    fn allows_rudu_read_only_mcp_permission_requests() {
        let request = permission_request(json!({
            "server_name": "rudu-linear",
            "request": {
                "params": {
                    "name": "get_linear_issue_details",
                    "arguments": { "issue_id": "LIN-123" }
                }
            }
        }));

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::allow("rudu_read_only_mcp_tool")
        );
    }

    #[test]
    fn denies_unknown_mcp_tool_permission_requests() {
        let request = permission_request(json!({
            "server_name": "rudu-linear",
            "request": {
                "params": {
                    "name": "mutate_linear_issue",
                    "arguments": { "issue_id": "LIN-123" }
                }
            }
        }));

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::deny("outside_inspection_only")
        );
    }

    #[test]
    fn denies_unknown_local_command_permission_requests() {
        let request = permission_request(json!({ "command": ["bun", "test"] }));

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::deny("outside_inspection_only")
        );
        assert_eq!(
            permission_policy(&request).outcome(&request),
            RequestPermissionOutcome::Cancelled
        );
    }

    #[test]
    fn denies_unknown_permission_requests_even_with_allow_option() {
        let request = permission_request(json!({ "command": ["git", "checkout", "main"] }));

        assert_eq!(
            permission_policy(&request),
            PermissionPolicyDecision::deny("outside_inspection_only")
        );
        assert_eq!(
            permission_policy(&request).outcome(&request),
            RequestPermissionOutcome::Cancelled
        );
    }

    fn permission_request(raw_input: serde_json::Value) -> RequestPermissionRequest {
        RequestPermissionRequest::new(
            "acp-1",
            ToolCallUpdate::new("call-1", ToolCallUpdateFields::new().raw_input(raw_input)),
            vec![
                PermissionOption::new("allow-once", "Allow once", PermissionOptionKind::AllowOnce),
                PermissionOption::new(
                    "reject-once",
                    "Reject once",
                    PermissionOptionKind::RejectOnce,
                ),
            ],
        )
    }
}
