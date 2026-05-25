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

#[derive(Clone, Copy)]
pub(super) struct ReviewChatRuntimeAdapter {
    pub(super) kind: ReviewChatRuntimeKind,
    pub(super) label: &'static str,
    pub(super) stderr_label: &'static str,
    agent: fn() -> Result<AcpAgent, String>,
    readiness: fn(&dyn Fn(ReviewChatAdapterInstallEvent)) -> ReviewChatReadinessStatus,
    codex_effort_config: fn(ReviewChatEffortMode) -> Option<Vec<SessionConfigOption>>,
    model_config: fn(&str) -> Option<Vec<SessionConfigOption>>,
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

    pub(super) fn config_for_codex_effort(
        self,
        mode: ReviewChatEffortMode,
    ) -> Option<Vec<SessionConfigOption>> {
        (self.codex_effort_config)(mode)
    }

    pub(super) fn config_for_model(self, model: &str) -> Option<Vec<SessionConfigOption>> {
        (self.model_config)(model)
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

fn no_model_config(_model: &str) -> Option<Vec<SessionConfigOption>> {
    None
}

fn opencode_model_config(model: &str) -> Option<Vec<SessionConfigOption>> {
    Some(opencode::opencode_model_config(model))
}

pub(super) fn adapter_for_runtime(kind: ReviewChatRuntimeKind) -> ReviewChatRuntimeAdapter {
    match kind {
        ReviewChatRuntimeKind::Codex => ReviewChatRuntimeAdapter {
            kind,
            label: "Codex ACP",
            stderr_label: "codex-acp stderr",
            agent: codex::codex_acp_agent,
            readiness: codex_readiness,
            codex_effort_config: codex::codex_effort_config,
            model_config: no_model_config,
        },
        ReviewChatRuntimeKind::OpenCode => ReviewChatRuntimeAdapter {
            kind,
            label: "OpenCode ACP",
            stderr_label: "opencode stderr",
            agent: opencode::opencode_acp_agent,
            readiness: opencode_readiness,
            codex_effort_config: |_| None,
            model_config: opencode_model_config,
        },
    }
}
