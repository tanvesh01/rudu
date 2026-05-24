use agent_client_protocol_tokio::AcpAgent;

use crate::models::{ReviewChatReadinessStatus, ReviewChatRuntimeKind};

use super::codex::{self, ReviewChatEffortMode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct SessionConfigOption {
    pub(super) key: &'static str,
    pub(super) value: &'static str,
    pub(super) required: bool,
}

#[derive(Clone, Copy)]
pub(super) struct ReviewChatRuntimeAdapter {
    pub(super) kind: ReviewChatRuntimeKind,
    pub(super) label: &'static str,
    pub(super) stderr_label: &'static str,
    agent: fn() -> Result<AcpAgent, String>,
    readiness: fn() -> ReviewChatReadinessStatus,
    codex_effort_config: fn(ReviewChatEffortMode) -> Option<Vec<SessionConfigOption>>,
}

impl ReviewChatRuntimeAdapter {
    pub(super) fn agent(self) -> Result<AcpAgent, String> {
        (self.agent)()
    }

    pub(super) fn readiness(self) -> ReviewChatReadinessStatus {
        (self.readiness)()
    }

    pub(super) fn config_for_codex_effort(
        self,
        mode: ReviewChatEffortMode,
    ) -> Option<Vec<SessionConfigOption>> {
        (self.codex_effort_config)(mode)
    }
}

pub(super) fn adapter_for_runtime(kind: ReviewChatRuntimeKind) -> ReviewChatRuntimeAdapter {
    match kind {
        ReviewChatRuntimeKind::Codex => ReviewChatRuntimeAdapter {
            kind,
            label: "Codex ACP",
            stderr_label: "codex-acp stderr",
            agent: codex::codex_acp_agent,
            readiness: codex::review_chat_readiness,
            codex_effort_config: codex::codex_effort_config,
        },
    }
}
