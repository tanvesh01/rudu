use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::models::ReviewWalkthrough;

use super::{json_text, WalkthroughGeneratorRequest, WALKTHROUGH_TIMEOUT};

const OPENCODE_SERVER_START_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn run(request: &WalkthroughGeneratorRequest<'_>) -> Result<ReviewWalkthrough, String> {
    let server = OpenCodeServer::start(request.repo_dir)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(WALKTHROUGH_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to configure OpenCode walkthrough client: {error}"))?;
    let repo_dir_string = request.repo_dir.to_string_lossy().to_string();
    let model_choice =
        parse_opencode_model_choice(request.session.runtime_model_choice.as_deref())?;
    let session_id = create_opencode_session(
        &client,
        &server.base_url,
        &repo_dir_string,
        model_choice.as_ref(),
    )?;

    let raw_output = send_opencode_text_prompt(
        &client,
        &server.base_url,
        &repo_dir_string,
        &session_id,
        model_choice.as_ref(),
        &opencode_walkthrough_prompt(request.prompt),
        "OpenCode walkthrough raw generation failed",
    )?;

    json_text::parse_with_repair(&raw_output, |raw_output, validation_error| {
        send_opencode_text_prompt(
            &client,
            &server.base_url,
            &repo_dir_string,
            &session_id,
            model_choice.as_ref(),
            &opencode_repair_prompt(raw_output, validation_error),
            "OpenCode walkthrough repair retry failed",
        )
    })
}

fn create_opencode_session(
    client: &reqwest::blocking::Client,
    base_url: &str,
    repo_dir: &str,
    model_choice: Option<&OpenCodeModelChoice>,
) -> Result<String, String> {
    let mut create_body = serde_json::Map::new();
    create_body.insert(
        "title".to_string(),
        Value::String("Rudu Review Walkthrough".to_string()),
    );
    create_body.insert(
        "permission".to_string(),
        opencode_walkthrough_permission_rules(),
    );
    if let Some(model_choice) = model_choice {
        create_body.insert("model".to_string(), model_choice.session_model_json());
    }

    let create_response = post_opencode_json(
        client,
        &format!("{base_url}/session"),
        repo_dir,
        Value::Object(create_body),
        "Failed to create OpenCode walkthrough session",
    )?;
    create_response
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "OpenCode did not return a walkthrough session id.".to_string())
}

fn send_opencode_text_prompt(
    client: &reqwest::blocking::Client,
    base_url: &str,
    repo_dir: &str,
    session_id: &str,
    model_choice: Option<&OpenCodeModelChoice>,
    prompt: &str,
    context: &str,
) -> Result<String, String> {
    let mut prompt_body = serde_json::Map::new();
    prompt_body.insert(
        "parts".to_string(),
        json!([{ "type": "text", "text": prompt }]),
    );
    if let Some(model_choice) = model_choice {
        prompt_body.insert("model".to_string(), model_choice.prompt_model_json());
    }

    let prompt_response = post_opencode_json(
        client,
        &format!("{base_url}/session/{session_id}/message"),
        repo_dir,
        Value::Object(prompt_body),
        context,
    )?;

    extract_text_response(&prompt_response).map_err(|error| format!("{context}: {error}"))
}

fn post_opencode_json(
    client: &reqwest::blocking::Client,
    url: &str,
    repo_dir: &str,
    body: Value,
    context: &str,
) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(url, &[("directory", repo_dir)])
        .map_err(|error| format!("{context}: invalid OpenCode URL: {error}"))?;
    let response = client
        .post(url)
        .json(&body)
        .send()
        .map_err(|error| format!("{context}: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("{context}: failed to read response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "{context} ({status}): {}",
            opencode_response_error_message(&body)
        ));
    }

    serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("{context}: failed to parse response: {error}"))
}

fn extract_text_response(response: &Value) -> Result<String, String> {
    if let Some(error) = response.get("info").and_then(|info| info.get("error")) {
        return Err(opencode_error_message(error));
    }

    let text = response
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");

    if text.trim().is_empty() {
        return Err("OpenCode did not return any assistant text parts.".to_string());
    }

    Ok(text)
}

fn opencode_response_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .map(|value| opencode_error_message(&value))
        .unwrap_or_else(|_| body.trim().to_string())
}

fn opencode_error_message(value: &Value) -> String {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("OpenCodeError");
    let message = value
        .get("data")
        .and_then(|data| data.get("message"))
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("unknown error");

    format!("{name}: {message}")
}

fn opencode_walkthrough_prompt(base_prompt: &str) -> String {
    format!(
        r#"{base_prompt}

Output contract:
Return exactly one JSON object and no markdown, no prose, no comments.
Use only the context in this prompt. Do not call tools or inspect files during this OpenCode walkthrough generator call.
Use this shape:
{{
  "summary": {{
    "focus": string,
    "skim": string
  }},
  "groups": [
    {{
      "title": string,
      "reason": string,
      "files": [
        {{
          "path": string,
          "action": "review" | "scan" | "skim",
          "scope": "shared" | "local" | "routine",
          "reason": string,
          "context": string
        }}
      ]
    }}
  ]
}}

Rules:
- Use double-quoted JSON keys and string values.
- Do not include trailing commas.
- Do not include fields outside this shape.
- Return only the JSON object."#
    )
}

fn opencode_repair_prompt(raw_output: &str, validation_error: &str) -> String {
    format!(
        r#"Your previous Review Walkthrough output could not be parsed or validated.

Validation error:
{validation_error}

Previous output:
{raw_output}

Return exactly one corrected JSON object and no markdown, no prose, no comments.
The corrected object must use this shape:
{{
  "summary": {{
    "focus": string,
    "skim": string
  }},
  "groups": [
    {{
      "title": string,
      "reason": string,
      "files": [
        {{
          "path": string,
          "action": "review" | "scan" | "skim",
          "scope": "shared" | "local" | "routine",
          "reason": string,
          "context": string
        }}
      ]
    }}
  ]
}}"#
    )
}

fn opencode_walkthrough_permission_rules() -> Value {
    json!([
        { "permission": "read", "pattern": "*", "action": "deny" },
        { "permission": "glob", "pattern": "*", "action": "deny" },
        { "permission": "grep", "pattern": "*", "action": "deny" },
        { "permission": "list", "pattern": "*", "action": "deny" },
        { "permission": "lsp", "pattern": "*", "action": "deny" },
        { "permission": "edit", "pattern": "*", "action": "deny" },
        { "permission": "bash", "pattern": "*", "action": "deny" },
        { "permission": "task", "pattern": "*", "action": "deny" },
        { "permission": "skill", "pattern": "*", "action": "deny" },
        { "permission": "todoread", "pattern": "*", "action": "deny" },
        { "permission": "todowrite", "pattern": "*", "action": "deny" },
        { "permission": "webfetch", "pattern": "*", "action": "deny" },
        { "permission": "websearch", "pattern": "*", "action": "deny" },
        { "permission": "codesearch", "pattern": "*", "action": "deny" },
        { "permission": "external_directory", "pattern": "*", "action": "deny" }
    ])
}

#[derive(Debug, Eq, PartialEq)]
struct OpenCodeModelChoice {
    provider_id: String,
    model_id: String,
}

impl OpenCodeModelChoice {
    fn session_model_json(&self) -> Value {
        json!({
            "providerID": self.provider_id,
            "id": self.model_id
        })
    }

    fn prompt_model_json(&self) -> Value {
        json!({
            "providerID": self.provider_id,
            "modelID": self.model_id
        })
    }
}

fn parse_opencode_model_choice(
    choice: Option<&str>,
) -> Result<Option<OpenCodeModelChoice>, String> {
    let Some(choice) = choice.map(str::trim).filter(|choice| !choice.is_empty()) else {
        return Ok(None);
    };
    let Some((provider_id, model_id)) = choice.split_once('/') else {
        return Err("OpenCode review model must be in provider/model format.".to_string());
    };
    let provider_id = provider_id.trim();
    let model_id = model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return Err("OpenCode review model must be in provider/model format.".to_string());
    }

    Ok(Some(OpenCodeModelChoice {
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
    }))
}

struct OpenCodeServer {
    child: Child,
    base_url: String,
}

impl OpenCodeServer {
    fn start(repo_dir: &Path) -> Result<Self, String> {
        let port = reserve_local_port()?;
        let base_url = format!("http://127.0.0.1:{port}");
        let mut child = Command::new(super::super::acp::resolve_opencode_binary())
            .arg("serve")
            .arg("--hostname")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .current_dir(repo_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to start OpenCode walkthrough generator: {error}"))?;

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .map_err(|error| format!("Failed to configure OpenCode startup probe: {error}"))?;
        let started_at = Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|error| {
                format!("Failed to check OpenCode walkthrough generator: {error}")
            })? {
                return Err(format!(
                    "OpenCode walkthrough generator exited before it was ready: {status}"
                ));
            }

            if client.get(format!("{base_url}/doc")).send().is_ok() {
                return Ok(Self { child, base_url });
            }

            if started_at.elapsed() > OPENCODE_SERVER_START_TIMEOUT {
                let _ = child.kill();
                let _ = child.wait();
                return Err("OpenCode walkthrough generator timed out during startup.".to_string());
            }

            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

impl Drop for OpenCodeServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn reserve_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Failed to reserve OpenCode walkthrough port: {error}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| format!("Failed to inspect OpenCode walkthrough port: {error}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{extract_text_response, parse_opencode_model_choice, OpenCodeModelChoice};

    #[test]
    fn parses_opencode_model_choice() {
        assert_eq!(
            parse_opencode_model_choice(Some("anthropic/claude-sonnet-4")).unwrap(),
            Some(OpenCodeModelChoice {
                provider_id: "anthropic".to_string(),
                model_id: "claude-sonnet-4".to_string()
            })
        );
    }

    #[test]
    fn rejects_invalid_opencode_model_choice() {
        assert_eq!(
            parse_opencode_model_choice(Some("claude-sonnet-4")),
            Err("OpenCode review model must be in provider/model format.".to_string())
        );
    }

    #[test]
    fn extracts_text_parts_from_opencode_response() {
        let response = json!({
            "info": {},
            "parts": [
                { "type": "reasoning", "text": "thinking" },
                { "type": "text", "text": "{\"summary\":" },
                { "type": "tool", "name": "read" },
                { "type": "text", "text": "{}}" }
            ]
        });

        assert_eq!(
            extract_text_response(&response).unwrap(),
            "{\"summary\":\n{}}"
        );
    }

    #[test]
    fn reports_opencode_response_error_before_text_parts() {
        let response = json!({
            "info": {
                "error": {
                    "name": "APIError",
                    "data": { "message": "provider rejected request" }
                }
            },
            "parts": [
                { "type": "text", "text": "{}" }
            ]
        });

        assert_eq!(
            extract_text_response(&response),
            Err("APIError: provider rejected request".to_string())
        );
    }
}
