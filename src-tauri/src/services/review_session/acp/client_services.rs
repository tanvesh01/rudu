use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use agent_client_protocol::schema::{
    CreateTerminalRequest, CreateTerminalResponse, KillTerminalRequest, KillTerminalResponse,
    ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalRequest, ReleaseTerminalResponse,
    TerminalExitStatus, TerminalOutputRequest, TerminalOutputResponse, WaitForTerminalExitRequest,
    WaitForTerminalExitResponse,
};

use super::debug::log_review_chat_debug;

#[derive(Default)]
pub(super) struct AcpClientServices {
    repo_dir: PathBuf,
    terminals: Mutex<HashMap<String, StoredTerminal>>,
    next_terminal_id: Mutex<u64>,
    debug_log_path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct StoredTerminal {
    output: String,
    truncated: bool,
    exit_status: TerminalExitStatus,
}

impl AcpClientServices {
    pub(super) fn new(repo_dir: PathBuf, debug_log_path: Option<PathBuf>) -> Self {
        Self {
            repo_dir,
            terminals: Mutex::new(HashMap::new()),
            next_terminal_id: Mutex::new(0),
            debug_log_path,
        }
    }

    pub(super) fn debug_log_path(&self) -> Option<&Path> {
        self.debug_log_path.as_deref()
    }

    pub(super) fn read_text_file(
        &self,
        request: ReadTextFileRequest,
    ) -> Result<ReadTextFileResponse, String> {
        let path = self
            .allowed_repo_path(&request.path)
            .map_err(|error| format!("Rudu refused ACP file read: {error}"))?;
        let content = std::fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        Ok(ReadTextFileResponse::new(slice_text_lines(
            &content,
            request.line,
            request.limit,
        )))
    }

    pub(super) fn create_terminal(
        &self,
        request: CreateTerminalRequest,
    ) -> Result<CreateTerminalResponse, String> {
        let executable = executable_basename(&request.command);
        if executable != "gh" {
            return Err(format!(
                "Rudu Review Chat only allows ACP terminal commands through gh; refused {}.",
                request.command
            ));
        }

        let cwd = match request.cwd {
            Some(cwd) => self.allowed_repo_path(&cwd)?,
            None => self.repo_dir.clone(),
        };
        let terminal_id = self.next_terminal_id()?;
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!(
                "terminal create start terminal_id={terminal_id} command={} args={:?} cwd={}",
                request.command,
                request.args,
                cwd.display(),
            ),
        );

        let command_output = Command::new(&request.command)
            .args(&request.args)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Failed to run gh through ACP terminal: {error}"))?;
        let exit_status = TerminalExitStatus::new()
            .exit_code(command_output.status.code().map(|code| code as u32));
        let raw_output = combined_terminal_output(command_output);
        let (output, truncated) = truncate_terminal_output(
            raw_output,
            request.output_byte_limit.unwrap_or(64 * 1024) as usize,
        );
        self.terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .insert(
                terminal_id.clone(),
                StoredTerminal {
                    output,
                    truncated,
                    exit_status,
                },
            );
        log_review_chat_debug(
            self.debug_log_path.as_deref(),
            format!("terminal create finish terminal_id={terminal_id} success=true"),
        );
        Ok(CreateTerminalResponse::new(terminal_id))
    }

    pub(super) fn terminal_output(
        &self,
        request: TerminalOutputRequest,
    ) -> Result<TerminalOutputResponse, String> {
        let terminal = self.terminal(&request.terminal_id.to_string())?;
        Ok(
            TerminalOutputResponse::new(terminal.output, terminal.truncated)
                .exit_status(Some(terminal.exit_status)),
        )
    }

    pub(super) fn wait_for_terminal_exit(
        &self,
        request: WaitForTerminalExitRequest,
    ) -> Result<WaitForTerminalExitResponse, String> {
        let terminal = self.terminal(&request.terminal_id.to_string())?;
        Ok(WaitForTerminalExitResponse::new(terminal.exit_status))
    }

    pub(super) fn release_terminal(
        &self,
        request: ReleaseTerminalRequest,
    ) -> Result<ReleaseTerminalResponse, String> {
        self.terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .remove(&request.terminal_id.to_string());
        Ok(ReleaseTerminalResponse::new())
    }

    pub(super) fn kill_terminal(
        &self,
        request: KillTerminalRequest,
    ) -> Result<KillTerminalResponse, String> {
        if !self
            .terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .contains_key(&request.terminal_id.to_string())
        {
            return Err(format!("Unknown ACP terminal id {}.", request.terminal_id));
        }
        Ok(KillTerminalResponse::new())
    }

    fn allowed_repo_path(&self, path: &Path) -> Result<PathBuf, String> {
        let repo_dir = self
            .repo_dir
            .canonicalize()
            .map_err(|error| format!("failed to resolve review workspace: {error}"))?;
        let full_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            repo_dir.join(path)
        };
        let canonical = full_path
            .canonicalize()
            .map_err(|error| format!("failed to resolve {}: {error}", full_path.display()))?;
        if !canonical.starts_with(&repo_dir) {
            return Err(format!(
                "{} is outside the review workspace.",
                canonical.display()
            ));
        }
        Ok(canonical)
    }

    fn next_terminal_id(&self) -> Result<String, String> {
        let mut next = self
            .next_terminal_id
            .lock()
            .map_err(|_| "Rudu ACP terminal id registry is poisoned.".to_string())?;
        *next += 1;
        Ok(format!("rudu-gh-{}", *next))
    }

    fn terminal(&self, terminal_id: &str) -> Result<StoredTerminal, String> {
        self.terminals
            .lock()
            .map_err(|_| "Rudu ACP terminal registry is poisoned.".to_string())?
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| format!("Unknown ACP terminal id {terminal_id}."))
    }
}

pub(super) fn slice_text_lines(content: &str, line: Option<u32>, limit: Option<u32>) -> String {
    let start = line.unwrap_or(1).saturating_sub(1) as usize;
    let iter = content.lines().skip(start);
    match limit {
        Some(limit) => iter.take(limit as usize).collect::<Vec<_>>().join("\n"),
        None => iter.collect::<Vec<_>>().join("\n"),
    }
}

fn combined_terminal_output(output: std::process::Output) -> String {
    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !combined.ends_with('\n') && !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    combined
}

pub(super) fn truncate_terminal_output(output: String, limit: usize) -> (String, bool) {
    if limit == 0 {
        return (String::new(), !output.is_empty());
    }
    if output.len() <= limit {
        return (output, false);
    }
    let mut start = output.len() - limit;
    while !output.is_char_boundary(start) {
        start += 1;
    }
    (output[start..].to_string(), true)
}

fn executable_basename(command: &str) -> &str {
    Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
}
