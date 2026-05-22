use std::fs::OpenOptions;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::linear::{LinearIntegrationService, LINEAR_MCP_DEBUG_LOG_ENV};

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const TOOL_NAME: &str = "get_linear_issue_details";

pub fn run_stdio_server() {
    log_mcp_debug("linear-mcp stdio server started");

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }

        match handle_message(&line) {
            Some(response) => {
                if writeln!(stdout, "{response}").is_err() {
                    break;
                }
                if stdout.flush().is_err() {
                    break;
                }
            }
            None => {}
        }
    }

    log_mcp_debug("linear-mcp stdio server stopped");
}

fn handle_message(line: &str) -> Option<String> {
    let request = match serde_json::from_str::<Value>(line) {
        Ok(request) => request,
        Err(error) => {
            log_mcp_debug(format!("linear-mcp parse error error={error}"));
            return Some(error_response(
                Value::Null,
                -32700,
                &format!("Parse error: {error}"),
            ));
        }
    };

    let id = request.get("id").cloned();
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    log_mcp_debug(format!(
        "linear-mcp request method={method} has_id={}",
        id.is_some()
    ));

    match method {
        "initialize" => id.map(|id| success_response(id, initialize_result(&request))),
        "notifications/initialized" => None,
        "ping" => id.map(|id| success_response(id, json!({}))),
        "tools/list" => id.map(|id| success_response(id, tools_list_result())),
        "tools/call" => id.map(|id| success_response(id, call_tool_result(&request))),
        "resources/list" => id.map(|id| success_response(id, json!({ "resources": [] }))),
        "prompts/list" => id.map(|id| success_response(id, json!({ "prompts": [] }))),
        _ if id.is_some() => Some(error_response(
            id.unwrap_or(Value::Null),
            -32601,
            &format!("Method not found: {method}"),
        )),
        _ => None,
    }
}

fn initialize_result(request: &Value) -> Value {
    let protocol_version = request
        .get("params")
        .and_then(|params| params.get("protocolVersion"))
        .and_then(Value::as_str)
        .unwrap_or(MCP_PROTOCOL_VERSION);

    json!({
        "protocolVersion": protocol_version,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "rudu-linear",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

fn tools_list_result() -> Value {
    json!({
        "tools": [
            {
                "name": TOOL_NAME,
                "description": "Fetch read-only Linear issue details, including the issue description, for a Rudu Review Chat attachment.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "issue_id": {
                            "type": "string",
                            "description": "The Linear issue ID from the Rudu Issue Attachment."
                        }
                    },
                    "required": ["issue_id"],
                    "additionalProperties": false
                }
            }
        ]
    })
}

fn call_tool_result(request: &Value) -> Value {
    let params = request.get("params").unwrap_or(&Value::Null);
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if name != TOOL_NAME {
        log_mcp_debug(format!("linear-mcp tools/call unknown_tool name={name}"));
        return tool_error(&format!("Unknown tool: {name}"));
    }

    let arguments = params.get("arguments").unwrap_or(&Value::Null);
    let issue_id = arguments
        .get("issue_id")
        .or_else(|| arguments.get("issueId"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();

    if issue_id.is_empty() {
        log_mcp_debug("linear-mcp tools/call missing issue_id");
        return tool_error("issue_id is required.");
    }

    log_mcp_debug(format!(
        "linear-mcp tools/call start tool={TOOL_NAME} issue_id={issue_id}"
    ));

    match LinearIntegrationService::new().get_issue_details(issue_id) {
        Ok(details) => {
            log_mcp_debug(format!(
                "linear-mcp tools/call success tool={TOOL_NAME} issue_id={issue_id} identifier={}",
                details.identifier
            ));
            let text = serde_json::to_string_pretty(&details)
                .unwrap_or_else(|_| "Failed to serialize Linear issue details.".to_string());
            json!({
                "content": [
                    {
                        "type": "text",
                        "text": text
                    }
                ],
                "isError": false
            })
        }
        Err(error) => {
            log_mcp_debug(format!(
                "linear-mcp tools/call error tool={TOOL_NAME} issue_id={issue_id} error={error}"
            ));
            tool_error(&error)
        }
    }
}

fn tool_error(message: &str) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": message
            }
        ],
        "isError": true
    })
}

fn success_response(id: Value, result: Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
    .to_string()
}

fn error_response(id: Value, code: i32, message: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
    .to_string()
}

fn mcp_debug_log_path() -> Option<PathBuf> {
    std::env::var(LINEAR_MCP_DEBUG_LOG_ENV)
        .ok()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn log_mcp_debug(message: impl AsRef<str>) {
    let Some(path) = mcp_debug_log_path() else {
        return;
    };

    write_mcp_debug_line(&path, message.as_ref());
}

fn write_mcp_debug_line(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{timestamp_ms} {message}");
    }
}
