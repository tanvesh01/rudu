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
}

impl RuntimeConfigRequest {
    pub(super) fn log_label(&self) -> String {
        match self {
            Self::CodexEffort(mode) => format!("codex-effort:{}", mode.as_str()),
        }
    }

    pub(super) fn active_turn_error(&self) -> &'static str {
        match self {
            Self::CodexEffort(_) => "Review effort changes apply before the next Rudu chat turn.",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct RuntimeTurnPreparationRequest<'a> {
    pub(super) active_review_effort_mode: &'a str,
    pub(super) pending_review_effort_mode: Option<&'a str>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RuntimeTurnPreparation {
    pub(super) options: Vec<SessionConfigOption>,
    pub(super) consumed_pending_review_effort_mode: Option<ReviewChatEffortMode>,
}

#[derive(Clone, Copy)]
pub(super) struct ReviewChatRuntimeAdapter {
    pub(super) kind: ReviewChatRuntimeKind,
    pub(super) label: &'static str,
    pub(super) stderr_label: &'static str,
    agent: fn() -> Result<AcpAgent, String>,
    readiness: fn(&dyn Fn(ReviewChatAdapterInstallEvent)) -> ReviewChatReadinessStatus,
    runtime_config: fn(RuntimeConfigRequest) -> Result<Vec<SessionConfigOption>, String>,
    turn_preparation:
        for<'a> fn(RuntimeTurnPreparationRequest<'a>) -> Result<RuntimeTurnPreparation, String>,
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

    pub(super) fn prepare_turn(
        self,
        request: RuntimeTurnPreparationRequest<'_>,
    ) -> Result<RuntimeTurnPreparation, String> {
        (self.turn_preparation)(request)
    }
}

fn codex_readiness(
    emit_event: &dyn Fn(ReviewChatAdapterInstallEvent),
) -> ReviewChatReadinessStatus {
    codex::review_chat_readiness(emit_event)
}

fn codex_agent() -> Result<AcpAgent, String> {
    codex::codex_acp_agent()
}

fn opencode_readiness(
    _emit_event: &dyn Fn(ReviewChatAdapterInstallEvent),
) -> ReviewChatReadinessStatus {
    opencode::review_chat_readiness()
}

fn opencode_agent() -> Result<AcpAgent, String> {
    opencode::opencode_acp_agent()
}

fn codex_runtime_config(request: RuntimeConfigRequest) -> Result<Vec<SessionConfigOption>, String> {
    match request {
        RuntimeConfigRequest::CodexEffort(mode) => Ok(codex::codex_effort_config(mode)),
    }
}

fn opencode_runtime_config(
    request: RuntimeConfigRequest,
) -> Result<Vec<SessionConfigOption>, String> {
    match request {
        RuntimeConfigRequest::CodexEffort(_) => {
            Err("OpenCode ACP does not support Codex review effort modes.".to_string())
        }
    }
}

fn codex_turn_preparation(
    request: RuntimeTurnPreparationRequest<'_>,
) -> Result<RuntimeTurnPreparation, String> {
    let mode = request
        .pending_review_effort_mode
        .unwrap_or(request.active_review_effort_mode);
    let mode = ReviewChatEffortMode::parse(mode)?;

    Ok(RuntimeTurnPreparation {
        options: codex::codex_effort_config(mode),
        consumed_pending_review_effort_mode: request.pending_review_effort_mode.map(|_| mode),
    })
}

fn opencode_turn_preparation(
    _request: RuntimeTurnPreparationRequest<'_>,
) -> Result<RuntimeTurnPreparation, String> {
    Ok(RuntimeTurnPreparation {
        options: Vec::new(),
        consumed_pending_review_effort_mode: None,
    })
}

pub(super) fn adapter_for_runtime(kind: ReviewChatRuntimeKind) -> ReviewChatRuntimeAdapter {
    match kind {
        ReviewChatRuntimeKind::Codex => ReviewChatRuntimeAdapter {
            kind,
            label: "Codex ACP",
            stderr_label: "codex-acp stderr",
            agent: codex_agent,
            readiness: codex_readiness,
            runtime_config: codex_runtime_config,
            turn_preparation: codex_turn_preparation,
        },
        ReviewChatRuntimeKind::OpenCode => ReviewChatRuntimeAdapter {
            kind,
            label: "OpenCode ACP",
            stderr_label: "opencode stderr",
            agent: opencode_agent,
            readiness: opencode_readiness,
            runtime_config: opencode_runtime_config,
            turn_preparation: opencode_turn_preparation,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{adapter_for_runtime, RuntimeConfigRequest, RuntimeTurnPreparationRequest};
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
    fn unsupported_runtime_config_paths_return_current_errors() {
        let opencode = adapter_for_runtime(ReviewChatRuntimeKind::OpenCode);
        assert_eq!(
            opencode.config_for_runtime(RuntimeConfigRequest::CodexEffort(
                ReviewChatEffortMode::Fast
            )),
            Err("OpenCode ACP does not support Codex review effort modes.".to_string())
        );
    }

    #[test]
    fn codex_turn_preparation_uses_active_effort_mode() {
        let adapter = adapter_for_runtime(ReviewChatRuntimeKind::Codex);

        let preparation = adapter
            .prepare_turn(RuntimeTurnPreparationRequest {
                active_review_effort_mode: "fast",
                pending_review_effort_mode: None,
            })
            .expect("turn preparation succeeds");

        assert_eq!(preparation.options[0].key, "model");
        assert_eq!(preparation.options[0].value, "gpt-5.4-mini");
        assert_eq!(preparation.options[1].key, "reasoning_effort");
        assert_eq!(preparation.options[1].value, "low");
        assert_eq!(preparation.consumed_pending_review_effort_mode, None);
    }

    #[test]
    fn codex_turn_preparation_consumes_pending_effort_mode() {
        let adapter = adapter_for_runtime(ReviewChatRuntimeKind::Codex);

        let preparation = adapter
            .prepare_turn(RuntimeTurnPreparationRequest {
                active_review_effort_mode: "fast",
                pending_review_effort_mode: Some("deep"),
            })
            .expect("turn preparation succeeds");

        assert_eq!(preparation.options[0].value, "gpt-5.5");
        assert_eq!(preparation.options[1].value, "high");
        assert_eq!(
            preparation.consumed_pending_review_effort_mode,
            Some(ReviewChatEffortMode::Deep)
        );
    }

    #[test]
    fn opencode_turn_preparation_does_not_apply_model_choice() {
        let adapter = adapter_for_runtime(ReviewChatRuntimeKind::OpenCode);

        let preparation = adapter
            .prepare_turn(RuntimeTurnPreparationRequest {
                active_review_effort_mode: "fast",
                pending_review_effort_mode: Some("deep"),
            })
            .expect("turn preparation succeeds");

        assert!(preparation.options.is_empty());
        assert_eq!(preparation.consumed_pending_review_effort_mode, None);
    }

    #[test]
    fn opencode_turn_preparation_without_model_choice_is_empty() {
        let adapter = adapter_for_runtime(ReviewChatRuntimeKind::OpenCode);

        let preparation = adapter
            .prepare_turn(RuntimeTurnPreparationRequest {
                active_review_effort_mode: "fast",
                pending_review_effort_mode: Some("deep"),
            })
            .expect("turn preparation succeeds");

        assert!(preparation.options.is_empty());
        assert_eq!(preparation.consumed_pending_review_effort_mode, None);
    }
}
