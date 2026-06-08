mod codex;
mod json_text;
mod opencode;

use std::path::Path;

use crate::models::{ReviewChatRuntimeKind, ReviewSession, ReviewWalkthrough};

pub(super) struct WalkthroughGeneratorRequest<'a> {
    pub session: &'a ReviewSession,
    pub repo_dir: &'a Path,
    pub rudu_dir: &'a Path,
    pub prompt: &'a str,
}

pub(super) fn run(request: WalkthroughGeneratorRequest<'_>) -> Result<ReviewWalkthrough, String> {
    match request.session.review_runtime {
        ReviewChatRuntimeKind::Codex => codex::run(&request),
        ReviewChatRuntimeKind::OpenCode => opencode::run(&request),
    }
}

pub(super) fn running_message(runtime: ReviewChatRuntimeKind) -> &'static str {
    match runtime {
        ReviewChatRuntimeKind::Codex => "Asking Codex for a walkthrough",
        ReviewChatRuntimeKind::OpenCode => "Asking OpenCode for a walkthrough",
    }
}

const WALKTHROUGH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

const WALKTHROUGH_SCHEMA: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "groups"],
  "properties": {
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": ["focus", "skim"],
      "properties": {
        "focus": { "type": "string" },
        "skim": { "type": "string" }
      }
    },
    "groups": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "reason", "files"],
        "properties": {
          "title": { "type": "string" },
          "reason": { "type": "string" },
          "files": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["path", "action", "scope", "reason", "context"],
              "properties": {
                "path": { "type": "string" },
                "action": { "type": "string", "enum": ["review", "scan", "skim"] },
                "scope": { "type": "string", "enum": ["shared", "local", "routine"] },
                "reason": { "type": "string" },
                "context": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}"#;

fn unique_suffix() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    )
}
