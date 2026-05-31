use agent_client_protocol_tokio::AcpAgent;

use crate::models::{ReviewChatReadinessStatus, ReviewChatRuntimeKind};

use super::super::ReviewChatAdapterInstallEvent;
use super::codex::{self, ReviewChatEffortMode};
use super::opencode;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SessionConfigOption {
    pub(super) key: &'static str,
    pub(super) value: String,
    pub(super) required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum RuntimeConfigRequest {
    CodexEffort(ReviewChatEffortMode),
    ModelChoice(String),
}

impl RuntimeConfigRequest {
    pub(super) fn log_label(&self) -> String {
        match self {
            Self::CodexEffort(mode) => format!("codex-effort:{}", mode.as_str()),
            Self::ModelChoice(model) => format!("model:{model}"),
        }
    }

    pub(super) fn active_turn_error(&self) -> &'static str {
        match self {
            Self::CodexEffort(_) => "Review effort changes apply before the next Rudu chat turn.",
            Self::ModelChoice(_) => "Review model changes apply before the next Rudu chat turn.",
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct ReviewChatRuntimeAdapter {
    pub(super) kind: ReviewChatRuntimeKind,
    pub(super) label: &'static str,
    pub(super) stderr_label: &'static str,
    agent: fn() -> Result<AcpAgent, String>,
    readiness: fn(&dyn Fn(ReviewChatAdapterInstallEvent)) -> ReviewChatReadinessStatus,
    runtime_config: fn(RuntimeConfigRequest) -> Result<Vec<SessionConfigOption>, String>,
}

impl ReviewChatRuntimeAdapter {
    pub(super) fn agent(self) -> Result<AcpAgent, String> {
        (self.agent)()
    }

    pub(super) fn readiness<F>(self, emit_event: F) -> ReviewChatReadinessStatus
    where
        F: Fn(ReviewChatAdapterInstallEvent),
    {
        (self.readiness)(&emit_event)
    }

    pub(super) fn config_for_runtime(
        self,
        request: RuntimeConfigRequest,
    ) -> Result<Vec<SessionConfigOption>, String> {
        (self.runtime_config)(request)
    }
}

fn codex_readiness(
    emit_event: &dyn Fn(ReviewChatAdapterInstallEvent),
) -> ReviewChatReadinessStatus {
    codex::review_chat_readiness(emit_event)
}

fn opencode_readiness(
    _emit_event: &dyn Fn(ReviewChatAdapterInstallEvent),
) -> ReviewChatReadinessStatus {
    opencode::review_chat_readiness()
}

fn codex_runtime_config(request: RuntimeConfigRequest) -> Result<Vec<SessionConfigOption>, String> {
    match request {
        RuntimeConfigRequest::CodexEffort(mode) => Ok(codex::codex_effort_config(mode)),
        RuntimeConfigRequest::ModelChoice(_) => {
            Err("Codex ACP does not support runtime model choices.".to_string())
        }
    }
}

fn opencode_runtime_config(
    request: RuntimeConfigRequest,
) -> Result<Vec<SessionConfigOption>, String> {
    match request {
        RuntimeConfigRequest::CodexEffort(_) => {
            Err("OpenCode ACP does not support Codex review effort modes.".to_string())
        }
        RuntimeConfigRequest::ModelChoice(model) => Ok(opencode::opencode_model_config(&model)),
    }
}

pub(super) fn adapter_for_runtime(kind: ReviewChatRuntimeKind) -> ReviewChatRuntimeAdapter {
    match kind {
        ReviewChatRuntimeKind::Codex => ReviewChatRuntimeAdapter {
            kind,
            label: "Codex ACP",
            stderr_label: "codex-acp stderr",
            agent: codex::codex_acp_agent,
            readiness: codex_readiness,
            runtime_config: codex_runtime_config,
        },
        ReviewChatRuntimeKind::OpenCode => ReviewChatRuntimeAdapter {
            kind,
            label: "OpenCode ACP",
            stderr_label: "opencode stderr",
            agent: opencode::opencode_acp_agent,
            readiness: opencode_readiness,
            runtime_config: opencode_runtime_config,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{adapter_for_runtime, RuntimeConfigRequest};
    use crate::models::ReviewChatRuntimeKind;
    use crate::services::review_session::acp::ReviewChatEffortMode;

    #[test]
    fn codex_effort_config_maps_fast_and_deep_to_session_options() {
        let adapter = adapter_for_runtime(ReviewChatRuntimeKind::Codex);

        let fast = adapter
            .config_for_runtime(RuntimeConfigRequest::CodexEffort(
                ReviewChatEffortMode::Fast,
            ))
            .expect("fast config is supported");
        assert_eq!(fast[0].key, "model");
        assert_eq!(fast[0].value, "gpt-5.4-mini");
        assert!(fast[0].required);
        assert_eq!(fast[1].key, "reasoning_effort");
        assert_eq!(fast[1].value, "low");
        assert!(!fast[1].required);

        let deep = adapter
            .config_for_runtime(RuntimeConfigRequest::CodexEffort(
                ReviewChatEffortMode::Deep,
            ))
            .expect("deep config is supported");
        assert_eq!(deep[0].value, "gpt-5.5");
        assert_eq!(deep[1].value, "high");
        assert!(deep[1].required);
    }

    #[test]
    fn opencode_model_choice_maps_to_required_model_config() {
        let adapter = adapter_for_runtime(ReviewChatRuntimeKind::OpenCode);

        let config = adapter
            .config_for_runtime(RuntimeConfigRequest::ModelChoice(
                "anthropic/claude-sonnet-4".to_string(),
            ))
            .expect("model config is supported");

        assert_eq!(config.len(), 1);
        assert_eq!(config[0].key, "model");
        assert_eq!(config[0].value, "anthropic/claude-sonnet-4");
        assert!(config[0].required);
    }

    #[test]
    fn unsupported_runtime_config_paths_return_current_errors() {
        let codex = adapter_for_runtime(ReviewChatRuntimeKind::Codex);
        assert_eq!(
            codex.config_for_runtime(RuntimeConfigRequest::ModelChoice("x/y".to_string())),
            Err("Codex ACP does not support runtime model choices.".to_string())
        );

        let opencode = adapter_for_runtime(ReviewChatRuntimeKind::OpenCode);
        assert_eq!(
            opencode.config_for_runtime(RuntimeConfigRequest::CodexEffort(
                ReviewChatEffortMode::Fast
            )),
            Err("OpenCode ACP does not support Codex review effort modes.".to_string())
        );
    }
}
