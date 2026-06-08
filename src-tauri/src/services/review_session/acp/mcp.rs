use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime};

use agent_client_protocol::schema::{EnvVariable, McpServer, McpServerStdio};

use crate::linear::{LinearIntegrationService, LINEAR_MCP_API_KEY_ENV, LINEAR_MCP_DEBUG_LOG_ENV};

use super::debug::log_review_chat_debug;
use super::tools::linear_issue_details_tool;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ReviewChatMcpConfig {
    pub(super) linear_issue_details: bool,
}

pub(super) fn current_review_chat_mcp_config() -> ReviewChatMcpConfig {
    ReviewChatMcpConfig {
        linear_issue_details: matches!(
            LinearIntegrationService::new().cached_api_key_for_session_mcp(),
            Some(_)
        ),
    }
}

pub(super) fn review_chat_mcp_servers(
    config: ReviewChatMcpConfig,
    debug_log_path: Option<&Path>,
) -> Vec<McpServer> {
    if !config.linear_issue_details {
        return Vec::new();
    }

    let Ok(current_exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let Some(linear_api_key) = LinearIntegrationService::new().cached_api_key_for_session_mcp()
    else {
        return Vec::new();
    };

    let mut env = vec![EnvVariable::new(LINEAR_MCP_API_KEY_ENV, linear_api_key)];
    if let Some(debug_log_path) = debug_log_path {
        env.push(EnvVariable::new(
            LINEAR_MCP_DEBUG_LOG_ENV,
            debug_log_path.to_string_lossy().to_string(),
        ));
    }

    let tool = linear_issue_details_tool();
    vec![McpServer::Stdio(
        McpServerStdio::new(tool.server_name, current_exe)
            .args(vec!["--rudu-linear-mcp".to_string()])
            .env(env),
    )]
}

pub(super) fn probe_review_chat_mcp_servers(
    mcp_servers: &[McpServer],
    debug_log_path: Option<&Path>,
) {
    for server in mcp_servers {
        let McpServer::Stdio(server) = server else {
            continue;
        };

        let env_names = server
            .env
            .iter()
            .map(|env| env.name.as_str())
            .collect::<Vec<_>>()
            .join(",");
        log_review_chat_debug(
            debug_log_path,
            format!(
                "probe MCP server name={} command={} args={:?} env_names=[{}]",
                server.name,
                server.command.display(),
                server.args,
                env_names,
            ),
        );

        let mut command = Command::new(&server.command);
        command
            .args(&server.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for env in &server.env {
            command.env(&env.name, &env.value);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                log_review_chat_debug(
                    debug_log_path,
                    format!(
                        "probe MCP server spawn failed name={} error={error}",
                        server.name
                    ),
                );
                continue;
            }
        };

        if let Some(stdin) = child.stdin.as_mut() {
            let _ = writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"2024-11-05","capabilities":{{}},"clientInfo":{{"name":"rudu","version":"{}"}}}}}}"#,
                env!("CARGO_PKG_VERSION")
            );
            let _ = writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","method":"notifications/initialized","params":{{}}}}"#
            );
            let _ = writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{{}}}}"#
            );
        }
        drop(child.stdin.take());

        let started_at = SystemTime::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if started_at
                        .elapsed()
                        .map(|elapsed| elapsed > Duration::from_secs(3))
                        .unwrap_or(true)
                    {
                        let _ = child.kill();
                        log_review_chat_debug(
                            debug_log_path,
                            format!("probe MCP server timed out name={}", server.name),
                        );
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => {
                    log_review_chat_debug(
                        debug_log_path,
                        format!(
                            "probe MCP server wait failed name={} error={error}",
                            server.name
                        ),
                    );
                    break;
                }
            }
        }

        match child.wait_with_output() {
            Ok(output) => {
                log_review_chat_debug(
                    debug_log_path,
                    format!(
                        "probe MCP server exited name={} status={}",
                        server.name, output.status
                    ),
                );
                if !output.stdout.is_empty() {
                    log_review_chat_debug(
                        debug_log_path,
                        format!(
                            "probe MCP server stdout name={} output={}",
                            server.name,
                            String::from_utf8_lossy(&output.stdout).trim()
                        ),
                    );
                }
                if !output.stderr.is_empty() {
                    log_review_chat_debug(
                        debug_log_path,
                        format!(
                            "probe MCP server stderr name={} output={}",
                            server.name,
                            String::from_utf8_lossy(&output.stderr).trim()
                        ),
                    );
                }
            }
            Err(error) => log_review_chat_debug(
                debug_log_path,
                format!(
                    "probe MCP server output read failed name={} error={error}",
                    server.name
                ),
            ),
        }
    }
}
